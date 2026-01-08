from flask import Flask, render_template, send_from_directory, jsonify, request
import os
import json
import uuid
import re
import xml.etree.ElementTree as ET
from werkzeug.utils import secure_filename
from db import init_db, get_db

app = Flask(__name__, static_folder="static", static_url_path="/static")

# Initialize database schema on startup
init_db()

# ---- Debug toggle ----
SERVER_DEBUG = False

# ---- Grid color config ----
COLOR_CONFIG = "grid_color.json"
DEFAULT_GRID_COLOR = "#b84c27"

# ---- File paths (absolute) ----
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
DATA_DIR = os.path.join(BASE_DIR, "data")
WALL_STATE_PATH = os.path.join(DATA_DIR, "wall_state.json")

# Ensure folders exist
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# Minimal admin pin (only used if you later re-enable admin routes)
ADMIN_PIN = os.environ.get("TLG_ADMIN_PIN", "0000")


def load_grid_color():
    """Read the current grid color from a small JSON file, or fall back to default."""
    # legacy path support
    if os.path.exists(COLOR_CONFIG):
        try:
            with open(COLOR_CONFIG, "r") as f:
                data = json.load(f)
                return data.get("color", DEFAULT_GRID_COLOR)
        except Exception:
            return DEFAULT_GRID_COLOR

    # current path
    color_path = os.path.join(DATA_DIR, "grid_color.json")
    if os.path.exists(color_path):
        try:
            with open(color_path, "r") as f:
                data = json.load(f)
                return data.get("color", DEFAULT_GRID_COLOR)
        except Exception:
            return DEFAULT_GRID_COLOR

    return DEFAULT_GRID_COLOR


def save_grid_color(color: str):
    """Persist the chosen grid color so all visitors see it."""
    color_path = os.path.join(DATA_DIR, "grid_color.json")
    with open(color_path, "w") as f:
        json.dump({"color": color}, f)


def load_wall_state():
    """Load wall state from JSON. No SQLite. Safe if missing/corrupted."""
    if not os.path.exists(WALL_STATE_PATH):
        return {"assignments": []}
    try:
        with open(WALL_STATE_PATH, "r") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"assignments": []}
        assignments = data.get("assignments", [])
        if not isinstance(assignments, list):
            assignments = []
        return {"assignments": assignments}
    except Exception:
        return {"assignments": []}


def save_wall_state(state: dict):
    """Persist wall state to JSON."""
    with open(WALL_STATE_PATH, "w") as f:
        json.dump(state, f)


def check_admin_pin():
    """Check if request has valid X-Admin-Pin header."""
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


_TILE_CACHE = None


def get_tiles_from_svg():
    global _TILE_CACHE
    if _TILE_CACHE is not None:
        return _TILE_CACHE
    svg_path = os.path.join(app.static_folder, "grid_full.svg")
    tiles = _parse_svg_tiles(svg_path)
    _TILE_CACHE = tiles
    return tiles


def pick_next_xs_tile_id():
    """Pick the first unoccupied XS tile ID."""
    state = load_wall_state()
    used = set()
    for a in state.get("assignments", []):
        tid = a.get("tile_id")
        if tid:
            used.add(tid)

    tiles = get_tiles_from_svg()
    xs_tiles = [t["id"] for t in tiles if t.get("size") == "xs"]
    for tid in xs_tiles:
        if tid not in used:
            return tid
    return None


def _allowed_ext(filename: str):
    ext = os.path.splitext(filename)[1].lower()
    return ext in (".jpg", ".jpeg", ".png", ".webp")


def _save_upload_file(fs, prefix: str, asset_id: str):
    """Save an uploaded file storage to UPLOAD_DIR with a stable name."""
    original = secure_filename(fs.filename or "")
    ext = os.path.splitext(original)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        # default to .jpg if client doesn't provide a sane extension
        ext = ".jpg"
    filename = f"{prefix}_{asset_id}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    fs.save(path)
    return filename


# ---- Routes ----
@app.route("/")
def index():
    """Render the main gallery page with grid color only (no SQLite)."""
    try:
        grid_color = load_grid_color()
    except Exception:
        grid_color = DEFAULT_GRID_COLOR

    return render_template("index.html", grid_color=grid_color)


@app.route("/__debug/static_check")
def debug_static_check():
    """Debug endpoint to verify Flask can see grid_full.svg."""
    p = os.path.join(app.static_folder, "grid_full.svg")
    exists = os.path.exists(p)
    size = os.path.getsize(p) if exists else None
    return {
        "static_folder": app.static_folder,
        "static_url_path": app.static_url_path,
        "cwd": os.getcwd(),
        "grid_full_svg_path": p,
        "exists": exists,
        "size": size,
    }, 200


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
def wall_state():
    """Return wall state from JSON (no DB)."""
    state = load_wall_state()
    return jsonify({"ok": True, "assignments": state.get("assignments", [])})


@app.route("/uploads/<path:filename>")
def uploads(filename):
    """Serve uploaded files from the uploads directory."""
    return send_from_directory(UPLOAD_DIR, filename)


@app.route("/api/upload_assets", methods=["POST"])
@app.route("/api/upload_asset", methods=["POST"])
def upload_assets():
    """Upload cropped tile image + popup image and place into next available XS tile.

    Expected multipart form fields:
    - tile_image: required
    - popup_image: required (if missing, we reuse tile_image)
    This is intentionally minimal: no metadata, no SQLite.
    """
    tile_fs = request.files.get("tile_image")
    popup_fs = request.files.get("popup_image")

    if not tile_fs:
        return jsonify({"ok": False, "error": "missing tile_image"}), 400
    if popup_fs is None:
        popup_fs = tile_fs

    # Basic type check (by extension only)
    if tile_fs.filename and not _allowed_ext(tile_fs.filename):
        return jsonify({"ok": False, "error": "unsupported tile_image type"}), 400
    if popup_fs.filename and not _allowed_ext(popup_fs.filename):
        return jsonify({"ok": False, "error": "unsupported popup_image type"}), 400

    tile_id = pick_next_xs_tile_id()
    if not tile_id:
        return jsonify({"ok": False, "error": "no available XS tile"}), 409

    asset_id = str(uuid.uuid4())

    tile_filename = _save_upload_file(tile_fs, "tile", asset_id)
    popup_filename = _save_upload_file(popup_fs, "popup", asset_id)

    tile_url = f"/uploads/{tile_filename}"
    popup_url = f"/uploads/{popup_filename}"

    # Persist placement in wall_state.json
    state = load_wall_state()
    assignments = state.get("assignments", [])
    assignments.append({
        "tile_id": tile_id,
        "asset_id": asset_id,
        "tile_url": tile_url,
        "popup_url": popup_url,
        # keep legacy keys present but empty so older JS won't break
        "artwork_name": "",
        "artist_name": "",
    })
    state["assignments"] = assignments
    save_wall_state(state)

    return jsonify({
        "ok": True,
        "tile_id": tile_id,
        "asset": {
            "asset_id": asset_id,
            "tile_url": tile_url,
            "popup_url": popup_url,
        },
    })


@app.route("/api/tile/<tile_id>/metadata", methods=["POST"])
def save_tile_metadata(tile_id):
    """
    Create a new asset record and assign it to a tile.
    
    Input JSON body:
        {
            "artist_name": "string",
            "artwork_title": "string"
        }
    
    Returns:
        {
            "ok": true,
            "tile_id": "<tile_id>",
            "asset_id": <asset_id>,
            "artist_name": "<artist_name>",
            "artwork_title": "<artwork_title>"
        }
    """
    try:
        # Read and normalize JSON input
        data = request.get_json() or {}
        artist_name = (data.get("artist_name") or "").strip()
        artwork_title = (data.get("artwork_title") or "").strip()
        
        # Get database connection
        conn = get_db()
        cursor = conn.cursor()
        
        # Ensure tile row exists
        cursor.execute(
            "INSERT OR IGNORE INTO tiles(tile_id, asset_id) VALUES(?, NULL)",
            (tile_id,)
        )
        
        # Insert asset row
        cursor.execute(
            "INSERT INTO assets(artist_name, artwork_title) VALUES(?, ?)",
            (artist_name, artwork_title)
        )
        asset_id = cursor.lastrowid
        
        # Assign asset to tile
        cursor.execute(
            "UPDATE tiles SET asset_id=?, updated_at=datetime('now') WHERE tile_id=?",
            (asset_id, tile_id)
        )
        
        # Commit changes
        conn.commit()
        conn.close()
        
        return jsonify({
            "ok": True,
            "tile_id": tile_id,
            "asset_id": asset_id,
            "artist_name": artist_name,
            "artwork_title": artwork_title
        })
        
    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        return jsonify({
            "ok": False,
            "error": str(e)
        }), 500


@app.route("/api/tile/<tile_id>/metadata", methods=["GET"])
def get_tile_metadata(tile_id):
    """
    Fetch the currently assigned asset metadata (artist/title) for a tile.
    
    Returns:
        {
            "ok": true,
            "tile_id": "<tile_id>",
            "asset_id": <asset_id> or null,
            "artist_name": "<artist_name>" or "",
            "artwork_title": "<artwork_title>" or ""
        }
    """
    try:
        # Get database connection
        conn = get_db()
        cursor = conn.cursor()
        
        # Query tile and asset data
        cursor.execute("""
            SELECT t.tile_id, t.asset_id, a.artist_name, a.artwork_title
            FROM tiles t
            LEFT JOIN assets a ON a.asset_id = t.asset_id
            WHERE t.tile_id = ?
        """, (tile_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        # If no tiles row exists, return empty values
        if not row:
            return jsonify({
                "ok": True,
                "tile_id": tile_id,
                "asset_id": None,
                "artist_name": "",
                "artwork_title": ""
            })
        
        # Return data (use empty strings for null values)
        return jsonify({
            "ok": True,
            "tile_id": row["tile_id"],
            "asset_id": row["asset_id"],
            "artist_name": row["artist_name"] or "",
            "artwork_title": row["artwork_title"] or ""
        })
        
    except Exception as e:
        if 'conn' in locals():
            conn.close()
        return jsonify({
            "ok": False,
            "error": str(e)
        }), 500


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )
