// ========================================
// Admin Module for The Last Gallery
// Extracted from main.js for better organization
// ========================================

(function() {
  "use strict";

  // Guard against double initialization
  if (window.__adminModuleInitialized) {
    console.warn('[admin.js] Already initialized, skipping');
    return;
  }
  window.__adminModuleInitialized = true;

  // ========================================
  // Dependencies from main.js (globals)
  // ========================================
  const $ = (id) => document.getElementById(id);

  // These are defined in main.js and exposed globally
  const getAdminPin = () => window.ADMIN_PIN || "8375";
  const getApi = () => window.API || {
    tileInfo: '/api/admin/tile_info',
    undo: '/api/admin/undo',
    clearTile: '/api/admin/clear_tile',
    clearAll: '/api/admin/clear_all_tiles',
    moveTile: '/api/admin/move_tile_asset',
    historyStatus: '/api/admin/history_status',
  };
  const getSel = () => window.SEL || {
    tile: '.tile',
    adminTileLabel: '.admin-tile-label',
    tileLabel: '.tile-label',
  };
  const getDebugMode = () => window.DEBUG || false;
  const getAdminDebug = () => window.ADMIN_DEBUG || false;

  // ========================================
  // Admin State
  // ========================================
  let adminUnlocked = false;
  let showTileLabels = false;

  // ========================================
  // Admin Helper Functions
  // ========================================

  function isAdminActive() {
    return adminUnlocked === true;
  }

  // Expose globally for main.js refreshAdminOverlays call
  window.isAdminActive = isAdminActive;

  function normalizeHistoryCounts(data) {
    // New format: separate counts
    if (data.shuffle_count !== undefined && data.non_shuffle_count !== undefined) {
      return {
        shuffle_count: data.shuffle_count,
        non_shuffle_count: data.non_shuffle_count,
        non_shuffle_total: data.non_shuffle_total ?? data.non_shuffle_count,
        last_shuffle_id: data.last_shuffle_id ?? null
      };
    }

    // Legacy format: single history_count
    if (data.history_count !== undefined) {
      return {
        shuffle_count: data.history_count,
        non_shuffle_count: data.history_count,
        non_shuffle_total: data.history_count,
        last_shuffle_id: null
      };
    }

    // Empty/unknown format
    return {
      shuffle_count: 0,
      non_shuffle_count: 0,
      non_shuffle_total: 0,
      last_shuffle_id: null
    };
  }

  // ========================================
  // Admin Tile Labels
  // ========================================

  function clearAllAdminTileLabels() {
    const allLabels = document.querySelectorAll('.admin-tile-label');
    allLabels.forEach(label => label.remove());
  }

  function applyAdminTileLabel(tileEl) {
    if (!isAdminActive() || !showTileLabels) return;

    let label = tileEl.querySelector('.admin-tile-label');
    if (label) {
      label.textContent = tileEl.dataset.id;
      label.style.display = 'block';
      return;
    }

    label = document.createElement('div');
    label.classList.add('admin-tile-label');
    label.textContent = tileEl.dataset.id;
    tileEl.appendChild(label);
  }

  function updateAllAdminTileLabels() {
    if (!isAdminActive() || !showTileLabels) return;

    const wall = $(window.SEL?.wall || 'galleryWall');
    if (!wall) return;

    const allTiles = wall.querySelectorAll('.tile');
    allTiles.forEach(tile => {
      const existingLabels = tile.querySelectorAll('.admin-tile-label');

      if (existingLabels.length === 0) {
        const label = document.createElement('div');
        label.classList.add('admin-tile-label');
        label.textContent = tile.dataset.id;
        tile.appendChild(label);
      } else {
        existingLabels[0].textContent = tile.dataset.id;
        existingLabels[0].style.display = 'block';
        for (let i = 1; i < existingLabels.length; i++) {
          existingLabels[i].remove();
        }
      }
    });
  }

  // ========================================
  // Admin Overlays & Debug Footer
  // ========================================

  function refreshAdminOverlays(historyData) {
    if (!isAdminActive()) {
      clearAllAdminTileLabels();
    } else if (showTileLabels) {
      updateAllAdminTileLabels();
    } else {
      clearAllAdminTileLabels();
    }

    if (getAdminDebug() && isAdminActive()) {
      const data = historyData || window.lastHistoryData || {};
      const normalized = normalizeHistoryCounts(data);
      updateAdminDebugFooter(normalized.shuffle_count, normalized.non_shuffle_count);
    }
  }

  // Expose globally for main.js
  window.refreshAdminOverlays = refreshAdminOverlays;

  function updateAdminDebugFooter(shuffle_count, non_shuffle_count) {
    if (!getAdminDebug()) return;

    const footer = $("adminDebugFooter");
    if (!footer) return;

    const data = window.lastHistoryData || {};
    const non_shuffle_total = data.non_shuffle_total ?? '?';
    const last_shuffle_id = data.last_shuffle_id ?? 'none';

    footer.textContent = `Undo: ${non_shuffle_count} eligible / ${non_shuffle_total} total | Shuffle Undo: ${shuffle_count} | Last Shuffle ID: ${last_shuffle_id}`;
    footer.style.display = 'block';
  }

  // ========================================
  // Undo Button State
  // ========================================

  function updateUndoButton(dataOrShuffleCount, nonShuffleCount) {
    let counts;
    if (typeof dataOrShuffleCount === 'object') {
      counts = normalizeHistoryCounts(dataOrShuffleCount);
    } else {
      counts = normalizeHistoryCounts({
        shuffle_count: dataOrShuffleCount,
        non_shuffle_count: nonShuffleCount
      });
    }

    const undoBtn = $("undoBtn");
    if (undoBtn) {
      undoBtn.disabled = counts.non_shuffle_count === 0;
      undoBtn.title = counts.non_shuffle_count === 0 ? "No undoable actions after the last shuffle" : "";
    }

    const undoShuffleBtn = $("undoShuffleBtn");
    if (undoShuffleBtn) {
      undoShuffleBtn.disabled = counts.shuffle_count === 0;
      undoShuffleBtn.title = counts.shuffle_count === 0 ? "No shuffle to undo" : "";
    }
  }

  async function fetchHistoryStatus() {
    if (!isAdminActive()) return;

    try {
      const response = await fetch(getApi().historyStatus, {
        headers: { 'X-Admin-Pin': getAdminPin() }
      });

      if (response.ok) {
        const data = await response.json();
        window.lastHistoryData = data;
        updateUndoButton(data);
        refreshAdminOverlays(data);
      }
    } catch (err) {
      if (getDebugMode()) console.warn('Failed to fetch history status:', err);
    }
  }

  // ========================================
  // Admin Status Messages
  // ========================================

  function showAdminStatus(message, type = "info") {
    const adminStatus = $("adminStatus");
    if (!adminStatus) return;

    adminStatus.textContent = message;
    adminStatus.classList.remove("hidden", "error", "success");

    if (type === "error") {
      adminStatus.classList.add("error");
    } else if (type === "success") {
      adminStatus.classList.add("success");
    }

    setTimeout(() => {
      adminStatus.classList.add("hidden");
    }, 5000);
  }

  // ========================================
  // Admin Modal Functions
  // ========================================

  let _modalInitialized = false;

  function initAdminModal() {
    if (_modalInitialized) {
      console.warn('[admin.js] initAdminModal already called, skipping');
      return;
    }
    _modalInitialized = true;

    const adminBtn = $("adminBtn");
    const adminModal = $("adminModal");
    const adminCloseBtn = $("adminCloseBtn");
    const adminPinGate = $("adminPinGate");
    const adminPinInput = $("adminPinInput");
    const adminPinSubmit = $("adminPinSubmit");
    const adminPinError = $("adminPinError");
    const adminControlsPanel = $("adminControlsPanel");
    const colorPicker = $("gridColorPicker");

    function openAdminModal() {
      if (!adminModal) return;
      adminModal.classList.remove("hidden");

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

      if (pin !== getAdminPin()) {
        showPinError("Incorrect PIN");
        return;
      }

      adminUnlocked = true;
      hidePinError();

      adminPinGate?.classList.add("hidden");
      adminControlsPanel?.classList.remove("hidden");

      colorPicker?.focus();

      setTimeout(() => {
        if (showTileLabels) {
          refreshAdminOverlays();
        }
        fetchHistoryStatus();
      }, 0);
    }

    // Wire events
    adminBtn?.addEventListener("click", openAdminModal);
    adminCloseBtn?.addEventListener("click", closeAdminModal);

    if (adminModal) {
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
  }

  // ========================================
  // Admin Action Handlers
  // ========================================

  let _actionsInitialized = false;

  function initAdminActions() {
    // Guard against duplicate initialization
    if (_actionsInitialized) {
      console.warn('[admin.js] initAdminActions already called, skipping');
      return;
    }
    _actionsInitialized = true;

    const wall = $(window.SEL?.wall || 'galleryWall');
    const clearTileBtn = $("clearTileBtn");
    const clearAllTilesBtn = $("clearAllTilesBtn");
    const undoBtn = $("undoBtn");
    const moveArtworkBtn = $("moveArtworkBtn");
    const adminClearTileIdInput = $("adminClearTileIdInput");
    const adminMoveFromInput = $("adminMoveFromInput");
    const adminMoveToInput = $("adminMoveToInput");

    // Clear Single Tile
    clearTileBtn?.addEventListener("click", async (e) => {
      e.stopPropagation();

      // Prevent double-clicks during async operation
      if (clearTileBtn.disabled) return;
      clearTileBtn.disabled = true;

      try {
        const tileId = (adminClearTileIdInput?.value || "").trim().toUpperCase();

        if (!tileId) {
          showAdminStatus("Enter a tile ID", "error");
          return;
        }

        const tileEl = wall?.querySelector(`.tile[data-id="${tileId}"]`);
        if (!tileEl) {
          showAdminStatus("Tile ID not found", "error");
          return;
        }

        const infoResponse = await fetch(`${getApi().tileInfo}?tile_id=${encodeURIComponent(tileId)}`, {
          headers: { 'X-Admin-Pin': getAdminPin() }
        });

        if (!infoResponse.ok) {
          throw new Error(`Failed to fetch tile info: ${infoResponse.status}`);
        }

        const tileInfo = await infoResponse.json();

        if (!tileInfo.occupied) {
          showAdminStatus("Tile is empty", "error");
          return;
        }

        const confirmMsg = `Remove "${tileInfo.artwork_name}" by ${tileInfo.artist_name} from ${tileId}?`;
        if (!confirm(confirmMsg)) return;

        if (typeof window.captureStateSnapshot === 'function') {
          window.captureStateSnapshot();
        }

        const response = await fetch(getApi().clearTile, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Pin': getAdminPin()
          },
          body: JSON.stringify({ tile_id: tileId })
        });

        if (!response.ok) {
          throw new Error(`Clear tile failed: ${response.status}`);
        }

        const result = await response.json();
        updateUndoButton(result);

        if (typeof window.refreshWallFromServer === 'function') {
          await window.refreshWallFromServer();
        }

        showAdminStatus(`Cleared ${tileId}`, "success");
        if (adminClearTileIdInput) adminClearTileIdInput.value = "";
      } catch (err) {
        console.error('Failed to clear tile:', err);
        showAdminStatus('Failed to clear tile', "error");
      } finally {
        clearTileBtn.disabled = false;
      }
    });

    // Clear All Tiles
    clearAllTilesBtn?.addEventListener("click", async (e) => {
      e.stopPropagation();

      // Prevent double-clicks during async operation
      if (clearAllTilesBtn.disabled) return;

      if (!confirm("Clear all tiles? This can be undone.")) return;

      clearAllTilesBtn.disabled = true;

      try {
        if (typeof window.captureStateSnapshot === 'function') {
          window.captureStateSnapshot();
        }

        const response = await fetch(getApi().clearAll, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Pin': getAdminPin()
          }
        });

        if (!response.ok) {
          throw new Error(`Clear all failed: ${response.status}`);
        }

        const result = await response.json();
        updateUndoButton(result);

        if (typeof window.refreshWallFromServer === 'function') {
          await window.refreshWallFromServer();
        }

        showAdminStatus("Cleared all tiles", "success");
      } catch (err) {
        console.error('Failed to clear all tiles:', err);
        showAdminStatus('Failed to clear all tiles', "error");
      } finally {
        clearAllTilesBtn.disabled = false;
      }
    });

    // Move Artwork
    moveArtworkBtn?.addEventListener("click", async (e) => {
      e.stopPropagation();

      // Prevent double-clicks during async operation
      if (moveArtworkBtn.disabled) return;

      const fromId = (adminMoveFromInput?.value || "").trim().toUpperCase();
      const toId = (adminMoveToInput?.value || "").trim().toUpperCase();

      if (!fromId || !toId) {
        showAdminStatus("Enter both tile IDs", "error");
        return;
      }

      const fromTileEl = wall?.querySelector(`.tile[data-id="${fromId}"]`);
      const toTileEl = wall?.querySelector(`.tile[data-id="${toId}"]`);

      if (!fromTileEl || !toTileEl) {
        showAdminStatus("Tile ID not found", "error");
        return;
      }

      const fromRect = fromTileEl.getBoundingClientRect();
      const toRect = toTileEl.getBoundingClientRect();
      const TOLERANCE = 2;

      const widthMatch = Math.abs(fromRect.width - toRect.width) <= TOLERANCE;
      const heightMatch = Math.abs(fromRect.height - toRect.height) <= TOLERANCE;
      const sizeMatches = widthMatch && heightMatch;

      if (!sizeMatches) {
        window.pendingMove = { fromId, toId };
        const overrideModal = $("moveOverrideModal");
        if (overrideModal) {
          overrideModal.classList.remove("hidden");
        }
        return;
      }

      moveArtworkBtn.disabled = true;
      try {
        await executeTileMove(fromId, toId, false);
      } finally {
        moveArtworkBtn.disabled = false;
      }
    });

    // Override confirmation modal handlers
    const moveOverrideModal = $("moveOverrideModal");
    const moveOverrideProceedBtn = $("moveOverrideProceedBtn");
    const moveOverrideCancelBtn = $("moveOverrideCancelBtn");

    moveOverrideProceedBtn?.addEventListener("click", async (e) => {
      e.stopPropagation();

      // Prevent double-clicks
      if (moveOverrideProceedBtn.disabled) return;
      moveOverrideProceedBtn.disabled = true;

      if (moveOverrideModal) {
        moveOverrideModal.classList.add("hidden");
      }

      try {
        if (window.pendingMove) {
          const { fromId, toId } = window.pendingMove;
          await executeTileMove(fromId, toId, true);
          window.pendingMove = null;
        }
      } finally {
        moveOverrideProceedBtn.disabled = false;
      }
    });

    moveOverrideCancelBtn?.addEventListener("click", () => {
      if (moveOverrideModal) {
        moveOverrideModal.classList.add("hidden");
      }
      window.pendingMove = null;
      showAdminStatus("Move cancelled", "error");
    });

    async function executeTileMove(fromId, toId, override) {
      try {
        const fromInfoResponse = await fetch(`${getApi().tileInfo}?tile_id=${encodeURIComponent(fromId)}`, {
          headers: { 'X-Admin-Pin': getAdminPin() }
        });

        if (!fromInfoResponse.ok) {
          throw new Error(`Failed to fetch source tile info: ${fromInfoResponse.status}`);
        }

        const fromInfo = await fromInfoResponse.json();

        if (!fromInfo.occupied) {
          showAdminStatus("Source tile is empty", "error");
          return;
        }

        const toInfoResponse = await fetch(`${getApi().tileInfo}?tile_id=${encodeURIComponent(toId)}`, {
          headers: { 'X-Admin-Pin': getAdminPin() }
        });

        if (!toInfoResponse.ok) {
          throw new Error(`Failed to fetch destination tile info: ${toInfoResponse.status}`);
        }

        const toInfo = await toInfoResponse.json();

        if (toInfo.occupied) {
          showAdminStatus("Destination tile is occupied", "error");
          return;
        }

        if (!override) {
          const confirmMsg = `Move "${fromInfo.artwork_name}" by ${fromInfo.artist_name} from ${fromId} to ${toId}?`;
          if (!confirm(confirmMsg)) return;
        }

        if (typeof window.captureStateSnapshot === 'function') {
          window.captureStateSnapshot();
        }

        const response = await fetch(getApi().moveTile, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Pin': getAdminPin()
          },
          body: JSON.stringify({
            from_tile_id: fromId,
            to_tile_id: toId,
            override: override
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Move failed: ${response.status}`);
        }

        const result = await response.json();
        updateUndoButton(result);

        if (typeof window.refreshWallFromServer === 'function') {
          await window.refreshWallFromServer();
        }

        showAdminStatus(`Moved ${fromId} → ${toId}${override ? ' (override)' : ''}`, "success");
        if (adminMoveFromInput) adminMoveFromInput.value = "";
        if (adminMoveToInput) adminMoveToInput.value = "";
      } catch (err) {
        console.error('Failed to move artwork:', err);
        showAdminStatus(err.message || 'Failed to move artwork', "error");
      }
    }

    // Undo
    undoBtn?.addEventListener("click", async (e) => {
      e.stopPropagation();

      // Prevent double-clicks during async operation
      if (undoBtn.disabled) return;
      undoBtn.disabled = true;

      try {
        const response = await fetch(getApi().undo, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Pin': getAdminPin()
          },
          body: JSON.stringify({ action_type: 'non_shuffle' })
        });

        if (!response.ok) {
          throw new Error(`Undo failed: ${response.status}`);
        }

        const result = await response.json();

        if (!result.ok) {
          showAdminStatus(result.message || "Nothing to undo", "error");
          return;
        }

        updateUndoButton(result);

        if (typeof window.refreshWallFromServer === 'function') {
          await window.refreshWallFromServer();
        }

        showAdminStatus("Undo successful", "success");
      } catch (err) {
        console.error('Failed to undo:', err);
        showAdminStatus('Failed to undo', 'error');
      } finally {
        // Re-enable based on history status (updateUndoButton will manage state)
        fetchHistoryStatus();
      }
    });
  }

  // ========================================
  // Shuffle & Undo Shuffle Handlers
  // ========================================

  let _shuffleInitialized = false;

  function initShuffleHandlers() {
    if (_shuffleInitialized) {
      console.warn('[admin.js] initShuffleHandlers already called, skipping');
      return;
    }
    _shuffleInitialized = true;

    const undoShuffleBtn = $("undoShuffleBtn");
    const undoShuffleModal = $("undoShuffleModal");
    const undoShuffleProceedBtn = $("undoShuffleProceedBtn");
    const undoShuffleCancelBtn = $("undoShuffleCancelBtn");
    const shuffleButton = $("shuffleButton");

    undoShuffleBtn?.addEventListener("click", () => {
      if (undoShuffleModal) {
        undoShuffleModal.classList.remove("hidden");
      }
    });

    undoShuffleProceedBtn?.addEventListener("click", async (e) => {
      e.stopPropagation();

      // Prevent double-clicks
      if (undoShuffleProceedBtn.disabled) return;
      undoShuffleProceedBtn.disabled = true;

      if (undoShuffleModal) {
        undoShuffleModal.classList.add("hidden");
      }

      try {
        const response = await fetch(getApi().undo, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Pin': getAdminPin()
          },
          body: JSON.stringify({ action_type: 'shuffle' })
        });

        if (!response.ok) {
          throw new Error(`Undo shuffle failed: ${response.status}`);
        }

        const result = await response.json();

        if (!result.ok) {
          alert(result.message || "Nothing to undo");
          return;
        }

        updateUndoButton(result);

        if (typeof window.refreshWallFromServer === 'function') {
          await window.refreshWallFromServer();
        }

        alert("Shuffle undone successfully");
      } catch (err) {
        console.error('Failed to undo shuffle:', err);
        alert('Failed to undo shuffle: ' + err.message);
      } finally {
        undoShuffleProceedBtn.disabled = false;
      }
    });

    undoShuffleCancelBtn?.addEventListener("click", () => {
      if (undoShuffleModal) {
        undoShuffleModal.classList.add("hidden");
      }
    });

    // Shuffle button
    shuffleButton?.addEventListener("click", async (e) => {
      e.stopPropagation();

      // Prevent double-clicks
      if (shuffleButton.disabled) return;

      const pinEl = $("adminPinInput");
      const pin = (pinEl?.value || "").trim();

      if (!pin) {
        alert("Enter admin PIN first.");
        return;
      }

      shuffleButton.disabled = true;

      try {
        if (typeof window.captureStateSnapshot === 'function') {
          window.captureStateSnapshot();
        }

        const response = await fetch("/shuffle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin })
        });

        if (response.status === 403 || response.status === 401) {
          alert("Forbidden: invalid admin PIN.");
          return;
        }

        if (!response.ok) {
          alert("Shuffle failed: " + response.status);
          return;
        }

        const result = await response.json();
        updateUndoButton(result);

        if (typeof window.refreshWallFromServer === 'function') {
          await window.refreshWallFromServer();
        }
      } catch (err) {
        console.error("Shuffle error:", err);
        alert("Shuffle failed: " + err.message);
      } finally {
        shuffleButton.disabled = false;
      }
    });
  }

  // ========================================
  // Show Tile Labels Toggle
  // ========================================

  let _labelsInitialized = false;

  function initTileLabelsToggle() {
    if (_labelsInitialized) {
      console.warn('[admin.js] initTileLabelsToggle already called, skipping');
      return;
    }
    _labelsInitialized = true;

    const showTileLabelsToggle = $("showTileLabelsToggle");

    if (showTileLabelsToggle) {
      showTileLabelsToggle.addEventListener("change", (e) => {
        showTileLabels = e.target.checked;
        refreshAdminOverlays();

        if (showTileLabels) {
          setTimeout(() => {
            if (showTileLabels === e.target.checked) {
              refreshAdminOverlays();
            }
          }, 0);
        }

        if (getDebugMode()) console.log('Show Tile Labels:', showTileLabels);
      });
    }
  }

  // ========================================
  // Initialize Admin Module
  // ========================================

  let _initialized = false;

  function init() {
    if (_initialized) {
      console.warn('[admin.js] init() already called, skipping');
      return;
    }
    _initialized = true;

    initAdminModal();
    initAdminActions();
    initShuffleHandlers();
    initTileLabelsToggle();

    // Track selected tile for admin operations
    window.selectedTileId = null;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose necessary functions globally
  window.AdminModule = {
    isAdminActive,
    refreshAdminOverlays,
    updateUndoButton,
    fetchHistoryStatus,
    showAdminStatus
  };

})();
