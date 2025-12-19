from flask import Flask, render_template, request, jsonify, send_from_directory
import os
import json
import re
import random
import uuid
import xml.etree.ElementTree as ET
from werkzeug.utils import secure_filename

app = Flask(__name__)

# ---- Debug toggle ----
SERVER_DEBUG = False

# ---- Kill-switch for demo/test art auto-population ----
# Set to False to disable all auto-generation of placeholder artwork
ENABLE_DEMO_AUTOFILL = False

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
    """Load assets metadata from data/assets.json.
    
    Returns a dict keyed by asset_id. If file is missing or invalid, returns {}.
    """
    if os.path.exists(ASSETS_FILE):
        try:
            with open(ASSETS_FILE, "r", encoding="utf-8") as f:
                return json.load(f) or {}
        except Exception:
            return {}
    return {}


def save_assets(assets_dict):
    """Save assets metadata to data/assets.json.
    
    Ensures the data/ directory exists before writing.
    """
    os.makedirs(os.path.dirname(ASSETS_FILE), exist_ok=True)
    with open(ASSETS_FILE, "w", encoding="utf-8") as f:
        json.dump(assets_dict or {}, f, indent=2)


def load_wall_state():
    """Load wall state (tile_id -> asset_id mapping) from data/wall_state.json.
    
    Returns a dict. If file is missing or invalid, returns {}.
    """
    if os.path.exists(WALL_STATE_FILE):
        try:
            with open(WALL_STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f) or {}
        except Exception:
            return {}
    return {}


def save_wall_state(state_dict):
    """Save wall state to data/wall_state.json.
    
    Ensures the data/ directory exists before writing.
    """
    os.makedirs(os.path.dirname(WALL_STATE_FILE), exist_ok=True)
    with open(WALL_STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state_dict or {}, f, indent=2)


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
    
    asset_data = {
        "tile_url": tile_url,
        "popup_url": popup_url,
        "artwork_name": artwork_name,
        "artist_name": artist_name
    }
    
    # Save to assets.json
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
    """Admin-only: Clear a single tile assignment with history snapshot.
    
    Requires X-Admin-Pin header.
    Body: { "tile_id": "X99" }
    
    Returns: { "ok": true, "history_count": N }
    """
    is_valid, error_response = check_admin_pin()
    if not is_valid:
        return error_response
    
    data = request.get_json(silent=True) or {}
    tile_id = data.get("tile_id")
    
    if not tile_id:
        return jsonify({"ok": False, "error": "Missing tile_id"}), 400
    
    # Load current state and push snapshot
    wall_state = load_wall_state()
    history_count = push_history_snapshot(wall_state)
    
    # Remove tile assignment if present
    if tile_id in wall_state:
        del wall_state[tile_id]
    
    save_wall_state(wall_state)
    
    return jsonify({"ok": True, "history_count": history_count})


@app.route("/api/admin/clear_all_tiles", methods=["POST"])
def admin_clear_all_tiles():
    """Admin-only: Clear all tile assignments with history snapshot.
    
    Requires X-Admin-Pin header.
    
    Returns: { "ok": true, "history_count": N }
    """
    is_valid, error_response = check_admin_pin()
    if not is_valid:
        return error_response
    
    # Load current state and push snapshot
    wall_state = load_wall_state()
    history_count = push_history_snapshot(wall_state)
    
    # Clear all assignments
    save_wall_state({})
    
    return jsonify({"ok": True, "history_count": history_count})


@app.route("/api/admin/undo", methods=["POST"])
def admin_undo():
    """Admin-only: Undo last wall state change.
    
    Requires X-Admin-Pin header.
    
    Returns: { "ok": true, "history_count": N } or { "ok": false, "error": "Nothing to undo" }
    """
    is_valid, error_response = check_admin_pin()
    if not is_valid:
        return error_response
    
    snapshot, history_count = pop_history_snapshot()
    
    if snapshot is None:
        return jsonify({"ok": False, "error": "Nothing to undo", "history_count": 0})
    
    # Restore snapshot as current state
    save_wall_state(snapshot)
    
    return jsonify({"ok": True, "history_count": history_count})


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
    
    # Push snapshot before modifying
    history_count = push_history_snapshot(wall_state)
    
    # Move asset
    wall_state[to_tile_id] = wall_state[from_tile_id]
    del wall_state[from_tile_id]
    
    save_wall_state(wall_state)
    
    return jsonify({"ok": True, "history_count": history_count})


@app.route("/shuffle", methods=["POST"])
def shuffle_placement():
    """Regenerate and save a new randomized placement mapping.

    Expects JSON body like { "pin": "8375" }.
    If pin is incorrect, returns 401 with { "ok": false, "error": "Unauthorized" }.
    On success saves a new placement and returns { "ok": true }.
    
    GATED: Only functional if ENABLE_DEMO_AUTOFILL is True.
    """
    # Kill-switch check: refuse if demo autofill is disabled
    if not ENABLE_DEMO_AUTOFILL:
        return jsonify({"ok": False, "error": "Shuffle feature disabled"}), 403
    
    data = request.get_json(silent=True) or {}
    pin = data.get("pin")

    if pin != "8375":
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    new_mapping = generate_initial_placement()
    save_placement(new_mapping)
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",  # allow network devices (your phone) to connect
        port=5000,
        debug=True
    )