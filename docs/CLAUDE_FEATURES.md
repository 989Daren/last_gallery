# Feature Documentation

## API Endpoints

### Pages, Static Data, and Public Reads

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Main gallery; supports artwork and exhibit-image `?art=` deep links plus purchase/upgrade modes |
| `/edit` | GET | Gallery in edit mode; opens the edit banner and skips welcome |
| `/creator-of-the-month` | GET | COTM spotlight; returns 404 while COTM is disabled |
| `/privacy` | GET | Privacy policy |
| `/robots.txt`, `/sitemap.xml`, `/favicon.ico` | GET | Search metadata and favicon |
| `/api/wall_state` | GET | Tile assignments plus current `landing_zone` |
| `/api/countdown_state` | GET | Pure read of countdown state; the systemd tick performs transitions |
| `/api/exhibit/public/<asset_id>` | GET | Public exhibit profile and ordered images |
| `/api/exhibit_image/<image_id>` | GET | One exhibit image for a share-link deep link |
| `/api/cotm` | GET | Current COTM payload, or `{active:false}` when disabled/unselected |
| `/uploads/<filename>` | GET | Uploaded images with one-year immutable caching |

### Upload and Editing

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/upload_assets` | POST | Upload tile and popup images and create the initial asset/tile rows |
| `/api/check_upload_limit` | POST | Return current per-email count and four-artwork limit |
| `/api/abandon_upload` | POST | Remove an incomplete asset whose `artist_name` is still empty |
| `/api/tile/<tile_id>/metadata` | POST | Save metadata; supports edit mode, duplicate checks, limits, deadlines, and edit codes |
| `/api/tile/<tile_id>/metadata` | GET | Get tile metadata |
| `/api/verify_edit_code` | POST | Verify title plus edit code and return the matching asset/tile |
| `/api/resend_edit_code` | POST | Privacy-safe edit-code resend |

### Admin

These routes validate the `X-Admin-Pin` header unless the row says otherwise.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/tile_info` | GET | Tile/asset information |
| `/api/admin/clear_tile` | POST | Clear one tile |
| `/api/admin/clear_all_tiles` | POST | Clear all tiles |
| `/api/admin/move_tile_asset` | POST | Move or swap artwork |
| `/api/admin/undo` | POST | Undo shuffle or non-shuffle history |
| `/api/admin/history_status` | GET | Undo availability |
| `/api/admin/force_unlock` | POST | Explicitly set `unlocked`; locking resets floor to `s` |
| `/api/admin/set_qualified_floor` | POST | Set `s`, `m`, `lg`, or `xl` floor |
| `/api/admin/countdown` | POST | Set active/scheduled countdown or clear it |
| `/api/admin/cotm/enabled` | POST | Persist global COTM enabled state |
| `/api/admin/cotm/select` | POST | Select the current month's creator and send email when possible |
| `/shuffle` | POST | Shuffle; validates a `pin` field in the request body |

`POST /api/grid-color` persists the global color but currently performs no server-side admin-PIN check. The UI exposes it through the admin panel; callers must not assume the route itself is protected.

### Ownership, Stripe, and Upgrades

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/my_artworks` | POST | List artworks owned by an edit code |
| `/api/upgrade_options/<asset_id>` | GET | Return currently eligible tiers for an owned artwork |
| `/api/stripe/checkout` | POST | Create a Stripe Checkout session after ownership and tier validation |
| `/api/stripe/webhook` | POST | Signature-verified, idempotent fulfillment |
| `/api/lock_tile` | POST | Directly lock at current size; currently has no edit-code or admin-PIN check |

### Exhibit Management

All management routes authenticate with an edit code or active admin PIN as implemented by the individual handler.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/exhibit/<asset_id>/dashboard` | GET | Authenticated exhibit profile and image list |
| `/api/exhibit/<asset_id>/profile` | POST | Update exhibit profile |
| `/api/exhibit/<asset_id>/photo` | POST | Replace exhibit artist photo |
| `/api/exhibit/<exhibit_id>/upload_image` | POST | Add an exhibit image, up to 20 |
| `/api/exhibit/<exhibit_id>/image/<image_id>/metadata` | POST | Update exhibit-image metadata |
| `/api/exhibit/<exhibit_id>/image/<image_id>` | DELETE | Delete an exhibit image |
| `/api/exhibit/<exhibit_id>/reorder` | POST | Persist image order |

### Creator Profiles and COTM

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/artist_profile` | GET | Read the edit-code owner's reusable creator profile |
| `/api/artist_profile` | POST | Save profile and opt-in; returns 403 while COTM is disabled |
| `/api/cotm/edit` | GET | Authenticated current-COTM profile and artwork exclusions |
| `/api/cotm/profile` | POST | Save current-COTM profile fields and exclusions |
| `/api/cotm/photo` | POST | Replace current-COTM headshot |

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
- Displays on ordinary gallery loads. Edit, COTM, upgrade, and purchase-success modes skip it; artwork deep links defer it until the popup closes.
- **Layout**: Centered title, logo (left) + bullet instructions (right), Enter button below
- **Logo**: `static/images/logo.svg` (168px desktop, 108px mobile)
- **Content**: "Welcome to The Last Gallery" title, italic subtitle ("A dynamic time capsule of creative works"), bulleted instructions
- **Animation**: Diagonal reflection sweep across modal (simpleWelcomeSheen)
- Dismissed via "Enter" button, backdrop click, or Escape key

## Edit Artwork Flow
- **Trigger**: Hamburger menu → "Edit Your Artwork or Exhibit", or deep-link via `/edit` (auto-opens edit banner, skips welcome modal)
- **Edit banner**: Title "Edit Your Artwork or Exhibit", body text, two input fields (artwork title + edit code), Cancel/Continue buttons. "Forgot your edit code?" link toggles inline email resend form.
- **Admin edit shortcut**: When admin is active, edit banner hides the edit code field and accepts a tile ID instead. Uses `/api/admin/tile_info` with PIN header for lookup.
- **Verification**: `POST /api/verify_edit_code` with `{title, code}`. Title matching is case-insensitive, trims whitespace and trailing periods. Code maps to email, then finds asset where both title and email match.
- **Edit codes**: Generated on first metadata save (8-char hex via `uuid.uuid4().hex[:8]`), one per email. Emailed to artist via Resend API (`send_edit_code(email, code, artwork_title)`). HTML email includes artwork title, edit code, and a link to `/edit` with title prefilled. The COTM teaser is included only while the COTM program is enabled. Plain-text fallback included. Codes are reused across uploads with the same email.
- **Email send logic**: Client passes `is_edit` flag in metadata POST. New uploads always send the email. Edit saves skip the email unless the email address changed (even if new email already has a code).
- **Resend edit code**: `POST /api/resend_edit_code` takes email, looks up existing code, resends. Privacy-safe: always returns success message regardless of email existence.
- **Edit mode**: Metadata modal opens prefilled. "Return to Artwork Edit" button disabled (CSS `edit-mode-disabled` + HTML `disabled`). Close (X) returns to gallery, not upload modal.
- **Email change warning**: Yellow inline warning when email field differs from original, informing user their edit code will be invalidated and a new one sent.
- **Orphaned code cleanup**: On email change, old email's `edit_codes` row deleted only if no other assets reference that email.

## Popup Overlay
- **Animation sequence**: image appears → title fades in → black ribbon slides from left → text reveals
- **Close behavior**: First click hides ribbon, second click closes popup. `closeArtworkPopup()` detects whether the ribbon was open and pops both ConicalNav hash entries (`#art/ribbon` and `#art`) in one call.
- **Share button**: Android-style three-dot icon (inline SVG), 29px circle, positioned to the left of the close X (8px gap). Appears when ribbon text appears (`stage-info-text`) and stays visible after ribbon dismissal. Uses `navigator.share()` on mobile and clipboard copy plus a toast on desktop. Exhibit scrolling-gallery images pass an `ei:<image_id>` asset ID, so their popups are shareable too.
- **Upgradable button**: Gold gradient button on the ribbon (next to "edit"), shown when artwork's current tile is above its qualified floor and the viewer owns the artwork (via localStorage edit code). Closes popup, then opens `openFloorUpgrade()` directly to tier selection.
- **Popup close button**: X button above top-right corner of image (appears after ribbon is dismissed)
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
  - Back button: Unwinds layers (ribbon → popup → shuffleinfo → unlock → leave page)
- **Disabled during**: Welcome modal, upload modal, admin modal, artwork popup, any open dismissible overlay
- **Refresh behavior**: Non-admin wall refreshes reset zoom to 1.0x. While an admin session is active, clear/move/undo refreshes preserve zoom; shuffle additionally re-frames on the new landing zone.
- **Performance**: DOM elements (`_wrapper`, `_zoomWrapper`) and viewport metrics (`_vw`, `_vh`) cached in `zoomState`; refreshed only on resize/orientation change. `clampTransform` writes to a reusable `_clampResult` object (zero per-frame allocation). Touch distance and midpoint inlined in hot path.

## Countdown Timer Bar
- **Position**: Fixed below header, 40px tall (36px on mobile <375px), black background
- **Font**: Bebas Neue (Google Fonts), gold numbers (#D4A843), soft white text (#E0E0E0)
- **Format**: "Artwork Shuffle: 6 days, 12 hours, 34 minutes" — numbers gold, units soft white
- **States**: Active (ticking), Scheduled ("Countdown begins soon"), Cleared (bar hidden)
- **Info icon**: Gold-filled circled italic "i" inline after countdown text, opens info popup with shuffle graphic and explanatory copy
- **Info popup**: Integrates with ConicalNav back-button navigation (`#shuffleinfo`)
- **Auto-shuffle**: `tlg-shuffle-tick.timer` (user-level systemd, `OnCalendar=hourly`) ticks at the top of each hour and runs `shuffle_tick.py`. When `countdown_schedule.target_time` has passed, the script takes a `BEGIN IMMEDIATE` lock, rolls `target_time` forward by `duration_seconds`, then calls `_run_shuffle()` (same weighted, floor-respecting algorithm as manual shuffle). Pushes to `_shuffle_history` so auto-shuffles are undoable. The Flask `GET /api/countdown_state` handler is a pure reader — it never triggers shuffles itself, so the shuffle fires on schedule even when no visitor is polling. Client-side: when `countdown.js`'s tick reaches zero it shows "Shuffling..." with gold pulse for 3s, then re-fetches state to pick up the new cycle.
- **Persistence**: State stored in `countdown_schedule` DB table, survives server restarts
- **CSS variable**: `--total-fixed-height` = header + countdown bar height; used by gallery wrapper padding and zoom viewport metrics
- **Admin controls**: "Countdown" button in admin panel opens modal to set Active (with duration), Scheduled (with delayed start), or Cleared
- **Module**: `static/js/countdown.js` — IIFE, exposes `window.refreshCountdown()` for admin.js

## Landing Zones

- A landing zone is the weekly first-view framing: `{anchor_tile_id, offset_cell}` in `landing_state`.
- `select_landing_zone()` chooses from every M-tile and nine offset-cell combinations and avoids repeating the previous week's anchor when alternatives exist.
- Selection occurs during `_run_shuffle()` using the shuffle's database connection. `apply_zone_positioning()` then swaps only within equal size classes to place an exhibit (or other M artwork) at the anchor, make an S info tile visible, and reach at least four displayable artworks in the viewport where possible.
- The positioning pass preserves each artwork's qualified-floor eligibility and the no-stay shuffle rule.
- `_landing_zone_template_json()` reads the current-week row on each page render; it is intentionally not cached across requests because automatic shuffles run in another process.
- The template embeds the value as `window.LANDING_ZONE`. `/api/wall_state` also returns it so `refreshWallFromServer()` can update the browser copy.
- Default, edit, and COTM page modes use the landing zone on boot. Artwork, upgrade, and purchase-success deep links keep their own targets.
- After a manual admin shuffle, `admin.js` calls `applyLandingZoneScroll()` after refreshing the wall so the new composition is shown immediately.

## Creator of the Month

- `data/cotm_enabled.json` is the gitignored global switch. Missing or invalid data defaults to disabled; the admin checkbox writes it through `/api/admin/cotm/enabled`.
- While disabled, `/creator-of-the-month` returns 404, `/api/cotm` reports inactive, COTM write/edit/select endpoints return 403, `select_cotm.py` exits without selecting, and COTM menu, action-bar, upload opt-in, creator-edit, and email-teaser surfaces are hidden.
- Profile information lives only in `artist_profiles`, keyed by normalized email. `creator_of_the_month` is the monthly selection ledger and stores artwork exclusions.
- Upload opt-in profile data stays in browser memory until artwork metadata saves successfully; it is then written through `/api/artist_profile` using the returned edit code.
- The monthly system-level `select-cotm.timer` runs on the first day of the month at 00:00 UTC. Eligible artists opted in through `artist_profiles`, have unlocked artwork, are not the configured admin artist, and have not won in the previous five selections unless the entire pool is in cooldown.
- The COTM popup and editor are implemented in `static/js/cotm.js`. The edit code is used for artist access; an active admin session can open the same editor through the admin controls.

## Hamburger Menu
Menu items in order:
1. **How it All Works** — opens info modal explaining the upload → unlock → shuffle → upgrade cycle
2. **Upgrade Pricing** — opens pricing modal with tier comparison columns and "Upgrade Now" CTA
3. **Unlock Your Artwork** — opens upgrade modal (3-step flow)
4. **A Human Centric Gallery** — opens info modal (see below)
5. **Edit Your Submission** — opens edit banner
6. **Creator of the Month** — conditional; visible only while COTM is enabled
7. **Your Privacy** — links to `/privacy`
8. **Admin** — opens admin modal (PIN gated)

## Upgrade Modal (unlock_modal.js)
Three-step purchase flow using edit codes for identity ("lock what you landed on" model):
- **Step 1: Identification** — Enter edit code → calls `POST /api/my_artworks` to get artworks. "Forgot your code?" inline resend form.
- **Step 2: Artwork Selection** — Shows all artworks for that email with status badges (Locked/Unlocked/Exhibit/Floor: M/LG/XL). Auto-skipped if only 1 artwork.
- **Step 3: Upgrade Options** — Shows "Currently in a [Size] tile" subtitle. Fetches `GET /api/upgrade_options/<asset_id>` for tiers. Only the tier matching the artwork's current tile size is available (gold CTA → Stripe). Other floor tiers show "Your artwork must be in a [Size] tile". Exhibit tier requires floor upgrade first if artwork is in a tile above its current floor.
- **Tile-size validation**: `/api/stripe/checkout` re-verifies tile size before creating session, preventing race conditions with shuffle.
- **Navigation**: Same `#unlock` ConicalNav hash for all steps. `openUnlockModal(assetId)` auto-selects artwork after identification.
- **Direct floor upgrade**: `openFloorUpgrade(artwork, editCode)` — called from the "upgradable" ribbon button. Skips steps 1-2, opens directly on step 3 with artwork summary and Back button hidden. Uses `_floorUpgradeOnly` flag to control section visibility.
- **Purchase success**: Stripe redirects back with `?purchase_success=1&type={tier}&asset_id={id}`. `handleStripeReturn()` in main.js cleans URL, skips welcome, shows success banner.
- **Upgrade deep link**: `/?upgrade=1&asset_id=X` (from post-shuffle notification emails). `handleUpgradeDeepLink()` cleans URL, sets `PAGE_MODE = "upgrade"`, skips welcome, opens unlock modal with artwork pre-selected.

## Share Links
- **Share URL format**: `/?art=<asset_id>` for tile artwork, `/?art=ei:<image_id>` for exhibit images — both survive tile shuffles
- **Share icon on artwork popup**: Android-style three-dot SVG icon, 29px white circle, 8px left of the close X. Appears with ribbon text (`stage-info-text`). Uses `navigator.share()` on mobile (native share sheet), falls back to clipboard copy + "Link copied" toast on desktop.
- **Share icon on exhibit intro**: 27px circle, positioned above intro card top-right, accounts for optional edit button
- **Deep link handler**: `handleArtDeepLink()` parses `?art=` before boot, sets `PAGE_MODE = "art"`, cleans URL via `replaceState`. After boot: for `ei:` prefixed IDs, fetches exhibit image data from `/api/exhibit_image/<id>` and opens popup on the wall (no exhibit context). For regular IDs: finds tile by `data-asset-id`, scrolls to it, opens artwork popup (or exhibit intro for exhibit tiles).
- **OG tags**: Server-side in `index()` route — queries asset by id (or exhibit image by `image_id` for `ei:` prefix), serves dynamic `og:title` ("Title by Artist"), `og:image` (popup image for artwork, tile image for exhibits, `image_url` for exhibit images), `og:url`. Falls back to site defaults when no `?art=` param or asset not found.
- **Edge case**: If shared artwork has been removed (expired, cleared), the deep link loads the gallery normally (no error, no popup).

## Human Centric Gallery Modal
- **Trigger**: Hamburger menu → "A Human Centric Gallery", or "Submission Guidelines" link in upload modal
- **Structure**: Reuses `countdown-info-card` pattern (gold accent bar, body wrapper, absolute-positioned close button)
- **Image**: `static/images/artist_group.png` (656x500) at top, full-width with rounded corners
- **Content**: Emphasizes human touch in creative process; allows AI as a tool (collage, reference); rejects raw, unedited AI-generated images; warns non-conforming submissions may be removed
- **Dismiss**: Close button (X), tap anywhere on popup or backdrop (except interactive elements), Escape key, or back button
- **ConicalNav**: Pushes `#humancentric` hash for back-button navigation on mobile
- **Also opened from**: "Submission Guidelines" link in upload modal (opens without hash push so upload modal stays open underneath)

## Shuffle & Unlock Rules (Qualified Floor Model)
- **New uploads** always land in an S tile (`pick_next_s_tile_id()` in `app.py`). Available S count accounts for floor-s unlocked artwork in non-S tiles needing a reserved S slot.
- **Unupgraded** (`unlocked = 0`): S tiles only — most constrained, placed first during shuffle.
- **Floor > s** (`unlocked = 1`, `qualified_floor` in m/lg/xl): Shuffles into tiles at floor size or larger. Higher floor = fewer eligible tiles = placed earlier.
- **Unlocked** (`unlocked = 1`, `qualified_floor = 's'`): Any tile size — least constrained, placed last. Weighted random: more tiles in a size = higher probability.
- **`qualified_floor`** column (values: s, m, lg, xl): Artwork never drops below this size during shuffle. Set via admin override (`/api/admin/set_qualified_floor`) or Stripe payment.
- **"Lock what you landed on"**: Artists can only purchase the floor tier matching their artwork's current tile size. Creates urgency around the weekly shuffle cycle — land in a bigger tile, lock it in before the next shuffle.
- **Stripe integration**: `/api/stripe/checkout` creates a Stripe Checkout Session for a tier purchase. Webhook (`/api/stripe/webhook`) applies the upgrade on `checkout.session.completed`. Current prices from `TIER_CONFIG` are `unlock_s` $9.99 (was $19.99), `floor_m` $24.99 (was $39.99), `floor_lg` $59.99, `floor_xl` $99.99, and `exhibit` $129.99 (was $199.99). Checkout uses inline `price_data`; fulfillment is idempotent through `purchase_history`.
- **Exhibit tier prerequisite**: `/api/upgrade_options` blocks the exhibit tier when artwork's current tile size is above its qualified floor (pending floor upgrade). Artist must purchase the floor upgrade first. Enforced server-side.
- **Post-shuffle notifications**: After each shuffle, `_run_shuffle()` emails artists whose unlocked artwork landed in a tile above their current floor. Email includes artwork title, new tile size, price to upgrade, access code (edit code, called "access code" in this context), and CTA link (`/?upgrade=1&asset_id=X`). Uses `send_upgrade_notification()`. Wrapped in try/except — failures never break the shuffle.
- **`/api/lock_tile`**: Direct mutation endpoint that sets `qualified_floor` to the artwork's current size and `unlocked=1`; it rejects S locks. It currently performs no edit-code or admin-PIN validation.
- **Derangement rule**: Every artwork must change position during a shuffle — no artwork may remain in its previous tile. The algorithm excludes each artwork's original tile from candidates; if the original tile is the last remaining in its pool, a swap with a previously-assigned artwork resolves it.
- **Admin force_unlock**: `/api/admin/force_unlock` sets unlocked explicitly (0 or 1). Locking (unlocked=0) also resets `qualified_floor` to 's'.

## Free Tile Limit & 24-Hour Deadline
- **1 free tile per email**: Each artist gets one free (`unlocked=0`) tile. On 2nd+ uploads, a `payment_deadline` is set 24 hours from metadata save.
- **Deadline banner**: After metadata save for a 2nd+ upload, the UI shows a deadline banner (clock icon, "Unlock Now" CTA → upgrade modal, "OK, I understand" dismiss). Replaces the normal success banner.
- **Deadline notification email**: `send_deadline_notification()` emails the artist with artwork title, 24-hour warning, access code, and "Unlock Now" link (`/?upgrade=1&asset_id=X`).
- **Deadline clearing**: Any unlock action (Stripe webhook, admin force_unlock, lock_tile) sets `payment_deadline = NULL`. Additionally, if the email's remaining free tile count drops to ≤1, all sibling deadlines for that email are cleared — so unlocking **either** artwork saves both.
- **Limit checks on email change**: Upload limits (4-tile max + free tile limit) also apply when editing an artwork and changing its email to a new address.
- **Cleanup**: `cleanup_expired.py` removes expired artwork (`payment_deadline < now AND unlocked = 0`), deletes image files, clears tile assignments, and cleans up orphaned edit codes. Runs via systemd timer (`cleanup-expired.timer`) every 12 hours at midnight and noon ET.

## Exhibit Tiles
Top-tier artist feature, currently $129.99 with a $199.99 original price. An exhibit tile is an easily identifiable tile (gold badge overlay + shimmer animation) that, when clicked, opens an introduction modal covering the artist. A "Continue" button leads to a horizontally scrolling presentation of all the artist's works — full scaled images with padding on a transparent dark background and viewer scroll/swipe controls. Purchase requires unlocked artwork currently in an M/LG/XL tile. Fulfillment sets `asset_type = 'exhibit'`, locks the floor to the current tile size, creates an `exhibits` row, and seeds the artwork as the first exhibit image. Artists manage up to 20 images plus profile fields and ordering through `exhibit_dashboard.js`; `exhibit.js` renders the public experience.
- **Intro popup share button**: 27px circle with three-dot share icon, positioned above the intro card's top-right corner. Sits to the left of the edit button (6px gap) when present, or at the right edge otherwise. Shares `?art=<asset_id>` — deep link opens the exhibit intro.
- **Exhibit image popups**: Images in the scrolling gallery reuse `openArtworkPopup()` with `assetId: 'ei:<image_id>'` and `exhibitContext: true`. Share button is visible; share link (`?art=ei:<image_id>`) opens the image directly on the gallery wall (no exhibit context), dismissing lands on the wall.
- **Scrolling gallery swipe (mobile)**: Physics-based momentum model. `touchmove` samples velocity frame-by-frame (exponential smoothing, `VELOCITY_SMOOTH = 0.3`). On release, throw distance = `absV × THROW_DECAY × (curItemWidth + SPACING)` (`THROW_DECAY = 0.83`). Nearest image center to that distance is the target. Minimum-advance rule ensures a valid swipe always moves at least 1 image. Light swipes always land on the next image; strong swipes travel proportionally farther. Animation uses ease-out (`cubic-bezier(0.25, 0.46, 0.45, 0.94)`), duration 0.25–0.65s scaled by velocity. Velocity zeroed if finger stationary >80ms before release (`VELOCITY_DECAY_MS`).
- **Scrolling gallery drag (desktop)**: Same `snapByMomentum()` path as mobile — live velocity tracked in `onDragMove`, resolved on `onDragEnd`. Low velocity (<0.15 px/ms) snaps to nearest without momentum.
- **Gallery close button**: Absolutely positioned within `.exhibit-ribbon-area` at `top: 20px; transform: translateY(-100%)` — bottom edge sits 20px above the ribbon area top, clearing the gold bar on mobile.

## Info Tiles
- 3 info-type assets seeded on startup via `_seed_info_tiles()` in `app.py`, assigned to random S tiles
- Tile image generated by `_generate_info_tile_image()`: 512x512 black background, gold circle, Georgia Bold Italic "i" — matching the countdown info icon font
- Image stored at `static/images/info_tile.jpg`, only generated if missing
- Clicking an info tile opens the "How It Works" modal instead of artwork popup
- Info tiles are restricted to S-sized tiles and participate in the weekly shuffle (they move with everything else); the landing-zone info-swap pass guarantees at least one info tile lands inside the framed viewport. Excluded from cleanup and abandonment logic.

## Grid Color

- The admin UI includes a global color picker that posts to `/api/grid-color`.
- Runtime state is stored in gitignored `data/grid_color.json`; missing or invalid data falls back to `#b84c27`.
- The tracked root `grid_color.json` is legacy and is not read by the current backend.
- The route currently validates basic hex shape but does not validate the admin PIN server-side.

## Visual Theme
- **Gold accent system**: All modals share a consistent gold gradient accent bar (`#b8860b → #ffd700`) at the top, gold gradient primary buttons, and outlined secondary buttons
- **"Add Your Art" button**: Gold-bordered outline button in the header
- **"Submission Guidelines" button**: Link in the upload modal that opens the Human Centric Gallery overlay

## SEO & Metadata
- **Meta description**: Present in `<head>` of `index.html` — also used for Open Graph and Twitter card tags
- **Open Graph image**: `static/images/og_share_image.png` (1200x630, logo + title on black background) — default for link previews on social media, iMessage, Discord, etc.
- **Per-artwork OG tags**: `/?art=<asset_id>` serves dynamic `og:title`, `og:image`, and `og:url` from the database. Artwork uses popup image; exhibits use tile image. Falls back to defaults when asset not found.
- **Favicon**: `static/favicon.ico` (multi-size: 16/32/48px), `static/apple-touch-icon.png` (180px), `static/icon-192.png`, `static/icon-512.png`
- **robots.txt**: Served at `/robots.txt` — allows crawling, blocks `/api/` and `/uploads/`
- **sitemap.xml**: Served at `/sitemap.xml` — single entry for homepage
- **Canonical URL**: `https://thelastgallery.com/`
