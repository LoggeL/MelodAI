"""Chat completions for lyrics: prefer a configured OpenAI key for OpenAI models."""
import os

import requests


def _configuration(model):
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    if openai_key and (model.startswith("openai/") or model == "gpt-6-luna"):
        return "openai", "https://api.openai.com/v1/chat/completions", openai_key, model.removeprefix("openai/")
    router_model = "openai/gpt-6-luna" if model == "gpt-6-luna" else model
    return "openrouter", "https://openrouter.ai/api/v1/chat/completions", os.getenv("OPENROUTER_API_KEY", "").strip(), router_model


def has_api_key(model):
    return bool(_configuration(model)[2])


def chat_completion(payload, *, timeout):
    """Return provider JSON and safe producer metadata. A failed request is never resubmitted elsewhere."""
    provider, endpoint, key, model = _configuration(payload["model"])
    if not key:
        raise RuntimeError("No API key configured for the lyrics model")
    body = dict(payload)
    body["model"] = model
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if provider == "openai":
        if "max_tokens" in body:
            body["max_completion_tokens"] = body.pop("max_tokens")
    else:
        headers.update({"HTTP-Referer": "https://melodai.logge.top", "X-Title": "MelodAI"})
    response = requests.post(endpoint, headers=headers, json=body, timeout=timeout)
    response.raise_for_status()
    data = response.json()
    if "error" in data:
        raise RuntimeError(data["error"])
    return data, {"provider": provider, "model": model}
