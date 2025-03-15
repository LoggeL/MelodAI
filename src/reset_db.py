#!/usr/bin/env python
"""
Database Reset Utility for MelodAI

This script will reset the database, recreating all tables according to the current schema.
It makes a backup of the existing database before resetting.

WARNING: Running this script will delete all data in the database!
"""

import os
import sys
from flask import Flask

# Create a minimal Flask app
app = Flask(__name__)
app.config.from_mapping(
    SECRET_KEY='dev',
)

# Import after app creation to avoid circular imports
from models.db import init_app, reset_db

# Initialize the app with database
init_app(app)

def main():
    print("⚠️ WARNING: This will delete all data in the database! ⚠️")
    print("A backup will be created, but all current data will be lost.")
    print("")
    
    confirmation = input("Type 'RESET' to confirm database reset: ")
    
    if confirmation.strip() != "RESET":
        print("Database reset cancelled.")
        return
    
    with app.app_context():
        reset_db()
    
    print("✅ Database has been reset successfully.")
    print("You may now restart the application.")

if __name__ == "__main__":
    main() 