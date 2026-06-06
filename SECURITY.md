# Security Policy

MelodAI handles user accounts, API credentials, downloaded audio files, and generated song artifacts. Please report security issues privately.

## Supported versions

Security fixes target the `main` branch.

## Reporting a vulnerability

Please do **not** open a public issue for vulnerabilities.

Report privately through GitHub Security Advisories if available, or contact the maintainer directly via the GitHub profile linked from this repository.

Helpful details include:

- affected route, component, or workflow
- steps to reproduce
- impact and required permissions
- relevant logs or screenshots with secrets removed

## Security-sensitive areas

- authentication, password reset, and session handling
- admin routes and credit accounting
- Deezer / Replicate / OpenRouter credential handling
- song download, storage, and file serving
- lyrics processing and LLM prompt/data boundaries
- background processing and retry behavior
