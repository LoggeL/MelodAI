import traceback
from datetime import datetime


def log_event(level, source, message, details=None, track_id=None, user_id=None, username=None):
    """Log a general application event. Safe to call from any context."""
    try:
        from src.models.db import insert_db
        insert_db(
            """INSERT INTO app_logs (level, source, message, details, track_id, user_id, username)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [level, source, str(message), details, track_id, user_id, username],
        )
    except Exception as e:
        print(f"WARNING: Could not log event: {e}")


def log_pipeline_error(track_id, stage, error_msg, stack_trace=None):
    """Log a pipeline processing error. Safe to call from background threads."""
    try:
        from src.models.db import insert_db
        insert_db(
            """INSERT INTO error_log
               (error_type, source, error_message, stack_trace, track_id)
               VALUES (?, ?, ?, ?, ?)""",
            ["pipeline", stage, str(error_msg), stack_trace, str(track_id)],
        )
    except Exception as e:
        print(f"WARNING: Could not log pipeline error: {e}")


def log_api_error(error_msg, stack_trace=None, source=None):
    """Log an API error. Captures request context if available."""
    try:
        from flask import request, session
        from src.models.db import insert_db

        user_id = session.get("user_id")
        username = None
        if user_id:
            from src.utils.decorators import _get_current_user
            user = _get_current_user()
            username = user["username"] if user else None

        insert_db(
            """INSERT INTO error_log
               (error_type, source, error_message, stack_trace,
                request_method, request_path, user_id, username)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                "api",
                source or request.path,
                str(error_msg),
                stack_trace,
                request.method,
                request.path,
                user_id,
                username,
            ],
        )
    except Exception as e:
        print(f"WARNING: Could not log API error: {e}")
