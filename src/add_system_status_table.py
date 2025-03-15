#!/usr/bin/env python
"""
Utility to add the system_status table to an existing MelodAI database.

This script will add the system_status table to your database without
affecting any existing data.
"""

import sqlite3
import os
from flask import Flask

# Create a minimal Flask app
app = Flask(__name__)
app.config.from_mapping(
    SECRET_KEY='dev',
)

# Database path
DATABASE = os.path.join('src', 'database.db')

def add_system_status_table():
    """Add the system_status table to the database."""
    print("Adding system_status table to the database...")
    
    try:
        # Connect to the database
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()
        
        # Create the system_status table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS system_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            component TEXT NOT NULL,
            status TEXT NOT NULL,
            details TEXT,
            last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            checked_by INTEGER,
            FOREIGN KEY (checked_by) REFERENCES users (id)
        )
        """)
        
        # Commit the changes
        conn.commit()
        
        # Close the connection
        conn.close()
        
        print("✅ system_status table added successfully!")
        
    except Exception as e:
        print(f"❌ Error adding system_status table: {e}")
        return False
    
    return True

def main():
    if not os.path.exists(DATABASE):
        print(f"❌ Database file not found at {DATABASE}")
        print("Please ensure the application has been initialized.")
        return
    
    add_system_status_table()
    print("You may now restart the application.")

if __name__ == "__main__":
    main() 