# Stage 1: Build frontend
FROM node:22-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Production
FROM python:3.12-slim

WORKDIR /app

# ffmpeg: audio decode/encode. g++: the turbo-roformer AVX512-BF16 kernels are compiled below for this machine;
# the compiler stays in the image so a container on a different CPU can rebuild them on first use (or fall back
# to the portable torch path when the CPU has no AVX512-BF16). git: uv fetches turbo-roformer from its git tag.
# tini: PID 1 that forwards signals and reaps orphaned ffmpeg processes of a killed separation worker.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg g++ git tini \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH" \
    TURBO_ROFORMER_HOME=/opt/turbo-roformer \
    HF_HOME=/opt/huggingface \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TRANSFORMERS_VERBOSITY=error \
    PYTHONUNBUFFERED=1

# Install Python dependencies, including local separation and transcription (CPU-only torch wheel from the PyTorch
# CPU index)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project --extra separation --extra transcription

# Separation model: download the checkpoint (sha256-verified, ~204 MB) and compile the kernels at build time.
# Dokploy builds this image on the production host, so -march=native targets the CPU it will run on. Weights and
# kernels live in the image (not on /data): a deploy is self-contained and the worker is ready seconds after
# start, without network access. This layer is cached until the Python dependencies change.
COPY scripts/prepare_separation.py scripts/prepare_separation.py
RUN python scripts/prepare_separation.py

# Transcription models: Whisper large-v3-turbo (int8 at load time) and the wav2vec2 aligners for English and German
# (~3 GB in $HF_HOME). Aligners for other languages are downloaded on first use. A smoke test fails the build when
# the transcription stack is broken.
COPY scripts/prepare_transcription.py scripts/prepare_transcription.py
RUN python scripts/prepare_transcription.py

# Copy backend source
COPY main.py .
COPY src/ src/

# Copy built frontend into src/static/
COPY --from=frontend-build /app/src/static/ src/static/

# Create directories for persistent data
# These should be mounted as volumes
RUN mkdir -p /data/songs /data/db

# Symlink persistent storage into the app
# database.db lives at src/database.db -> /data/db/database.db
# songs dir lives at src/songs -> /data/songs
RUN ln -s /data/db/database.db src/database.db \
    && ln -s /data/songs src/songs

EXPOSE 5000

# The app starts the separation and transcription workers (src/services/separation_worker.py,
# src/services/transcription_worker.py) as child processes on startup.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "main.py"]
