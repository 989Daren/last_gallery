// === DRILL: debug toggle (safe to delete) ===
const DEBUG = true;
// main.js
// SVG → grid renderer using runtime parsing guide.
// Preserves existing header (color picker, outline toggle, site title) defined in HTML.
// No redundant UI creation; this file only wires behavior and renders tiles into #galleryWall.

const SVG_GRID_PATH = "/static/grid_full.svg";
const BASE_UNIT = 85;

// Map size string → units (square tiles, N × N)
function sizeToUnits(size) {
  if (!size) return 1;
  const s = size.toLowerCase();
  switch (s) {
    case "xs":  return 1;
    case "s":   return 2;
    case "m":   return 3;
    case "lg":  return 4;
    case "xlg": return 6;
    default:    return 1;
  }
}

// Classification in design space (after scaling correction)
function classifySizeDesign(widthDesign) {
  if (widthDesign >= 60 && widthDesign < 128) return "xs";   // ~85
  if (widthDesign >= 128 && widthDesign < 213) return "s";   // ~170
  if (widthDesign >= 213 && widthDesign < 298) return "m";   // ~255
  if (widthDesign >= 298 && widthDesign < 425) return "lg";  // ~340
  if (widthDesign >= 425 && widthDesign < 600) return "xlg"; // ~510
  return "unknown";
}

// Parse the SVG text into tile objects following the scaling guide.
function parseSvgToTiles(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");

  // 1) Collect all <rect> elements = tiles
  const rectElements = Array.from(doc.querySelectorAll("rect"));
  if (!rectElements.length) {
    console.warn("No <rect> tiles found in SVG.");
    return [];
  }

  // 2) For each rect, get width, height, and center/position
  const rects = rectElements.map(rect => {
    const width  = parseFloat(rect.getAttribute("width")  || "0");
    const height = parseFloat(rect.getAttribute("height") || "0");
    const transform = rect.getAttribute("transform") || "";

    let cx = null, cy = null;
    const m = transform.match(/translate\(([-0-9.]+)[ ,]([-0-9.]+)\)/);
    if (m) {
      cx = parseFloat(m[1]);
      cy = parseFloat(m[2]);
    }

    let left, top;
    if (cx !== null && cy !== null) {
      // center → top-left
      left = cx - width / 2;
      top  = cy - height / 2;
    } else {
      // fallback: direct x,y
      left = parseFloat(rect.getAttribute("x") || "0");
      top  = parseFloat(rect.getAttribute("y") || "0");
    }

    return {
      width,
      height,
      svg_left: left,
      svg_top: top
    };
  });

  // 3) Infer scale factor from XS candidates (40–90 SVG units wide)
  const xsCandidates = rects
    .map(r => r.width)
    .filter(w => w >= 40 && w <= 90);

  if (!xsCandidates.length) {
    console.warn("No XS candidates found to infer scale factor.");
    return [];
  }

  const avgXsWidth = xsCandidates.reduce((a, b) => a + b, 0) / xsCandidates.length;
  const DESIGN_XS = 85;
  const scaleFactor = avgXsWidth / DESIGN_XS;

  // 4) Convert everything into design space
  rects.forEach(r => {
    r.design_width  = r.width  / scaleFactor;
    r.design_height = r.height / scaleFactor;
    r.design_left   = r.svg_left / scaleFactor;
    r.design_top    = r.svg_top  / scaleFactor;
  });

  // 5) Normalize so the top-left of the wall is (0,0) in design space
  const minLeft = Math.min(...rects.map(r => r.design_left));
  const minTop  = Math.min(...rects.map(r => r.design_top));

  rects.forEach(r => {
    r.norm_left = r.design_left - minLeft;
    r.norm_top  = r.design_top  - minTop;
  });

  // 6) Snap to the 85px grid and classify sizes
  rects.forEach(r => {
    const col = Math.round(r.norm_left / BASE_UNIT);
    const row = Math.round(r.norm_top  / BASE_UNIT);

    r.col    = col;
    r.row    = row;
    r.grid_x = col * BASE_UNIT;
    r.grid_y = row * BASE_UNIT;
    r.size   = classifySizeDesign(r.design_width);
  });

  // 7) Assign IDs per size bucket (X1, X2… S1, S2… etc.)
  const counters = { xs: 0, s: 0, m: 0, lg: 0, xlg: 0, unknown: 0 };
  const prefix   = { xs: "X", s: "S", m: "M", lg: "L", xlg: "XL", unknown: "U" };

  const tiles = rects
    .filter(r => r.size !== "unknown")
    .map(r => {
      counters[r.size] = (counters[r.size] || 0) + 1;
      const id = prefix[r.size] + counters[r.size];
      return {
        id,
        size: r.size,
        x: r.grid_x,
        y: r.grid_y
      };
    });

  return tiles;
}

// Compute wall dimensions directly from tiles
function computeWallDimensions(tiles) {
  let maxRight = 0;
  let maxBottom = 0;

  tiles.forEach(t => {
    const units = sizeToUnits(t.size);
    const w = units * BASE_UNIT;
    const h = units * BASE_UNIT;

    const right = t.x + w;
    const bottom = t.y + h;

    if (right > maxRight) maxRight = right;
    if (bottom > maxBottom) maxBottom = bottom;
  });

  return { width: maxRight, height: maxBottom };
}

// Apply the global grid color via CSS variable
function applyGridColor(color) {
  document.documentElement.style.setProperty("--tileColor", color);
}

document.addEventListener("DOMContentLoaded", () => {
  const wall          = document.getElementById("galleryWall");
  const colorPicker   = document.getElementById("gridColorPicker");
  const outlineToggle = document.getElementById("outlineToggle");

  if (!wall) {
    console.error("galleryWall element not found");
    return;
  }

  // Load and parse the SVG, then render tiles
  fetch(SVG_GRID_PATH)
    .then(resp => resp.text())
    .then(svgText => {
      const tiles = parseSvgToTiles(svgText);
      console.log("Tiles parsed from SVG:", tiles.length);

      if (!tiles.length) {
        console.error("No tiles generated from SVG.");
        wall.innerHTML = `
          <div style="color:#fff; padding:16px; font-family:system-ui;">
            No tiles generated from SVG. Check that <code>${SVG_GRID_PATH}</code> exists
            and contains &lt;rect&gt; elements.
          </div>
        `;
        return;
      }

      // --- Assign artwork URLs ---
      // If the server provided an explicit placement mapping, use it
      // (mapping of tile id -> art URL). Otherwise fall back to the
      // existing randomized test-art assignment used for development.
      const serverPlacement = window.SERVER_PLACEMENT || {};
      const hasServerPlacement = serverPlacement && Object.keys(serverPlacement).length > 0;

      if (hasServerPlacement) {
        // Apply server-provided placements (do not randomize)
        tiles.forEach(tile => {
          const art = serverPlacement[tile.id] || serverPlacement[String(tile.id)];
          if (art) tile.artUrl = art;
        });
      } else {
        const testArt = [
          "/static/artwork/coffee thumb.png",
          "/static/artwork/doom scroll.png",
          "/static/artwork/sun dress final low.png",
          "/static/artwork/heart girl low.png",
          "/static/artwork/fire clown low.png",
          "/static/artwork/Mackinaw Island Arch xara.png",
          "/static/artwork/the dream.png",
          "/static/artwork/twilight circus.jpg",
          "/static/artwork/dark cloud girl.png",
          "/static/artwork/girl in window.jpg",
          "/static/artwork/I Need the Money.png",
          "/static/artwork/stranger 1.png"
        ];

        const tileCount = tiles.length;
        const artCount  = testArt.length;
        const assignCount = Math.min(tileCount, artCount);

        // Build array of tile indices [0, 1, 2, ..., tileCount-1]
        const tileIndices = [];
        for (let i = 0; i < tileCount; i++) {
          tileIndices.push(i);
        }

        // Fisher–Yates shuffle to randomize tile order
        for (let i = tileIndices.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = tileIndices[i];
          tileIndices[i] = tileIndices[j];
          tileIndices[j] = tmp;
        }

        // Assign each artwork to a different random tile
        for (let k = 0; k < assignCount; k++) {
          const tileIndex = tileIndices[k];
          tiles[tileIndex].artUrl = testArt[k];
        }
      }
      // All other tiles remain without artUrl → empty until they get art later.
      // ---------------------------------------------------------------------

      const { width, height } = computeWallDimensions(tiles);
      wall.style.position = "relative";
      wall.style.width  = width  + "px";
      wall.style.height = height + "px";

      const totalHeight = height;

      // Single vertical flip at render time
      const layoutTiles = tiles.map(tile => {
        const units = sizeToUnits(tile.size);
        const h = units * BASE_UNIT;
        return {
          ...tile,
          y: totalHeight - h - tile.y
        };
      });

      // Clear existing tiles but leave header/other DOM alone
      wall.innerHTML = "";

      layoutTiles.forEach(tile => {
        const units = sizeToUnits(tile.size);
        const w = units * BASE_UNIT;
        const h = units * BASE_UNIT;

        const el = document.createElement("div");
        el.classList.add("tile");
        el.dataset.size = tile.size;
        el.dataset.id   = tile.id;

        // store art url on the element for popup / later logic
        if (tile.artUrl) {
          el.dataset.artUrl = tile.artUrl;
        }

        el.style.position = "absolute";
        el.style.left   = tile.x + "px";
        el.style.top    = tile.y + "px";
        el.style.width  = w + "px";
        el.style.height = h + "px";

        // Artwork image inside tile (only if assigned)
        if (tile.artUrl) {
          const img = document.createElement("img");
          img.src = tile.artUrl;
          img.classList.add("tile-art");

          const frame = document.createElement("div");
          frame.classList.add("art-frame");
          frame.appendChild(img);

          el.appendChild(frame);
        }

        // Tile label overlay
        const label = document.createElement("span");
        label.classList.add("tile-label");
        label.textContent = tile.id;
        el.appendChild(label);

        wall.appendChild(el);
      });

      // ---- Global color handling (owner-controlled) ----
      const serverColor = window.SERVER_GRID_COLOR || "#b84c27";
      applyGridColor(serverColor);

      if (colorPicker) {
        colorPicker.value = serverColor;

        colorPicker.addEventListener("input", (e) => {
          const newColor = e.target.value;
          applyGridColor(newColor);

          fetch("/api/grid-color", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ color: newColor }),
          }).catch(() => {
            console.warn("Grid color save failed (server unreachable)");
          });
        });
      }

      // ---- Outline handling (per-view toggle) ----
      function updateOutlineState() {
        if (!outlineToggle) return;
        if (outlineToggle.checked) {
          wall.classList.remove("tiles-no-outline");
        } else {
          wall.classList.add("tiles-no-outline");
        }
      }

      if (outlineToggle) {
        outlineToggle.addEventListener("change", updateOutlineState);
        updateOutlineState();
      }

          // ---- Shuffle handling (owner-only) ----
          const shuffleButton = document.getElementById("shuffleButton");
          if (shuffleButton) {
            shuffleButton.addEventListener("click", async () => {
              const pin = window.prompt("Enter 4-digit PIN to shuffle:");
              if (pin === null) return; // user cancelled
              if (!/^\d{4}$/.test(pin)) {
                alert("Invalid PIN format");
                return;
              }

              try {
                const resp = await fetch("/shuffle", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ pin }),
                });

                if (resp.status === 401) {
                  alert("Incorrect PIN");
                  return;
                }

                if (resp.ok) {
                  // success — reload to pick up new placement
                  window.location.reload();
                  return;
                }

                alert("Shuffle failed");
              } catch (err) {
                console.error("Shuffle request failed", err);
                alert("Shuffle failed");
              }
            });
          }
    })
    .catch(err => {
      console.error("Failed to load SVG grid:", err);
      wall.innerHTML = `
        <div style="color:#fff; padding:16px; font-family:system-ui;">
          Error loading grid from <code>${SVG_GRID_PATH}</code>.<br>
          Check that the file exists and Flask can serve it.
        </div>
      `;
    });
});