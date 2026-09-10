# The Last Gallery - Project Summary

## Overview
A Flask-based web gallery application where users can upload artwork images that display on a tiled wall. Each tile can be clicked to view the full-size image with metadata displayed in an animated overlay ribbon.

## Tech Stack
- **Backend**: Python/Flask
- **Database**: SQLite (single source of truth) with versioned migrations
- **Frontend**: Vanilla JavaScript (modular), CSS
- **Image Processing**: Cropper.js (client-side cropping), Pillow (server-side optimization)
- **Payments**: Stripe Checkout (tile upgrades), webhook-only fulfillment
- **Email**: Resend API (edit code delivery), `python-dotenv` for env config

## How to Run
```bash
pip install -r requirements.txt
python app.py
```
- Local: http://127.0.0.1:5000
- The development server binds to `0.0.0.0:5000`; use the current host address for network testing.

## Key Files

### Backend
| File | Purpose |
|------|---------|
| `app.py` | Flask application, all API endpoints |
| `db.py` | Database connection, schema initialization, versioned migrations |
| `data/gallery.db` | SQLite database (schema v24) |
| `landing_zones.py` | Weekly landing zone selection + post-shuffle positioning pass |
| `select_cotm.py` | Monthly COTM winner selection (runs via systemd timer) |
| `grid utilities/repair_tiles.py` | Sync tiles table with SVG after grid extension |
| `cleanup_expired.py` | Remove artwork past its 24-hour payment deadline (runs via systemd timer) |
| `shuffle_tick.py` | Trigger weekly auto-shuffle when countdown expires (runs hourly via `tlg-shuffle-tick.timer`) |
| `backup_db.sh` | Consistent SQLite backup, retention, and optional PC-share copy (runs every 6 hours) |

### Frontend
| File | Purpose |
|------|---------|
| `static/js/main.js` | Core gallery rendering, popup overlay, wall state management |
| `static/js/admin.js` | Admin modal, action handlers (clear/move/undo/shuffle), countdown admin controls |
| `static/js/countdown.js` | Countdown timer bar module (fetch state, tick, show/hide) |
| `static/js/unlock_modal.js` | Upgrade modal: 3-step purchase flow (identify → select artwork → choose tier) |
| `static/js/upload_modal.js` | Image upload flow with cropping, metadata entry, and COTM opt-in |
| `static/js/cotm.js` | Creator of the Month popup, edit form, auto-show |
| `static/js/exhibit.js` | Exhibit intro, scrolling gallery, image popups, sharing |
| `static/js/exhibit_dashboard.js` | Artist exhibit profile/image management |
| `static/js/owner_edit.js` | Browser-side ownership/edit-code state and helpers |
| `static/js/success_banner.js` | Standard post-upload success banner |
| `static/js/deadline_banner.js` | 24-hour unlock deadline banner shown after 2nd+ uploads |
| `templates/index.html` | Main HTML template |
| `static/css/styles.css` | All styling including popup animations |
| `static/grid_full.svg` | SVG defining tile positions and sizes |

## Environment Variables
| Variable | Default | Purpose |
|----------|---------|---------|
| `TLG_ADMIN_PIN` | *(required)* | 5-digit admin PIN for admin endpoints |
| `TLG_BASE_URL` | `https://thelastgallery.com` | Base URL used in email links |
| `RESEND_API_KEY` | *(none)* | Resend API key for sending edit code emails |
| `STRIPE_SECRET_KEY` | *(none)* | Stripe secret key for payment processing |
| `STRIPE_WEBHOOK_SECRET` | *(none)* | Stripe webhook signing secret |

## Admin PIN
- 5-digit PIN, set via `TLG_ADMIN_PIN` in `.env` (required, no hardcoded default)
- Validated server-side only; never exposed to client-side JavaScript
- Rate limiting: 5 failed attempts per IP → 15-minute lockout (HTTP 429)
- PIN stored in IIFE closure scope after successful server validation, persists until page refresh

## JavaScript Architecture

### Global Exposure (from main.js)
```javascript
window.DEBUG          // Debug mode flag
window.ADMIN_DEBUG    // Admin debug footer flag
window.SEL            // DOM selector constants
window.API            // API endpoint constants
window.PAGE_MODE      // "edit" | "creator-of-the-month" | "purchase_success" | "upgrade" | "art" | ""
window.LANDING_ZONE   // { anchor_tile_id, offset_cell } | null (set from index template)
window.refreshWallFromServer()    // Refresh wall from database
window.refreshAdminOverlays()     // Refresh admin UI (from admin.js)
window.isAdminActive()            // Check admin session (from admin.js)
window.getAdminPin()              // Get admin PIN for cross-module requests (from admin.js)
window.initZoom()                 // Initialize pinch-to-zoom
window.resetZoom()                // Reset zoom to 1.0x
window.highlightNewTile(tileId)   // Scroll to tile + sheen animation
window.scrollToTile(tileId)       // Scroll to a tile without opening it
window.applyLandingZoneScroll(lz) // Frame the current landing-zone anchor
window.showShareToast()           // Show "Link copied" toast notification
window.openArtworkPopup(opts)     // Open the shared artwork/exhibit-image popup
window.refreshCountdown()         // Re-fetch countdown state (from countdown.js)
window.openUnlockModal(assetId, tileId)  // Open unlock modal (from unlock_modal.js)
window.openFloorUpgrade(artwork, editCode)  // Direct floor upgrade (from unlock_modal.js)
window.closeUnlockModal()         // Close unlock modal (from unlock_modal.js)
window.isUnlockModalOpen()        // Check if unlock modal is open (from unlock_modal.js)
window.registerDismissible(overlayId, closeBtnId, hashName)  // Register overlay for unified dismiss
window.closeAboutExhibits(silent)  // Close About Exhibits overlay (from exhibit.js)
window.openExhibitIntro(assetId)   // Open an exhibit intro (from exhibit.js)
window.openExhibitDashboard(assetId, code, pin) // Manage an exhibit
window.openCotmCard()              // Open the COTM card (from cotm.js)
window.openCotmEditAsAdmin(pin)    // Open COTM editor as admin
window.getOwnedAssetInfo(assetId)  // Read locally known ownership (from owner_edit.js)
window.getEditCodeForAsset(assetId)// Get locally stored edit code for an asset
window.showSuccessBanner(opts)     // Show standard upload success
window.showDeadlineBanner(opts)    // Show 24-hour deadline banner (from deadline_banner.js)
window.dismissDeadlineBanner()     // Dismiss deadline banner (from deadline_banner.js)
window.ConicalNav                  // Compound-hash modal/back-button coordinator
```

### Dismissible Overlay Registry (main.js)
- `registerDismissible()` registers overlays for unified close: close button, tap-anywhere, Escape, back button
- Returns `{open(silent), close(silent), overlay, hashName, isOpen}`
- `silent` param skips hash push/pop (for sub-overlays)
- Registered overlays: countdownInfo, humanCentric, howItWorks, pricing, unlockInfo

### admin.js Module
- IIFE pattern with initialization guards
- PIN validated server-side via `/api/admin/history_status` before unlocking modal
- PIN in closure-scoped `_adminPin`, exposed via `window.getAdminPin()`
- Guards prevent duplicate event handler registration

## Info Popup Design Pattern
All info popups (Shuffle, Human Centric, How it Works, About Exhibits) share a consistent feature-card layout:
- **Tagline** (`p.about-exhibits-tagline`) — centered one-liner below the header image
- **Feature cards** (`.about-exhibits-features` > `.about-exhibits-feature`) — icon + bold gold headline + description
- **Fine print** (`p.about-exhibits-note`) — muted footer note (optional)
- Emoji icons use VS16 variation selector (`&#xFE0F;`) for full-color rendering
- CSS selectors use `.countdown-info-card p.` prefix for specificity over generic card `p` rules

## Landing Zones

The viewport-sized region of the wall that the gallery loads into on first visit each week. Defined by `(anchor_tile_id, offset_cell)` — which M tile to frame around, and where in the viewport that anchor sits.

### Data Architecture
- **`landing_state`** table — one row per ISO week. Columns: `week (PK), anchor_tile_id (FK→tiles), offset_cell, created_at`.
- `offset_cell` is one of nine keys (`ul, uc, ur, ml, mc, mr, ll, lc, lr`) mapping to the anchor's fractional position inside the viewport (e.g., `mc = (0.5, 0.5)` centers it). Magnitudes are ±0.33.
- Viewport reference dimensions `REF_W=340, REF_H=510` (design px) — mirrors a typical mobile's usable wall area at scale=1.0.

### Selection (`landing_zones.py:select_landing_zone`)
- Called from `_run_shuffle()` with caller-managed conn so the zone update commits atomically with the shuffle.
- **Candidates** are every `(M tile, offset cell)` pair — any M tile can anchor the zone. Info-tile visibility is enforced by the post-shuffle info-swap pass, not by selection (info tiles get reshuffled, so pre-shuffle positions can't be used to filter anchors).
- Avoids repeating last week's anchor when alternatives exist.

### Positioning (`landing_zones.py:apply_zone_positioning`)
- Runs **after** the size-respecting shuffle. Never alters tile-size odds — only swaps within the same size class. Every swap respects the no-stay-in-place rule.
- **Anchor swap:** ensures an exhibit lands at the anchor M tile. Falls back to any M-sized artwork if no exhibit is available.
- **Info swap:** ensures at least one S info tile sits inside the viewport rectangle (S↔S swap with an outside-zone info tile, if needed). Info tiles are S-sized only.
- **Fill swap:** ensures at least `MIN_ZONE_FILL = 4` *displayable artwork* tiles inside the viewport rectangle. "Displayable" mirrors `/api/wall_state`'s filter (non-info AND non-empty `artist_name`). Runs after the info swap so it can compensate if the info swap displaced a displayable.

### Frontend Load (`static/js/main.js` boot RAF)
- `_landing_zone_template_json()` in app.py emits `{anchor_tile_id, offset_cell}` and reads the current-week row on every render. It is intentionally not process-cached because timer-driven shuffles run outside the Flask process. The value is embedded into `window.LANDING_ZONE` by the index template.
- `/api/wall_state` also returns `landing_zone`. After an admin shuffle, `admin.js` refreshes the wall and calls `applyLandingZoneScroll()` so the new framing appears without a page reload.
- On default homepage / `/edit` / `/creator-of-the-month`, the boot RAF looks up the anchor tile in `wallState.tiles`, computes its center from `size × BASE_UNIT`, and scrolls so the anchor sits at `(fx × vw, fy × vh)` inside the usable wall area (`window.innerHeight − wrapper.paddingTop`).
- Edge clamping is handled by the pinch-zoom layer's progressive edge clamping (see `docs/CLAUDE_FEATURES.md`, “Pinch-to-Zoom”) and native scroll bounds — anchors near the wall edge land safely without explicit checks.
- Deep-link modes (`art`, `purchase_success`, `upgrade`) keep their own scroll targets.

## Creator of the Month (COTM)

### Availability
- A single runtime flag in ignored `data/cotm_enabled.json` controls the program; a missing or invalid file defaults to disabled.
- The admin COTM checkbox updates the flag through `POST /api/admin/cotm/enabled`.
- When disabled, the public page returns 404, `/api/cotm` reports inactive, COTM write/edit/select endpoints return 403, the menu/action bar/upload opt-in/edit pill are hidden, the monthly selector no-ops, and edit-code emails omit the COTM teaser.
- Existing COTM/profile records remain intact while the program is disabled.

### Data Architecture
- **`artist_profiles`** table — single source of truth for artist bio data (bio, location, medium, artistic focus, education, highlights, headshot URL, `cotm_opt_in` flag). Keyed by email.
- **`creator_of_the_month`** table — selection ledger only (month, artist_name, email, excluded_asset_ids, selected_at). No profile data.
- Display endpoints (`/api/cotm`, `/api/cotm/edit`) JOIN `artist_profiles` for profile fields
- Profile edits always write to `artist_profiles` — one table, no sync needed

### Opt-In Flow
1. Upload metadata modal shows "Enter Creator of the Month Drawing" button
2. Button opens a compact profile overlay (Tier-3, over metadata modal): bio (required), location, expandable "More about you" section
3. Profile data stored in memory only — DB write deferred until metadata save succeeds (prevents orphaned rows)
4. `flushPendingCotmProfile()` fires after `saveMetaToDb()` returns an edit code
5. Returning artists (edit mode) see their existing profile pre-filled via `fetchAndPrefillProfile()`

### Winner Selection (`select_cotm.py`)
- Runs 1st of each month via systemd timer
- Filters: `artist_profiles.cotm_opt_in = 1` + at least one unlocked artwork + not admin + not a winner in last 5 months
- Creates a `creator_of_the_month` record (selection ledger only)

### COTM Edit Form (`cotm.js`)
- One form, three entry points: email congratulations link, popup edit button (owner via localStorage), admin
- Writes profile data to `artist_profiles`, artwork exclusions to `creator_of_the_month`
- Photo upload writes `bio_photo_url` to `artist_profiles`

### ConicalNav Integration
- COTM participates in compound hashes: `#cotm`, `#cotm/art`, `#cotm/art/ribbon`
- Allows art popup to layer over COTM popup with correct back-button behavior

## Notes
- Undo history is in-memory (resets on server restart)
- Images stored in `/uploads/` with UUID filenames; served with 1-year immutable cache
- Schema migrations run automatically on startup
- Environment variables loaded from `.env` via `python-dotenv` (`.env` is gitignored)
- Runtime grid color is stored in ignored `data/grid_color.json`. The tracked root `grid_color.json` is not read by the current application.
- Importing `app.py` is not read-only: module initialization runs migrations, ensures runtime directories exist, and may generate/seed info-tile state.
- `buildContactLink()` in `main.js` infers missing contact type from value (`@` → email, URL patterns → website)

## Working with Claude (claude.ai)
- When drafting instructions for Claude Code handoff, keep guidance intent-based
  and avoid specific variable names, class names, or implementation details —
  Claude Code should read the actual files and determine those itself

## Reference Documentation
For detailed docs on specific areas, read these files on demand:
- **[docs/CLAUDE_SCHEMA.md](docs/CLAUDE_SCHEMA.md)** — Full database schema SQL, tile registration, SVG structure, grid extension
- **[docs/CLAUDE_FEATURES.md](docs/CLAUDE_FEATURES.md)** — API endpoints, upload flow, edit flow, popup overlay, pinch-to-zoom, countdown, shuffle rules, upgrade modal, share links, exhibits, deadlines, SEO
- **[docs/CLAUDE_INFRA.md](docs/CLAUDE_INFRA.md)** — Dev environment, hosting, systemd services, Tailscale/SSH, sqlite-web, GitHub

## Maintenance Notes
- When making significant changes, append a dated entry to `CHANGELOG.md`
- Keep this file (`CLAUDE.md`) updated to reflect current state, not history
- `CLAUDE_URL.txt` contains a raw GitHub URL pinned to the commit that changed `CLAUDE.md`.
- The local post-commit hook has consequential behavior: a commit touching `CLAUDE.md` copies this file to `~/pc/` when mounted, rewrites `CLAUDE_URL.txt`, creates a second commit, and runs `git push`. Do not commit a `CLAUDE.md` change unless that automatic commit and push are intended.
- Last reviewed against `master`, schema v24, and deployed services: 2026-09-10

---

> For full change history, see [CHANGELOG.md](CHANGELOG.md).
