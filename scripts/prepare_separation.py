"""Docker build step: fetch the separation checkpoint, compile the CPU kernels and run a smoke test.

Runs inside the image after the Python dependencies are installed (``python scripts/prepare_separation.py``).
Weights go to ``$TURBO_ROFORMER_HOME/models`` (sha256-checked by turbo-roformer), kernels to
``$TURBO_ROFORMER_HOME/kernels``. A CPU without AVX512-BF16 is not an error: the worker then uses the portable
torch path. A failing smoke test fails the build, so a broken separation stack is never deployed.
"""

import os
import sys
import time


def main():
    import numpy as np
    from turbo_roformer import Separator, __version__, _kernels, registry

    model = os.environ.get("SEPARATION_MODEL", "resurrection")
    threads = int(os.environ.get("SEPARATION_THREADS", "8"))
    print(f"turbo-roformer {__version__}, cache {_kernels.cache_root()}", flush=True)

    t0 = time.perf_counter()
    path = registry.ensure_weights(registry.resolve_spec(model), None, progress=False)
    print(f"weights: {path} ({os.path.getsize(path) / 1e6:.0f} MB, {time.perf_counter() - t0:.1f} s)", flush=True)

    ok, reason = _kernels.support()
    if ok:
        t0 = time.perf_counter()
        try:
            _kernels.load()
            print(f"kernels: compiled for {_kernels.cpu_model_name()} ({time.perf_counter() - t0:.1f} s)", flush=True)
        except _kernels.KernelUnavailable as e:
            print(f"WARNING: kernel build failed, the worker will use the torch path: {e}", flush=True)
    else:
        print(f"kernels: not used on this machine ({reason}); the worker will use the torch path", flush=True)

    t0 = time.perf_counter()
    separator = Separator(model=model, precision="bf16", threads=threads, progress=False)
    rng = np.random.default_rng(0)
    mix = (0.1 * rng.standard_normal((2, 44100 * 2))).astype(np.float32)
    inst = separator.separate(mix, sr=44100)
    if inst.shape != mix.shape or not np.isfinite(inst).all():
        print(f"ERROR: smoke separation returned {inst.shape} / finite={np.isfinite(inst).all()}", flush=True)
        return 1
    print(f"smoke test: backend={separator.backend} precision={separator.precision} "
          f"({time.perf_counter() - t0:.1f} s incl. load)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
