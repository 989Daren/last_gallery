# The Last Gallery - Project Summary

## Overview
A Flask-based web gallery application where users can upload artwork images that display on a tiled wall. Each tile can be clicked to view the full-size image with metadata displayed in an animated overlay ribbon.

## Tech Stack
- **Backend**: Python/Flask
- **Database**: SQLite (single source of truth) with versioned migrations
- **Frontend**: Vanilla JavaScript (modular), CSS
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
| `db.py` | Database connection, schema initialization, versioned migrations |
| `data/gallery.db` | SQLite database (assets + tiles + schema_version tables) |
| `grid utilities/repair_tiles.py` | Sync tiles table with SVG after grid extension |

### Frontend
| File | Purpose |
|------|---------|
| `static/js/main.js` | Core gallery rendering, popup overlay, wall state management |
| `static/js/admin.js` | Admin modal, action handlers (clear/move/undo/shuffle) |
| `static/js/upload_modal.js` | Image upload flow with cropping and metadata entry |
| `templates/index.html` | Main HTML template |
| `static/css/styles.css` | All styling including popup animations |
| `static/grid_full.svg` | SVG defining tile positions and sizes |

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
    contact2_value TEXT NOT NULL DEFAULT ''
);

-- Tiles: links tile positions to assets
CREATE TABLE tiles (
    tile_id TEXT PRIMARY KEY,
    asset_id INTEGER NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(asset_id) REFERENCES assets(asset_id) ON DELETE SET NULL
);
```

Current schema version: **3**

## Tile Registration

Tiles are defined visually in `grid_full.svg` but must exist in the `tiles` database table for the app to use them.

### How Tiles Get Registered
1. **On Upload**: `INSERT OR REPLACE INTO tiles` creates the tile entry if it doesn't exist
2. **After SVG Extension**: Run `grid utilities/repair_tiles.py` to sync database with new SVG tiles

### Extending the Grid
When adding tiles to `grid_full.svg`:
1. Add new `<rect>` elements to the SVG
2. Run `python "grid utilities/repair_tiles.py"` from project root
3. Script parses SVG, finds new tile IDs, inserts them into database
4. Existing artwork assignments are preserved

### Tile ID Assignment
Tiles are classified by size and numbered sequentially:
| Size Class | Width Range (design units) | Prefix | Example |
|------------|---------------------------|--------|---------|
| XS | 60-128 | X | X1, X2, X3... |
| S | 128-213 | S | S1, S2... |
| M | 213-298 | M | M1, M2... |
| LG | 298-425 | L | L1, L2... |
| XLG | 425-600 | XL | XL1, XL2... |

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
| `/api/tile/<tile_id>/metadata` | POST | Save all metadata fields |
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

## Metadata Fields

### Required Fields
- **Artist Name** - Required for submission
- **Artwork Title** - Required for submission

### Optional Fields
- **Year Created** - e.g., "2024"
- **Medium** - e.g., "Oil on canvas"
- **Dimensions** - e.g., "24 x 36 inches"
- **Edition Info** - e.g., "1/50" or "Artist Proof"
- **For Sale** - Yes/No checkbox
- **Sale Type** - Original/Print (grayed out if "No" selected)
- **Contact Info** - Up to 2 contacts, each with type (Email/Social Media/Website) and value

### Ribbon Display Format
1. Artist Name (bold, extra spacing below)
2. Artwork Title (italics) + Year (not italics, same line)
3. Medium
4. Dimensions
5. Edition
6. Sale availability text (if applicable, ends with "by contacting the owner.")
7. Contact links (clickable - mailto for email, https for web)

## Upload Flow
1. User selects image → Cropper.js allows square crop
2. Upload sends: `tile_image` (512x512 thumbnail) + `popup_image` (original)
3. Server saves to `/uploads/` directory, creates DB records
4. Metadata modal appears → user enters required + optional fields → saved to DB
5. Wall refreshes to show new image

## Welcome Popup
- Displays on every page load
- Text: "Welcome to The Last Gallery", "Scroll to explore", "Click images for full size"
- Dismissed via "Enter" button, backdrop click, or Escape key
- Triggers navigation arrows on dismissal

## Navigation Arrows
Pulsing directional arrows that teach users to scroll in multiple directions.

- **Trigger**: Appear immediately when welcome popup is dismissed
- **Conditional display**:
  - Right arrow only shows if horizontal scroll is needed (`wrapper.scrollWidth > wrapper.clientWidth`)
  - Down arrow only shows if vertical scroll is needed (`body.scrollHeight > window.innerHeight`)
- **Dismissal**: Each arrow fades out after user scrolls 200px in that direction
- **Independence**: Arrows operate independently; dismissing one doesn't affect the other
- **Session behavior**: Resets on page reload (no localStorage/cookies)
- **Accessibility**: Respects `prefers-reduced-motion`, `aria-hidden="true"`
- **Responsive**: Smaller arrows on mobile (≤768px)

### Scroll Tracking
| Direction | Element | Property |
|-----------|---------|----------|
| Horizontal | `.gallery-wall-wrapper` | `scrollLeft` |
| Vertical | `window` | `scrollY` |

## Popup Overlay
- **Animation sequence**: image appears → title fades in → black ribbon slides from left → text reveals
- **Close behavior**: First click hides ribbon, second click closes popup
- **Popup close button**: X button above top-right corner of image (always visible when popup is open)
- **Ribbon close button**: X button in top-right corner of ribbon (visible only when ribbon is shown)
- **Contact links**: Clickable (email opens mail client, web links open in new tab)

## Admin PIN
- Default: `8375`
- Can be overridden via environment variable `TLG_ADMIN_PIN`
- **Security**: PIN is validated server-side only; never exposed to client-side JavaScript
- PIN stored in IIFE closure scope after successful server validation, persists until page refresh

## JavaScript Architecture

### Global Exposure (from main.js)
```javascript
window.DEBUG          // Debug mode flag
window.ADMIN_DEBUG    // Admin debug footer flag
window.SEL            // DOM selector constants
window.API            // API endpoint constants
window.refreshWallFromServer()    // Refresh wall from database
window.captureStateSnapshot()     // Stub for state snapshots
window.refreshAdminOverlays()     // Refresh admin UI (from admin.js)
window.isAdminActive()            // Check admin session (from admin.js)
```

### admin.js Module
- IIFE pattern with initialization guards
- PIN validated server-side via `/api/admin/history_status` before unlocking modal
- PIN stored in closure-scoped `_adminPin` variable (not exposed to window), persists until page refresh
- Handles: modal PIN gate, clear/move/undo actions, shuffle, tile labels toggle
- Guards prevent duplicate event handler registration

## Recent Changes (2026-02-03)

### Admin Modal Improvements
- **Transparent tinted window effect**: Admin modal now has semi-transparent backdrop and panel so tile ID labels are visible through it when "Show Tile Labels" is enabled
- **CSS custom properties** for easy transparency tuning (`--admin-backdrop-alpha`, `--admin-modal-bg-alpha`, etc.)
- **Layout reorganization**: "Show Tile Labels" checkbox moved to same row as "Show tile outlines"; Close button moved to same row as Shuffle/Undo Shuffle

### Security Fix: Admin PIN
- **Removed client-side PIN exposure**: `window.ADMIN_PIN` no longer exists; PIN cannot be discovered via browser dev tools
- **Server-side validation**: PIN is validated via `/api/admin/history_status` endpoint before unlocking admin modal
- **Session persistence**: PIN stored in IIFE closure scope only, persists until page refresh (closing modal does not require re-entry)

### Bug Fixes
- **Tile labels persist after admin actions**: Added `refreshAdminOverlays()` call after every `refreshWallFromServer()` so tile labels remain visible after clear/move/undo/shuffle operations
- **Admin session persists until page refresh**: Fixed regression where closing the admin modal required re-entering the PIN. Now the session stays active until page refresh, matching original behavior

### Shuffle Refactor
- **Database-driven tile list**: Shuffle now queries all tiles from database instead of parsing SVG
- **Non-destructive updates**: Uses `UPDATE` instead of `DELETE`/`INSERT` for tile assignments
- **True randomization**: Shuffles both asset IDs and tile IDs independently before reassigning

### SVG Grid
- **Expanded canvas**: Height increased from 1211.63pt to 1594.36pt to accommodate more tiles

---

## Recent Changes (2026-02-01)

### Features Added
- Extended metadata fields (year, medium, dimensions, edition, for_sale, sale_type)
- Dual contact fields with type selection (email/social/website)
- Required field validation for Artist Name and Artwork Title
- Clickable contact links in ribbon (mailto/https)
- Ribbon close button (X) with proper visibility states
- Navigation arrows: pulsing right/down arrows that appear after welcome popup, dismiss after 200px scroll
- Popup close button (X) above image for clearer dismiss affordance
- Updated welcome popup text with navigation hints

### Code Refactoring
- Extracted `admin.js` from `main.js` (~750 lines moved)
- Added versioned migration system to `db.py` (SCHEMA_VERSION = 3)
- Removed legacy code: demo autofill, unused functions, deprecated fields
- CSS cleanup: removed unused variables (--spotX, --spotY, --spotSize), consolidated duplicate rules
- Removed `artist_contact` from API responses (deprecated, use contact1/contact2)
- Removed `artist_contact` from frontend JS (main.js, upload_modal.js) - fully deprecated
- Simplified upload endpoint (removed fallback logic)

### Bug Fixes
- Double confirmation dialog bug: Added button disable during async operations + event.stopPropagation() to all admin action handlers. Clear browser cache to apply fix.
- Metadata loss after admin actions: `refreshWallFromServer()` was only extracting 4 fields (tile_url, popup_url, artwork_name, artist_name) instead of all 14 metadata fields. Now matches `hydrateWallStateFromExistingData()`.
- Hidden ribbon links capturing taps (mobile): Contact links had `pointer-events: auto` which overrode parent's `none` when ribbon was dismissed. Fixed with `!important` override on `.hide-info` state.

## Notes
- Undo history is in-memory (resets on server restart)
- Images stored in `/uploads/` directory with UUID filenames
- No authentication beyond admin PIN for admin functions
- Schema migrations run automatically on startup
