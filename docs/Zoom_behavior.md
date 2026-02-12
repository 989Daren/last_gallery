# Gallery Pinch-to-Zoom Behavior Specification


## Overview

This document defines the pinch-to-zoom interaction behavior for a gallery wrapper within a viewport. The system uses a **unified focal-point zoom model**: all zooming (in and out) anchors to the finger midpoint. Progressive edge clamping ensures content boundaries are never violated, gradually overriding focal-point anchoring during zoom-out to produce physically motivated drift rather than abrupt snaps.


---


## Core Invariant: No Visual Jumps

All transitions must be visually seamless. The user must never perceive a jarring snap or discontinuity.

- **Focal point updates:** Changing which content point is tracked (new two-finger touch) does not alter the current visual position — it only affects how the view evolves as scale changes. This is mathematically guaranteed (see Transform Model).
- **Edge clamping:** Applied as a continuous constraint every frame, not a triggered event. Clamping activates precisely as an edge reaches its boundary, so no positional correction is needed.
- **Direction reversal:** Seamless within a single gesture — the same focal-point math applies whether scale is increasing or decreasing.
- **Scroll ↔ transform handoff:** The scroll position at transition maps exactly to the initial transform state, and vice versa. Both transitions are atomic (single frame).


---


## Initial State

**Page Load:**
- Gallery wrapper zoom: `1.0x` (native scale)
- Scroll mode: **Native scroll** (gallery extends beyond viewport)
- User can pan/scroll to navigate the gallery


---


## Zoom Range

- **Maximum zoom (closest view):** `1.0x`
- **Minimum zoom (furthest view):** Dynamic — the scale at which 100% of gallery is visible within viewport with padding (e.g., 20px)
  - `min_scale = min((vw - 2*pad) / gallery_w, (vh - 2*pad) / gallery_h)`
  - At this scale, all four edges are visible and content is centered


---


## Transform Model

**Coordinate system:**
- `transform-origin: 0 0` (top-left; explicit translation handles all positioning)
- `transform: translate(tx, ty) scale(s)`

**Point mapping:**
A point `(x, y)` in content space maps to screen position:
```
screen_x = tx + s * x
screen_y = ty + s * y
```

**Per-frame focal-point anchoring:**

Each frame during a pinch gesture, the content point under the previous midpoint is kept at the current midpoint:

```
Given:  previous state (tx, ty, s), previous midpoint (pmx, pmy)
        current touch: new midpoint (mx, my), new scale s'

1. Content point to anchor:  cx = (pmx - tx) / s
                             cy = (pmy - ty) / s

2. Unclamped new position:   tx' = mx - s' * cx
                             ty' = my - s' * cy

3. Apply edge clamping to (tx', ty')
```

This naturally handles:
- **Pure zoom** (fingers stationary): content under fingers stays put
- **Pure pan** (fingers move, same distance apart): content follows finger movement
- **Simultaneous pan+zoom**: both combined smoothly
- **Direction reversal**: identical math, no mode switch

**Why new two-finger touches are seamless:**

When fingers lift and new fingers touch at `(mx', my')` at current `(tx, ty, s)`, the anchored content point becomes `cx' = (mx' - tx) / s`. Computing the transform from this new anchor at the same scale yields `tx' = mx' - s * cx' = mx' - (mx' - tx) = tx`. Position unchanged — only future scale changes are affected.


---


## Gesture Lifecycle

### Two-Finger Touch Down
1. If at `1.0x` native scroll: perform **scroll → transform handoff** (see below)
2. Record finger midpoint as previous midpoint
3. Record current pinch distance as reference
4. No visual change occurs

### Pinch (Each Frame)
1. Compute current finger midpoint `(mx, my)` and pinch distance
2. Compute new scale `s'` from distance ratio, clamp to `[min_scale, 1.0]`
3. Compute unclamped `(tx', ty')` from focal-point anchoring (see Transform Model)
4. Apply edge clamping
5. Render with `translate(tx', ty') scale(s')`
6. Store `(mx, my)` as previous midpoint for next frame

### Fingers Lift
1. Current `(tx, ty, s)` state is preserved
2. If `s = 1.0`: perform **transform → scroll handoff** (see below)
3. Otherwise: remain in transform mode, single-finger panning available

### Single-Finger Drag (Panning)
1. Adjust `tx`, `ty` by drag delta
2. Apply edge clamping constraints
3. Available whenever scaled content exceeds viewport in at least one axis


---


## Progressive Edge Clamping

**Principle:** Clamping preserves the boundary enforcement that native scrolling provides for free — you can never see past the content edges. The transform math must never allow content to drift past boundaries that scroll wouldn't allow.

Applied as a **continuous constraint every frame**, not a triggered event.

### When scaled content exceeds viewport (per axis):

```
Left edge:   tx ≤ padding
Right edge:  tx ≥ viewport_width - padding - s * gallery_width
Top edge:    ty ≤ padding
Bottom edge: ty ≥ viewport_height - padding - s * gallery_height
```

When content extends well beyond the viewport on both sides of an axis, both constraints are easily satisfied — they only become binding as zoom decreases and edges approach the viewport.

### When scaled content fits within viewport (per axis):

```
If s * gallery_width  ≤ viewport_width  - 2 * padding:  tx = (viewport_width  - s * gallery_width)  / 2
If s * gallery_height ≤ viewport_height - 2 * padding:  ty = (viewport_height - s * gallery_height) / 2
```

This transitions smoothly: as content shrinks to fit, both edge constraints converge toward the centering value simultaneously.

### Effect on Focal-Point Anchoring

Clamping and focal-point anchoring interact gracefully:

1. **No edges clamped:** Focal point stays perfectly anchored — content under fingers doesn't move
2. **Some edges clamped:** Focal point drifts in the clamped direction(s). The user can see the edge at the boundary, providing visual context for why content is shifting
3. **All edges clamped (max zoom-out):** Content fully centered, focal-point anchoring fully overridden

The drift is always gradual and physically motivated — never a sudden snap.

### Mixed-Axis Behavior

At intermediate zoom levels, one axis may fit within the viewport while the other doesn't. Each axis is handled independently:
- Fitted axis: centered (clamped to center position)
- Overflowing axis: edge-clamped but pannable


---


## Scroll ↔ Transform Handoff

### Entering Zoom (1.0x → transform mode)

Triggered on two-finger touch at `1.0x`:

1. Capture current scroll position: `(scrollX, scrollY)`
2. Disable native scroll (`overflow: hidden`)
3. Reset scroll to `(0, 0)`
4. Set initial transform: `translate(-scrollX, -scrollY) scale(1.0)`
5. **Steps 2–4 must execute atomically** (single frame, no intermediate render)

Visual result is identical — content appears at the same position.

### Exiting Zoom (transform mode → 1.0x)

Triggered when scale returns to `1.0` and fingers lift:

1. Compute scroll position from transform: `scrollX = -tx`, `scrollY = -ty`
2. Clear transform (reset to identity)
3. Set scroll position to `(scrollX, scrollY)`
4. Re-enable native scroll (restore `overflow`)
5. **Steps 2–4 must execute atomically** (single frame, no intermediate render)


---


## Zoom-Out Termination

- Scale cannot decrease below `min_scale`
- At `min_scale`: all four edges clamped, content centered in viewport
- Panning disabled (content fits entirely within viewport)
- Only zoom-in gesture is available


---


## Modal Awareness

Zoom gestures are disabled when any modal is open:
- Welcome modal
- Upload modal
- Admin modal
- Artwork popup


---


## Auto-Reset

Zoom resets to `1.0x` and transitions to native scroll after:
- Wall refresh (shuffle, clear, move, undo)
- Gallery view is re-centered after reset
