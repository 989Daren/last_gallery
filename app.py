from flask import Flask, render_template, request, jsonify
import os
import json
import re
import random
import xml.etree.ElementTree as ET

app = Flask(__name__)

# ---- Grid color config ----
COLOR_CONFIG = "grid_color.json"
DEFAULT_GRID_COLOR = "#aa6655"  # set this to whatever default you want

PLACEMENT_FILE = os.path.join("data", "placement.json")


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
        "/static/artwork/coffee thumb.png",
        "/static/artwork/doom scroll.png",
        "/static/artwork/sun dress final low.png",
        "/static/artwork/heart girl low.png",
        "/static/artwork/fire clown low.png",
        "/static/artwork/Mackinaw Island Arch xara.png",
        "/static/artwork/the dream.png",
        "/static/artwork/twilight circus.jpg",
        "/static/artwork/dark cloud girl.png",
        "/static/artwork/girl in window.jpg",
        "/static/artwork/I Need the Money.png",
        "/static/artwork/stranger 1.png"
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
    if not placement:
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


@app.route("/shuffle", methods=["POST"])
def shuffle_placement():
    """Regenerate and save a new randomized placement mapping.

    Expects JSON body like { "pin": "8375" }.
    If pin is incorrect, returns 401 with { "ok": false, "error": "Unauthorized" }.
    On success saves a new placement and returns { "ok": true }.
    """
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