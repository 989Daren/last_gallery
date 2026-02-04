"""
Query script to count tiles by size in the database.

Shows the breakdown of tile sizes (xs, s, m, lg, xlg) in your gallery.
"""

import sqlite3
import os

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "gallery.db")


def count_tiles_by_size():
    """Count tiles grouped by size prefix."""
    
    if not os.path.exists(DB_PATH):
        print(f"ERROR: Database not found at {DB_PATH}")
        return
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get all tile IDs
    cursor.execute("SELECT tile_id FROM tiles ORDER BY tile_id")
    tile_ids = [row['tile_id'] for row in cursor.fetchall()]
    
    # Count by prefix
    size_counts = {
        'X': 0,    # Extra small (xs)
        'S': 0,    # Small
        'M': 0,    # Medium
        'L': 0,    # Large
        'XL': 0    # Extra large (xlg)
    }
    
    for tid in tile_ids:
        # Determine size from tile ID prefix
        if tid.startswith('XL'):
            size_counts['XL'] += 1
        elif tid.startswith('X'):
            size_counts['X'] += 1
        elif tid.startswith('S'):
            size_counts['S'] += 1
        elif tid.startswith('M'):
            size_counts['M'] += 1
        elif tid.startswith('L'):
            size_counts['L'] += 1
    
    # Also get artwork counts
    cursor.execute("SELECT COUNT(*) FROM tiles WHERE asset_id IS NOT NULL")
    artwork_count = cursor.fetchone()[0]
    
    conn.close()
    
    # Display results
    print("=" * 60)
    print("Tile Size Breakdown")
    print("=" * 60)
    print()
    print(f"{'Size':<20} {'Count':<10} {'Dimensions (design space)'}")
    print("-" * 60)
    print(f"{'Extra Small (xs)':<20} {size_counts['X']:<10} {'85 × 85'}")
    print(f"{'Small (s)':<20} {size_counts['S']:<10} {'170 × 170'}")
    print(f"{'Medium (m)':<20} {size_counts['M']:<10} {'255 × 255'}")
    print(f"{'Large (lg)':<20} {size_counts['L']:<10} {'340 × 340'}")
    print(f"{'Extra Large (xlg)':<20} {size_counts['XL']:<10} {'510 × 510'}")
    print("-" * 60)
    print(f"{'TOTAL TILES':<20} {len(tile_ids):<10}")
    print()
    print(f"Tiles with artwork: {artwork_count}")
    print(f"Empty tiles: {len(tile_ids) - artwork_count}")
    print()


if __name__ == "__main__":
    count_tiles_by_size()
