# The Last Gallery - Project Summary

## Overview
A Flask-based web gallery application where users can upload artwork images that display on a tiled wall. Each tile can be clicked to view the full-size image with metadata (artist name, artwork title) displayed in an animated overlay.

## Tech Stack
- **Backend**: Python/Flask
- **Database**: SQLite (single source of truth)
- **Frontend**: Vanilla JavaScript, CSS
- **Image Processing**: Cropper.js for client-side cropping

## How to Run
```bash
python app.py
```
- Local: http://127.0.0.1:5000
- Network: http://192.168.1.191:5000 (for mobile testing)

## Key Files

### Backend
| File | Purpose |
|------|---------|
| `app.py` | Flask application, all API endpoints |
| `db.py` | Database connection and schema initialization |
| `data/gallery.db` | SQLite database (assets + tiles tables) |

### Frontend
| File | Purpose |
|------|---------|
| `static/js/main.js` | Main gallery rendering, popup overlay, admin functions |
| `static/js/upload_modal.js` | Image upload flow with cropping and metadata entry |
| `templates/index.html` | Main HTML template |
| `static/css/styles.css` | All styling including popup animations |
| `static/grid_full.svg` | SVG defining tile positions and sizes |

## Database Schema

```sql
-- Assets: stores artwork data (single source of truth)
CREATE TABLE assets (
    asset_id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_name TEXT NOT NULL DEFAULT '',
    artwork_title TEXT NOT NULL DEFAULT '',
    tile_url TEXT NOT NULL DEFAULT '',      -- thumbnail for grid
    popup_url TEXT NOT NULL DEFAULT '',     -- full-size for popup
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tiles: links tile positions to assets
CREATE TABLE tiles (
    tile_id TEXT PRIMARY KEY,               -- e.g., 'X1', 'S2', 'M4'
    asset_id INTEGER NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(asset_id) REFERENCES assets(asset_id) ON DELETE SET NULL
);
```

## API Endpoints

### Public
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Main gallery page |
| `/api/wall_state` | GET | Get all tile assignments from database |
| `/uploads/<filename>` | GET | Serve uploaded images |

### Upload
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/upload_assets` | POST | Upload tile + popup images (multipart form) |
| `/api/tile/<tile_id>/metadata` | POST | Save artist/title metadata |
| `/api/tile/<tile_id>/metadata` | GET | Get metadata for a tile |

### Admin (requires `X-Admin-Pin: 8375` header)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/tile_info` | GET | Get info about a specific tile |
| `/api/admin/clear_tile` | POST | Clear a single tile |
| `/api/admin/clear_all_tiles` | POST | Clear all tiles |
| `/api/admin/move_tile_asset` | POST | Move artwork between tiles |
| `/api/admin/undo` | POST | Undo last action (supports `action_type: shuffle/non_shuffle`) |
| `/api/admin/history_status` | GET | Get undo availability counts |
| `/shuffle` | POST | Randomly redistribute all images (body: `{pin: "8375"}`) |

## Tile Sizes
Tiles are defined in `grid_full.svg` with sizes: `xs`, `s`, `m`, `lg`, `xlg`
- New uploads go to random available `xs` tiles
- Shuffle redistributes to ANY tile size randomly

## Upload Flow
1. User selects image → Cropper.js allows square crop
2. Upload sends: `tile_image` (512x512 thumbnail) + `popup_image` (original)
3. Server saves to `/uploads/` directory, creates DB records
4. Metadata modal appears → user enters artist/title → saved to DB
5. Wall refreshes to show new image

## Popup Overlay
Two metadata display locations:
1. **Above image (top-left)**: `.popup-title` containing `#popupTitle` and `#popupArtist`
2. **Black ribbon overlay**: `#popupInfoText` with `.ribbon-title` and `.ribbon-artist`

Animation sequence: image appears → title fades in → black ribbon slides from left → text reveals

## Admin PIN
- Default: `8375`
- Can be overridden via environment variable `TLG_ADMIN_PIN`

## Recent Changes (2026-01-29)
- Migrated from `wall_state.json` to SQLite database as single source of truth
- Added all admin API endpoints
- Fixed metadata display in popup overlay
- Shuffle now distributes to any tile size
- New uploads placed in random XS tiles
- Database snapshot/restore for undo functionality

## Notes
- Undo history is in-memory (resets on server restart)
- Images stored in `/uploads/` directory with UUID filenames
- No authentication beyond admin PIN for admin functions

## Planned Features
- **Additional metadata fields**: Medium (paint/pencil/digital/AI), Date Created, Artist Contact
- These will display on the black ribbon overlay (not above the image)
- Follow existing patterns for `artist_name`/`artwork_title`
