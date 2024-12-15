from src.app import app
from src.utils.extensions import socketio
import os

if __name__ == "__main__":
    socketio.run(
        app,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", 5000)),
        debug=bool(os.getenv("DEBUG", True)),
        allow_unsafe_werkzeug=True,
    )
