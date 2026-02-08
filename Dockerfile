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

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Install Python dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

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

CMD ["uv", "run", "python", "main.py"]
