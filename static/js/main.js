const tiles = [
  { id: "S1", size: "s", x: 850, y: 425 },
  { id: "M1", size: "m", x: 765, y: 0 },
  { id: "S2", size: "s", x: 1190, y: 0 },
  { id: "X1", size: "xs", x: 935, y: 340 },
  { id: "X2", size: "xs", x: 850, y: 340 },
  { id: "X3", size: "xs", x: 1105, y: 85 },
  { id: "X4", size: "xs", x: 1020, y: 85 },
  { id: "X5", size: "xs", x: 1105, y: 170 },
  { id: "X6", size: "xs", x: 1020, y: 170 },
  { id: "X7", size: "xs", x: 0, y: 85 },
  { id: "S3", size: "s", x: 85, y: 0 },
  { id: "X8", size: "xs", x: 1020, y: 510 },
  { id: "S4", size: "s", x: 1105, y: 425 },
  { id: "X9", size: "xs", x: 1020, y: 425 },
  { id: "X10", size: "xs", x: 1275, y: 425 },
  { id: "X11", size: "xs", x: 1275, y: 510 },
  { id: "X12", size: "xs", x: 1190, y: 340 },
  { id: "X13", size: "xs", x: 1275, y: 340 },
  { id: "X14", size: "xs", x: 510, y: 0 },
  { id: "X15", size: "xs", x: 680, y: 0 },
  { id: "X16", size: "xs", x: 595, y: 0 },
  { id: "S5", size: "s", x: 340, y: 425 },
  { id: "S6", size: "s", x: 340, y: 0 },
  { id: "X17", size: "xs", x: 425, y: 340 },
  { id: "X18", size: "xs", x: 340, y: 340 },
  { id: "X19", size: "xs", x: 0, y: 0 },
  { id: "X20", size: "xs", x: 1190, y: 170 },
  { id: "X21", size: "xs", x: 1275, y: 170 },
  { id: "X22", size: "xs", x: 1020, y: 0 },
  { id: "X23", size: "xs", x: 1105, y: 0 },
  { id: "X24", size: "xs", x: 510, y: 85 },
  { id: "X25", size: "xs", x: 595, y: 85 },
  { id: "X26", size: "xs", x: 680, y: 85 },
  { id: "X27", size: "xs", x: 765, y: 510 },
  { id: "X28", size: "xs", x: 765, y: 425 },
  { id: "X29", size: "xs", x: 765, y: 340 },
  { id: "X30", size: "xs", x: 0, y: 170 },
  { id: "X31", size: "xs", x: 510, y: 170 },
  { id: "X32", size: "xs", x: 425, y: 170 },
  { id: "X33", size: "xs", x: 340, y: 170 },
  { id: "X34", size: "xs", x: 680, y: 170 },
  { id: "X35", size: "xs", x: 595, y: 170 },
  { id: "X36", size: "xs", x: 85, y: 170 },
  { id: "X37", size: "xs", x: 170, y: 170 },
  { id: "X38", size: "xs", x: 0, y: 510 },
  { id: "X39", size: "xs", x: 170, y: 510 },
  { id: "X40", size: "xs", x: 85, y: 510 },
  { id: "X41", size: "xs", x: 510, y: 510 },
  { id: "S7", size: "s", x: 595, y: 425 },
  { id: "X42", size: "xs", x: 510, y: 425 },
  { id: "X43", size: "xs", x: 510, y: 340 },
  { id: "X44", size: "xs", x: 680, y: 340 },
  { id: "X45", size: "xs", x: 595, y: 340 },
  { id: "M2", size: "m", x: 0, y: 255 },
  { id: "S8", size: "s", x: 1020, y: 255 },
  { id: "X46", size: "xs", x: 1190, y: 255 },
  { id: "X47", size: "xs", x: 1275, y: 255 },
  { id: "X48", size: "xs", x: 510, y: 255 },
  { id: "X49", size: "xs", x: 680, y: 255 },
  { id: "X50", size: "xs", x: 595, y: 255 },
  { id: "X51", size: "xs", x: 340, y: 255 },
  { id: "X52", size: "xs", x: 425, y: 255 },
  { id: "X53", size: "xs", x: 850, y: 255 },
  { id: "X54", size: "xs", x: 935, y: 255 },
  { id: "X55", size: "xs", x: 765, y: 255 },
  { id: "X56", size: "xs", x: 255, y: 425 },
  { id: "X57", size: "xs", x: 255, y: 340 },
  { id: "X58", size: "xs", x: 255, y: 85 },
  { id: "X59", size: "xs", x: 255, y: 0 },
  { id: "X60", size: "xs", x: 255, y: 170 },
  { id: "X61", size: "xs", x: 255, y: 510 },
  { id: "X62", size: "xs", x: 255, y: 255 },
];

const BASE_UNIT = 85;

// Map size string → units (case-insensitive)
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

// Build a clean layout from the raw tiles
function buildLayout(rawTiles) {
  const annotated = rawTiles.map((t, idx) => {
    const sizeNorm = t.size.toLowerCase();
    const units = sizeToUnits(sizeNorm);
    const col = Math.round(t.x / BASE_UNIT);
    const row = Math.round(t.y / BASE_UNIT);
    return {
      ...t,
      index: idx,
      size: sizeNorm,
      units,
      col,
      row
    };
  });

  // Largest tiles first so they claim space
  annotated.sort((a, b) => b.units - a.units);

  // Determine grid size
  let maxCol = 0;
  let maxRow = 0;
  annotated.forEach(t => {
    maxCol = Math.max(maxCol, t.col + t.units);
    maxRow = Math.max(maxRow, t.row + t.units);
  });

  const grid = Array.from({ length: maxRow }, () =>
    Array(maxCol).fill(null)
  );

  const finalTiles = [];

  // Place tiles, skipping overlaps
  annotated.forEach(t => {
    let canPlace = true;

    for (let r = t.row; r < t.row + t.units && canPlace; r++) {
      for (let c = t.col; c < t.col + t.units; c++) {
        if (grid[r]?.[c] !== null) {
          canPlace = false;
          break;
        }
      }
    }

    if (!canPlace) return;

    const index = finalTiles.length;

    for (let r = t.row; r < t.row + t.units; r++) {
      for (let c = t.col; c < t.col + t.units; c++) {
        grid[r][c] = index;
      }
    }

    finalTiles.push({
      id: t.id,
      size: t.size,
      x: t.col * BASE_UNIT,
      y: t.row * BASE_UNIT
    });
  });

  // Fill remaining cells with XS tiles
  for (let r = 0; r < maxRow; r++) {
    for (let c = 0; c < maxCol; c++) {
      if (grid[r][c] === null) {
        const index = finalTiles.length;
        grid[r][c] = index;
        finalTiles.push({
          id: `FILL_${r}_${c}`,
          size: "xs",
          x: c * BASE_UNIT,
          y: r * BASE_UNIT
        });
      }
    }
  }

  // Compute wall width/height
  let maxRight = 0;
  let maxBottom = 0;

  finalTiles.forEach(tile => {
    const units = sizeToUnits(tile.size);
    const w = units * BASE_UNIT;
    const h = units * BASE_UNIT;
    maxRight = Math.max(maxRight, tile.x + w);
    maxBottom = Math.max(maxBottom, tile.y + h);
  });

  return {
    tiles: finalTiles,
    width: maxRight,
    height: maxBottom
  };
}

// Apply the global grid color via CSS variable
function applyGridColor(color) {
  document.documentElement.style.setProperty("--grid-color", color);
}

document.addEventListener("DOMContentLoaded", () => {
  const wall = document.getElementById("galleryWall");
  const colorPicker = document.getElementById("gridColorPicker");
  const outlineToggle = document.getElementById("outlineToggle");

  if (!wall) {
    console.error("galleryWall element not found");
    return;
  }

  // Build layout from parsed tiles
  const layout = buildLayout(tiles);

  // Flip vertically: y' = totalHeight - tileHeight - y
  const totalHeight = layout.height;
  const layoutTiles = layout.tiles.map(tile => {
    const units = sizeToUnits(tile.size);
    const h = units * BASE_UNIT;
    return {
      ...tile,
      y: totalHeight - h - tile.y
    };
  });

  wall.style.width = layout.width + "px";
  wall.style.height = layout.height + "px";

  layoutTiles.forEach((tile, index) => {
    const units = sizeToUnits(tile.size);
    const width = units * BASE_UNIT;
    const height = units * BASE_UNIT;

    const el = document.createElement("div");
    el.classList.add("tile");
    el.dataset.size = tile.size;
    el.dataset.id = tile.id;

    el.style.left = tile.x + "px";
    el.style.top = tile.y + "px";
    el.style.width = width + "px";
    el.style.height = height + "px";

    const label = document.createElement("span");
    label.classList.add("tile-label");
    label.textContent = `${tile.size.toUpperCase()} ${tile.id || "#" + (index + 1)}`;
    el.appendChild(label);

    wall.appendChild(el);
  });

  // ---- Global color handling (owner-controlled) ----
  const serverColor = window.SERVER_GRID_COLOR || "#b84c27";

  // Ensure the CSS variable matches whatever the server says
  applyGridColor(serverColor);

  if (colorPicker) {
    // Sync picker UI to current server color
    colorPicker.value = serverColor;

    // When you change the picker, update global color for everyone
    colorPicker.addEventListener("input", (e) => {
      const newColor = e.target.value;

      // Instant visual update
      applyGridColor(newColor);

      // Persist globally via Flask API
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
});