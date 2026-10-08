from src.app import create_app

app = create_app()

if __name__ == "__main__":
    import os
    import signal
    import sys

    # In the container this process is PID 1, which ignores SIGTERM unless a handler is installed.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("DEBUG", "False").lower() == "true"
    app.run(host=host, port=port, debug=debug)
