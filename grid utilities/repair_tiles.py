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
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "gallery.db")
SVG_PATH = os.path.join(BASE_DIR, "static", "grid_full.svg")


def parse_svg_tiles(svg_path):
    """Parse the SVG and return tile IDs (same logic as app.py)."""
    try:
        tree = ET.parse(svg_path)
        root = tree.getroot()
    except Exception as e:
        print(f"Error parsing SVG: {e}")
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

    # Infer scale factor
    xs_candidates = [r['width'] for r in rects if 40 <= r['width'] <= 90]
    if not xs_candidates:
        print("No XS tiles found for scale detection")
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
    tile_ids = []
    for r in rects:
        if r['size'] == 'unknown':
            continue
        counters[r['size']] += 1
        tid = prefix[r['size']] + str(counters[r['size']])
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
