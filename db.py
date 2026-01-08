"""
Database module for The Last Gallery.

Provides SQLite connection management and schema initialization.
"""
import sqlite3
import os

# Database file path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "gallery.db")


def get_db():
    """
    Returns a SQLite connection to data/gallery.db.
    
    - Sets row_factory to sqlite3.Row for dict-like access
    - Enables foreign key constraints
    - Creates data/ directory if it doesn't exist
    """
    # Ensure data directory exists
    os.makedirs(DATA_DIR, exist_ok=True)
    
    # Connect to database
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    # Enable foreign key constraints
    conn.execute("PRAGMA foreign_keys = ON")
    
    return conn


def init_db():
    """
    Initialize database schema.
    
    Creates assets and tiles tables if they don't exist.
    If old schema exists, drops and recreates tables with new schema.
    Safe to run repeatedly.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    # Enable foreign keys
    cursor.execute("PRAGMA foreign_keys = ON")
    
    # Check if old assets table exists with wrong schema
    cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='assets'")
    result = cursor.fetchone()
    old_schema_detected = False
    
    if result and result[0]:
        # Check if it has the old schema (contains tile_url column)
        if 'tile_url' in result[0]:
            old_schema_detected = True
            print("Old database schema detected - recreating tables with new schema")
            
            # Drop old tables
            cursor.execute("DROP TABLE IF EXISTS tiles")
            cursor.execute("DROP TABLE IF EXISTS assets")
            cursor.execute("DROP TABLE IF EXISTS placements")
            cursor.execute("DROP TABLE IF EXISTS placement_snapshots")
    
    # Create assets table with new schema
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS assets (
            asset_id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist_name TEXT NOT NULL DEFAULT '',
            artwork_title TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    
    # Create tiles table with new schema
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tiles (
            tile_id TEXT PRIMARY KEY,
            asset_id INTEGER NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(asset_id) REFERENCES assets(asset_id) ON DELETE SET NULL
        )
    """)
    
    # Create index on tiles.asset_id
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_tiles_asset_id ON tiles(asset_id)
    """)
    
    conn.commit()
    conn.close()
    
    if old_schema_detected:
        print("Database schema recreated successfully")
    else:
        print("Database initialized: tables created (if not exists)")
