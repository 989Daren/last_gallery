// Back-button control: ConicalNav (conical hashes) — single implementation, prior experiments removed.

// === Debug toggle ===
const DEBUG = false;
const ADMIN_DEBUG = false; // Admin debug footer
const log = (...args) => { if (DEBUG) console.log(...args); };
const warn = (...args) => { if (DEBUG) console.warn(...args); };
const error = (...args) => console.error(...args);

// === Public tile label visibility ===
// Set to false to hide white tile ID labels from public view (admin labels unaffected)
const SHOW_PUBLIC_TILE_LABELS = false;

// main.js — The Last Gallery (state-driven wall renderer + admin tools)

const SVG_GRID_PATH = "/static/grid_full.svg";
const BASE_UNIT = 85;

const ENDPOINTS = {
  gridColor: "/api/grid-color",
  shuffle: "/shuffle",
};

const $ = (id) => document.getElementById(id);

// Expose globals for admin.js module
window.DEBUG = DEBUG;
window.ADMIN_DEBUG = ADMIN_DEBUG;

// HTML escape helper for safe innerHTML insertion
function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ============================
// Gallery View Origin
// Resets viewport to top-left (0,0) of gallery
// ============================
function centerGalleryView() {
  const wrapper = document.querySelector('.gallery-wall-wrapper');
  if (wrapper) wrapper.scrollLeft = 0;
  window.scrollTo(0, 0);
}

// ============================
// Pinch Hint (Touch devices only)
// Shows two animated dots mimicking a pinch gesture after welcome dismisses
// ============================
function showPinchHint() {
  if (!window.matchMedia('(pointer: coarse)').matches) return;

  const hint = document.createElement('div');
  hint.className = 'pinch-hint';

  const dotL = document.createElement('div');
  dotL.className = 'pinch-hint-dot pinch-hint-dot--left';

  const dotR = document.createElement('div');
  dotR.className = 'pinch-hint-dot pinch-hint-dot--right';

  hint.appendChild(dotL);
  hint.appendChild(dotR);
  document.body.appendChild(hint);

  // Remove after the fade-out animation ends (2s)
  hint.addEventListener('animationend', () => {
    hint.remove();
  });
}

// ============================
// Simple Welcome Banner
// Shown after boot hydration (policy can be changed later)
// ============================
function initSimpleWelcomeAlways() {
  // Prevent double-init if called more than once
  if (window.__simpleWelcomeInit) return;
  window.__simpleWelcomeInit = true;

  const overlay = $("simpleWelcome");
  if (!overlay) {
    if (DEBUG) console.warn("[WELCOME] #simpleWelcome not found");
    return;
  }
  const enterBtn = $("simpleWelcomeEnterBtn");

  const open = () => {
    overlay.classList.remove("hidden");
    // Prevent background scroll while open
    document.body.style.overflow = "hidden";
  };

  const close = () => {
    overlay.classList.add("hidden");
    document.body.style.overflow = "";
    setTimeout(showPinchHint, 300);
  };

  // Always show on load
  open();

  // Wire "Enter Gallery" to close
  enterBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    close();
  }, { passive: false });

  // Click backdrop to close (optional)
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  // Escape key to close (optional)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) close();
  });
}

// ============================
// Pinch-to-Zoom (Touch devices only)
// ============================
// Architecture:
//   transform-origin: 0 0
//   transform: translate(tx, ty) scale(s)
//
// Behavior:
//   - At scale=1: No transform, native scroll works
//   - At scale<1: Grid scales + centers, with bounded panning
//   - At minScale: Grid fits viewport width exactly (edge-to-edge)
//   - Double-tap: Resets to scale=1
// ============================
const zoomState = {
  // Scale
  scale: 1.0,
  minScale: 0.3,
  maxScale: 1.0,

  // Gesture tracking
  isPinching: false,
  isPanning: false,
  initialDistance: 0,
  initialScale: 1.0,

  // Wall dimensions (cached on init)
  wallWidth: 0,
  wallHeight: 0,

  // Unified transform position (translate(tx, ty) scale(s))
  tx: 0,
  ty: 0,

  // Per-frame midpoint tracking for focal-point anchoring
  prevMidX: 0,
  prevMidY: 0,

  // Pan start state (single-finger drag)
  panStartX: 0,
  panStartY: 0,
  txAtPanStart: 0,
  tyAtPanStart: 0,

  edgePadding: 20,

  // Cached DOM elements (set in initZoom, never change)
  _wrapper: null,
  _zoomWrapper: null,

  // Cached viewport metrics (refreshed on resize/orientation)
  _vw: 0,
  _vh: 0,

  initialized: false
};

// Reusable object for clampTransform output — avoids per-frame allocation
const _clampResult = { tx: 0, ty: 0 };

function initZoom() {
  if (zoomState.initialized) return;

  const wall = document.getElementById('galleryWall');
  const wrapper = document.querySelector('.gallery-wall-wrapper');
  const zoomWrapper = document.querySelector('.zoom-wrapper');
  if (!wall || !wrapper || !zoomWrapper) return;

  // Cache DOM references — these elements never change
  zoomState._wrapper = wrapper;
  zoomState._zoomWrapper = zoomWrapper;

  zoomState.wallWidth = wall.scrollWidth;
  zoomState.wallHeight = wall.scrollHeight;
  refreshViewportMetrics();
  recalculateZoomLimits();

  wrapper.addEventListener('touchstart', handleZoomTouchStart, { passive: false });
  wrapper.addEventListener('touchmove', handleZoomTouchMove, { passive: false });
  wrapper.addEventListener('touchend', handleZoomTouchEnd);
  wrapper.addEventListener('touchcancel', handleZoomTouchEnd);

  window.addEventListener('resize', refreshViewportMetrics);
  window.addEventListener('resize', recalculateZoomLimits);
  window.addEventListener('orientationchange', () => {
    setTimeout(() => { refreshViewportMetrics(); recalculateZoomLimits(); }, 100);
  });

  zoomState.initialized = true;
  if (DEBUG) console.log('[ZOOM] Initialized', zoomState);
}

function refreshViewportMetrics() {
  const wrapper = zoomState._wrapper;
  if (!wrapper) return;
  const headerHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 0;
  zoomState._vw = wrapper.clientWidth;
  zoomState._vh = window.innerHeight - headerHeight;
}

function recalculateZoomLimits() {
  if (!zoomState._vw || !zoomState.wallWidth) return;

  const halfPad = zoomState.edgePadding / 2;

  // Use half-padding for minScale so grid fills more of the viewport at max zoom-out
  zoomState.minScale = Math.min(
    (zoomState._vw - 2 * halfPad) / zoomState.wallWidth,
    (zoomState._vh - 2 * halfPad) / zoomState.wallHeight,
    1.0
  );

  if (zoomState.scale < 1.0) {
    zoomState.scale = Math.max(zoomState.minScale, Math.min(zoomState.maxScale, zoomState.scale));
    clampTransform(zoomState.tx, zoomState.ty, zoomState.scale);
    zoomState.tx = _clampResult.tx;
    zoomState.ty = _clampResult.ty;
    applyZoomTransform();
  }
}

function isZoomDisabled() {
  const welcomeModal = document.getElementById('simpleWelcome');
  if (welcomeModal && !welcomeModal.classList.contains('hidden')) return true;
  if (typeof isArtworkPopupOpen === 'function' && isArtworkPopupOpen()) return true;
  const uploadModal = document.getElementById('uploadModal');
  if (uploadModal && uploadModal.classList.contains('is-open')) return true;
  const adminModal = document.getElementById('adminModal');
  if (adminModal && !adminModal.classList.contains('hidden')) return true;
  return false;
}

// Writes clamped values into _clampResult (no allocation)
function clampTransform(tx, ty, scale) {
  const vw = zoomState._vw;
  const vh = zoomState._vh;

  // Interpolate padding: full at scale=1, half at minScale
  const range = 1.0 - zoomState.minScale;
  const t = range > 0 ? (scale - zoomState.minScale) / range : 1;
  const pad = zoomState.edgePadding * (0.5 + 0.5 * t);

  const sw = scale * zoomState.wallWidth;
  const sh = scale * zoomState.wallHeight;

  // X-axis
  if (sw <= vw - 2 * pad) {
    tx = (vw - sw) / 2;
  } else {
    if (tx > pad) tx = pad;
    if (tx < vw - pad - sw) tx = vw - pad - sw;
  }

  // Y-axis
  if (sh <= vh - 2 * pad) {
    ty = (vh - sh) / 2;
  } else {
    if (ty > pad) ty = pad;
    if (ty < vh - pad - sh) ty = vh - pad - sh;
  }

  _clampResult.tx = tx;
  _clampResult.ty = ty;
}

function handleZoomTouchStart(e) {
  if (isZoomDisabled()) return;

  const wrapper = zoomState._wrapper;
  const zoomWrapper = zoomState._zoomWrapper;

  if (e.touches.length === 2) {
    e.preventDefault();

    // Scroll→transform handoff: capture scroll position BEFORE locking
    if (zoomState.scale >= 0.999) {
      const scrollX = wrapper.scrollLeft;
      const scrollY = window.scrollY;
      lockScroll();
      zoomState.tx = -scrollX;
      zoomState.ty = -scrollY;
      zoomState.scale = 1.0;
      zoomWrapper.style.transform = 'translate(' + zoomState.tx + 'px,' + zoomState.ty + 'px) scale(1)';
    }

    zoomState.isPinching = true;
    zoomState.isPanning = false;
    const t0 = e.touches[0], t1 = e.touches[1];
    const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
    zoomState.initialDistance = Math.sqrt(dx * dx + dy * dy);
    zoomState.initialScale = zoomState.scale;

    // Record finger midpoint in wrapper-relative coords
    const rect = wrapper.getBoundingClientRect();
    zoomState.prevMidX = (t0.clientX + t1.clientX) / 2 - rect.left;
    zoomState.prevMidY = (t0.clientY + t1.clientY) / 2 - rect.top;

    wrapper.classList.add('is-pinching');
  } else if (e.touches.length === 1 && zoomState.scale < 0.999) {
    // Single finger pan when zoomed out
    zoomState.isPanning = true;
    zoomState.panStartX = e.touches[0].clientX;
    zoomState.panStartY = e.touches[0].clientY;
    zoomState.txAtPanStart = zoomState.tx;
    zoomState.tyAtPanStart = zoomState.ty;
  }
}

function handleZoomTouchMove(e) {
  if (zoomState.isPinching && e.touches.length === 2) {
    if (isZoomDisabled()) return;
    e.preventDefault();

    const rect = zoomState._wrapper.getBoundingClientRect();
    const t0 = e.touches[0], t1 = e.touches[1];
    const mx = (t0.clientX + t1.clientX) / 2 - rect.left;
    const my = (t0.clientY + t1.clientY) / 2 - rect.top;

    // Compute new scale
    const dx = t0.clientX - t1.clientX;
    const dy = t0.clientY - t1.clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const newScale = Math.max(zoomState.minScale, Math.min(zoomState.maxScale, zoomState.initialScale * dist / zoomState.initialDistance));

    // Focal-point anchoring: keep content point under previous midpoint at current midpoint
    const s = zoomState.scale;
    const cx = (zoomState.prevMidX - zoomState.tx) / s;
    const cy = (zoomState.prevMidY - zoomState.ty) / s;

    // Edge clamping
    clampTransform(mx - newScale * cx, my - newScale * cy, newScale);
    zoomState.tx = _clampResult.tx;
    zoomState.ty = _clampResult.ty;
    zoomState.scale = newScale;

    // Store current midpoint for next frame
    zoomState.prevMidX = mx;
    zoomState.prevMidY = my;

    applyZoomTransform();
  } else if (zoomState.isPanning && e.touches.length === 1 && zoomState.scale < 0.999) {
    if (isZoomDisabled()) return;
    // Single finger pan when zoomed out
    e.preventDefault();
    clampTransform(
      zoomState.txAtPanStart + (e.touches[0].clientX - zoomState.panStartX),
      zoomState.tyAtPanStart + (e.touches[0].clientY - zoomState.panStartY),
      zoomState.scale
    );
    zoomState.tx = _clampResult.tx;
    zoomState.ty = _clampResult.ty;
    applyZoomTransform();
  }
}

function handleZoomTouchEnd(e) {
  if (zoomState.isPinching) {
    zoomState._wrapper.classList.remove('is-pinching');

    // Snap-back to native scroll if close to 1.0x
    if (zoomState.scale > 0.95) {
      // Transform→scroll handoff: compute scroll from current transform
      const scrollX = Math.max(0, -zoomState.tx);
      const scrollY = Math.max(0, -zoomState.ty);
      zoomState.scale = 1.0;
      zoomState.tx = 0;
      zoomState.ty = 0;
      zoomState._zoomWrapper.style.transform = '';
      unlockScrollTo(scrollX, scrollY);

      zoomState.isPinching = false;
      zoomState.isPanning = false;
      return;
    }
  }

  zoomState.isPinching = false;
  zoomState.isPanning = false;

  // Push hash if zoomed out (enables back button to reset zoom)
  if (zoomState.scale < 0.999) {
    window.ConicalNav && window.ConicalNav.pushToMatchUi();
  }
}

function applyZoomTransform() {
  // At scale=1 and NOT mid-gesture: handoff to native scroll.
  // During a pinch, stay in transform mode — touchEnd handles the handoff.
  if (zoomState.scale >= 0.999 && !zoomState.isPinching) {
    const scrollX = Math.max(0, -zoomState.tx);
    const scrollY = Math.max(0, -zoomState.ty);
    zoomState._zoomWrapper.style.transform = '';
    zoomState.tx = 0;
    zoomState.ty = 0;
    unlockScrollTo(scrollX, scrollY);
    return;
  }

  lockScroll();
  zoomState._zoomWrapper.style.transform = 'translate(' + zoomState.tx + 'px,' + zoomState.ty + 'px) scale(' + zoomState.scale + ')';
}

let scrollLocked = false;

function lockScroll() {
  if (scrollLocked) return;
  window.scrollTo(0, 0);
  const wrapper = zoomState._wrapper;
  if (wrapper) {
    wrapper.scrollLeft = 0;
    wrapper.style.overflow = 'hidden';
    wrapper.style.touchAction = 'none';
  }
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  scrollLocked = true;
}

// Atomic unlock + position: restores overflow and sets scroll in one operation.
// Scroll is never visible at 0,0 — position is set before each axis becomes scrollable.
function unlockScrollTo(scrollX, scrollY) {
  const wrapper = zoomState._wrapper;
  if (wrapper) {
    wrapper.style.overflowX = 'auto';
    wrapper.style.overflowY = 'visible';
    wrapper.style.touchAction = '';
    wrapper.scrollLeft = scrollX;
  }
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
  window.scrollTo(0, scrollY);
  scrollLocked = false;
}

function resetZoom(silent) {
  const wasZoomed = zoomState.scale < 0.999;
  zoomState.scale = 1.0;
  zoomState.tx = 0;
  zoomState.ty = 0;
  if (zoomState._zoomWrapper) zoomState._zoomWrapper.style.transform = '';

  // Atomic unlock + origin: no intermediate state is ever paintable
  unlockScrollTo(0, 0);

  // Pop history when reset programmatically (not from back button)
  if (!silent && wasZoomed) {
    window.ConicalNav && window.ConicalNav.popFromUiClose();
  }
}

// Expose for external use (e.g., after wall refresh)
window.initZoom = initZoom;
window.resetZoom = resetZoom;

// ==============================
// ConicalNav: Back button closes UI layers (no history weirdness).
// Hash encodes layer stack: "", "#art", "#art/ribbon", "#upload".
// ==============================
const ConicalNav = {
  ignoreNextHashChange: false,

  // ---- Update these selectors / checks to match your actual UI ----
  isRibbonOpen() {
    return (typeof isInfoRibbonOpen === "function") ? isInfoRibbonOpen() : false;
  },
  isArtOpen() {
    return (typeof isArtworkPopupOpen === "function") ? isArtworkPopupOpen() : false;
  },
  isUploadOpen() {
    return (typeof isUploadModalOpen === "function") ? isUploadModalOpen() : false;
  },
  isZoomedOut() {
    return typeof zoomState !== "undefined" && zoomState.scale < 0.999;
  },

  // Choose the desired conical hash based on current UI state
  // Builds compound hash for layered states: #zoom/art/ribbon
  desiredHash() {
    // Upload is full-screen, doesn't layer with zoom
    if (this.isUploadOpen()) return "#upload";

    // Build compound hash for zoom + popup layers
    const parts = [];
    if (this.isZoomedOut()) parts.push("zoom");
    if (this.isArtOpen()) parts.push("art");
    if (this.isRibbonOpen()) parts.push("ribbon");

    return parts.length ? "#" + parts.join("/") : "";
  },

  // PUSH a new hash state (creates a history step)
  pushToMatchUi() {
    const target = this.desiredHash();
    if (location.hash === target) return;
    location.hash = target; // PUSH
  },

  // UI close should POP the current hash step
  popFromUiClose() {
    // Avoid double-close when hashchange fires from history.back()
    this.ignoreNextHashChange = true;
    history.back();
  },

  // Parse hash to stack array: "#art/ribbon" -> ["art","ribbon"]
  parseHash(hashStr) {
    const h = (hashStr || "").replace(/^#/, "").trim();
    if (!h) return [];
    return h.split("/").filter(Boolean);
  },

  // Enforce UI matches the NEW hash stack after Back/Forward
  syncUiToHash() {
    const stack = this.parseHash(location.hash);

    const wantsArt = stack.includes("art");
    const wantsRibbon = stack.includes("ribbon");
    const wantsUpload = stack.includes("upload");

    // If you used "#upload" as standalone, detect it:
    const standaloneUpload = (location.hash === "#upload");

    // Close ribbon if hash no longer includes ribbon
    if (!wantsRibbon && this.isRibbonOpen()) {
      try { closeInfoRibbon(true); } catch (e) {}
    }

    // Close art if hash no longer includes art
    if (!wantsArt && this.isArtOpen()) {
      try { closeArtworkPopup(true); } catch (e) {}
    }

    // Close upload if hash no longer includes upload/standalone upload
    if (!wantsUpload && !standaloneUpload && this.isUploadOpen()) {
      try { closeUploadModal(true); } catch (e) {}
    }

    // Reset zoom if hash no longer includes zoom
    const wantsZoom = stack.includes("zoom");
    if (!wantsZoom && this.isZoomedOut()) {
      try { resetZoom(true); } catch (e) {}
    }

    // NOTE: We do NOT auto-open layers on forward navigation.
    // Forward may restore hash; we only guarantee "Back closes layers".
  },

  onHashChange() {
    if (this.ignoreNextHashChange) {
      this.ignoreNextHashChange = false;
      return;
    }
    this.syncUiToHash();
  },

  init() {
    window.addEventListener("hashchange", () => this.onHashChange(), true);

    // Optional: On first load, ensure hash matches current UI (usually none)
    setTimeout(() => {
      // If UI has layers open on load (rare), push hash
      this.pushToMatchUi();
    }, 0);
  }
};

ConicalNav.init();
window.ConicalNav = ConicalNav;

// ========================================
// Repeated selector/ID/API string constants
// ========================================
const SEL = {
  wall: 'galleryWall',           // ID for getElementById/$(...)
  wallQuery: '#galleryWall',     // Selector for querySelector
  tile: '.tile',
  artFrame: '.art-frame',
  artImgwrap: '.art-imgwrap',
  adminTileLabel: '.admin-tile-label',
  tileLabel: '.tile-label',
  tileHasAsset: '.tile.has-asset',
};

const IDS = {
  popupOverlay: 'popupOverlay',
  popupTitle: 'popupTitle',
  popupArtist: 'popupArtist',
  popupImg: 'popupImg',
  popupInfoText: 'popupInfoText',
};

const API = {
  wallState: '/api/wall_state',
  tileInfo: '/api/admin/tile_info',
  undo: '/api/admin/undo',
  clearTile: '/api/admin/clear_tile',
  clearAll: '/api/admin/clear_all_tiles',
  moveTile: '/api/admin/move_tile_asset',
  historyStatus: '/api/admin/history_status',
};

// Expose for admin.js module
window.SEL = SEL;
window.API = API;

const LOG = {
  render: '[RENDER]',
  admin: '[ADMIN]',
  state: '[STATE]',
  undo: '[UNDO]',
  boot: '[BOOT]',
};

// ========================================
// Wall State Management
// ========================================
// Canonical wall state (single source of truth)
const wallState = {
  tiles: {
    // Structure: tileId -> { assetId, size, x, y, asset }
    // assetId: null if tile is empty
    // asset: { tile_url, popup_url, artwork_name, artist_name } if assigned
  },
  metadata: {
    // Wall dimensions, SVG source, etc.
    width: 0,
    height: 0
  }
};

// -------------------------------
// Popup system (created only if missing)
// -------------------------------
function ensurePopupDom() {
  let overlay = $(IDS.popupOverlay);
  if (overlay) return overlay;

  // Minimal, non-destructive: create popup only if it doesn't exist in HTML yet.
  overlay = document.createElement("div");
  overlay.id = IDS.popupOverlay;
  overlay.className = "popup-overlay";
  overlay.setAttribute("aria-hidden", "true");

  // ⚠️ PHASE 1 AUDIT: innerHTML mutation (non-render, UI setup)
  overlay.innerHTML = `
    <div class="popup" role="dialog" aria-modal="true" aria-label="Artwork preview">
      <div class="popup-title">
        <div class="art-title" id="popupTitle"></div>
        <div class="art-artist" id="popupArtist"></div>
      </div>

      <div class="popup-media">
        <button class="popup-close-btn" id="popupCloseBtn" aria-label="Close image">&times;</button>
        <img class="popup-img" id="popupImg" alt="">
        <div class="popup-info">
          <div class="popup-info-bg"></div>
          <div class="popup-info-text" id="popupInfoText"></div>
          <button class="ribbon-close-btn" id="ribbonCloseBtn" aria-label="Close info">&times;</button>
        </div>
      </div>
    </div>
  `;

  // ⚠️ PHASE 1 AUDIT: appendChild mutation (non-render, UI setup)
  document.body.appendChild(overlay);

  // Wire up ribbon close button
  const ribbonCloseBtn = overlay.querySelector("#ribbonCloseBtn");
  if (ribbonCloseBtn) {
    ribbonCloseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (typeof window.closeInfoRibbon === "function") {
        window.closeInfoRibbon();
      }
    });
  }

  // Wire up popup close button (above image)
  const popupCloseBtn = overlay.querySelector("#popupCloseBtn");
  if (popupCloseBtn) {
    popupCloseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeArtworkPopup();
    });
  }

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

function isArtworkPopupOpen() {
  const overlay = $(IDS.popupOverlay);
  return !!overlay && overlay.classList.contains("is-open");
}
window.isArtworkPopupOpen = isArtworkPopupOpen;

function openArtworkPopup({ imgSrc, title, artist, yearCreated, medium, dimensions, editionInfo, forSale, saleType, contact1Type, contact1Value, contact2Type, contact2Value }) {
  const overlay = ensurePopupDom();

  const titleEl  = $(IDS.popupTitle);
  const artistEl = $(IDS.popupArtist);
  const imgEl    = $(IDS.popupImg);
  const infoEl   = $(IDS.popupInfoText);

  if (titleEl)  titleEl.textContent  = title || "";
  if (artistEl) artistEl.textContent = artist || "";
  if (imgEl) {
    imgEl.src = imgSrc;
    imgEl.alt = title || "Artwork";
  }

  // Build ribbon content - gallery wall card style
  // Left-justified, no labels, no extra spaces for absent metadata
  if (infoEl) {
    const ribbonParts = [];

    // Line 1: Artist name (bold)
    if (artist) ribbonParts.push(`<div class="ribbon-artist">${escapeHtml(artist)}</div>`);

    // Line 2: Artwork title (italics) + year created (not italics, same line)
    if (title || yearCreated) {
      let line2 = "";
      if (title) line2 += `<span class="ribbon-title">${escapeHtml(title)}</span>`;
      if (title && yearCreated) line2 += ", ";
      if (yearCreated) line2 += `<span class="ribbon-year">${escapeHtml(yearCreated)}</span>`;
      ribbonParts.push(`<div class="ribbon-title-line">${line2}</div>`);
    }

    // Line 3: Medium
    if (medium) ribbonParts.push(`<div class="ribbon-medium">${escapeHtml(medium)}</div>`);

    // Line 4: Dimensions
    if (dimensions) ribbonParts.push(`<div class="ribbon-dimensions">${escapeHtml(dimensions)}</div>`);

    // Line 5: Edition
    if (editionInfo) ribbonParts.push(`<div class="ribbon-edition">${escapeHtml(editionInfo)}</div>`);

    // Line 6: Sale availability text
    if (forSale === "yes" && saleType) {
      let saleText = "";
      if (saleType === "original") {
        saleText = "This original creative work is available for sale by contacting the owner.";
      } else if (saleType === "print") {
        saleText = "A high quality print of this creative work is available for sale by contacting the owner.";
      } else if (saleType === "both") {
        saleText = "This original creative work and high quality prints are available for sale by contacting the owner.";
      }
      if (saleText) ribbonParts.push(`<div class="ribbon-sale">${saleText}</div>`);
    } else if (forSale === "no") {
      ribbonParts.push(`<div class="ribbon-sale">This creative work is currently not available for sale.</div>`);
    }

    // Line 7: Contact info (clickable links)
    function buildContactLink(type, value) {
      if (!type || !value) return null;
      const escaped = escapeHtml(value);
      if (type === "email") {
        return `<a href="mailto:${escaped}" class="ribbon-contact-link" target="_blank" rel="noopener noreferrer">${escaped}</a>`;
      } else if (type === "website" || type === "social") {
        // Ensure URL has protocol
        let url = value;
        if (!/^https?:\/\//i.test(url)) {
          url = "https://" + url;
        }
        return `<a href="${escapeHtml(url)}" class="ribbon-contact-link" target="_blank" rel="noopener noreferrer">${escaped}</a>`;
      }
      return escaped;
    }

    const contact1Html = buildContactLink(contact1Type, contact1Value);
    const contact2Html = buildContactLink(contact2Type, contact2Value);
    if (contact1Html) ribbonParts.push(`<div class="ribbon-contact">${contact1Html}</div>`);
    if (contact2Html) ribbonParts.push(`<div class="ribbon-contact">${contact2Html}</div>`);

    infoEl.innerHTML = ribbonParts.join("");
    infoEl.classList.remove("is-visible");

    // Prevent contact links from closing the ribbon
    infoEl.querySelectorAll(".ribbon-contact-link").forEach(link => {
      link.addEventListener("click", (e) => {
        e.stopPropagation();
      });
    });
  }

  // Reset state
  overlay.classList.remove("show-title", "stage-info-bg", "stage-info-text", "hide-info");
  overlay.classList.add("is-open");
  overlay.setAttribute("aria-hidden", "false");

  clearPopupTimers();

  // Sequence: image pops (is-open) → title fades → bg slides → text pops
  popupTimers.push(setTimeout(() => overlay.classList.add("show-title"), 0));
  popupTimers.push(setTimeout(() => overlay.classList.add("stage-info-bg"), 1000));
  popupTimers.push(setTimeout(() => {
    overlay.classList.add("stage-info-text");

    // Reveal ribbon text after background slides in
    const ribbonText = $(IDS.popupInfoText);
    if (ribbonText) ribbonText.classList.add("is-visible");

    // ConicalNav: Ribbon opened, update hash to #art/ribbon
    window.ConicalNav && window.ConicalNav.pushToMatchUi();
  }, 2000));

  // ConicalNav: Art popup opened, update hash to #art
  window.ConicalNav && window.ConicalNav.pushToMatchUi();
}

function closeArtworkPopup(silent) {
  const overlay = $(IDS.popupOverlay);
  if (!overlay) return;

  clearPopupTimers();
  overlay.classList.remove("is-open", "show-title", "stage-info-bg", "stage-info-text", "hide-info");
  overlay.setAttribute("aria-hidden", "true");

  const imgEl = $(IDS.popupImg);
  if (imgEl) imgEl.src = "";

  // ConicalNav: Pop history on UI close (unless called from hashchange)
  if (!silent) {
    window.ConicalNav && window.ConicalNav.popFromUiClose();
  }
}

function wirePopupEventsOnce() {
  const overlay = ensurePopupDom();
  if (overlay.__wired) return;
  overlay.__wired = true;

  // Helper functions for state detection
  function isPopupOpen() {
    return overlay.classList.contains("is-open");
  }

  function isRibbonOpen() {
    return ribbonVisible(overlay);
  }

  // Global helper for ConicalNav
  window.isInfoRibbonOpen = function() {
    return ribbonVisible(overlay);
  };

  // Centralized close functions
  function closeInfoRibbon(silent) {
    overlay.classList.add("hide-info");
    // ConicalNav: Pop history on UI close (unless called from hashchange)
    if (!silent) {
      window.ConicalNav && window.ConicalNav.popFromUiClose();
    }
  }
  window.closeInfoRibbon = closeInfoRibbon;

  function closeImagePopup() {
    closeArtworkPopup();
  }

  // Unified state-machine click handler
  // Implements two-click dismiss: first click closes ribbon, second closes popup
  overlay.addEventListener("click", (e) => {
    // Allow contact links to work without closing ribbon
    if (e.target.closest(".ribbon-contact-link")) {
      return; // Let the link handle the click
    }

    const popupOpen = isPopupOpen();
    const ribbonOpen = isRibbonOpen();

    if (!popupOpen) return;

    // First click: close ribbon only
    if (ribbonOpen) {
      closeInfoRibbon();
      return; // CRITICAL: prevents closing popup on same click
    }

    // Second click: close popup
    closeImagePopup();
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

// ========================================
// PHASE 2: Hydrate wallState from existing data (bridge step)
// ========================================
function hydrateWallStateFromExistingData(layoutTiles, assignments = []) {
  // Clear existing state
  wallState.tiles = {};

  // Populate tiles with layout data
  layoutTiles.forEach(tile => {
    wallState.tiles[tile.id] = {
      assetId: null,
      size: tile.size,
      x: tile.x,
      y: tile.y,
      asset: null
    };
  });

  // Apply assignments (from server /api/wall_state)
  assignments.forEach(assignment => {
    const tileId = assignment.tile_id;
    if (wallState.tiles[tileId]) {
      wallState.tiles[tileId].assetId = assignment.asset_id;
      wallState.tiles[tileId].asset = {
        tile_url: assignment.tile_url,
        popup_url: assignment.popup_url,
        artwork_name: assignment.artwork_name,
        artist_name: assignment.artist_name,
        year_created: assignment.year_created || "",
        medium: assignment.medium || "",
        dimensions: assignment.dimensions || "",
        edition_info: assignment.edition_info || "",
        for_sale: assignment.for_sale || "",
        sale_type: assignment.sale_type || "",
        contact1_type: assignment.contact1_type || "",
        contact1_value: assignment.contact1_value || "",
        contact2_type: assignment.contact2_type || "",
        contact2_value: assignment.contact2_value || ""
      };
    }
  });

  if (DEBUG) console.log('wallState hydrated:', Object.keys(wallState.tiles).length, 'tiles');
}

// Apply the global grid color via CSS variable (now controls wall base color)
function applyGridColor(color) {
  document.documentElement.style.setProperty("--wallColor", color);
}

function buildLayoutTiles(tiles, totalHeight) {
  // Single vertical flip at render time
  return tiles.map(tile => {
    const units = sizeToUnits(tile.size);
    const h = units * BASE_UNIT;
    return { ...tile, y: totalHeight - h - tile.y };
  });
}

/**
 * Select a random empty XS tile from the gallery.
 *
 * @returns {HTMLElement|null} - The selected tile element, or null if none available
 */
function selectRandomEmptyXSTile() {
  const wall = document.getElementById(SEL.wall);
  if (!wall) {
    console.warn("[selectRandomEmptyXSTile] Gallery wall not found");
    return null;
  }

  // Find all XS tiles that are NOT occupied
  const emptyXSTiles = Array.from(wall.querySelectorAll(SEL.tile + '[data-size="xs"]'))
    .filter(tile => tile.dataset.occupied !== "1");

  if (emptyXSTiles.length === 0) {
    console.warn("[selectRandomEmptyXSTile] No empty XS tiles available");
    alert("No empty XS tiles available. Please clear some space first.");
    return null;
  }

  // Select randomly
  const randomIndex = Math.floor(Math.random() * emptyXSTiles.length);
  const selectedTile = emptyXSTiles[randomIndex];

  const tileId = selectedTile.dataset.id;
  if (DEBUG) console.log("[selectRandomEmptyXSTile] Selected tile:", tileId);

  return selectedTile;
}

// Export for use by other scripts
window.selectRandomEmptyXSTile = selectRandomEmptyXSTile;

// Size wall overlays to full scrollable dimensions (mobile pan support)
function sizeWallOverlays(wall) {
  const w = wall.scrollWidth;
  const h = wall.scrollHeight;
  wall.querySelectorAll('.wall-light, .wall-spotlight, .wall-color-layer').forEach(el => {
    el.style.width = w + 'px';
    el.style.height = h + 'px';
  });
}

// Centralized post-render finalize (layout settle + overlay sizing)
function finalizeAfterRender(wall) {
  // Force synchronous layout read (stabilizes clipping/compositing after Undo)
  void wall.offsetWidth;

  // Clear any lingering transforms that could cause shift/clipping
  wall.querySelectorAll('.art-imgwrap, .art-imgwrap img, img.tile-art').forEach(el => {
    if (el && el.style && el.style.transform && el.style.transform !== 'none') {
      el.style.transform = 'none';
    }
  });

  // Ensure overlays cover full wall dimensions
  sizeWallOverlays(wall);
}

// ========================================
// PHASE 2: New state-driven render pipeline
// ========================================
function renderWallFromState() {
  const wall = document.getElementById(SEL.wall);
  if (!wall) {
    console.error('[renderWallFromState] Gallery wall not found');
    return;
  }

  // Calculate wall dimensions from state
  let maxRight = 0;
  let maxBottom = 0;
  Object.values(wallState.tiles).forEach(tile => {
    const units = sizeToUnits(tile.size);
    const w = units * BASE_UNIT;
    const h = units * BASE_UNIT;
    maxRight = Math.max(maxRight, tile.x + w);
    maxBottom = Math.max(maxBottom, tile.y + h);
  });

  wallState.metadata.width = maxRight;
  wallState.metadata.height = maxBottom;

  // PHASE 1: Complete wall clear (preserve nothing)
  wall.innerHTML = '';
  wall.style.position = 'relative';
  wall.style.width = maxRight + 'px';
  wall.style.height = maxBottom + 'px';

  // PHASE 2: Insert wall lighting overlays
  const colorOverlay = document.createElement('div');
  colorOverlay.className = 'wall-light wall-color-layer';
  wall.appendChild(colorOverlay);

  const spotlightOverlay = document.createElement('div');
  spotlightOverlay.className = 'wall-light wall-spotlight';
  wall.appendChild(spotlightOverlay);

  // PHASE 3: Render all tiles from state
  Object.entries(wallState.tiles).forEach(([tileId, tileData]) => {
    const units = sizeToUnits(tileData.size);
    const w = units * BASE_UNIT;
    const h = units * BASE_UNIT;

    const el = document.createElement('div');
    el.classList.add('tile');
    el.dataset.size = tileData.size;
    el.dataset.id = tileId;
    el.style.position = 'absolute';
    el.style.left = tileData.x + 'px';
    el.style.top = tileData.y + 'px';
    el.style.width = w + 'px';
    el.style.height = h + 'px';

    // Create public tile label (if enabled)
    if (SHOW_PUBLIC_TILE_LABELS) {
      const label = document.createElement('span');
      label.classList.add('tile-label');
      label.textContent = tileId;
      el.appendChild(label);
    }

    wall.appendChild(el);

    // PHASE 4: Apply asset if tile has one
    if (tileData.asset && tileData.assetId) {
      // Inline asset application (avoid external function for now)
      // 1. Reset tile to empty first
      el.classList.remove('has-asset', 'occupied');
      el.removeAttribute('data-popup-url');
      el.removeAttribute('data-artwork-name');
      el.removeAttribute('data-artist-name');

      // 2. Create artwork DOM structure
      const img = document.createElement('img');
      img.src = tileData.asset.tile_url;
      img.alt = tileData.asset.artwork_name || 'Artwork';
      img.classList.add('art-img');

      const shadow = document.createElement('div');
      shadow.classList.add('art-shadow');

      const wrap = document.createElement('div');
      wrap.classList.add('art-imgwrap');
      wrap.appendChild(shadow);
      wrap.appendChild(img);

      const tileSize = parseInt(el.style.width) || 85;
      const framePadding = 6;
      const artworkSize = tileSize - (framePadding * 2);
      wrap.style.width = artworkSize + 'px';
      wrap.style.height = artworkSize + 'px';

      const frame = document.createElement('div');
      frame.classList.add('art-frame');
      frame.appendChild(wrap);

      const shell = document.createElement('div');
      shell.classList.add('art-shell');
      shell.appendChild(frame);

      // 3. Mark tile as having asset
      el.classList.add('has-asset');

      // 4. Insert shell
      const label = el.querySelector(SEL.tileLabel);
      if (label) {
        el.insertBefore(shell, label);
      } else {
        el.appendChild(shell);
      }

      // 5. Set metadata
      el.dataset.popupUrl = tileData.asset.popup_url || tileData.asset.tile_url;
      el.dataset.artworkName = tileData.asset.artwork_name || '';
      el.dataset.artistName = tileData.asset.artist_name || '';
      el.dataset.yearCreated = tileData.asset.year_created || '';
      el.dataset.medium = tileData.asset.medium || '';
      el.dataset.dimensions = tileData.asset.dimensions || '';
      el.dataset.editionInfo = tileData.asset.edition_info || '';
      el.dataset.forSale = tileData.asset.for_sale || '';
      el.dataset.saleType = tileData.asset.sale_type || '';
      el.dataset.contact1Type = tileData.asset.contact1_type || '';
      el.dataset.contact1Value = tileData.asset.contact1_value || '';
      el.dataset.contact2Type = tileData.asset.contact2_type || '';
      el.dataset.contact2Value = tileData.asset.contact2_value || '';
      if (tileData.assetId) el.dataset.assetId = tileData.assetId;

      // 6. Apply occupied class
      el.classList.add('occupied');
    }
  });

  // PHASE 5: Refresh admin overlays if admin is active
  if (typeof refreshAdminOverlays === 'function') {
    refreshAdminOverlays();
  }

  // PHASE 6: Finalize layout
  finalizeAfterRender(wall);

  console.log(LOG.render, 'renderWallFromState');
}

// PHASE 3: Single render choke point for explicit state changes
function commitWallStateChange(reason) {
  if (DEBUG) console.log('[PHASE 3] commitWallStateChange:', reason);
  renderWallFromState();
  console.log(LOG.render, 'commitWallStateChange:', reason);
}

document.addEventListener("DOMContentLoaded", () => {
  const wall = $(SEL.wall);
  const colorPicker = $("gridColorPicker");
  const outlineToggle = $("outlineToggle");

  // ========== Fixed Header Offset ==========
  // Dynamically calculate header height and set CSS variable
  // to offset content below the fixed header
  function setHeaderOffset() {
    const header = document.querySelector('.controls');
    if (header) {
      const height = header.offsetHeight;
      document.documentElement.style.setProperty('--header-height', `${height}px`);
      if (DEBUG) console.log('Header offset set to:', height + 'px');
    }
  }

  // Set on load and resize
  setHeaderOffset();
  window.addEventListener('resize', setHeaderOffset);

  // Ensure popup is present and wired (safe even if you later move it into HTML)
  wirePopupEventsOnce();

  // ========================================
  // Wall Refresh (used by admin.js and upload_modal.js)
  // ========================================
  async function refreshWallFromServer() {
    try {
      // Fetch current state (safe: allow DB/API to be unwired during development)
      let assignments = [];
      try {
        const response = await fetch(API.wallState, { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          assignments = data.assignments || [];
        } else {
          if (DEBUG) console.warn('[refreshWallFromServer] wall_state unavailable:', response.status);
        }
      } catch (err) {
        if (DEBUG) console.warn('[refreshWallFromServer] wall_state fetch failed:', err);
      }

      if (DEBUG) console.log('Refreshed wall state, assignments:', assignments.length);

      // Update state with new assignments (preserve existing layout)
      Object.keys(wallState.tiles).forEach(tileId => {
        // Clear all assets first
        wallState.tiles[tileId].assetId = null;
        wallState.tiles[tileId].asset = null;
      });

      // Apply new assignments to state (all metadata fields)
      assignments.forEach(assignment => {
        const tileId = assignment.tile_id;
        if (wallState.tiles[tileId]) {
          wallState.tiles[tileId].assetId = assignment.asset_id;
          wallState.tiles[tileId].asset = {
            tile_url: assignment.tile_url,
            popup_url: assignment.popup_url,
            artwork_name: assignment.artwork_name,
            artist_name: assignment.artist_name,
            year_created: assignment.year_created || "",
            medium: assignment.medium || "",
            dimensions: assignment.dimensions || "",
            edition_info: assignment.edition_info || "",
            for_sale: assignment.for_sale || "",
            sale_type: assignment.sale_type || "",
            contact1_type: assignment.contact1_type || "",
            contact1_value: assignment.contact1_value || "",
            contact2_type: assignment.contact2_type || "",
            contact2_value: assignment.contact2_value || ""
          };
        }
      });

      // PHASE 3: Single render after state update (refreshAdminOverlays called inside)
      commitWallStateChange('refreshWallFromServer');

      // Reset zoom to 1.0x so user sees refreshed content at normal scale
      resetZoom();
    } catch (err) {
      console.error('Failed to refresh wall from server:', err);
    }
  }
  // Expose for other modules (e.g., upload_modal.js, admin.js)
  window.refreshWallFromServer = refreshWallFromServer;

  // Expose captureStateSnapshot stub (admin.js may call it)
  window.captureStateSnapshot = function() {
    // State snapshots handled server-side via undo history
  };

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
        // ⚠️ PHASE 1 AUDIT: innerHTML mutation (error fallback, not render)
        wall.innerHTML = `
          <div style="color:#fff; padding:16px; font-family:system-ui;">
            No tiles generated from SVG. Check that <code>${SVG_GRID_PATH}</code> exists
            and contains &lt;rect&gt; elements.
          </div>
        `;
        return;
      }

      const { width, height } = computeWallDimensions(tiles);
      const layoutTiles = buildLayoutTiles(tiles, height);

      // PHASE 2: Fetch wall state from server and hydrate
      // Called by: initial boot (DOMContentLoaded)
      //
      // IMPORTANT: During development, we may temporarily "unwire" the DB and/or API.
      // If /api/wall_state is unavailable or returns non-JSON, we still want the grid
      // to render (as empty tiles) instead of failing the entire boot sequence.
      let assignments = [];
      try {
        const response = await fetch(API.wallState, { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          if (DEBUG) console.log('wall_state response:', data);
          assignments = data.assignments || [];
          if (DEBUG) console.log('wall_state assignments:', assignments.length);
        } else {
          if (DEBUG) console.warn('wall_state unavailable (continuing with empty state):', response.status);
        }
      } catch (err) {
        if (DEBUG) console.warn('wall_state fetch failed (continuing with empty state):', err);
      }

      // PHASE 2: Hydrate state, then render from state
      hydrateWallStateFromExistingData(layoutTiles, assignments);
      // PHASE 3: Single render after state hydration
      commitWallStateChange(assignments.length ? 'boot hydration' : 'boot hydration (no-db)');
      // Show welcome banner AFTER boot hydration/render has completed
      requestAnimationFrame(() => initSimpleWelcomeAlways());

      // Tile click → open popup (delegated; only for tiles with uploaded artwork)
      wall.addEventListener("click", (e) => {
        const tileEl = e.target.closest(".tile");
        if (!tileEl) return;

        // Track selected tile for admin operations
        window.selectedTileId = tileEl.dataset.id;
        if (DEBUG) console.log('Selected tile:', window.selectedTileId);

        // Check for uploaded asset with metadata (from database hydration)
        const popupUrl = tileEl.dataset.popupUrl;
        const artworkName = tileEl.dataset.artworkName;
        const artistName = tileEl.dataset.artistName;

        // Only open popup if tile has uploaded artwork (ignore demo artUrl)
        if (!popupUrl) return;

        // Display metadata from wall_state (all fields)
        openArtworkPopup({
          imgSrc: popupUrl,
          title: artworkName || "",
          artist: artistName || "",
          yearCreated: tileEl.dataset.yearCreated || "",
          medium: tileEl.dataset.medium || "",
          dimensions: tileEl.dataset.dimensions || "",
          editionInfo: tileEl.dataset.editionInfo || "",
          forSale: tileEl.dataset.forSale || "",
          saleType: tileEl.dataset.saleType || "",
          contact1Type: tileEl.dataset.contact1Type || "",
          contact1Value: tileEl.dataset.contact1Value || "",
          contact2Type: tileEl.dataset.contact2Type || "",
          contact2Value: tileEl.dataset.contact2Value || ""
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

      // Size overlays on resize and orientation change (mobile support)
      window.addEventListener('resize', () => finalizeAfterRender(wall));
      window.addEventListener('orientationchange', () => {
        setTimeout(() => finalizeAfterRender(wall), 50);
      });

      // Center gallery and initialize pinch-to-zoom after wall is fully rendered
      requestAnimationFrame(() => {
        centerGalleryView();
        initZoom();
      });
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
