# Tile Grid SVG → Runtime Rendering Guide (Current System)

This guide documents the **current, authoritative process** for
rendering the full gallery wall directly from a Xara-exported SVG at
**runtime**. It **replaces all legacy instructions** related to offline
SVG → static JS conversion.

This pipeline is now:

SVG → Runtime Parsing → Grid Snapping → Renderer-Side Vertical Flip →
DOM Tiles

------------------------------------------------------------------------

## 1. Canonical Design Units

All layout is ultimately rendered in **design space** with these
canonical sizes:

-   xs = 85 × 85
-   s = 170 × 170
-   m = 255 × 255
-   lg = 340 × 340
-   xlg = 510 × 510

The baseline grid step is **85px** in both X and Y.

------------------------------------------------------------------------

## 2. SVG File Placement (Required)

The full grid SVG must live at:

/static/grid_full.svg

This file is fetched at runtime by `main.js`:

``` js
fetch("/static/grid_full.svg")
```

If this file is missing or misnamed, the grid will not render.

------------------------------------------------------------------------

## 3. Tile Definition Rules

Each SVG `<rect>` element defines **exactly one tile**. There are no
global `<rect>` elements in the file.

The authoritative tile count is determined by counting `<rect>` entries.
(Current verified count: 141 tiles.)

------------------------------------------------------------------------

## 4. SVG Geometry Interpretation

Xara may encode rectangles using: - width / height - transform:
translate(cx, cy)

Each tile's **top-left origin** is resolved as:

left = cx - (width / 2) top = cy - (height / 2)

Fallback: If no transform exists, `x` and `y` attributes are used
directly.

------------------------------------------------------------------------

## 5. Automatic Scale Detection

Because Xara exports at a scaled DPI, the system detects the scale
dynamically:

1.  Find all rectangles with widths between 40--90 SVG units.
2.  Compute their average width.
3.  Divide that average by 85.
4.  The result is the **scale factor**.

All geometry values are divided by this factor to return to design
space.

------------------------------------------------------------------------

## 6. Design-Space Normalization

After scaling:

-   The minimum `design_left` becomes X = 0
-   The minimum `design_top` becomes Y = 0

This ensures grid alignment always starts from (0,0) in design space.

This normalization is **slice-local** and does not imply full-wall
positioning.

------------------------------------------------------------------------

## 7. Grid Snapping (Authoritative Positioning)

Each tile snaps to the nearest 85px grid:

col = round(norm_left / 85) row = round(norm_top / 85)

grid_x = col × 85 grid_y = row × 85

Only `grid_x` and `grid_y` are authoritative layout coordinates.

Row/column indices are For Diagnostics Only.

------------------------------------------------------------------------

## 8. Size Classification

Classification occurs in **design space** only:

-   60--127 → xs
-   128--212 → s
-   213--297 → m
-   298--424 → lg
-   425--600 → xlg

Anything outside this range is considered invalid.

------------------------------------------------------------------------

## 9. Tile ID Assignment

IDs are deterministic and slice-local:

-   xs → X1, X2...
-   s → S1, S2...
-   m → M1, M2...
-   lg → L1, L2...
-   xlg → XL1, XL2...

IDs are **not globally persistent** and must never be used as database
keys.

------------------------------------------------------------------------

## 10. Renderer-Side Vertical Flip (Critical Rule)

All SVG → JS data must remain in **normal coordinate space**.

The vertical flip is applied **only during rendering**:

``` js
y_rendered = totalHeight - tileHeight - y
```

Rules:

-   Never flip Y during SVG parsing
-   Never bake flipped values into tile data
-   All inversion lives in the renderer

This preserves deterministic geometry and prevents double-flip
corruption.

------------------------------------------------------------------------

## 11. Runtime Rendering Outcome

When executed correctly:

✅ All 141 tiles render\
✅ Zero holes\
✅ Correct orientation\
✅ Design-space fidelity preserved\
✅ SVG becomes the single source of truth

------------------------------------------------------------------------

## 12. Git Synchronization Requirement

Because runtime rendering depends on the SVG:

/static/grid_full.svg **must always be committed to Git**

This ensures: - Grid stability across machines - Deterministic
deployment - Zero missing-asset failures

------------------------------------------------------------------------

## ✅ System Summary

This guide defines the **only approved geometry pipeline**:

SVG → Parse → Scale → Normalize → Snap → Classify → Assign IDs → Render
→ Flip → Display

Any deviation from this order results in corrupted layouts.

This document replaces all legacy static JS tile-generation procedures.
