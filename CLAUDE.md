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
- Network: http://192.168.1.191:5000 (for mobile testing)

## Key Files

### Backend
| File | Purpose |
|------|---------|
| `app.py` | Flask application, all API endpoints |
| `db.py` | Database connection, schema initialization, versioned migrations |
| `data/gallery.db` | SQLite database (schema v23) |
| `landing_zones.py` | Weekly landing zone selection + post-shuffle positioning pass |
| `select_cotm.py` | Monthly COTM winner selection (runs via systemd timer) |
| `grid utilities/repair_tiles.py` | Sync tiles table with SVG after grid extension |
| `cleanup_expired.py` | Remove artwork past its 24-hour payment deadline (runs via systemd timer) |

### Frontend
| File | Purpose |
|------|---------|
| `static/js/main.js` | Core gallery rendering, popup overlay, wall state management |
| `static/js/admin.js` | Admin modal, action handlers (clear/move/undo/shuffle), countdown admin controls |
| `static/js/countdown.js` | Countdown timer bar module (fetch state, tick, show/hide) |
| `static/js/unlock_modal.js` | Upgrade modal: 3-step purchase flow (identify → select artwork → choose tier) |
| `static/js/upload_modal.js` | Image upload flow with cropping, metadata entry, and COTM opt-in |
| `static/js/cotm.js` | Creator of the Month popup, edit form, auto-show |
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
window.LANDING_ZONE   // { id, name, anchor_tile_id, center_x, center_y } | null (set from index template)
window.refreshWallFromServer()    // Refresh wall from database
window.refreshAdminOverlays()     // Refresh admin UI (from admin.js)
window.isAdminActive()            // Check admin session (from admin.js)
window.getAdminPin()              // Get admin PIN for cross-module requests (from admin.js)
window.initZoom()                 // Initialize pinch-to-zoom
window.resetZoom()                // Reset zoom to 1.0x
window.highlightNewTile(tileId)   // Scroll to tile + sheen animation
window.showShareToast()           // Show "Link copied" toast notification
window.refreshCountdown()         // Re-fetch countdown state (from countdown.js)
window.openUnlockModal(assetId, tileId)  // Open unlock modal (from unlock_modal.js)
window.openFloorUpgrade(artwork, editCode)  // Direct floor upgrade (from unlock_modal.js)
window.closeUnlockModal()         // Close unlock modal (from unlock_modal.js)
window.isUnlockModalOpen()        // Check if unlock modal is open (from unlock_modal.js)
window.registerDismissible(overlayId, closeBtnId, hashName)  // Register overlay for unified dismiss
window.closeAboutExhibits(silent)  // Close About Exhibits overlay (from exhibit.js)
window.showDeadlineBanner(opts)    // Show 24-hour deadline banner (from deadline_banner.js)
window.dismissDeadlineBanner()     // Dismiss deadline banner (from deadline_banner.js)
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

A curated viewport-sized region of the wall that the gallery loads into on first visit. One zone is chosen per weekly shuffle; the same zone is used for everyone visiting that week.

### Data Architecture
- **`landing_zones`** table — 10 curated zone rows seeded once via `grid utilities/seed_landing_zones.py`. Columns: `id, name, anchor_tile_id (FK→tiles), center_x/y, ref_width/height, tile_ids (JSON snapshot), active, last_used_week, created_at`.
- All coordinates are in **rendered design space** (post-flip DOM coords at scale=1.0), so the frontend can directly use `center_x/y` as scroll targets.
- `tile_ids` is a snapshot of which tile IDs fall inside the zone's rectangle — used by the shuffle's fill pass. Brittle if the SVG grid is extended; re-seed if so.

### Selection (`landing_zones.py:select_landing_zone`)
- Called from `_run_shuffle()` at the start (caller-managed conn so the zone update commits atomically with the shuffle).
- Filters `active = 1`. Excludes the zone with the most recent `last_used_week` (no repeats two weeks in a row); falls back to allowing it if the exclusion empties the pool.
- Clears any prior current-week marker before setting the new one — guarantees exactly one zone holds the current week's marker even after admin re-shuffles.

### Positioning (`landing_zones.py:apply_zone_positioning`)
- Runs **after** the existing size-respecting shuffle. Never alters tile-size odds — only swaps tiles within the same size class.
- **Anchor swap:** ensures an exhibit artwork ends up in the zone's anchor M tile. Falls back to any M-sized artwork if no exhibit landed at an M tile during the shuffle.
- **Fill swap:** ensures at least `MIN_ZONE_FILL = 4` *displayable artwork* tiles are inside the zone. "Displayable" mirrors `/api/wall_state`'s filter (non-info AND non-empty `artist_name`). Info tiles can land in-zone but don't count toward the minimum.
- Every swap respects the existing no-stay-in-place rule.

### Frontend Load (`static/js/main.js` boot RAF)
- `_landing_zone_template_json()` in app.py is cached by ISO week — one DB read per week, not per request. Embedded into `window.LANDING_ZONE` via the index template.
- On default homepage / `/edit` / `/creator-of-the-month`, the boot RAF scrolls the wrapper so `(center_x, center_y)` is at the visual center of the usable wall area (`window.innerHeight − wrapper.paddingTop`), at scale=1.0. The fixed-header padding subtraction is critical — using raw `window.innerHeight` pushes the zone too high and cuts off the bottom.
- Deep-link modes (`art`, `purchase_success`, `upgrade`) keep their own scroll targets.
- After the welcome modal is dismissed, the modal's semi-transparent backdrop lingers behind the "PINCH TO ZOOM OUT" animation for contrast, then is dismissed when the animation completes (`pinch-hint-done` custom event).

### Open work (saved to memory)
- See `project_admin_suppress_emails.md` — admin shuffle button should grow a "Suppress Emails" toggle so test shuffles don't notify artists.
- See `project_upload_flow_restructure.md` — broader upload-flow fix to stop orphan rows + files.
- **Candidate refactor:** the current 10-curated-zone approach may collapse to "pick any M tile, swap nearby art" with much less code surface. Discussed but not implemented.

## Creator of the Month (COTM)

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
- `CLAUDE_URL.txt` in project root contains a raw GitHub URL pinned to the latest commit hash that changed `CLAUDE.md` — auto-generated by the post-commit hook
- Last reviewed: 2026-05-26

---

> For full change history, see [CHANGELOG.md](CHANGELOG.md).
