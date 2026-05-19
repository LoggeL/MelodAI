from datetime import UTC, datetime

from src.models.db import execute_db, query_db


def get_config_value(key: str, default: str | None = None) -> str | None:
    try:
        row = query_db("SELECT value FROM app_config WHERE key = ?", [key], one=True)
        return row["value"] if row else default
    except Exception:
        return default


def set_config_value(key: str, value: str) -> None:
    now = datetime.now(UTC).isoformat()
    execute_db(
        """
        INSERT INTO app_config (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        [key, value, now],
    )


def mask_secret(value: str | None) -> str:
    if not value:
        return ""
    if len(value) <= 12:
        return "*" * len(value)
    return f"{value[:6]}...{value[-6:]}"
