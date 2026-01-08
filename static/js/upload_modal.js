document.addEventListener("DOMContentLoaded", () => {
  // ===== DOM refs =====
  const modal = document.getElementById("uploadModal");
  const openBtn = document.getElementById("addArtworkBtn");
  const cancelBtn = document.getElementById("cancelUploadBtn");

  const fileInput = document.getElementById("uploadFile");
  const previewImg = document.getElementById("previewImage");
  const continueBtn = document.getElementById("uploadContinue");

  // ===== State =====
  let selectedFile = null;
  let currentObjectUrl = null;
  let cropper = null;
  
  // Track current upload tile ID for Tier-2 metadata modal
  let currentUploadTileId = null;

  // ================================
  // Cropper: Block Android "Copy image"
  // ================================
  let cropperContextMenuBlocker = null;

  // Global helpers for ConicalNav
  window.isUploadModalOpen = function() {
    return modal && !modal.classList.contains("hidden");
  };

  window.closeUploadModal = function(silent) {
    closeModal(silent);
  };

  function enableCropperContextMenuBlocker() {
    if (cropperContextMenuBlocker) return;

    cropperContextMenuBlocker = (e) => {
      const inCropper = e.target && e.target.closest && e.target.closest(".cropper-container");
      if (inCropper) {
        e.preventDefault();
      }
    };

    document.addEventListener("contextmenu", cropperContextMenuBlocker, true);
  }

  function disableCropperContextMenuBlocker() {
    if (!cropperContextMenuBlocker) return;
    document.removeEventListener("contextmenu", cropperContextMenuBlocker, true);
    cropperContextMenuBlocker = null;
  }

  // ===== Constants =====
  const LOG_PREFIX = "[upload_modal]";
  const SUPPORTED_TYPES_RE = /^image\/(png|jpeg)$/;

  // ===== Guard =====
  if (!modal || !openBtn || !cancelBtn || !fileInput || !previewImg || !continueBtn) {
    console.warn(`${LOG_PREFIX} Missing required DOM elements.`);
    return;
  }

  // ===== Helpers =====
  function revokeObjectUrl() {
    if (!currentObjectUrl) return;
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  function initCropper() {
    if (cropper) return; // Guard against duplicate init
    cropper = new Cropper(previewImg, {
      aspectRatio: 1,
      autoCropArea: 1,
      viewMode: 1,
      cropBoxMovable: true,
      cropBoxResizable: true,
      responsive: true,
      dragMode: "crop",
      guides: true,
      center: true,
      highlight: true,
      background: false,
      minCropBoxWidth: 30,
      minCropBoxHeight: 30
    });
  }

  function destroyCropper() {
    if (!cropper) return;
    cropper.destroy();
    cropper = null;
  }

  function resetModalState() {
    revokeObjectUrl();
    previewImg.src = "";
    previewImg.classList.add("hidden");
    fileInput.value = "";
    selectedFile = null;
    continueBtn.disabled = true;
  }

  function openModal() {
    modal.classList.remove("hidden");
    continueBtn.disabled = true;
    enableCropperContextMenuBlocker();
    window.ConicalNav && window.ConicalNav.pushToMatchUi();
  }

  function closeModal(silent) {
    modal.classList.add("hidden");
    destroyCropper();
    resetModalState();
    disableCropperContextMenuBlocker();
    if (!silent) {
      window.ConicalNav && window.ConicalNav.popFromUiClose();
    }
  }

  // ===== Events =====
  openBtn.addEventListener("click", openModal);
  cancelBtn.addEventListener("click", closeModal);

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!SUPPORTED_TYPES_RE.test(file.type)) {
      console.warn(`${LOG_PREFIX} Unsupported file type:`, file.type);
      resetModalState();
      return;
    }

    revokeObjectUrl();
    selectedFile = file;
    currentObjectUrl = URL.createObjectURL(file);

    previewImg.onload = () => {
      previewImg.onload = null;
      previewImg.onerror = null;
      previewImg.classList.remove("hidden");
      continueBtn.disabled = false;
      console.log(`${LOG_PREFIX} Image loaded successfully`);
      destroyCropper();
      initCropper();
    };

    previewImg.onerror = () => {
      previewImg.onload = null;
      previewImg.onerror = null;
      console.error(`${LOG_PREFIX} Image failed to load.`);
      resetModalState();
    };

    previewImg.src = currentObjectUrl;
    console.log(`${LOG_PREFIX} Loaded image object URL:`, currentObjectUrl);
  });

  // =========================================================
  // Upload + place (Tier-1 only: image/crop)
  //
  // Contract (expected):
  // POST /api/upload_assets (multipart/form-data)
  //   - tile_image: cropped square (for grid)
  //   - popup_image: cropped square (for popup)
  // Returns JSON. After success we reload to pull /api/wall_state.
  //
  // If your backend uses a different route (e.g. /api/upload_asset),
  // we try that as a fallback.
  // =========================================================

  function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
      if (!canvas) return reject(new Error("No canvas to export"));
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Failed to export image blob"))),
        mimeType,
        quality
      );
    });
  }

  async function postWithFallback(formData) {
    const endpoints = ["/api/upload_assets", "/api/upload_asset"];
    let lastErr = null;

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { method: "POST", body: formData });
        if (res.status === 404) {
          lastErr = new Error(`404 at ${url}`);
          continue;
        }

        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch (_) { /* ignore */ }

        if (!res.ok) {
          const msg = (json && (json.error || json.message)) || text || `HTTP ${res.status}`;
          throw new Error(`Upload failed (${res.status}): ${msg}`);
        }

        return json || {};
      } catch (e) {
        lastErr = e;
      }
    }

    throw lastErr || new Error("Upload failed");
  }

  async function uploadCroppedAndRefresh() {
    if (!selectedFile || !cropper) {
      alert("Please choose an image first.");
      return;
    }

    continueBtn.disabled = true;
    continueBtn.dataset.busy = "1";
    console.log(`${LOG_PREFIX} Upload starting...`);

    try {
      // Export two sizes: a smaller tile image and a higher-res popup image.
      // (Server can still re-encode/resize as needed.)
      const tileCanvas = cropper.getCroppedCanvas({
        width: 512,
        height: 512,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high"
      });
      const tileBlob = await canvasToBlob(tileCanvas, "image/jpeg", 0.9);
      const ts = Date.now();
      const formData = new FormData();
      formData.append("tile_image", tileBlob, `tile_${ts}.jpg`);
      formData.append("popup_image", selectedFile, selectedFile?.name || `popup_${ts}.jpg`);// Keep metadata empty for now (site is in "metadata purge" mode).
      // If/when re-enabled, append fields here.

      const result = await postWithFallback(formData);
      console.log(`${LOG_PREFIX} Upload success:`, result);
      console.warn("[UPLOAD] upload complete reached");  // TEMP DEBUG

      // Store tile_id and open Tier-2 metadata modal
      if (result && result.tile_id) {
        currentUploadTileId = result.tile_id;
        openMetaModal(result.tile_id);
      } else {
        // Fallback: close and refresh if no tile_id
        closeModal(true);
        await refreshWall();
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} Upload error:`, err);
      alert(err && err.message ? err.message : "Upload failed. Check console for details.");
    } finally {
      continueBtn.disabled = false;
      delete continueBtn.dataset.busy;
    }
  }

  // Continue button now performs: upload + placement (server-side) + refresh
  continueBtn.addEventListener("click", () => {
    if (continueBtn.dataset.busy === "1") return;
    uploadCroppedAndRefresh();
  });

  // ===== Helper: Refresh wall =====
  async function refreshWall() {
    if (typeof window.refreshWallFromServer === "function") {
      await window.refreshWallFromServer();
    } else if (typeof window.loadWallState === "function") {
      await window.loadWallState();
    } else {
      window.location.reload();
    }
  }

  // ========================================
  // Tier-2 Metadata Modal Functions
  // ========================================

  const metaOverlay = document.getElementById("metaModalOverlay");
  const metaModal = document.getElementById("metaModal");
  const metaCloseBtn = document.getElementById("metaCloseBtn");
  const metaSkipBtn = document.getElementById("metaSkipBtn");
  const metaSaveBtn = document.getElementById("metaSaveBtn");
  const metaArtistInput = document.getElementById("metaArtistInput");
  const metaTitleInput = document.getElementById("metaTitleInput");
  const metaError = document.getElementById("metaError");
  const metaSuccess = document.getElementById("metaSuccess");

  function openMetaModal(tileId) {
    if (!metaOverlay) return;
    
    currentUploadTileId = tileId;
    
    // Clear previous values
    if (metaArtistInput) metaArtistInput.value = "";
    if (metaTitleInput) metaTitleInput.value = "";
    if (metaError) metaError.classList.add("hidden");
    if (metaSuccess) metaSuccess.classList.add("hidden");
    if (metaSaveBtn) metaSaveBtn.disabled = false;
    
    // Show overlay
    metaOverlay.classList.remove("hidden");
    metaOverlay.setAttribute("aria-hidden", "false");
    
    // Focus first input
    setTimeout(() => {
      if (metaArtistInput) metaArtistInput.focus();
    }, 100);
    
    console.log(`${LOG_PREFIX} Tier-2 metadata modal opened for tile: ${tileId}`);
  }

  function closeMetaModal() {
    if (!metaOverlay) return;
    
    metaOverlay.classList.add("hidden");
    metaOverlay.setAttribute("aria-hidden", "true");
    
    console.log(`${LOG_PREFIX} Tier-2 metadata modal closed`);
  }

  async function saveMetaToDb(tileId) {
    if (!tileId) {
      console.error(`${LOG_PREFIX} No tile_id for metadata save`);
      return;
    }
    
    // Get and trim values
    const artistName = (metaArtistInput?.value || "").trim();
    const artworkTitle = (metaTitleInput?.value || "").trim();
    
    // Disable save button
    if (metaSaveBtn) metaSaveBtn.disabled = true;
    if (metaError) metaError.classList.add("hidden");
    if (metaSuccess) metaSuccess.classList.add("hidden");
    
    try {
      const response = await fetch(`/api/tile/${tileId}/metadata`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          artist_name: artistName,
          artwork_title: artworkTitle
        })
      });
      
      const result = await response.json();
      
      if (!response.ok || !result.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      
      console.log(`${LOG_PREFIX} Metadata saved successfully:`, result);
      console.warn("[META] metadata save success reached");  // TEMP DEBUG
      
      // Show success briefly
      if (metaSuccess) {
        metaSuccess.classList.remove("hidden");
        setTimeout(() => {
          metaSuccess.classList.add("hidden");
        }, 2000);
      }
      
      // Close Tier-2 modal after short delay
      setTimeout(() => {
        closeMetaModal();
        // Close Tier-1 upload modal
        closeModal(true);
        // Refresh wall
        refreshWall();
      }, 500);
      
    } catch (err) {
      console.error(`${LOG_PREFIX} Metadata save failed:`, err);
      
      // Show error
      if (metaError) {
        metaError.textContent = `Save failed: ${err.message}`;
        metaError.classList.remove("hidden");
      }
      
      // Re-enable save button
      if (metaSaveBtn) metaSaveBtn.disabled = false;
    }
  }

  // Wire Tier-2 modal buttons
  if (metaCloseBtn) {
    metaCloseBtn.addEventListener("click", () => {
      closeMetaModal();
      // Close Tier-1 and refresh
      closeModal(true);
      refreshWall();
    });
  }

  if (metaSkipBtn) {
    metaSkipBtn.addEventListener("click", () => {
      closeMetaModal();
      // Close Tier-1 and refresh
      closeModal(true);
      refreshWall();
    });
  }

  if (metaSaveBtn) {
    metaSaveBtn.addEventListener("click", () => {
      if (currentUploadTileId) {
        saveMetaToDb(currentUploadTileId);
      }
    });
  }

  // Allow Enter key to save in inputs
  if (metaArtistInput) {
    metaArtistInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && currentUploadTileId) {
        saveMetaToDb(currentUploadTileId);
      }
    });
  }

  if (metaTitleInput) {
    metaTitleInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && currentUploadTileId) {
        saveMetaToDb(currentUploadTileId);
      }
    });
  }
});
