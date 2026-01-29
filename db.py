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
    Adds missing columns for migration. Safe to run repeatedly.
    """
    conn = get_db()
    cursor = conn.cursor()

    # Enable foreign keys
    cursor.execute("PRAGMA foreign_keys = ON")

    # Create assets table (single source of truth for all asset data)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS assets (
            asset_id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist_name TEXT NOT NULL DEFAULT '',
            artwork_title TEXT NOT NULL DEFAULT '',
            tile_url TEXT NOT NULL DEFAULT '',
            popup_url TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)

    # Add URL columns if missing (migration for existing databases)
    cursor.execute("PRAGMA table_info(assets)")
    columns = [row[1] for row in cursor.fetchall()]
    if 'tile_url' not in columns:
        cursor.execute("ALTER TABLE assets ADD COLUMN tile_url TEXT NOT NULL DEFAULT ''")
        print("Added tile_url column to assets table")
    if 'popup_url' not in columns:
        cursor.execute("ALTER TABLE assets ADD COLUMN popup_url TEXT NOT NULL DEFAULT ''")
        print("Added popup_url column to assets table")

    # Create tiles table
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

    print("Database initialized: schema ready")
