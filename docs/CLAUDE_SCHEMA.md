# Database Schema & Tile Registration

## Database Authority

- `data/gallery.db` is the runtime source of truth and is intentionally gitignored.
- `db.py` owns schema creation and sequential migrations. `init_db()` runs when `app.py` is imported.
- Current schema version: **24**. This was verified against both `db.py` and the live database on 2026-09-10.
- Legacy tracked JSON files under `data/` are not read by the current application for gallery state or undo history.

## Current Schema

The SQL below represents the final v24 shape. Column order in an upgraded database can differ from a fresh logical definition because several fields were added by migration.

```sql
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE assets (
    asset_id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_name TEXT NOT NULL DEFAULT '',
    artwork_title TEXT NOT NULL DEFAULT '',
    tile_url TEXT NOT NULL DEFAULT '',
    popup_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    year_created TEXT NOT NULL DEFAULT '',
    medium TEXT NOT NULL DEFAULT '',
    dimensions TEXT NOT NULL DEFAULT '',
    edition_info TEXT NOT NULL DEFAULT '',
    for_sale TEXT NOT NULL DEFAULT '',          -- 'yes' | 'no' | ''
    sale_type TEXT NOT NULL DEFAULT '',         -- 'original' | 'print' | 'both' | ''
    artist_contact TEXT NOT NULL DEFAULT '',    -- deprecated; use contact1/contact2
    contact1_type TEXT NOT NULL DEFAULT '',     -- 'email' | 'social' | 'website' | ''
    contact1_value TEXT NOT NULL DEFAULT '',
    contact2_type TEXT NOT NULL DEFAULT '',
    contact2_value TEXT NOT NULL DEFAULT '',
    unlocked INTEGER NOT NULL DEFAULT 0,
    qualified_floor TEXT NOT NULL DEFAULT 's',  -- 's' | 'm' | 'lg' | 'xl'
    stripe_payment_id TEXT,
    asset_type TEXT NOT NULL DEFAULT 'artwork', -- 'artwork' | 'info' | 'exhibit'
    payment_deadline TEXT                       -- nullable ISO-8601 UTC timestamp
);

CREATE TABLE tiles (
    tile_id TEXT PRIMARY KEY,
    asset_id INTEGER NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(asset_id) REFERENCES assets(asset_id) ON DELETE SET NULL
);
CREATE INDEX idx_tiles_asset_id ON tiles(asset_id);

CREATE TABLE edit_codes (
    email TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE countdown_schedule (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'cleared',     -- 'active' | 'scheduled' | 'cleared'
    target_time TEXT,
    start_time TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 604800,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE purchase_history (
    purchase_id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    tier TEXT NOT NULL DEFAULT '',              -- unlock_s | floor_m | floor_lg | floor_xl | exhibit
    amount_cents INTEGER NOT NULL DEFAULT 0,
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    status TEXT NOT NULL DEFAULT 'pending',     -- pending | fulfilled | cancelled
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    fulfilled_at TEXT,
    FOREIGN KEY(asset_id) REFERENCES assets(asset_id) ON DELETE CASCADE
);
CREATE INDEX idx_purchase_history_asset_id ON purchase_history(asset_id);
CREATE INDEX idx_purchase_history_session_id ON purchase_history(stripe_session_id);

CREATE TABLE exhibits (
    exhibit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    artist_bio TEXT NOT NULL DEFAULT '',
    artist_photo_url TEXT,
    artist_location TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    exhibit_title TEXT NOT NULL DEFAULT '',
    artist_name TEXT NOT NULL DEFAULT '',
    medium_techniques TEXT NOT NULL DEFAULT '',
    artistic_focus TEXT NOT NULL DEFAULT '',
    background_education TEXT NOT NULL DEFAULT '',
    professional_highlights TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(asset_id) REFERENCES assets(asset_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_exhibits_asset_id ON exhibits(asset_id);

CREATE TABLE exhibit_images (
    image_id INTEGER PRIMARY KEY AUTOINCREMENT,
    exhibit_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    source_asset_id INTEGER,
    display_order INTEGER NOT NULL,
    artwork_title TEXT NOT NULL DEFAULT '',
    artist_name TEXT NOT NULL DEFAULT '',
    year_created TEXT NOT NULL DEFAULT '',
    medium TEXT NOT NULL DEFAULT '',
    dimensions TEXT NOT NULL DEFAULT '',
    edition_info TEXT NOT NULL DEFAULT '',
    for_sale TEXT NOT NULL DEFAULT '',
    sale_type TEXT NOT NULL DEFAULT '',
    contact1_type TEXT NOT NULL DEFAULT '',
    contact1_value TEXT NOT NULL DEFAULT '',
    contact2_type TEXT NOT NULL DEFAULT '',
    contact2_value TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    thumb_url TEXT NOT NULL DEFAULT '',
    scroll_url TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(exhibit_id) REFERENCES exhibits(exhibit_id) ON DELETE CASCADE,
    FOREIGN KEY(source_asset_id) REFERENCES assets(asset_id) ON DELETE SET NULL
);
CREATE INDEX idx_exhibit_images_exhibit_id ON exhibit_images(exhibit_id);

CREATE TABLE artist_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    bio_text TEXT NOT NULL DEFAULT '',
    artist_location TEXT NOT NULL DEFAULT '',
    medium_techniques TEXT NOT NULL DEFAULT '',
    artistic_focus TEXT NOT NULL DEFAULT '',
    background_education TEXT NOT NULL DEFAULT '',
    professional_highlights TEXT NOT NULL DEFAULT '',
    bio_photo_url TEXT,
    cotm_opt_in INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE creator_of_the_month (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL UNIQUE,
    artist_name TEXT NOT NULL,
    email TEXT NOT NULL,
    excluded_asset_ids TEXT NOT NULL DEFAULT '[]', -- JSON array
    selected_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE landing_state (
    week TEXT PRIMARY KEY,
    anchor_tile_id TEXT NOT NULL,
    offset_cell TEXT NOT NULL,                  -- ul|uc|ur|ml|mc|mr|ll|lc|lr
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(anchor_tile_id) REFERENCES tiles(tile_id)
);
```

## Migration History

| Version | Change |
|---------|--------|
| 1 | Base `assets` and `tiles` tables |
| 2 | Extended artwork metadata |
| 3 | Two structured contact fields |
| 4 | `edit_codes` |
| 5 | `assets.unlocked` |
| 6 | Singleton `countdown_schedule` |
| 7 | Qualified floor and Stripe payment reference |
| 8 | `purchase_history` and indexes |
| 9 | `assets.asset_type` |
| 10 | `assets.payment_deadline` |
| 11 | `exhibits` and `exhibit_images` |
| 12 | Exhibit-specific artist name |
| 13 | Additional exhibit profile fields |
| 14 | Tile-size rename and corresponding floor/tier migration |
| 15 | Exhibit-image thumbnail URL |
| 16 | Exhibit title |
| 17 | Exhibit-image scroll URL |
| 18 | Rebuild `assets` to make the qualified-floor default `s` |
| 19 | Initial `creator_of_the_month` table |
| 20 | Initial COTM profile-detail columns |
| 21 | Shared `artist_profiles` table |
| 22 | Slim COTM ledger; profile data remains only in `artist_profiles` |
| 23 | Initial curated `landing_zones` table |
| 24 | Replace `landing_zones` with weekly `landing_state` |

## Relationships and Ownership

- `tiles.asset_id` points to the asset currently occupying a visual tile.
- An exhibit is an `assets` row with `asset_type = 'exhibit'` plus one `exhibits` row and ordered `exhibit_images` rows.
- `artist_profiles`, keyed by normalized email, is the single source of truth for reusable creator-profile fields and COTM opt-in.
- `creator_of_the_month` is a monthly selection ledger. Its `excluded_asset_ids` field controls which of the selected artist's works appear.
- `landing_state` stores one selected anchor and offset per ISO week.
- Undo history is held in Flask process memory; `data/wall_state_history.json` is not used by the current implementation.

## Runtime JSON State

These files are intentionally outside SQLite and gitignored:

- `data/grid_color.json` — global grid color. The tracked root `grid_color.json` is not read by `app.py`.
- `data/cotm_enabled.json` — global COTM enable flag; missing or invalid data means disabled.

## Tile Registration

Tiles are defined visually in `static/grid_full.svg` and must also exist in the `tiles` table.

### How Tiles Are Registered

1. Upload placement uses `INSERT OR REPLACE INTO tiles`, creating the selected tile row if necessary.
2. Startup seeds missing info assets and assigns them to available S tiles.
3. After extending the SVG, run `python "grid utilities/repair_tiles.py"` from the project root to add missing tile IDs while preserving assignments.

### SVG Structure

- Ungrouped `<rect>` elements in the main layer are individual S tiles.
- `<g>` elements containing `<rect>` children are larger tiles; their bounding boxes determine size.
- `app.py`, `grid utilities/repair_tiles.py`, and `static/js/main.js` use the same group-aware classification thresholds.

| Size | Width in design units | Database/DOM prefix | Example |
|------|-----------------------|---------------------|---------|
| S | 60–<128 | `S` | `S1` |
| M | 128–<213 | `M` | `M1` |
| LG | 213–<298 | `L` | `L1` |
| XL | 298–<425 | `XL` | `XL1` |

When extending the grid, keep element ordering stable: IDs are assigned sequentially within each size bucket by SVG traversal order.
