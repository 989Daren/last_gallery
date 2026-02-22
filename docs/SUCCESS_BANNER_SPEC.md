# Feature Spec: Post-Upload Success Banner & Unlock System

## Overview

After a user successfully uploads and saves metadata for their artwork, a success banner is displayed before the gallery highlight animation plays. The banner serves three purposes:

1. Confirm the artwork is live on the gallery wall
2. Inform the user their edit code has been emailed to them
3. Introduce the "Unlock" upgrade feature via a CTA

Additionally, a persistent unlock icon is added to the top of the page as a permanent entry point to the unlock/upgrade flow.

---

## Part 1: Unlock Icon (Top of Page) & Info Modal

### Purpose
A persistent unlock icon visible at the top of the gallery page at all times, serving as a discoverable entry point to learn about the Unlock upgrade feature. Always visible regardless of which artwork is being viewed or whether the user has uploaded anything.

### Icon — Placement
- Fixed position, top of page (top bar or header area)
- Visible at all times — not tied to any specific artwork or user state
- Should not interfere with existing UI elements

### Icon — Appearance
- Inline SVG lock-open icon (do not use an external icon library)
- Gold colored (`#ffd700`)
- Subtle gold drop-shadow/glow effect: `filter: drop-shadow(0 0 4px rgba(255,215,0,0.4))`
- Small but discoverable — not dominant in the UI

### Icon — Behavior
- Clicking/tapping opens the Unlock Info Modal (see below)

---

### Unlock Info Modal

#### Overall
- Dark theme consistent with gallery aesthetic (`#111` background, `#333` border)
- Rounded corners (`border-radius: 12px`)
- Centered overlay with semi-transparent dark backdrop
- Max width ~420px, responsive on mobile
- Box shadow for depth
- Dismissible via close button, backdrop click, or Escape key

#### Top Accent Bar
- Thin bar (4px) across full width
- Gold gradient: `linear-gradient(90deg, #b8860b, #ffd700, #b8860b)`

#### Section 1: Headline
- Gold lock-open SVG icon centered above headline
- Headline: "Unlock Your Artwork" in light gray
- Subtitle: "Take your submission to the next level." in muted gray

#### Section 2: Graphic Element (Reserved Slot)
- A reserved image slot for a custom graphic depicting a small tile morphing into a larger tile
- Image path: `static/images/unlock_graphic.png` (to be supplied separately)
- Use a styled placeholder for now: dashed-border box with centered muted text "[ unlock graphic ]"
- Image should be centered, max width 100%, with some vertical padding

#### Section 3: Benefits List
- Section label: "What you get" in small gold uppercase
- Two benefits, each with a gold checkmark or icon:
  - **Larger tile eligibility** — "Your creative work becomes eligible to be placed into larger tiles during our weekly random gallery shuffle. You will then be given the opportunity to upgrade your work to the larger tile, ensuring it will never drop back down in size, for the life of the gallery."
  - **Creator of the Month** — "You're entered into our monthly Creator of the Month drawing, where you and your creative work will be prominently featured on The Last Gallery website until the following month's drawing. Drawing winners will also receive a link to their work inside every email that goes out from The Last Gallery website — until the following month's drawing."

#### Section 4: CTA (Stripe — Not Yet Wired)
- A styled button: "Unlock My Artwork"
- Appearance: gold border, gold text, transparent background, hover state darkens slightly
- The button is a **visual placeholder only** — no Stripe integration
- Add a code comment: `// TODO: wire to Stripe checkout`

#### Footer
- "Maybe Later" close link — minimal styling, muted color, right-aligned or centered
- Dismisses modal on click

---

## Part 2: Post-Upload Success Banner

### Trigger
Fires after `saveMetaToDb()` completes successfully — replacing the current flow where modals close and `highlightNewTile()` fires after a 300ms delay.

### Updated Upload Sequence
1. Upload completes → metadata saved → modals close
2. **Scroll to new tile immediately** (tile is visible on wall, no sheen yet)
3. **Success banner appears** (overlaid on gallery)
4. User reads banner, optionally interacts with unlock CTA
5. User taps "View My Artwork →" → **banner dismisses** → highlight sheen plays on tile

> The highlight sheen must NOT play until the success banner is dismissed. The tile should already be scrolled into view before the banner appears so it is visible behind/beneath the banner.

### Visual Design

#### Overall
- Dark theme consistent with gallery aesthetic (`#111` background, `#333` borders)
- Rounded corners (`border-radius: 12px`)
- Centered overlay with semi-transparent backdrop
- Max width ~420px, responsive on mobile
- Box shadow for depth

#### Top Accent Bar
- Thin bar (4px) across full width of banner
- Gold gradient: `linear-gradient(90deg, #b8860b, #ffd700, #b8860b)`

#### Section 1: Headline
- Pulsing green dot (animated, `#4caf50`) + "Your artwork is live." in light gray
- Subtitle below in muted gray: "It's now on the gallery wall."

#### Section 2: Edit Code Notice
- Envelope icon + text:
  > "Your edit code has been sent to *[user's email address]*. Use it anytime to update your artwork's information."
- Email address rendered in gold italic
- Separated from headline by a subtle divider line

#### Section 3: Unlock CTA (bottom)
- Slightly darker background (`#0d0d0d`) to visually separate from main content
- Separated from above by a divider line
- Gold glow unlock icon (SVG lock-open) on the left
- "NEXT STEP" label in small gold uppercase (`#ffd700`)
- Body text:
  > "Unlock your creative work to qualify for larger tiles and other benefits. Tap the unlock icon at the top of the page to learn more."
- "Other benefits" includes entry into a monthly "Creator of the Month" drawing
- "unlock icon" styled as a subtle inline reference (not a hyperlink — directs user to the persistent page icon)

#### Footer
- "View My Artwork →" button, right-aligned
- Minimal styling: transparent background, subtle border, muted color
- On click: dismisses banner → triggers highlight sheen animation on tile

---

## Part 3: Unlock Status Indicator (Metadata Ribbon)

### Purpose
When artwork has been marked as "Unlocked" in the database, a gold unlock icon appears in the bottom-right corner of the metadata ribbon popup. This serves as a visible status symbol for upgraded artwork.

### Appearance
- Small gold lock-open SVG icon
- Bottom-right corner of the ribbon
- Subtle gold glow
- Only visible on artwork where `unlocked = true`
- Not shown on locked/basic artwork — no negative labeling for non-upgraded submissions

### Behavior
- Clickable — opens the same Unlock Info Modal described in Part 1
- Does not link directly to Stripe (that path is via the top-of-page icon only)

---

## Part 4: Database Changes

### Migration v4
Add `unlocked` column to the `assets` table:

```sql
ALTER TABLE assets ADD COLUMN unlocked INTEGER NOT NULL DEFAULT 0;
```

- `0` = basic/locked (default for all new uploads)
- `1` = unlocked (eligible for larger tile shuffles)
- Update `SCHEMA_VERSION` in `db.py` to `4`
- Add migration logic to `db.py` versioned migration system

### API Changes
- Include `unlocked` field in `/api/wall_state` response
- Include `unlocked` field in `/api/tile/<tile_id>/metadata` GET response
- Admin endpoint to toggle unlock status (requires admin PIN):
  - `POST /api/admin/set_unlocked` with body `{ tile_id, unlocked: true/false }`

---

## Part 5: Shuffle Eligibility

When `unlocked = true`, the artwork becomes eligible to be assigned to any tile size during shuffle (XS, S, M, L, XL).

When `unlocked = false` (default), the artwork is restricted to XS tiles only during shuffle operations.

The shuffle logic in `app.py` must be updated to respect the `unlocked` flag when redistributing assets across tile sizes.

---

## Part 6: JavaScript Changes

### `upload_modal.js`
- After `saveMetaToDb()` succeeds:
  1. Close modals
  2. Call scroll-to-tile without sheen (extracted from `highlightNewTile()`)
  3. Show success banner, passing user's email address and tile ID
  4. On banner dismiss, call sheen-only function

### `main.js`
- Split `highlightNewTile(tileId)` into two functions:
  - `scrollToTile(tileId)` — resets zoom, scrolls viewport to center tile, no sheen
  - `playTileSheen(tileId)` — applies `.tile-highlight-sheen` class and manages `animationend` cleanup
- `highlightNewTile()` can remain as a combined convenience call for any non-upload contexts

### Success Banner
- Can live in `upload_modal.js` or a new `success_banner.js` file
- Renders banner as a DOM overlay with semi-transparent backdrop
- Accepts: `{ email, tileId }`
- On dismiss: calls `playTileSheen(tileId)`, removes banner from DOM

### Unlock Info Modal
- Can live in a new `unlock_modal.js` file
- Shared between the top-of-page icon click and the ribbon unlock indicator click
- Renders modal as a DOM overlay
- Dismissible via close button, backdrop click, or Escape key

---

## Notes
- No user authentication exists — unlock status is admin-controlled after payment confirmation out-of-band
- Undo history is in-memory; unlocked status persists in database and is unaffected by undo operations
- The persistent top-of-page unlock icon should be present in `index.html` and styled in `styles.css`
- Use inline SVG for the lock-open icon (Lucide icons are not currently used in the vanilla JS frontend)
- The success banner email field should display the actual email address submitted during upload
- Stripe integration is out of scope for this spec — the "Unlock My Artwork" button is a styled placeholder only
