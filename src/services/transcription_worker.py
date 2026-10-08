"""Local transcription worker: one long-lived process per container, next to the separation worker.

Same unix-socket protocol, queue, preemption and heartbeats as ``separation_worker`` (it reuses its ``Worker``),
with the job op ``transcribe``. The engine is turbo-lyrics (packed-VAD Whisper large-v3-turbo int8 + wav2vec2 CTC
alignment, and forced alignment of known lyrics). It runs in its own process: CTranslate2 brings its own OpenMP
runtime, and a crash here must not take separation down. The two workers share the CPU gate
(``compute_gate.py``), so only one of them computes at a time.

A job is ``{"input": vocals.mp3, "outputs": {"asr": a.json, "reference": b.json}, "priority": "interactive" |
"batch", "mode": "asr" | "shadow" | "prefer_reference", "language": "de" | null, "reference": {"lines": [...],
"times": [...] | null} | null, "label": "..."}``:

- ``asr``: transcribe only.
- ``shadow``: also force-align the reference lyrics and report their gate and agreement; the ASR result is used.
- ``prefer_reference``: use the reference alignment when it passes the gate, otherwise transcribe.

Files are written only for the paths produced; the result says which one was ``chosen``.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import sys
import time

from src.services.separation_worker import (
    EXIT_ALREADY_RUNNING,
    EXIT_LOAD_FAILED,
    PRIORITIES,
    Worker,
    _acquire_singleton,
)

log = logging.getLogger("melodai.transcription_worker")

MODES = ("asr", "shadow", "prefer_reference")
MAX_REFERENCE_LINES = 3000


def _write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def _scaled(progress, lo, hi):
    def report(done, total):
        progress(lo + int((hi - lo) * min(done, total) / max(1, total)), 100)
    return report


class TurboLyricsEngine:
    """turbo-lyrics. Imports torch and CTranslate2, so only ever constructed inside the worker."""

    name = "turbo-lyrics"

    def __init__(self, model="large-v3-turbo", compute_type="int8", threads=8, cache_dir=None,
                 languages=("en", "de"), align_precision="auto"):
        from turbo_lyrics import Transcriber, __version__

        t0 = time.perf_counter()
        self.tr = Transcriber(model, compute_type, threads, align_precision=align_precision, cache_dir=cache_dir)
        self.tr.warm(languages)
        self.info = {
            "engine": self.name,
            "version": __version__,
            "model": model,
            "compute_type": compute_type,
            "align_precision": self.tr.aligner.precision,
            "threads": threads,
            "load_s": round(time.perf_counter() - t0, 2),
        }

    def run(self, spec, progress, check_abort):
        from turbo_lyrics import compare

        t0 = time.perf_counter()
        mode = spec.get("mode", "asr")
        reference = spec.get("reference") or {}
        lines = reference.get("lines") or []
        language = spec.get("language") or None
        song = self.tr.prepare(spec["input"])
        progress(0, 100)
        result = {"mode": mode, "duration_s": round(song.duration, 3)}
        ref = None
        if mode in ("shadow", "prefer_reference") and lines:
            try:
                ref = self.tr.align_reference(song, lines, line_times=reference.get("times"), language=language,
                                              progress=_scaled(progress, 0, 30))
                _write_json(spec["outputs"]["reference"], ref.data)
                result["reference"] = {"gate": ref.data["gate"], "timings": ref.timings,
                                       "language": ref.data["detected_language"]}
            except ValueError as e:  # unsupported language, text longer than the audio
                result["reference"] = {"error": str(e)}
        if mode == "prefer_reference" and ref is not None and ref.data["gate"]["passed"]:
            result["chosen"] = "reference"
        else:
            asr = self.tr.transcribe(song, language=language, reference=lines or None,
                                     progress=_scaled(progress, 30 if ref is not None else 0, 100))
            check_abort()
            _write_json(spec["outputs"]["asr"], asr.data)
            result["chosen"] = "asr"
            result["asr"] = {"language": asr.data["detected_language"],
                             "language_source": asr.data.get("language_source"),
                             "timings": asr.timings, "vad": asr.data.get("vad"), "words": len(asr.words)}
            if ref is not None:
                result["agreement"] = compare(ref.data, asr.data)
        wall = time.perf_counter() - t0
        result["wall_s"] = round(wall, 3)
        result["rtf"] = round(wall / song.duration, 4) if song.duration else None
        return result


class FakeEngine:
    """Test double without models. ``MELODAI_FAKE_ASR_STEPS`` (default 4), ``MELODAI_FAKE_ASR_DELAY`` seconds per
    step (0.02), ``MELODAI_FAKE_ASR_FAIL_LOAD``; an input path or ``MELODAI_FAKE_ASR_MODE`` containing ``fail`` /
    ``crash`` / ``empty`` raises, kills the process, or transcribes nothing. A reference line containing ``badref``
    fails the gate."""

    name = "fake"

    def __init__(self, **_kwargs):
        if os.environ.get("MELODAI_FAKE_ASR_FAIL_LOAD"):
            raise RuntimeError("fake transcription model failed to load")
        self.info = {"engine": "fake", "version": "0.0-test", "model": "fake", "compute_type": "none",
                     "align_precision": "none", "threads": 1, "load_s": 0.0}

    @staticmethod
    def _words(texts, t0=1.0):
        segments, t = [], t0
        for text in texts:
            words = []
            for w in text.split():
                words.append({"word": w, "start": round(t, 3), "end": round(t + 0.4, 3), "score": 0.9})
                t += 0.5
            if words:
                segments.append({"start": words[0]["start"], "end": words[-1]["end"], "text": text, "words": words})
            t += 1.0
        return segments

    def run(self, spec, progress, check_abort):
        how = spec["input"] + " " + os.environ.get("MELODAI_FAKE_ASR_MODE", "")
        steps = int(os.environ.get("MELODAI_FAKE_ASR_STEPS", "4"))
        delay = float(os.environ.get("MELODAI_FAKE_ASR_DELAY", "0.02"))
        progress(0, steps)
        if "crash" in how:
            os._exit(9)
        if "fail" in how:
            raise RuntimeError("fake transcription failed")
        for k in range(1, steps + 1):
            time.sleep(delay)
            progress(k, steps)
        check_abort()
        mode = spec.get("mode", "asr")
        lines = (spec.get("reference") or {}).get("lines") or []
        result = {"mode": mode, "duration_s": 60.0, "wall_s": steps * delay, "rtf": 0.01}
        passed = bool(lines) and not any("badref" in line for line in lines)
        if mode in ("shadow", "prefer_reference") and lines:
            segments = self._words(lines)
            starts, k = [], 0
            for s in segments:
                starts.append(k)
                k += len(s["words"])
            gate = {"passed": passed, "reasons": [] if passed else ["mean_score"], "metrics": {"mean_score": 0.9}}
            _write_json(spec["outputs"]["reference"], {"segments": segments, "detected_language": "en",
                                                       "source": "reference", "line_starts": starts, "gate": gate})
            result["reference"] = {"gate": gate}
        if mode == "prefer_reference" and passed:
            result["chosen"] = "reference"
            return result
        texts = [] if "empty" in how else ["hello fake world.", "this is a test"]
        _write_json(spec["outputs"]["asr"], {"segments": self._words(texts), "detected_language": "en"})
        result["chosen"] = "asr"
        result["asr"] = {"language": "en", "words": sum(len(t.split()) for t in texts)}
        return result


ENGINES = {"turbo": TurboLyricsEngine, "fake": FakeEngine}


def validate_spec(spec):
    if not isinstance(spec, dict):
        raise ValueError("job must be an object")
    src = spec.get("input")
    if not isinstance(src, str) or not os.path.isabs(src) or not os.path.isfile(src):
        raise ValueError("input must be an existing absolute file path")
    outputs = spec.get("outputs")
    if not isinstance(outputs, dict) or "asr" not in outputs or not set(outputs) <= {"asr", "reference"}:
        raise ValueError("outputs must name 'asr' (and optionally 'reference')")
    for path in outputs.values():
        if not isinstance(path, str) or not os.path.isabs(path) or not os.path.isdir(os.path.dirname(path)):
            raise ValueError("outputs must be absolute paths in existing directories")
    if spec.get("priority", "interactive") not in PRIORITIES:
        raise ValueError("priority must be 'interactive' or 'batch'")
    mode = spec.get("mode", "asr")
    if mode not in MODES:
        raise ValueError(f"mode must be one of {', '.join(MODES)}")
    if mode != "asr" and "reference" not in outputs:
        raise ValueError(f"mode {mode} needs a 'reference' output")
    language = spec.get("language")
    if language is not None and (not isinstance(language, str) or not 2 <= len(language) <= 5):
        raise ValueError("language must be an ISO 639 code")
    reference = spec.get("reference")
    if reference is not None:
        lines = reference.get("lines") if isinstance(reference, dict) else None
        times = reference.get("times") if isinstance(reference, dict) else None
        if not isinstance(lines, list) or len(lines) > MAX_REFERENCE_LINES or \
                not all(isinstance(line, str) for line in lines):
            raise ValueError("reference.lines must be a list of strings")
        if times is not None and (not isinstance(times, list) or len(times) != len(lines) or
                                  not all(t is None or isinstance(t, (int, float)) for t in times)):
            raise ValueError("reference.times must be null or one number (or null) per line")
    return spec


def main(argv=None):
    parser = argparse.ArgumentParser(description="MelodAI local transcription worker")
    parser.add_argument("--socket", required=True)
    parser.add_argument("--engine", choices=sorted(ENGINES), default="turbo")
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--align-precision", default="auto")
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--languages", default="en,de", help="aligners loaded at startup (others load on demand)")
    parser.add_argument("--cache-dir", default=None)
    parser.add_argument("--nice", type=int, default=10)
    parser.add_argument("--no-preempt", action="store_true")
    parser.add_argument("--heartbeat", type=float, default=5.0)
    parser.add_argument("--parent-pid", type=int, default=None)
    parser.add_argument("--compute-lock", default=None)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s transcription-worker %(levelname)s %(message)s")
    lock = _acquire_singleton(args.socket)
    if lock is None:
        log.info("another transcription worker already owns %s", args.socket)
        return EXIT_ALREADY_RUNNING
    if args.nice:
        try:
            os.nice(args.nice)
        except OSError:
            pass
    if args.threads:
        os.environ.setdefault("OMP_NUM_THREADS", str(args.threads))

    def factory():
        cls = ENGINES[args.engine]
        return cls(model=args.model, compute_type=args.compute_type, threads=args.threads, cache_dir=args.cache_dir,
                   languages=tuple(x.strip() for x in args.languages.split(",") if x.strip()),
                   align_precision=args.align_precision)

    gate = None
    if args.compute_lock:
        from src.services.compute_gate import ComputeGate
        gate = ComputeGate(args.compute_lock)
    worker = Worker(factory, args.socket, preempt=not args.no_preempt, heartbeat=args.heartbeat,
                    parent_pid=args.parent_pid, name="transcription", op="transcribe", validate=validate_spec,
                    gate=gate)

    def on_signal(signum, _frame):
        log.info("signal %s: stopping", signum)
        worker.stop()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    worker.listen()
    try:
        if not worker.load():
            time.sleep(0.2)
            return EXIT_LOAD_FAILED
        worker.serve_forever()
    finally:
        worker.stop()
        try:
            os.unlink(args.socket)
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
