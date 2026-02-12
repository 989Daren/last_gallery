# The Last Gallery - Changelog

---

## 2026-02-12

### Edit Artwork Flow
- **Edit code system**: On metadata save, an 8-character edit code is generated per email and logged to server console (`[EDIT CODE] To: ... | Code: ...`). Same email reuses same code.
- **Schema migration 4**: New `edit_codes` table (email PK, code, created_at)
- **Verification endpoint**: `POST /api/verify_edit_code` accepts artwork title + edit code, returns matching tile_id. Title matching is case-insensitive with whitespace/trailing period tolerance.
- **Edit banner UI**: Hamburger → "Edit Your Artwork Submission" opens banner with artwork title and edit code fields. No tile click required.
- **Prefilled metadata form**: On successful verification, metadata modal opens in edit mode with all fields prefilled from database
- **Edit mode guards**: "Return to Artwork Edit" button disabled (opacity 0.3, pointer-events none, HTML disabled). Close (X) returns to gallery instead of upload modal.
- **Email change warning**: Yellow inline warning appears when email field is modified in edit mode, informing user their current edit code will be invalidated
- **Orphaned code cleanup**: When email changes, old email's edit code is deleted from `edit_codes` only if no other assets reference that email
- **`send_edit_code()` stub**: Console-only logger, ready to swap for SendGrid

### Welcome Modal Subtitle
- Added italic tagline beneath title: "A dynamic time capsule of creative works"
- Styled as light-weight subtitle (font-weight 300, italic, 75% opacity)
- Responsive sizing: 18px desktop, 15px mobile

### Edit Submission Banner Copy
- Updated heading to "A note about editing"
- Replaced body text with softer, friendlier copy

---

## 2026-02-08

### New Upload Highlight (scroll-to-tile + sheen)
- **`highlightNewTile(tileId)`**: After metadata save, resets zoom to 1.0x, scrolls viewport to center the new tile, and plays a reflective sheen animation
- **Sheen CSS**: `.tile-highlight-sheen::before` — diagonal gradient sweep (0.42 opacity peak, 30%-70% band), 4 iterations × 600ms = 2400ms total
- **Self-cleaning**: `animationend` listener removes class after animation completes (same pattern as pinch hint)
- **Zoom inline reset**: Resets `zoomState` and calls `unlockScrollTo(scrollX, scrollY)` directly (avoids `resetZoom()` which scrolls to 0,0)
- **Upload flow change**: `saveMetaToDb()` closes modals immediately, then calls `highlightNewTile` after 300ms delay

### Focal-Point Zoom Rewrite
- **Replaced center-origin zoom** with unified focal-point model: content under fingers stays anchored during pinch. Seamless direction reversal within a single gesture.
- **Progressive edge clamping**: Per-axis, per-frame. Padding interpolates from 20px (scale=1) to 10px (minScale). Content centers when it fits viewport, edge-clamps when it overflows.
- **2-axis minScale**: `min((vw-pad)/w, (vh-pad)/h, 1.0)` replaces old X-only formula
- **Scroll ↔ transform handoff**: Scroll captured before `lockScroll()`, mapped to `tx=-scrollX`. On snap-back, reverse mapping restores exact scroll position (no jump to origin).
- **Mid-gesture guard**: `applyZoomTransform` skips scroll handoff while `isPinching` is true — prevents the lockScroll/unlockScrollTo round-trip that was zeroing scroll position mid-pinch.
- **Touch-action fix**: `touch-action: none` set on wrapper via `lockScroll()`/`unlockScrollTo()` for entire zoom-out duration, preventing browser pinch-to-zoom flash between gestures.
- **Performance**: DOM refs (`_wrapper`, `_zoomWrapper`) and viewport metrics (`_vw`, `_vh`) cached in `zoomState`; `clampTransform` writes to reusable `_clampResult` object; touch math inlined in hot path. Zero per-frame DOM queries or allocations.
- **Gallery origin**: Initial view set to top-left (0, 0) instead of center
- **Cleanup**: Removed `throttle()`, `DEV_MODE`, `DEV_CANARY`, `checkForImageShift()`, `getCenterScrollPosition()`, `getPinchMidpoint()`, `getTouchDistance()` (last two inlined)

### Pinch-to-Zoom Hint Animation (2026-02-06)
- **Welcome modal bullet**: "Pinch to zoom out" shown on touch devices only (`<li class="touch-only">`, hidden via `display:none`, shown via `@media (pointer: coarse)`)
- **Ghost finger animation**: `showPinchHint()` fires 300ms after welcome modal dismisses; two 48px semi-transparent circles animate toward each other (2 cycles, 1s each) with a 2s fade envelope
- **Touch-only gate**: `window.matchMedia('(pointer: coarse)')` — no hint on desktop
- **Non-blocking**: `pointer-events: none` on hint overlay; user can pinch immediately while animation plays
- **Self-cleaning**: Hint DOM removed on `animationend`

---

## 2026-02-04

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

## 2026-02-03

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

## 2026-02-01

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
