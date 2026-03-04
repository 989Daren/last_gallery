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
SCHEMA_VERSION = 9


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

    # Migration 4: Edit codes table
    if current_version < 4:
        print("Applying migration 4: Edit codes table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS edit_codes (
                email TEXT PRIMARY KEY,
                code TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        _set_schema_version(cursor, 4)
        print("Migration 4 complete: Edit codes table created")

    # Migration 5: Unlocked column on assets
    if current_version < 5:
        print("Applying migration 5: Unlocked column...")
        cursor.execute("PRAGMA table_info(assets)")
        columns = [row[1] for row in cursor.fetchall()]

        if 'unlocked' not in columns:
            cursor.execute("ALTER TABLE assets ADD COLUMN unlocked INTEGER NOT NULL DEFAULT 0")

        _set_schema_version(cursor, 5)
        print("Migration 5 complete: Unlocked column added")

    # Migration 6: Countdown schedule table (singleton)
    if current_version < 6:
        print("Applying migration 6: Countdown schedule table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS countdown_schedule (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                status TEXT NOT NULL DEFAULT 'cleared',
                target_time TEXT,
                start_time TEXT,
                duration_seconds INTEGER NOT NULL DEFAULT 604800,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        cursor.execute("""
            INSERT OR IGNORE INTO countdown_schedule (id, status) VALUES (1, 'cleared')
        """)
        _set_schema_version(cursor, 6)
        print("Migration 6 complete: Countdown schedule table created")

    # Migration 7: Qualified floor + Stripe payment ID columns
    if current_version < 7:
        print("Applying migration 7: Qualified floor columns...")
        cursor.execute("PRAGMA table_info(assets)")
        columns = [row[1] for row in cursor.fetchall()]

        if 'qualified_floor' not in columns:
            cursor.execute("ALTER TABLE assets ADD COLUMN qualified_floor TEXT NOT NULL DEFAULT 'xs'")
        if 'stripe_payment_id' not in columns:
            cursor.execute("ALTER TABLE assets ADD COLUMN stripe_payment_id TEXT")

        _set_schema_version(cursor, 7)
        print("Migration 7 complete: Qualified floor columns added")

    # Migration 8: Purchase history table for Stripe audit trail
    if current_version < 8:
        print("Applying migration 8: Purchase history table...")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS purchase_history (
                purchase_id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_id INTEGER NOT NULL,
                email TEXT NOT NULL DEFAULT '',
                tier TEXT NOT NULL DEFAULT '',
                amount_cents INTEGER NOT NULL DEFAULT 0,
                stripe_session_id TEXT,
                stripe_payment_intent TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                fulfilled_at TEXT,
                FOREIGN KEY(asset_id) REFERENCES assets(asset_id) ON DELETE CASCADE
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_purchase_history_asset_id
            ON purchase_history(asset_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_purchase_history_session_id
            ON purchase_history(stripe_session_id)
        """)
        _set_schema_version(cursor, 8)
        print("Migration 8 complete: Purchase history table created")

    # Migration 9: Asset type column (artwork vs info)
    if current_version < 9:
        print("Applying migration 9: Asset type column...")
        cursor.execute("PRAGMA table_info(assets)")
        columns = [row[1] for row in cursor.fetchall()]

        if 'asset_type' not in columns:
            cursor.execute("ALTER TABLE assets ADD COLUMN asset_type TEXT NOT NULL DEFAULT 'artwork'")

        _set_schema_version(cursor, 9)
        print("Migration 9 complete: Asset type column added")

    conn.commit()
    conn.close()

    print(f"Database initialized: schema version {SCHEMA_VERSION}")
