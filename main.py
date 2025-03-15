from src.app import app
import os

if __name__ == "__main__":
    app.run(
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", 5000)),
        debug=bool(os.getenv("DEBUG", True)),
    )
