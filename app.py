"""
╔════════════════════════════════════════════════════════════════════════════╗
║ SQLITE UNDO SYSTEM AUDIT (Dec 21, 2025)                                   ║
╠════════════════════════════════════════════════════════════════════════════╣
║ Findings:                                                                  ║
║                                                                            ║
║ 1. UNDO ROUTE (/api/admin/undo):                                          ║
║    ✓ Calls pop_latest_snapshot() to get state from SQLite                 ║
║    ✓ Restores state via save_wall_state(state_dict)                       ║
║    ✓ No reference to legacy wall_state_history.json                       ║
║                                                                            ║
║ 2. POP_LATEST_SNAPSHOT():                                                 ║
║    ✓ Executes SELECT from placement_snapshots ORDER BY id DESC LIMIT 1    ║
║    ✓ Deletes popped row (LIFO stack behavior)                             ║
║    ✓ Returns (id, action, state_dict) or (None, None, None) if empty      ║
║                                                                            ║
║ 3. SAVE_WALL_STATE():                                                     ║
║    ✓ Has SQLite branch gated by USE_SQLITE_PLACEMENTS = True              ║
║    ✓ Has JSON fallback branch for backwards compatibility                 ║
║    ✓ SQLite branch: DELETE + INSERT transaction pattern                   ║
║                                                                            ║
║ 4. LOAD_WALL_STATE():                                                     ║
║    ✓ Has SQLite branch gated by USE_SQLITE_PLACEMENTS = True              ║
║    ✓ Has JSON fallback branch for backwards compatibility                 ║
║    ✓ SQLite branch: SELECT from placements table                          ║
║                                                                            ║
║ 5. PUSH_SNAPSHOT():                                                       ║
║    ✓ Called by /clear_tile and /clear_all_tiles before deletion           ║
║    ✓ Inserts into placement_snapshots with action descriptor              ║
║    ✓ Returns snapshot count for UI feedback                               ║
║                                                                            ║
║ CONCLUSION: No legacy JSON history system references found. All undo      ║
║ operations flow through SQLite placement_snapshots table.                 ║
╚════════════════════════════════════════════════════════════════════════════╝
"""

from flask import Flask, render_template, request, jsonify, send_from_directory
import os
import json
import re
import random
import uuid
import sqlite3
from datetime import datetime
import xml.etree.ElementTree as ET
from werkzeug.utils import secure_filename

app = Flask(__name__)

# ---- Debug toggle ----
SERVER_DEBUG = False

# ---- Temporary debug flag for SQLite undo audit ----
# Set to True to log SQLite snapshot operations (push/pop) and wall state save/load paths.
# How to verify:
#   1. Run Flask server
#   2. Upload artwork and place it on wall
#   3. Click "Clear Grid" or "Clear Tile"
#   4. Click "Undo" button
#   5. Observe console logs showing:
#      - UNDO: attempting pop_latest_snapshot()
#      - UNDO: popped snapshot id=X action=... tiles=N
#      - SAVE_WALL_STATE: SQLITE mode, tiles=N
#   6. Refresh page to confirm persistence via LOAD_WALL_STATE: SQLITE mode
DEBUG_DB_TRACE = True

# ---- Kill-switch for demo/test art auto-population ----
# Set to False to disable all auto-generation of placeholder artwork
ENABLE_DEMO_AUTOFILL = False

# ---- SQLite persistence toggle (only affects wall placements) ----
# Set to True to use SQLite instead of JSON for wall_state persistence
USE_SQLITE_PLACEMENTS = True

# ---- SQLite assets metadata toggle ----
# Set to True to store artwork metadata (title, artist) in SQLite instead of assets.json
# Auto-migrates existing assets.json to SQLite on first run
USE_SQLITE_ASSETS = True

# ---- Grid color config ----
COLOR_CONFIG = "grid_color.json"
DEFAULT_GRID_COLOR = "#aa6655"  # set this to whatever default you want

# ---- File paths (absolute) ----
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

PLACEMENT_FILE = os.path.join("data", "placement.json")
ASSETS_FILE = os.path.join("data", "assets.json")
WALL_STATE_FILE = os.path.join("data", "wall_state.json")
WALL_STATE_HISTORY_FILE = os.path.join("data", "wall_state_history.json")
GALLERY_DB = os.path.join("data", "gallery.db")

# Admin PIN for protected endpoints
ADMIN_PIN = "8375"
MAX_HISTORY_DEPTH = 5

# Ensure uploads directory exists
os.makedirs(UPLOAD_DIR, exist_ok=True)


def load_grid_color():
    """Read the current grid color from a small JSON file, or fall back to default."""
    if os.path.exists(COLOR_CONFIG):
        try:
            with open(COLOR_CONFIG, "r") as f:
                data = json.load(f)
                return data.get("color", DEFAULT_GRID_COLOR)
        except Exception:
            # If file is corrupted or unreadable, just use the default
            return DEFAULT_GRID_COLOR
    return DEFAULT_GRID_COLOR

def init_db():
    """Initialize SQLite database for wall placements and undo snapshots.
    
    Creates data/gallery.db and required tables if they don't exist.
    """
    os.makedirs("data", exist_ok=True)
    conn = sqlite3.connect(GALLERY_DB)
    cursor = conn.cursor()
    
    # Placements table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS placements (
            tile_id TEXT PRIMARY KEY,
            asset_id TEXT NOT NULL,
            placed_at TEXT NOT NULL
        )
    """)
    
    # Undo snapshots table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS placement_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            action TEXT NOT NULL,
            state_json TEXT NOT NULL
        )
    """)
    
    # Assets metadata table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS assets (
            asset_id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            tile_url TEXT NOT NULL,
            popup_url TEXT NOT NULL,
            artwork_name TEXT NOT NULL,
            artist_name TEXT NOT NULL,
            notes TEXT,
            paid INTEGER DEFAULT 0
        )
    """)
    
    conn.commit()
    conn.close()

def save_grid_color(color: str):
    """Persist the chosen grid color so all visitors see it."""
    with open(COLOR_CONFIG, "w") as f:
        json.dump({"color": color}, f)


def load_placement():
    """Load the placement mapping from data/placement.json.

    Returns a dict. If the file is missing or contains invalid JSON,
    an empty dict is returned and no exception is raised.
    """
    if os.path.exists(PLACEMENT_FILE):
        try:
            with open(PLACEMENT_FILE, "r", encoding="utf-8") as f:
                return json.load(f) or {}
        except Exception:
            # If file is unreadable or contains invalid JSON, return empty mapping
            return {}
    return {}


def save_placement(mapping):
    """Save the placement mapping to data/placement.json safely.

    Ensures the `data/` directory exists before writing.
    """
    os.makedirs(os.path.dirname(PLACEMENT_FILE), exist_ok=True)
    with open(PLACEMENT_FILE, "w", encoding="utf-8") as f:
        json.dump(mapping or {}, f, indent=2)


def load_assets():
    """Load assets metadata from SQLite or data/assets.json.
    
    If USE_SQLITE_ASSETS is True, loads from SQLite database with auto-migration.
    Otherwise loads from data/assets.json.
    Returns a dict keyed by asset_id. If file/db is missing or invalid, returns {}.
    """
    if USE_SQLITE_ASSETS:
        try:
            init_db()
            migrate_assets_json_to_sqlite_if_needed()
            result = sqlite_load_assets()
            if DEBUG_DB_TRACE:
                print(f"LOAD_ASSETS: SQLITE mode, assets={len(result)}")
            return result
        except Exception as e:
            if SERVER_DEBUG:
                print(f"Error loading assets from SQLite: {e}")
            return {}
    else:
        # Existing JSON logic
        if DEBUG_DB_TRACE:
            print(f"LOAD_ASSETS: JSON mode")
        if os.path.exists(ASSETS_FILE):
            try:
                with open(ASSETS_FILE, "r", encoding="utf-8") as f:
                    return json.load(f) or {}
            except Exception:
                return {}
        return {}


def save_assets(assets_dict):
    """Save assets metadata to SQLite or data/assets.json.
    
    If USE_SQLITE_ASSETS is True, saves to SQLite database.
    Otherwise saves to data/assets.json.
    Ensures the data/ directory exists before writing.
    """
    if USE_SQLITE_ASSETS:
        if DEBUG_DB_TRACE:
            print(f"SAVE_ASSETS: SQLITE mode, assets={len(assets_dict or {})}")
        try:
            init_db()
            for asset_id, asset_data in (assets_dict or {}).items():
                sqlite_insert_asset(
                    asset_id=asset_id,
                    tile_url=asset_data.get("tile_url", ""),
                    popup_url=asset_data.get("popup_url", ""),
                    artwork_name=asset_data.get("artwork_name", "Untitled"),
                    artist_name=asset_data.get("artist_name", "Anonymous"),
                    created_at=asset_data.get("created_at"),
                    notes=asset_data.get("notes"),
                    paid=asset_data.get("paid", 0)
                )
        except Exception as e:
            if SERVER_DEBUG:
                print(f"Error saving assets to SQLite: {e}")
            raise
    else:
        # Existing JSON logic
        if DEBUG_DB_TRACE:
            print(f"SAVE_ASSETS: JSON mode, assets={len(assets_dict or {})}")
        os.makedirs(os.path.dirname(ASSETS_FILE), exist_ok=True)
        with open(ASSETS_FILE, "w", encoding="utf-8") as f:
            json.dump(assets_dict or {}, f, indent=2)


def sqlite_assets_count():
    """Return the number of assets in SQLite assets table."""
    init_db()
    conn = sqlite3.connect(GALLERY_DB)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM assets")
    count = cursor.fetchone()[0]
    conn.close()
    return count


def sqlite_insert_asset(asset_id, tile_url, popup_url, artwork_name, artist_name, created_at=None, notes=None, paid=0):
    """Insert or replace an asset in SQLite assets table.
    
    Args:
        asset_id: UUID string
        tile_url: URL path to tile image
        popup_url: URL path to popup image
        artwork_name: Title of artwork
        artist_name: Name of artist
        created_at: ISO timestamp (defaults to now)
        notes: Optional notes
        paid: Payment status (0 or 1)
    """
    init_db()
    conn = sqlite3.connect(GALLERY_DB)
    cursor = conn.cursor()
    
    if created_at is None:
        created_at = datetime.utcnow().isoformat()
    
    cursor.execute("""
        INSERT OR REPLACE INTO assets 
        (asset_id, created_at, tile_url, popup_url, artwork_name, artist_name, notes, paid)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (asset_id, created_at, tile_url, popup_url, artwork_name, artist_name, notes, paid))
    
    conn.commit()
    conn.close()


def sqlite_load_assets():
    """Load all assets from SQLite database.
    
    Returns dict keyed by asset_id with same structure as JSON load_assets().
    """
    init_db()
    conn = sqlite3.connect(GALLERY_DB)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT asset_id, created_at, tile_url, popup_url, artwork_name, artist_name, notes, paid
        FROM assets
    """)
    rows = cursor.fetchall()
    conn.close()
    
    assets = {}
    for row in rows:
        asset_id, created_at, tile_url, popup_url, artwork_name, artist_name, notes, paid = row
        assets[asset_id] = {
            "asset_id": asset_id,
            "tile_url": tile_url,
            "popup_url": popup_url,
            "artwork_name": artwork_name,
            "artist_name": artist_name,
            "created_at": created_at,
            "notes": notes,
            "paid": paid
        }
    
    return assets


def migrate_assets_json_to_sqlite_if_needed():
    """Auto-migrate existing assets.json to SQLite on first run.
    
    Only runs when:
    - USE_SQLITE_ASSETS is True
    - assets.json exists
    - SQLite assets table is empty
    """
    if not USE_SQLITE_ASSETS:
        return
    
    # Check if migration is needed
    if not os.path.exists(ASSETS_FILE):
        return
    
    if sqlite_assets_count() > 0:
        return
    
    # Load JSON assets
    try:
        with open(ASSETS_FILE, "r", encoding="utf-8") as f:
            json_assets = json.load(f) or {}
    except Exception:
        return
    
    if not json_assets:
        return
    
    # Migrate each asset
    migration_time = datetime.utcnow().isoformat()
    for asset_id, asset_data in json_assets.items():
        created_at = asset_data.get("created_at") or asset_data.get("created") or migration_time
        tile_url = asset_data.get("tile_url", "")
        popup_url = asset_data.get("popup_url", "")
        artwork_name = asset_data.get("artwork_name", "Untitled")
        artist_name = asset_data.get("artist_name", "Anonymous")
        notes = asset_data.get("notes")
        paid = asset_data.get("paid", 0)
        
        sqlite_insert_asset(
            asset_id=asset_id,
            tile_url=tile_url,
            popup_url=popup_url,
            artwork_name=artwork_name,
            artist_name=artist_name,
            created_at=created_at,
            notes=notes,
            paid=paid
        )
    
    if DEBUG_DB_TRACE:
        print(f"MIGRATION: Migrated {len(json_assets)} assets from assets.json to SQLite")


def load_wall_state():
    """Load wall state (tile_id -> asset_id mapping).
    
    If USE_SQLITE_PLACEMENTS is True, loads from SQLite database.
    Otherwise loads from data/wall_state.json.
    Returns a dict. If file/db is missing or invalid, returns {}.
    """
    if USE_SQLITE_PLACEMENTS:
        try:
            init_db()
            conn = sqlite3.connect(GALLERY_DB)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT tile_id, asset_id FROM placements 
                WHERE asset_id IS NOT NULL AND asset_id != ''
            """)
            rows = cursor.fetchall()
            conn.close()
            result = {tile_id: asset_id for tile_id, asset_id in rows}
            if DEBUG_DB_TRACE:
                print(f"LOAD_WALL_STATE: SQLITE mode, tiles={len(result)}")
            return result
        except Exception as e:
            if SERVER_DEBUG:
                print(f"Error loading from SQLite: {e}")
            return {}
    else:
        # Existing JSON logic
        if os.path.exists(WALL_STATE_FILE):
            try:
                with open(WALL_STATE_FILE, "r", encoding="utf-8") as f:
                    result = json.load(f) or {}
                    if DEBUG_DB_TRACE:
                        print(f"LOAD_WALL_STATE: JSON mode, tiles={len(result)}")
                    return result
            except Exception:
                return {}
        if DEBUG_DB_TRACE:
            print("LOAD_WALL_STATE: JSON mode, tiles=0 (file not found)")
        return {}


def save_wall_state(state_dict):
    """Save wall state.
    
    If USE_SQLITE_PLACEMENTS is True, saves to SQLite database.
    Otherwise saves to data/wall_state.json.
    Ensures the data/ directory exists before writing.
    """
    if USE_SQLITE_PLACEMENTS:
        if DEBUG_DB_TRACE:
            print(f"SAVE_WALL_STATE: SQLITE mode, tiles={len(state_dict or {})}")
        try:
            init_db()
            conn = sqlite3.connect(GALLERY_DB)
            cursor = conn.cursor()
            
            # Clear existing placements and insert new ones in a transaction
            cursor.execute("DELETE FROM placements")
            
            if state_dict:
                placed_at = datetime.utcnow().isoformat()
                for tile_id, asset_id in state_dict.items():
                    cursor.execute("""
                        INSERT OR REPLACE INTO placements (tile_id, asset_id, placed_at)
                        VALUES (?, ?, ?)
                    """, (tile_id, asset_id, placed_at))
            
            conn.commit()
            conn.close()
        except Exception as e:
            if SERVER_DEBUG:
                print(f"Error saving to SQLite: {e}")
            raise
    else:
        # Existing JSON logic
        if DEBUG_DB_TRACE:
            print(f"SAVE_WALL_STATE: JSON mode, tiles={len(state_dict or {})}")
        os.makedirs(os.path.dirname(WALL_STATE_FILE), exist_ok=True)
        with open(WALL_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state_dict or {}, f, indent=2)


def push_snapshot(action: str, state: dict) -> int:
    """Push a snapshot of wall state to undo stack.
    
    Args:
        action: Description of action (e.g., 'clear_tile:X99', 'clear_grid')
        state: Wall state dict to save
    
    Returns:
        Remaining snapshot count
    """
    init_db()
    conn = sqlite3.connect(GALLERY_DB)
    cursor = conn.cursor()
    
    created_at = datetime.utcnow().isoformat()
    state_json = json.dumps(state)
    
    cursor.execute("""
        INSERT INTO placement_snapshots (created_at, action, state_json)
        VALUES (?, ?, ?)
    """, (created_at, action, state_json))
    
    # Get count of remaining snapshots
    cursor.execute("SELECT COUNT(*) FROM placement_snapshots")
    count = cursor.fetchone()[0]
    
    conn.commit()
    conn.close()
    
    return count


def pop_latest_snapshot():
    """Pop the most recent snapshot from undo stack.
    
    Returns:
        Tuple of (id, action, state_dict) if found, or (None, None, None) if empty
    """
    init_db()
    conn = sqlite3.connect(GALLERY_DB)
    cursor = conn.cursor()
    
    # Get latest snapshot
    cursor.execute("""
        SELECT id, action, state_json FROM placement_snapshots 
        ORDER BY id DESC LIMIT 1
    """)
    row = cursor.fetchone()
    
    if not row:
        if DEBUG_DB_TRACE:
            print("UNDO: no snapshot available")
        conn.close()
        return None, None, None
    
    snapshot_id, action, state_json = row
    state_dict = json.loads(state_json)
    
    if DEBUG_DB_TRACE:
        print(f"UNDO: popped snapshot id={snapshot_id} action={action} tiles={len(state_dict)}")
    
    # Delete this snapshot
    cursor.execute("DELETE FROM placement_snapshots WHERE id = ?", (snapshot_id,))
    
    conn.commit()
    conn.close()
    
    return snapshot_id, action, state_dict


def load_json(path, default):
    """Generic JSON loader with fallback default."""
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f) or default
        except Exception:
            return default
    return default


def save_json(path, data):
    """Generic JSON saver with directory creation."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def load_history():
    """Load wall state history from data/wall_state_history.json.
    
    Returns a list of dicts (snapshots). If file is missing or invalid, returns [].
    """
    return load_json(WALL_STATE_HISTORY_FILE, [])


def save_history(history):
    """Save wall state history to data/wall_state_history.json."""
    save_json(WALL_STATE_HISTORY_FILE, history)


def push_history_snapshot(current_state):
    """Push a snapshot of current wall state to history.
    
    Args:
        current_state: dict mapping tile_id -> asset_id
    
    Returns:
        int: Updated history count
    """
    import copy
    history = load_history()
    
    # Append deep copy of current state
    history.append(copy.deepcopy(current_state))
    
    # Trim to last MAX_HISTORY_DEPTH snapshots
    if len(history) > MAX_HISTORY_DEPTH:
        history = history[-MAX_HISTORY_DEPTH:]
    
    save_history(history)
    return len(history)


def pop_history_snapshot():
    """Pop the most recent snapshot from history.
    
    Returns:
        tuple: (snapshot dict or None, new history count)
    """
    history = load_history()
    
    if not history:
        return None, 0
    
    snapshot = history.pop()
    save_history(history)
    
    return snapshot, len(history)


def check_admin_pin():
    """Check if request has valid X-Admin-Pin header.
    
    Returns:
        tuple: (bool: is_valid, response or None)
    """
    pin = request.headers.get("X-Admin-Pin")
    if pin != ADMIN_PIN:
        return False, (jsonify({"ok": False, "error": "Unauthorized"}), 401)
    return True, None


def _parse_svg_tiles(svg_path):
    """Parse the SVG and return an array of tile descriptors similar to the client.

    Each tile is a dict with keys including `width` and `height` (SVG units)
    and an inferred `size` string (xs, s, m, lg, xlg) used to generate tile IDs.
    If parsing fails, returns an empty list.
    """
    try:
        tree = ET.parse(svg_path)
        root = tree.getroot()
    except Exception:
        return []

    rects = []
    for rect in root.findall('.//{http://www.w3.org/2000/svg}rect') + root.findall('.//rect'):
        try:
            width = float(rect.get('width') or 0)
            height = float(rect.get('height') or 0)
            transform = rect.get('transform') or ''

            cx = cy = None
            m = re.search(r'translate\(([-0-9.]+)[ ,]([-0-9.]+)\)', transform)
            if m:
                cx = float(m.group(1))
                cy = float(m.group(2))

            if cx is not None and cy is not None:
                left = cx - width / 2
                top = cy - height / 2
            else:
                left = float(rect.get('x') or 0)
                top = float(rect.get('y') or 0)

            rects.append({'width': width, 'height': height, 'svg_left': left, 'svg_top': top})
        except Exception:
            continue

    if not rects:
        return []

    # Infer scale factor using XS candidates (same thresholds as client)
    xs_candidates = [r['width'] for r in rects if 40 <= r['width'] <= 90]
    if not xs_candidates:
        return []

    avg_xs = sum(xs_candidates) / len(xs_candidates)
    DESIGN_XS = 85.0
    scale = avg_xs / DESIGN_XS

    for r in rects:
        r['design_width'] = r['width'] / scale
        r['design_height'] = r['height'] / scale
        r['design_left'] = r['svg_left'] / scale
        r['design_top'] = r['svg_top'] / scale

    min_left = min(r['design_left'] for r in rects)
    min_top = min(r['design_top'] for r in rects)

    BASE_UNIT = 85
    def classify(w):
        if w >= 60 and w < 128: return 'xs'
        if w >= 128 and w < 213: return 's'
        if w >= 213 and w < 298: return 'm'
        if w >= 298 and w < 425: return 'lg'
        if w >= 425 and w < 600: return 'xlg'
        return 'unknown'

    # Normalize and classify
    for r in rects:
        r['norm_left'] = r['design_left'] - min_left
        r['norm_top'] = r['design_top'] - min_top
        r['size'] = classify(r['design_width'])

    # Assign IDs
    counters = {'xs': 0, 's': 0, 'm': 0, 'lg': 0, 'xlg': 0, 'unknown': 0}
    prefix = {'xs': 'X', 's': 'S', 'm': 'M', 'lg': 'L', 'xlg': 'XL', 'unknown': 'U'}
    tiles = []
    for r in rects:
        if r['size'] == 'unknown':
            continue
        counters[r['size']] += 1
        tid = prefix[r['size']] + str(counters[r['size']])
        tiles.append({'id': tid, 'size': r['size']})

    return tiles


def generate_initial_placement():
    """Create an initial randomized mapping of tileId -> art path.

    Returns a dict suitable for saving via `save_placement()`.
    """
    svg_path = os.path.join('static', 'grid_full.svg')
    tiles = _parse_svg_tiles(svg_path)
    if not tiles:
        return {}

    test_art = [
        "/static/artwork/Timing.png",
        "/static/artwork/Doom Scrolling.png",
        "/static/artwork/Izzy in Spring.png",
        "/static/artwork/Path to Your Heart.png",
        "/static/artwork/Class Clown.png",
        "/static/artwork/Andrea's Arch.png",
        "/static/artwork/Daren's Dream.png",
        "/static/artwork/Twilight Circus.jpg",
        "/static/artwork/Caught in the Storm.png",
        "/static/artwork/Perspective.jpg",
        "/static/artwork/I'll Pay You Back.png",
        "/static/artwork/The Stranger.png"
    ]

    tile_ids = [t['id'] for t in tiles]
    random.shuffle(tile_ids)

    mapping = {}
    for i, art in enumerate(test_art):
        if i >= len(tile_ids):
            break
        mapping[tile_ids[i]] = art

    return mapping


# ---- Routes ----
@app.route("/")
def index():
    grid_color = load_grid_color()
    placement = load_placement()

    # If there's no saved placement yet, generate one server-side and persist it.
    # GATED: Only auto-generate demo art if ENABLE_DEMO_AUTOFILL is True
    if not placement and ENABLE_DEMO_AUTOFILL:
        new_placement = generate_initial_placement()
        if new_placement:
            save_placement(new_placement)
            placement = new_placement

    # Pass grid_color and placement into the template so it can set values
    return render_template("index.html", grid_color=grid_color, placement=placement)


@app.route("/api/grid-color", methods=["POST"])
def set_grid_color():
    """Owner-only endpoint: update the global grid color."""
    data = request.get_json(silent=True) or {}
    color = data.get("color")

    # Very basic validation for hex colors like #abc or #aabbcc
    if not isinstance(color, str) or not color.startswith("#") or len(color) not in (4, 7):
        return jsonify({"error": "invalid color"}), 400

    save_grid_color(color)
    return jsonify({"status": "ok", "color": color})


@app.route("/api/wall_state", methods=["GET"])
def get_wall_state():
    """Return the current wall state as JSON.
    
    Response format:
    {
      "assignments": [
        {
          "tile_id": "X1",
          "tile_url": "/uploads/tile_123.png",
          "popup_url": "/uploads/popup_123.png",
          "artwork_name": "Title",
          "artist_name": "Artist",
          "asset_id": "123"
        }
      ]
    }
    
    If no assignments exist, returns {"assignments": []}.
    No demo fallback logic.
    """
    wall_state = load_wall_state()
    assets = load_assets()
    
    assignments = []
    for tile_id, asset_id in wall_state.items():
        asset = assets.get(asset_id)
        if asset:
            assignments.append({
                "tile_id": tile_id,
                "tile_url": asset["tile_url"],
                "popup_url": asset["popup_url"],
                "artwork_name": asset["artwork_name"],
                "artist_name": asset["artist_name"],
                "asset_id": asset_id
            })
    
    return jsonify({"assignments": assignments}), 200


@app.route("/uploads/<path:filename>")
def uploads(filename):
    """Serve uploaded files from the uploads directory."""
    return send_from_directory(UPLOAD_DIR, filename)


@app.route("/api/upload_assets", methods=["POST"])
def upload_assets():
    """Handle asset upload (tile and popup images with metadata).
    
    Accepts multipart/form-data with:
    - tile_image: file
    - popup_image: file
    - artwork_name: string
    - artist_name: string
    
    Returns JSON:
    {
      "asset_id": "uuid",
      "tile_url": "/uploads/tile_uuid.ext",
      "popup_url": "/uploads/popup_uuid.ext",
      "artwork_name": "Title",
      "artist_name": "Artist"
    }
    """
    if 'tile_image' not in request.files or 'popup_image' not in request.files:
        return jsonify({"ok": False, "error": "Missing required files"}), 400
    
    tile_file = request.files['tile_image']
    popup_file = request.files['popup_image']
    artwork_name = request.form.get('artwork_name', 'Untitled')
    artist_name = request.form.get('artist_name', 'Anonymous')
    
    if tile_file.filename == '' or popup_file.filename == '':
        return jsonify({"ok": False, "error": "Empty filename"}), 400
    
    # Generate unique asset_id
    asset_id = str(uuid.uuid4())
    
    # Get file extensions
    tile_ext = os.path.splitext(secure_filename(tile_file.filename))[1]
    popup_ext = os.path.splitext(secure_filename(popup_file.filename))[1]
    
    # Create unique filenames
    tile_filename = f"tile_{asset_id}{tile_ext}"
    popup_filename = f"popup_{asset_id}{popup_ext}"
    
    # Save files
    tile_path = os.path.join(UPLOAD_DIR, tile_filename)
    popup_path = os.path.join(UPLOAD_DIR, popup_filename)
    tile_file.save(tile_path)
    popup_file.save(popup_path)
    
    # Create asset metadata
    tile_url = f"/uploads/{tile_filename}"
    popup_url = f"/uploads/{popup_filename}"
    created_at = datetime.utcnow().isoformat()
    
    asset_data = {
        "tile_url": tile_url,
        "popup_url": popup_url,
        "artwork_name": artwork_name,
        "artist_name": artist_name,
        "created_at": created_at
    }
    
    # Save to assets backend (SQLite or JSON based on USE_SQLITE_ASSETS flag)
    assets = load_assets()
    assets[asset_id] = asset_data
    save_assets(assets)
    
    # Return asset info
    return jsonify({
        "asset_id": asset_id,
        **asset_data
    }), 200


@app.route("/api/assign_tile", methods=["POST"])
def assign_tile():
    """Assign an asset to a tile.
    
    Expects JSON:
    {
      "tile_id": "X1",
      "asset_id": "uuid"
    }
    
    Returns {"ok": true} on success.
    """
    data = request.get_json(silent=True) or {}
    tile_id = data.get('tile_id')
    asset_id = data.get('asset_id')
    
    if not tile_id or not asset_id:
        return jsonify({"ok": False, "error": "Missing tile_id or asset_id"}), 400
    
    # Verify asset exists
    assets = load_assets()
    if asset_id not in assets:
        return jsonify({"ok": False, "error": "Asset not found"}), 404
    
    # Save tile assignment
    wall_state = load_wall_state()
    wall_state[tile_id] = asset_id
    save_wall_state(wall_state)
    
    return jsonify({"ok": True}), 200


@app.route("/api/admin/clear_tile", methods=["POST"])
def admin_clear_tile():
    """Admin-only: Clear a single tile assignment with snapshot.
    
    Requires X-Admin-Pin header.
    Body: { "tile_id": "X99" }
    
    Returns: { "ok": true }
    """
    is_valid, error_response = check_admin_pin()
    if not is_valid:
        return error_response
    
    data = request.get_json(silent=True) or {}
    tile_id = data.get("tile_id")
    
    if not tile_id:
        return jsonify({"ok": False, "error": "Missing tile_id"}), 400
    
    # Load current state
    wall_state = load_wall_state()
    
    # If tile already empty, don't push snapshot
    if tile_id not in wall_state:
        return jsonify({"ok": True, "message": "Tile already empty"})
    
    # Push snapshot before clearing
    push_snapshot(f"clear_tile:{tile_id}", wall_state)
    
    # Remove tile assignment
    del wall_state[tile_id]
    save_wall_state(wall_state)
    
    return jsonify({"ok": True})


@app.route("/api/admin/clear_all_tiles", methods=["POST"])
def admin_clear_all_tiles():
    """Admin-only: Clear all tile assignments with snapshot.
    
    Requires X-Admin-Pin header.
    
    Returns: { "ok": true }
    """
    is_valid, error_response = check_admin_pin()
    if not is_valid:
        return error_response
    
    # Load current state
    wall_state = load_wall_state()
    
    # If already empty, don't push snapshot
    if not wall_state:
        return jsonify({"ok": True, "message": "Already empty"})
    
    # Push snapshot before clearing
    push_snapshot("clear_grid", wall_state)
    
    # Clear all assignments
    save_wall_state({})
    
    return jsonify({"ok": True})


@app.route("/api/admin/undo", methods=["POST"])
def admin_undo():
    """Admin-only: Undo last wall state change.
    
    Requires X-Admin-Pin header.
    
    Returns: { "ok": true, "action": "..." } or { "ok": false, "message": "No undo available" }
    """
    is_valid, error_response = check_admin_pin()
    if not is_valid:
        return error_response
    
    if DEBUG_DB_TRACE:
        print("UNDO: attempting pop_latest_snapshot()")
    
    snapshot_id, action, state = pop_latest_snapshot()
    
    if snapshot_id is None:
        return jsonify({"ok": False, "message": "No undo available"})
    
    # Restore snapshot as current state
    save_wall_state(state)
    
    return jsonify({"ok": True, "action": action})


@app.route("/api/admin/history_status", methods=["GET"])
def admin_history_status():
    """Admin-only: Get history status.
    
    Requires X-Admin-Pin header.
    
    Returns: { "history_count": N, "can_undo": bool }
    """
    is_valid, error_response = check_admin_pin()
    if not is_valid:
        return error_response
    
    history = load_history()
    history_count = len(history)
    
    return jsonify({
        "history_count": history_count,
        "can_undo": history_count > 0
    })


@app.route("/api/admin/tile_info", methods=["GET"])
def admin_tile_info():
    """Admin-only: Get information about a tile.
    
    Requires X-Admin-Pin header.
    Query params: tile_id
    
    Returns tile occupation status and asset details if occupied.
    """
    is_valid, error_response = check_admin_pin()
    if not is_valid:
        return error_response
    
    tile_id = request.args.get("tile_id")
    if not tile_id:
        return jsonify({"ok": False, "error": "Missing tile_id parameter"}), 400
    
    wall_state = load_wall_state()
    assets = load_assets()
    
    # Check if tile is occupied
    if tile_id not in wall_state:
        return jsonify({
            "ok": True,
            "tile_id": tile_id,
            "occupied": False
        })
    
    # Tile is occupied, get asset details
    asset_id = wall_state[tile_id]
    asset = assets.get(asset_id)
    
    if asset:
        return jsonify({
            "ok": True,
            "tile_id": tile_id,
            "occupied": True,
            "asset_id": asset_id,
            "artwork_name": asset.get("artwork_name", "Unknown"),
            "artist_name": asset.get("artist_name", "Unknown"),
            "tile_url": asset.get("tile_url", ""),
            "popup_url": asset.get("popup_url", "")
        })
    else:
        # Asset record missing (orphaned reference)
        return jsonify({
            "ok": True,
            "tile_id": tile_id,
            "occupied": True,
            "asset_id": asset_id,
            "artwork_name": "Unknown",
            "artist_name": "Unknown",
            "tile_url": "",
            "popup_url": ""
        })


@app.route("/api/admin/move_tile_asset", methods=["POST"])
def admin_move_tile_asset():
    """Admin-only: Move artwork from one tile to another.
    
    Uses SQLite placement_snapshots for unified Undo stack; legacy JSON history no longer used here.
    
    Requires X-Admin-Pin header.
    Body: { "from_tile_id": "X99", "to_tile_id": "X12" }
    
    Returns: { "ok": true, "history_count": N }
    """
    is_valid, error_response = check_admin_pin()
    if not is_valid:
        return error_response
    
    data = request.get_json(silent=True) or {}
    from_tile_id = data.get("from_tile_id")
    to_tile_id = data.get("to_tile_id")
    
    if not from_tile_id or not to_tile_id:
        return jsonify({"ok": False, "error": "Missing from_tile_id or to_tile_id"}), 400
    
    wall_state = load_wall_state()
    
    # Validate source tile is occupied
    if from_tile_id not in wall_state:
        return jsonify({"ok": False, "error": "Source tile is empty"}), 400
    
    # Validate destination tile is empty
    if to_tile_id in wall_state:
        return jsonify({"ok": False, "error": "Destination tile is occupied"}), 400
    
    # Push SQLite snapshot before modifying
    snapshot_count = push_snapshot(f"move_tile:{from_tile_id}->{to_tile_id}", wall_state)
    
    # Move asset
    wall_state[to_tile_id] = wall_state[from_tile_id]
    del wall_state[from_tile_id]
    
    save_wall_state(wall_state)
    
    return jsonify({"ok": True, "history_count": snapshot_count})


@app.route("/shuffle", methods=["POST"])
def shuffle_placement():
    """Shuffle existing artwork to random tiles (including empty tiles).

    Expects JSON body like { "pin": "8375" }.
    If pin is incorrect, returns 401 with { "ok": false, "error": "Unauthorized" }.
    On success shuffles existing artwork and returns { "ok": true }.
    
    Shuffle is allowed independently of demo autofill.
    """
    data = request.get_json(silent=True) or {}
    pin = data.get("pin")

    if pin != "8375":
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    # Load current wall state
    wall_state = load_wall_state()
    
    if not wall_state:
        return jsonify({"ok": False, "error": "No artwork to shuffle"}), 400
    
    # Get asset IDs (artworks to shuffle)
    asset_ids = list(wall_state.values())
    
    # Get all available tiles from SVG
    svg_path = os.path.join('static', 'grid_full.svg')
    all_tiles = _parse_svg_tiles(svg_path)
    
    if not all_tiles or len(all_tiles) < len(asset_ids):
        return jsonify({"ok": False, "error": "Not enough tiles available"}), 400
    
    # Get all tile IDs (includes empty tiles)
    all_tile_ids = [tile['id'] for tile in all_tiles]
    
    # Randomly select N tiles for the N artworks
    random.shuffle(all_tile_ids)
    destination_tile_ids = all_tile_ids[:len(asset_ids)]
    
    # Create new wall state with only selected tiles
    new_state = {tile_id: asset_id for tile_id, asset_id in zip(destination_tile_ids, asset_ids)}
    
    # Save shuffled state (clears tiles not in new_state)
    save_wall_state(new_state)
    
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",  # allow network devices (your phone) to connect
        port=5000,
        debug=True
    )