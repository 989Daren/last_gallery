# Focal-Point Zoom Implementation Guide

## Overview

This document provides complete instructions for converting the existing center-pivot pinch-to-zoom system in The Last Gallery to a **focal-point zoom** system. In focal-point zoom, the point between the user's fingers becomes the zoom anchor — the content under their fingers stays stationary while the rest of the grid scales around it.

**Target file:** `static/js/main.js`

**Scope:** Modify pinch gesture handling only. Single-finger pan, snap-back, scroll locking, and all other zoom behaviors remain unchanged.

---

## Current Behavior (Problem)

When a user pinches to zoom:
1. Scale changes, but `panX` and `panY` are reset to `0, 0`
2. The grid re-centers in the viewport on every pinch
3. The content under the user's fingers moves away from their fingers
4. To reach a specific tile, users must: zoom → release → pan → repeat

**The problematic code** (in `handleZoomTouchMove`):
```javascript
// Current: pan resets on every pinch frame
zoomState.panX = 0;
zoomState.panY = 0;
```

---

## Desired Behavior (Solution)

When a user pinches to zoom:
1. Calculate the **focal point** (midpoint between two fingers)
2. Determine what **wall-space coordinate** is under that focal point
3. After scale changes, calculate new `panX`/`panY` such that the **same wall-space coordinate remains under the focal point**
4. The tile under the user's fingers stays put; surrounding content scales toward/away from it

This matches iOS Photos, Google Maps, and all native pinch-zoom implementations.

---

## Mathematical Foundation

### Coordinate Spaces

1. **Screen space**: Pixel coordinates relative to viewport (0,0 at top-left of browser window)
2. **Wrapper space**: Pixel coordinates relative to `.gallery-wall-wrapper` (accounts for header offset and element position)
3. **Wall space**: Pixel coordinates on the unscaled `#galleryWall` content (0,0 at top-left of the full gallery grid)

### The Transform Model

The current transform applied to `.zoom-wrapper` is:
```javascript
transform: translate(tx, ty) scale(s)
```

Where:
- `tx = baseTx + panX` (horizontal: centering offset + user pan)
- `ty = baseTy + panY` (vertical: centering offset + user pan)
- `s = zoomState.scale`

With `transform-origin: 0 0`, this means:
- The wall's top-left corner is placed at `(tx, ty)` in wrapper space
- Then the wall is scaled by `s` from that corner

### Converting Screen Point to Wall Space

Given a screen point `(screenX, screenY)` and current transform state:

```javascript
// Step 1: Get wrapper-relative coordinates
const wrapperRect = wrapper.getBoundingClientRect();
const wrapperX = screenX - wrapperRect.left;
const wrapperY = screenY - wrapperRect.top;

// Step 2: Subtract current translation to get scaled-wall-space
const scaledWallX = wrapperX - tx;  // tx = baseTx + panX
const scaledWallY = wrapperY - ty;  // ty = baseTy + panY

// Step 3: Divide by scale to get unscaled wall-space
const wallX = scaledWallX / scale;
const wallY = scaledWallY / scale;
```

### The Focal-Point Constraint

**Goal:** After scale changes from `oldScale` to `newScale`, the wall-space point `(wallX, wallY)` must remain at the same screen position `(screenX, screenY)`.

**Derivation:**

Before scale change, the wall point appears at screen position:
```
screenX = wrapperRect.left + baseTx + panX + (wallX * oldScale)
```

After scale change, we want:
```
screenX = wrapperRect.left + baseTx + newPanX + (wallX * newScale)
```

Solving for `newPanX`:
```
newPanX = screenX - wrapperRect.left - baseTx - (wallX * newScale)
```

Or, more directly using the wrapper-relative focal point:
```
newPanX = wrapperX - baseTx - (wallX * newScale)
```

Where `wrapperX` is the focal point's X coordinate relative to the wrapper.

**Simplified formula using old values:**
```javascript
// focalWrapperX = position of focal point relative to wrapper
// wallX = the wall-space X coordinate under the focal point

newPanX = focalWrapperX - baseTx - (wallX * newScale);
newPanY = focalWrapperY - baseTy - (wallY * newScale);
```

---

## Implementation Steps

### Step 1: Add Focal Point State to `zoomState`

Add these properties to the `zoomState` object (around line 170 in `main.js`):

```javascript
const zoomState = {
  // ... existing properties ...
  
  // === Focal point tracking (NEW) ===
  focalWallX: 0,        // Wall-space X coordinate under pinch midpoint
  focalWallY: 0,        // Wall-space Y coordinate under pinch midpoint
  focalWrapperX: 0,     // Wrapper-relative X of pinch midpoint (updated each frame)
  focalWrapperY: 0,     // Wrapper-relative Y of pinch midpoint (updated each frame)
};
```

### Step 2: Create Helper Function — `screenToWallCoords()`

Add this new function near the other zoom helper functions:

```javascript
/**
 * Convert screen coordinates to wall-space coordinates.
 * Wall-space is the coordinate system of the unscaled #galleryWall content.
 * 
 * @param {number} screenX - X coordinate in screen/client space
 * @param {number} screenY - Y coordinate in screen/client space
 * @returns {{wallX: number, wallY: number, wrapperX: number, wrapperY: number}}
 */
function screenToWallCoords(screenX, screenY) {
  const wrapper = document.querySelector('.gallery-wall-wrapper');
  const wrapperRect = wrapper.getBoundingClientRect();
  const root = document.documentElement;
  const headerHeight = parseInt(getComputedStyle(root).getPropertyValue('--header-height')) || 0;
  
  // Position relative to wrapper element
  const wrapperX = screenX - wrapperRect.left;
  const wrapperY = screenY - wrapperRect.top;
  
  // Calculate current base translation (same logic as applyZoomTransform)
  const viewportWidth = wrapper.clientWidth;
  const viewportHeight = window.innerHeight - headerHeight;
  const scaledWidth = zoomState.wallWidth * zoomState.scale;
  const scaledHeight = zoomState.wallHeight * zoomState.scale;
  
  let baseTx = (viewportWidth - scaledWidth) / 2;
  let baseTy = (viewportHeight - scaledHeight) / 2;
  
  // Apply edge-to-edge correction (matches applyZoomTransform logic)
  if (scaledWidth <= viewportWidth + 5) {
    if (Math.abs(scaledWidth - viewportWidth) < 5) baseTx = 0;
  }
  
  // Current total translation
  const tx = baseTx + zoomState.panX;
  const ty = baseTy + zoomState.panY;
  
  // Convert to wall space
  const wallX = (wrapperX - tx) / zoomState.scale;
  const wallY = (wrapperY - ty) / zoomState.scale;
  
  return { wallX, wallY, wrapperX, wrapperY };
}
```

### Step 3: Create Helper Function — `getPinchMidpoint()`

Add this helper to calculate the midpoint between two touch points:

```javascript
/**
 * Calculate the midpoint between two touch points in screen coordinates.
 * 
 * @param {TouchList} touches - The touches from a touch event (must have length >= 2)
 * @returns {{x: number, y: number}}
 */
function getPinchMidpoint(touches) {
  const touch1 = touches[0];
  const touch2 = touches[1];
  return {
    x: (touch1.clientX + touch2.clientX) / 2,
    y: (touch1.clientY + touch2.clientY) / 2
  };
}
```

### Step 4: Modify `handleZoomTouchStart()`

Update the pinch start handler to capture the initial focal point in wall-space:

**Find this section** (when `e.touches.length === 2`):
```javascript
// CURRENT CODE:
if (e.touches.length === 2) {
  zoomState.isPinching = true;
  zoomState.initialDistance = getTouchDistance(e.touches);
  zoomState.initialScale = zoomState.scale;
  wrapper.classList.add('is-pinching');
}
```

**Replace with:**
```javascript
if (e.touches.length === 2) {
  zoomState.isPinching = true;
  zoomState.initialDistance = getTouchDistance(e.touches);
  zoomState.initialScale = zoomState.scale;
  wrapper.classList.add('is-pinching');
  
  // NEW: Capture focal point in wall-space at pinch start
  const midpoint = getPinchMidpoint(e.touches);
  const coords = screenToWallCoords(midpoint.x, midpoint.y);
  zoomState.focalWallX = coords.wallX;
  zoomState.focalWallY = coords.wallY;
  zoomState.focalWrapperX = coords.wrapperX;
  zoomState.focalWrapperY = coords.wrapperY;
}
```

### Step 5: Modify `handleZoomTouchMove()` — The Core Change

This is where the focal-point math happens.

**Find the pinching section** (when `zoomState.isPinching && e.touches.length === 2`):

```javascript
// CURRENT CODE:
if (zoomState.isPinching && e.touches.length === 2) {
  const currentDistance = getTouchDistance(e.touches);
  const scaleChange = currentDistance / zoomState.initialDistance;
  let newScale = zoomState.initialScale * scaleChange;
  newScale = Math.max(zoomState.minScale, Math.min(zoomState.maxScale, newScale));
  zoomState.scale = newScale;
  
  // THIS IS THE PROBLEM - pan resets to center:
  zoomState.panX = 0;
  zoomState.panY = 0;
  
  applyZoomTransform();
}
```

**Replace with:**
```javascript
if (zoomState.isPinching && e.touches.length === 2) {
  const currentDistance = getTouchDistance(e.touches);
  const scaleChange = currentDistance / zoomState.initialDistance;
  let newScale = zoomState.initialScale * scaleChange;
  newScale = Math.max(zoomState.minScale, Math.min(zoomState.maxScale, newScale));
  zoomState.scale = newScale;
  
  // NEW: Track current finger midpoint (fingers may drift during pinch)
  const midpoint = getPinchMidpoint(e.touches);
  const wrapper = document.querySelector('.gallery-wall-wrapper');
  const wrapperRect = wrapper.getBoundingClientRect();
  const root = document.documentElement;
  const headerHeight = parseInt(getComputedStyle(root).getPropertyValue('--header-height')) || 0;
  
  // Current focal point position relative to wrapper
  const focalWrapperX = midpoint.x - wrapperRect.left;
  const focalWrapperY = midpoint.y - wrapperRect.top;
  
  // Calculate base translation for new scale (same logic as applyZoomTransform)
  const viewportWidth = wrapper.clientWidth;
  const viewportHeight = window.innerHeight - headerHeight;
  const scaledWidth = zoomState.wallWidth * newScale;
  const scaledHeight = zoomState.wallHeight * newScale;
  
  let baseTx = (viewportWidth - scaledWidth) / 2;
  let baseTy = (viewportHeight - scaledHeight) / 2;
  
  // Edge-to-edge correction
  if (scaledWidth <= viewportWidth + 5) {
    if (Math.abs(scaledWidth - viewportWidth) < 5) baseTx = 0;
  }
  
  // NEW: Calculate pan values that keep the focal wall-point under the fingers
  // Formula: newPanX = focalWrapperX - baseTx - (wallX * newScale)
  zoomState.panX = focalWrapperX - baseTx - (zoomState.focalWallX * newScale);
  zoomState.panY = focalWrapperY - baseTy - (zoomState.focalWallY * newScale);
  
  applyZoomTransform();
}
```

### Step 6: Verify `applyZoomTransform()` Pan Clamping

The existing `applyZoomTransform()` function already clamps `panX` and `panY` to valid bounds. This is critical — it prevents the focal-point calculation from pushing the grid out of bounds.

**Verify these sections exist and are unchanged:**

```javascript
// X-axis clamping (around line 245-258)
if (scaledWidth <= viewportWidth + 5) {
  clampedPanX = 0;
  if (Math.abs(scaledWidth - viewportWidth) < 5) baseTx = 0;
} else {
  const minPanX = viewportWidth - scaledWidth - baseTx - padding;
  const maxPanX = -baseTx + padding;
  clampedPanX = Math.max(minPanX, Math.min(maxPanX, clampedPanX));
}

// Y-axis clamping (around line 265-276)
if (scaledHeight + 2 * padding <= viewportHeight) {
  clampedPanY = 0;
} else {
  const minPanY = viewportHeight - scaledHeight - baseTy - padding;
  const maxPanY = -baseTy + padding;
  clampedPanY = Math.max(minPanY, Math.min(maxPanY, clampedPanY));
}
```

**No changes needed here.** The clamping will automatically constrain the focal-point-derived pan values to valid ranges.

### Step 7: Handle Edge Case — Clamping Feedback

When pan values are clamped, the focal point constraint is partially violated — the content under the fingers will shift slightly. This is expected and correct behavior. The alternative (allowing content to pan off-screen) is worse UX.

**Optional enhancement:** After clamping, update the stored focal point to match the new reality:

```javascript
// In handleZoomTouchMove, after applyZoomTransform():
// (Optional) Update focal point if clamping occurred
const coords = screenToWallCoords(midpoint.x, midpoint.y);
zoomState.focalWallX = coords.wallX;
zoomState.focalWallY = coords.wallY;
```

This prevents "rubber-banding" when the user continues pinching after hitting an edge. Implement this if testing reveals jarring behavior at edges.

---

## Complete Modified Functions

### `handleZoomTouchStart(e)` — Full Replacement

```javascript
function handleZoomTouchStart(e) {
  if (isZoomDisabled()) return;
  
  const wrapper = document.querySelector('.gallery-wall-wrapper');
  
  if (e.touches.length === 2) {
    // Start pinch gesture
    e.preventDefault();
    zoomState.isPinching = true;
    zoomState.initialDistance = getTouchDistance(e.touches);
    zoomState.initialScale = zoomState.scale;
    wrapper.classList.add('is-pinching');
    
    // Capture focal point in wall-space at pinch start
    const midpoint = getPinchMidpoint(e.touches);
    const coords = screenToWallCoords(midpoint.x, midpoint.y);
    zoomState.focalWallX = coords.wallX;
    zoomState.focalWallY = coords.wallY;
    zoomState.focalWrapperX = coords.wrapperX;
    zoomState.focalWrapperY = coords.wrapperY;
    
  } else if (e.touches.length === 1 && zoomState.scale < 0.999) {
    // Start pan gesture (only when zoomed out)
    zoomState.isPanning = true;
    zoomState.panStartX = e.touches[0].clientX;
    zoomState.panStartY = e.touches[0].clientY;
    zoomState.initialPanX = zoomState.panX;
    zoomState.initialPanY = zoomState.panY;
  }
}
```

### `handleZoomTouchMove(e)` — Full Replacement

```javascript
function handleZoomTouchMove(e) {
  if (isZoomDisabled()) return;
  
  if (zoomState.isPinching && e.touches.length === 2) {
    e.preventDefault();
    
    // Calculate new scale
    const currentDistance = getTouchDistance(e.touches);
    const scaleChange = currentDistance / zoomState.initialDistance;
    let newScale = zoomState.initialScale * scaleChange;
    newScale = Math.max(zoomState.minScale, Math.min(zoomState.maxScale, newScale));
    zoomState.scale = newScale;
    
    // Track current finger midpoint (fingers may drift during pinch)
    const midpoint = getPinchMidpoint(e.touches);
    const wrapper = document.querySelector('.gallery-wall-wrapper');
    const wrapperRect = wrapper.getBoundingClientRect();
    const root = document.documentElement;
    const headerHeight = parseInt(getComputedStyle(root).getPropertyValue('--header-height')) || 0;
    
    // Current focal point position relative to wrapper
    const focalWrapperX = midpoint.x - wrapperRect.left;
    const focalWrapperY = midpoint.y - wrapperRect.top;
    
    // Calculate base translation for new scale
    const viewportWidth = wrapper.clientWidth;
    const viewportHeight = window.innerHeight - headerHeight;
    const scaledWidth = zoomState.wallWidth * newScale;
    const scaledHeight = zoomState.wallHeight * newScale;
    
    let baseTx = (viewportWidth - scaledWidth) / 2;
    let baseTy = (viewportHeight - scaledHeight) / 2;
    
    // Edge-to-edge correction
    if (scaledWidth <= viewportWidth + 5) {
      if (Math.abs(scaledWidth - viewportWidth) < 5) baseTx = 0;
    }
    
    // Calculate pan values that keep the focal wall-point under the fingers
    zoomState.panX = focalWrapperX - baseTx - (zoomState.focalWallX * newScale);
    zoomState.panY = focalWrapperY - baseTy - (zoomState.focalWallY * newScale);
    
    applyZoomTransform();
    
  } else if (zoomState.isPanning && e.touches.length === 1 && zoomState.scale < 0.999) {
    e.preventDefault();
    
    // Calculate pan delta from initial position
    const deltaX = e.touches[0].clientX - zoomState.panStartX;
    const deltaY = e.touches[0].clientY - zoomState.panStartY;
    
    zoomState.panX = zoomState.initialPanX + deltaX;
    zoomState.panY = zoomState.initialPanY + deltaY;
    
    applyZoomTransform();
  }
}
```

---

## New Helper Functions to Add

Add these functions near the existing `getTouchDistance()` function:

```javascript
/**
 * Calculate the midpoint between two touch points in screen coordinates.
 * 
 * @param {TouchList} touches - The touches from a touch event (must have length >= 2)
 * @returns {{x: number, y: number}}
 */
function getPinchMidpoint(touches) {
  const touch1 = touches[0];
  const touch2 = touches[1];
  return {
    x: (touch1.clientX + touch2.clientX) / 2,
    y: (touch1.clientY + touch2.clientY) / 2
  };
}

/**
 * Convert screen coordinates to wall-space coordinates.
 * Wall-space is the coordinate system of the unscaled #galleryWall content.
 * 
 * @param {number} screenX - X coordinate in screen/client space
 * @param {number} screenY - Y coordinate in screen/client space
 * @returns {{wallX: number, wallY: number, wrapperX: number, wrapperY: number}}
 */
function screenToWallCoords(screenX, screenY) {
  const wrapper = document.querySelector('.gallery-wall-wrapper');
  const wrapperRect = wrapper.getBoundingClientRect();
  const root = document.documentElement;
  const headerHeight = parseInt(getComputedStyle(root).getPropertyValue('--header-height')) || 0;
  
  // Position relative to wrapper element
  const wrapperX = screenX - wrapperRect.left;
  const wrapperY = screenY - wrapperRect.top;
  
  // Calculate current base translation (same logic as applyZoomTransform)
  const viewportWidth = wrapper.clientWidth;
  const viewportHeight = window.innerHeight - headerHeight;
  const scaledWidth = zoomState.wallWidth * zoomState.scale;
  const scaledHeight = zoomState.wallHeight * zoomState.scale;
  
  let baseTx = (viewportWidth - scaledWidth) / 2;
  let baseTy = (viewportHeight - scaledHeight) / 2;
  
  // Apply edge-to-edge correction (matches applyZoomTransform logic)
  if (scaledWidth <= viewportWidth + 5) {
    if (Math.abs(scaledWidth - viewportWidth) < 5) baseTx = 0;
  }
  
  // Current total translation
  const tx = baseTx + zoomState.panX;
  const ty = baseTy + zoomState.panY;
  
  // Convert to wall space
  const wallX = (wrapperX - tx) / zoomState.scale;
  const wallY = (wrapperY - ty) / zoomState.scale;
  
  return { wallX, wallY, wrapperX, wrapperY };
}
```

---

## Updated `zoomState` Object

Replace the existing `zoomState` definition with this expanded version:

```javascript
const zoomState = {
  // === Scale ===
  scale: 1.0,          // Current zoom level. 1.0 = normal, <1 = zoomed out
  minScale: 0.3,       // Floor — recalculated dynamically
  maxScale: 1.0,       // Ceiling — always 1.0 (no zoom-in beyond native)

  // === Gesture tracking ===
  isPinching: false,   // true while 2 fingers are down
  isPanning: false,    // true while 1 finger is down AND scale < 1
  initialDistance: 0,  // Pixel distance between 2 fingers at pinch start
  initialScale: 1.0,   // Scale value at the moment pinch started

  // === Wall dimensions (cached once on init) ===
  wallWidth: 0,        // #galleryWall.scrollWidth at boot
  wallHeight: 0,       // #galleryWall.scrollHeight at boot

  // === Pan offset (pixel displacement from centered position) ===
  panX: 0,             // Current horizontal pan offset
  panY: 0,             // Current vertical pan offset
  initialPanX: 0,      // panX at start of current drag gesture
  initialPanY: 0,      // panY at start of current drag gesture
  panStartX: 0,        // clientX of finger at drag start
  panStartY: 0,        // clientY of finger at drag start
  edgePadding: 20,     // Minimum px gap between grid edge and viewport edge

  // === Focal point tracking (for focal-point zoom) ===
  focalWallX: 0,       // Wall-space X coordinate under pinch midpoint
  focalWallY: 0,       // Wall-space Y coordinate under pinch midpoint
  focalWrapperX: 0,    // Wrapper-relative X of pinch midpoint
  focalWrapperY: 0,    // Wrapper-relative Y of pinch midpoint

  initialized: false   // Guard against double-init
};
```

---

## Testing Checklist

### Basic Functionality
- [ ] Pinch to zoom out: grid scales down, focal point stays under fingers
- [ ] Pinch to zoom in: grid scales up, focal point stays under fingers
- [ ] Pinch at center of screen: behaves same as before (grid centers)
- [ ] Pinch at corner of grid: grid scales around that corner
- [ ] Pinch at edge of grid: grid scales around that edge

### Edge Cases
- [ ] Pinch near grid edge: pan clamping prevents grid from floating away
- [ ] Pinch that would exceed minScale: stops at minScale, clamping applied
- [ ] Pinch that would exceed maxScale (1.0): stops at 1.0, transitions to native scroll
- [ ] Fingers drift during pinch: focal point tracks with fingers (no jarring jumps)
- [ ] Quick pinch release above 0.95: snap-back to 1.0 works correctly

### Transitions
- [ ] Pinch to zoom out, then single-finger pan: pan works correctly
- [ ] Pan, then pinch again: new focal point is captured correctly
- [ ] Zoom out, press back button: resets to 1.0 and centers
- [ ] Shuffle/clear while zoomed: resets to 1.0 and centers

### Modal Interactions
- [ ] Open artwork popup while zoomed: zoom gestures disabled
- [ ] Close popup: zoom gestures re-enabled
- [ ] Welcome modal open: zoom gestures disabled

### Performance
- [ ] Pinch gesture is smooth (60fps)
- [ ] No jank when approaching edges
- [ ] No visual glitches on snap-back

---

## Troubleshooting

### Problem: Content jumps when pinch starts
**Cause:** Initial focal point calculation is incorrect.
**Fix:** Verify `screenToWallCoords()` is using the correct current pan values. Add console logging:
```javascript
console.log('Pinch start:', { 
  midpoint, 
  wallX: coords.wallX, 
  wallY: coords.wallY,
  currentPanX: zoomState.panX,
  currentPanY: zoomState.panY 
});
```

### Problem: Content slides when fingers are stationary
**Cause:** Pan is being calculated incorrectly during pinch.
**Fix:** Verify the baseTx/baseTy calculation in `handleZoomTouchMove` matches `applyZoomTransform`.

### Problem: Focal point doesn't track finger movement
**Cause:** Using initial focal point instead of current.
**Fix:** Ensure `focalWrapperX/Y` is recalculated from current `midpoint` each frame, but `focalWallX/Y` is preserved from pinch start.

### Problem: Content can be pushed off-screen
**Cause:** Pan clamping not working.
**Fix:** Verify `applyZoomTransform()` is applying the same clamping logic. The raw `panX/panY` values can exceed bounds — `clampedPanX/Y` should be used for the final transform.

### Problem: Jarring snap when hitting edge during pinch
**Cause:** Focal point constraint conflicts with edge clamping.
**Fix:** Implement optional focal point update after clamping (see Step 7).

---

## Summary of Changes

| File | Change |
|------|--------|
| `main.js` | Add 4 new properties to `zoomState` |
| `main.js` | Add `getPinchMidpoint()` helper function |
| `main.js` | Add `screenToWallCoords()` helper function |
| `main.js` | Modify `handleZoomTouchStart()` to capture focal point |
| `main.js` | Modify `handleZoomTouchMove()` to calculate focal-point-preserving pan |

**No changes required to:**
- `styles.css`
- `index.html`
- `applyZoomTransform()` (existing clamping handles the new pan values)
- `handleZoomTouchEnd()` (snap-back logic unchanged)
- `resetZoom()` (reset logic unchanged)
- Any other files

---

## Rollback Plan

If issues arise, revert `handleZoomTouchMove` to the original center-pivot behavior:

```javascript
// Original center-pivot behavior
zoomState.panX = 0;
zoomState.panY = 0;
```

The focal point state properties can remain in `zoomState` — they're harmless when unused.
