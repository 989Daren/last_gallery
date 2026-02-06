# The Last Gallery - Project Summary

## Overview
A Flask-based web gallery application where users can upload artwork images that display on a tiled wall. Each tile can be clicked to view the full-size image with metadata displayed in an animated overlay ribbon.

## Tech Stack
- **Backend**: Python/Flask
- **Database**: SQLite (single source of truth) with versioned migrations
- **Frontend**: Vanilla JavaScript (modular), CSS
- **Image Processing**: Cropper.js (client-side cropping), Pillow (server-side optimization)

## How to Run
```bash
pip install -r requirements.txt
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
3. Server optimizes popup image (see below) and saves to `/uploads/`, creates DB records
4. Metadata modal appears → user enters required + optional fields → saved to DB
5. Wall refreshes to show new image

### Image Optimization (server-side)
- **Tile image**: Saved as-is (already 512x512 JPEG from client)
- **Popup image**: Optimized via Pillow before saving:
  - Resized proportionally if longest side exceeds 2560px
  - Converted to JPEG at 90% quality
  - EXIF orientation auto-corrected
  - Transparent PNGs get white background

## Welcome Popup
- Displays on every page load
- **Layout**: Centered title, logo (left) + bullet instructions (right), Enter button below
- **Logo**: `static/images/logo.svg` (168px desktop, 108px mobile)
- **Content**: "Welcome to The Last Gallery" title, bulleted instructions
- **Animation**: Diagonal reflection sweep across modal (simpleWelcomeSheen)
- Dismissed via "Enter" button, backdrop click, or Escape key

## Initial Gallery View
- **Centered on load**: Gallery starts at 50%, 50% (center of grid)
- **Matches zoom center**: Same center point used during pinch-to-zoom for smooth UX
- **Pre-positioned**: Centering happens before welcome modal, so view is ready when dismissed

## Popup Overlay
- **Animation sequence**: image appears → title fades in → black ribbon slides from left → text reveals
- **Close behavior**: First click hides ribbon, second click closes popup
- **Popup close button**: X button above top-right corner of image (always visible when popup is open)
- **Ribbon close button**: X button in top-right corner of ribbon (visible only when ribbon is shown)
- **Contact links**: Clickable (email opens mail client, web links open in new tab)

## Pinch-to-Zoom (Mobile)
Custom zoom for touch devices allowing users to see the entire gallery at once.

- **HTML Structure**:
  ```
  .gallery-wall-wrapper (scroll container)
    └── .zoom-wrapper (receives transform)
         └── #galleryWall (content)
  ```
- **Gestures**:
  - Two-finger pinch: Zoom in/out
  - Single-finger drag (when zoomed): Pan within bounds
  - Back button: Unwinds layers (ribbon → popup → zoom → leave page)
- **Behavior at max zoom-out**: Grid fits viewport width exactly (no horizontal padding), centered vertically
- **Boundary clamping**: Can't pan past grid edges (20px padding)
- **Disabled during**: Welcome modal, upload modal, admin modal, artwork popup
- **Auto-reset**: Zoom resets to 1.0x after wall refresh (shuffle, clear, move, undo)

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
window.initZoom()                 // Initialize pinch-to-zoom
window.resetZoom()                // Reset zoom to 1.0x
```

### admin.js Module
- IIFE pattern with initialization guards
- PIN validated server-side via `/api/admin/history_status` before unlocking modal
- PIN stored in closure-scoped `_adminPin` variable (not exposed to window), persists until page refresh
- Handles: modal PIN gate, clear/move/undo actions, shuffle, tile labels toggle
- Guards prevent duplicate event handler registration

## Recent Changes (2026-02-06)

### Atomic Zoom Reset (Back Button Flash Fix)
- **Problem**: Back button from zoomed-out state flashed 0,0 before centering. `lockScroll()` zeroed scroll position; old `unlockScroll()` restored overflow without positioning, leaving a 1-2 frame gap before `centerGalleryView()` ran via `requestAnimationFrame`
- **Fix**: Replaced `unlockScroll()` with `unlockScrollTo(scrollX, scrollY)` — atomic function that restores overflow and sets scroll position in one operation. Scroll is never visible at 0,0
- **`getCenterScrollPosition()`**: Extracted center calculation into reusable helper; `centerGalleryView()` refactored to use it
- **API design**: `unlockScrollTo` requires a target position — impossible to call without specifying where scroll goes, eliminating the temporal coupling bug
- **Double-tap removed**: Removed unused double-tap-to-reset gesture and related state tracking from zoom

---

## Recent Changes (2026-02-05)

### Pinch-to-Zoom (Mobile)
- **Architecture**: Separate scroll container (`.gallery-wall-wrapper`) and zoom wrapper (`.zoom-wrapper`)
- **Transform**: `transform-origin: 0 0` with `translate(tx, ty) scale(s)`
- **Max zoom-out**: Grid fits viewport width exactly (edge-to-edge), vertically centered with equal padding
- **Panning**: Single-finger drag when zoomed out, clamped to grid edges (20px padding)
- **Back button**: Integrated with ConicalNav using compound hashes (`#zoom/art/ribbon`); layers unwind in order: ribbon → popup → zoom → leave page
- **Scroll locking**: Native scroll disabled when zoomed out, re-enabled at scale=1
- **Modal awareness**: Zoom disabled when welcome/upload/admin/popup modals are open
- **Wall refresh**: Zoom resets to 1.0x after `refreshWallFromServer()` (shuffle, clear, move, undo)

### Centered Gallery View
- **Initial position**: Gallery loads centered at 50%, 50% (not 0,0)
- **Pre-positioned**: Centering happens on page load, before welcome modal dismissal
- **Matches zoom**: Same center point as pinch-to-zoom for seamless UX
- **Nav arrows removed**: Replaced by ghost finger pinch-out animation (planned)

---

## Recent Changes (2026-02-04)

### Popup Close Button UX
- **Delayed visibility**: Popup close button (X above image) now appears only after ribbon is dismissed, not immediately when popup opens
- **Smaller background**: Reduced circle size from 32px to 29px while keeping X icon at 22px

### Mobile Responsiveness
- **Metadata modal scroll fix**: Modal was taller than viewport on mobile, hiding header and Save button
- **Flexbox layout**: Modal card now uses `display: flex; flex-direction: column` with `max-height: calc(100vh - 40px)`
- **Fixed header/footer**: Header (`flex-shrink: 0`) and action buttons (`flex-shrink: 0`) stay visible
- **Scrollable body**: Form content scrolls with `flex: 1; overflow-y: auto; min-height: 0`

### Welcome Modal Redesign
- **Added logo**: `static/images/logo.svg` displayed in welcome modal
- **Horizontal layout**: Centered title at top, logo on left with bullet instructions on right
- **Vertical centering**: Logo and bullet text vertically aligned using `align-items: center`
- **Responsive sizing**: Desktop (168px logo, 31px title, 20px bullets) / Mobile (108px logo, 25px title, 18px bullets)
- **Maintains horizontal layout on mobile**: Elements scale down but don't stack
- **Cleanup**: Removed deprecated `.simpleWelcomeText` class, updated legacy comments

### Server-side Image Optimization
- **Popup image optimization**: Large uploads now resized server-side using Pillow
- **Max dimension**: 2560px on longest side (proportional scaling)
- **Format conversion**: All popup images converted to JPEG at 90% quality
- **EXIF handling**: Auto-rotates based on EXIF orientation metadata
- **Transparency handling**: RGBA/PNG images get white background
- **New dependency**: Added `requirements.txt` with Flask and Pillow

---

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
