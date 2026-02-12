# Pinch-to-Zoom System — Complete Technical Reference

## Purpose

This document exhaustively describes how the pinch-to-zoom feature works in The Last Gallery. It is written so that an AI or developer can understand every variable, function, file, DOM element, CSS rule, and interaction involved — without reading the source code.

---

## Files Involved

| File | Role |
|------|------|
| `static/js/main.js` | All zoom logic: state object, gesture handlers, transform math, scroll locking, reset, initialization, back-button integration |
| `static/css/styles.css` | `.gallery-wall-wrapper`, `.zoom-wrapper`, `.gallery-wall`, `.is-pinching` — structural and GPU-hint styles |
| `templates/index.html` | HTML structure: the three nested containers that make zoom work |

No other files contain zoom code. `admin.js` and `upload_modal.js` trigger `resetZoom()` indirectly via `refreshWallFromServer()`.

---

## HTML Structure

```
.gallery-wall-wrapper          ← scroll container (overflow-x: auto)
  └── .zoom-wrapper            ← receives CSS transform (translate + scale)
       └── #galleryWall        ← actual tile grid (position: relative, sized in px)
```

**Why three layers?**

1. `.gallery-wall-wrapper` owns native scroll. At `scale=1`, horizontal scroll is handled natively here. When zoomed out, its overflow is locked to `hidden` so native scroll doesn't fight the transform.
2. `.zoom-wrapper` receives `transform: translate(tx, ty) scale(s)` with `transform-origin: 0 0`. This is the only element that gets a transform during zoom. Using origin `0 0` means translation values directly control where the top-left corner of the scaled grid appears.
3. `#galleryWall` is the content — tiles are absolutely positioned children. Its `scrollWidth` and `scrollHeight` are the "wall dimensions" cached in `zoomState`.

---

## The `zoomState` Object

Defined at module scope in `main.js` (line ~170). This is the single source of truth for all zoom state.

```javascript
const zoomState = {
  // === Scale ===
  scale: 1.0,          // Current zoom level. 1.0 = normal, <1 = zoomed out
  minScale: 0.3,       // Floor — recalculated dynamically (see below)
  maxScale: 1.0,       // Ceiling — always 1.0 (no zoom-in beyond native)

  // === Gesture tracking ===
  isPinching: false,    // true while 2 fingers are down
  isPanning: false,     // true while 1 finger is down AND scale < 1
  initialDistance: 0,   // Pixel distance between 2 fingers at pinch start
  initialScale: 1.0,   // Scale value at the moment pinch started

  // === Wall dimensions (cached once on init) ===
  wallWidth: 0,         // #galleryWall.scrollWidth at boot
  wallHeight: 0,        // #galleryWall.scrollHeight at boot

  // === Pan offset (pixel displacement from centered position) ===
  panX: 0,              // Current horizontal pan offset
  panY: 0,              // Current vertical pan offset
  initialPanX: 0,       // panX at start of current drag gesture
  initialPanY: 0,       // panY at start of current drag gesture
  panStartX: 0,         // clientX of finger at drag start
  panStartY: 0,         // clientY of finger at drag start
  edgePadding: 20,      // Minimum px gap between grid edge and viewport edge

  initialized: false    // Guard against double-init
};
```

### Key threshold: `0.999`

Throughout the code, `scale < 0.999` is used instead of `scale < 1` to avoid floating-point issues. This means:
- `scale >= 0.999` → treated as "not zoomed" → native scroll mode
- `scale < 0.999` → treated as "zoomed out" → transform mode with locked scroll

### `minScale` — dynamic calculation

`minScale` is recalculated by `recalculateZoomLimits()` on init, window resize, and orientation change:

```javascript
zoomState.minScale = Math.min(viewportWidth / zoomState.wallWidth, 1.0);
```

This ensures that at maximum zoom-out, the grid fits the viewport width **exactly** (edge-to-edge, no horizontal padding). If the viewport is wider than the wall, `minScale` caps at `1.0`.

---

## Initialization — `initZoom()`

**Called from:** The boot sequence, inside `requestAnimationFrame` after wall render completes:

```javascript
// main.js boot() → end of try block (~line 1494)
requestAnimationFrame(() => {
  centerGalleryView();
  initZoom();
});
```

**What it does:**
1. Guards against double-init (`zoomState.initialized`)
2. Queries all three DOM containers; aborts if any missing
3. Caches wall dimensions: `zoomState.wallWidth = wall.scrollWidth`
4. Calls `recalculateZoomLimits()` to set initial `minScale`
5. Attaches touch event listeners to `.gallery-wall-wrapper`:
   - `touchstart` → `handleZoomTouchStart` (passive: false — must call `preventDefault`)
   - `touchmove` → `handleZoomTouchMove` (passive: false)
   - `touchend` → `handleZoomTouchEnd`
   - `touchcancel` → `handleZoomTouchEnd`
6. Attaches `resize` → `recalculateZoomLimits` and `orientationchange` → delayed recalc

**Exposed globally:** `window.initZoom = initZoom`

---

## Initial Gallery Position — Centered at 50%, 50%

Before zoom is initialized, the gallery view is centered using `centerGalleryView()`:

```javascript
function getCenterScrollPosition() {
  const wrapper = document.querySelector('.gallery-wall-wrapper');
  const scrollX = wrapper ? (wrapper.scrollWidth - wrapper.clientWidth) / 2 : 0;
  const scrollY = Math.max(0, (document.body.scrollHeight - window.innerHeight) / 2);
  return { scrollX, scrollY };
}

function centerGalleryView() {
  const wrapper = document.querySelector('.gallery-wall-wrapper');
  if (!wrapper) return;
  const { scrollX, scrollY } = getCenterScrollPosition();
  wrapper.scrollLeft = scrollX;
  window.scrollTo(0, scrollY);
}
```

**How centering works:**
- **Horizontal (X):** Sets `.gallery-wall-wrapper.scrollLeft` to `(scrollWidth - clientWidth) / 2`. This is the wrapper's own horizontal scroll — it puts the grid's horizontal midpoint at the viewport center.
- **Vertical (Y):** Sets `window.scrollTo(0, (body.scrollHeight - window.innerHeight) / 2)`. This is the page's native vertical scroll — it puts the grid's vertical midpoint at the viewport center.

This means "50%, 50%" refers to **scroll position at the midpoint of available scroll range**, not a CSS transform. The grid content is wider and taller than the viewport, and we scroll to the center of that content.

`getCenterScrollPosition()` is a reusable helper also called by `applyZoomTransform()` and `resetZoom()` when returning to scale=1.

---

## Gesture Handling

### `isZoomDisabled()` — Modal awareness gate

Before any gesture is processed, this function checks if zoom should be blocked:

```javascript
function isZoomDisabled() {
  // Welcome modal open?
  // Artwork popup open?
  // Upload modal open? (checks .is-open class)
  // Admin modal open? (checks not .hidden class)
  return true/false;
}
```

If **any** modal is open, all touch events are ignored by the zoom system. This prevents accidental zooming while interacting with overlays.

### `handleZoomTouchStart(e)`

| Condition | Action |
|-----------|--------|
| `e.touches.length === 2` | Start pinch: record initial finger distance and scale, set `isPinching = true`, add `.is-pinching` class to wrapper |
| `e.touches.length === 1 && scale < 0.999` | Start pan: record finger position and current pan offsets, set `isPanning = true` |
| `e.touches.length === 1 && scale >= 0.999` | Do nothing — native scroll handles single-finger at full scale |

### `handleZoomTouchMove(e)`

| Condition | Action |
|-----------|--------|
| `isPinching && 2 fingers` | Calculate `scaleChange = currentDistance / initialDistance`. New scale = `initialScale * scaleChange`, clamped to `[minScale, maxScale]`. Resets pan to 0,0. Calls `applyZoomTransform()`. |
| `isPanning && 1 finger && scale < 0.999` | Calculate pan delta from finger movement. `panX = initialPanX + (currentX - startX)`. Calls `applyZoomTransform()`. |

**Important:** During a pinch, pan is always reset to `(0, 0)`. This means pinching always re-centers the grid. Panning is only available via single-finger drag after the pinch ends.

### `handleZoomTouchEnd(e)`

1. If was pinching: remove `.is-pinching` class. **Snap-back:** if `scale > 0.95`, automatically calls `resetZoom()` — this prevents the user from being "almost zoomed in" and creates a clean snap to 1.0.
2. Clears `isPinching` and `isPanning` flags.
3. If still zoomed out (`scale < 0.999`): pushes hash via `ConicalNav.pushToMatchUi()` to enable back-button zoom reset.

### `getTouchDistance(touches)`

Euclidean distance between two touch points:
```javascript
Math.sqrt((x1-x2)² + (y1-y2)²)
```

---

## The Transform — `applyZoomTransform()`

This is the core rendering function. It computes the CSS `transform` string applied to `.zoom-wrapper`.

### Step-by-step:

#### 1. Read layout values
```javascript
const headerHeight = parseInt(getComputedStyle(root).getPropertyValue('--header-height')) || 0;
const viewportWidth = wrapper.clientWidth;
const viewportHeight = window.innerHeight - headerHeight;
const scaledWidth = zoomState.wallWidth * zoomState.scale;
const scaledHeight = zoomState.wallHeight * zoomState.scale;
const padding = zoomState.edgePadding;  // 20px
```

`--header-height` is a CSS custom property dynamically set by JS on load/resize to the actual pixel height of the fixed header. The header is subtracted from viewport height so the grid centers in the **visible area below the header**.

#### 2. At scale >= 0.999 → exit to native scroll
```javascript
if (zoomState.scale >= 0.999) {
  zoomWrapper.style.transform = '';       // Remove transform entirely
  zoomState.panX = 0;
  zoomState.panY = 0;
  const { scrollX, scrollY } = getCenterScrollPosition();
  unlockScrollTo(scrollX, scrollY);       // Atomic: restore scroll + position
  return;
}
```

When returning to full scale, the transform is **removed entirely** (not set to `scale(1)`). This ensures zero visual artifacts from subpixel rounding. Scroll is unlocked and set to the centered position atomically.

#### 3. Lock scroll
```javascript
lockScroll();
```

At any scale < 1, native scrolling is disabled on wrapper, body, and documentElement.

#### 4. Calculate base translation (centering)
```javascript
let baseTx = (viewportWidth - scaledWidth) / 2;
let baseTy = (viewportHeight - scaledHeight) / 2;
```

This positions the scaled grid in the center of the visible viewport. If the scaled grid is smaller than the viewport, `baseTx`/`baseTy` are positive (grid floats in the middle). If larger, they're negative (grid extends beyond viewport edges).

#### 5. X-axis pan clamping

```javascript
if (scaledWidth <= viewportWidth + 5) {
  // Grid fits horizontally → no pan allowed, lock to center
  clampedPanX = 0;
  // Edge-to-edge: if within 5px of exact fit, remove centering offset
  if (Math.abs(scaledWidth - viewportWidth) < 5) baseTx = 0;
} else {
  // Grid wider than viewport → allow bounded pan
  const minPanX = viewportWidth - scaledWidth - baseTx - padding;
  const maxPanX = -baseTx + padding;
  clampedPanX = Math.max(minPanX, Math.min(maxPanX, clampedPanX));
}
```

**Edge-to-edge behavior at minScale:** When the grid exactly fits the viewport width (which is the definition of `minScale`), the `< 5px` tolerance catches it and sets `baseTx = 0`, eliminating any sub-pixel centering gap. The grid sits flush against both viewport edges.

**The 20px edge padding:** When the scaled grid is larger than the viewport (intermediate zoom levels), the user can pan, but the grid edge can never be more than 20px from the viewport edge. This prevents the user from panning the grid entirely off-screen.

#### 6. Y-axis pan clamping

```javascript
if (scaledHeight + 2 * padding <= viewportHeight) {
  // Grid fits vertically with padding → center, no pan
  clampedPanY = 0;
} else {
  // Grid taller than viewport → allow bounded pan
  const minPanY = viewportHeight - scaledHeight - baseTy - padding;
  const maxPanY = -baseTy + padding;
  clampedPanY = Math.max(minPanY, Math.min(maxPanY, clampedPanY));
}
```

The Y-axis uses the same pattern but with `2 * padding` in the "fits" check — this ensures the grid has at least 20px above and below before panning is allowed.

#### 7. Apply transform

```javascript
zoomWrapper.style.transform =
  `translate(${baseTx + clampedPanX}px, ${baseTy + clampedPanY}px) scale(${zoomState.scale})`;
```

The final transform is: **translate first, then scale.** Because `transform-origin` is `0 0`, the translate positions the top-left corner, then scale expands from that corner. The base translation centers the grid; the clamped pan offsets it from center within allowed bounds.

---

## Scroll Locking & Unlocking

### `lockScroll()`

Called when entering zoomed state (`scale < 1`):

```javascript
function lockScroll() {
  if (scrollLocked) return;              // Idempotent guard
  window.scrollTo(0, 0);                // Zero out page scroll
  wrapper.scrollLeft = 0;               // Zero out horizontal scroll
  wrapper.style.overflow = 'hidden';    // Disable wrapper scroll
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  scrollLocked = true;
}
```

**Why zero scroll?** When zoomed out, the `.zoom-wrapper` transform handles all positioning. Any residual scroll offset would stack with the transform and cause misalignment. Zeroing ensures the transform has complete control.

### `unlockScrollTo(scrollX, scrollY)` — Atomic unlock

Called when returning to `scale=1`:

```javascript
function unlockScrollTo(scrollX, scrollY) {
  wrapper.style.overflowX = 'auto';     // Restore horizontal scroll
  wrapper.style.overflowY = 'visible';  // Restore vertical overflow
  wrapper.scrollLeft = scrollX;          // Set position BEFORE it becomes scrollable
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
  window.scrollTo(0, scrollY);
  scrollLocked = false;
}
```

**Why atomic?** The previous implementation (`unlockScroll()`) restored overflow first, then positioned scroll in a separate `requestAnimationFrame`. This caused a 1-2 frame flash at position `(0, 0)` before the scroll jumped to center. The atomic version sets the scroll position **in the same synchronous block** as the overflow restore, so the browser never paints an intermediate state.

**Why does it require a position argument?** API design choice — you can't call `unlockScrollTo` without specifying where scroll should go. This eliminates the temporal coupling bug where unlock and positioning were separate operations.

### `scrollLocked` flag

Module-level boolean. Prevents `lockScroll()` from being called multiple times (which would zero scroll repeatedly during each `applyZoomTransform` call).

---

## Reset — `resetZoom(silent)`

Returns to full scale and re-centers the gallery:

```javascript
function resetZoom(silent) {
  const wasZoomed = zoomState.scale < 0.999;
  zoomState.scale = 1.0;
  zoomState.panX = 0;
  zoomState.panY = 0;
  zoomWrapper.style.transform = '';      // Remove transform entirely

  // Atomic unlock + center
  const { scrollX, scrollY } = getCenterScrollPosition();
  unlockScrollTo(scrollX, scrollY);

  // Pop history when reset programmatically (not from back button)
  if (!silent && wasZoomed) {
    ConicalNav.popFromUiClose();
  }
}
```

**The `silent` parameter:**
- `silent = false` (default): Called from user action (e.g., pinch snap-back). Pops browser history via `history.back()`.
- `silent = true`: Called from `ConicalNav.syncUiToHash()` when the user pressed the browser back button. The hash has already changed — calling `history.back()` again would over-pop.

**Exposed globally:** `window.resetZoom = resetZoom`

**Called from:**
1. `handleZoomTouchEnd()` — when pinch ends at `scale > 0.95` (snap-back)
2. `refreshWallFromServer()` — after shuffle/clear/move/undo (always resets to 1.0x)
3. `ConicalNav.syncUiToHash()` — when back button pops the `#zoom` hash (silent=true)

---

## Back Button Integration — ConicalNav

Zoom is integrated with the browser back button via the `ConicalNav` hash-based navigation system.

### Hash encoding

Zoom state is encoded as `#zoom` in the URL hash. It can combine with other layers:
- `#zoom` — zoomed out, no popup
- `#zoom/art` — zoomed out with artwork popup open
- `#zoom/art/ribbon` — zoomed out with popup and ribbon

### How it works

1. **On zoom out** (`handleZoomTouchEnd`): If `scale < 0.999`, calls `ConicalNav.pushToMatchUi()` which pushes `#zoom` (or compound hash) to `location.hash`, creating a browser history entry.
2. **On back button press**: Browser fires `hashchange`. `ConicalNav.syncUiToHash()` checks if `zoom` is still in the hash. If not, calls `resetZoom(true)` — the `true` (silent) prevents a double `history.back()`.
3. **On programmatic reset** (snap-back, wall refresh): `resetZoom(false)` calls `ConicalNav.popFromUiClose()` which calls `history.back()` and sets `ignoreNextHashChange = true` to prevent the resulting hashchange from re-triggering `syncUiToHash`.

### `ConicalNav.isZoomedOut()`

```javascript
isZoomedOut() {
  return typeof zoomState !== "undefined" && zoomState.scale < 0.999;
}
```

This is how ConicalNav checks zoom state when building the desired hash.

---

## CSS Rules

### `.gallery-wall-wrapper`
```css
.gallery-wall-wrapper {
  width: 100%;
  max-width: 100%;
  padding-top: var(--header-height);  /* Offset below fixed header */
  overflow-x: auto;                   /* Native horizontal scroll at scale=1 */
  overflow-y: visible;
  box-sizing: border-box;
  background: var(--wall-bg);         /* #000 */
}
```
JS overrides `overflow` to `hidden` when zoomed out (via `lockScroll()`), then restores to `auto`/`visible` on unlock.

### `.gallery-wall-wrapper.is-pinching`
```css
.gallery-wall-wrapper.is-pinching {
  -webkit-user-select: none;
  user-select: none;
  touch-action: none;   /* Prevents browser default gestures during pinch */
}
```
Added on `touchstart` (2 fingers), removed on `touchend`. Prevents text selection and browser-level pinch-zoom from interfering.

### `.zoom-wrapper`
```css
.zoom-wrapper {
  transform-origin: 0 0;           /* Scale from top-left corner */
  will-change: transform;          /* GPU compositing hint */
}
```
No explicit sizing — it wraps `#galleryWall` and inherits its dimensions. The `transform-origin: 0 0` is critical — it means `translate(x, y) scale(s)` places the scaled grid's top-left at `(x, y)` in the wrapper's coordinate space.

### `--header-height`
```css
:root {
  --header-height: 0px;   /* Overridden by JS */
}
```
Set dynamically by `setHeaderOffset()` on `DOMContentLoaded` and `resize`:
```javascript
const height = header.offsetHeight;
document.documentElement.style.setProperty('--header-height', `${height}px`);
```
Used by both CSS (`padding-top` on wrapper) and JS (`applyZoomTransform` viewport calculation).

---

## Pinch-to-Zoom Hint Animation

After the welcome modal dismisses, a brief animation teaches touch users about zoom.

### Trigger
`showPinchHint()` is called with a 300ms delay from the welcome modal's `close()` function:
```javascript
const close = () => {
  overlay.classList.add("hidden");
  document.body.style.overflow = "";
  setTimeout(showPinchHint, 300);
};
```

### Gate
```javascript
if (!window.matchMedia('(pointer: coarse)').matches) return;
```
Only runs on touch devices. Desktop users never see it.

### DOM
Creates and appends to `<body>`:
```html
<div class="pinch-hint">
  <div class="pinch-hint-dot pinch-hint-dot--left"></div>
  <div class="pinch-hint-dot pinch-hint-dot--right"></div>
</div>
```

### CSS
- `.pinch-hint`: Fixed fullscreen overlay, `z-index: 1000` (below welcome modal's max z-index, above gallery), `pointer-events: none` (user can pinch through it)
- `.pinch-hint-dot`: 48px white semi-transparent circles
- Dots animate toward each other: `translate(±60px, 0)` → `translate(±15px, 0)`, 1s ease-in-out, 2 iterations
- Container fades: 0→1 (first 10%), holds, 1→0 (last 20%), total 2s

### Cleanup
```javascript
hint.addEventListener('animationend', () => hint.remove());
```
DOM element self-removes after animation completes.

### Welcome modal bullet
```html
<li class="touch-only">Pinch to zoom out</li>
```
```css
.touch-only { display: none; }
@media (pointer: coarse) { .touch-only { display: list-item; } }
```

---

## Complete Function Reference

| Function | Location | Purpose |
|----------|----------|---------|
| `initZoom()` | main.js:198 | One-time setup: cache dimensions, attach touch listeners |
| `recalculateZoomLimits()` | main.js:222 | Recompute `minScale` from viewport/wall width ratio |
| `isZoomDisabled()` | main.js:235 | Returns true if any modal is open |
| `getTouchDistance(touches)` | main.js:246 | Euclidean distance between two touch points |
| `handleZoomTouchStart(e)` | main.js:252 | Detect pinch (2 fingers) or pan (1 finger when zoomed) |
| `handleZoomTouchMove(e)` | main.js:272 | Update scale (pinch) or pan offset (drag), call `applyZoomTransform()` |
| `handleZoomTouchEnd(e)` | main.js:291 | Snap-back if near 1.0, push ConicalNav hash if zoomed |
| `applyZoomTransform()` | main.js:308 | Core: compute and apply CSS transform with clamped pan bounds |
| `lockScroll()` | main.js:365 | Disable native scroll (body + wrapper + documentElement) |
| `unlockScrollTo(x, y)` | main.js:380 | Atomically restore scroll + set position (no flash) |
| `resetZoom(silent)` | main.js:393 | Return to scale=1, clear transform, center gallery |
| `getCenterScrollPosition()` | main.js:43 | Calculate scroll values to center gallery in viewport |
| `centerGalleryView()` | main.js:50 | Apply centered scroll position (used at boot) |
| `showPinchHint()` | main.js:63 | Show ghost-finger pinch animation (touch only) |

---

## State Diagram

```
                    ┌─────────────────┐
                    │   scale = 1.0   │
                    │  (Native Scroll) │
                    │  Gallery centered │
                    │  at 50%, 50%     │
                    └───────┬─────────┘
                            │
                    2-finger pinch out
                            │
                            ▼
                    ┌─────────────────┐
                    │  scale < 0.999  │
                    │  (Transform Mode)│
                    │  Scroll locked   │
                    │  Hash: #zoom     │
                    └───────┬─────────┘
                           ╱│╲
                          ╱ │ ╲
                         ╱  │  ╲
              continue  ╱   │   ╲  pinch back
              pinching ╱    │    ╲ (scale > 0.95)
                      ╱     │     ╲
                     ╱      │      ╲
                    ▼       │       ▼
              scale changes │   resetZoom() → scale=1
              panX/Y = 0   │   transform removed
                            │   scroll unlocked + centered
                     1-finger drag
                     (when zoomed)
                            │
                            ▼
                    pan offset changes
                    clamped to bounds
                    (edgePadding: 20px)
```

---

## Edge Cases & Design Decisions

1. **Snap-back threshold (0.95):** If the user pinches back to 95%+ scale, `handleZoomTouchEnd` auto-resets to 1.0. This prevents being "almost zoomed in" — it's either zoomed out or fully normal.

2. **Pinch resets pan:** During a pinch gesture, `panX` and `panY` are always set to 0. The grid re-centers on every pinch. Panning is only available via single-finger drag after pinch ends.

3. **5px tolerance on edge-to-edge:** `Math.abs(scaledWidth - viewportWidth) < 5` catches floating-point near-misses when at `minScale`. Without this, a sub-pixel gap could appear at the viewport edge.

4. **No zoom-in beyond 1.0:** `maxScale` is hard-coded to `1.0`. The zoom system only zooms **out** — it lets you see the whole gallery from above. At scale=1, native scroll takes over.

5. **Wall refresh resets zoom:** After shuffle, clear, move, or undo, `refreshWallFromServer()` calls `resetZoom()`. This ensures the user sees the refreshed content at normal scale.

6. **Orientation change:** `recalculateZoomLimits()` is called on orientation change with a 100ms delay (to let the browser settle layout), keeping `minScale` correct after rotation.

7. **`pointer-events: none` on pinch hint:** The hint animation overlay doesn't capture touches. If the user starts pinching while the hint is playing, the zoom system receives the events immediately.
