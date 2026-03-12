"""
Repair script to sync tiles table with extended grid_full.svg

This script:
1. Reads all tile positions from grid_full.svg
2. Preserves existing artwork assignments
3. Adds any missing tile positions to the database

Run this after extending your SVG to update the database.
"""

import sqlite3
import os
import re
import xml.etree.ElementTree as ET

# Paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)  # project root (one level up from 'grid utilities/')
DB_PATH = os.path.join(BASE_DIR, "data", "gallery.db")
SVG_PATH = os.path.join(BASE_DIR, "static", "grid_full.svg")


def parse_svg_tiles(svg_path):
    """Parse the SVG and return tile IDs (same logic as app.py).

    Ungrouped <rect> elements are individual (S) tiles.
    <g> elements containing <rect> children are larger tiles — the group's
    bounding box determines size classification (M, LG, XL).
    """
    try:
        tree = ET.parse(svg_path)
        root = tree.getroot()
    except Exception as e:
        print(f"Error parsing SVG: {e}")
        return []

    ns = '{http://www.w3.org/2000/svg}'

    def rect_position(rect):
        """Extract top-left position and dimensions from a <rect> element."""
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
        print("No layer group found in SVG")
        return []

    tiles = []
    for child in layer:
        tag = child.tag.replace(ns, '')

        if tag == 'rect':
            left, top, width, height = rect_position(child)
            tiles.append({'width': width, 'height': height, 'svg_left': left, 'svg_top': top})

        elif tag == 'g':
            child_rects = child.findall(ns + 'rect') + child.findall('rect')
            if not child_rects:
                continue
            positions = [rect_position(r) for r in child_rects]
            min_l = min(p[0] for p in positions)
            min_t = min(p[1] for p in positions)
            max_r = max(p[0] + p[2] for p in positions)
            max_b = max(p[1] + p[3] for p in positions)
            tiles.append({
                'width': max_r - min_l,
                'height': max_b - min_t,
                'svg_left': min_l,
                'svg_top': min_t
            })

    if not tiles:
        return []

    # Infer scale factor from S tiles (individual rects, width 40-90 SVG units)
    s_candidates = [t['width'] for t in tiles if 40 <= t['width'] <= 90]
    if not s_candidates:
        print("No S tiles found for scale detection")
        return []

    avg_s = sum(s_candidates) / len(s_candidates)
    DESIGN_S = 85.0
    scale = avg_s / DESIGN_S

    for t in tiles:
        t['design_width'] = t['width'] / scale
        t['design_height'] = t['height'] / scale
        t['design_left'] = t['svg_left'] / scale
        t['design_top'] = t['svg_top'] / scale

    min_left = min(t['design_left'] for t in tiles)
    min_top = min(t['design_top'] for t in tiles)

    def classify(w):
        if w >= 60 and w < 128: return 's'
        if w >= 128 and w < 213: return 'm'
        if w >= 213 and w < 298: return 'lg'
        if w >= 298 and w < 425: return 'xl'
        return 'unknown'

    # Normalize and classify
    for t in tiles:
        t['norm_left'] = t['design_left'] - min_left
        t['norm_top'] = t['design_top'] - min_top
        t['size'] = classify(t['design_width'])

    # Assign IDs
    counters = {'s': 0, 'm': 0, 'lg': 0, 'xl': 0, 'unknown': 0}
    prefix = {'s': 'S', 'm': 'M', 'lg': 'L', 'xl': 'XL', 'unknown': 'U'}
    tile_ids = []
    for t in tiles:
        if t['size'] == 'unknown':
            continue
        counters[t['size']] += 1
        tid = prefix[t['size']] + str(counters[t['size']])
        tile_ids.append(tid)

    return tile_ids


def repair_tiles_table():
    """Sync tiles table with SVG, preserving existing artwork assignments."""
    
    # Parse SVG to get all tile IDs
    print("Reading tiles from grid_full.svg...")
    svg_tile_ids = parse_svg_tiles(SVG_PATH)
    
    if not svg_tile_ids:
        print("ERROR: Could not parse tiles from SVG")
        return False
    
    print(f"Found {len(svg_tile_ids)} tiles in SVG")
    
    # Connect to database
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get existing tiles with their assignments
    cursor.execute("SELECT tile_id, asset_id FROM tiles")
    existing_tiles = {row['tile_id']: row['asset_id'] for row in cursor.fetchall()}
    
    print(f"Database currently has {len(existing_tiles)} tile entries")
    artwork_count = sum(1 for asset_id in existing_tiles.values() if asset_id is not None)
    print(f"  - {artwork_count} tiles with artwork")
    print(f"  - {len(existing_tiles) - artwork_count} empty tiles")
    
    # Find missing tiles
    missing_tiles = [tid for tid in svg_tile_ids if tid not in existing_tiles]
    
    if not missing_tiles:
        print("\n✓ All tiles from SVG already exist in database!")
        conn.close()
        return True
    
    print(f"\nAdding {len(missing_tiles)} new tiles to database...")
    
    # Insert missing tiles
    for tile_id in missing_tiles:
        cursor.execute(
            "INSERT INTO tiles (tile_id, asset_id, updated_at) VALUES (?, NULL, datetime('now'))",
            (tile_id,)
        )
    
    conn.commit()
    
    # Verify final state
    cursor.execute("SELECT COUNT(*) FROM tiles")
    final_count = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM tiles WHERE asset_id IS NOT NULL")
    final_artwork = cursor.fetchone()[0]
    
    conn.close()
    
    print(f"\n✓ Repair complete!")
    print(f"  - Total tiles: {final_count}")
    print(f"  - Tiles with artwork: {final_artwork}")
    print(f"  - Empty tiles: {final_count - final_artwork}")
    
    return True


if __name__ == "__main__":
    print("=" * 60)
    print("Tile Database Repair Script")
    print("=" * 60)
    print()
    
    if not os.path.exists(SVG_PATH):
        print(f"ERROR: SVG file not found at {SVG_PATH}")
        exit(1)
    
    if not os.path.exists(DB_PATH):
        print(f"ERROR: Database not found at {DB_PATH}")
        exit(1)
    
    success = repair_tiles_table()
    
    if success:
        print("\nYou can now restart your server and shuffle will work correctly!")
    else:
        print("\nRepair failed. Check error messages above.")
        exit(1)
