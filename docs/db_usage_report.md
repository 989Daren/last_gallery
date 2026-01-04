# Database Usage Report: The Last Gallery
**Generated:** January 4, 2026  
**Database:** SQLite 3  
**File:** `data/gallery.db`

---

## Executive Summary

The Last Gallery uses **SQLite** as its primary persistence layer for artwork metadata, wall placements, and undo history. The database has been progressively migrated from a JSON-based system to SQLite for improved reliability, atomic operations, and query performance.

**Key Features:**
- **3 core tables**: `assets`, `placements`, `placement_snapshots`
- **Hybrid persistence**: Configurable SQLite/JSON modes via feature flags
- **Timeline-aware undo system**: Separate shuffle/non-shuffle undo stacks with cross-timeline protection
- **Auto-migration**: Seamless migration from legacy JSON files to SQLite
- **Admin-gated operations**: All destructive operations protected by PIN authentication

**Critical Flags:**
- `USE_SQLITE_PLACEMENTS = True` → Wall state persistence mode
- `USE_SQLITE_ASSETS = True` → Artwork metadata persistence mode
- `DEBUG_DB_TRACE = True` → Enable SQLite operation logging

---

## 1. Database Inventory & Configuration

### Database Files
| File | Path | Purpose | Size |
|------|------|---------|------|
| `gallery.db` | `data/gallery.db` | SQLite3 database (primary storage) | Variable |
| `assets.json` | `data/assets.json` | Legacy artwork metadata (fallback/migration source) | Static |
| `wall_state.json` | `data/wall_state.json` | Legacy wall placements (fallback) | Static |
| `wall_state_history.json` | `data/wall_state_history.json` | Legacy undo stack (DEPRECATED) | Static |
| `placement.json` | `data/placement.json` | SVG tile-to-asset initial mapping (UNUSED) | Static |

### Connection Management
**Location:** `app.py` lines 79-143  
**Pattern:** Direct `sqlite3.connect()` calls (no ORM)

```python
def init_db():
    """Initialize SQLite database for wall placements and undo snapshots."""
    conn = sqlite3.connect(GALLERY_DB)  # GALLERY_DB = "data/gallery.db"
    cursor = conn.cursor()
    # ... table creation ...
    conn.commit()
    conn.close()
```

**Connection Lifecycle:**
- No connection pooling
- Open/close per operation (short-lived connections)
- Transactions: Explicit `conn.commit()` / implicit rollback on exception
- Thread safety: Not explicitly handled (Flask single-threaded dev server)

### Configuration Constants
```python
# File: app.py, lines 35-59
USE_SQLITE_PLACEMENTS = True   # Toggle SQLite vs JSON for wall state
USE_SQLITE_ASSETS = True        # Toggle SQLite vs JSON for assets metadata
DEBUG_DB_TRACE = True           # Log all DB operations to console
GALLERY_DB = "data/gallery.db"  # Database file path
MAX_HISTORY_DEPTH = 10          # Max undo snapshots to retain
ADMIN_PIN = "8375"              # Admin operation gate
```

---

## 2. Schema Documentation

### Table: `assets`
**Purpose:** Stores artwork metadata (title, artist, file URLs) uploaded by users.

**Schema:**
```sql
CREATE TABLE assets (
    asset_id TEXT PRIMARY KEY,        -- UUID v4 string
    created_at TEXT NOT NULL,          -- ISO 8601 timestamp (UTC)
    tile_url TEXT NOT NULL,            -- Path to tile-sized image (/uploads/tile_uuid.ext)
    popup_url TEXT NOT NULL,           -- Path to full-size popup image (/uploads/popup_uuid.ext)
    artwork_name TEXT NOT NULL,        -- User-provided title (default: "Untitled")
    artist_name TEXT NOT NULL,         -- User-provided artist name (default: "Anonymous")
    notes TEXT,                        -- Optional notes (UNUSED in current UI)
    paid INTEGER DEFAULT 0             -- Payment status flag (0=unpaid, 1=paid; UNUSED)
)
```

**Constraints:**
- `asset_id` is PRIMARY KEY → Unique, indexed automatically
- All TEXT fields (no VARCHAR length limits)
- `notes` and `paid` are optional (not surfaced in UI)

**Indexes:** None (PRIMARY KEY index only)

**Migration:** Auto-migrates from `assets.json` on first run if table is empty (see `migrate_assets_json_to_sqlite_if_needed()`)

---

### Table: `placements`
**Purpose:** Stores the current wall state (which asset is on which tile).

**Schema:**
```sql
CREATE TABLE placements (
    tile_id TEXT PRIMARY KEY,          -- Tile identifier (e.g., "X1", "X99", "S3")
    asset_id TEXT NOT NULL,            -- Foreign key to assets.asset_id (not enforced)
    placed_at TEXT NOT NULL            -- ISO 8601 timestamp when placement occurred
)
```

**Constraints:**
- `tile_id` is PRIMARY KEY → Each tile can only have one asset
- No FOREIGN KEY constraint on `asset_id` (can become orphaned if asset deleted)
- `placed_at` is informational only (not used in queries)

**Indexes:** None (PRIMARY KEY index only)

**Integrity Risk:** If an asset is deleted from `assets` table but `placements` still references it, the tile will show as occupied but artwork data will be missing (orphaned reference).

---

### Table: `placement_snapshots`
**Purpose:** Stores undo history for wall state changes (clear tile, clear all, move, shuffle).

**Schema:**
```sql
CREATE TABLE placement_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- Snapshot ID (sequential)
    created_at TEXT NOT NULL,               -- ISO 8601 timestamp
    action TEXT NOT NULL,                   -- Action type (see below)
    state_json TEXT NOT NULL                -- JSON string of entire wall state
)
```

**Action Types:**
- `"clear_tile:X99"` - Single tile cleared
- `"clear_grid"` - All tiles cleared
- `"move_tile:X99->X12"` - Asset moved between tiles
- `"shuffle"` - Artwork randomly shuffled

**Constraints:**
- `id` auto-increments (used for timeline ordering)
- No size limit on `state_json` (full wall state serialized as JSON)

**Indexes:**
1. `idx_snapshots_action` on `(action)` - For filtering by action type
2. `idx_snapshots_action_id` on `(action, id DESC)` - For "latest shuffle" queries

**Pruning:** Limited to `MAX_HISTORY_DEPTH` (10) snapshots via auto-deletion on push (see `push_snapshot()`)

---

### Table: `sqlite_sequence`
**Purpose:** Internal SQLite table tracking AUTOINCREMENT sequences.  
**Schema:** System-managed (not user-defined)

---

## 3. Database Access Points

### READ Operations

| File | Function | Lines | Operation | Returns |
|------|----------|-------|-----------|---------|
| `app.py` | `sqlite_assets_count()` | 238-244 | `SELECT COUNT(*) FROM assets` | Integer count |
| `app.py` | `sqlite_load_assets()` | 277-301 | `SELECT * FROM assets` | Dict of all assets |
| `app.py` | `load_wall_state()` | 367-387 | `SELECT tile_id, asset_id FROM placements WHERE asset_id IS NOT NULL` | Dict {tile_id: asset_id} |
| `app.py` | `get_last_shuffle_id()` | 449-462 | `SELECT id FROM placement_snapshots WHERE action='shuffle' ORDER BY id DESC LIMIT 1` | Int or None |
| `app.py` | `get_snapshot_counts()` | 465-518 | Multiple COUNT queries on `placement_snapshots` | Dict with counts |
| `app.py` | `pop_latest_snapshot()` | 581-636 | `SELECT id, action, state_json FROM placement_snapshots ... ORDER BY id DESC LIMIT 1` | Tuple (id, action, state) |

### WRITE Operations

| File | Function | Lines | Operation | Input | Side Effects |
|------|----------|-------|-----------|-------|--------------|
| `app.py` | `init_db()` | 79-143 | CREATE TABLE IF NOT EXISTS (all 3 tables) | None | Creates DB file and tables |
| `app.py` | `sqlite_insert_asset()` | 247-274 | `INSERT OR REPLACE INTO assets` | Asset metadata | Upserts asset record |
| `app.py` | `save_wall_state()` | 409-446 | `DELETE FROM placements` then bulk `INSERT` | Dict {tile_id: asset_id} | Replaces entire wall state |
| `app.py` | `push_snapshot()` | 521-559 | `INSERT INTO placement_snapshots` + prune old | (action, state) | Adds snapshot, deletes old |
| `app.py` | `pop_latest_snapshot()` | 581-636 | `DELETE FROM placement_snapshots WHERE id=?` | action_type filter | Removes snapshot after read |

### UPDATE Operations
**None.** All writes use `INSERT OR REPLACE` (upsert) or `DELETE + INSERT` patterns.

### DELETE Operations

| File | Function | Lines | Operation | Trigger |
|------|----------|-------|-----------|---------|
| `app.py` | `save_wall_state()` | 422 | `DELETE FROM placements` | Before saving new state (atomic replacement) |
| `app.py` | `push_snapshot()` | 544-549 | Prune old snapshots (keep latest 10) | After every snapshot push |
| `app.py` | `pop_latest_snapshot()` | 631 | `DELETE FROM placement_snapshots WHERE id=?` | After reading snapshot for undo |

**Risk:** No soft-delete mechanism. Deleted snapshots cannot be recovered.

---

## 4. API Routes & Database Interactions

### Route: `GET /`
**Handler:** `index()` (lines 853-867)  
**Auth:** None  
**DB Ops:** None (only loads legacy `placement.json`)  
**Response:** Renders `index.html` template

---

### Route: `GET /api/wall_state`
**Handler:** `get_wall_state()` (lines 884-922)  
**Auth:** None (public)  
**DB Reads:**
1. `load_wall_state()` → Reads `placements` table
2. `load_assets()` → Reads `assets` table (via `sqlite_load_assets()`)

**Response Format:**
```json
{
  "assignments": [
    {
      "tile_id": "X1",
      "asset_id": "uuid",
      "tile_url": "/uploads/tile_uuid.png",
      "popup_url": "/uploads/popup_uuid.png",
      "artwork_name": "Starry Night",
      "artist_name": "Van Gogh"
    }
  ]
}
```

**Error Cases:**
- If `asset_id` in `placements` doesn't exist in `assets`: silently skipped (orphaned reference handled gracefully)

---

### Route: `POST /api/upload_assets`
**Handler:** `upload_assets()` (lines 930-1000)  
**Auth:** None (public upload)  
**Request Body:** `multipart/form-data`
- `tile_image`: File (cropped tile image)
- `popup_image`: File (full-size image)
- `artwork_name`: String
- `artist_name`: String

**DB Writes:**
1. Generate UUID for `asset_id`
2. Save files to `uploads/` directory
3. `save_assets()` → `sqlite_insert_asset()` → `INSERT OR REPLACE INTO assets`

**Response:**
```json
{
  "asset_id": "uuid",
  "tile_url": "/uploads/tile_uuid.jpg",
  "popup_url": "/uploads/popup_uuid.jpg",
  "artwork_name": "Title",
  "artist_name": "Artist",
  "created_at": "2026-01-04T12:34:56.789Z"
}
```

**Error Cases:**
- Missing files → 400 Bad Request
- Empty filename → 400 Bad Request
- Disk write failure → 500 (exception propagates)

---

### Route: `POST /api/assign_tile`
**Handler:** `assign_tile()` (lines 1002-1032)  
**Auth:** None (public placement)  
**Request Body:**
```json
{
  "tile_id": "X99",
  "asset_id": "uuid"
}
```

**DB Ops:**
1. `load_assets()` → Verify asset exists
2. `load_wall_state()` → Read current placements
3. `save_wall_state()` → `DELETE + INSERT` into `placements`

**Response:** `{"ok": true}`

**Error Cases:**
- Missing params → 400
- Asset not found → 404
- Tile already occupied → **No validation** (overwrites silently)

**Integrity Risk:** No snapshot pushed before placement (undo won't restore previous occupant of this tile).

---

### Route: `POST /api/admin/clear_tile`
**Handler:** `admin_clear_tile()` (lines 1034-1072)  
**Auth:** `X-Admin-Pin: 8375` header required  
**Request Body:**
```json
{
  "tile_id": "X99"
}
```

**DB Ops:**
1. `load_wall_state()` → Check if tile occupied
2. `push_snapshot("clear_tile:X99", wall_state)` → Save undo snapshot
3. `save_wall_state(modified_state)` → Remove tile from placements

**Response:**
```json
{
  "ok": true,
  "shuffle_count": 1,
  "non_shuffle_count": 3
}
```

**Timeline Awareness:** If tile already empty, no snapshot pushed (idempotent).

---

### Route: `POST /api/admin/clear_all_tiles`
**Handler:** `admin_clear_all_tiles()` (lines 1074-1104)  
**Auth:** `X-Admin-Pin: 8375` header required  
**Request Body:** Empty

**DB Ops:**
1. `load_wall_state()` → Check if wall already empty
2. `push_snapshot("clear_grid", wall_state)` → Save undo snapshot
3. `save_wall_state({})` → `DELETE FROM placements` (all rows)

**Response:**
```json
{
  "ok": true,
  "shuffle_count": 1,
  "non_shuffle_count": 4
}
```

**Note:** Does NOT delete asset files from disk or `assets` table (artwork preserved for re-upload).

---

### Route: `POST /api/admin/undo`
**Handler:** `admin_undo()` (lines 1106-1148)  
**Auth:** `X-Admin-Pin: 8375` header required  
**Request Body (optional):**
```json
{
  "action_type": "shuffle"  // or "non_shuffle" or null
}
```

**DB Ops:**
1. `pop_latest_snapshot(action_type)` → Reads + deletes latest snapshot from `placement_snapshots`
2. `save_wall_state(snapshot_state)` → Restores wall state from snapshot
3. `get_snapshot_counts()` → Returns updated counts

**Timeline Behavior:**
- `action_type="shuffle"`: Undo last shuffle only
- `action_type="non_shuffle"`: Undo last non-shuffle action AFTER most recent shuffle (ignores older non-shuffle snapshots)
- `action_type=null`: Undo latest action of any type

**Response:**
```json
{
  "ok": true,
  "action": "clear_tile:X99",
  "shuffle_count": 1,
  "non_shuffle_count": 2
}
```

**Error Cases:**
- No undo available → `{"ok": false, "message": "No undo available", ...counts}`

---

### Route: `GET /api/admin/history_status`
**Handler:** `admin_history_status()` (lines 1150-1175)  
**Auth:** `X-Admin-Pin: 8375` header required  
**DB Reads:** `get_snapshot_counts()` → Queries `placement_snapshots`

**Response:**
```json
{
  "shuffle_count": 1,
  "non_shuffle_count": 3,
  "non_shuffle_total": 5,
  "can_undo": true,
  "can_undo_shuffle": true,
  "last_shuffle_id": 42,
  "history_count": 6
}
```

**Fields:**
- `non_shuffle_count`: Timeline-aware eligible undo count (non-shuffle actions AFTER last shuffle)
- `non_shuffle_total`: Total non-shuffle actions (including pre-shuffle)
- `last_shuffle_id`: Database ID of most recent shuffle snapshot

---

### Route: `GET /api/admin/tile_info`
**Handler:** `admin_tile_info()` (lines 1177-1232)  
**Auth:** `X-Admin-Pin: 8375` header required  
**Query Params:** `?tile_id=X99`

**DB Reads:**
1. `load_wall_state()` → Check tile occupation
2. `load_assets()` → Get asset details

**Response (Occupied):**
```json
{
  "ok": true,
  "tile_id": "X99",
  "occupied": true,
  "asset_id": "uuid",
  "artwork_name": "Title",
  "artist_name": "Artist",
  "tile_url": "/uploads/tile_uuid.jpg",
  "popup_url": "/uploads/popup_uuid.jpg"
}
```

**Response (Empty):**
```json
{
  "ok": true,
  "tile_id": "X99",
  "occupied": false
}
```

**Orphaned Asset Handling:** If tile references missing asset, returns "Unknown" for metadata fields.

---

### Route: `POST /api/admin/move_tile_asset`
**Handler:** `admin_move_tile_asset()` (lines 1234-1289)  
**Auth:** `X-Admin-Pin: 8375` header required  
**Request Body:**
```json
{
  "from_tile_id": "X99",
  "to_tile_id": "X12",
  "override": false
}
```

**DB Ops:**
1. `load_wall_state()` → Validate source occupied, destination empty
2. `push_snapshot("move_tile:X99->X12", wall_state)` → Save undo snapshot
3. `save_wall_state(modified_state)` → Move asset pointer

**Response:**
```json
{
  "ok": true,
  "shuffle_count": 1,
  "non_shuffle_count": 4,
  "history_count": 5
}
```

**Validation:**
- Source empty → 400 error
- Destination occupied → 400 error
- Size mismatch → Client-side only (backend accepts with `override=true`)

**Note:** No actual file moves occur (only database pointer updated).

---

### Route: `POST /shuffle`
**Handler:** `shuffle_placement()` (lines 1291-1343)  
**Auth:** PIN in request body (`{"pin": "8375"}`)  
**DB Ops:**
1. `load_wall_state()` → Get current placements
2. `push_snapshot("shuffle", wall_state)` → Save pre-shuffle state
3. Parse `static/grid_full.svg` for all tile IDs
4. Randomly assign existing assets to random tiles
5. `save_wall_state(new_state)` → Apply shuffled state

**Response:**
```json
{
  "ok": true,
  "shuffle_count": 2,
  "non_shuffle_count": 0
}
```

**Behavior:**
- Shuffles ONLY existing artwork (doesn't add/remove assets)
- Can move artwork to previously empty tiles
- Clears tiles not selected in shuffle

**Error Cases:**
- Wrong PIN → 401 Unauthorized
- No artwork → 400 "No artwork to shuffle"
- Not enough tiles → 400 "Not enough tiles available"

---

## 5. Upload Pipeline (End-to-End)

### Step 1: User Action (Frontend)
**File:** `static/js/upload_modal.js` (lines 1-300+)  
**Trigger:** User clicks "Upload" button, selects image, crops, fills metadata, clicks "Place Artwork"

**Frontend Operations:**
1. User selects file via `<input type="file">`
2. Image loaded into Cropper.js for cropping
3. Cropped canvas exported as Blob (tile version)
4. Original image exported as Blob (popup version)
5. FormData constructed with:
   - `tile_image`: Blob (cropped)
   - `popup_image`: Blob (original)
   - `artwork_name`: String
   - `artist_name`: String

### Step 2: Upload Request
**Endpoint:** `POST /api/upload_assets`  
**Handler:** `upload_assets()` (app.py lines 930-1000)

**Server Processing:**
1. Validate files present and non-empty
2. Generate UUID: `asset_id = str(uuid.uuid4())`
3. Secure filenames: `tile_{asset_id}.jpg`, `popup_{asset_id}.jpg`
4. Save files to disk:
   ```python
   tile_path = os.path.join(UPLOAD_DIR, tile_filename)  # uploads/tile_uuid.jpg
   tile_file.save(tile_path)
   ```
5. Create asset metadata dict:
   ```python
   {
     "tile_url": "/uploads/tile_uuid.jpg",
     "popup_url": "/uploads/popup_uuid.jpg",
     "artwork_name": "User Title",
     "artist_name": "User Name",
     "created_at": "2026-01-04T12:34:56Z"
   }
   ```
6. **DB Write:** `save_assets()` → `sqlite_insert_asset()` → `INSERT OR REPLACE INTO assets`

**Response:** Returns asset metadata JSON to frontend

### Step 3: Random Tile Selection (Frontend)
**File:** `static/js/upload_modal.js`  
**Logic:**
1. Client generates list of all tile IDs from parsed SVG
2. Filters out currently occupied tiles
3. Randomly selects one empty tile
4. Sends placement request:
   ```javascript
   fetch("/api/assign_tile", {
     method: "POST",
     body: JSON.stringify({
       tile_id: selectedTileId,
       asset_id: uploadedAssetId
     })
   })
   ```

### Step 4: Tile Assignment
**Endpoint:** `POST /api/assign_tile`  
**Handler:** `assign_tile()` (app.py lines 1002-1032)

**Server Processing:**
1. Verify asset exists in DB: `load_assets()` → check `asset_id in assets`
2. Load current wall state: `load_wall_state()`
3. Add assignment: `wall_state[tile_id] = asset_id`
4. **DB Write:** `save_wall_state()` → `DELETE FROM placements` + bulk `INSERT`

**Response:** `{"ok": true}`

### Step 5: Frontend Refresh
**File:** `static/js/main.js` (lines 2000+)  
**Logic:**
1. Upload modal closes
2. Client calls `/api/wall_state` to fetch updated assignments
3. `hydrateWallStateFromExistingData()` merges DB data with client state
4. `renderWallFromState()` rebuilds all tiles with artwork

**Result:** Newly uploaded artwork appears on randomly selected tile.

---

## 6. Tile Hydration Pipeline

### Boot Sequence
**File:** `static/js/main.js` function `boot()` (lines 1980-2100)

**Step 1: SVG Grid Parsing**
```javascript
const response = await fetch(SVG_GRID_PATH);  // /static/grid_full.svg
const svgText = await response.text();
const tiles = parseSVGClientSide(svgText);    // Extract tile positions/sizes
```

**Step 2: Server State Fetch**
```javascript
const response = await fetch("/api/wall_state");
const data = await response.json();
// data.assignments = [{tile_id, asset_id, tile_url, popup_url, ...}]
```

**Step 3: State Hydration**
```javascript
hydrateWallStateFromExistingData(layoutTiles, assignments);
```

**Hydration Logic (app.py perspective):**
1. `load_wall_state()` → Reads `placements` table → {tile_id: asset_id}
2. `load_assets()` → Reads `assets` table → {asset_id: {metadata}}
3. Server joins these two tables manually (in-memory)
4. Returns array of assignments with full asset metadata

**Step 4: Wall Rendering**
```javascript
commitWallStateChange('boot hydration');
  → renderWallFromState()
    → For each tile:
        - Create <div class="tile"> with position/size
        - If tile_id in wall_state:
            - Create <img> with tile_url
            - Attach metadata (popup_url, artwork_name, artist_name) as data attributes
        - If tile_id NOT in wall_state:
            - Render empty tile with label
```

**DB Dependency:** Wall render is 100% driven by DB state (no client-side cache/localStorage).

---

## 7. Admin Operations & DB Impact

### Operation: Clear Tile
**Trigger:** Admin clicks tile → "Clear Tile" button  
**API:** `POST /api/admin/clear_tile` with `{"tile_id": "X99"}`

**DB Impact:**
1. **Before:** `push_snapshot("clear_tile:X99", current_state)`
   - `INSERT INTO placement_snapshots` with full wall state JSON
2. **During:** `del wall_state[tile_id]`
3. **After:** `save_wall_state(modified_state)`
   - `DELETE FROM placements` (all rows)
   - `INSERT INTO placements` for remaining tiles

**Memory vs Persistence:**
- Frontend state (JS): Updated immediately after API response
- DB state: Updated atomically in transaction
- Asset metadata: Remains in `assets` table (not deleted)
- Physical files: Remain in `uploads/` directory (not deleted)

**Undo:** Snapshot ID returned to frontend, stored in `placement_snapshots.id`

---

### Operation: Clear All Tiles
**Trigger:** Admin modal → "Clear Grid" button  
**API:** `POST /api/admin/clear_all_tiles`

**DB Impact:**
1. **Before:** `push_snapshot("clear_grid", current_state)`
2. **After:** `save_wall_state({})`
   - `DELETE FROM placements` (all rows, no INSERT)

**Result:** All tiles cleared, but assets metadata + files preserved for reuse.

---

### Operation: Move Tile
**Trigger:** Admin drags tile or uses move interface  
**API:** `POST /api/admin/move_tile_asset` with `{"from_tile_id": "X99", "to_tile_id": "X12"}`

**DB Impact:**
1. **Before:** `push_snapshot("move_tile:X99->X12", current_state)`
2. **During:**
   ```python
   wall_state[to_tile_id] = wall_state[from_tile_id]
   del wall_state[from_tile_id]
   ```
3. **After:** `save_wall_state(modified_state)`

**Memory:** Frontend state updated via full wall refresh (`renderWallFromState()`)

---

### Operation: Shuffle
**Trigger:** Admin modal → "Shuffle" button (PIN required)  
**API:** `POST /shuffle` with `{"pin": "8375"}`

**DB Impact:**
1. **Before:** `push_snapshot("shuffle", current_state)`
2. **During:**
   - Parse `grid_full.svg` for all tile IDs
   - Extract asset IDs from current state
   - Randomly pair assets with tiles
   - Create new state dict with randomized assignments
3. **After:** `save_wall_state(new_state)`

**Special Behavior:**
- Clears tiles not in new random selection (artwork may disappear temporarily)
- Artwork can move to previously empty tiles
- Total artwork count unchanged (shuffle preserves assets)

---

### Operation: Undo
**Trigger:** Admin modal → "Undo" button  
**API:** `POST /api/admin/undo` with optional `{"action_type": "non_shuffle"}`

**DB Impact:**
1. **Read:** `pop_latest_snapshot(action_type)` → `SELECT ... FROM placement_snapshots ORDER BY id DESC LIMIT 1`
2. **Delete:** `DELETE FROM placement_snapshots WHERE id=?` (snapshot consumed)
3. **Restore:** `save_wall_state(snapshot_state)` → Replace entire `placements` table

**Timeline Awareness:**
- If last action was shuffle (action="shuffle"), can undo with `action_type="shuffle"`
- If last action was non-shuffle (clear/move), can undo with `action_type="non_shuffle"`
- Non-shuffle actions BEFORE last shuffle are invisible to undo (timeline protection)

**Limitation:** Undo deletes the snapshot (not revertible). No "redo" functionality.

---

### Operation: Undo Shuffle
**Trigger:** Admin modal → "Undo Shuffle" button  
**API:** `POST /api/admin/undo` with `{"action_type": "shuffle"}`

**DB Impact:** Same as regular undo, but filters for `action='shuffle'` snapshots only.

**Effect:** Restores wall state to pre-shuffle configuration, deletes shuffle snapshot.

---

## 8. Undo System: DB vs Memory

### Architecture Overview
**Current System:** SQLite-backed undo with timeline awareness  
**Legacy System:** JSON-based history (DEPRECATED but still present)

### Where State Lives

| State Type | Storage Location | Persistence | Access Pattern |
|------------|------------------|-------------|----------------|
| **Current Wall State** | `placements` table | DB (SQLite) | Load on boot, save on every change |
| **Undo Snapshots** | `placement_snapshots` table | DB (SQLite) | Push on admin action, pop on undo |
| **Frontend State** | JS variable `wallState` (main.js) | Memory only | Synced from DB on boot and after admin ops |
| **Asset Metadata** | `assets` table | DB (SQLite) | Load on boot, cached in memory |
| **Legacy History** | `wall_state_history.json` | File (JSON) | UNUSED (routes preserved for backward compat) |

### Undo Stack Mechanics

**Push Operation (app.py lines 521-559):**
```python
def push_snapshot(action: str, state: dict):
    # 1. Serialize current state to JSON
    state_json = json.dumps(state)
    
    # 2. Insert snapshot with action label
    INSERT INTO placement_snapshots (created_at, action, state_json)
    VALUES (now(), action, state_json)
    
    # 3. Prune old snapshots (keep latest 10)
    DELETE FROM placement_snapshots
    WHERE id NOT IN (SELECT id ... ORDER BY id DESC LIMIT 10)
```

**Pop Operation (app.py lines 581-636):**
```python
def pop_latest_snapshot(action_type=None):
    # 1. Find latest snapshot (with optional filter)
    if action_type == 'shuffle':
        SELECT ... WHERE action='shuffle' ORDER BY id DESC LIMIT 1
    elif action_type == 'non_shuffle':
        # Timeline-aware: only non-shuffle AFTER last shuffle
        SELECT ... WHERE action!='shuffle' AND id > last_shuffle_id ...
    
    # 2. Delete snapshot (consume it)
    DELETE FROM placement_snapshots WHERE id=?
    
    # 3. Return deserialized state
    return json.loads(state_json)
```

### Timeline Awareness

**Problem:** Shuffle fundamentally changes wall layout. Undoing pre-shuffle actions (clear/move) after a shuffle would restore tiles to positions that no longer exist or are occupied by shuffle-placed artwork.

**Solution:** Track `last_shuffle_id` and filter non-shuffle undo eligibility:
```python
last_shuffle_id = get_last_shuffle_id()  # Latest shuffle snapshot ID

# When undoing non-shuffle actions:
if last_shuffle_id is not None:
    # Only show snapshots AFTER last shuffle
    WHERE action != 'shuffle' AND id > last_shuffle_id
```

**Effect:**
- Non-shuffle actions before shuffle are "sealed off" (not undoable)
- Shuffle can always be undone (restores pre-shuffle state)
- After undoing shuffle, pre-shuffle actions become undoable again

**Example Timeline:**
```
ID  Action              Undo Eligible (if last_shuffle_id=5)?
--  -----------------   ------------------------------------
1   clear_tile:X99      NO (before shuffle)
2   move_tile:X1->X2    NO (before shuffle)
3   clear_tile:X3       NO (before shuffle)
4   clear_grid          NO (before shuffle)
5   shuffle             YES (is shuffle)
6   clear_tile:X5       YES (after shuffle)
7   move_tile:X6->X7    YES (after shuffle)
```

### Known Bugs & Limitations

**Bug 1: No Redo Functionality**  
**Impact:** Once undo is executed, snapshot is deleted. No way to revert the undo.  
**Workaround:** None. Users must be careful with undo.

**Bug 2: Upload + Assign Doesn't Push Snapshot**  
**Impact:** If user uploads artwork and it auto-assigns to a tile, there's no undo snapshot. If tile was previously occupied, that artwork is lost forever.  
**Root Cause:** `assign_tile()` endpoint doesn't call `push_snapshot()` before modifying state.  
**Fix:** Add snapshot push in `assign_tile()` when tile already occupied.

**Bug 3: Orphaned Asset References**  
**Impact:** If asset is deleted from `assets` table but `placements` still references it, tile appears occupied but artwork is missing.  
**Root Cause:** No FOREIGN KEY constraint on `placements.asset_id`.  
**Workaround:** Frontend gracefully skips missing assets in render loop.

**Bug 4: Snapshot JSON Bloat**  
**Impact:** Each snapshot stores ENTIRE wall state as JSON (can be 10-50KB for full wall). With 10 snapshots, this is 100-500KB of duplicate data.  
**Optimization:** Store diffs instead of full state, or use BLOB compression.

---

## 9. Consistency & Integrity Risks

### Race Conditions

**Risk 1: Simultaneous Uploads**  
**Scenario:** Two users upload artwork simultaneously and both get assigned to the same tile.  
**Likelihood:** Low (Python Flask dev server is single-threaded).  
**Impact:** Last write wins (one artwork overwrites the other in DB).  
**Mitigation:** Add tile reservation system or transaction locking.

**Risk 2: Admin Ops During Upload**  
**Scenario:** User uploads artwork while admin clicks "Clear All". Upload completes after clear.  
**Impact:** Newly uploaded artwork appears on wall despite clear operation.  
**Mitigation:** Add server-side validation to check if clear operation is in progress.

### Orphaned Records

**Risk 1: Orphaned Placements**  
**Scenario:** Asset deleted from `assets` table, but `placements` still references it.  
**Detection:** `GET /api/wall_state` skips orphaned assets (silent failure).  
**Fix:** Add FOREIGN KEY constraint: `FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE CASCADE`.

**Risk 2: Orphaned Files**  
**Scenario:** Asset deleted from `assets` table, but files remain in `uploads/` directory.  
**Impact:** Disk space waste (files never served).  
**Cleanup:** Implement background job to delete unreferenced files:
```python
def cleanup_orphaned_files():
    asset_urls = {a['tile_url'], a['popup_url'] for a in load_assets().values()}
    for filename in os.listdir(UPLOAD_DIR):
        if f"/uploads/{filename}" not in asset_urls:
            os.remove(os.path.join(UPLOAD_DIR, filename))
```

### Data Corruption

**Risk 1: Invalid JSON in snapshot.state_json**  
**Scenario:** Snapshot pushed with malformed JSON (corrupted state).  
**Impact:** `pop_latest_snapshot()` fails with `json.JSONDecodeError`, undo broken.  
**Mitigation:** Validate JSON before insert, or wrap `json.loads()` in try/except.

**Risk 2: Missing `placed_at` Timestamp**  
**Scenario:** Old code writes to `placements` without `placed_at` column.  
**Impact:** `INSERT` fails due to `NOT NULL` constraint.  
**Mitigation:** Schema migration adds `DEFAULT CURRENT_TIMESTAMP`.

### Tile Shift (Render Inconsistency)

**Risk 1: SVG vs DB Tile ID Mismatch**  
**Scenario:** Admin edits `grid_full.svg` and changes tile IDs. DB still has old IDs.  
**Impact:** Artwork appears on wrong tiles or disappears entirely.  
**Mitigation:** Add SVG versioning system or tile ID migration script.

**Risk 2: Browser Cache of Old SVG**  
**Scenario:** User's browser caches old `grid_full.svg` with different tile layout.  
**Impact:** Client-side tile positions don't match server placements.  
**Mitigation:** Add cache-busting query param to SVG URL: `/grid_full.svg?v=2`.

### Lack of Constraints

**Missing Foreign Keys:**
- `placements.asset_id` → No FK to `assets.asset_id` (orphaned refs possible)

**Missing Unique Constraints:**
- None needed (PRIMARY KEYs sufficient)

**Missing Check Constraints:**
- `assets.paid` → Should be `CHECK (paid IN (0, 1))`
- `placements.placed_at` → Should validate ISO 8601 format

---

## 10. Debug & Tooling

### Quick DB Inspection (Python)

**List All Assets:**
```python
import sqlite3
conn = sqlite3.connect('data/gallery.db')
cursor = conn.cursor()
cursor.execute("SELECT asset_id, artwork_name, artist_name, created_at FROM assets ORDER BY created_at DESC")
for row in cursor.fetchall():
    print(f"{row[0][:8]} | {row[1]} by {row[2]} | {row[3]}")
conn.close()
```

**List Current Placements:**
```python
cursor.execute("""
    SELECT p.tile_id, a.artwork_name, a.artist_name
    FROM placements p
    JOIN assets a ON p.asset_id = a.asset_id
    ORDER BY p.placed_at DESC
""")
for row in cursor.fetchall():
    print(f"{row[0]} → {row[1]} by {row[2]}")
```

**List Undo History:**
```python
cursor.execute("SELECT id, action, created_at FROM placement_snapshots ORDER BY id DESC LIMIT 10")
for row in cursor.fetchall():
    print(f"#{row[0]} | {row[1]} | {row[2]}")
```

### Useful Queries

**Count Occupied Tiles:**
```sql
SELECT COUNT(*) FROM placements;
```

**Find Orphaned Placements:**
```sql
SELECT p.tile_id, p.asset_id
FROM placements p
LEFT JOIN assets a ON p.asset_id = a.asset_id
WHERE a.asset_id IS NULL;
```

**Last 5 Uploads:**
```sql
SELECT asset_id, artwork_name, artist_name, created_at
FROM assets
ORDER BY created_at DESC
LIMIT 5;
```

**Snapshot Statistics:**
```sql
SELECT
    action,
    COUNT(*) as count,
    MAX(created_at) as last_occurrence
FROM placement_snapshots
GROUP BY action;
```

**Find Shuffle Snapshots:**
```sql
SELECT id, created_at, LENGTH(state_json) as size_bytes
FROM placement_snapshots
WHERE action = 'shuffle'
ORDER BY id DESC;
```

### Safe DB Reset for Testing

**Script: `reset_db.py`**
```python
import os
import sqlite3

DB_PATH = 'data/gallery.db'
UPLOADS_DIR = 'uploads'

# 1. Backup current DB
if os.path.exists(DB_PATH):
    import shutil
    shutil.copy(DB_PATH, f"{DB_PATH}.backup")
    print(f"Backed up to {DB_PATH}.backup")

# 2. Delete DB file
if os.path.exists(DB_PATH):
    os.remove(DB_PATH)
    print(f"Deleted {DB_PATH}")

# 3. Delete all uploads
if os.path.exists(UPLOADS_DIR):
    for filename in os.listdir(UPLOADS_DIR):
        os.remove(os.path.join(UPLOADS_DIR, filename))
    print(f"Cleared {UPLOADS_DIR}/")

# 4. Reinitialize DB (will be created on next Flask app start)
print("DB reset complete. Restart Flask to recreate schema.")
```

**Usage:**
```bash
python reset_db.py
python app.py  # Restart Flask
```

### Debug Mode Activation

**Enable DB Tracing:**
```python
# In app.py, set:
DEBUG_DB_TRACE = True
```

**Console Output:**
```
LOAD_ASSETS: SQLITE mode, assets=12
LOAD_WALL_STATE: SQLITE mode, tiles=8
SAVE_WALL_STATE: SQLITE mode, tiles=7
UNDO: popped snapshot id=15 action=clear_tile:X99 tiles=8
```

### Database Browser (GUI)

**Install DB Browser for SQLite:**
- Download: https://sqlitebrowser.org/
- Open: `data/gallery.db`
- Navigate tables, execute queries, export data

### Future-Proofing Improvements

**1. Add Foreign Key Constraints**
```sql
-- Migrate placements table
CREATE TABLE placements_new (
    tile_id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    placed_at TEXT NOT NULL,
    FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE CASCADE
);
INSERT INTO placements_new SELECT * FROM placements;
DROP TABLE placements;
ALTER TABLE placements_new RENAME TO placements;
```

**2. Add Snapshot Compression**
```python
import gzip, base64

def push_snapshot(action, state):
    state_json = json.dumps(state)
    compressed = gzip.compress(state_json.encode('utf-8'))
    state_blob = base64.b64encode(compressed).decode('ascii')
    # Store state_blob as TEXT
```

**3. Add Transaction Logging**
```python
# New table
CREATE TABLE transaction_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    user_id TEXT,
    operation TEXT,
    details TEXT
);

# Log every admin operation
def log_transaction(operation, details):
    INSERT INTO transaction_log (timestamp, operation, details)
    VALUES (now(), operation, json.dumps(details))
```

**4. Add Tile Reservation System**
```python
# New table
CREATE TABLE tile_reservations (
    tile_id TEXT PRIMARY KEY,
    reserved_by TEXT NOT NULL,
    reserved_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

# Before assign_tile, check reservation
def assign_tile():
    if tile_reserved_by_another_user(tile_id):
        return jsonify({"error": "Tile reserved"}), 409
```

---

## Appendix A: Schema SQL

```sql
-- Full schema from data/gallery.db

CREATE TABLE assets (
    asset_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    tile_url TEXT NOT NULL,
    popup_url TEXT NOT NULL,
    artwork_name TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    notes TEXT,
    paid INTEGER DEFAULT 0
);

CREATE TABLE placements (
    tile_id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    placed_at TEXT NOT NULL
);

CREATE TABLE placement_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    action TEXT NOT NULL,
    state_json TEXT NOT NULL
);

CREATE INDEX idx_snapshots_action ON placement_snapshots(action);
CREATE INDEX idx_snapshots_action_id ON placement_snapshots(action, id DESC);
```

---

## Appendix B: Example JSON Payloads

### Upload Asset (POST /api/upload_assets)
**Request:** `multipart/form-data`
```
------WebKitFormBoundary
Content-Disposition: form-data; name="tile_image"; filename="cropped.jpg"
Content-Type: image/jpeg

[binary image data]
------WebKitFormBoundary
Content-Disposition: form-data; name="popup_image"; filename="full.jpg"
Content-Type: image/jpeg

[binary image data]
------WebKitFormBoundary
Content-Disposition: form-data; name="artwork_name"

Starry Night
------WebKitFormBoundary
Content-Disposition: form-data; name="artist_name"

Van Gogh
------WebKitFormBoundary--
```

**Response:**
```json
{
  "asset_id": "a3f2d9e1-4b5c-6789-0123-456789abcdef",
  "tile_url": "/uploads/tile_a3f2d9e1.jpg",
  "popup_url": "/uploads/popup_a3f2d9e1.jpg",
  "artwork_name": "Starry Night",
  "artist_name": "Van Gogh",
  "created_at": "2026-01-04T15:32:45.123Z"
}
```

### Assign Tile (POST /api/assign_tile)
**Request:**
```json
{
  "tile_id": "X99",
  "asset_id": "a3f2d9e1-4b5c-6789-0123-456789abcdef"
}
```

**Response:**
```json
{
  "ok": true
}
```

### Clear Tile (POST /api/admin/clear_tile)
**Request:**
```json
{
  "tile_id": "X99"
}
```

**Response:**
```json
{
  "ok": true,
  "shuffle_count": 1,
  "non_shuffle_count": 3
}
```

### Undo (POST /api/admin/undo)
**Request:**
```json
{
  "action_type": "non_shuffle"
}
```

**Response:**
```json
{
  "ok": true,
  "action": "clear_tile:X99",
  "shuffle_count": 1,
  "non_shuffle_count": 2
}
```

### Shuffle (POST /shuffle)
**Request:**
```json
{
  "pin": "8375"
}
```

**Response:**
```json
{
  "ok": true,
  "shuffle_count": 2,
  "non_shuffle_count": 0
}
```

---

## Appendix C: DB Touchpoints Index

| File | Function | Lines | Read/Write | Route | SQL Summary |
|------|----------|-------|------------|-------|-------------|
| app.py | init_db() | 79-143 | WRITE | N/A | CREATE TABLE (3 tables + indexes) |
| app.py | sqlite_assets_count() | 238-244 | READ | N/A | SELECT COUNT(*) FROM assets |
| app.py | sqlite_insert_asset() | 247-274 | WRITE | /api/upload_assets | INSERT OR REPLACE INTO assets |
| app.py | sqlite_load_assets() | 277-301 | READ | /api/wall_state | SELECT * FROM assets |
| app.py | load_wall_state() | 367-387 | READ | Multiple | SELECT tile_id, asset_id FROM placements |
| app.py | save_wall_state() | 409-446 | WRITE | Multiple | DELETE + INSERT INTO placements |
| app.py | get_last_shuffle_id() | 449-462 | READ | /api/admin/undo | SELECT id FROM snapshots WHERE action='shuffle' |
| app.py | get_snapshot_counts() | 465-518 | READ | /api/admin/history_status | Multiple COUNT queries on snapshots |
| app.py | push_snapshot() | 521-559 | WRITE | All admin ops | INSERT INTO snapshots + prune old |
| app.py | pop_latest_snapshot() | 581-636 | READ+DELETE | /api/admin/undo | SELECT + DELETE FROM snapshots |
| app.py | upload_assets() | 930-1000 | WRITE | /api/upload_assets | Via sqlite_insert_asset() |
| app.py | assign_tile() | 1002-1032 | WRITE | /api/assign_tile | Via save_wall_state() |
| app.py | admin_clear_tile() | 1034-1072 | WRITE | /api/admin/clear_tile | push_snapshot() + save_wall_state() |
| app.py | admin_clear_all_tiles() | 1074-1104 | WRITE | /api/admin/clear_all_tiles | push_snapshot() + save_wall_state() |
| app.py | admin_undo() | 1106-1148 | READ+DELETE | /api/admin/undo | pop_latest_snapshot() + save_wall_state() |
| app.py | admin_move_tile_asset() | 1234-1289 | WRITE | /api/admin/move_tile_asset | push_snapshot() + save_wall_state() |
| app.py | shuffle_placement() | 1291-1343 | WRITE | /shuffle | push_snapshot() + save_wall_state() |

---

**End of Report**
