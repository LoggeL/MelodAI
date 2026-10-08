"""Docker build step: download the transcription models and run a smoke test.

Runs inside the image after the Python dependencies are installed (``python scripts/prepare_transcription.py``).
Whisper (``TRANSCRIBE_MODEL``) and the wav2vec2 aligners for ``TRANSCRIBE_LANGUAGES`` go to the Hugging Face cache
(``$HF_HOME``), so the worker loads them from the image. Aligners for other languages are downloaded on first use.
A failing smoke test fails the build, so a broken transcription stack is never deployed.
"""

import os
import sys
import time


def main():
    import numpy as np
    from turbo_lyrics import Transcriber, __version__

    model = os.environ.get("TRANSCRIBE_MODEL", "large-v3-turbo")
    compute_type = os.environ.get("TRANSCRIBE_COMPUTE_TYPE", "int8")
    threads = int(os.environ.get("TRANSCRIBE_THREADS", "8"))
    languages = [x.strip() for x in os.environ.get("TRANSCRIBE_LANGUAGES", "en,de").split(",") if x.strip()]
    print(f"turbo-lyrics {__version__}, cache {os.environ.get('HF_HOME', '~/.cache/huggingface')}", flush=True)

    t0 = time.perf_counter()
    tr = Transcriber(model, compute_type, threads)
    tr.warm(languages)
    print(f"models: {model} {compute_type} + aligners {','.join(languages)} ({time.perf_counter() - t0:.1f} s), "
          f"aligner precision {tr.aligner.precision}", flush=True)

    t0 = time.perf_counter()
    sr = 16000
    t = np.arange(sr * 3) / sr
    audio = (0.2 * np.sin(2 * np.pi * 220 * t) * (1 + np.sin(2 * np.pi * 3 * t))).astype(np.float32)
    result = tr.transcribe(audio, language=languages[0] if languages else "en")
    if not isinstance(result.data.get("segments"), list):
        print(f"ERROR: smoke transcription returned {result.data!r}", flush=True)
        return 1
    print(f"smoke test: {len(result.words)} words ({time.perf_counter() - t0:.1f} s)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
