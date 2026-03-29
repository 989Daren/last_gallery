# Database Schema & Tile Registration

## Database Schema

```sql
-- Schema version tracking
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Assets: stores artwork data (single source of truth)
CREATE TABLE assets (
    asset_id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_name TEXT NOT NULL DEFAULT '',
    artwork_title TEXT NOT NULL DEFAULT '',
    tile_url TEXT NOT NULL DEFAULT '',
    popup_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- Extended metadata (migration v2)
    year_created TEXT NOT NULL DEFAULT '',
    medium TEXT NOT NULL DEFAULT '',
    dimensions TEXT NOT NULL DEFAULT '',
    edition_info TEXT NOT NULL DEFAULT '',
    for_sale TEXT NOT NULL DEFAULT '',      -- 'yes' | 'no' | ''
    sale_type TEXT NOT NULL DEFAULT '',     -- 'original' | 'print' | 'both' | ''
    artist_contact TEXT NOT NULL DEFAULT '', -- deprecated, use contact1/contact2
    -- Contact fields (migration v3)
    contact1_type TEXT NOT NULL DEFAULT '',  -- 'email' | 'social' | 'website' | ''
    contact1_value TEXT NOT NULL DEFAULT '',
    contact2_type TEXT NOT NULL DEFAULT '',
    contact2_value TEXT NOT NULL DEFAULT '',
    -- Qualified floor model (migration v7)
    qualified_floor TEXT NOT NULL DEFAULT 's',  -- 's' | 'm' | 'lg' | 'xl' — artwork never shuffles below this size
    stripe_payment_id TEXT,                       -- nullable, Stripe payment reference for tile upgrades
    -- Asset type (migration v9)
    asset_type TEXT NOT NULL DEFAULT 'artwork',   -- 'artwork' | 'info'
    -- Payment deadline (migration v10)
    payment_deadline TEXT                          -- nullable, ISO 8601 UTC — 24h unlock window for 2nd+ free uploads
);

-- Tiles: links tile positions to assets
CREATE TABLE tiles (
    tile_id TEXT PRIMARY KEY,
    asset_id INTEGER NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(asset_id) REFERENCES assets(asset_id) ON DELETE SET NULL
);

-- Edit codes: one code per email for artwork editing
CREATE TABLE edit_codes (
    email TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Countdown schedule: singleton row for shuffle countdown timer
CREATE TABLE countdown_schedule (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'cleared',    -- 'active' | 'scheduled' | 'cleared'
    target_time TEXT,                           -- ISO 8601 UTC when countdown hits zero
    start_time TEXT,                            -- ISO 8601 UTC when countdown begins (for delayed start)
    duration_seconds INTEGER NOT NULL DEFAULT 604800,  -- cycle length (default 7 days)
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Purchase history: audit trail for Stripe payments (migration v8)
CREATE TABLE purchase_history (
    purchase_id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    tier TEXT NOT NULL DEFAULT '',              -- 'unlock_s' | 'floor_m' | 'floor_lg' | 'floor_xl'
    amount_cents INTEGER NOT NULL DEFAULT 0,
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'fulfilled' | 'cancelled'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    fulfilled_at TEXT,
    FOREIGN KEY(asset_id) REFERENCES assets(asset_id) ON DELETE CASCADE
);
```

Current schema version: **18**

## Tile Registration

Tiles are defined visually in `grid_full.svg` but must exist in the `tiles` database table for the app to use them.

### How Tiles Get Registered
1. **On Upload**: `INSERT OR REPLACE INTO tiles` creates the tile entry if it doesn't exist
2. **After SVG Extension**: Run `grid utilities/repair_tiles.py` to sync database with new SVG tiles

### SVG Structure
- Ungrouped `<rect>` elements inside the main layer `<g>` are individual S tiles
- `<g>` elements containing `<rect>` children are larger tiles (M, LG, XL) — the group's bounding box determines size classification
- All three parsers (app.py, repair_tiles.py, main.js) use this same group-aware logic

### Extending the Grid
When adding tiles to `grid_full.svg`:
1. Add `<rect>` elements (for S) or `<g>` groups containing `<rect>` children (for larger tiles) to the SVG
2. Run `python "grid utilities/repair_tiles.py"` from project root
3. Script parses SVG, finds new tile IDs, inserts them into database
4. Existing artwork assignments are preserved

### Tile ID Assignment
Tiles are classified by size and numbered sequentially:
| Size Class | Width Range (design units) | Prefix | Example |
|------------|---------------------------|--------|---------|
| S | 60-128 | S | S1, S2, S3... |
| M | 128-213 | M | M1, M2... |
| LG | 213-298 | L | L1, L2... |
| XL | 298-425 | XL | XL1, XL2... |
