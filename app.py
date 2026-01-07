from flask import Flask, render_template, send_from_directory
import os
import json

# ===== PURGED: SQLite imports removed =====
# import sqlite3
# import uuid
# from datetime import datetime
# from werkzeug.utils import secure_filename

app = Flask(__name__)

# ---- Debug toggle ----
SERVER_DEBUG = False

# ===== PURGED: All SQLite and upload flags removed =====

# ---- Grid color config ----
COLOR_CONFIG = "grid_color.json"
DEFAULT_GRID_COLOR = "#b84c27"

# ---- File paths (absolute) ----
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

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

# ===== PURGED: All database functions removed =====

def save_grid_color(color: str):
    """Persist the chosen grid color so all visitors see it."""
    color_path = os.path.join("data", "grid_color.json")
    os.makedirs("data", exist_ok=True)
    with open(color_path, "w") as f:
        json.dump({"color": color}, f)
# ===== PURGED: All wall state and database functions removed =====
# (No persistence, no undo history, cropper-only demo)


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


# ===== PURGED: Demo placement generator removed =====


# ---- Routes ----
@app.route("/")
def index():
    """Render the main gallery page with grid color only (no database)."""
    try:
        grid_color = load_grid_color()
    except Exception:
        grid_color = DEFAULT_GRID_COLOR
    
    return render_template("index.html", grid_color=grid_color)


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


# ===== PURGED: Wall State API (no DB) =====
# @app.route("/api/wall_state", methods=["GET"])
# ... (removed for cropper-only demo)


@app.route("/uploads/<path:filename>")
def uploads(filename):
    """Serve uploaded files from the uploads directory."""
    return send_from_directory(UPLOAD_DIR, filename)


# ===== PURGED: Upload & Assignment Routes (no DB) =====
# @app.route("/api/upload_assets", methods=["POST"])
# @app.route("/api/assign_tile", methods=["POST"])
# ... (removed for cropper-only demo)

# ===== PURGED: Admin routes that depend on database =====
# @app.route("/api/admin/clear_tile", methods=["POST"])
# @app.route("/api/admin/clear_all_tiles", methods=["POST"])
# @app.route("/api/admin/undo", methods=["POST"])
# @app.route("/api/admin/history_status", methods=["GET"])
# @app.route("/api/admin/tile_info", methods=["GET"])
# @app.route("/api/admin/move_tile_asset", methods=["POST"])
# @app.route("/api/admin/shuffle", methods=["POST"])
# ... (all removed for cropper-only demo)


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )
