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

# Current schema version (increment when adding migrations)
SCHEMA_VERSION = 3


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


def _get_schema_version(cursor):
    """Get current schema version from database."""
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    cursor.execute("SELECT MAX(version) FROM schema_version")
    row = cursor.fetchone()
    return row[0] if row[0] is not None else 0


def _set_schema_version(cursor, version):
    """Record that a schema version has been applied."""
    cursor.execute(
        "INSERT INTO schema_version(version) VALUES(?)",
        (version,)
    )


def init_db():
    """
    Initialize database schema.

    Creates tables and runs migrations. Uses version tracking to only
    apply new migrations. Safe to run repeatedly.
    """
    conn = get_db()
    cursor = conn.cursor()

    # Enable foreign keys
    cursor.execute("PRAGMA foreign_keys = ON")

    # Get current schema version
    current_version = _get_schema_version(cursor)

    # Migration 1: Base schema (assets + tiles tables)
    if current_version < 1:
        print("Applying migration 1: Base schema...")
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
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tiles (
                tile_id TEXT PRIMARY KEY,
                asset_id INTEGER NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY(asset_id) REFERENCES assets(asset_id) ON DELETE SET NULL
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_tiles_asset_id ON tiles(asset_id)
        """)
        _set_schema_version(cursor, 1)
        print("Migration 1 complete: Base schema created")

    # Migration 2: Extended metadata fields
    if current_version < 2:
        print("Applying migration 2: Extended metadata fields...")
        cursor.execute("PRAGMA table_info(assets)")
        columns = [row[1] for row in cursor.fetchall()]

        new_columns = [
            ('year_created', "TEXT NOT NULL DEFAULT ''"),
            ('medium', "TEXT NOT NULL DEFAULT ''"),
            ('dimensions', "TEXT NOT NULL DEFAULT ''"),
            ('edition_info', "TEXT NOT NULL DEFAULT ''"),
            ('for_sale', "TEXT NOT NULL DEFAULT ''"),
            ('sale_type', "TEXT NOT NULL DEFAULT ''"),
            ('artist_contact', "TEXT NOT NULL DEFAULT ''"),
        ]
        for col_name, col_def in new_columns:
            if col_name not in columns:
                cursor.execute(f"ALTER TABLE assets ADD COLUMN {col_name} {col_def}")

        _set_schema_version(cursor, 2)
        print("Migration 2 complete: Extended metadata fields added")

    # Migration 3: Contact info fields (type + value for up to 2 contacts)
    if current_version < 3:
        print("Applying migration 3: Contact info fields...")
        cursor.execute("PRAGMA table_info(assets)")
        columns = [row[1] for row in cursor.fetchall()]

        new_columns = [
            ('contact1_type', "TEXT NOT NULL DEFAULT ''"),
            ('contact1_value', "TEXT NOT NULL DEFAULT ''"),
            ('contact2_type', "TEXT NOT NULL DEFAULT ''"),
            ('contact2_value', "TEXT NOT NULL DEFAULT ''"),
        ]
        for col_name, col_def in new_columns:
            if col_name not in columns:
                cursor.execute(f"ALTER TABLE assets ADD COLUMN {col_name} {col_def}")

        _set_schema_version(cursor, 3)
        print("Migration 3 complete: Contact info fields added")

    conn.commit()
    conn.close()

    print(f"Database initialized: schema version {SCHEMA_VERSION}")
