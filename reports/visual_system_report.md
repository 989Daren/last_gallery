# The Last Gallery — Visual System Report (Color, Glow, Outlines, Labels, Padding, Layering)

**Report Generated**: December 22, 2025  
**Purpose**: Comprehensive documentation of visual rendering systems, admin controls, and layering behavior.

---

## A) Color Picker (Admin)

### Primary Source Files
- `templates/index.html` (lines 121-127)
- `static/js/main.js` (lines 306, 1285-1305)
- `app.py` (lines 44-76, 137-141, 870-881)
- `static/css/styles.css` (lines 7, 209, 605-614)

### Key Code Locations

**HTML Control** (`templates/index.html:121-127`):
```html
<label for="gridColorPicker">Tile Color</label>
<input
  id="gridColorPicker"
  type="color"
  value="#b84c27"
/>
```

**JS Event Handler** (`static/js/main.js:1293-1303`):
```javascript
colorPicker.addEventListener("input", (e) => {
  const newColor = e.target.value;
  applyGridColor(newColor);

  fetch(ENDPOINTS.gridColor, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ color: newColor }),
  }).catch(() => {
    warn("Grid color save failed (server unreachable)");
  });
});
```

**CSS Application Function** (`static/js/main.js:306`):
```javascript
function applyGridColor(color) {
  document.documentElement.style.setProperty("--tileColor", color);
}
```

**Backend Storage** (`app.py:137-141`):
```python
def save_grid_color(color: str):
    """Persist the chosen grid color so all visitors see it."""
    with open(COLOR_CONFIG, "w") as f:
        json.dump({"color": color}, f)
```

### Current Behavior Summary
The color picker is an **admin-only** control (requires PIN unlock) that changes the global tile background color for all visitors. When the admin changes the color:

1. JS immediately applies color via CSS variable `--tileColor`
2. JS sends POST to `/api/grid-color` endpoint
3. Backend saves to `grid_color.json` file (key: `"color"`)
4. On next page load, server reads from JSON and injects into HTML via template variable

### Data Flow
```
Admin Input → colorPicker.addEventListener() → applyGridColor(color) 
→ document.documentElement.style.setProperty("--tileColor", color)
→ fetch("/api/grid-color", POST, {color}) 
→ app.py:save_grid_color() 
→ grid_color.json (persistent storage)
→ app.py:load_grid_color() (on page load)
→ render_template("index.html", grid_color=...)
→ window.SERVER_GRID_COLOR = "{{ grid_color }}"
```

### What It Controls
- **CSS Variable**: `--tileColor` (`:root` level, line 7 in styles.css)
- **Applied To**: `.tile { background: var(--tileColor); }` (styles.css:209)
- **Also Used In**: `.tile-label` text color mixing (styles.css:316)

### Storage Details
- **File**: `grid_color.json` (root directory)
- **Format**: `{"color": "#hexvalue"}`
- **Default**: `#aa6655` (defined in app.py:46 as `DEFAULT_GRID_COLOR`)
- **Scope**: Global (affects all users)
- **No localStorage**: Color is server-side only

---

## B) Artwork Background Glow

### Primary Source Files
- `static/css/styles.css` (lines 238-257, 295)
- `static/js/main.js` (lines 361, 408)

### Key Code Locations

**CSS Glow Definition** (`styles.css:238-257`):
```css
/* Art frame (internal mat/padding + glow) */
.art-frame {
  width: 100%;
  height: 100%;
  padding: 6px;
  box-sizing: border-box;
  background: transparent;
  overflow: visible;
  display: block;
}

.art-frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;

  /* inner glow exaggerated for testing; outer unchanged (bluer tint) */
  box-shadow: 0 0 6px rgba(200,220,255,0.90), 0 0 20px rgba(200,220,255,0.10);
  display: block;
}
```

**Empty Frame Defensive** (`styles.css:295`):
```css
.art-frame:empty {
  background: transparent;
  box-shadow: none;
}
```

**JS Glow Class Management** (`main.js:361, 408`):
```javascript
// Line 361 - resetTileToEmpty():
tileEl.classList.remove("occupied", "has-art", "filled", "hasImage", "hasArtwork", "glow", "lit");

// Line 408 - applyAssetToTile():
tileEl.classList.add("occupied");
```

### Current Behavior Summary
**"Artwork glow"** refers to a **double box-shadow on the `<img>` element inside `.art-frame`**:
- **Inner glow**: `0 0 6px rgba(200,220,255,0.90)` - bright blueish-white halo
- **Outer glow**: `0 0 20px rgba(200,220,255,0.10)` - subtle diffuse glow

The glow is **always present** when artwork exists (no toggle). It is applied via CSS to `.art-frame img`, which exists only when `applyAssetToTile()` creates the artwork structure.

### Admin Controls
**None**. The glow intensity and color are hardcoded in CSS. The admin can only control:
- Tile base color (via color picker → `--tileColor`)
- Whether outlines are visible (via "Show Outlines" toggle)

The `glow` and `lit` classes mentioned in line 361 are **legacy remnants** - they are removed during tile reset but never set anywhere in the current codebase. They have no effect.

### CSS Variables Involved
**None directly**. Glow uses hardcoded RGBA values. Could be extracted to CSS variables if future control is desired:
```css
/* Not currently implemented, but could be: */
--glow-inner: rgba(200,220,255,0.90);
--glow-outer: rgba(200,220,255,0.10);
```

### Legacy/Demo Glow Handling
The classes `glow`, `lit`, `hasImage`, `hasArtwork`, `filled` are **removed** in `resetTileToEmpty()` but never added in current code. They appear to be from an earlier implementation. Only `occupied` and `has-art` are actively used (`occupied` is set in `applyAssetToTile()`).

---

## C) Tile Outline Width and Color

### Primary Source Files
- `static/css/styles.css` (lines 211, 224-226, 260-283)
- `static/js/main.js` (lines 1307-1315)
- `templates/index.html` (line 128-133)

### Key Code Locations

**Base Outline** (`styles.css:211`):
```css
.tile {
  position: absolute;
  background: var(--tileColor);
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.3);
  /* ... */
}
```

**Outline Toggle Class** (`styles.css:224-226`):
```css
.tiles-no-outline .tile {
  border: none !important;
}
```

**Inner Image Border** (`styles.css:278-283`):
```css
.art-imgwrap::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  border: 1px solid rgba(0,0,0,0.7);
}
```

**JS Toggle Handler** (`main.js:1307-1315`):
```javascript
function updateOutlineState() {
  if (!outlineToggle) return;
  if (outlineToggle.checked) wall.classList.remove("tiles-no-outline");
  else wall.classList.add("tiles-no-outline");
}

outlineToggle?.addEventListener("change", updateOutlineState);
updateOutlineState();
```

**HTML Toggle** (`index.html:128-133`):
```html
<label>
  <input type="checkbox" id="outlineToggle" checked>
  Show Outlines
</label>
```

### Current Behavior Summary

**Two Outline Layers Exist**:

1. **Tile Border** (outer):
   - Width: `1px` (hardcoded)
   - Color: `rgba(255, 255, 255, 0.3)` (30% white, hardcoded)
   - Controlled by: "Show Outlines" checkbox (public control)
   - Applied to: `.tile` base element
   - When OFF: `.tiles-no-outline .tile { border: none !important; }`

2. **Image Border** (inner):
   - Width: `1px` (hardcoded)
   - Color: `rgba(0,0,0,0.7)` (70% black, hardcoded)
   - Controlled by: **None** (always present when artwork exists)
   - Applied to: `.art-imgwrap::after` pseudo-element
   - Purpose: Dark frame around artwork within the mat padding

### Outline Width Control
**Hardcoded to 1px** for both layers. No admin control or CSS variable. To make configurable, would need:
```css
--tile-outline-width: 1px;
--tile-outline-color: rgba(255, 255, 255, 0.3);
--image-outline-width: 1px;
--image-outline-color: rgba(0,0,0,0.7);
```

### Outline Color Control
**No direct control**. The tile outline uses a fixed RGBA value. The color picker **only affects tile background**, not borders.

### States That Change Outline Behavior

1. **Show Outlines Toggle** (public):
   - ON (default): Tile borders visible
   - OFF: `.tiles-no-outline` class added to wall, borders hidden

2. **Hover State** (`styles.css:325`):
   ```css
   .tile:hover {
     filter: brightness(1.2);
   }
   ```
   Note: This brightens the entire tile (including border if visible), not just the border.

3. **Focus State** (not tile-specific):
   - Focus rings use `--focus-ring` variable: `rgba(200,220,255,0.7)`
   - Applied to buttons/inputs, not tiles directly

4. **Admin Mode**:
   - No outline behavior change
   - Admin tile labels appear on top but don't affect outlines

---

## D) Tile Labels (NOT Green Admin Overlays)

### Primary Source Files
- `static/css/styles.css` (lines 300-317)
- `static/js/main.js` (lines 477-481, 389)

### Key Code Locations

**CSS Label Styling** (`styles.css:309-317`):
```css
/* Label inside each tile */
.tile-label {
  position: absolute;
  bottom: 4px;
  left: 4px;
  padding: 2px 4px;
  
  color: color-mix(in srgb, var(--tileColor) 85%, white);
  
  font-size: 10px;
  font-weight: bold;
  pointer-events: none;
}
```

**CSS Hide When Occupied** (`styles.css:305-307`):
```css
.tile.occupied .tile-label {
  display: none;
}
```

**JS Label Creation** (`main.js:477-481`):
```javascript
// Always create label first (establishes baseline)
const label = document.createElement("span");
label.classList.add("tile-label");
label.textContent = tile.id;
el.appendChild(label);
```

**JS Label Reference in applyAssetToTile** (`main.js:389-393`):
```javascript
// Insert art-frame before label (ensures label doesn't overlay art)
const label = tileEl.querySelector(".tile-label");
if (label) {
  tileEl.insertBefore(frame, label);
} else {
  tileEl.appendChild(frame);
}
```

### Current Behavior Summary

**Default Tile Labels** are small text overlays showing the tile ID (e.g., "X73", "M42"):
- **When Visible**: Only on **empty tiles** (no artwork)
- **Position**: Bottom-left corner of tile (`bottom: 4px; left: 4px`)
- **Text Source**: `tile.id` from parsed SVG grid data
- **Color**: Dynamic - 85% of tile color mixed with 15% white (`color-mix(in srgb, var(--tileColor) 85%, white)`)
- **Size**: 10px, bold
- **Purpose**: Developer/admin reference for tile identification

### Label Text Generation
Labels are generated from **tile.id** property, which comes from:
1. SVG grid parsing (`grid_full.svg`) → `parseGridFromSVG()` function
2. Each `<rect>` element has an `id` attribute (e.g., `id="X73"`)
3. Parsed into tile objects: `{ id: "X73", size: "s", x: 100, y: 200, ... }`
4. Rendered in `renderTiles()` function (main.js:477-481)

### Label Rendering
**Creation**: `renderTiles()` creates a `<span class="tile-label">` for every tile during initial render.

**Hiding Logic**:
- CSS rule: `.tile.occupied .tile-label { display: none; }`
- When `applyAssetToTile()` adds the `occupied` class to a tile, CSS automatically hides the label
- When `resetTileToEmpty()` removes the `occupied` class, label becomes visible again

**DOM Order**: Labels are appended to tile **after** artwork frame to ensure they don't interfere:
```
<div class="tile">
  <div class="art-frame">        ← Added by applyAssetToTile()
    <div class="art-imgwrap">
      <img class="tile-art">
    </div>
  </div>
  <span class="tile-label">X73</span>  ← Always present, hidden via CSS when occupied
</div>
```

### Green Admin Overlay Labels

**Status**: **Still present** as a separate system.

**Files**:
- CSS: `static/css/admin-tile-labels.css` (entire file)
- JS: `static/js/main.js` (lines 825-889)
- HTML: `templates/index.html` (lines 11, 188-191)

**Key Differences from Default Labels**:

| Feature | Default .tile-label | Admin .admin-tile-label |
|---------|-------------------|----------------------|
| **Visibility** | Always on empty tiles | Admin toggle required |
| **Color** | Tile color + white | Bright green (#00ff00) |
| **Size** | 10px | 24px |
| **Position** | Bottom-left | Center (absolute, transform) |
| **On Occupied Tiles** | Hidden | Shown (if toggle ON) |
| **Click-through** | pointer-events: none | pointer-events: none |
| **z-index** | (default) | 100 |
| **Purpose** | Development reference | Admin debugging tool |

**Green Label Implementation** (`admin-tile-labels.css:11-31`):
```css
.admin-tile-label {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #00ff00;
  font-size: 24px;
  font-weight: 700;
  font-family: Arial, sans-serif;
  text-align: center;
  z-index: 100;
  pointer-events: none;
  text-shadow: 
    -1px -1px 0 #000,  
     1px -1px 0 #000,
    -1px  1px 0 #000,
     1px  1px 0 #000,
     0 0 8px #00ff00;
  user-select: none;
  display: none;
}
```

**Green Label Control** (`index.html:188-191`):
```html
<label>
  <input type="checkbox" id="showTileLabelsToggle">
  Show Tile Labels
</label>
```

**Green Label Creation** (`main.js:876-881`):
```javascript
const label = document.createElement('div');
label.classList.add('admin-tile-label');
label.textContent = tile.dataset.id;
tile.appendChild(label);
```

**Conclusion**: Both label systems coexist:
- **White labels**: Always present, hidden when occupied
- **Green labels**: Admin-only overlay, shown on occupied tiles when toggle is ON

---

## E) Image-to-Tile Margin / Padding

### Primary Source Files
- `static/css/styles.css` (lines 238-243, 286-290)
- `static/js/main.js` (lines 374-393)

### Key Code Locations

**Default Padding** (`styles.css:238-243`):
```css
/* Art frame (internal mat/padding + glow) */
.art-frame {
  width: 100%;
  height: 100%;
  padding: 6px;
  box-sizing: border-box;
  background: transparent;
  overflow: visible;
  display: block;
}
```

**Size-Specific Padding** (`styles.css:286-290`):
```css
.tile[data-size="xs"] .art-frame { padding: 4px; }
.tile[data-size="s"]  .art-frame { padding: 6px; }
.tile[data-size="m"]  .art-frame { padding: 8px; }
.tile[data-size="lg"] .art-frame { padding: 10px; }
.tile[data-size="xlg"] .art-frame { padding: 14px; }
```

**DOM Structure** (`main.js:374-393`):
```javascript
// 2. Create art image with proper structure: .art-frame > .art-imgwrap > img.tile-art
const img = document.createElement("img");
img.src = asset.tile_url;
img.classList.add("tile-art");

const wrap = document.createElement("div");
wrap.classList.add("art-imgwrap");
wrap.appendChild(img);

const frame = document.createElement("div");
frame.classList.add("art-frame");
frame.appendChild(wrap);

// 3. Insert art-frame before label
tileEl.appendChild(frame);
```

### Current Behavior Summary

**Padding EXISTS** - artwork is NOT edge-to-edge. A "mat" space surrounds each image:

- **XS tiles**: 4px padding (8px total mat width)
- **S tiles**: 6px padding (12px total mat width) [DEFAULT]
- **M tiles**: 8px padding (16px total mat width)
- **L tiles**: 10px padding (20px total mat width)
- **XL tiles**: 14px padding (28px total mat width)

**Visual Effect**:
```
┌─────────────────────┐
│ Tile Background     │  ← --tileColor (from color picker)
│  ┌───────────────┐  │  ← 6px padding (size-dependent)
│  │   Artwork     │  │  ← <img> with glow
│  │   Image       │  │
│  └───────────────┘  │
└─────────────────────┘
```

### Where Behavior Is Defined

**CSS Selectors**:
- Base: `.art-frame { padding: 6px; }` (default for all sizes)
- Overrides: `.tile[data-size="xs"] .art-frame { padding: 4px; }` etc.

**Applied By**: `applyAssetToTile()` function creates the `.art-frame` element, CSS automatically applies size-specific padding based on `data-size` attribute.

### No Cropper/Export Sizing Impact

The cropper in `upload_modal.js` exports a **square image** matching the tile size. Padding is applied **after** the image is placed:
1. Cropper exports full-size square (e.g., 512x512 for XL tiles)
2. Backend saves as `tile_url` (tile-sized) and `popup_url` (original)
3. Frontend loads `tile_url` into `.art-frame`
4. CSS padding creates the mat

**No indirect padding**: Image is 100% of `.art-frame` content area, `.art-frame` itself has padding.

---

## F) Image / Tile / Background Glow Layering

### Primary Source Files
- `static/css/styles.css` (lines 56, 198, 208, 262, 272-281, 310, 341, 356, 637, 727, 850)
- `static/css/admin-tile-labels.css` (line 21)
- `static/css/admin-debug.css` (line 22)

### Layering Map (Bottom to Top)

#### Layer 0: Page Background
- **Element**: `<body>`
- **Color**: `var(--page-bg)` = `#111` (dark gray)
- **Position**: `static` (default)
- **z-index**: N/A

#### Layer 1: Gallery Wall Container
- **Element**: `.gallery-wall-wrapper`
- **Background**: `var(--wall-bg)` = `#000` (black)
- **Border**: `1px solid var(--wall-border)` (`#333`)
- **Position**: `static` (default)
- **z-index**: N/A

#### Layer 2: Gallery Wall (Tile Container)
- **Element**: `.gallery-wall`
- **Position**: `relative` (creates stacking context)
- **z-index**: N/A
- **Purpose**: Positioning anchor for absolute tiles

#### Layer 3: Tile Base (Mat/Background)
- **Element**: `.tile`
- **Position**: `absolute`
- **z-index**: None specified (default 0)
- **Background**: `var(--tileColor)` (from color picker)
- **Border**: `1px solid rgba(255,255,255,0.3)` (if outlines ON)

#### Layer 4: Art Frame (Padding Container)
- **Element**: `.art-frame`
- **Position**: `relative` (line 262)
- **z-index**: `1` (line 273)
- **Padding**: 4-14px (size-dependent)
- **Purpose**: Creates mat space around image

#### Layer 5: Art Image Wrapper
- **Element**: `.art-imgwrap`
- **Position**: `relative` (line 272)
- **z-index**: `1` (line 273)
- **Purpose**: Anchor for ::after pseudo-element outline

#### Layer 6: Artwork Image
- **Element**: `.art-imgwrap img`
- **Position**: `relative` (line 278)
- **z-index**: `1` (line 273, inherited context)
- **Glow**: `box-shadow: 0 0 6px rgba(200,220,255,0.90), 0 0 20px rgba(200,220,255,0.10)`

#### Layer 7: Inner Image Border
- **Element**: `.art-imgwrap::after`
- **Position**: `absolute`
- **z-index**: `2` (line 281)
- **Border**: `1px solid rgba(0,0,0,0.7)`
- **Purpose**: Dark frame over artwork edges

#### Layer 8: Tile Label (White)
- **Element**: `.tile-label`
- **Position**: `absolute` (line 310)
- **z-index**: None specified (default auto, appears above tile content)
- **Visibility**: Hidden when `.occupied` class present

#### Layer 9: Admin Tile Label (Green)
- **Element**: `.admin-tile-label`
- **Position**: `absolute` (admin-tile-labels.css:12)
- **z-index**: `100` (admin-tile-labels.css:21)
- **Visibility**: Controlled by admin toggle

#### Layer 10: Fixed Header
- **Element**: `.controls` (header)
- **Position**: `fixed` (line 52)
- **z-index**: `5000` (line 56)
- **Purpose**: Persistent navigation while scrolling

#### Layer 11: Art Popup Overlay
- **Element**: `.popup-overlay`
- **Position**: `fixed` (line 635)
- **z-index**: `6000` (line 637)
- **Purpose**: Full-screen artwork viewer

#### Layer 12: Modal Overlays
- **Element**: `.modalOverlay` (upload, admin, confirmations)
- **Position**: `fixed` (line 339)
- **z-index**: `8000` (line 341)
- **Purpose**: User interaction dialogs

#### Layer 13: Modal Content
- **Element**: `.modalCard`
- **Position**: `relative` (line 355)
- **z-index**: `2` (line 356, within modal context)

#### Layer 14: Admin Debug Footer
- **Element**: `.admin-debug-footer`
- **Position**: `fixed` (admin-debug.css:13)
- **z-index**: `10000` (admin-debug.css:22)
- **Purpose**: Highest layer for development info

### Z-Index Summary Table

| Element | z-index | Stacking Context | Notes |
|---------|---------|------------------|-------|
| Page/Wall | N/A | Root | Base layers |
| Tiles | 0 (default) | .gallery-wall | Absolute positioned |
| Art Frame | 1 | Within tile | Mat container |
| Art Image | 1 | Within frame | Image + glow |
| Image Border | 2 | Within frame | ::after pseudo |
| Default Label | auto | Within tile | Hidden when occupied |
| Admin Label | 100 | Within tile | Click-through overlay |
| Fixed Header | 5000 | Root | Scrolling header |
| Art Popup | 6000 | Root | Full-screen artwork |
| Modals | 8000 | Root | Upload/admin/confirmations |
| Modal Content | 2 | Within modal | Dialog cards |
| Debug Footer | 10000 | Root | Highest layer |

### Stacking Context Mechanisms

**Position Values**:
- `.gallery-wall`: `position: relative` → Creates stacking context for tiles
- `.tile`: `position: absolute` → Positioned within wall context
- `.art-frame`: `position: relative` → Creates context for image wrapper
- `.art-imgwrap`: `position: relative` → Creates context for ::after border
- `.controls`, `.popup-overlay`, `.modalOverlay`: `position: fixed` → Root-level contexts

**Z-Index Without Positioned Ancestor**:
- All fixed-position elements (header, modals, popups) are correctly positioned
- No fragile z-index issues detected (all explicit z-index values have `position: fixed` or `position: relative`)

**Conflicting Z-Index Ranges**:
- None detected. Clear hierarchy:
  - Tiles/content: 0-100
  - Header: 5000
  - Popups: 6000
  - Modals: 8000
  - Debug: 10000

### DOM Order vs Z-Index

**Tiles**: Rendered in SVG parse order, layered via `position: absolute` (no z-index = DOM order used for overlaps if any)

**Fixed Elements**: Z-index determines order (DOM order irrelevant for `position: fixed`)

**No Fragile Layering Detected**: All layering is explicit and predictable.

---

## Quick Summary Table

| Topic | Current Status |
|-------|---------------|
| **A) Color Picker** | Admin-only control via `<input type="color">` → updates CSS variable `--tileColor` → saved to `grid_color.json` (backend) → affects tile background for all users. No localStorage. |
| **B) Artwork Glow** | Double box-shadow on `.art-frame img`: inner `0 0 6px rgba(200,220,255,0.90)` + outer `0 0 20px rgba(200,220,255,0.10)`. Always present when artwork exists. No admin toggle. Legacy `glow`/`lit` classes removed but never set. |
| **C) Tile Outlines** | Two layers: (1) Tile border `1px solid rgba(255,255,255,0.3)` controlled by public "Show Outlines" toggle, (2) Image border `1px solid rgba(0,0,0,0.7)` always present via `.art-imgwrap::after`. Both widths/colors hardcoded (no CSS variables). |
| **D) Tile Labels** | Two systems coexist: (1) Default white `.tile-label` showing tile ID, visible only on empty tiles, 10px bottom-left, color from `color-mix(--tileColor, white)`. (2) Admin green `.admin-tile-label` overlay, 24px centered, `#00ff00`, z-index 100, toggle-controlled, visible on occupied tiles. Both use `tile.id` from SVG parse. |
| **E) Image Padding** | Padding EXISTS via `.art-frame { padding: 4-14px; }` (size-dependent). NOT edge-to-edge. Creates "mat" effect between tile background and artwork. XS=4px, S=6px, M=8px, L=10px, XL=14px. No cropper impact (image is 100% of content area). |
| **F) Layering** | Clean hierarchy: Wall (relative) → Tiles (absolute, z:0) → Art layers (z:1-2) → Labels (z:auto/100) → Header (z:5000) → Popup (z:6000) → Modals (z:8000) → Debug (z:10000). No fragile stacking contexts. All fixed elements properly positioned. |

---

## Search Keywords Used

The following searches were performed to compile this report:

### Color Picker
- `color.*picker`, `input\[type=.?color`, `gridColorPicker`
- `--wall`, `--mat`, `--tile`, `setProperty.*color`
- Files: `templates/index.html`, `static/js/main.js`, `app.py`, `static/css/styles.css`

### Glow
- `glow`, `box-shadow`, `drop-shadow`, `filter.*brightness`, `radial-gradient`
- Files: `static/css/styles.css`, `static/js/main.js`

### Outlines
- `outline`, `border.*tile`, `stroke`
- Files: `static/css/styles.css`, `static/js/main.js`

### Labels
- `label`, `tileLabel`, `idLabel`, `admin-tile-label`
- Files: `static/css/styles.css`, `static/css/admin-tile-labels.css`, `static/js/main.js`, `templates/index.html`

### Padding
- `padding`, `margin`, `inset`, `tile-inner`, `.frame`, `art-frame`
- Files: `static/css/styles.css`, `static/js/main.js`

### Layering
- `z-index`, `position.*absolute`, `position.*relative`, `position.*fixed`
- Files: `static/css/styles.css`, `static/css/admin-tile-labels.css`, `static/css/admin-debug.css`

---

**Report End**
