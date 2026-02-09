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
  // Contract:
  // POST /api/upload_assets (multipart/form-data)
  //   - tile_image: cropped square (for grid)
  //   - popup_image: cropped square (for popup)
  // Returns JSON. After success we refresh wall via /api/wall_state.
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

  async function postUpload(formData) {
    const res = await fetch("/api/upload_assets", { method: "POST", body: formData });

    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* ignore */ }

    if (!res.ok) {
      const msg = (json && (json.error || json.message)) || text || `HTTP ${res.status}`;
      throw new Error(`Upload failed (${res.status}): ${msg}`);
    }

    return json || {};
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

      const result = await postUpload(formData);
      console.log(`${LOG_PREFIX} Upload success:`, result);

      // Refresh wall immediately so new image appears before metadata modal
      await refreshWall();

      // Store tile_id and open Tier-2 metadata modal
      if (result && result.tile_id) {
        currentUploadTileId = result.tile_id;
        openMetaModal(result.tile_id);
      } else {
        // Fallback: close if no tile_id (wall already refreshed above)
        closeModal(true);
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

  // ===== Helper: Soft refresh wall (NO page reload) =====
  async function refreshWall() {
    // Always use soft refresh - fetch wall_state and re-render
    if (typeof window.refreshWallFromServer === "function") {
      await window.refreshWallFromServer();
    } else {
      console.warn('[refreshWall] refreshWallFromServer not available');
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

  // Extended metadata field refs
  const metaYearInput = document.getElementById("metaYearInput");
  const metaMediumInput = document.getElementById("metaMediumInput");
  const metaDimensionsInput = document.getElementById("metaDimensionsInput");
  const metaEditionInput = document.getElementById("metaEditionInput");

  // Contact fields (2 sets with radio buttons)
  const metaContact1Input = document.getElementById("metaContact1Input");
  const metaContact2Input = document.getElementById("metaContact2Input");
  const contact1Radios = document.querySelectorAll('input[name="contact1Type"]');
  const contact2Radios = document.querySelectorAll('input[name="contact2Type"]');

  // Dynamic placeholder based on contact type selection
  const contactPlaceholders = {
    email: "e.g., artist@example.com",
    social: "e.g., instagram.com/artistname",
    website: "e.g., www.artistportfolio.com"
  };

  function updateContactPlaceholder(radios, input) {
    const selected = Array.from(radios).find(r => r.checked);
    if (selected && input) {
      input.placeholder = contactPlaceholders[selected.value] || "Enter contact info";
    } else if (input) {
      input.placeholder = "Select a contact type above";
    }
  }

  // Wire up radio button change handlers for dynamic placeholders
  contact1Radios.forEach(radio => {
    radio.addEventListener("change", () => updateContactPlaceholder(contact1Radios, metaContact1Input));
  });
  contact2Radios.forEach(radio => {
    radio.addEventListener("change", () => updateContactPlaceholder(contact2Radios, metaContact2Input));
  });

  // For-sale checkbox refs
  const metaForSaleYes = document.getElementById("metaForSaleYes");
  const metaForSaleNo = document.getElementById("metaForSaleNo");
  const metaSaleOriginal = document.getElementById("metaSaleOriginal");
  const metaSalePrint = document.getElementById("metaSalePrint");

  // Gray out Original/Print when "No" is selected
  function updateSaleTypeState() {
    const noSelected = metaForSaleNo && metaForSaleNo.checked;
    if (metaSaleOriginal) {
      metaSaleOriginal.disabled = noSelected;
      metaSaleOriginal.parentElement.classList.toggle("disabled", noSelected);
    }
    if (metaSalePrint) {
      metaSalePrint.disabled = noSelected;
      metaSalePrint.parentElement.classList.toggle("disabled", noSelected);
    }
  }

  // Wire up Yes/No checkbox listeners
  if (metaForSaleYes) {
    metaForSaleYes.addEventListener("change", () => {
      if (metaForSaleYes.checked && metaForSaleNo) {
        metaForSaleNo.checked = false;
      }
      updateSaleTypeState();
    });
  }
  if (metaForSaleNo) {
    metaForSaleNo.addEventListener("change", () => {
      if (metaForSaleNo.checked && metaForSaleYes) {
        metaForSaleYes.checked = false;
      }
      updateSaleTypeState();
    });
  }

  function openMetaModal(tileId) {
    if (!metaOverlay) return;
    
    currentUploadTileId = tileId;
    
    // Clear previous values
    if (metaArtistInput) metaArtistInput.value = "";
    if (metaTitleInput) metaTitleInput.value = "";
    if (metaYearInput) metaYearInput.value = "";
    if (metaMediumInput) metaMediumInput.value = "";
    if (metaDimensionsInput) metaDimensionsInput.value = "";
    if (metaEditionInput) metaEditionInput.value = "";
    // Reset contact fields
    if (metaContact1Input) metaContact1Input.value = "";
    if (metaContact2Input) metaContact2Input.value = "";
    contact1Radios.forEach(r => r.checked = false);
    contact2Radios.forEach(r => r.checked = false);
    updateContactPlaceholder(contact1Radios, metaContact1Input);
    updateContactPlaceholder(contact2Radios, metaContact2Input);
    if (metaError) metaError.classList.add("hidden");
    if (metaSuccess) metaSuccess.classList.add("hidden");
    if (metaRequiredError) metaRequiredError.classList.add("hidden");
    if (metaSaveBtn) metaSaveBtn.disabled = false;

    // Reset for-sale checkboxes
    if (metaForSaleYes) metaForSaleYes.checked = false;
    if (metaForSaleNo) metaForSaleNo.checked = false;
    if (metaSaleOriginal) metaSaleOriginal.checked = false;
    if (metaSalePrint) metaSalePrint.checked = false;
    updateSaleTypeState();
    
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

  // Required fields validation
  const metaRequiredError = document.getElementById("metaRequiredError");

  function validateRequiredFields() {
    const artistName = (metaArtistInput?.value || "").trim();
    const artworkTitle = (metaTitleInput?.value || "").trim();
    const isValid = artistName.length > 0 && artworkTitle.length > 0;

    // Hide error if both fields are valid
    if (isValid && metaRequiredError) {
      metaRequiredError.classList.add("hidden");
    }

    return isValid;
  }

  // Live validation: hide error as user types if fields become valid
  if (metaArtistInput) {
    metaArtistInput.addEventListener("input", validateRequiredFields);
  }
  if (metaTitleInput) {
    metaTitleInput.addEventListener("input", validateRequiredFields);
  }

  async function saveMetaToDb(tileId) {
    if (!tileId) {
      console.error(`${LOG_PREFIX} No tile_id for metadata save`);
      return;
    }

    // Get and trim values
    const artistName = (metaArtistInput?.value || "").trim();
    const artworkTitle = (metaTitleInput?.value || "").trim();
    const yearCreated = (metaYearInput?.value || "").trim();
    const medium = (metaMediumInput?.value || "").trim();
    const dimensions = (metaDimensionsInput?.value || "").trim();
    const editionInfo = (metaEditionInput?.value || "").trim();

    // Get contact fields (type + value)
    const contact1TypeRadio = Array.from(contact1Radios).find(r => r.checked);
    const contact1Type = contact1TypeRadio ? contact1TypeRadio.value : "";
    const contact1Value = (metaContact1Input?.value || "").trim();
    const contact2TypeRadio = Array.from(contact2Radios).find(r => r.checked);
    const contact2Type = contact2TypeRadio ? contact2TypeRadio.value : "";
    const contact2Value = (metaContact2Input?.value || "").trim();

    // Determine for_sale and sale_type from checkboxes
    let forSale = "";
    if (metaForSaleYes?.checked) forSale = "yes";
    else if (metaForSaleNo?.checked) forSale = "no";

    let saleType = "";
    if (metaSaleOriginal?.checked && metaSalePrint?.checked) saleType = "both";
    else if (metaSaleOriginal?.checked) saleType = "original";
    else if (metaSalePrint?.checked) saleType = "print";

    // Validate required fields
    if (!artistName || !artworkTitle) {
      // Show required fields error
      if (metaRequiredError) {
        metaRequiredError.classList.remove("hidden");
      }
      // Focus first missing field
      if (!artistName && metaArtistInput) {
        metaArtistInput.focus();
      } else if (!artworkTitle && metaTitleInput) {
        metaTitleInput.focus();
      }
      return; // Block submission
    }

    // Hide required error if validation passed
    if (metaRequiredError) {
      metaRequiredError.classList.add("hidden");
    }

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
          artwork_title: artworkTitle,
          year_created: yearCreated,
          medium: medium,
          dimensions: dimensions,
          edition_info: editionInfo,
          for_sale: forSale,
          sale_type: saleType,
          contact1_type: contact1Type,
          contact1_value: contact1Value,
          contact2_type: contact2Type,
          contact2_value: contact2Value
        })
      });
      
      const result = await response.json();
      
      if (!response.ok || !result.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      
      console.log(`${LOG_PREFIX} Metadata saved successfully:`, result);
      
      // Show success briefly
      if (metaSuccess) {
        metaSuccess.classList.remove("hidden");
        setTimeout(() => {
          metaSuccess.classList.add("hidden");
        }, 2000);
      }

      // Refresh wall to pick up the new metadata
      await refreshWall();

      // Capture tile ID before closing (closeModal resets state)
      const savedTileId = currentUploadTileId;

      // Close modals immediately
      closeMetaModal();
      closeModal(true);

      // Highlight new tile after modals are gone
      setTimeout(() => {
        if (typeof window.highlightNewTile === 'function') {
          window.highlightNewTile(savedTileId);
        }
      }, 300);
      
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
      // Close Tier-1 (wall already refreshed after upload)
      closeModal(true);
    });
  }

  if (metaSkipBtn) {
    metaSkipBtn.addEventListener("click", () => {
      closeMetaModal();
      // Close Tier-1 (wall already refreshed after upload)
      closeModal(true);
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
