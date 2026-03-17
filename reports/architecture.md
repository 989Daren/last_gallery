# The Last Gallery - Architecture Reference

**Generated:** December 21, 2025  
**Purpose:** Canonical structural reference for AI-assisted development sessions

---

## Table of Contents

1. [Repository Overview](#repository-overview)
2. [Frontend Structure](#frontend-structure)
3. [Backend Structure (Flask)](#backend-structure-flask)
4. [Frontend ↔ Backend Contracts](#frontend--backend-contracts)
5. [Data & State Ownership](#data--state-ownership)
6. [Shared Constants & Invariants](#shared-constants--invariants)
7. [Known Soft Spots](#known-soft-spots)
8. [How to Orient a New AI or Developer](#how-to-orient-a-new-ai-or-developer)

---

## Repository Overview

### Folder Tree

```
last_gallery/
├── app.py                          # Flask backend (1166 lines)
├── grid_color.json                 # Persisted grid color preference
├── data/
│   ├── assets.json                 # Artwork metadata (legacy/fallback)
│   ├── gallery.db                  # SQLite database (placements + snapshots + assets)
│   ├── placement.json              # SVG→grid tile ID mapping
│   ├── wall_state.json             # Tile assignments (legacy/fallback)
│   └── wall_state_history.json     # Undo history (legacy system)
├── docs/
│   ├── last_gallery_reference_index.md
│   └── tile_grid_runtime_rendering_guide.md
├── static/
│   ├── artwork/                    # Demo artwork images (11 files)
│   ├── css/
│   │   └── styles.css              # Main stylesheet
│   ├── js/
│   │   ├── main.js                 # Gallery grid + admin logic (1095 lines)
│   │   └── upload_modal.js         # Upload workflow (409 lines)
│   ├── vendor/
│   │   └── cropper/                # Cropper.js library
│   └── grid_full.svg               # SVG grid definition
├── templates/
│   └── index.html                  # Single-page application template
└── uploads/                        # User-uploaded artwork (tile + popup images)
```

### File Roles

| File | Responsibility |
|------|----------------|
| `app.py` | Flask web server, all API routes, database access, file I/O |
| `index.html` | Page structure, modal definitions, server state injection |
| `main.js` | SVG grid parsing, tile rendering, admin controls, wall state management |
| `upload_modal.js` | Upload workflow, image cropping, asset creation, tile assignment |
| `styles.css` | Visual styling, grid layout, modal overlays |
| `grid_full.svg` | Source of truth for tile positions and dimensions |
| `placement.json` | SVG shape ID → gallery tile ID mapping (generated server-side) |
| `gallery.db` | SQLite database with 3 tables (placements, placement_snapshots, assets) |

### Entry Points

1. **Web Entry:** `http://localhost:5000/` → `app.py:index()` → `templates/index.html`
2. **Frontend Init:** `index.html` loads `main.js` and `upload_modal.js` (DOMContentLoaded)
3. **Grid Rendering:** `main.js` fetches `/static/grid_full.svg`, parses shapes, creates tiles
4. **Wall State Load:** `main.js` fetches `/api/wall_state`, applies assignments to tiles

---

## Frontend Structure

### `static/js/main.js` (1095 lines)

**Primary Responsibility:**  
- Parse `grid_full.svg` to extract tile definitions
- Render tile elements into `#galleryWall`
- Load and apply wall state (artwork assignments)
- Handle admin controls (clear, move, undo, shuffle)
- Manage tile selection and popup display

**Public/Global Functions (on `window`):**
- `window.applyAssetToTile(tileEl, asset)` - Apply artwork to tile element
- `window.resetTileToEmpty(tileEl)` - Remove artwork from tile
- `window.selectRandomEmptyXSTile()` - Find random unoccupied XS tile

**Global Variables:**
- `window.SERVER_GRID_COLOR` - Grid color injected from server (index.html:16)
- `window.SERVER_PLACEMENT` - Empty object (demo placement disabled)
- `window.selectedTileId` - Currently selected tile for admin operations

**DOM Dependencies (IDs):**
- `#galleryWall` - Container for rendered tiles
- `#addArtworkBtn` - Opens upload modal
- `#adminBtn` - Opens admin modal
- `#adminModal` - Admin controls modal
- `#adminPinInput`, `#adminPinSubmit` - PIN authentication
- `#adminControlsPanel` - Admin controls (hidden until unlocked)
- `#gridColorPicker` - Tile color selector
- `#outlineToggle` - Toggle tile outlines
- `#adminClearTileIdInput`, `#clearTileBtn` - Clear single tile
- `#moveFromInput`, `#moveToInput`, `#moveTileBtn` - Move artwork
- `#clearAllBtn` - Clear entire grid
- `#undoBtn` - Undo last action
- `#shuffleBtn` - Shuffle artwork to random tiles
- `#adminStatus` - Status message display

**DOM Dependencies (Classes):**
- `.tile` - Individual tile elements (created dynamically)
- `.tile-label` - Tile ID label overlay
- `.art-frame` - Container for artwork image
- `.art-imgwrap` - Wrapper for tile image
- `.tile-art` - Actual img element
- `.occupied` - Class applied when tile has artwork
- `.modalOverlay` - Modal backdrop
- `.hidden` - Visibility toggle

**Event Listeners:**
- Tile clicks → open popup with full artwork
- Admin button → open admin modal
- PIN submit → unlock admin controls
- Clear tile → POST `/api/admin/clear_tile`
- Clear all → POST `/api/admin/clear_all_tiles`
- Move tile → POST `/api/admin/move_tile_asset`
- Undo → POST `/api/admin/undo`
- Shuffle → POST `/shuffle`
- Color picker → POST `/api/grid-color`

**Implicit Dependencies:**
- Requires `upload_modal.js` exports: `window.applyAssetToTile()` (consumed after upload)
- Assumes Cropper.js library loaded (not directly used in this file)

---

### `static/js/upload_modal.js` (409 lines)

**Primary Responsibility:**  
- Manage upload modal workflow
- Image cropping with Cropper.js
- Generate tile (square crop) and popup (full size) images
- Upload assets to server
- Assign uploaded artwork to random empty XS tile

**Public/Global Functions:**
- None exported (self-contained module)

**Global State:**
- `let uploadInFlight` - Guard to prevent duplicate uploads

**DOM Dependencies (IDs):**
- `#uploadModal` - Upload modal container
- `#addArtworkBtn` - Opens modal (listener in main.js)
- `#cancelUploadBtn` - Closes modal
- `#uploadFile` - File input
- `#previewImage` - Image preview for cropping
- `#uploadContinue` - Submit button
- `#artworkName`, `#artistName` - Metadata inputs
- `#galleryWall` - Target for tile assignment (queries `.tile`)

**Event Listeners:**
- File input change → load image, init Cropper
- Continue button → crop image, upload, assign to tile, close modal
- Cancel button → reset and close modal

**Backend API Calls:**
- POST `/api/upload_assets` - Upload tile + popup images with metadata
- POST `/api/assign_tile` - Assign asset to specific tile

**Consumes from `window`:**
- `window.applyAssetToTile()` - Apply uploaded asset to selected tile

**Constants:**
- `TILE_SIZE = 1024` - Square tile image dimensions
- `POPUP_MAX_SIZE = 1792` - Max long edge for popup image
- `OUTPUT_MIME = "image/jpeg"` - Output format
- `OUTPUT_QUALITY = 0.9` - JPEG compression quality

---

## Backend Structure (Flask)

### Routes Overview

| Route | Method | Handler | Purpose | Auth |
|-------|--------|---------|---------|------|
| `/` | GET | `index()` | Serve main page with initial state | None |
| `/api/grid-color` | POST | `set_grid_color()` | Update grid tile color | None |
| `/api/wall_state` | GET | `get_wall_state()` | Get current tile→artwork assignments | None |
| `/uploads/<filename>` | GET | `uploads()` | Serve uploaded artwork files | None |
| `/api/upload_assets` | POST | `upload_assets()` | Upload tile + popup images | None |
| `/api/assign_tile` | POST | `assign_tile()` | Assign asset to tile | None |
| `/api/admin/clear_tile` | POST | `admin_clear_tile()` | Clear single tile | PIN |
| `/api/admin/clear_all_tiles` | POST | `admin_clear_all_tiles()` | Clear all tiles | PIN |
| `/api/admin/undo` | POST | `admin_undo()` | Restore previous state | PIN |
| `/api/admin/history_status` | GET | `admin_history_status()` | Get undo history count | PIN |
| `/api/admin/tile_info` | GET | `admin_tile_info()` | Get tile assignment details | PIN |
| `/api/admin/move_tile_asset` | POST | `admin_move_tile_asset()` | Move artwork between tiles | PIN |
| `/shuffle` | POST | `shuffle_tiles()` | Shuffle all artwork to random tiles | None |

### Admin Authentication

**Mechanism:** `X-Admin-Pin` header (value: `"<admin_pin>"`)  
**Checked by:** `check_admin_pin()` helper  
**Returns:** 401 Unauthorized if PIN missing or incorrect

### Persistence Layer

**Dual-Mode System** (controlled by feature flags):

#### SQLite Mode (Active)
- **Flag:** `USE_SQLITE_PLACEMENTS = True`, `USE_SQLITE_ASSETS = True`
- **Database:** `data/gallery.db`
- **Tables:**
  - `placements` - Current tile→asset assignments
    - Columns: `tile_id TEXT PRIMARY KEY, asset_id TEXT, placed_at TEXT`
  - `placement_snapshots` - Undo snapshot stack
    - Columns: `id INTEGER PRIMARY KEY, created_at TEXT, action TEXT, state_json TEXT`
  - `assets` - Artwork metadata
    - Columns: `asset_id TEXT PRIMARY KEY, created_at TEXT, tile_url TEXT, popup_url TEXT, artwork_name TEXT, artist_name TEXT, notes TEXT, paid INTEGER`

#### JSON Fallback Mode
- **Files:**
  - `data/wall_state.json` - Tile assignments (mirrors SQLite placements)
  - `data/assets.json` - Artwork metadata (mirrors SQLite assets)
  - `data/wall_state_history.json` - Undo history (legacy system, still used by `/api/admin/history_status`)

#### Core Persistence Functions

**Wall State:**
- `load_wall_state()` - Returns `{tile_id: asset_id}` dict
- `save_wall_state(state_dict)` - Persists tile assignments
- Auto-selects SQLite or JSON based on `USE_SQLITE_PLACEMENTS`

**Assets:**
- `load_assets()` - Returns `{asset_id: {metadata}}` dict
- `save_assets(assets_dict)` - Persists artwork metadata
- Auto-selects SQLite or JSON based on `USE_SQLITE_ASSETS`
- Auto-migrates JSON→SQLite on first run if SQLite mode enabled

**Undo System:**
- `push_snapshot(action, state)` - Save state before destructive operation (SQLite)
- `pop_latest_snapshot()` - Restore most recent snapshot (SQLite)
- Legacy: `push_history_snapshot()`, `pop_history_snapshot()` (JSON, preserved for `/api/admin/history_status`)

---

## Frontend ↔ Backend Contracts

### GET `/api/wall_state`

**Called by:** `main.js` (on page load and after state changes)

**Request:** None

**Response:**
```json
{
  "assignments": [
    {
      "tile_id": "X1",
      "tile_url": "/uploads/tile_abc123.jpg",
      "popup_url": "/uploads/popup_abc123.jpg",
      "artwork_name": "Sunset",
      "artist_name": "Jane Doe",
      "asset_id": "abc123-uuid"
    }
  ]
}
```

**Frontend Action:** Clears all tiles, applies assignments via `applyAssetToTile()`

---

### POST `/api/upload_assets`

**Called by:** `upload_modal.js` (after image cropping)

**Request:** `multipart/form-data`
- `tile_image` - File (cropped square, 1024x1024)
- `popup_image` - File (full size, max 1792px long edge)
- `artwork_name` - String (default: "Untitled")
- `artist_name` - String (default: "Anonymous")

**Response:**
```json
{
  "asset_id": "uuid",
  "tile_url": "/uploads/tile_uuid.jpg",
  "popup_url": "/uploads/popup_uuid.jpg",
  "artwork_name": "User Title",
  "artist_name": "User Name"
}
```

**Frontend Action:** Stores result, calls `/api/assign_tile`

---

### POST `/api/assign_tile`

**Called by:** `upload_modal.js` (after upload completes)

**Request:** `application/json`
```json
{
  "tile_id": "X99",
  "asset_id": "uuid"
}
```

**Response:**
```json
{
  "ok": true
}
```

**Frontend Action:** Calls `window.applyAssetToTile()` to update UI, closes modal

---

### POST `/api/admin/clear_tile`

**Called by:** `main.js` (admin controls)

**Headers:** `X-Admin-Pin: <admin_pin>`

**Request:** `application/json`
```json
{
  "tile_id": "X99"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Tile already empty"  // optional
}
```

**Side Effects:**
- Pushes SQLite snapshot (if tile not empty)
- Removes tile assignment from database
- Does NOT push snapshot if tile already empty

---

### POST `/api/admin/undo`

**Called by:** `main.js` (admin controls)

**Headers:** `X-Admin-Pin: <admin_pin>`

**Request:** None

**Response (success):**
```json
{
  "ok": true,
  "action": "clear_tile:X99"  // describes what was undone
}
```

**Response (no history):**
```json
{
  "ok": false,
  "message": "No undo available"
}
```

**Frontend Action:** Calls `refreshWallFromServer()` to reload entire wall state

---

### POST `/shuffle`

**Called by:** `main.js` (admin shuffle button)

**Request:** `application/json`
```json
{
  "mode": "random"
}
```

**Response:**
```json
{
  "status": "ok",
  "shuffled_count": 5,
  "message": "Shuffled 5 artworks to random tiles"
}
```

**Frontend Action:** Calls `refreshWallFromServer()` to reload wall state

---

## Data & State Ownership

### Tile Definitions (Static)

**Source of Truth:** `static/grid_full.svg`  
**Parser:** `main.js:parseGridFromSVG()`  
**Mapping:** `data/placement.json` (SVG shape ID → tile ID)  
**Generated:** Server-side on first load if missing  
**Invariant:** Tile positions and dimensions are immutable once parsed

### Tile State (Runtime)

**Source of Truth:** SQLite `placements` table (or `data/wall_state.json` in JSON mode)  
**Loaded by:** `app.py:load_wall_state()`  
**Exposed via:** GET `/api/wall_state`  
**Modified by:** POST `/api/assign_tile`, `/api/admin/clear_tile`, `/api/admin/clear_all_tiles`, `/api/admin/move_tile_asset`, `/shuffle`  
**Frontend Shadow:** DOM tile elements with `.occupied` class and `data-*` attributes  
**Sync Mechanism:** Frontend calls `refreshWallFromServer()` after mutations

### Artwork Metadata

**Source of Truth:** SQLite `assets` table (or `data/assets.json` in JSON mode)  
**Created by:** POST `/api/upload_assets`  
**Loaded by:** `app.py:load_assets()` (merged with wall_state in `/api/wall_state` response)  
**Fields:**
- `asset_id` - UUID primary key
- `tile_url` - Path to square tile image
- `popup_url` - Path to full-size popup image
- `artwork_name` - User-provided title
- `artist_name` - User-provided artist name
- `created_at` - ISO timestamp
- `notes`, `paid` - Reserved for future use

**Invariant:** Asset metadata is immutable after creation (no edit functionality exists)

### Undo History

**Primary System (Active):** SQLite `placement_snapshots` table  
**Legacy System (Preserved):** `data/wall_state_history.json`  
**Push Triggers:**
- Clear tile (if tile not empty)
- Clear all tiles (if grid not empty)
- Move tile (always)

**Pop Trigger:** POST `/api/admin/undo`

**Stack Behavior:** LIFO (Last In, First Out)  
**Snapshot Content:** Full wall_state dict serialized as JSON  
**Action Descriptor:** String like `"clear_tile:X99"`, `"clear_grid"`, `"move_tile:X1->X2"`

**Important:** Legacy JSON history system still used by `/api/admin/history_status` for frontend undo button state

### Grid Color

**Storage:** `grid_color.json`  
**Default:** `#aa6655`  
**Modified by:** POST `/api/grid-color`  
**Applied by:** CSS variable set via JS on page load

---

## Shared Constants & Invariants

### Tile Sizing

**Base Unit:** `85px` (defined in `main.js` and CSS)  
**Tile Categories:**
- XS: 85×85px
- S: ~170px
- M: ~255px
- L: ~340px
- XL: ~510px

**Grid Detection:** Frontend measures rendered tile dimensions to classify size

### Upload Constraints

**File Types:** `image/png`, `image/jpeg` only  
**Tile Image:** 1024×1024px square (cropped)  
**Popup Image:** Max 1792px on long edge (maintains aspect ratio)  
**Output Format:** JPEG with 0.9 quality

### Admin PIN

**Value:** `"<admin_pin>"`  
**Location:** `app.py:ADMIN_PIN`, `main.js:ADMIN_PIN`  
**Must match:** Frontend sends in `X-Admin-Pin` header, backend validates

### Endpoint Paths

**Defined in:**
- Backend: `@app.route()` decorators
- Frontend: String literals in `fetch()` calls
- Frontend constant: `main.js:ENDPOINTS` (partial list)

**Naming Convention:**
- Public: `/api/<resource>`
- Admin: `/api/admin/<action>`
- Special: `/shuffle`, `/uploads/<file>`

### Feature Flags

**Server-side:**
- `SERVER_DEBUG` - Enable debug logging
- `DEBUG_DB_TRACE` - Log SQLite operations
- `ENABLE_DEMO_AUTOFILL` - Auto-generate demo artwork (DISABLED)
- `USE_SQLITE_PLACEMENTS` - Use SQLite for tile assignments (ENABLED)
- `USE_SQLITE_ASSETS` - Use SQLite for artwork metadata (ENABLED)

**Client-side:**
- `DEBUG` - Enable console logging (main.js, upload_modal.js)
- `ENABLE_DEMO_AUTOFILL` - Auto-generate demo artwork (DISABLED)

---

## Known Soft Spots

### 1. Dual Persistence System

**Status:** Transitioning from JSON to SQLite  
**Risk:** Code maintains both paths for backwards compatibility  
**Files:** `app.py` (load_wall_state, save_wall_state, load_assets, save_assets)  
**Mitigation:** Feature flags control which system is active  
**Future:** Consider removing JSON fallback once SQLite stable in production

### 2. Legacy History System

**Issue:** `/api/admin/history_status` still uses JSON-based history  
**Location:** `app.py:admin_history_status()`, `main.js:fetchHistoryStatus()`  
**Risk:** Undo snapshots stored in SQLite, but history count queried from JSON  
**Impact:** Undo button state may be incorrect  
**Preserved because:** Frontend actively calls this endpoint  
**Future:** Migrate frontend to query SQLite snapshot count

### 3. Upload Modal + Main.js Coupling

**Issue:** `upload_modal.js` relies on `window.applyAssetToTile()` exported by `main.js`  
**Risk:** Load order dependency (main.js must load first)  
**Current:** Works because script tags in correct order  
**Future:** Consider explicit dependency injection or module system

### 4. Tile Selection by Rendered Size

**Issue:** Frontend classifies tiles by measuring DOM dimensions  
**Location:** `main.js:selectRandomEmptyXSTile()`  
**Risk:** CSS changes or zoom levels could break size detection  
**Tolerance:** ±2px currently hardcoded  
**Alternative:** Use tile ID prefix (X=XS, S=S, etc.) but breaks if naming changes

### 5. Shuffle Logic

**History:** Previously had issues with state synchronization  
**Current:** Re-enabled and working (Dec 2025)  
**Location:** `app.py:shuffle_tiles()`  
**Characteristics:**
- Operates on server-side state
- Randomizes asset→tile assignments
- No undo snapshot pushed (by design)
- Frontend must refresh to see changes

---

## How to Orient a New AI or Developer

### Quick Start Sequence

**1. Read These Files First (in order):**
1. `docs/last_gallery_reference_index.md` - Project overview
2. `templates/index.html` - Page structure and DOM IDs
3. `static/js/main.js` (lines 1-100) - Constants and globals
4. `app.py` (lines 1-100) - Feature flags and config
5. This document (`reports/architecture.md`) - Full system reference

**2. Understand the Core Flow:**
```
User clicks "Add Artwork"
  → upload_modal.js opens modal
  → User selects image, crops, enters metadata
  → POST /api/upload_assets (saves files, creates asset record)
  → POST /api/assign_tile (links asset to tile)
  → window.applyAssetToTile() updates DOM
  → Modal closes
  → Artwork visible on grid
```

**3. Understand State Synchronization:**
```
SQLite placements table (server)
  ↓ (exposed via)
GET /api/wall_state
  ↓ (consumed by)
main.js:refreshWallFromServer()
  ↓ (applies to)
DOM tile elements with .occupied class
```

### What NOT to Change Casually

**❌ DO NOT MODIFY:**
1. **SVG Grid Structure** - Tile positions defined in `grid_full.svg`, changing breaks layout
2. **API Request/Response Shapes** - Breaking changes require coordinated frontend/backend updates
3. **Admin PIN Value** - Hardcoded in two places, must match exactly
4. **Tile Size Constants** - CSS and JS must agree on dimensions
5. **Upload Image Sizes** - 1024px tile, 1792px popup are optimized values
6. **Database Schema** - Migrations required for schema changes
7. **Feature Flag Defaults** - SQLite mode is active, JSON is fallback only

**⚠️ CHANGE WITH CAUTION:**
1. **Route Paths** - Update both backend decorator and frontend fetch() calls
2. **DOM IDs** - Used by both JS files and CSS selectors
3. **Window Exports** - Breaking `window.applyAssetToTile` breaks upload flow
4. **Load Order** - `main.js` must load before `upload_modal.js`

### Which Parts Are Still Evolving

**🔄 ACTIVE DEVELOPMENT:**
1. **SQLite Migration** - JSON fallback exists but SQLite is primary
2. **Undo System Unification** - SQLite snapshots active, JSON history still used by one endpoint
3. **Asset Metadata Schema** - `notes` and `paid` fields reserved but unused

**✅ STABLE:**
1. **Grid Rendering** - SVG parsing and tile creation is mature
2. **Upload Workflow** - Image cropping and asset creation is solid
3. **Admin Controls** - Clear, move, undo operations are tested
4. **Frontend-Backend Contract** - API shapes are established

### Which Contracts Are Fixed

**🔒 IMMUTABLE CONTRACTS:**

1. **GET `/api/wall_state` Response:**
   ```json
   { "assignments": [{ "tile_id", "tile_url", "popup_url", "artwork_name", "artist_name", "asset_id" }] }
   ```
   - Frontend expects this exact structure
   - Consumed by tile rendering logic
   - Breaking changes require frontend update

2. **POST `/api/upload_assets` Workflow:**
   - Must accept `multipart/form-data` with `tile_image`, `popup_image`, metadata
   - Must return asset object with URLs
   - Upload modal depends on this contract

3. **Admin Authentication:**
   - `X-Admin-Pin: <admin_pin>` header required
   - 401 response if missing/incorrect
   - All admin routes enforce this

4. **Tile ID Format:**
   - Pattern: `[XSML](\d+)` (e.g., X1, S2, M10, L5, XL3)
   - Used in URLs, DOM attributes, database records
   - Frontend and backend both parse this format

### Debug Workflow

**Enable Debug Logging:**
1. Set `DEBUG = true` in `main.js` and `upload_modal.js`
2. Set `DEBUG_DB_TRACE = True` in `app.py`
3. Observe console for state transitions and API calls

**Inspect State:**
- SQLite: `sqlite3 data/gallery.db` → `.tables` → `SELECT * FROM placements;`
- JSON: `cat data/wall_state.json` (if fallback mode)
- DOM: Inspect `.tile` elements for `data-occupied`, `data-asset-id` attributes

**Common Issues:**
- **"Uploading..." stuck:** Check `uploadInFlight` flag in upload_modal.js
- **Undo button disabled:** Check `/api/admin/history_status` response
- **Tiles not rendering:** Check SVG fetch and `placement.json` mapping
- **Assets not loading:** Check file permissions on `uploads/` directory

---

## Revision History

| Date | Change |
|------|--------|
| 2025-12-21 | Initial architecture reference generated |

---

**End of Document**

For questions or clarifications, refer to inline code comments or the `docs/` directory.
