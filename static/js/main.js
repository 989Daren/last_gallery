// === DRILL: debug toggle (safe to delete) ===
const DEBUG = true;
const log  = (...args) => DEBUG && console.log(...args);
const warn = (...args) => DEBUG && console.warn(...args);
const error = (...args) => console.error(...args);

// main.js
// SVG → grid renderer using runtime parsing guide.
// Preserves existing header defined in HTML.
// No redundant UI creation; this file only wires behavior and renders tiles into #galleryWall.

const SVG_GRID_PATH = "/static/grid_full.svg";
const BASE_UNIT = 85;

const ADMIN_PIN = "8375";
const ENDPOINTS = {
  gridColor: "/api/grid-color",
  shuffle: "/shuffle",
};

const $ = (id) => document.getElementById(id);

// -------------------------------
// Popup demo metadata helpers
// -------------------------------
function titleFromFilename(urlOrPath) {
  const clean = (urlOrPath || "").split("?")[0];
  const file = clean.split("/").pop() || "";
  return file.replace(/\.[^.]+$/, "");
}

function demoInfoHeadersOnly() {
  return [
    "Art Name:",
    "",
    "Medium:",
    "",
    "Date of Creation:",
    "",
    "Artist's Note:",
    "",
    "Contact:",
  ].join("\n");
}

// -------------------------------
// Popup system (created only if missing)
// -------------------------------
function ensurePopupDom() {
  let overlay = $("popupOverlay");
  if (overlay) return overlay;

  // Minimal, non-destructive: create popup only if it doesn't exist in HTML yet.
  overlay = document.createElement("div");
  overlay.id = "popupOverlay";
  overlay.className = "popup-overlay";
  overlay.setAttribute("aria-hidden", "true");

  overlay.innerHTML = `
    <div class="popup" role="dialog" aria-modal="true" aria-label="Artwork preview">
      <div class="popup-title">
        <div class="art-title" id="popupTitle"></div>
        <div class="art-artist" id="popupArtist"></div>
      </div>

      <div class="popup-media">
        <img class="popup-img" id="popupImg" alt="">
        <div class="popup-info">
          <div class="popup-info-bg">
            <button class="popup-info-close" type="button" aria-label="Close info">×</button>
          </div>
          <div class="popup-info-text" id="popupInfoText"></div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  return overlay;
}

let popupTimers = [];

function clearPopupTimers() {
  popupTimers.forEach(clearTimeout);
  popupTimers = [];
}

function ribbonVisible(overlayEl) {
  // Visible if text stage is active AND it hasn't been dismissed
  return overlayEl.classList.contains("stage-info-text") &&
         !overlayEl.classList.contains("hide-info");
}

function openArtworkPopup({ imgSrc, title, artist, infoText }) {
  const overlay = ensurePopupDom();

  const titleEl  = $("popupTitle");
  const artistEl = $("popupArtist");
  const imgEl    = $("popupImg");
  const infoEl   = $("popupInfoText");

  if (titleEl)  titleEl.textContent  = title || "";
  if (artistEl) artistEl.textContent = artist || "";
  if (imgEl) {
    imgEl.src = imgSrc;
    imgEl.alt = title || "Artwork";
  }
  if (infoEl) infoEl.textContent = infoText || "";

  // Reset state
  overlay.classList.remove("show-title", "stage-info-bg", "stage-info-text", "hide-info");
  overlay.classList.add("is-open");
  overlay.setAttribute("aria-hidden", "false");

  clearPopupTimers();

  // Sequence: image pops (is-open) → title fades → bg slides → text pops
  popupTimers.push(setTimeout(() => overlay.classList.add("show-title"), 0));
  popupTimers.push(setTimeout(() => overlay.classList.add("stage-info-bg"), 1000));
popupTimers.push(setTimeout(() => overlay.classList.add("stage-info-text"), 2000));
}

function closeArtworkPopup() {
  const overlay = $("popupOverlay");
  if (!overlay) return;

  clearPopupTimers();
  overlay.classList.remove("is-open", "show-title", "stage-info-bg", "stage-info-text", "hide-info");
  overlay.setAttribute("aria-hidden", "true");

  const imgEl = $("popupImg");
  if (imgEl) imgEl.src = "";
}

function wirePopupEventsOnce() {
  const overlay = ensurePopupDom();
  if (overlay.__wired) return;
  overlay.__wired = true;

  const popup = overlay.querySelector(".popup");
  const closeBtn = overlay.querySelector(".popup-info-close");

  // Outside click closes everything
  overlay.addEventListener("click", () => {
    closeArtworkPopup();
  });

  // Inside popup behavior depends on ribbon visibility:
  // - ribbon visible: protect (stopPropagation)
  // - ribbon not visible: behave like current (allow bubble → overlay closes)
  popup.addEventListener("click", (e) => {
    if (ribbonVisible(overlay)) {
      e.stopPropagation();
    }
  });

  // X closes ONLY ribbon + white text
  closeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    overlay.classList.add("hide-info");
  });
}

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
  if (widthDesign >= 60  && widthDesign < 128) return "xs";   // ~85
  if (widthDesign >= 128 && widthDesign < 213) return "s";    // ~170
  if (widthDesign >= 213 && widthDesign < 298) return "m";    // ~255
  if (widthDesign >= 298 && widthDesign < 425) return "lg";   // ~340
  if (widthDesign >= 425 && widthDesign < 600) return "xlg";  // ~510
  return "unknown";
}

// Parse the SVG text into tile objects following the scaling guide.
function parseSvgToTiles(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");

  // 1) Collect all <rect> elements = tiles
  const rectElements = Array.from(doc.querySelectorAll("rect"));
  if (!rectElements.length) {
    warn("No <rect> tiles found in SVG.");
    return [];
  }

  // 2) For each rect, get width, height, and center/position
  const rects = rectElements.map((rect) => {
    const width  = parseFloat(rect.getAttribute("width")  || "0");
    const height = parseFloat(rect.getAttribute("height") || "0");
    const transform = rect.getAttribute("transform") || "";

    let cx = null, cy = null;
    const m = transform.match(/translate\(([-0-9.]+)[ ,]([-0-9.]+)\)/);
    if (m) {
      cx = parseFloat(m[1]);
      cy = parseFloat(m[2]);
    } else if (transform) {
      // Non-destructive: only warn (helps catch future SVG changes)
      warn("Unsupported SVG transform encountered:", transform);
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

    return { width, height, svg_left: left, svg_top: top };
  });

  // 3) Infer scale factor from XS candidates (40–90 SVG units wide)
  const xsCandidates = rects.map(r => r.width).filter(w => w >= 40 && w <= 90);
  if (!xsCandidates.length) {
    warn("No XS candidates found to infer scale factor.");
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

    r.grid_x = col * BASE_UNIT;
    r.grid_y = row * BASE_UNIT;
    r.size   = classifySizeDesign(r.design_width);
  });

  // 7) Assign IDs per size bucket (X1, X2… S1, S2… etc.)
  const counters = { xs: 0, s: 0, m: 0, lg: 0, xlg: 0, unknown: 0 };
  const prefix   = { xs: "X", s: "S", m: "M", lg: "L", xlg: "XL", unknown: "U" };

  return rects
    .filter(r => r.size !== "unknown")
    .map(r => {
      counters[r.size] = (counters[r.size] || 0) + 1;
      const id = prefix[r.size] + counters[r.size];
      return { id, size: r.size, x: r.grid_x, y: r.grid_y };
    });
}

// Compute wall dimensions directly from tiles
function computeWallDimensions(tiles) {
  let maxRight = 0;
  let maxBottom = 0;

  tiles.forEach(t => {
    const units = sizeToUnits(t.size);
    const w = units * BASE_UNIT;
    const h = units * BASE_UNIT;

    maxRight = Math.max(maxRight, t.x + w);
    maxBottom = Math.max(maxBottom, t.y + h);
  });

  return { width: maxRight, height: maxBottom };
}

// Apply the global grid color via CSS variable
function applyGridColor(color) {
  document.documentElement.style.setProperty("--tileColor", color);
}

function assignArtworkUrls(tiles) {
  // If server provides explicit placement mapping, use it; otherwise random test assignment.
  const serverPlacement = window.SERVER_PLACEMENT || {};
  const hasServerPlacement = serverPlacement && Object.keys(serverPlacement).length > 0;

  if (hasServerPlacement) {
    tiles.forEach(tile => {
      const art = serverPlacement[tile.id] || serverPlacement[String(tile.id)];
      if (art) tile.artUrl = art;
    });
    return;
  }

  // Development fallback: assign test art to random tiles
  const testArt = [
    "/static/artwork/Timing.png",
    "/static/artwork/Doom Scrolling.png",
    "/static/artwork/Izzy in Spring.png",
    "/static/artwork/Path to Your Heart.png",
    "/static/artwork/Class Clown.png",
    "/static/artwork/Andrea's Arch.png",
    "/static/artwork/Daren's Dream.png",
    "/static/artwork/Twilight Circus.jpg",
    "/static/artwork/Caught in the Storm.png",
    "/static/artwork/Perspective.jpg",
    "/static/artwork/I'll Pay You Back.png",
    "/static/artwork/The Stranger.png"
  ];

  const tileCount = tiles.length;
  const artCount = testArt.length;
  const assignCount = Math.min(tileCount, artCount);

  const tileIndices = Array.from({ length: tileCount }, (_, i) => i);

  // Fisher–Yates shuffle
  for (let i = tileIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tileIndices[i], tileIndices[j]] = [tileIndices[j], tileIndices[i]];
  }

  for (let k = 0; k < assignCount; k++) {
    tiles[tileIndices[k]].artUrl = testArt[k];
  }
}

function buildLayoutTiles(tiles, totalHeight) {
  // Single vertical flip at render time
  return tiles.map(tile => {
    const units = sizeToUnits(tile.size);
    const h = units * BASE_UNIT;
    return { ...tile, y: totalHeight - h - tile.y };
  });
}

function renderTiles(wall, layoutTiles) {
  wall.innerHTML = "";

  layoutTiles.forEach(tile => {
    const units = sizeToUnits(tile.size);
    const w = units * BASE_UNIT;
    const h = units * BASE_UNIT;

    const el = document.createElement("div");
    el.classList.add("tile");
    el.dataset.size = tile.size;
    el.dataset.id = tile.id;

    if (tile.artUrl) el.dataset.artUrl = tile.artUrl;

    el.style.position = "absolute";
    el.style.left = tile.x + "px";
    el.style.top = tile.y + "px";
    el.style.width = w + "px";
    el.style.height = h + "px";

    if (tile.artUrl) {
      const img = document.createElement("img");
      img.src = tile.artUrl;
      img.classList.add("tile-art");

      const wrap = document.createElement("div");
      wrap.classList.add("art-imgwrap");
      wrap.appendChild(img);

      const frame = document.createElement("div");
      frame.classList.add("art-frame");
      frame.appendChild(wrap);

      el.appendChild(frame);
    }

    const label = document.createElement("span");
    label.classList.add("tile-label");
    label.textContent = tile.id;
    el.appendChild(label);

    wall.appendChild(el);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const wall = $("galleryWall");
  const colorPicker = $("gridColorPicker");
  const outlineToggle = $("outlineToggle");

  // Ensure popup is present and wired (safe even if you later move it into HTML)
  wirePopupEventsOnce();

  // --- Admin modal wiring (PIN-gated) ---
  const adminBtn = $("adminBtn");
  const adminModal = $("adminModal");
  const adminCloseBtn = $("adminCloseBtn");
  const adminPinGate = $("adminPinGate");
  const adminPinInput = $("adminPinInput");
  const adminPinSubmit = $("adminPinSubmit");
  const adminPinError = $("adminPinError");
  const adminControlsPanel = $("adminControlsPanel");

  let adminUnlocked = false;

  function openAdminModal() {
    if (!adminModal) return;
    adminModal.classList.remove("hidden");

    // Reset gate UI each open unless already unlocked
    if (!adminUnlocked) {
      adminPinGate?.classList.remove("hidden");
      adminControlsPanel?.classList.add("hidden");
      adminPinError?.classList.add("hidden");

      if (adminPinInput) {
        adminPinInput.value = "";
        adminPinInput.focus();
      }
    } else {
      adminPinGate?.classList.add("hidden");
      adminControlsPanel?.classList.remove("hidden");
    }
  }

  function closeAdminModal() {
    adminModal?.classList.add("hidden");
  }

  function showPinError(msg = "Incorrect PIN") {
    if (!adminPinError) return;
    adminPinError.textContent = msg;
    adminPinError.classList.remove("hidden");
  }

  function hidePinError() {
    adminPinError?.classList.add("hidden");
  }

  function tryUnlockAdmin() {
    const pin = (adminPinInput?.value || "").trim();

    if (!/^\d{4}$/.test(pin)) {
      showPinError("Enter 4 digits");
      return;
    }

    if (pin !== ADMIN_PIN) {
      showPinError("Incorrect PIN");
      return;
    }

    adminUnlocked = true;
    hidePinError();

    adminPinGate?.classList.add("hidden");
    adminControlsPanel?.classList.remove("hidden");

    colorPicker?.focus();
  }

  adminBtn?.addEventListener("click", openAdminModal);
  adminCloseBtn?.addEventListener("click", closeAdminModal);

  if (adminModal) {
    // click backdrop to close (but don't close when clicking inside card)
    adminModal.addEventListener("click", (e) => {
      if (e.target === adminModal) closeAdminModal();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && adminModal && !adminModal.classList.contains("hidden")) {
      closeAdminModal();
    }
  });

  adminPinSubmit?.addEventListener("click", tryUnlockAdmin);

  if (adminPinInput) {
    adminPinInput.addEventListener("input", hidePinError);
    adminPinInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") tryUnlockAdmin();
    });
  }
  // --- End admin modal wiring ---

  if (!wall) {
    error("galleryWall element not found");
    return;
  }

  async function boot() {
    try {
      const resp = await fetch(SVG_GRID_PATH);
      const svgText = await resp.text();

      const tiles = parseSvgToTiles(svgText);
      log("Tiles parsed from SVG:", tiles.length);

      if (!tiles.length) {
        error("No tiles generated from SVG.");
        wall.innerHTML = `
          <div style="color:#fff; padding:16px; font-family:system-ui;">
            No tiles generated from SVG. Check that <code>${SVG_GRID_PATH}</code> exists
            and contains &lt;rect&gt; elements.
          </div>
        `;
        return;
      }

      assignArtworkUrls(tiles);

      const { width, height } = computeWallDimensions(tiles);
      wall.style.position = "relative";
      wall.style.width = width + "px";
      wall.style.height = height + "px";

      const layoutTiles = buildLayoutTiles(tiles, height);
      renderTiles(wall, layoutTiles);

      // Tile click → open popup (delegated; only for tiles with artwork)
      wall.addEventListener("click", (e) => {
        const tileEl = e.target.closest(".tile");
        if (!tileEl) return;

        const artUrl = tileEl.dataset.artUrl;
        if (!artUrl) return;

        // Demo metadata (title from filename, artist fixed, headers-only info)
        openArtworkPopup({
          imgSrc: artUrl,
          title: titleFromFilename(artUrl),
          artist: "Daren Daniels",
          infoText: demoInfoHeadersOnly(),
        });
      });

      // ---- Global color handling (owner-controlled) ----
      const serverColor = window.SERVER_GRID_COLOR || "#b84c27";
      applyGridColor(serverColor);

      if (colorPicker) {
        colorPicker.value = serverColor;

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
      }

      // ---- Outline handling (per-view toggle) ----
      function updateOutlineState() {
        if (!outlineToggle) return;
        if (outlineToggle.checked) wall.classList.remove("tiles-no-outline");
        else wall.classList.add("tiles-no-outline");
      }

      outlineToggle?.addEventListener("change", updateOutlineState);
      updateOutlineState();

      // ---- Shuffle handling (admin modal button) ----
      const shuffleButton = $("shuffleButton");
      if (shuffleButton) {
        shuffleButton.addEventListener("click", async () => {
          if (!adminUnlocked) {
            openAdminModal();
            showPinError("Enter PIN to use admin controls");
            return;
          }

          try {
            const r = await fetch(ENDPOINTS.shuffle, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pin: ADMIN_PIN }),
            });

            if (r.status === 401) {
              alert("Incorrect PIN");
              return;
            }

            if (r.ok) {
              window.location.reload();
              return;
            }

            alert("Shuffle failed");
          } catch (err) {
            error("Shuffle request failed", err);
            alert("Shuffle failed");
          }
        });
      }
    } catch (err) {
      error("Failed to load SVG grid:", err);
      wall.innerHTML = `
        <div style="color:#fff; padding:16px; font-family:system-ui;">
          Error loading grid from <code>${SVG_GRID_PATH}</code>.<br>
          Check that the file exists and Flask can serve it.
        </div>
      `;
    }
  }

  boot();
});