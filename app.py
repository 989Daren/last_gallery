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
DEFAULT_GRID_COLOR = "#b84c27"

# ---- File paths (absolute) ----
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
DATA_DIR = os.path.join(BASE_DIR, "data")

# Ensure folders exist
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# Minimal admin pin (only used if you later re-enable admin routes)
ADMIN_PIN = os.environ.get("TLG_ADMIN_PIN", "8375")


def load_grid_color():
    """Read the current grid color from JSON file, or fall back to default."""
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
    """Pick a random unoccupied XS tile ID (queries database)."""
    import random

    # Get used tile IDs from database
    used = set()
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT tile_id FROM tiles WHERE asset_id IS NOT NULL")
        for row in cursor.fetchall():
            used.add(row["tile_id"])
        conn.close()
    except Exception:
        pass

    tiles = get_tiles_from_svg()
    xs_tiles = [t["id"] for t in tiles if t.get("size") == "xs"]
    available = [tid for tid in xs_tiles if tid not in used]

    if not available:
        return None

    return random.choice(available)


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
    """Return wall state from database (single source of truth)."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT t.tile_id, a.asset_id, a.tile_url, a.popup_url,
                   a.artist_name, a.artwork_title, a.year_created,
                   a.medium, a.dimensions, a.edition_info,
                   a.for_sale, a.sale_type, a.artist_contact,
                   a.contact1_type, a.contact1_value,
                   a.contact2_type, a.contact2_value
            FROM tiles t
            JOIN assets a ON a.asset_id = t.asset_id
            ORDER BY t.tile_id
        """)
        assignments = []
        for row in cursor.fetchall():
            assignments.append({
                "tile_id": row["tile_id"],
                "asset_id": row["asset_id"],
                "tile_url": row["tile_url"],
                "popup_url": row["popup_url"],
                "artist_name": row["artist_name"] or "",
                "artwork_name": row["artwork_title"] or "",
                "year_created": row["year_created"] or "",
                "medium": row["medium"] or "",
                "dimensions": row["dimensions"] or "",
                "edition_info": row["edition_info"] or "",
                "for_sale": row["for_sale"] or "",
                "sale_type": row["sale_type"] or "",
                "contact1_type": row["contact1_type"] or "",
                "contact1_value": row["contact1_value"] or "",
                "contact2_type": row["contact2_type"] or "",
                "contact2_value": row["contact2_value"] or "",
            })
        conn.close()
        return jsonify({"ok": True, "assignments": assignments})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e), "assignments": []}), 500


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

    All data stored in SQLite database (single source of truth).
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

    # Generate unique ID for filenames
    file_id = str(uuid.uuid4())

    tile_filename = _save_upload_file(tile_fs, "tile", file_id)
    popup_filename = _save_upload_file(popup_fs, "popup", file_id)

    tile_url = f"/uploads/{tile_filename}"
    popup_url = f"/uploads/{popup_filename}"

    # Persist to database (single source of truth)
    try:
        conn = get_db()
        cursor = conn.cursor()

        # Insert asset with URLs (metadata empty, will be added via metadata modal)
        cursor.execute(
            """INSERT INTO assets(artist_name, artwork_title, tile_url, popup_url)
               VALUES('', '', ?, ?)""",
            (tile_url, popup_url)
        )
        asset_id = cursor.lastrowid

        # Assign asset to tile
        cursor.execute(
            "INSERT OR REPLACE INTO tiles(tile_id, asset_id, updated_at) VALUES(?, ?, datetime('now'))",
            (tile_id, asset_id)
        )

        conn.commit()
        conn.close()
    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        return jsonify({"ok": False, "error": str(e)}), 500

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
    Update metadata for the asset assigned to a tile.

    Input JSON body:
        {
            "artist_name": "string",
            "artwork_title": "string",
            "year_created": "string",
            "medium": "string",
            "dimensions": "string",
            "edition_info": "string",
            "for_sale": "yes|no|",
            "sale_type": "original|print|"
        }

    Returns:
        {
            "ok": true,
            "tile_id": "<tile_id>",
            "asset_id": <asset_id>,
            ...all fields...
        }
    """
    try:
        # Read and normalize JSON input
        data = request.get_json() or {}
        artist_name = (data.get("artist_name") or "").strip()
        artwork_title = (data.get("artwork_title") or "").strip()
        year_created = (data.get("year_created") or "").strip()
        medium = (data.get("medium") or "").strip()
        dimensions = (data.get("dimensions") or "").strip()
        edition_info = (data.get("edition_info") or "").strip()
        for_sale = (data.get("for_sale") or "").strip()
        sale_type = (data.get("sale_type") or "").strip()
        artist_contact = (data.get("artist_contact") or "").strip()
        contact1_type = (data.get("contact1_type") or "").strip()
        contact1_value = (data.get("contact1_value") or "").strip()
        contact2_type = (data.get("contact2_type") or "").strip()
        contact2_value = (data.get("contact2_value") or "").strip()

        # Get database connection
        conn = get_db()
        cursor = conn.cursor()

        # Find the asset assigned to this tile
        cursor.execute(
            "SELECT asset_id FROM tiles WHERE tile_id = ?",
            (tile_id,)
        )
        row = cursor.fetchone()

        if not row or not row["asset_id"]:
            conn.close()
            return jsonify({"ok": False, "error": "tile has no assigned asset"}), 404

        asset_id = row["asset_id"]

        # Update the asset's metadata (all fields)
        cursor.execute(
            """UPDATE assets SET
                artist_name = ?, artwork_title = ?, year_created = ?,
                medium = ?, dimensions = ?, edition_info = ?,
                for_sale = ?, sale_type = ?, artist_contact = ?,
                contact1_type = ?, contact1_value = ?,
                contact2_type = ?, contact2_value = ?
               WHERE asset_id = ?""",
            (artist_name, artwork_title, year_created, medium, dimensions,
             edition_info, for_sale, sale_type, artist_contact,
             contact1_type, contact1_value, contact2_type, contact2_value, asset_id)
        )

        conn.commit()
        conn.close()

        return jsonify({
            "ok": True,
            "tile_id": tile_id,
            "asset_id": asset_id,
            "artist_name": artist_name,
            "artwork_title": artwork_title,
            "year_created": year_created,
            "medium": medium,
            "dimensions": dimensions,
            "edition_info": edition_info,
            "for_sale": for_sale,
            "sale_type": sale_type,
            "contact1_type": contact1_type,
            "contact1_value": contact1_value,
            "contact2_type": contact2_type,
            "contact2_value": contact2_value
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
    Fetch the currently assigned asset metadata for a tile.

    Returns:
        {
            "ok": true,
            "tile_id": "<tile_id>",
            "asset_id": <asset_id> or null,
            ...all metadata fields...
        }
    """
    try:
        # Get database connection
        conn = get_db()
        cursor = conn.cursor()

        # Query tile and asset data
        cursor.execute("""
            SELECT t.tile_id, t.asset_id, a.artist_name, a.artwork_title,
                   a.year_created, a.medium, a.dimensions, a.edition_info,
                   a.for_sale, a.sale_type, a.artist_contact,
                   a.contact1_type, a.contact1_value,
                   a.contact2_type, a.contact2_value
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
                "artwork_title": "",
                "year_created": "",
                "medium": "",
                "dimensions": "",
                "edition_info": "",
                "for_sale": "",
                "sale_type": "",
                "contact1_type": "",
                "contact1_value": "",
                "contact2_type": "",
                "contact2_value": ""
            })

        # Return data (use empty strings for null values)
        return jsonify({
            "ok": True,
            "tile_id": row["tile_id"],
            "asset_id": row["asset_id"],
            "artist_name": row["artist_name"] or "",
            "artwork_title": row["artwork_title"] or "",
            "year_created": row["year_created"] or "",
            "medium": row["medium"] or "",
            "dimensions": row["dimensions"] or "",
            "edition_info": row["edition_info"] or "",
            "for_sale": row["for_sale"] or "",
            "sale_type": row["sale_type"] or "",
            "contact1_type": row["contact1_type"] or "",
            "contact1_value": row["contact1_value"] or "",
            "contact2_type": row["contact2_type"] or "",
            "contact2_value": row["contact2_value"] or ""
        })

    except Exception as e:
        if 'conn' in locals():
            conn.close()
        return jsonify({
            "ok": False,
            "error": str(e)
        }), 500


# ---- Admin API endpoints ----

# Simple history for undo (in-memory, resets on server restart)
# Stores database state snapshots as list of (assets_rows, tiles_rows) tuples
_undo_history = []  # Regular actions
_shuffle_history = []  # Shuffle actions (separate stack)
_MAX_HISTORY = 50


def _get_db_snapshot():
    """Get a snapshot of current database state."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""SELECT asset_id, artist_name, artwork_title, tile_url, popup_url,
                             year_created, medium, dimensions, edition_info,
                             for_sale, sale_type, artist_contact,
                             contact1_type, contact1_value,
                             contact2_type, contact2_value FROM assets""")
    assets = [dict(row) for row in cursor.fetchall()]
    cursor.execute("SELECT tile_id, asset_id FROM tiles")
    tiles = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"assets": assets, "tiles": tiles}


def _restore_db_snapshot(snapshot):
    """Restore database to a previous snapshot."""
    conn = get_db()
    cursor = conn.cursor()

    # Clear current data
    cursor.execute("DELETE FROM tiles")
    cursor.execute("DELETE FROM assets")

    # Restore assets (with all metadata fields, using defaults for missing keys)
    for a in snapshot["assets"]:
        cursor.execute(
            """INSERT INTO assets(asset_id, artist_name, artwork_title, tile_url, popup_url,
                                  year_created, medium, dimensions, edition_info,
                                  for_sale, sale_type, artist_contact,
                                  contact1_type, contact1_value,
                                  contact2_type, contact2_value)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (a["asset_id"], a["artist_name"], a["artwork_title"], a["tile_url"], a["popup_url"],
             a.get("year_created", ""), a.get("medium", ""), a.get("dimensions", ""),
             a.get("edition_info", ""), a.get("for_sale", ""), a.get("sale_type", ""),
             a.get("artist_contact", ""),
             a.get("contact1_type", ""), a.get("contact1_value", ""),
             a.get("contact2_type", ""), a.get("contact2_value", ""))
        )

    # Restore tiles
    for t in snapshot["tiles"]:
        cursor.execute(
            "INSERT INTO tiles(tile_id, asset_id, updated_at) VALUES(?, ?, datetime('now'))",
            (t["tile_id"], t["asset_id"])
        )

    conn.commit()
    conn.close()


def _save_history_snapshot(is_shuffle=False):
    """Save current database state to history for undo."""
    snapshot = _get_db_snapshot()
    if is_shuffle:
        _shuffle_history.append(snapshot)
        if len(_shuffle_history) > _MAX_HISTORY:
            _shuffle_history.pop(0)
    else:
        _undo_history.append(snapshot)
        if len(_undo_history) > _MAX_HISTORY:
            _undo_history.pop(0)


@app.route("/api/admin/history_status", methods=["GET"])
def admin_history_status():
    """Return undo availability."""
    ok, err = check_admin_pin()
    if not ok:
        return err
    return jsonify({
        "ok": True,
        "history_count": len(_undo_history),
        "shuffle_count": len(_shuffle_history),
        "non_shuffle_count": len(_undo_history)
    })


@app.route("/api/admin/tile_info", methods=["GET"])
def admin_tile_info():
    """Get info about a specific tile from database."""
    ok, err = check_admin_pin()
    if not ok:
        return err

    tile_id = request.args.get("tile_id", "").strip().upper()
    if not tile_id:
        return jsonify({"ok": False, "error": "missing tile_id"}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT t.tile_id, a.asset_id, a.artist_name, a.artwork_title,
                   a.tile_url, a.popup_url
            FROM tiles t
            JOIN assets a ON a.asset_id = t.asset_id
            WHERE t.tile_id = ?
        """, (tile_id,))
        row = cursor.fetchone()
        conn.close()

        if row:
            return jsonify({
                "ok": True,
                "tile_id": tile_id,
                "occupied": True,
                "asset_id": row["asset_id"],
                "artwork_name": row["artwork_title"] or "",
                "artist_name": row["artist_name"] or "",
                "tile_url": row["tile_url"] or "",
                "popup_url": row["popup_url"] or ""
            })

        return jsonify({
            "ok": True,
            "tile_id": tile_id,
            "occupied": False
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/admin/clear_tile", methods=["POST"])
def admin_clear_tile():
    """Clear a single tile (database)."""
    ok, err = check_admin_pin()
    if not ok:
        return err

    data = request.get_json() or {}
    tile_id = (data.get("tile_id") or "").strip().upper()
    if not tile_id:
        return jsonify({"ok": False, "error": "missing tile_id"}), 400

    _save_history_snapshot()

    try:
        conn = get_db()
        cursor = conn.cursor()

        # Find and delete the tile assignment
        cursor.execute("SELECT asset_id FROM tiles WHERE tile_id = ?", (tile_id,))
        row = cursor.fetchone()

        if not row or not row["asset_id"]:
            conn.close()
            return jsonify({"ok": False, "error": "tile not found or already empty"}), 404

        asset_id = row["asset_id"]

        # Delete tile and asset
        cursor.execute("DELETE FROM tiles WHERE tile_id = ?", (tile_id,))
        cursor.execute("DELETE FROM assets WHERE asset_id = ?", (asset_id,))

        conn.commit()
        conn.close()

        return jsonify({
            "ok": True,
            "tile_id": tile_id,
            "shuffle_count": len(_shuffle_history),
            "non_shuffle_count": len(_undo_history)
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/admin/clear_all_tiles", methods=["POST"])
def admin_clear_all_tiles():
    """Clear all tiles (database)."""
    ok, err = check_admin_pin()
    if not ok:
        return err

    _save_history_snapshot()

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM tiles")
        cursor.execute("DELETE FROM assets")
        conn.commit()
        conn.close()

        return jsonify({
            "ok": True,
            "shuffle_count": len(_shuffle_history),
            "non_shuffle_count": len(_undo_history)
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/admin/move_tile_asset", methods=["POST"])
def admin_move_tile_asset():
    """Move artwork from one tile to another (database)."""
    ok, err = check_admin_pin()
    if not ok:
        return err

    data = request.get_json() or {}
    from_id = (data.get("from_tile_id") or "").strip().upper()
    to_id = (data.get("to_tile_id") or "").strip().upper()

    if not from_id or not to_id:
        return jsonify({"ok": False, "error": "missing from_tile_id or to_tile_id"}), 400

    _save_history_snapshot()

    try:
        conn = get_db()
        cursor = conn.cursor()

        # Check source tile has an asset
        cursor.execute("SELECT asset_id FROM tiles WHERE tile_id = ?", (from_id,))
        from_row = cursor.fetchone()
        if not from_row or not from_row["asset_id"]:
            conn.close()
            return jsonify({"ok": False, "error": "source tile is empty"}), 404

        # Check destination tile is empty
        cursor.execute("SELECT asset_id FROM tiles WHERE tile_id = ?", (to_id,))
        to_row = cursor.fetchone()
        if to_row and to_row["asset_id"]:
            conn.close()
            return jsonify({"ok": False, "error": "destination tile is occupied"}), 409

        asset_id = from_row["asset_id"]

        # Delete old tile assignment
        cursor.execute("DELETE FROM tiles WHERE tile_id = ?", (from_id,))

        # Create new tile assignment
        cursor.execute(
            "INSERT OR REPLACE INTO tiles(tile_id, asset_id, updated_at) VALUES(?, ?, datetime('now'))",
            (to_id, asset_id)
        )

        conn.commit()
        conn.close()

        return jsonify({
            "ok": True,
            "from_tile_id": from_id,
            "to_tile_id": to_id,
            "shuffle_count": len(_shuffle_history),
            "non_shuffle_count": len(_undo_history)
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/admin/undo", methods=["POST"])
def admin_undo():
    """Undo the last action (restores database snapshot)."""
    ok, err = check_admin_pin()
    if not ok:
        return err

    data = request.get_json() or {}
    action_type = data.get("action_type", "non_shuffle")

    try:
        if action_type == "shuffle":
            if not _shuffle_history:
                return jsonify({"ok": False, "message": "No shuffle to undo"})
            previous_snapshot = _shuffle_history.pop()
            _restore_db_snapshot(previous_snapshot)
            return jsonify({
                "ok": True,
                "message": "Shuffle undone",
                "action": "shuffle",
                "shuffle_count": len(_shuffle_history),
                "non_shuffle_count": len(_undo_history)
            })
        else:
            if not _undo_history:
                return jsonify({"ok": False, "message": "Nothing to undo"})
            previous_snapshot = _undo_history.pop()
            _restore_db_snapshot(previous_snapshot)
            return jsonify({
                "ok": True,
                "message": "Undo successful",
                "action": "non_shuffle",
                "shuffle_count": len(_shuffle_history),
                "non_shuffle_count": len(_undo_history)
            })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/shuffle", methods=["POST"])
def shuffle_tiles():
    """Randomly redistribute all images to different tiles (database)."""
    import random

    data = request.get_json() or {}
    pin = data.get("pin", "")

    if pin != ADMIN_PIN:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403

    # Save current state for undo
    _save_history_snapshot(is_shuffle=True)

    try:
        conn = get_db()
        cursor = conn.cursor()

        # Get ALL tiles from database and extract asset IDs
        cursor.execute("SELECT tile_id, asset_id FROM tiles")
        all_tiles = [dict(row) for row in cursor.fetchall()]
        
        # Get only the asset IDs (not None)
        asset_ids = [t["asset_id"] for t in all_tiles if t["asset_id"] is not None]

        if not asset_ids:
            conn.close()
            return jsonify({
                "ok": True,
                "message": "No tiles to shuffle",
                "shuffle_count": len(_shuffle_history),
                "non_shuffle_count": len(_undo_history)
            })

        # Get ALL tile IDs from database
        all_tile_ids = [t["tile_id"] for t in all_tiles]
        
        # Shuffle both lists independently for true randomization
        random.shuffle(asset_ids)
        random.shuffle(all_tile_ids)

        # Clear all tile assignments
        cursor.execute("UPDATE tiles SET asset_id = NULL, updated_at = datetime('now')")

        # Assign shuffled assets to shuffled tile positions
        for i, asset_id in enumerate(asset_ids):
            cursor.execute(
                "UPDATE tiles SET asset_id = ?, updated_at = datetime('now') WHERE tile_id = ?",
                (asset_id, all_tile_ids[i])
            )

        conn.commit()
        conn.close()

        return jsonify({
            "ok": True,
            "message": f"Shuffled {len(asset_ids)} tiles",
            "shuffle_count": len(_shuffle_history),
            "non_shuffle_count": len(_undo_history)
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )
