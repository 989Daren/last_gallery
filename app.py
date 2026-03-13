from flask import Flask, render_template, send_from_directory, jsonify, request
import os
import time
import json
import uuid
import re
import io
import html as html_mod
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
import xml.etree.ElementTree as ET
import stripe
import resend
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
from PIL import Image, ImageDraw, ImageFont
from db import init_db, get_db

load_dotenv()

app = Flask(__name__, static_folder="static", static_url_path="/static")


@app.template_filter('cachebust')
def cachebust_filter(url):
    """Append file mtime as query param for automatic cache busting."""
    if '?' in url:
        path = url.split('?')[0]
    else:
        path = url
    # Strip leading /static/ to get relative path
    if path.startswith('/static/'):
        rel = path[len('/static/'):]
        filepath = os.path.join(app.static_folder, rel)
        try:
            mtime = int(os.path.getmtime(filepath))
            return url.split('?')[0] + '?v=' + str(mtime)
        except OSError:
            pass
    return url


# Initialize database schema on startup
init_db()

# ---- Grid color config ----
DEFAULT_GRID_COLOR = "#b84c27"

# ---- File paths (absolute) ----
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
DATA_DIR = os.path.join(BASE_DIR, "data")

# Ensure folders exist
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# ---- Generate info tile image if missing ----
def _generate_info_tile_image():
    """Create a 512x512 info tile image: black bg, gold circle, dark 'i'."""
    img_path = os.path.join(BASE_DIR, "static", "images", "info_tile.jpg")
    if os.path.exists(img_path):
        return
    size = 512
    img = Image.new("RGB", (size, size), "#000000")
    draw = ImageDraw.Draw(img)
    # Gold circle centered with padding
    pad = 50
    draw.ellipse([pad, pad, size - pad, size - pad], fill="#D4A843")
    # Draw "i" in center — try serif bold italic, fall back gracefully
    font_size = 280
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif-BoldItalic.ttf", font_size)
    except (OSError, IOError):
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", font_size)
        except (OSError, IOError):
            font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), "i", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (size - tw) // 2 - bbox[0]
    ty = (size - th) // 2 - bbox[1]
    draw.text((tx, ty), "i", fill="#1a1a1a", font=font)
    os.makedirs(os.path.dirname(img_path), exist_ok=True)
    img.save(img_path, "JPEG", quality=95)
    print("Generated info_tile.jpg")

_generate_info_tile_image()


# ---- Seed info tiles ----
def _seed_info_tiles():
    """Ensure 3 info-type assets exist and are assigned to S tiles."""
    import random

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM assets WHERE asset_type = 'info'")
    count = cursor.fetchone()[0]

    if count >= 3:
        conn.close()
        return

    needed = 3 - count
    tile_size_map = get_tile_size_map()
    s_tile_ids = {tid for tid, sz in tile_size_map.items() if sz == 's'}

    # Get occupied tiles
    cursor.execute("SELECT tile_id FROM tiles WHERE asset_id IS NOT NULL")
    occupied = {row["tile_id"] for row in cursor.fetchall()}
    empty_s = list(s_tile_ids - occupied)
    random.shuffle(empty_s)

    for i in range(needed):
        if not empty_s:
            print(f"Warning: no empty S tiles for info asset {i+1}")
            break
        tile_id = empty_s.pop()
        cursor.execute("""
            INSERT INTO assets (artist_name, artwork_title, tile_url, popup_url,
                                unlocked, qualified_floor, asset_type)
            VALUES ('', '', '/static/images/info_tile.jpg', '', 0, 's', 'info')
        """)
        asset_id = cursor.lastrowid
        cursor.execute(
            "INSERT OR REPLACE INTO tiles (tile_id, asset_id, updated_at) VALUES (?, ?, datetime('now'))",
            (tile_id, asset_id)
        )
        print(f"Seeded info tile: asset {asset_id} → {tile_id}")

    conn.commit()
    conn.close()

# _seed_info_tiles() called after get_tile_size_map() is defined (see below)


# Minimal admin pin (only used if you later re-enable admin routes)
ADMIN_PIN = os.environ.get("TLG_ADMIN_PIN", "REDACTED_PIN")

# Upload limit: max artworks per email address
UPLOAD_LIMIT = 4

# Base URL for links in emails (override via env for production)
BASE_URL = os.environ.get("TLG_BASE_URL", "https://thelastgallery.com")

# Stripe configuration
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET")
if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY

# Upgrade tier configuration: tier_name -> (price_cents, floor_value, label)
TIER_CONFIG = {
    'unlock_s':  {'price_cents': 999, 'floor': 's', 'label': 'Unlock (S)'},
    'floor_m':   {'price_cents': 2499, 'floor': 'm', 'label': 'Medium Floor'},
    'floor_lg':  {'price_cents': 5999, 'floor': 'lg', 'label': 'Large Floor'},
    'floor_xl':  {'price_cents': 9999, 'floor': 'xl', 'label': 'Extra Large Floor'},
    'exhibit':   {'price_cents': 19999, 'floor': None, 'label': 'Exhibit Tile'},
}

# Popup image optimization settings
POPUP_MAX_DIMENSION = 2560  # Max pixels on longest side
POPUP_JPEG_QUALITY = 90

# Tile size ordering for qualified_floor model
SIZE_ORDER = {'s': 0, 'm': 1, 'lg': 2, 'xl': 3}
SIZE_NAMES = ['s', 'm', 'lg', 'xl']
SIZE_DISPLAY = {'s': 'Small', 'm': 'Medium', 'lg': 'Large', 'xl': 'Extra Large'}
TIER_FOR_SIZE = {cfg['floor']: name for name, cfg in TIER_CONFIG.items() if cfg['floor'] and name.startswith('floor_')}


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

    Ungrouped <rect> elements are individual (S) tiles.
    <g> elements containing <rect> children are larger tiles — the group's
    bounding box determines size classification (M, LG, XL).
    """
    try:
        tree = ET.parse(svg_path)
        root = tree.getroot()
    except Exception:
        return []

    ns = '{http://www.w3.org/2000/svg}'

    def rect_position(rect):
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

        return left, top, width, height

    # Find the main layer group (first <g> child of root)
    layer = root.find(ns + 'g') or root.find('g')
    if layer is None:
        return []

    raw_tiles = []
    for child in layer:
        tag = child.tag.replace(ns, '')

        if tag == 'rect':
            left, top, width, height = rect_position(child)
            raw_tiles.append({'width': width, 'height': height, 'svg_left': left, 'svg_top': top})

        elif tag == 'g':
            child_rects = child.findall(ns + 'rect') + child.findall('rect')
            if not child_rects:
                continue
            positions = [rect_position(r) for r in child_rects]
            min_l = min(p[0] for p in positions)
            min_t = min(p[1] for p in positions)
            max_r = max(p[0] + p[2] for p in positions)
            max_b = max(p[1] + p[3] for p in positions)
            raw_tiles.append({
                'width': max_r - min_l,
                'height': max_b - min_t,
                'svg_left': min_l,
                'svg_top': min_t
            })

    if not raw_tiles:
        return []

    # Infer scale factor using S candidates (same thresholds as client)
    s_candidates = [t['width'] for t in raw_tiles if 40 <= t['width'] <= 90]
    if not s_candidates:
        return []

    avg_s = sum(s_candidates) / len(s_candidates)
    DESIGN_S = 85.0
    scale = avg_s / DESIGN_S

    for t in raw_tiles:
        t['design_width'] = t['width'] / scale
        t['design_height'] = t['height'] / scale
        t['design_left'] = t['svg_left'] / scale
        t['design_top'] = t['svg_top'] / scale

    min_left = min(t['design_left'] for t in raw_tiles)
    min_top = min(t['design_top'] for t in raw_tiles)

    def classify(w):
        if w >= 60 and w < 128: return 's'
        if w >= 128 and w < 213: return 'm'
        if w >= 213 and w < 298: return 'lg'
        if w >= 298 and w < 425: return 'xl'
        return 'unknown'

    # Normalize and classify
    for t in raw_tiles:
        t['norm_left'] = t['design_left'] - min_left
        t['norm_top'] = t['design_top'] - min_top
        t['size'] = classify(t['design_width'])

    # Assign IDs
    counters = {'s': 0, 'm': 0, 'lg': 0, 'xl': 0, 'unknown': 0}
    prefix = {'s': 'S', 'm': 'M', 'lg': 'L', 'xl': 'XL', 'unknown': 'U'}
    tiles = []
    for t in raw_tiles:
        if t['size'] == 'unknown':
            continue
        counters[t['size']] += 1
        tid = prefix[t['size']] + str(counters[t['size']])
        tiles.append({'id': tid, 'size': t['size']})

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


def get_tile_size_map():
    """Return dict mapping tile_id -> size string from SVG cache."""
    return {t['id']: t['size'] for t in get_tiles_from_svg()}

# Seed info tiles now that get_tile_size_map is available
_seed_info_tiles()


def pick_next_s_tile_id():
    """Pick a random unoccupied S tile, accounting for floor-s unlocked artwork reservations.

    Floor-s unlocked artwork currently sitting in a non-S tile still needs
    an S slot reserved for it (so it has somewhere to go if shuffled back).
    """
    import random

    tile_size_map = get_tile_size_map()
    s_tile_ids = {tid for tid, sz in tile_size_map.items() if sz == 's'}

    try:
        conn = get_db()
        cursor = conn.cursor()

        # Get all occupied tiles with their asset info
        cursor.execute("""
            SELECT t.tile_id, a.unlocked, a.qualified_floor
            FROM tiles t
            JOIN assets a ON a.asset_id = t.asset_id
            WHERE t.asset_id IS NOT NULL
        """)
        occupied = [dict(row) for row in cursor.fetchall()]
        conn.close()
    except Exception:
        occupied = []

    occupied_tile_ids = {o['tile_id'] for o in occupied}
    empty_s = s_tile_ids - occupied_tile_ids

    # Count floor-s unlocked artwork sitting in non-S tiles (needs S reserved)
    reservations = sum(
        1 for o in occupied
        if o['unlocked'] and o.get('qualified_floor', 's') == 's'
        and o['tile_id'] not in s_tile_ids
    )

    available_count = len(empty_s) - reservations
    if available_count <= 0:
        return None

    return random.choice(list(empty_s))


def _allowed_ext(filename: str):
    ext = os.path.splitext(filename)[1].lower()
    return ext in (".jpg", ".jpeg", ".png", ".webp")


def _make_center_thumb(img_path, size=256):
    """Generate a center-cropped square JPEG thumbnail from an existing image file.

    Returns:
        BytesIO buffer containing the thumbnail JPEG, or None on failure.
    """
    try:
        img = Image.open(img_path)
        if img.mode not in ('RGB',):
            if img.mode in ('RGBA', 'LA', 'P'):
                bg = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                bg.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
                img = bg
            else:
                img = img.convert('RGB')
        w, h = img.size
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        img = img.crop((left, top, left + side, top + side))
        img = img.resize((size, size), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=85, optimize=True)
        buf.seek(0)
        return buf
    except Exception:
        return None


def _optimize_image(file_storage, max_dimension=POPUP_MAX_DIMENSION, quality=POPUP_JPEG_QUALITY):
    """Resize image if needed and convert to optimized JPEG.

    Args:
        file_storage: Werkzeug FileStorage object
        max_dimension: Max pixels on longest side (resizes proportionally if exceeded)
        quality: JPEG quality (1-100)

    Returns:
        BytesIO buffer containing optimized JPEG
    """
    img = Image.open(file_storage)

    # Handle EXIF orientation (auto-rotate based on metadata)
    try:
        from PIL import ExifTags
        for orientation in ExifTags.TAGS.keys():
            if ExifTags.TAGS[orientation] == 'Orientation':
                break
        exif = img._getexif()
        if exif is not None:
            orientation_value = exif.get(orientation)
            if orientation_value == 3:
                img = img.rotate(180, expand=True)
            elif orientation_value == 6:
                img = img.rotate(270, expand=True)
            elif orientation_value == 8:
                img = img.rotate(90, expand=True)
    except (AttributeError, KeyError, IndexError, TypeError):
        # No EXIF data or orientation tag
        pass

    # Convert to RGB if necessary (RGBA, P mode, etc.)
    if img.mode in ('RGBA', 'P', 'LA', 'L'):
        # Create white background for transparency
        if img.mode in ('RGBA', 'LA', 'P'):
            background = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'P':
                img = img.convert('RGBA')
            background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
            img = background
        else:
            img = img.convert('RGB')
    elif img.mode != 'RGB':
        img = img.convert('RGB')

    # Resize if exceeds max dimension
    width, height = img.size
    max_current = max(width, height)

    if max_current > max_dimension:
        ratio = max_dimension / max_current
        new_width = int(width * ratio)
        new_height = int(height * ratio)
        img = img.resize((new_width, new_height), Image.LANCZOS)

    # Save to buffer as optimized JPEG
    buffer = io.BytesIO()
    img.save(buffer, format='JPEG', quality=quality, optimize=True)
    buffer.seek(0)

    return buffer


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


def _save_optimized_popup(fs, asset_id: str):
    """Optimize and save popup image as JPEG.

    Resizes if larger than POPUP_MAX_DIMENSION, converts to JPEG at POPUP_JPEG_QUALITY.
    """
    optimized_buffer = _optimize_image(fs)
    filename = f"popup_{asset_id}.jpg"
    path = os.path.join(UPLOAD_DIR, filename)

    with open(path, 'wb') as f:
        f.write(optimized_buffer.read())

    return filename


def send_edit_code(email, code, artwork_title=""):
    """Send edit code to artist via Resend API (HTML + plain-text fallback)."""
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        app.logger.warning("[EDIT CODE] RESEND_API_KEY not set — code not emailed. To: %s | Code: %s", email, code)
        return

    safe_title = html_mod.escape(artwork_title) if artwork_title else ""
    title_param = f"?title={quote(artwork_title, safe='')}" if artwork_title else ""
    edit_link = f"{BASE_URL}/edit{title_param}"
    cotm_link = f"{BASE_URL}/creator-of-the-month"

    if artwork_title:
        artwork_line_html = f'<p style="font-size:18px;"><strong>Artwork Title:</strong> {safe_title}</p>'
        artwork_line_plain = f"Artwork Title: {artwork_title}\n"
    else:
        artwork_line_html = '<p style="font-size:18px;"><strong>Artwork:</strong> This edit code applies to all artwork associated with this email address.</p>'
        artwork_line_plain = "Artwork: This edit code applies to all artwork associated with this email address.\n"

    html_body = (
        '<div style="font-family:sans-serif; max-width:520px; margin:0 auto; padding:20px;">'
        f'{artwork_line_html}'
        f'<p style="font-size:18px;"><strong>Your Edit Code:</strong> {html_mod.escape(code)}</p>'
        "<p>If you need to edit your artwork's information, copy and paste your Edit Code into the link below.</p>"
        f'<p><a href="{html_mod.escape(edit_link)}">{html_mod.escape(edit_link)}</a></p>'
        '<hr style="margin:24px 0;">'
        '<p style="font-size:16px;"><strong>Coming Soon for all Unlocked Artwork!</strong><br>'
        "The Last Gallery's Creator of the Month!</p>"
        f'<p><a href="{html_mod.escape(cotm_link)}">{html_mod.escape(cotm_link)}</a></p>'
        '</div>'
    )

    plain_body = (
        f"{artwork_line_plain}"
        f"Your Edit Code: {code}\n\n"
        "If you need to edit your artwork's information, copy and paste your Edit Code into the link below.\n"
        f"{edit_link}\n\n"
        "---\n\n"
        "Coming Soon for all Unlocked Artwork!\n"
        "The Last Gallery's Creator of the Month!\n"
        f"{cotm_link}\n"
    )

    resend.api_key = api_key
    try:
        resend.Emails.send({
            "from": "The Last Gallery <noreply@thelastgallery.com>",
            "to": [email],
            "subject": "Your Last Gallery edit code",
            "html": html_body,
            "text": plain_body,
        })
        app.logger.info("[EDIT CODE] Email sent to %s", email)
    except Exception:
        app.logger.exception("[EDIT CODE] Failed to send email to %s", email)


def send_upgrade_notification(email, artwork_title, new_size, tier_price_cents, asset_id, access_code=''):
    """Send upgrade notification email when artwork lands in a bigger tile after shuffle."""
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        app.logger.warning("[UPGRADE NOTIFY] RESEND_API_KEY not set — notification not emailed. To: %s | Asset: %s", email, asset_id)
        return

    display_name = SIZE_DISPLAY.get(new_size, new_size.upper())
    price_str = f"${tier_price_cents / 100:.2f}"
    safe_title = html_mod.escape(artwork_title) if artwork_title else "your artwork"
    upgrade_link = f"{BASE_URL}/?upgrade=1&asset_id={asset_id}"

    access_code_html = ''
    access_code_plain = ''
    if access_code:
        safe_code = html_mod.escape(access_code)
        access_code_html = (
            '<p style="margin-top:16px; padding:12px; background:#1a1a1a; border:1px solid #D4A843; '
            'border-radius:6px; text-align:center;">'
            '<span style="color:#ffffff; font-size:15px;">Your access code:</span> '
            '<strong style="color:#D4A843; font-size:17px; letter-spacing:2px;">'
            f'{safe_code}</strong></p>'
        )
        access_code_plain = f"\nYour access code: {access_code}\n"

    html_body = (
        '<div style="font-family:sans-serif; max-width:520px; margin:0 auto; padding:20px;">'
        f'<h2 style="color:#D4A843;">Your artwork landed in a {display_name} tile!</h2>'
        f'<p style="font-size:18px;"><strong>{safe_title}</strong> has been shuffled into a <strong>{display_name}</strong> tile.</p>'
        f'<p>You can upgrade to this size for <strong>{price_str}</strong> — '
        'your artwork will never drop below this tile size during future shuffles.</p>'
        '<p style="font-size:16px; color:#D4A843;"><strong>Hurry and upgrade before the next weekly shuffle!</strong></p>'
        f'{access_code_html}'
        f'<p><a href="{html_mod.escape(upgrade_link)}" style="display:inline-block; padding:12px 24px; '
        'background:linear-gradient(135deg,#b8860b,#ffd700); color:#000; text-decoration:none; '
        'border-radius:6px; font-weight:bold;">Upgrade Your Tile</a></p>'
        '</div>'
    )

    plain_body = (
        f"Your artwork landed in a {display_name} tile!\n\n"
        f"{artwork_title or 'Your artwork'} has been shuffled into a {display_name} tile.\n\n"
        f"You can upgrade to this size for {price_str} — "
        "your artwork will never drop below this tile size during future shuffles.\n\n"
        "Hurry and upgrade before the next weekly shuffle!\n"
        f"{access_code_plain}\n"
        f"{upgrade_link}\n"
    )

    resend.api_key = api_key
    try:
        resend.Emails.send({
            "from": "The Last Gallery <noreply@thelastgallery.com>",
            "to": [email],
            "subject": f"Your artwork landed in a {display_name} tile!",
            "html": html_body,
            "text": plain_body,
        })
        app.logger.info("[UPGRADE NOTIFY] Email sent to %s for asset %s (size: %s)", email, asset_id, new_size)
    except Exception as e:
        app.logger.warning("[UPGRADE NOTIFY] Failed to send email to %s for asset %s: %s", email, asset_id, e)
        raise


def send_deadline_notification(email, artwork_title, asset_id, access_code=''):
    """Send 24-hour unlock deadline email when an artist uploads a 2nd+ free tile."""
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        app.logger.warning("[DEADLINE NOTIFY] RESEND_API_KEY not set — notification not emailed. To: %s | Asset: %s", email, asset_id)
        return

    safe_title = html_mod.escape(artwork_title) if artwork_title else "your artwork"
    upgrade_link = f"{BASE_URL}/?upgrade=1&asset_id={asset_id}"

    access_code_html = ''
    access_code_plain = ''
    if access_code:
        safe_code = html_mod.escape(access_code)
        access_code_html = (
            '<p style="margin-top:16px; padding:12px; background:#1a1a1a; border:1px solid #D4A843; '
            'border-radius:6px; text-align:center;">'
            '<span style="color:#ffffff; font-size:15px;">Your access code:</span> '
            '<strong style="color:#D4A843; font-size:17px; letter-spacing:2px;">'
            f'{safe_code}</strong></p>'
        )
        access_code_plain = f"\nYour access code: {access_code}\n"

    html_body = (
        '<div style="font-family:sans-serif; max-width:520px; margin:0 auto; padding:20px;">'
        f'<h2 style="color:#D4A843;">Your artwork is live — 24 hours to unlock</h2>'
        f'<p style="font-size:18px;"><strong>{safe_title}</strong> has been placed on the gallery wall.</p>'
        '<p>Since you already have a free tile, this upload must be unlocked within '
        '<strong>24 hours</strong> or it will be removed from the gallery.</p>'
        f'{access_code_html}'
        f'<p><a href="{html_mod.escape(upgrade_link)}" style="display:inline-block; padding:12px 24px; '
        'background:linear-gradient(135deg,#b8860b,#ffd700); color:#000; text-decoration:none; '
        'border-radius:6px; font-weight:bold;">Unlock Now</a></p>'
        '</div>'
    )

    plain_body = (
        "Your artwork is live — 24 hours to unlock\n\n"
        f"{artwork_title or 'Your artwork'} has been placed on the gallery wall.\n\n"
        "Since you already have a free tile, this upload must be unlocked within "
        "24 hours or it will be removed from the gallery.\n"
        f"{access_code_plain}\n"
        f"{upgrade_link}\n"
    )

    resend.api_key = api_key
    try:
        resend.Emails.send({
            "from": "The Last Gallery <noreply@thelastgallery.com>",
            "to": [email],
            "subject": "Your artwork is live — 24 hours to unlock",
            "html": html_body,
            "text": plain_body,
        })
        app.logger.info("[DEADLINE NOTIFY] Email sent to %s for asset %s", email, asset_id)
    except Exception:
        app.logger.exception("[DEADLINE NOTIFY] Failed to send email to %s for asset %s", email, asset_id)


# ---- Routes ----
@app.route("/")
def index():
    """Render the main gallery page with grid color only (no SQLite)."""
    try:
        grid_color = load_grid_color()
    except Exception:
        grid_color = DEFAULT_GRID_COLOR

    return render_template("index.html", grid_color=grid_color)


@app.route("/edit")
def edit_page():
    """Gallery page in edit mode — auto-opens edit banner."""
    try:
        grid_color = load_grid_color()
    except Exception:
        grid_color = DEFAULT_GRID_COLOR
    return render_template("index.html", grid_color=grid_color, page_mode="edit")


@app.route("/creator-of-the-month")
def artist_of_the_month():
    """Stub page for Creator of the Month — shows coming-soon banner."""
    try:
        grid_color = load_grid_color()
    except Exception:
        grid_color = DEFAULT_GRID_COLOR
    return render_template("index.html", grid_color=grid_color, page_mode="creator-of-the-month")


@app.route("/api/grid-color", methods=["POST"])
def set_grid_color():
    """Update the global grid color."""
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
                   a.contact2_type, a.contact2_value,
                   a.unlocked, a.qualified_floor, a.asset_type
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
                "unlocked": row["unlocked"] or 0,
                "qualified_floor": row["qualified_floor"] or "s",
                "asset_type": row["asset_type"] or "artwork",
            })
        conn.close()
        return jsonify({"ok": True, "assignments": assignments})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e), "assignments": []}), 500


@app.route("/uploads/<path:filename>")
def uploads(filename):
    """Serve uploaded files from the uploads directory."""
    response = send_from_directory(UPLOAD_DIR, filename)
    # Images use UUID filenames and are never overwritten — cache aggressively
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


@app.route("/api/upload_assets", methods=["POST"])
def upload_assets():
    """Upload cropped tile image + popup image and place into next available S tile.

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

    tile_id = pick_next_s_tile_id()
    if not tile_id:
        return jsonify({"ok": False, "error": "no available S tile"}), 409

    # Generate unique ID for filenames
    file_id = str(uuid.uuid4())

    tile_filename = _save_upload_file(tile_fs, "tile", file_id)
    popup_filename = _save_optimized_popup(popup_fs, file_id)

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
        contact1_type = (data.get("contact1_type") or "").strip()
        contact1_value = (data.get("contact1_value") or "").strip()
        contact2_type = (data.get("contact2_type") or "").strip()
        contact2_value = (data.get("contact2_value") or "").strip()
        is_edit = bool(data.get("is_edit"))

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

        # Duplicate check: reject if another asset has the same title + email
        if artwork_title and contact1_value:
            cursor.execute(
                """SELECT asset_id FROM assets
                   WHERE LOWER(TRIM(artwork_title)) = LOWER(?)
                     AND LOWER(TRIM(contact1_value)) = LOWER(?)
                     AND asset_id != ?""",
                (artwork_title, contact1_value, asset_id)
            )
            dup = cursor.fetchone()
            if dup:
                conn.close()
                return jsonify({
                    "ok": False,
                    "error": "Artwork title already exists for this email."
                }), 409

        # Capture old email before update (for edit code cleanup + limit checks)
        cursor.execute("SELECT contact1_value, unlocked FROM assets WHERE asset_id = ?", (asset_id,))
        old_asset = cursor.fetchone()
        old_email = (old_asset["contact1_value"] or "").strip().lower() if old_asset else ""
        asset_unlocked = old_asset["unlocked"] if old_asset else 0

        # Upload limit + free tile limit
        # Enforced on new uploads AND edits that change the email address
        payment_deadline_value = None
        checked_limits = False
        is_admin = request.headers.get("X-Admin-Pin") == ADMIN_PIN
        if contact1_value and not is_admin:
            # Determine if we need to check limits against this email
            check_limit = not is_edit
            if is_edit:
                if old_email != contact1_value.strip().lower():
                    check_limit = True

            if check_limit:
                checked_limits = True

                # 4-tile max
                cursor.execute(
                    "SELECT COUNT(*) FROM assets WHERE LOWER(TRIM(contact1_value)) = LOWER(?) AND artist_name != '' AND asset_id != ?",
                    (contact1_value, asset_id)
                )
                existing_count = cursor.fetchone()[0]
                if existing_count >= UPLOAD_LIMIT:
                    conn.close()
                    return jsonify({
                        "ok": False,
                        "error": "Upload limit reached. An artist's work may occupy no more than 4 tiles in the gallery."
                    }), 409

                # Free tile limit: only 1 free (unlocked=0) tile per email
                # If this asset is unlocked=0 and email already has a free tile, set a 24h deadline
                # Otherwise clear any existing deadline (this becomes the free tile for the new email)
                if not asset_unlocked:
                    cursor.execute(
                        "SELECT COUNT(*) FROM assets WHERE LOWER(TRIM(contact1_value)) = LOWER(?) AND unlocked = 0 AND artist_name != '' AND asset_id != ?",
                        (contact1_value, asset_id)
                    )
                    free_count = cursor.fetchone()[0]
                    if free_count >= 1:
                        deadline = datetime.now(timezone.utc) + timedelta(hours=24)
                        payment_deadline_value = deadline.strftime('%Y-%m-%dT%H:%M:%SZ')

        # Update the asset's metadata (all fields)
        cursor.execute(
            """UPDATE assets SET
                artist_name = ?, artwork_title = ?, year_created = ?,
                medium = ?, dimensions = ?, edition_info = ?,
                for_sale = ?, sale_type = ?,
                contact1_type = ?, contact1_value = ?,
                contact2_type = ?, contact2_value = ?
               WHERE asset_id = ?""",
            (artist_name, artwork_title, year_created, medium, dimensions,
             edition_info, for_sale, sale_type,
             contact1_type, contact1_value, contact2_type, contact2_value, asset_id)
        )

        # Set or clear payment_deadline when limits were checked
        # (separate UPDATE so edits that don't change email preserve existing deadline)
        if checked_limits:
            cursor.execute(
                "UPDATE assets SET payment_deadline = ? WHERE asset_id = ?",
                (payment_deadline_value, asset_id)
            )

        # Generate or reuse edit code if email contact provided
        edit_code = None
        is_new_code = False
        if contact1_value:
            normalized_email = contact1_value.lower()
            cursor.execute("SELECT code FROM edit_codes WHERE email = ?", (normalized_email,))
            code_row = cursor.fetchone()
            if code_row:
                edit_code = code_row["code"]
            else:
                edit_code = uuid.uuid4().hex[:8]
                is_new_code = True
                cursor.execute(
                    "INSERT INTO edit_codes(email, code) VALUES(?, ?)",
                    (normalized_email, edit_code)
                )

        # Clean up old email's edit code if email changed and no other tiles use it
        if old_email and old_email != (contact1_value or "").lower():
            cursor.execute(
                "SELECT COUNT(*) FROM assets WHERE LOWER(contact1_value) = ?",
                (old_email,)
            )
            remaining = cursor.fetchone()[0]
            if remaining == 0:
                cursor.execute("DELETE FROM edit_codes WHERE email = ?", (old_email,))

        conn.commit()
        conn.close()

        # Send email for new uploads (always) or edits when email changed
        email_changed = old_email != (contact1_value or "").lower()
        if edit_code and contact1_value and (not is_edit or is_new_code or email_changed):
            send_edit_code(contact1_value, edit_code, artwork_title)

        # Send deadline notification for 2nd+ uploads that need payment
        if payment_deadline_value and contact1_value:
            try:
                send_deadline_notification(contact1_value, artwork_title, asset_id, edit_code or '')
            except Exception:
                app.logger.exception("[DEADLINE NOTIFY] Failed for asset %s", asset_id)

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
            "contact2_value": contact2_value,
            "payment_deadline": payment_deadline_value
        })
        
    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        return jsonify({
            "ok": False,
            "error": str(e)
        }), 500


@app.route("/api/check_upload_limit", methods=["POST"])
def check_upload_limit():
    """Check if an email has reached the upload limit (4 artworks)."""
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    if not email:
        return jsonify({"ok": False, "error": "email required"}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM assets WHERE LOWER(TRIM(contact1_value)) = ? AND artist_name != ''",
        (email,)
    )
    count = cursor.fetchone()[0]
    conn.close()

    return jsonify({
        "ok": True,
        "count": count,
        "limit": UPLOAD_LIMIT,
        "allowed": count < UPLOAD_LIMIT
    })


@app.route("/api/abandon_upload", methods=["POST"])
def abandon_upload():
    """Clean up an abandoned upload (image uploaded but metadata never saved).

    Safety guard: only deletes if asset has empty artist_name.
    """
    data = request.get_json() or {}
    tile_id = (data.get("tile_id") or "").strip()
    asset_id = data.get("asset_id")

    if not tile_id or not asset_id:
        return jsonify({"ok": False, "error": "tile_id and asset_id required"}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()

        # Safety: only delete if artist_name is empty (never completed) and not an info tile
        cursor.execute(
            "SELECT tile_url, popup_url, artist_name, asset_type FROM assets WHERE asset_id = ?",
            (asset_id,)
        )
        asset = cursor.fetchone()

        if not asset:
            conn.close()
            return jsonify({"ok": True, "message": "asset not found, nothing to clean"})

        if (asset["asset_type"] or "artwork") == "info":
            conn.close()
            return jsonify({"ok": False, "error": "cannot abandon an info tile"}), 400

        if (asset["artist_name"] or "").strip():
            conn.close()
            return jsonify({"ok": False, "error": "cannot abandon a completed upload"}), 400

        # Delete uploaded files
        for url_field in ("tile_url", "popup_url"):
            url = asset[url_field] or ""
            if url.startswith("/uploads/"):
                filepath = os.path.join(UPLOAD_DIR, url[len("/uploads/"):])
                try:
                    os.remove(filepath)
                except OSError:
                    pass

        # Clear tile assignment
        cursor.execute(
            "UPDATE tiles SET asset_id = NULL, updated_at = datetime('now') WHERE tile_id = ?",
            (tile_id,)
        )

        # Delete asset row
        cursor.execute("DELETE FROM assets WHERE asset_id = ?", (asset_id,))

        conn.commit()
        conn.close()
        return jsonify({"ok": True})

    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        return jsonify({"ok": False, "error": str(e)}), 500


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
                   a.contact2_type, a.contact2_value,
                   a.unlocked
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
                "contact2_value": "",
                "unlocked": 0
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
            "contact2_value": row["contact2_value"] or "",
            "unlocked": row["unlocked"] or 0
        })

    except Exception as e:
        if 'conn' in locals():
            conn.close()
        return jsonify({
            "ok": False,
            "error": str(e)
        }), 500


@app.route("/api/verify_edit_code", methods=["POST"])
def verify_edit_code():
    """Verify an edit code + artwork title to find the matching tile."""
    try:
        data = request.get_json() or {}
        code = (data.get("code") or "").strip()
        title = (data.get("title") or "").strip()

        if not code or not title:
            return jsonify({"ok": False, "error": "Please enter both your artwork title and edit code."}), 400

        # Normalize title: lowercase, strip trailing periods
        normalized_title = title.lower().rstrip(".")

        conn = get_db()
        cursor = conn.cursor()

        # Look up code in edit_codes → get email
        cursor.execute("SELECT email FROM edit_codes WHERE code = ?", (code,))
        code_row = cursor.fetchone()
        if not code_row:
            conn.close()
            return jsonify({"ok": False, "error": "Invalid edit code."})

        code_email = code_row["email"].lower()

        # Find tile where artwork title matches AND contact email matches
        cursor.execute("""
            SELECT t.tile_id
            FROM tiles t
            JOIN assets a ON a.asset_id = t.asset_id
            WHERE RTRIM(LOWER(TRIM(a.artwork_title)), '.') = ?
              AND LOWER(a.contact1_value) = ?
        """, (normalized_title, code_email))
        match = cursor.fetchone()
        conn.close()

        if not match:
            return jsonify({"ok": False, "error": "No matching artwork found. Check your title and edit code."})

        return jsonify({"ok": True, "tile_id": match["tile_id"]})

    except Exception as e:
        if 'conn' in locals():
            conn.close()
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/resend_edit_code", methods=["POST"])
def resend_edit_code_endpoint():
    """Resend edit code to an email address (privacy-safe: same response regardless)."""
    try:
        data = request.get_json() or {}
        email = (data.get("email") or "").strip().lower()

        if not email:
            return jsonify({"ok": False, "error": "Please enter your email address."}), 400

        conn = get_db()
        cursor = conn.cursor()

        cursor.execute("SELECT code FROM edit_codes WHERE email = ?", (email,))
        code_row = cursor.fetchone()

        if code_row:
            edit_code = code_row["code"]
            send_edit_code(email, edit_code)

        conn.close()

        # Always return success (don't reveal if email exists)
        return jsonify({"ok": True, "message": "If an edit code exists for this email, it has been resent."})

    except Exception as e:
        if 'conn' in locals():
            conn.close()
        return jsonify({"ok": False, "error": str(e)}), 500


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
                             contact2_type, contact2_value,
                             unlocked, qualified_floor, stripe_payment_id,
                             payment_deadline FROM assets""")
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
                                  contact2_type, contact2_value,
                                  unlocked, qualified_floor, stripe_payment_id,
                                  payment_deadline)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (a["asset_id"], a["artist_name"], a["artwork_title"], a["tile_url"], a["popup_url"],
             a.get("year_created", ""), a.get("medium", ""), a.get("dimensions", ""),
             a.get("edition_info", ""), a.get("for_sale", ""), a.get("sale_type", ""),
             a.get("artist_contact", ""),
             a.get("contact1_type", ""), a.get("contact1_value", ""),
             a.get("contact2_type", ""), a.get("contact2_value", ""),
             a.get("unlocked", 0), a.get("qualified_floor", "s"),
             a.get("stripe_payment_id"), a.get("payment_deadline"))
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
                   a.tile_url, a.popup_url, a.unlocked, a.qualified_floor
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
                "popup_url": row["popup_url"] or "",
                "unlocked": row["unlocked"] or 0,
                "qualified_floor": row["qualified_floor"] or "s"
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


def _run_shuffle():
    """Core shuffle logic: redistribute all images respecting qualified_floor constraints.

    Returns (ok, message) tuple. Saves history snapshot before shuffling.
    """
    import random

    _save_history_snapshot(is_shuffle=True)

    conn = get_db()
    cursor = conn.cursor()

    # Get occupied tiles with unlock + floor info
    cursor.execute("""
        SELECT t.tile_id, t.asset_id, a.unlocked, a.qualified_floor
        FROM tiles t
        JOIN assets a ON a.asset_id = t.asset_id
        WHERE t.asset_id IS NOT NULL
    """)
    occupied = [dict(row) for row in cursor.fetchall()]

    if not occupied:
        conn.close()
        return (True, "No tiles to shuffle")

    # Build tile pools grouped by size, shuffle each
    tile_size_map = get_tile_size_map()
    pools = {}  # size -> [tile_id, ...]
    for tid, sz in tile_size_map.items():
        pools.setdefault(sz, []).append(tid)
    for sz in pools:
        random.shuffle(pools[sz])

    # Sort artwork by constraint level (most constrained first)
    def constraint_key(o):
        if not o['unlocked']:
            return (0, 0)  # S only — most constrained
        floor = o.get('qualified_floor', 's') or 's'
        floor_idx = SIZE_ORDER.get(floor, 0)
        if floor_idx > 0:
            return (1, -floor_idx)  # Higher floor = fewer options = earlier
        return (2, 0)  # Unlocked floor=s — least constrained

    random.shuffle(occupied)  # Random within same constraint level
    occupied.sort(key=constraint_key)

    # Clear all tile assignments
    cursor.execute("UPDATE tiles SET asset_id = NULL, updated_at = datetime('now')")

    # Record original tile for each artwork so no artwork stays in its previous tile
    original_tile = {o['asset_id']: o['tile_id'] for o in occupied}

    # Track assignments for swap fallback: asset_id -> assigned tile_id
    assignments = {}

    # Assign tiles: single loop with weighted random by remaining pool count
    for o in occupied:
        asset_id = o['asset_id']
        orig_tid = original_tile[asset_id]
        floor = o.get('qualified_floor', 's') or 's'

        if not o['unlocked']:
            eligible_sizes = ['s']
        else:
            floor_idx = SIZE_ORDER.get(floor, 0)
            eligible_sizes = [s for s in SIZE_NAMES if SIZE_ORDER[s] >= floor_idx]

        # Collect available tiles across eligible sizes with weights
        # Exclude the artwork's original tile from candidate counts
        candidates = []
        weights = []
        for sz in eligible_sizes:
            pool = pools.get(sz, [])
            available = [t for t in pool if t != orig_tid]
            if available:
                candidates.append(sz)
                weights.append(len(available))

        if not candidates:
            # Fallback: original tile is the only one left in its pool.
            # Swap with a previously-assigned artwork in the same size class.
            orig_size = tile_size_map.get(orig_tid)
            swapped = False
            for prev_asset, prev_tid in assignments.items():
                if tile_size_map.get(prev_tid) in eligible_sizes and \
                   prev_tid != orig_tid and \
                   original_tile[prev_asset] != orig_tid:
                    # Swap: give this artwork the other's tile, put other on orig_tid
                    assignments[asset_id] = prev_tid
                    assignments[prev_asset] = orig_tid
                    swapped = True
                    break
            if not swapped:
                # Truly impossible (single artwork, single tile) — keep in place
                assignments[asset_id] = orig_tid
            continue

        # Weighted random pick: more tiles in a size = higher probability
        total = sum(weights)
        roll = random.random() * total
        cumulative = 0
        chosen_size = candidates[0]
        for sz, w in zip(candidates, weights):
            cumulative += w
            if roll < cumulative:
                chosen_size = sz
                break

        # Pick a tile from the chosen pool, skipping original tile
        pool = pools[chosen_size]
        tid = None
        for i in range(len(pool) - 1, -1, -1):
            if pool[i] != orig_tid:
                tid = pool.pop(i)
                break

        if tid is None:
            # Should not happen given candidate filtering above, but be safe
            tid = pool.pop()

        assignments[asset_id] = tid

    # Write all assignments to database
    for asset_id, tid in assignments.items():
        cursor.execute(
            "INSERT OR REPLACE INTO tiles(tile_id, asset_id, updated_at) VALUES(?, ?, datetime('now'))",
            (tid, asset_id)
        )

    conn.commit()

    # Post-shuffle upgrade notifications: email artists whose artwork landed above their floor
    try:
        tile_size_map = get_tile_size_map()
        tier_for_size = TIER_FOR_SIZE
        notification_candidates = []

        for o in occupied:
            aid = o['asset_id']
            if aid not in assignments:
                continue
            new_size = tile_size_map.get(assignments[aid])
            if not new_size or new_size == 's':
                continue
            current_floor = o.get('qualified_floor') or 's'
            if SIZE_ORDER.get(new_size, 0) > SIZE_ORDER.get(current_floor, 0):
                notification_candidates.append((aid, new_size))

        if notification_candidates:
            candidate_ids = [c[0] for c in notification_candidates]
            placeholders = ','.join('?' * len(candidate_ids))
            cursor.execute(
                f"SELECT asset_id, artwork_title, contact1_value FROM assets WHERE asset_id IN ({placeholders})",
                candidate_ids
            )
            asset_info = {row['asset_id']: row for row in cursor.fetchall()}

            # Batch-fetch edit codes for notification emails
            notify_emails = set()
            for aid, _ in notification_candidates:
                info = asset_info.get(aid)
                if info:
                    em = (info['contact1_value'] or '').strip()
                    if em:
                        notify_emails.add(em)
            edit_code_map = {}
            if notify_emails:
                email_list = list(notify_emails)
                ep = ','.join('?' * len(email_list))
                cursor.execute(f"SELECT email, code FROM edit_codes WHERE email IN ({ep})", email_list)
                edit_code_map = {row['email']: row['code'] for row in cursor.fetchall()}

            sent = 0
            for aid, new_size in notification_candidates:
                info = asset_info.get(aid)
                if not info:
                    continue
                email = (info['contact1_value'] or '').strip()
                if not email:
                    continue
                if sent > 0:
                    time.sleep(0.6)
                tier_name = tier_for_size.get(new_size)
                price_cents = TIER_CONFIG[tier_name]['price_cents'] if tier_name else 0
                access_code = edit_code_map.get(email, '')
                for attempt in range(3):
                    try:
                        send_upgrade_notification(email, info['artwork_title'] or '', new_size, price_cents, asset_id=aid, access_code=access_code)
                        sent += 1
                        break
                    except Exception:
                        if attempt < 2:
                            time.sleep(1.5 * (attempt + 1))
                        else:
                            app.logger.exception("[SHUFFLE] Upgrade notification failed after 3 attempts: asset %s, email %s", aid, email)
    except Exception:
        app.logger.exception("[SHUFFLE] Upgrade notification error (shuffle succeeded)")

    conn.close()

    return (True, f"Shuffled {len(occupied)} tiles")


@app.route("/shuffle", methods=["POST"])
def shuffle_tiles():
    """Randomly redistribute all images respecting qualified_floor constraints."""
    data = request.get_json() or {}
    pin = data.get("pin", "")

    if pin != ADMIN_PIN:
        return jsonify({"ok": False, "error": "Unauthorized"}), 403

    try:
        ok, message = _run_shuffle()
        return jsonify({
            "ok": ok,
            "message": message,
            "shuffle_count": len(_shuffle_history),
            "non_shuffle_count": len(_undo_history)
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/admin/force_unlock", methods=["POST"])
def admin_force_unlock():
    """Set unlocked to 0 or 1 explicitly (not toggle). Resets floor to s when locking."""
    ok, err = check_admin_pin()
    if not ok:
        return err

    data = request.get_json() or {}
    asset_id = data.get("asset_id")
    unlocked = data.get("unlocked")

    if asset_id is None:
        return jsonify({"ok": False, "error": "missing asset_id"}), 400
    if unlocked not in (0, 1):
        return jsonify({"ok": False, "error": "unlocked must be 0 or 1"}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()

        cursor.execute("SELECT asset_id FROM assets WHERE asset_id = ?", (asset_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({"ok": False, "error": "asset not found"}), 404

        if unlocked == 0:
            # Locking: also reset qualified_floor to s for consistency
            cursor.execute(
                "UPDATE assets SET unlocked = 0, qualified_floor = 's' WHERE asset_id = ?",
                (asset_id,)
            )
        else:
            cursor.execute(
                "UPDATE assets SET unlocked = 1, payment_deadline = NULL WHERE asset_id = ?",
                (asset_id,)
            )

            # Clear deadline on sibling artwork if this email now has <= 1 free tile
            cursor.execute("SELECT contact1_value FROM assets WHERE asset_id = ?", (asset_id,))
            asset_row = cursor.fetchone()
            email = (asset_row["contact1_value"] or "").strip().lower() if asset_row else ""
            if email:
                cursor.execute(
                    "SELECT COUNT(*) FROM assets WHERE LOWER(TRIM(contact1_value)) = ? AND unlocked = 0 AND artist_name != ''",
                    (email,)
                )
                free_remaining = cursor.fetchone()[0]
                if free_remaining <= 1:
                    cursor.execute(
                        "UPDATE assets SET payment_deadline = NULL WHERE LOWER(TRIM(contact1_value)) = ? AND unlocked = 0 AND payment_deadline IS NOT NULL",
                        (email,)
                    )

        conn.commit()
        conn.close()

        return jsonify({
            "ok": True,
            "asset_id": asset_id,
            "unlocked": unlocked
        })
    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/admin/set_qualified_floor", methods=["POST"])
def admin_set_qualified_floor():
    """Admin override: set the qualified floor for an artwork. Auto-unlocks if floor > s."""
    ok, err = check_admin_pin()
    if not ok:
        return err

    data = request.get_json() or {}
    asset_id = data.get("asset_id")
    floor = data.get("qualified_floor", "").strip().lower()

    if asset_id is None:
        return jsonify({"ok": False, "error": "missing asset_id"}), 400
    if floor not in SIZE_ORDER:
        return jsonify({"ok": False, "error": f"qualified_floor must be one of: {', '.join(SIZE_NAMES)}"}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()

        cursor.execute("SELECT asset_id FROM assets WHERE asset_id = ?", (asset_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({"ok": False, "error": "asset not found"}), 404

        # If floor > s, auto-set unlocked=1 (having a floor implies unlocked)
        if floor != 's':
            cursor.execute(
                "UPDATE assets SET qualified_floor = ?, unlocked = 1 WHERE asset_id = ?",
                (floor, asset_id)
            )
        else:
            cursor.execute(
                "UPDATE assets SET qualified_floor = 's' WHERE asset_id = ?",
                (asset_id,)
            )

        conn.commit()
        conn.close()

        return jsonify({
            "ok": True,
            "asset_id": asset_id,
            "qualified_floor": floor
        })
    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/lock_tile", methods=["POST"])
def lock_tile():
    """Lock artwork at its current tile size (admin/direct use).

    Sets qualified_floor to the current tile's size and unlocked=1.
    Accepts optional payment_id for future Stripe webhook integration.
    Rejects if artwork is in an S tile (nothing to lock).

    Note: The public Stripe payment flow uses /api/stripe/checkout + webhook instead.
    """
    data = request.get_json() or {}
    asset_id = data.get("asset_id")
    payment_id = data.get("payment_id")

    if asset_id is None:
        return jsonify({"ok": False, "error": "missing asset_id"}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()

        # Look up the asset's current tile
        cursor.execute("""
            SELECT t.tile_id FROM tiles t WHERE t.asset_id = ?
        """, (asset_id,))
        row = cursor.fetchone()

        if not row:
            conn.close()
            return jsonify({"ok": False, "error": "asset not assigned to any tile"}), 404

        tile_id = row["tile_id"]
        tile_size_map = get_tile_size_map()
        current_size = tile_size_map.get(tile_id, 's')

        if current_size == 's':
            conn.close()
            return jsonify({"ok": False, "error": "cannot lock at S size"}), 400

        # Set the floor and unlock (clear any payment deadline)
        cursor.execute(
            "UPDATE assets SET qualified_floor = ?, unlocked = 1, stripe_payment_id = ?, payment_deadline = NULL WHERE asset_id = ?",
            (current_size, payment_id, asset_id)
        )

        conn.commit()
        conn.close()

        return jsonify({
            "ok": True,
            "asset_id": asset_id,
            "qualified_floor": current_size,
            "tile_id": tile_id
        })
    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        return jsonify({"ok": False, "error": str(e)}), 500


# ---- Countdown Timer ----

def _parse_iso_utc(s):
    """Parse ISO 8601 string to UTC-aware datetime. Handles 'Z' suffix for Python 3.9."""
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)

@app.route("/api/countdown_state", methods=["GET"])
def get_countdown_state():
    """Return current countdown state, with server-side auto-transitions."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT status, target_time, start_time, duration_seconds FROM countdown_schedule WHERE id = 1")
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"status": "cleared", "target_time": None, "start_time": None, "duration_seconds": 604800})

    status = row["status"]
    target_time = row["target_time"]
    start_time = row["start_time"]
    duration_seconds = row["duration_seconds"]
    now = datetime.now(timezone.utc)

    # Auto-transition: scheduled -> active
    if status == "scheduled" and start_time:
        start_dt = _parse_iso_utc(start_time)
        if now >= start_dt:
            status = "active"
            cursor.execute(
                "UPDATE countdown_schedule SET status = 'active', updated_at = datetime('now') WHERE id = 1"
            )
            conn.commit()

    # Auto-transition: active -> auto-reset (countdown expired) + trigger shuffle
    if status == "active" and target_time:
        target_dt = _parse_iso_utc(target_time)
        if now >= target_dt:
            # Run shuffle before resetting the countdown cycle
            try:
                _run_shuffle()
                app.logger.info("Countdown expired: auto-shuffle completed")
            except Exception as e:
                app.logger.error(f"Countdown expired: auto-shuffle failed: {e}")

            new_target = now + timedelta(seconds=duration_seconds)
            target_time = new_target.strftime("%Y-%m-%dT%H:%M:%SZ")
            cursor.execute(
                "UPDATE countdown_schedule SET target_time = ?, updated_at = datetime('now') WHERE id = 1",
                (target_time,)
            )
            conn.commit()

    conn.close()
    return jsonify({
        "status": status,
        "target_time": target_time,
        "start_time": start_time,
        "duration_seconds": duration_seconds
    })


@app.route("/api/admin/countdown", methods=["POST"])
def admin_countdown():
    """Admin endpoint to control countdown timer."""
    ok, err = check_admin_pin()
    if not ok:
        return err

    data = request.get_json(force=True)
    action = data.get("action", "")

    conn = get_db()
    cursor = conn.cursor()
    now = datetime.now(timezone.utc)

    if action == "set_active":
        duration = int(data.get("duration_seconds", 604800))
        target = now + timedelta(seconds=duration)
        target_time = target.strftime("%Y-%m-%dT%H:%M:%SZ")
        cursor.execute(
            "UPDATE countdown_schedule SET status = 'active', target_time = ?, start_time = NULL, duration_seconds = ?, updated_at = datetime('now') WHERE id = 1",
            (target_time, duration)
        )
        conn.commit()
        conn.close()
        return jsonify({"ok": True, "status": "active", "target_time": target_time, "duration_seconds": duration})

    elif action == "set_scheduled":
        duration = int(data.get("duration_seconds", 604800))
        start_time = data.get("start_time", "")
        if not start_time:
            conn.close()
            return jsonify({"ok": False, "error": "start_time is required for scheduling"}), 400
        start_dt = _parse_iso_utc(start_time)
        target_dt = start_dt + timedelta(seconds=duration)
        target_time = target_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        start_time_iso = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        cursor.execute(
            "UPDATE countdown_schedule SET status = 'scheduled', target_time = ?, start_time = ?, duration_seconds = ?, updated_at = datetime('now') WHERE id = 1",
            (target_time, start_time_iso, duration)
        )
        conn.commit()
        conn.close()
        return jsonify({"ok": True, "status": "scheduled", "target_time": target_time, "start_time": start_time_iso, "duration_seconds": duration})

    elif action == "clear":
        cursor.execute(
            "UPDATE countdown_schedule SET status = 'cleared', target_time = NULL, start_time = NULL, updated_at = datetime('now') WHERE id = 1"
        )
        conn.commit()
        conn.close()
        return jsonify({"ok": True, "status": "cleared"})

    else:
        conn.close()
        return jsonify({"ok": False, "error": "Unknown action"}), 400


# ---- Stripe / Upgrade Endpoints ----

@app.route("/api/my_artworks", methods=["POST"])
def my_artworks():
    """Return all artworks owned by the email associated with an edit code."""
    try:
        data = request.get_json() or {}
        code = (data.get("code") or "").strip()

        if not code:
            return jsonify({"ok": False, "error": "Please enter your edit code."}), 400

        conn = get_db()
        cursor = conn.cursor()

        # Look up code → email
        cursor.execute("SELECT email FROM edit_codes WHERE code = ?", (code,))
        code_row = cursor.fetchone()
        if not code_row:
            conn.close()
            return jsonify({"ok": False, "error": "Invalid edit code."}), 400

        email = code_row["email"].lower()

        # Build tile size map for current size lookup
        tile_size_map = get_tile_size_map()

        # Find all assets where contact1_value matches this email
        cursor.execute("""
            SELECT a.asset_id, a.artwork_title, a.artist_name, a.tile_url,
                   a.unlocked, a.qualified_floor, a.asset_type, t.tile_id
            FROM assets a
            LEFT JOIN tiles t ON t.asset_id = a.asset_id
            WHERE LOWER(a.contact1_value) = ?
        """, (email,))
        rows = cursor.fetchall()
        conn.close()

        artworks = []
        for row in rows:
            tile_id = row["tile_id"]
            current_size = tile_size_map.get(tile_id, 's') if tile_id else 's'
            artworks.append({
                "asset_id": row["asset_id"],
                "artwork_title": row["artwork_title"],
                "artist_name": row["artist_name"],
                "tile_url": row["tile_url"],
                "tile_id": tile_id,
                "current_size": current_size,
                "unlocked": row["unlocked"],
                "qualified_floor": row["qualified_floor"],
                "asset_type": row["asset_type"],
            })

        return jsonify({"ok": True, "email": email, "artworks": artworks})

    except Exception as e:
        if 'conn' in locals():
            conn.close()
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/upgrade_options/<int:asset_id>", methods=["GET"])
def upgrade_options(asset_id):
    """Return available upgrade tiers for an artwork, based on current state."""
    try:
        code = (request.args.get("code") or "").strip()
        if not code:
            return jsonify({"ok": False, "error": "Missing edit code."}), 400

        conn = get_db()
        cursor = conn.cursor()

        # Verify code → email
        cursor.execute("SELECT email FROM edit_codes WHERE code = ?", (code,))
        code_row = cursor.fetchone()
        if not code_row:
            conn.close()
            return jsonify({"ok": False, "error": "Invalid edit code."}), 400

        email = code_row["email"].lower()

        # Verify this email owns the asset
        cursor.execute("""
            SELECT a.asset_id, a.unlocked, a.qualified_floor, a.asset_type
            FROM assets a
            WHERE a.asset_id = ? AND LOWER(a.contact1_value) = ?
        """, (asset_id, email))
        asset_row = cursor.fetchone()

        if not asset_row:
            conn.close()
            return jsonify({"ok": False, "error": "Artwork not found or not owned by this account."}), 404

        unlocked = asset_row["unlocked"]
        current_floor = asset_row["qualified_floor"] or 's'
        current_floor_order = SIZE_ORDER.get(current_floor, 0)

        # Determine artwork's current tile size
        cursor.execute("SELECT tile_id FROM tiles WHERE asset_id = ?", (asset_id,))
        tile_row = cursor.fetchone()
        conn.close()

        current_tile_size = None
        if tile_row:
            tile_size_map = get_tile_size_map()
            current_tile_size = tile_size_map.get(tile_row["tile_id"])

        tiers = []
        for tier_name, cfg in TIER_CONFIG.items():
            if tier_name == 'exhibit':
                continue  # handled separately below
            tier_floor = cfg['floor']
            tier_floor_order = SIZE_ORDER.get(tier_floor, 0)

            tier_info = {
                'tier': tier_name,
                'label': cfg['label'],
                'price_cents': cfg['price_cents'],
                'floor': tier_floor,
            }

            if tier_name == 'unlock_s':
                if not unlocked:
                    tier_info['status'] = 'available'
                else:
                    tier_info['status'] = 'completed'
                    tier_info['reason'] = 'Already unlocked'
            else:
                # Floor upgrade tier — "lock what you landed on" model
                if not unlocked:
                    tier_info['status'] = 'locked'
                    tier_info['reason'] = 'Requires Unlock first'
                elif tier_floor_order <= current_floor_order:
                    tier_info['status'] = 'completed'
                    tier_info['reason'] = 'Already at or above this floor'
                elif current_tile_size and tier_floor == current_tile_size:
                    tier_info['status'] = 'available'
                else:
                    # Artwork is not in this tier's tile size
                    display_name = SIZE_DISPLAY.get(tier_floor, tier_floor.upper())
                    article = 'an' if display_name[0] in 'AEIOUaeiou' else 'a'
                    tier_info['status'] = 'locked'
                    tier_info['reason'] = f'Your artwork must be in {article} {display_name} tile'

            tiers.append(tier_info)

        # Exhibit tier — available for unlocked S/M/LG artworks not already exhibits
        exhibit_tier = {
            'tier': 'exhibit',
            'label': 'Exhibit Tile',
            'price_cents': TIER_CONFIG['exhibit']['price_cents'],
            'floor': None,
        }
        if asset_row["asset_type"] == 'exhibit':
            exhibit_tier['status'] = 'completed'
            exhibit_tier['reason'] = 'Already an Exhibit'
        elif not unlocked:
            exhibit_tier['status'] = 'locked'
            exhibit_tier['reason'] = 'Requires Unlock first'
        elif current_tile_size and current_tile_size in ('m', 'lg', 'xl'):
            exhibit_tier['status'] = 'available'
        else:
            exhibit_tier['status'] = 'locked'
            exhibit_tier['reason'] = 'Your artwork must be in a Medium, Large, or Extra Large tile'
        tiers.append(exhibit_tier)

        return jsonify({
            "ok": True,
            "asset_id": asset_id,
            "unlocked": unlocked,
            "qualified_floor": current_floor,
            "current_tile_size": current_tile_size,
            "tiers": tiers,
        })

    except Exception as e:
        if 'conn' in locals():
            conn.close()
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/stripe/checkout", methods=["POST"])
def stripe_checkout():
    """Create a Stripe Checkout session for an upgrade tier."""
    if not STRIPE_SECRET_KEY:
        return jsonify({"ok": False, "error": "Stripe is not configured."}), 503

    try:
        data = request.get_json() or {}
        asset_id = data.get("asset_id")
        tier = data.get("tier", "").strip()
        code = (data.get("code") or "").strip()

        if not asset_id or not tier or not code:
            return jsonify({"ok": False, "error": "Missing required fields."}), 400

        if tier not in TIER_CONFIG:
            return jsonify({"ok": False, "error": "Invalid tier."}), 400

        conn = get_db()
        cursor = conn.cursor()

        # Verify code → email
        cursor.execute("SELECT email FROM edit_codes WHERE code = ?", (code,))
        code_row = cursor.fetchone()
        if not code_row:
            conn.close()
            return jsonify({"ok": False, "error": "Invalid edit code."}), 400

        email = code_row["email"].lower()

        # Verify ownership and check prerequisites
        cursor.execute("""
            SELECT a.asset_id, a.unlocked, a.qualified_floor, a.artwork_title, a.artist_name, a.asset_type
            FROM assets a
            WHERE a.asset_id = ? AND LOWER(a.contact1_value) = ?
        """, (asset_id, email))
        asset_row = cursor.fetchone()

        if not asset_row:
            conn.close()
            return jsonify({"ok": False, "error": "Artwork not found or not owned by this account."}), 404

        unlocked = asset_row["unlocked"]
        current_floor = asset_row["qualified_floor"] or 's'
        current_floor_order = SIZE_ORDER.get(current_floor, 0)
        cfg = TIER_CONFIG[tier]

        # Prerequisite checks
        if tier == 'exhibit':
            # Exhibit tier: must be unlocked, in M/LG/XL tile, not already an exhibit
            if asset_row["asset_type"] == 'exhibit':
                conn.close()
                return jsonify({"ok": False, "error": "This artwork is already an Exhibit."}), 400
            if not unlocked:
                conn.close()
                return jsonify({"ok": False, "error": "Artwork must be unlocked first."}), 400
            cursor.execute("SELECT tile_id FROM tiles WHERE asset_id = ?", (asset_id,))
            tile_row = cursor.fetchone()
            if tile_row:
                tile_size_map = get_tile_size_map()
                current_tile_size = tile_size_map.get(tile_row["tile_id"])
                if current_tile_size not in ('m', 'lg', 'xl'):
                    conn.close()
                    return jsonify({"ok": False, "error": "Your artwork must be in a Medium, Large, or Extra Large tile."}), 400
            else:
                conn.close()
                return jsonify({"ok": False, "error": "Artwork is not placed on any tile."}), 400
        elif tier == 'unlock_s':
            if unlocked:
                conn.close()
                return jsonify({"ok": False, "error": "Artwork is already unlocked."}), 400
        else:
            tier_floor_order = SIZE_ORDER.get(cfg['floor'], 0)
            if not unlocked:
                conn.close()
                return jsonify({"ok": False, "error": "Artwork must be unlocked first."}), 400
            if tier_floor_order <= current_floor_order:
                conn.close()
                return jsonify({"ok": False, "error": "Artwork is already at or above this floor."}), 400

            # "Lock what you landed on" — verify artwork is currently in the tier's tile size
            cursor.execute("SELECT tile_id FROM tiles WHERE asset_id = ?", (asset_id,))
            tile_row = cursor.fetchone()
            if tile_row:
                tile_size_map = get_tile_size_map()
                current_tile_size = tile_size_map.get(tile_row["tile_id"])
                if current_tile_size != cfg['floor']:
                    display_name = SIZE_DISPLAY.get(cfg['floor'], cfg['floor'].upper())
                    conn.close()
                    article = 'an' if display_name[0] in 'AEIOUaeiou' else 'a'
                    return jsonify({"ok": False, "error": f"Your artwork must be in {article} {display_name} tile to purchase this upgrade."}), 400

        # Insert pending purchase record
        cursor.execute("""
            INSERT INTO purchase_history (asset_id, email, tier, amount_cents, status)
            VALUES (?, ?, ?, ?, 'pending')
        """, (asset_id, email, tier, cfg['price_cents']))
        purchase_id = cursor.lastrowid
        conn.commit()

        # Create Stripe Checkout Session
        artwork_title = asset_row["artwork_title"] or "Artwork"
        session = stripe.checkout.Session.create(
            mode="payment",
            customer_email=email,
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "unit_amount": cfg['price_cents'],
                    "product_data": {
                        "name": f"The Last Gallery — {cfg['label']}",
                        "description": f"Upgrade for \"{artwork_title}\"",
                    },
                },
                "quantity": 1,
            }],
            metadata={
                "asset_id": str(asset_id),
                "tier": tier,
                "purchase_id": str(purchase_id),
                "email": email,
            },
            success_url=f"{BASE_URL}/?purchase_success=1&type={tier}&asset_id={asset_id}",
            cancel_url=f"{BASE_URL}/?purchase_cancel=1",
        )

        # Store session ID on purchase record
        cursor.execute(
            "UPDATE purchase_history SET stripe_session_id = ? WHERE purchase_id = ?",
            (session.id, purchase_id)
        )
        conn.commit()
        conn.close()

        return jsonify({"ok": True, "checkout_url": session.url})

    except Exception as e:
        if 'conn' in locals():
            try:
                conn.rollback()
                conn.close()
            except Exception:
                pass
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/stripe/webhook", methods=["POST"])
def stripe_webhook():
    """Handle Stripe webhook events (checkout.session.completed)."""
    if not STRIPE_WEBHOOK_SECRET:
        return jsonify({"error": "Webhook not configured"}), 503

    payload = request.get_data()
    sig_header = request.headers.get("Stripe-Signature")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except ValueError:
        return jsonify({"error": "Invalid payload"}), 400
    except stripe.error.SignatureVerificationError:
        return jsonify({"error": "Invalid signature"}), 400

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        metadata = session.get("metadata", {})
        asset_id = metadata.get("asset_id")
        tier = metadata.get("tier")
        purchase_id = metadata.get("purchase_id")
        payment_intent = session.get("payment_intent")

        if not asset_id or not tier or not purchase_id:
            return jsonify({"ok": True}), 200

        # Map old tier names from pre-rename in-flight Stripe sessions
        OLD_TIER_MAP = {
            'unlock_xs': 'unlock_s',
            'floor_s': 'floor_m',
            'floor_m': 'floor_lg',
            'floor_lg': 'floor_xl',
        }
        tier = OLD_TIER_MAP.get(tier, tier)

        try:
            conn = get_db()
            cursor = conn.cursor()

            # Idempotency: skip if already fulfilled
            cursor.execute(
                "SELECT status FROM purchase_history WHERE purchase_id = ?",
                (purchase_id,)
            )
            purchase_row = cursor.fetchone()
            if purchase_row and purchase_row["status"] == "fulfilled":
                conn.close()
                return jsonify({"ok": True}), 200

            # Apply the upgrade
            cfg = TIER_CONFIG.get(tier)
            if cfg and tier == 'exhibit':
                # Exhibit fulfillment: set asset_type, lock floor at current tile size, create exhibits row
                # Determine current tile size for floor lock
                cursor.execute("SELECT tile_id FROM tiles WHERE asset_id = ?", (int(asset_id),))
                tile_row = cursor.fetchone()
                exhibit_floor = 'm'  # minimum exhibit size
                if tile_row:
                    tile_size_map = get_tile_size_map()
                    current_size = tile_size_map.get(tile_row["tile_id"])
                    if current_size in ('m', 'lg', 'xl'):
                        exhibit_floor = current_size
                cursor.execute(
                    "UPDATE assets SET asset_type = 'exhibit', qualified_floor = ?, unlocked = 1, stripe_payment_id = ?, payment_deadline = NULL WHERE asset_id = ?",
                    (exhibit_floor, payment_intent, int(asset_id))
                )
                cursor.execute("""
                    INSERT OR IGNORE INTO exhibits (asset_id) VALUES (?)
                """, (int(asset_id),))
                exhibit_id = cursor.execute(
                    "SELECT exhibit_id FROM exhibits WHERE asset_id = ?", (int(asset_id),)
                ).fetchone()["exhibit_id"]
                # Seed the tile's artwork as exhibit image #1
                cursor.execute(
                    "SELECT popup_url, artwork_title, artist_name, year_created, medium, dimensions, edition_info, for_sale, sale_type, contact1_type, contact1_value, contact2_type, contact2_value FROM assets WHERE asset_id = ?",
                    (int(asset_id),)
                )
                src = cursor.fetchone()
                if src:
                    # Generate thumbnail for the seeded image
                    seed_thumb_url = ''
                    popup_path = src["popup_url"].lstrip('/')
                    full_popup_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), popup_path)
                    if os.path.isfile(full_popup_path):
                        ex_dir = os.path.join(UPLOAD_DIR, 'exhibits', str(exhibit_id))
                        os.makedirs(ex_dir, exist_ok=True)
                        seed_thumb_name = f"thumb_{uuid.uuid4().hex[:12]}.jpg"
                        seed_thumb_buf = _make_center_thumb(full_popup_path)
                        if seed_thumb_buf:
                            with open(os.path.join(ex_dir, seed_thumb_name), 'wb') as tf:
                                tf.write(seed_thumb_buf.getvalue())
                            seed_thumb_url = f'/uploads/exhibits/{exhibit_id}/{seed_thumb_name}'
                    cursor.execute("""
                        INSERT INTO exhibit_images (exhibit_id, image_url, source_asset_id, display_order,
                            artwork_title, artist_name, year_created, medium, dimensions, edition_info,
                            for_sale, sale_type, contact1_type, contact1_value, contact2_type, contact2_value, thumb_url)
                        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (exhibit_id, src["popup_url"], int(asset_id),
                          src["artwork_title"], src["artist_name"], src["year_created"],
                          src["medium"], src["dimensions"], src["edition_info"],
                          src["for_sale"], src["sale_type"], src["contact1_type"],
                          src["contact1_value"], src["contact2_type"], src["contact2_value"],
                          seed_thumb_url))
            elif cfg:
                floor_value = cfg['floor']
                cursor.execute(
                    "UPDATE assets SET unlocked = 1, qualified_floor = ?, stripe_payment_id = ?, payment_deadline = NULL WHERE asset_id = ?",
                    (floor_value, payment_intent, int(asset_id))
                )

            # Mark purchase as fulfilled
            cursor.execute(
                "UPDATE purchase_history SET status = 'fulfilled', fulfilled_at = datetime('now'), stripe_payment_intent = ? WHERE purchase_id = ?",
                (payment_intent, int(purchase_id))
            )

            # Clear deadline on sibling artwork if this email now has <= 1 free tile
            email = metadata.get("email", "").lower()
            if email:
                cursor.execute(
                    "SELECT COUNT(*) FROM assets WHERE LOWER(TRIM(contact1_value)) = ? AND unlocked = 0 AND artist_name != ''",
                    (email,)
                )
                free_remaining = cursor.fetchone()[0]
                if free_remaining <= 1:
                    cursor.execute(
                        "UPDATE assets SET payment_deadline = NULL WHERE LOWER(TRIM(contact1_value)) = ? AND unlocked = 0 AND payment_deadline IS NOT NULL",
                        (email,)
                    )

            conn.commit()
            conn.close()
        except Exception as e:
            if 'conn' in locals():
                try:
                    conn.rollback()
                    conn.close()
                except Exception:
                    pass
            print(f"[STRIPE WEBHOOK ERROR] {e}")

    # Always return 200 to Stripe
    return jsonify({"ok": True}), 200


# ========================================
# Exhibit API Endpoints
# ========================================

@app.route("/api/exhibit/<int:exhibit_id>/upload_image", methods=["POST"])
def upload_exhibit_image(exhibit_id):
    """Upload a new image to an exhibit."""
    code = (request.form.get("code") or "").strip()
    if not code:
        return jsonify({"ok": False, "error": "Missing edit code."}), 400

    conn = get_db()
    cursor = conn.cursor()

    # Verify ownership via exhibit → asset → email
    cursor.execute("SELECT e.exhibit_id, e.asset_id FROM exhibits e WHERE e.exhibit_id = ?", (exhibit_id,))
    exhibit = cursor.fetchone()
    if not exhibit:
        conn.close()
        return jsonify({"ok": False, "error": "Exhibit not found."}), 404

    cursor.execute("SELECT email FROM edit_codes WHERE code = ?", (code,))
    code_row = cursor.fetchone()
    if not code_row:
        conn.close()
        return jsonify({"ok": False, "error": "Invalid edit code."}), 400
    email = code_row["email"].lower()

    cursor.execute(
        "SELECT asset_id FROM assets WHERE asset_id = ? AND LOWER(contact1_value) = ?",
        (exhibit["asset_id"], email)
    )
    if not cursor.fetchone():
        conn.close()
        return jsonify({"ok": False, "error": "Not authorized."}), 403

    # Check 20-image limit
    cursor.execute("SELECT COUNT(*) FROM exhibit_images WHERE exhibit_id = ?", (exhibit_id,))
    count = cursor.fetchone()[0]
    if count >= 20:
        conn.close()
        return jsonify({"ok": False, "error": "Maximum 20 images reached."}), 400

    # Process uploaded image
    if 'image' not in request.files:
        conn.close()
        return jsonify({"ok": False, "error": "No image file provided."}), 400

    file = request.files['image']
    if not file or not file.filename:
        conn.close()
        return jsonify({"ok": False, "error": "Empty file."}), 400

    exhibit_dir = os.path.join(UPLOAD_DIR, 'exhibits', str(exhibit_id))
    os.makedirs(exhibit_dir, exist_ok=True)

    filename = f"gallery_{uuid.uuid4().hex[:12]}.jpg"
    filepath = os.path.join(exhibit_dir, filename)

    optimized = _optimize_image(file)
    with open(filepath, 'wb') as f:
        f.write(optimized.getvalue())

    image_url = f'/uploads/exhibits/{exhibit_id}/{filename}'

    # Generate center-cropped square thumbnail
    thumb_filename = f"thumb_{uuid.uuid4().hex[:12]}.jpg"
    thumb_filepath = os.path.join(exhibit_dir, thumb_filename)
    thumb_url = ''
    thumb_buf = _make_center_thumb(filepath)
    if thumb_buf:
        with open(thumb_filepath, 'wb') as f:
            f.write(thumb_buf.getvalue())
        thumb_url = f'/uploads/exhibits/{exhibit_id}/{thumb_filename}'

    # Get next display_order
    cursor.execute("SELECT COALESCE(MAX(display_order), 0) + 1 FROM exhibit_images WHERE exhibit_id = ?", (exhibit_id,))
    next_order = cursor.fetchone()[0]

    # Get artist_name from parent asset for pre-fill
    cursor.execute("SELECT artist_name FROM assets WHERE asset_id = ?", (exhibit["asset_id"],))
    artist_row = cursor.fetchone()
    artist_name = artist_row["artist_name"] if artist_row else ""

    cursor.execute("""
        INSERT INTO exhibit_images (exhibit_id, image_url, display_order, artist_name, thumb_url)
        VALUES (?, ?, ?, ?, ?)
    """, (exhibit_id, image_url, next_order, artist_name, thumb_url))
    image_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return jsonify({"ok": True, "image_id": image_id, "image_url": image_url, "thumb_url": thumb_url, "display_order": next_order})


@app.route("/api/exhibit/<int:exhibit_id>/image/<int:image_id>/metadata", methods=["POST"])
def update_exhibit_image_metadata(exhibit_id, image_id):
    """Update metadata for an exhibit image."""
    data = request.get_json() or {}
    code = data.get("code", "").strip()
    if not code:
        return jsonify({"ok": False, "error": "Missing edit code."}), 400

    conn = get_db()
    cursor = conn.cursor()

    # Verify ownership
    cursor.execute("SELECT asset_id FROM exhibits WHERE exhibit_id = ?", (exhibit_id,))
    exhibit = cursor.fetchone()
    if not exhibit:
        conn.close()
        return jsonify({"ok": False, "error": "Exhibit not found."}), 404

    cursor.execute("SELECT email FROM edit_codes WHERE code = ?", (code,))
    code_row = cursor.fetchone()
    if not code_row:
        conn.close()
        return jsonify({"ok": False, "error": "Invalid edit code."}), 400
    email = code_row["email"].lower()

    cursor.execute(
        "SELECT asset_id FROM assets WHERE asset_id = ? AND LOWER(contact1_value) = ?",
        (exhibit["asset_id"], email)
    )
    if not cursor.fetchone():
        conn.close()
        return jsonify({"ok": False, "error": "Not authorized."}), 403

    # Verify image belongs to this exhibit
    cursor.execute("SELECT image_id FROM exhibit_images WHERE image_id = ? AND exhibit_id = ?", (image_id, exhibit_id))
    if not cursor.fetchone():
        conn.close()
        return jsonify({"ok": False, "error": "Image not found."}), 404

    cursor.execute("""
        UPDATE exhibit_images SET
            artwork_title = ?, artist_name = ?, year_created = ?, medium = ?,
            dimensions = ?, edition_info = ?, for_sale = ?, sale_type = ?,
            contact1_type = ?, contact1_value = ?, contact2_type = ?, contact2_value = ?
        WHERE image_id = ?
    """, (
        data.get("artwork_title", "").strip(),
        data.get("artist_name", "").strip(),
        data.get("year_created", "").strip(),
        data.get("medium", "").strip(),
        data.get("dimensions", "").strip(),
        data.get("edition_info", "").strip(),
        data.get("for_sale", "").strip(),
        data.get("sale_type", "").strip(),
        data.get("contact1_type", "").strip(),
        data.get("contact1_value", "").strip(),
        data.get("contact2_type", "").strip(),
        data.get("contact2_value", "").strip(),
        image_id,
    ))
    conn.commit()
    conn.close()

    return jsonify({"ok": True})


@app.route("/api/exhibit/<int:exhibit_id>/image/<int:image_id>", methods=["DELETE"])
def delete_exhibit_image(exhibit_id, image_id):
    """Remove an image from an exhibit."""
    data = request.get_json() or {}
    code = data.get("code", "").strip()
    if not code:
        return jsonify({"ok": False, "error": "Missing edit code."}), 400

    conn = get_db()
    cursor = conn.cursor()

    # Verify ownership
    cursor.execute("SELECT asset_id FROM exhibits WHERE exhibit_id = ?", (exhibit_id,))
    exhibit = cursor.fetchone()
    if not exhibit:
        conn.close()
        return jsonify({"ok": False, "error": "Exhibit not found."}), 404

    cursor.execute("SELECT email FROM edit_codes WHERE code = ?", (code,))
    code_row = cursor.fetchone()
    if not code_row:
        conn.close()
        return jsonify({"ok": False, "error": "Invalid edit code."}), 400
    email = code_row["email"].lower()

    cursor.execute(
        "SELECT asset_id FROM assets WHERE asset_id = ? AND LOWER(contact1_value) = ?",
        (exhibit["asset_id"], email)
    )
    if not cursor.fetchone():
        conn.close()
        return jsonify({"ok": False, "error": "Not authorized."}), 403

    # Get image details
    cursor.execute(
        "SELECT image_id, image_url, thumb_url, source_asset_id FROM exhibit_images WHERE image_id = ? AND exhibit_id = ?",
        (image_id, exhibit_id)
    )
    img_row = cursor.fetchone()
    if not img_row:
        conn.close()
        return jsonify({"ok": False, "error": "Image not found."}), 404

    # Prevent removal of the tile's original artwork
    if img_row["source_asset_id"] == exhibit["asset_id"]:
        conn.close()
        return jsonify({"ok": False, "error": "Cannot remove the tile's original artwork from the exhibit."}), 400

    # Delete files if it's an exhibit-only upload (not a source_asset_id reference)
    if not img_row["source_asset_id"]:
        for url_col in ("image_url", "thumb_url"):
            rel_path = img_row[url_col] or ""
            if rel_path.startswith('/uploads/'):
                rel_path = rel_path[len('/uploads/'):]
                file_path = os.path.join(UPLOAD_DIR, rel_path)
                if os.path.exists(file_path):
                    os.remove(file_path)

    cursor.execute("DELETE FROM exhibit_images WHERE image_id = ?", (image_id,))

    # Reorder remaining images
    cursor.execute(
        "SELECT image_id FROM exhibit_images WHERE exhibit_id = ? ORDER BY display_order",
        (exhibit_id,)
    )
    for idx, row in enumerate(cursor.fetchall(), 1):
        cursor.execute("UPDATE exhibit_images SET display_order = ? WHERE image_id = ?", (idx, row["image_id"]))

    conn.commit()
    conn.close()

    return jsonify({"ok": True})


@app.route("/api/exhibit/<int:exhibit_id>/reorder", methods=["POST"])
def reorder_exhibit_images(exhibit_id):
    """Reorder exhibit images. Body: {code, order: [image_id, ...]}"""
    data = request.get_json() or {}
    code = data.get("code", "").strip()
    order = data.get("order", [])

    if not code:
        return jsonify({"ok": False, "error": "Missing edit code."}), 400
    if not order or not isinstance(order, list):
        return jsonify({"ok": False, "error": "Missing order array."}), 400

    conn = get_db()
    cursor = conn.cursor()

    # Verify ownership
    cursor.execute("SELECT asset_id FROM exhibits WHERE exhibit_id = ?", (exhibit_id,))
    exhibit = cursor.fetchone()
    if not exhibit:
        conn.close()
        return jsonify({"ok": False, "error": "Exhibit not found."}), 404

    cursor.execute("SELECT email FROM edit_codes WHERE code = ?", (code,))
    code_row = cursor.fetchone()
    if not code_row:
        conn.close()
        return jsonify({"ok": False, "error": "Invalid edit code."}), 400
    email = code_row["email"].lower()

    cursor.execute(
        "SELECT asset_id FROM assets WHERE asset_id = ? AND LOWER(contact1_value) = ?",
        (exhibit["asset_id"], email)
    )
    if not cursor.fetchone():
        conn.close()
        return jsonify({"ok": False, "error": "Not authorized."}), 403

    for idx, image_id in enumerate(order, 1):
        cursor.execute(
            "UPDATE exhibit_images SET display_order = ? WHERE image_id = ? AND exhibit_id = ?",
            (idx, image_id, exhibit_id)
        )

    conn.commit()
    conn.close()

    return jsonify({"ok": True})


def _verify_exhibit_code(cursor, asset_id, code):
    """Verify an edit code owns the given asset. Returns email or None."""
    if not code:
        return None
    cursor.execute("SELECT email FROM edit_codes WHERE code = ?", (code,))
    code_row = cursor.fetchone()
    if not code_row:
        return None
    email = code_row["email"].lower()
    cursor.execute(
        "SELECT asset_id FROM assets WHERE asset_id = ? AND LOWER(contact1_value) = ?",
        (asset_id, email)
    )
    if not cursor.fetchone():
        return None
    return email


@app.route("/api/exhibit/<int:asset_id>/dashboard", methods=["GET"])
def get_exhibit_dashboard(asset_id):
    """Get exhibit data for dashboard editing. Requires edit code."""
    code = (request.args.get("code") or "").strip()
    conn = get_db()
    cursor = conn.cursor()

    email = _verify_exhibit_code(cursor, asset_id, code)
    if not email:
        conn.close()
        return jsonify({"ok": False, "error": "Invalid edit code."}), 403

    cursor.execute("SELECT * FROM exhibits WHERE asset_id = ?", (asset_id,))
    exhibit = cursor.fetchone()
    if not exhibit:
        conn.close()
        return jsonify({"ok": False, "error": "Exhibit not found."}), 404

    cursor.execute(
        "SELECT * FROM exhibit_images WHERE exhibit_id = ? ORDER BY display_order",
        (exhibit["exhibit_id"],)
    )
    images = [dict(row) for row in cursor.fetchall()]

    cursor.execute("SELECT artist_name, tile_url FROM assets WHERE asset_id = ?", (asset_id,))
    asset_info = cursor.fetchone()
    conn.close()

    return jsonify({
        "ok": True,
        "exhibit": {
            "exhibit_id": exhibit["exhibit_id"],
            "asset_id": exhibit["asset_id"],
            "artist_name": exhibit["artist_name"] or (asset_info["artist_name"] if asset_info else ""),
            "exhibit_title": exhibit["exhibit_title"],
            "artist_bio": exhibit["artist_bio"],
            "artist_photo_url": exhibit["artist_photo_url"],
            "artist_location": exhibit["artist_location"],
            "medium_techniques": exhibit["medium_techniques"],
            "artistic_focus": exhibit["artistic_focus"],
            "background_education": exhibit["background_education"],
            "professional_highlights": exhibit["professional_highlights"],
            "tile_url": asset_info["tile_url"] if asset_info else "",
        },
        "images": images,
    })


@app.route("/api/exhibit/<int:asset_id>/profile", methods=["POST"])
def update_exhibit_profile(asset_id):
    """Update exhibit profile fields. Requires edit code."""
    try:
        data = request.get_json() or {}
        code = (data.get("code") or "").strip()

        conn = get_db()
        cursor = conn.cursor()

        email = _verify_exhibit_code(cursor, asset_id, code)
        if not email:
            conn.close()
            return jsonify({"ok": False, "error": "Invalid edit code."}), 403

        cursor.execute("SELECT exhibit_id FROM exhibits WHERE asset_id = ?", (asset_id,))
        exhibit = cursor.fetchone()
        if not exhibit:
            conn.close()
            return jsonify({"ok": False, "error": "Exhibit not found."}), 404

        exhibit_id = exhibit["exhibit_id"]

        # Update allowed fields
        artist_name = (data.get("artist_name") or "").strip()
        exhibit_title = (data.get("exhibit_title") or "").strip()
        artist_bio = (data.get("artist_bio") or "").strip()
        artist_location = (data.get("artist_location") or "").strip()
        medium_techniques = (data.get("medium_techniques") or "").strip()
        artistic_focus = (data.get("artistic_focus") or "").strip()
        background_education = (data.get("background_education") or "").strip()
        professional_highlights = (data.get("professional_highlights") or "").strip()

        cursor.execute("""
            UPDATE exhibits
            SET artist_name = ?, exhibit_title = ?, artist_bio = ?, artist_location = ?,
                medium_techniques = ?, artistic_focus = ?, background_education = ?,
                professional_highlights = ?, updated_at = datetime('now')
            WHERE exhibit_id = ?
        """, (artist_name, exhibit_title, artist_bio, artist_location,
              medium_techniques, artistic_focus, background_education,
              professional_highlights, exhibit_id))

        conn.commit()
        conn.close()

        return jsonify({"ok": True})

    except Exception as e:
        if 'conn' in locals():
            conn.close()
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/exhibit/<int:asset_id>/photo", methods=["POST"])
def upload_exhibit_photo(asset_id):
    """Upload or replace the artist headshot for an exhibit."""
    code = (request.form.get("code") or "").strip()
    if not code:
        return jsonify({"ok": False, "error": "Missing edit code."}), 400

    conn = get_db()
    cursor = conn.cursor()

    email = _verify_exhibit_code(cursor, asset_id, code)
    if not email:
        conn.close()
        return jsonify({"ok": False, "error": "Invalid edit code."}), 403

    cursor.execute("SELECT exhibit_id, artist_photo_url FROM exhibits WHERE asset_id = ?", (asset_id,))
    exhibit = cursor.fetchone()
    if not exhibit:
        conn.close()
        return jsonify({"ok": False, "error": "Exhibit not found."}), 404

    if 'photo' not in request.files:
        conn.close()
        return jsonify({"ok": False, "error": "No photo file provided."}), 400

    file = request.files['photo']
    if not file or not file.filename:
        conn.close()
        return jsonify({"ok": False, "error": "Empty file."}), 400

    exhibit_id = exhibit["exhibit_id"]
    exhibit_dir = os.path.join(UPLOAD_DIR, 'exhibits', str(exhibit_id))
    os.makedirs(exhibit_dir, exist_ok=True)

    # Delete old photo file if it exists
    old_url = exhibit["artist_photo_url"] or ""
    if old_url.startswith('/uploads/'):
        old_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), old_url.lstrip('/'))
        if os.path.exists(old_path):
            os.remove(old_path)

    # Generate center-cropped square photo (512×512 for retina quality at 80×80 display)
    filename = f"headshot_{uuid.uuid4().hex[:12]}.jpg"
    filepath = os.path.join(exhibit_dir, filename)

    optimized = _optimize_image(file)
    with open(filepath, 'wb') as tmp:
        tmp.write(optimized.getvalue())

    thumb_buf = _make_center_thumb(filepath, size=512)
    if thumb_buf:
        with open(filepath, 'wb') as f:
            f.write(thumb_buf.getvalue())

    photo_url = f'/uploads/exhibits/{exhibit_id}/{filename}'

    cursor.execute("UPDATE exhibits SET artist_photo_url = ?, updated_at = datetime('now') WHERE exhibit_id = ?",
                   (photo_url, exhibit_id))
    conn.commit()
    conn.close()

    return jsonify({"ok": True, "photo_url": photo_url})


@app.route("/api/exhibit/public/<int:asset_id>", methods=["GET"])
def get_exhibit_public(asset_id):
    """Get exhibit data for public viewing (no edit code required). Used when clicking an exhibit tile."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT asset_type FROM assets WHERE asset_id = ?", (asset_id,))
    asset_row = cursor.fetchone()
    if not asset_row or asset_row["asset_type"] != 'exhibit':
        conn.close()
        return jsonify({"ok": False, "error": "Not an exhibit."}), 404

    cursor.execute("SELECT * FROM exhibits WHERE asset_id = ?", (asset_id,))
    exhibit = cursor.fetchone()
    if not exhibit:
        conn.close()
        return jsonify({"ok": False, "error": "Exhibit not found."}), 404

    cursor.execute(
        "SELECT * FROM exhibit_images WHERE exhibit_id = ? ORDER BY display_order",
        (exhibit["exhibit_id"],)
    )
    images = [dict(row) for row in cursor.fetchall()]

    # Get artist name from parent asset
    cursor.execute("SELECT artist_name, tile_url FROM assets WHERE asset_id = ?", (asset_id,))
    asset_info = cursor.fetchone()
    conn.close()

    return jsonify({
        "ok": True,
        "exhibit": {
            "exhibit_id": exhibit["exhibit_id"],
            "asset_id": exhibit["asset_id"],
            "artist_name": exhibit["artist_name"] or (asset_info["artist_name"] if asset_info else ""),
            "exhibit_title": exhibit["exhibit_title"],
            "artist_bio": exhibit["artist_bio"],
            "artist_photo_url": exhibit["artist_photo_url"],
            "artist_location": exhibit["artist_location"],
            "medium_techniques": exhibit["medium_techniques"],
            "artistic_focus": exhibit["artistic_focus"],
            "background_education": exhibit["background_education"],
            "professional_highlights": exhibit["professional_highlights"],
            "tile_url": asset_info["tile_url"] if asset_info else "",
        },
        "images": images,
    })


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )
