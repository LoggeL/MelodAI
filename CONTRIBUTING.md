# Contributing to MelodAI

Thanks for helping improve MelodAI. The project is a full-stack AI karaoke app with a Flask backend and a React/Vite frontend.

## Good first contribution areas

- UI polish and accessibility
- player and sync edge cases
- admin workflow improvements
- test coverage for auth, credits, and song processing
- documentation and setup improvements
- security hardening around file serving, sessions, and external API failures

## Local setup

```bash
uv sync
cd frontend && npm install
```

Copy `example.env` to `.env` and provide the API keys needed for the workflows you want to test.

```bash
uv run python main.py
cd frontend && npm run dev
```

## Checks before opening a PR

```bash
cd frontend
npm run lint
npm run build
```

Integration and browser tests expect the Flask backend on port 5000:

```bash
cd frontend
npm run test:integration
npm run test:browser
```

The live pipeline test uses paid/remote APIs and can take several minutes, so only run it when changing the song-processing pipeline:

```bash
cd frontend && npm run test:pipeline
```

## Pull request expectations

- keep PRs focused
- describe user-visible changes
- mention any new environment variables
- include screenshots for UI changes
- do not commit `.env`, databases, downloaded songs, generated stems, or local build outputs
