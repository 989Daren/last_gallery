// main.js
// Runtime SVG → Grid Wall Renderer
// Pipeline (per guide):
// SVG → Parse → Scale → Normalize → Snap → Classify → Assign IDs → Render (with vertical flip)

(function () {
  "use strict";

  const DESIGN_STEP = 85; // canonical grid step
  const SIZE_MAP = {
    xs: DESIGN_STEP,
    s: DESIGN_STEP * 2,
    m: DESIGN_STEP * 3,
    lg: DESIGN_STEP * 4,
    xlg: DESIGN_STEP * 6
  };

  const SIZE_THRESHOLDS = [
    { key: "xs", min: 60,  max: 127 },
    { key: "s",  min: 128, max: 212 },
    { key: "m",  min: 213, max: 297 },
    { key: "lg", min: 298, max: 424 },
    { key: "xlg",min: 425, max: 600 }
  ];

  const ID_PREFIX = {
    xs: "X",
    s: "S",
    m: "M",
    lg: "L",
    xlg: "XL"
  };

  function classifySize(designWidth, designHeight) {
    const avg = (designWidth + designHeight) / 2;
    for (const t of SIZE_THRESHOLDS) {
      if (avg >= t.min && avg <= t.max) {
        return t.key;
      }
    }
    return null; // invalid
  }

  function parseTranslate(transformValue) {
    if (!transformValue) return null;
    const match = transformValue.match(/translate\s*\(([^,\s]+)[,\s]+([^\)\s]+)\)/i);
    if (!match) return null;
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);
    if (Number.isNaN(x) || Number.isNaN(y)) return null;
    return { x, y };
  }

  function getScaleFactor(rects) {
    const widths = [];
    rects.forEach(rect => {
      const w = parseFloat(rect.getAttribute("width"));
      if (!Number.isNaN(w) && w >= 40 && w <= 90) {
        widths.push(w);
      }
    });

    if (!widths.length) {
      console.warn("[grid] No widths in 40–90 range found; defaulting scale factor to 1");
      return 1;
    }

    const sum = widths.reduce((acc, v) => acc + v, 0);
    const avg = sum / widths.length;
    const scale = avg / DESIGN_STEP;

    if (!scale || !Number.isFinite(scale)) {
      console.warn("[grid] Invalid computed scale; defaulting to 1");
      return 1;
    }

    return scale;
  }

  function initGrid() {
    const container =
      document.getElementById("grid-container") ||
      document.getElementById("grid") ||
      document.body;

    if (!container) {
      console.error("[grid] No container element found for grid wall.");
      return;
    }

    container.style.position = container === document.body ? "relative" : (container.style.position || "relative");

    fetch("/static/grid_full.svg")
      .then(response => {
        if (!response.ok) {
          throw new Error("Failed to load SVG: " + response.status);
        }
        return response.text();
      })
      .then(svgText => {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgText, "image/svg+xml");
        const rects = Array.from(svgDoc.querySelectorAll("rect"));

        if (!rects.length) {
          console.error("[grid] No <rect> elements found in SVG.");
          return;
        }

        console.log("[grid] Rect count (authoritative tile count):", rects.length);

        // 1) Automatic scale detection (SVG space → design space)
        const scaleFactor = getScaleFactor(rects);
        console.log("[grid] Detected scale factor:", scaleFactor);

        // 2) First geometric pass: compute design-space bounds
        const rawTiles = [];
        let minDesignLeft = Infinity;
        let minDesignTop = Infinity;

        rects.forEach(rect => {
          const rawWidth = parseFloat(rect.getAttribute("width")) || 0;
          const rawHeight = parseFloat(rect.getAttribute("height")) || 0;

          let left, top;

          const transform = rect.getAttribute("transform");
          const translated = parseTranslate(transform);

          if (translated) {
            // Xara center-based encoding: translate(cx, cy)
            const cx = translated.x;
            const cy = translated.y;
            left = cx - rawWidth / 2;
            top = cy - rawHeight / 2;
          } else {
            // Fallback: x/y as top-left
            left = parseFloat(rect.getAttribute("x")) || 0;
            top = parseFloat(rect.getAttribute("y")) || 0;
          }

          const designLeft = left / scaleFactor;
          const designTop = top / scaleFactor;
          const designWidth = rawWidth / scaleFactor;
          const designHeight = rawHeight / scaleFactor;

          if (designLeft < minDesignLeft) minDesignLeft = designLeft;
          if (designTop < minDesignTop) minDesignTop = designTop;

          rawTiles.push({
            designLeft,
            designTop,
            designWidth,
            designHeight
          });
        });

        // 3) Second pass: normalize, snap, classify, assign IDs
        const counters = { xs: 0, s: 0, m: 0, lg: 0, xlg: 0 };
        const tiles = [];
        let totalHeight = 0;

        rawTiles.forEach(info => {
          const normLeft = info.designLeft - minDesignLeft;
          const normTop = info.designTop - minDesignTop;

          const col = Math.round(normLeft / DESIGN_STEP);
          const row = Math.round(normTop / DESIGN_STEP);

          const gridX = col * DESIGN_STEP;
          const gridY = row * DESIGN_STEP;

          const sizeKey = classifySize(info.designWidth, info.designHeight);
          if (!sizeKey) {
            console.warn("[grid] Skipping rect with invalid size:", info);
            return;
          }

          const tileSize = SIZE_MAP[sizeKey];
          const prefix = ID_PREFIX[sizeKey];
          counters[sizeKey] += 1;
          const id = prefix + counters[sizeKey];

          totalHeight = Math.max(totalHeight, gridY + tileSize);

          tiles.push({
            id,
            size: sizeKey,
            x: gridX,
            y: gridY,
            width: tileSize,
            height: tileSize
          });
        });

        console.log("[grid] Classified tile counts:", counters);
        console.log("[grid] Computed total design-space height:", totalHeight);

        // 4) Renderer-side vertical flip + DOM render
        container.innerHTML = "";

        tiles.forEach(tile => {
          const yRendered = totalHeight - tile.height - tile.y; // vertical flip at render time

          const el = document.createElement("div");
          el.className = "tile tile-" + tile.size;
          el.textContent = tile.id;
          el.dataset.tileId = tile.id;
          el.dataset.size = tile.size;

          el.style.position = "absolute";
          el.style.left = tile.x + "px";
          el.style.top = yRendered + "px";
          el.style.width = tile.width + "px";
          el.style.height = tile.height + "px";
          el.style.boxSizing = "border-box";

          container.appendChild(el);
        });

        container.style.height = totalHeight + "px";

        console.log("[grid] Render complete. Tiles rendered:", tiles.length);
      })
      .catch(err => {
        console.error("[grid] Error initializing grid:", err);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGrid);
  } else {
    initGrid();
  }
})();
