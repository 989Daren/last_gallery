# Wall Lighting Overlay Insertion Diagnostic Report

**Date**: December 22, 2025  
**Issue**: Wall lighting overlays (.wall-spotlight / .wall-vignette) not appearing in DOM at runtime

---

## Findings

### 1. Overlay Insertion Code Location

**File**: `static/js/main.js`

**Function**: `boot()` (async function inside DOMContentLoaded event handler)

**Line Range**: Lines 1228–1235

**Code Block**:
```javascript
// Insert wall lighting overlays BEFORE tiles
if (!wall.querySelector('.wall-spotlight') && !wall.querySelector('.wall-vignette')) {
  const spotlightOverlay = document.createElement('div');
  spotlightOverlay.className = 'wall-light wall-spotlight';
  const vignetteOverlay = document.createElement('div');
  vignetteOverlay.className = 'wall-light wall-vignette';
  wall.prepend(vignetteOverlay);
  wall.prepend(spotlightOverlay);
}
```

**Insertion Method**: `wall.prepend()` (inserts as first children of #galleryWall)

---

### 2. Reachability Analysis

**Control Flow to Insertion Block**:

1. `DOMContentLoaded` event fires (line 497)
2. `boot()` function is called (line 1465)
3. SVG fetch and parsing succeeds (lines 1200–1205)
4. Tiles successfully parsed (line 1207–1214 early return if empty)
5. Wall dimensions computed and styles applied (lines 1222–1225)
6. **Overlay insertion block executes** (lines 1228–1235) ✅
7. `renderTiles(wall, layoutTiles)` called immediately after (line 1238)

**Gating Conditions**:
- ✅ `wall` element must exist (checked at line 1192–1195)
- ✅ SVG fetch must succeed (lines 1200–1202)
- ✅ `tiles.length > 0` (lines 1207–1214, early return if empty)
- ✅ Duplication guard passes (line 1228 condition)

**Verdict**: The insertion block IS reachable and DOES execute on normal page load.

---

### 3. Control Flow Map (Entry Point to Render)

```
Page Load
  ↓
DOMContentLoaded (line 497)
  ↓
boot() invoked (line 1465)
  ↓
fetch(SVG_GRID_PATH) (line 1200)
  ↓
parseSvgToTiles(svgText) (line 1203)
  ↓
computeWallDimensions(tiles) (line 1222)
  ↓
[OVERLAY INSERTION HERE] (lines 1228–1235)
  ↓
buildLayoutTiles(tiles, height) (line 1237)
  ↓
renderTiles(wall, layoutTiles) (line 1238)
  ↓
[TILES RENDERED]
```

**Critical Path**: boot() → [overlay insertion] → renderTiles()

---

### 4. DOM Element Verification

**Variable Assignment**:
- Line 497: `const wall = $("galleryWall");`
- Helper function `$()` defined at line 28: `const $ = (id) => document.getElementById(id);`

**Selector Used**: `document.getElementById("galleryWall")`

**HTML Template**: `templates/index.html`
- Line 46: `<div id="galleryWall" class="gallery-wall"></div>`
- Line 241: `<script src="{{ url_for('static', filename='js/main.js') }}"></script>`

**Script Loading**:
- NOT deferred
- NOT module type
- Placed at END of `<body>` (standard blocking script)
- Loads AFTER #galleryWall is in DOM

**Verdict**: ✅ The `wall` variable correctly references `<div id="galleryWall">` which exists at load time.

---

### 5. File Duplication Check

**Search Results**:
```bash
$ find . -name "main.js"
./static/js/main.js
```

**HTML Reference**:
```html
<script src="{{ url_for('static', filename='js/main.js') }}"></script>
```

**Verdict**: ✅ Only ONE main.js exists. No duplicate confusion.

---

## Root Cause (Most Likely)

**Primary Issue**: **`renderTiles()` clears overlays with `wall.innerHTML = ""`**

**Evidence**:

1. **Overlay insertion occurs** at line 1228–1235 (inside boot() function)
   - Overlays successfully prepended to `#galleryWall` using `wall.prepend()`
   - Timing: AFTER wall dimensions set, BEFORE renderTiles() call

2. **renderTiles() immediately destroys overlays** at line 459:
   ```javascript
   function renderTiles(wall, layoutTiles) {
     wall.innerHTML = "";  // ❌ NUKES EVERYTHING including overlays
     
     layoutTiles.forEach(tile => {
       // ...creates tiles...
       wall.appendChild(el);  // Adds tiles back
     });
   }
   ```

3. **Execution Order** (line 1238 in boot()):
   ```javascript
   wall.prepend(vignetteOverlay);    // ✅ Overlays inserted
   wall.prepend(spotlightOverlay);   // ✅ Overlays inserted
   
   const layoutTiles = buildLayoutTiles(tiles, height);
   renderTiles(wall, layoutTiles);   // ❌ wall.innerHTML = "" wipes overlays
   ```

4. **Result**: Overlays exist in DOM for ~1 millisecond, then are destroyed before any visual rendering occurs.

**Why the duplication guard doesn't help**:
- Guard (line 1228) checks if overlays already exist
- On first load, they DON'T exist yet → overlays get created
- Then renderTiles() destroys them immediately
- On subsequent calls to boot() (if any), guard would prevent re-creation, but overlays are already gone

---

## Secondary Contributing Factor

**`wall.innerHTML = ""`** is called in TWO places:

1. **Line 459** (renderTiles function) — primary culprit
2. **Line 1208** (boot function, error path when no tiles found)
3. **Line 1455** (boot function, error path when SVG load fails)

The error paths (2 & 3) don't matter since they show error messages and stop execution.

**The renderTiles() call is the sole killer.**

---

## Recommended Fix (No Code Yet)

**Approach**: Preserve overlays when clearing wall for tile rendering.

**Option A: Selective Clearing (Minimal Change)**

In `renderTiles()` function (line 459), replace:
```javascript
wall.innerHTML = "";
```

With:
```javascript
// Clear only tiles, preserve wall lighting overlays
const tiles = wall.querySelectorAll('.tile');
tiles.forEach(tile => tile.remove());
```

**Why this works**:
- Only removes `.tile` elements
- Leaves `.wall-light` overlays intact
- No changes needed to insertion logic
- Safe for all callers of renderTiles()

**Option B: Insert After Render (Alternative)**

Move overlay insertion to AFTER renderTiles() call (line 1238):
```javascript
renderTiles(wall, layoutTiles);

// Insert wall lighting overlays AFTER tiles rendered
if (!wall.querySelector('.wall-spotlight') && !wall.querySelector('.wall-vignette')) {
  // ...create and prepend overlays...
}
```

**Why this works**:
- renderTiles() clears wall and adds tiles
- Then overlays get prepended (push tiles back as siblings, but overlays render first due to z-index)
- Overlays survive because no more innerHTML clearing happens

**Recommendation**: **Option A** (selective clearing) is safer because:
- Works regardless of when/how renderTiles() is called
- Doesn't require moving insertion logic
- More defensive (wall could be re-rendered from other code paths)

---

## Additional Notes

**Files Involved**:
- `static/js/main.js` (overlay insertion + renderTiles)
- `static/css/styles.css` (overlay styles with z-index 1–2, tiles z-index 10)
- `templates/index.html` (defines #galleryWall and loads main.js)

**No Other Issues Detected**:
- ✅ CSS variables defined correctly in :root (lines 14–26)
- ✅ Overlay styles have proper z-index < tile z-index (CSS lines 221–249)
- ✅ Wall container establishes stacking context (CSS line 199, position: relative)
- ✅ No DOM manipulation in other scripts interferes with #galleryWall before boot()

**Conclusion**: The overlays ARE created and inserted correctly, but are immediately destroyed by `wall.innerHTML = ""` in renderTiles() before they can render visually.
