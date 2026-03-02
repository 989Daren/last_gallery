# The Last Gallery - Project Summary

## Overview
A Flask-based web gallery application where users can upload artwork images that display on a tiled wall. Each tile can be clicked to view the full-size image with metadata displayed in an animated overlay ribbon.

## Tech Stack
- **Backend**: Python/Flask
- **Database**: SQLite (single source of truth) with versioned migrations
- **Frontend**: Vanilla JavaScript (modular), CSS
- **Image Processing**: Cropper.js (client-side cropping), Pillow (server-side optimization)
- **Email**: Resend API (edit code delivery), `python-dotenv` for env config

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
| `data/gallery.db` | SQLite database (assets + tiles + edit_codes + countdown_schedule + schema_version tables, schema v7) |
| `grid utilities/repair_tiles.py` | Sync tiles table with SVG after grid extension |

### Frontend
| File | Purpose |
|------|---------|
| `static/js/main.js` | Core gallery rendering, popup overlay, wall state management |
| `static/js/admin.js` | Admin modal, action handlers (clear/move/undo/shuffle), countdown admin controls |
| `static/js/countdown.js` | Countdown timer bar module (fetch state, tick, show/hide) |
| `static/js/unlock_modal.js` | Unlock artwork modal with back-button support |
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
    contact2_value TEXT NOT NULL DEFAULT '',
    -- Qualified floor model (migration v7)
    qualified_floor TEXT NOT NULL DEFAULT 'xs',  -- 'xs' | 's' | 'm' | 'lg' — artwork never shuffles below this size
    stripe_payment_id TEXT                        -- nullable, Stripe payment reference for tile upgrades
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
```

Current schema version: **7**

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
| `/edit` | GET | Gallery page in edit mode — auto-opens edit banner, skips welcome |
| `/creator-of-the-month` | GET | Gallery page with Creator of the Month coming-soon banner |
| `/api/wall_state` | GET | Get all tile assignments from database |
| `/api/countdown_state` | GET | Get countdown timer state (with server-side auto-transitions) |
| `/uploads/<filename>` | GET | Serve uploaded images (1-year immutable cache) |

### Upload
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/upload_assets` | POST | Upload tile + popup images (multipart form) |
| `/api/tile/<tile_id>/metadata` | POST | Save all metadata fields (accepts `is_edit` flag; rejects duplicate title+email with 409) |
| `/api/tile/<tile_id>/metadata` | GET | Get metadata for a tile |
| `/api/verify_edit_code` | POST | Verify artwork title + edit code, returns matching tile_id |
| `/api/resend_edit_code` | POST | Resend edit code to email (privacy-safe: same response regardless) |

### Admin (requires `X-Admin-Pin: REDACTED_PIN` header)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/tile_info` | GET | Get info about a specific tile |
| `/api/admin/clear_tile` | POST | Clear a single tile |
| `/api/admin/clear_all_tiles` | POST | Clear all tiles |
| `/api/admin/move_tile_asset` | POST | Move artwork between tiles |
| `/api/admin/undo` | POST | Undo last action (supports `action_type: shuffle/non_shuffle`) |
| `/api/admin/history_status` | GET | Get undo availability counts |
| `/api/admin/force_unlock` | POST | Set unlocked to 0 or 1 explicitly (body: `{asset_id, unlocked: 0\|1}`) |
| `/api/admin/set_qualified_floor` | POST | Set qualified floor for artwork (body: `{asset_id, qualified_floor: "xs"\|"s"\|"m"\|"lg"}`) |
| `/api/admin/countdown` | POST | Control countdown timer (actions: set_active, set_scheduled, clear) |
| `/shuffle` | POST | Randomly redistribute all images (body: `{pin: "REDACTED_PIN"}`) |

### Public Lock (Stripe-ready)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/lock_tile` | POST | Lock artwork at current tile size (body: `{asset_id, payment_id?}`) |

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
6. Sale availability text (if for_sale is "yes"; generic message if no sale type selected, specific if original/print/both chosen; "not available" if "no")
7. Contact links (clickable - mailto for email, https for web)

## Upload Flow
1. User selects image → Cropper.js allows square crop
2. Upload sends: `tile_image` (512x512 thumbnail) + `popup_image` (original)
3. Server optimizes popup image (see below) and saves to `/uploads/`, creates DB records
4. Metadata modal appears → user enters required + optional fields → saved to DB
5. Server rejects duplicate title+email combinations (409) — UI shows inline error on artwork title field
6. Wall refreshes → modals close → viewport scrolls to new tile → highlight sheen plays

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
- **Content**: "Welcome to The Last Gallery" title, italic subtitle ("A dynamic time capsule of creative works"), bulleted instructions
- **Animation**: Diagonal reflection sweep across modal (simpleWelcomeSheen)
- Dismissed via "Enter" button, backdrop click, or Escape key

## Edit Artwork Flow
- **Trigger**: Hamburger menu → "Edit Your Artwork Submission", or deep-link via `/edit` (auto-opens edit banner, skips welcome modal)
- **Edit banner**: Title "A note about editing", body text, two input fields (artwork title + edit code), Cancel/Continue buttons. "Forgot your edit code?" link toggles inline email resend form.
- **Admin edit shortcut**: When admin is active, edit banner hides the edit code field and accepts a tile ID instead. Uses `/api/admin/tile_info` with PIN header for lookup.
- **Verification**: `POST /api/verify_edit_code` with `{title, code}`. Title matching is case-insensitive, trims whitespace and trailing periods. Code maps to email, then finds asset where both title and email match.
- **Edit codes**: Generated on first metadata save (8-char hex via `uuid.uuid4().hex[:8]`), one per email. Emailed to artist via Resend API (`send_edit_code(email, code, artwork_title)`). HTML email includes artwork title, edit code, link to `/edit` with title prefilled, and Creator of the Month teaser linking to `/creator-of-the-month`. Plain-text fallback included. Reused across multiple uploads with same email.
- **Email send logic**: Client passes `is_edit` flag in metadata POST. New uploads always send the email. Edit saves skip the email unless the email address changed (even if new email already has a code).
- **Resend edit code**: `POST /api/resend_edit_code` takes email, looks up existing code, resends. Privacy-safe: always returns success message regardless of email existence.
- **Edit mode**: Metadata modal opens prefilled. "Return to Artwork Edit" button disabled (CSS `edit-mode-disabled` + HTML `disabled`). Close (X) returns to gallery, not upload modal.
- **Email change warning**: Yellow inline warning when email field differs from original, informing user their edit code will be invalidated and a new one sent.
- **Orphaned code cleanup**: On email change, old email's `edit_codes` row deleted only if no other assets reference that email.

## Initial Gallery View
- **Origin on load**: Gallery starts at 0, 0 (top-left corner)
- **Pre-positioned**: Scroll set before welcome modal, so view is ready when dismissed

## Popup Overlay
- **Animation sequence**: image appears → title fades in → black ribbon slides from left → text reveals
- **Close behavior**: First click hides ribbon, second click closes popup
- **Popup close button**: X button above top-right corner of image (always visible when popup is open)
- **Ribbon close button**: X button in top-right corner of ribbon (visible only when ribbon is shown)
- **Contact links**: Clickable (email opens mail client, web links open in new tab)

## Pinch-to-Zoom (Mobile)
Focal-point zoom for touch devices — content under fingers stays anchored during pinch.

- **HTML Structure**:
  ```
  .gallery-wall-wrapper (scroll container)
    └── .zoom-wrapper (receives transform)
         └── #galleryWall (content)
  ```
- **Transform model**: `transform-origin: 0 0` with `translate(tx, ty) scale(s)`. All positioning via unified `tx/ty` state — no separate pan offset.
- **Focal-point anchoring**: Each pinch frame computes the content point under the previous finger midpoint and repositions it at the current midpoint. Handles simultaneous zoom + pan + direction reversal in one formula.
- **Progressive edge clamping**: Per-axis, per-frame constraint. Centers content when it fits the viewport; enforces edge boundaries when it overflows. Padding interpolates from 20px at scale=1 to 10px at minScale.
- **Min scale**: `min((vw - pad) / galleryW, (vh - pad) / galleryH, 1.0)` — fits entire grid with half-padding at max zoom-out.
- **Scroll ↔ transform handoff**: At 1.0x, native scroll is active. On two-finger touch, scroll position is captured before `lockScroll()`, then mapped to `tx = -scrollX, ty = -scrollY`. On snap-back (>0.95x), reverse mapping restores scroll position — user stays at the same view, not jolted to origin.
- **Touch-action guard**: `touch-action: none` set on wrapper for entire zoom-out duration (via `lockScroll`/`unlockScrollTo`), not just during active pinch. Prevents browser's built-in pinch-to-zoom from firing between gestures.
- **Gestures**:
  - Two-finger pinch: Zoom in/out (focal-point anchored)
  - Single-finger drag (when zoomed): Pan within clamped bounds
  - Back button: Unwinds layers (ribbon → popup → shuffleinfo → unlock → zoom → leave page)
- **Disabled during**: Welcome modal, upload modal, admin modal, artwork popup
- **Auto-reset**: Zoom resets to 1.0x after wall refresh (shuffle, clear, move, undo)

- **Performance**: DOM elements (`_wrapper`, `_zoomWrapper`) and viewport metrics (`_vw`, `_vh`) cached in `zoomState`; refreshed only on resize/orientation change. `clampTransform` writes to a reusable `_clampResult` object (zero per-frame allocation). Touch distance and midpoint inlined in hot path.

## Admin PIN
- Default: `REDACTED_PIN`
- Can be overridden via environment variable `TLG_ADMIN_PIN`
- **Security**: PIN is validated server-side only; never exposed to client-side JavaScript
- PIN stored in IIFE closure scope after successful server validation, persists until page refresh

## Environment Variables
| Variable | Default | Purpose |
|----------|---------|---------|
| `TLG_ADMIN_PIN` | `REDACTED_PIN` | Admin PIN for admin endpoints |
| `TLG_BASE_URL` | `https://thelastgallery.com` | Base URL used in email links (`/edit`, `/creator-of-the-month`) |
| `RESEND_API_KEY` | *(none)* | Resend API key for sending edit code emails |

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
window.getAdminPin()              // Get admin PIN for cross-module requests (from admin.js)
window.initZoom()                 // Initialize pinch-to-zoom
window.resetZoom()                // Reset zoom to 1.0x
window.highlightNewTile(tileId)   // Scroll to tile + sheen animation
window.PAGE_MODE      // Deep-link mode: "edit" | "creator-of-the-month" | "" (set by server via template)
window.refreshCountdown()         // Re-fetch and apply countdown state (from countdown.js)
window.openUnlockModal(assetId, tileId)  // Open unlock modal (from unlock_modal.js)
window.closeUnlockModal()         // Close unlock modal (from unlock_modal.js)
window.isUnlockModalOpen()        // Check if unlock modal is open (from unlock_modal.js)
```

### admin.js Module
- IIFE pattern with initialization guards
- PIN validated server-side via `/api/admin/history_status` before unlocking modal
- PIN stored in closure-scoped `_adminPin` variable, exposed via `window.getAdminPin()` for cross-module admin requests, persists until page refresh
- Handles: modal PIN gate, clear/move/undo actions, shuffle, tile labels toggle, countdown admin controls, human centric gallery modal
- Guards prevent duplicate event handler registration

## Countdown Timer Bar
- **Position**: Fixed below header, 40px tall (36px on mobile <375px), black background
- **Font**: Bebas Neue (Google Fonts), gold numbers (#D4A843), soft white text (#E0E0E0)
- **Format**: "Artwork Shuffle: 6 days, 12 hours, 34 minutes" — numbers gold, units soft white
- **States**: Active (ticking), Scheduled ("Countdown begins soon"), Cleared (bar hidden)
- **Info icon**: Gold-filled circled italic "i" inline after countdown text, opens info popup with shuffle graphic and explanatory copy
- **Info popup**: Integrates with ConicalNav back-button navigation (`#shuffleinfo`)
- **Auto-shuffle**: When countdown expires, server calls `_run_shuffle()` (same weighted, floor-respecting algorithm as manual shuffle) before resetting the cycle. Pushes to `_shuffle_history` so auto-shuffles are undoable. Client shows "Shuffling..." with gold pulse for 3s, then re-fetches state.
- **Persistence**: State stored in `countdown_schedule` DB table, survives server restarts
- **CSS variable**: `--total-fixed-height` = header + countdown bar height; used by gallery wrapper padding and zoom viewport metrics
- **Admin controls**: "Countdown" button in admin panel opens modal to set Active (with duration), Scheduled (with delayed start), or Cleared
- **Module**: `static/js/countdown.js` — IIFE, exposes `window.refreshCountdown()` for admin.js

## Hamburger Menu
Menu items in order:
1. **Unlock to Upgrade Your Artwork!** — opens unlock modal
2. **Edit Your Artwork Submission** — opens edit banner
3. **A Human Centric Gallery** — opens info modal (see below)
4. **Admin** — opens admin modal (PIN gated)

## Human Centric Gallery Modal
- **Trigger**: Hamburger menu → "A Human Centric Gallery", or "Submission Guidelines" link in upload modal
- **Structure**: Reuses `countdown-info-card` pattern (gold accent bar, body wrapper, absolute-positioned close button)
- **Image**: `static/images/artist_group.png` (656x500) at top, full-width with rounded corners
- **Content**: Emphasizes human touch in creative process; allows AI as a tool (collage, reference); rejects raw, unedited AI-generated images; warns non-conforming submissions may be removed
- **Dismiss**: Close button (X), backdrop tap, Escape key, or back button
- **ConicalNav**: Pushes `#humancentric` hash for back-button navigation on mobile
- **Also opened from**: "Submission Guidelines" link in upload modal (also pushes hash)

## Shuffle & Unlock Rules (Qualified Floor Model)
- **New uploads** always land in an XS tile (`pick_next_xs_tile_id()` in `app.py`). Available XS count accounts for floor-xs unlocked artwork in non-XS tiles needing a reserved XS slot.
- **Unupgraded** (`unlocked = 0`): XS tiles only — most constrained, placed first during shuffle.
- **Floor > xs** (`unlocked = 1`, `qualified_floor` in s/m/lg): Shuffles into tiles at floor size or larger. Higher floor = fewer eligible tiles = placed earlier.
- **Unlocked** (`unlocked = 1`, `qualified_floor = 'xs'`): Any tile size — least constrained, placed last. Weighted random: more tiles in a size = higher probability.
- **`qualified_floor`** column (values: xs, s, m, lg): Artwork never drops below this size during shuffle. Set via admin override (`/api/admin/set_qualified_floor`) or Stripe payment (`/api/lock_tile`).
- **Stripe integration** (stub): `/api/lock_tile` sets `qualified_floor` to the artwork's current tile size and `unlocked = 1`. Accepts optional `payment_id` for Stripe webhook. Rejects XS locks.
- **Derangement rule**: Every artwork must change position during a shuffle — no artwork may remain in its previous tile. The algorithm excludes each artwork's original tile from candidates; if the original tile is the last remaining in its pool, a swap with a previously-assigned artwork resolves it.
- **Admin force_unlock**: `/api/admin/force_unlock` sets unlocked explicitly (0 or 1). Locking (unlocked=0) also resets `qualified_floor` to 'xs'.

## Planned: Exhibit Tiles
Top-tier artist feature. An exhibit tile is an easily identifiable tile that, when clicked, opens an introduction modal covering the artist. A "Continue" button leads to a horizontally scrolling presentation of all the artist's works — full (scaled) images with padding, layered on a transparent dark background, centered at roughly 1/4 to 1/3 screen height, auto-scrolling left to right with viewer scroll controls. This will require linking multiple artworks to a single artist and a new tile designation or size class.

## Visual Theme
- **Gold accent system**: All modals (upload, metadata, confirmation, countdown info) share a consistent gold gradient accent bar (`#b8860b → #ffd700`) at the top, gold gradient primary buttons, and outlined secondary buttons
- **"Add Your Art" button**: Gold-bordered outline button in the header
- **"Submission Guidelines" button**: Link in the upload modal that opens the Human Centric Gallery overlay

## Notes
- Undo history is in-memory (resets on server restart)
- Images stored in `/uploads/` directory with UUID filenames; served with 1-year immutable cache headers
- No authentication beyond admin PIN for admin functions
- Schema migrations run automatically on startup
- Environment variables loaded from `.env` via `python-dotenv` (`.env` is gitignored)
- `RESEND_API_KEY` required for edit code emails; if missing, logs a warning and skips sending

## Working with Claude (claude.ai)
- When drafting instructions for Claude Code handoff, keep guidance intent-based
  and avoid specific variable names, class names, or implementation details —
  Claude Code should read the actual files and determine those itself

## Development Environment

- **Runtime**: Node.js v24.13.1 via nvm (`~/.nvm`). Source with:
  `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`
- **Claude Code**: v2.1.45 installed globally (`npm install -g @anthropic-ai/claude-code`)
- **Starting a session**: `cd last_gallery && claude`
- **Auth**: Run `claude auth login` from a **local terminal on the chromebook** — not via SSH from a remote machine. The auth code paste does not work over SSH.
- **Non-interactive use**: `claude -p "instruction" --dangerously-skip-permissions`

## Hosting & Remote Access

### PC File Access (SSHFS)
- PC's `C:\Users\user\chromepull` folder is mounted at `~/pc` on the Chromebook
- Auto-mounts on boot via `pc-mount.service` (user-level systemd)
- Drop files into `chromepull` on the PC → instantly readable by Claude Code at `~/pc/`
- Service file: `~/.config/systemd/user/pc-mount.service`
- Useful commands:
  ```bash
  systemctl --user status pc-mount.service
  systemctl --user restart pc-mount.service
  ```

### CLAUDE.md Auto-Sync
- A git `post-commit` hook (`.git/hooks/post-commit`) copies `CLAUDE.md` to `~/pc/` (chromepull) whenever a commit touches it
- Warns in terminal if `~/pc` is not mounted

### How the Site Runs
- **Flask app**: Managed by a user-level systemd service (`flask.service`), auto-starts on boot
- **Public domain**: Cloudflare Tunnel (`thelastgallery-tunnel.service`) exposes Flask to the internet — no port forwarding required
- Service files live in `~/.config/systemd/user/`
- Tunnel config: `~/.cloudflared/thelastgallery.yml`, tunnel name: `thelastgallery`

### Useful systemd commands
```bash
systemctl --user status flask.service
systemctl --user restart flask.service
systemctl --user status thelastgallery-tunnel.service
```

### Tailscale + SSH (Remote Dev Access)
- **Tailscale** installed on Chromebook (Linux, via apt), PC, and S25 Ultra phone
- **Tailscale IPs**:
  - Chromebook Linux: `100.113.92.21`
  - PC: `100.122.187.18`
  - S25 Ultra: `100.73.156.120`
- **SSH from PC**: `ssh chromebook` (config in `C:\Users\user\.ssh\config`)
- **PC SSH config entry**:
  ```
  Host chromebook
      HostName 100.113.92.21
      User daren
      IdentityFile ~/.ssh/id_ed25519
  ```
- **SSH from phone**: Termius app (S25 Ultra) → saved host `chromebook` → `100.113.92.21`, username `daren`, port `22`
- **SSH server**: Enabled to auto-start on boot (`sudo systemctl enable ssh`)

### Database Browser (sqlite-web)
- **sqlite-web** provides a browser-based GUI for live viewing and editing `gallery.db`
- Runs on the Chromebook as a user-level systemd service (`sqlite-web.service`)
- **Access from PC or any Tailscale device**: `http://100.113.92.21:8081`
- Service file: `~/.config/systemd/user/sqlite-web.service`
- **Caution**: Avoid editing while Flask is actively writing (during shuffles or uploads) to prevent SQLite locking conflicts — read-only browsing is always safe
- Useful commands:
  ```bash
  systemctl --user status sqlite-web.service
  systemctl --user restart sqlite-web.service
  ```

## GitHub
- Remote: `git@github.com:989Daren/last_gallery.git` (SSH)
- SSH key auth configured — `git push` works without credentials

## Maintenance Notes
- When making significant changes, append a dated entry to `CHANGELOG.md`
- Keep this file (`CLAUDE.md`) updated to reflect current state, not history
- `CLAUDE_URL.txt` in project root contains a raw GitHub URL pinned to the latest commit hash that changed `CLAUDE.md` — auto-generated by the post-commit hook
- Last reviewed: 2026-03-01

---

> For full change history, see [CHANGELOG.md](CHANGELOG.md).
