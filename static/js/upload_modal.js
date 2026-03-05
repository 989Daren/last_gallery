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

  // Track current upload asset ID and save state for orphan cleanup
  let currentUploadAssetId = null;
  let metaSavedSuccessfully = false;

  // Edit mode state
  let isEditMode = false;
  let editOriginalEmail = "";

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

  function abandonCurrentUpload() {
    if (!currentUploadTileId || !currentUploadAssetId) return;
    const tileId = currentUploadTileId;
    const assetId = currentUploadAssetId;
    // Clear immediately to prevent double-cleanup
    currentUploadTileId = null;
    currentUploadAssetId = null;
    metaSavedSuccessfully = false;

    fetch("/api/abandon_upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tile_id: tileId, asset_id: assetId })
    })
      .then(() => { console.log(`${LOG_PREFIX} Abandoned upload cleaned up`); refreshWall(); })
      .catch(err => console.error(`${LOG_PREFIX} Abandon cleanup error:`, err));
  }

  function closeModal(silent) {
    // Clean up orphaned upload if metadata was never saved
    if (!metaSavedSuccessfully && currentUploadTileId && currentUploadAssetId) {
      abandonCurrentUpload();
    }

    modal.classList.add("hidden");
    destroyCropper();
    resetModalState();
    disableCropperContextMenuBlocker();
    currentUploadAssetId = null;
    metaSavedSuccessfully = false;
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
  // Upload: POST /api/upload_assets (multipart/form-data)
  //   - tile_image: cropped 512x512 square (for grid)
  //   - popup_image: original file (for full-size popup)
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
      formData.append("popup_image", selectedFile, selectedFile?.name || `popup_${ts}.jpg`);

      const result = await postUpload(formData);
      console.log(`${LOG_PREFIX} Upload success:`, result);

      // Track asset for orphan cleanup
      currentUploadAssetId = (result.asset && result.asset.asset_id) || null;
      metaSavedSuccessfully = false;

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
  const metaCloseBtn = document.getElementById("metaCloseBtn");
  const metaSkipBtn = document.getElementById("metaSkipBtn");
  const metaContinueBtn = document.getElementById("metaContinueBtn");

  // Admin-only unlock checkbox
  const metaUnlockSection = document.getElementById("metaUnlockSection");
  const metaUnlockCheckbox = document.getElementById("metaUnlockCheckbox");
  let _editOriginalUnlocked = false; // Track original value to detect changes

  // Tier-3 confirmation banner refs
  const confirmBannerOverlay = document.getElementById("confirmBannerOverlay");
  const confirmCancelBtn = document.getElementById("confirmCancelBtn");
  const confirmSaveBtn = document.getElementById("confirmSaveBtn");
  const metaArtistInput = document.getElementById("metaArtistInput");
  const metaTitleInput = document.getElementById("metaTitleInput");
  const metaError = document.getElementById("metaError");

  // Extended metadata field refs
  const metaYearInput = document.getElementById("metaYearInput");
  const metaMediumInput = document.getElementById("metaMediumInput");
  const metaDimensionsInput = document.getElementById("metaDimensionsInput");
  const metaEditionInput = document.getElementById("metaEditionInput");

  // Contact fields
  const metaContact1Input = document.getElementById("metaContact1Input");
  const metaContact2Input = document.getElementById("metaContact2Input");
  const contact2Radios = document.querySelectorAll('input[name="contact2Type"]');
  const metaEmailChangeWarning = document.getElementById("metaEmailChangeWarning");

  // Dynamic placeholder for contact2 (radio-driven)
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
      input.placeholder = "Contact details";
    }
  }

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
    contact2Radios.forEach(r => r.checked = false);
    updateContactPlaceholder(contact2Radios, metaContact2Input);
    if (metaError) metaError.classList.add("hidden");
    if (metaRequiredError) metaRequiredError.classList.add("hidden");
    if (metaContactError) metaContactError.classList.add("hidden");
    if (metaDuplicateError) metaDuplicateError.classList.add("hidden");
    if (metaUploadLimitError) metaUploadLimitError.classList.add("hidden");
    if (metaContinueBtn) metaContinueBtn.disabled = false;

    // Reset for-sale checkboxes
    if (metaForSaleYes) metaForSaleYes.checked = false;
    if (metaForSaleNo) metaForSaleNo.checked = false;
    if (metaSaleOriginal) metaSaleOriginal.checked = false;
    if (metaSalePrint) metaSalePrint.checked = false;
    updateSaleTypeState();

    // Hide unlock checkbox for new uploads (admin can unlock via edit later)
    if (metaUnlockSection) metaUnlockSection.classList.add("hidden");
    if (metaUnlockCheckbox) metaUnlockCheckbox.checked = false;
    _editOriginalUnlocked = false;

    // Show overlay
    metaOverlay.classList.remove("hidden");
    metaOverlay.setAttribute("aria-hidden", "false");

    // Focus first input
    setTimeout(() => {
      if (metaArtistInput) metaArtistInput.focus();
    }, 100);

    console.log(`${LOG_PREFIX} Tier-2 metadata modal opened for tile: ${tileId}`);
  }

  async function openMetaModalForEdit(tileId) {
    if (!metaOverlay) return;

    isEditMode = true;
    currentUploadTileId = tileId;
    metaSavedSuccessfully = true; // Guard: never cleanup existing artwork

    // Fetch current metadata
    try {
      const res = await fetch(`/api/tile/${tileId}/metadata`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to fetch metadata");

      // Prefill text inputs
      if (metaArtistInput) metaArtistInput.value = data.artist_name || "";
      if (metaTitleInput) metaTitleInput.value = data.artwork_title || "";
      if (metaYearInput) metaYearInput.value = data.year_created || "";
      if (metaMediumInput) metaMediumInput.value = data.medium || "";
      if (metaDimensionsInput) metaDimensionsInput.value = data.dimensions || "";
      if (metaEditionInput) metaEditionInput.value = data.edition_info || "";

      // Prefill contact fields
      if (metaContact1Input) metaContact1Input.value = data.contact1_value || "";
      if (metaContact2Input) metaContact2Input.value = data.contact2_value || "";
      editOriginalEmail = (data.contact1_value || "").trim().toLowerCase();

      // Prefill contact2 radio
      contact2Radios.forEach(r => {
        r.checked = (r.value === data.contact2_type);
      });
      updateContactPlaceholder(contact2Radios, metaContact2Input);

      // Prefill for-sale checkboxes
      if (metaForSaleYes) metaForSaleYes.checked = (data.for_sale === "yes");
      if (metaForSaleNo) metaForSaleNo.checked = (data.for_sale === "no");

      // Prefill sale type
      if (data.sale_type === "both") {
        if (metaSaleOriginal) metaSaleOriginal.checked = true;
        if (metaSalePrint) metaSalePrint.checked = true;
      } else {
        if (metaSaleOriginal) metaSaleOriginal.checked = (data.sale_type === "original");
        if (metaSalePrint) metaSalePrint.checked = (data.sale_type === "print");
      }
      updateSaleTypeState();

      // Clear errors and warnings
      if (metaError) metaError.classList.add("hidden");
      if (metaRequiredError) metaRequiredError.classList.add("hidden");
      if (metaContactError) metaContactError.classList.add("hidden");
      if (metaDuplicateError) metaDuplicateError.classList.add("hidden");
      if (metaEmailChangeWarning) metaEmailChangeWarning.classList.add("hidden");
      if (metaContinueBtn) metaContinueBtn.disabled = false;

      // Admin unlock checkbox: show when admin is active, prefill from data
      const adminActive = typeof window.isAdminActive === "function" && window.isAdminActive();
      if (metaUnlockSection && metaUnlockCheckbox) {
        if (adminActive) {
          metaUnlockSection.classList.remove("hidden");
          metaUnlockCheckbox.checked = !!(data.unlocked);
          _editOriginalUnlocked = !!(data.unlocked);
        } else {
          metaUnlockSection.classList.add("hidden");
          metaUnlockCheckbox.checked = false;
          _editOriginalUnlocked = false;
        }
      }

      // Disable skip button (block return to image editing)
      if (metaSkipBtn) {
        metaSkipBtn.disabled = true;
        metaSkipBtn.classList.add("edit-mode-disabled");
      }

      // Show overlay
      metaOverlay.classList.remove("hidden");
      metaOverlay.setAttribute("aria-hidden", "false");

      setTimeout(() => {
        if (metaArtistInput) metaArtistInput.focus();
      }, 100);

      console.log(`${LOG_PREFIX} Edit mode metadata modal opened for tile: ${tileId}`);
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to open edit metadata:`, err);
      isEditMode = false;
    }
  }

  function closeMetaModal() {
    if (!metaOverlay) return;

    metaOverlay.classList.add("hidden");
    metaOverlay.setAttribute("aria-hidden", "true");

    // Reset edit mode
    isEditMode = false;
    editOriginalEmail = "";
    if (metaEmailChangeWarning) metaEmailChangeWarning.classList.add("hidden");
    if (metaSkipBtn) {
      metaSkipBtn.disabled = false;
      metaSkipBtn.classList.remove("edit-mode-disabled");
    }

    // Reset unlock checkbox
    if (metaUnlockSection) metaUnlockSection.classList.add("hidden");
    if (metaUnlockCheckbox) metaUnlockCheckbox.checked = false;
    _editOriginalUnlocked = false;

    console.log(`${LOG_PREFIX} Tier-2 metadata modal closed`);
  }

  // Required fields validation
  const metaRequiredError = document.getElementById("metaRequiredError");
  const metaContactError = document.getElementById("metaContactError");
  const metaDuplicateError = document.getElementById("metaDuplicateError");
  const metaUploadLimitError = document.getElementById("metaUploadLimitError");

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
    metaTitleInput.addEventListener("input", () => {
      if (metaDuplicateError) metaDuplicateError.classList.add("hidden");
    });
  }

  // Live validation for contact: hide error when both type + value are present
  // Live validation: hide email error as user types valid email
  function validateContactField() {
    const val = (metaContact1Input?.value || "").trim();
    if (val && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) && metaContactError) {
      metaContactError.classList.add("hidden");
    }
  }

  if (metaContact1Input) {
    metaContact1Input.addEventListener("input", validateContactField);
    metaContact1Input.addEventListener("input", () => {
      // Hide upload limit error on typing (user may be changing email)
      if (metaUploadLimitError) metaUploadLimitError.classList.add("hidden");
      if (metaContinueBtn && metaContinueBtn.dataset.limitBlocked) {
        delete metaContinueBtn.dataset.limitBlocked;
        metaContinueBtn.disabled = false;
      }

      if (!isEditMode || !metaEmailChangeWarning) return;
      const current = (metaContact1Input.value || "").trim().toLowerCase();
      if (current !== editOriginalEmail && current.length > 0) {
        metaEmailChangeWarning.classList.remove("hidden");
      } else {
        metaEmailChangeWarning.classList.add("hidden");
      }
    });

    // Upload limit check on email blur (new uploads only)
    metaContact1Input.addEventListener("blur", async () => {
      if (isEditMode) return;
      // Admin bypasses the upload limit
      if (typeof window.isAdminActive === "function" && window.isAdminActive()) return;
      const email = (metaContact1Input.value || "").trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;

      try {
        const res = await fetch("/api/check_upload_limit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.ok && !data.allowed) {
          if (metaUploadLimitError) metaUploadLimitError.classList.remove("hidden");
          if (metaContinueBtn) {
            metaContinueBtn.disabled = true;
            metaContinueBtn.dataset.limitBlocked = "1";
          }
        } else {
          if (metaUploadLimitError) metaUploadLimitError.classList.add("hidden");
          if (metaContinueBtn && metaContinueBtn.dataset.limitBlocked) {
            delete metaContinueBtn.dataset.limitBlocked;
            metaContinueBtn.disabled = false;
          }
        }
      } catch (err) {
        console.error(`${LOG_PREFIX} Upload limit check error:`, err);
      }
    });
  }

  // ========================================
  // Validation (shared by Continue + Save)
  // ========================================

  function validateAllMetaFields() {
    const artistName = (metaArtistInput?.value || "").trim();
    const artworkTitle = (metaTitleInput?.value || "").trim();

    // Validate required text fields
    if (!artistName || !artworkTitle) {
      if (metaRequiredError) metaRequiredError.classList.remove("hidden");
      if (!artistName && metaArtistInput) metaArtistInput.focus();
      else if (!artworkTitle && metaTitleInput) metaTitleInput.focus();
      return false;
    }
    if (metaRequiredError) metaRequiredError.classList.add("hidden");

    // Validate email (required)
    const contact1Value = (metaContact1Input?.value || "").trim();
    if (!contact1Value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact1Value)) {
      if (metaContactError) metaContactError.classList.remove("hidden");
      if (metaContact1Input) metaContact1Input.focus();
      return false;
    }
    if (metaContactError) metaContactError.classList.add("hidden");

    return true;
  }

  // ========================================
  // Tier-3 Confirmation Banner
  // ========================================

  function openConfirmBanner() {
    if (!confirmBannerOverlay) return;
    confirmBannerOverlay.classList.remove("hidden");
    confirmBannerOverlay.setAttribute("aria-hidden", "false");
    console.log(`${LOG_PREFIX} Confirmation banner opened`);
  }

  function closeConfirmBanner() {
    if (!confirmBannerOverlay) return;
    confirmBannerOverlay.classList.add("hidden");
    confirmBannerOverlay.setAttribute("aria-hidden", "true");
    console.log(`${LOG_PREFIX} Confirmation banner closed`);
  }

  // ========================================
  // Save metadata to DB (called after confirmation)
  // ========================================

  async function saveMetaToDb(tileId) {
    if (!tileId) {
      console.error(`${LOG_PREFIX} No tile_id for metadata save`);
      return;
    }

    // Collect form values
    const artistName = (metaArtistInput?.value || "").trim();
    const artworkTitle = (metaTitleInput?.value || "").trim();
    const yearCreated = (metaYearInput?.value || "").trim();
    const medium = (metaMediumInput?.value || "").trim();
    const dimensions = (metaDimensionsInput?.value || "").trim();
    const editionInfo = (metaEditionInput?.value || "").trim();

    const contact1Type = "email";
    const contact1Value = (metaContact1Input?.value || "").trim();
    const contact2TypeRadio = Array.from(contact2Radios).find(r => r.checked);
    const contact2Type = contact2TypeRadio ? contact2TypeRadio.value : "";
    const contact2Value = (metaContact2Input?.value || "").trim();

    let forSale = "";
    if (metaForSaleYes?.checked) forSale = "yes";
    else if (metaForSaleNo?.checked) forSale = "no";

    let saleType = "";
    if (metaSaleOriginal?.checked && metaSalePrint?.checked) saleType = "both";
    else if (metaSaleOriginal?.checked) saleType = "original";
    else if (metaSalePrint?.checked) saleType = "print";

    // Disable save button on confirmation banner
    if (confirmSaveBtn) confirmSaveBtn.disabled = true;
    if (metaError) metaError.classList.add("hidden");

    try {
      const metaHeaders = { "Content-Type": "application/json" };
      // Include admin PIN if admin is active (for upload limit bypass)
      const adminActive = typeof window.isAdminActive === "function" && window.isAdminActive();
      if (adminActive) {
        const pin = typeof window.getAdminPin === "function" ? window.getAdminPin() : "";
        if (pin) metaHeaders["X-Admin-Pin"] = pin;
      }

      const response = await fetch(`/api/tile/${tileId}/metadata`, {
        method: "POST",
        headers: metaHeaders,
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
          contact2_value: contact2Value,
          is_edit: isEditMode
        })
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      console.log(`${LOG_PREFIX} Metadata saved successfully:`, result);
      metaSavedSuccessfully = true;

      // If admin changed unlock status, set it explicitly via force_unlock endpoint
      if (metaUnlockCheckbox && !metaUnlockSection.classList.contains("hidden")) {
        const currentUnlocked = metaUnlockCheckbox.checked;
        if (currentUnlocked !== _editOriginalUnlocked) {
          try {
            const pin = typeof window.getAdminPin === "function" ? window.getAdminPin() : "";
            // Look up asset_id from the current wall state
            const wallRes = await fetch("/api/admin/tile_info?tile_id=" + encodeURIComponent(tileId), {
              headers: { "X-Admin-Pin": pin }
            });
            const wallData = await wallRes.json();
            if (wallData.ok && wallData.asset_id) {
              const unlockRes = await fetch("/api/admin/force_unlock", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Admin-Pin": pin
                },
                body: JSON.stringify({ asset_id: wallData.asset_id, unlocked: currentUnlocked ? 1 : 0 })
              });
              const unlockResult = await unlockRes.json();
              if (unlockResult.ok) {
                console.log(`${LOG_PREFIX} Unlock set:`, unlockResult);
              } else {
                console.warn(`${LOG_PREFIX} Force unlock failed:`, unlockResult);
              }
            }
          } catch (unlockErr) {
            console.error(`${LOG_PREFIX} Force unlock error:`, unlockErr);
          }
        }
      }

      // Refresh wall to pick up the new metadata
      await refreshWall();

      // Capture state before closing (closeMetaModal resets isEditMode)
      const savedTileId = currentUploadTileId;
      const wasEditMode = isEditMode;
      const savedEmail = (metaContact1Input?.value || "").trim();

      // Close all modals
      closeConfirmBanner();
      closeMetaModal();
      if (!wasEditMode) {
        closeModal(true);
      }

      // Post-save flow: scroll to tile, then show success banner (or just sheen for edits)
      setTimeout(() => {
        if (typeof window.scrollToTile === 'function') {
          window.scrollToTile(savedTileId);
        }

        if (!wasEditMode && typeof window.showSuccessBanner === 'function') {
          // New upload: show success banner, sheen plays on dismiss
          window.showSuccessBanner({
            email: savedEmail,
            tileId: savedTileId,
            onDismiss: function() {
              if (typeof window.playTileSheen === 'function') {
                window.playTileSheen(savedTileId);
              }
            }
          });
        } else {
          // Edit mode: play sheen directly
          if (typeof window.playTileSheen === 'function') {
            window.playTileSheen(savedTileId);
          }
        }
      }, 300);

    } catch (err) {
      console.error(`${LOG_PREFIX} Metadata save failed:`, err);

      // Close banner, go back to meta modal to show error
      closeConfirmBanner();

      const isDuplicate = (err.message || "").toLowerCase().includes("already exists");
      if (isDuplicate && metaDuplicateError) {
        metaDuplicateError.classList.remove("hidden");
        if (metaTitleInput) metaTitleInput.focus();
      } else if (metaError) {
        metaError.textContent = err.message || "Save failed. Please try again.";
        metaError.classList.remove("hidden");
      }
      if (metaContinueBtn) metaContinueBtn.disabled = false;
    } finally {
      if (confirmSaveBtn) confirmSaveBtn.disabled = false;
    }
  }

  // ========================================
  // Wire Tier-2 modal buttons
  // ========================================

  if (metaCloseBtn) {
    metaCloseBtn.addEventListener("click", () => {
      const wasEditMode = isEditMode;
      closeMetaModal();
      if (!wasEditMode) {
        closeModal(true);
      }
    });
  }

  // "Return to Artwork Edit" — close meta modal, keep upload modal + cropper intact
  if (metaSkipBtn) {
    metaSkipBtn.addEventListener("click", () => {
      if (isEditMode) return;
      closeMetaModal();
    });
  }

  // "Continue" validates then shows confirmation banner
  if (metaContinueBtn) {
    metaContinueBtn.addEventListener("click", () => {
      if (!currentUploadTileId) return;
      if (validateAllMetaFields()) {
        openConfirmBanner();
      }
    });
  }

  // "Submission Guidelines" button — opens Human Centric Gallery overlay
  const guidelinesBtn = document.getElementById("uploadGuidelinesBtn");
  if (guidelinesBtn) {
    guidelinesBtn.addEventListener("click", () => {
      const hcOverlay = document.getElementById("humanCentricOverlay");
      if (hcOverlay) {
        hcOverlay.classList.remove("hidden");
        // No ConicalNav push — this is a sub-overlay on top of upload modal.
        // Hash push would change from #upload to #humancentric, causing
        // syncUiToHash to close the upload modal underneath.
      }
    });
  }

  // Allow Enter key to advance to confirmation banner
  if (metaArtistInput) {
    metaArtistInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && currentUploadTileId) {
        if (validateAllMetaFields()) openConfirmBanner();
      }
    });
  }

  if (metaTitleInput) {
    metaTitleInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && currentUploadTileId) {
        if (validateAllMetaFields()) openConfirmBanner();
      }
    });
  }

  // ========================================
  // Wire Tier-3 confirmation banner buttons
  // ========================================

  // "Cancel" returns to metadata modal
  if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener("click", () => {
      closeConfirmBanner();
    });
  }

  // "Save" commits the submission
  if (confirmSaveBtn) {
    confirmSaveBtn.addEventListener("click", () => {
      if (currentUploadTileId) {
        saveMetaToDb(currentUploadTileId);
      }
    });
  }

  // ========================================
  // Edit Submission Banner (hamburger menu)
  // ========================================

  const editBannerOverlay = document.getElementById("editBannerOverlay");
  const editBannerCloseBtn = document.getElementById("editBannerCloseBtn");
  const editBannerCancelBtn = document.getElementById("editBannerCancelBtn");
  const editBannerContinueBtn = document.getElementById("editBannerContinueBtn");
  const menuItemEdit = document.getElementById("menu-item-edit");
  const editTitleInput = document.getElementById("editTitleInput");
  const editCodeInput = document.getElementById("editCodeInput");
  const editCodeError = document.getElementById("editCodeError");
  const editCodeLabel = document.querySelector('label[for="editCodeInput"]');
  const editTitleLabel = document.querySelector('label[for="editTitleInput"]');
  const forgotCodeLink = document.getElementById("forgotCodeLink");
  const resendCodeSection = document.getElementById("resendCodeSection");
  const resendEmailInput = document.getElementById("resendEmailInput");
  const resendCodeBtn = document.getElementById("resendCodeBtn");
  const resendCodeMsg = document.getElementById("resendCodeMsg");

  function openEditBanner() {
    if (!editBannerOverlay) return;
    if (editTitleInput) editTitleInput.value = "";
    if (editCodeInput) editCodeInput.value = "";
    if (editCodeError) editCodeError.classList.add("hidden");

    // Reset resend section
    if (resendCodeSection) resendCodeSection.classList.add("hidden");
    if (resendEmailInput) resendEmailInput.value = "";
    if (resendCodeMsg) resendCodeMsg.classList.add("hidden");

    // Admin mode: hide edit code field, change title field to accept tile ID
    const adminMode = typeof window.isAdminActive === "function" && window.isAdminActive();
    if (adminMode) {
      if (editCodeLabel) editCodeLabel.style.display = "none";
      if (editCodeInput) editCodeInput.style.display = "none";
      if (forgotCodeLink) forgotCodeLink.style.display = "none";
      if (editTitleLabel) editTitleLabel.textContent = "Tile ID";
      if (editTitleInput) {
        editTitleInput.placeholder = "Admin";
        editTitleInput.maxLength = 10;
      }
    } else {
      if (editCodeLabel) editCodeLabel.style.display = "";
      if (editCodeInput) editCodeInput.style.display = "";
      if (forgotCodeLink) forgotCodeLink.style.display = "";
      if (editTitleLabel) editTitleLabel.textContent = "Artwork title";
      if (editTitleInput) {
        editTitleInput.placeholder = "Enter the title of your artwork";
        editTitleInput.maxLength = 120;
      }
    }

    editBannerOverlay.classList.remove("hidden");
    editBannerOverlay.setAttribute("aria-hidden", "false");
    setTimeout(() => {
      if (editTitleInput) editTitleInput.focus();
    }, 100);
  }

  function closeEditBanner() {
    if (!editBannerOverlay) return;
    editBannerOverlay.classList.add("hidden");
    editBannerOverlay.setAttribute("aria-hidden", "true");
    // Clean up URL when dismissing edit banner from /edit deep-link
    if (window.PAGE_MODE === "edit") {
      history.replaceState(null, '', '/');
      window.PAGE_MODE = "";
    }
  }

  // Hamburger menu "Edit Your Artwork Submission" opens the banner
  if (menuItemEdit) {
    menuItemEdit.addEventListener("click", () => {
      // Close hamburger menu
      const hamburgerMenu = document.getElementById("hamburger-menu");
      const hamburgerBtn = document.getElementById("hamburger-btn");
      if (hamburgerMenu) hamburgerMenu.classList.remove("open");
      if (hamburgerBtn) {
        hamburgerBtn.setAttribute("aria-expanded", "false");
      }
      if (hamburgerMenu) hamburgerMenu.setAttribute("aria-hidden", "true");

      openEditBanner();
    });
  }

  if (editBannerCloseBtn) {
    editBannerCloseBtn.addEventListener("click", closeEditBanner);
  }
  if (editBannerCancelBtn) {
    editBannerCancelBtn.addEventListener("click", closeEditBanner);
  }

  // Tap anywhere to dismiss — except interactive elements
  if (editBannerOverlay) {
    editBannerOverlay.addEventListener("click", (e) => {
      if (e.target.closest("a, button, input, textarea, select")) return;
      closeEditBanner();
    });
  }

  // Escape key dismiss
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && editBannerOverlay && !editBannerOverlay.classList.contains("hidden")) {
      closeEditBanner();
    }
  });

  if (editBannerContinueBtn) {
    editBannerContinueBtn.addEventListener("click", async () => {
      const adminMode = typeof window.isAdminActive === "function" && window.isAdminActive();
      const title = (editTitleInput?.value || "").trim();

      // Admin path: tile ID lookup (no edit code required)
      if (adminMode) {
        const tileId = title.toUpperCase();
        if (!tileId) {
          if (editCodeError) {
            editCodeError.textContent = "Please enter a tile ID.";
            editCodeError.classList.remove("hidden");
          }
          return;
        }

        try {
          editBannerContinueBtn.disabled = true;
          const pin = typeof window.getAdminPin === "function" ? window.getAdminPin() : "";
          const res = await fetch(`/api/admin/tile_info?tile_id=${encodeURIComponent(tileId)}`, {
            headers: { "X-Admin-Pin": pin }
          });
          const result = await res.json();

          if (!result.ok || !result.occupied) {
            if (editCodeError) {
              editCodeError.textContent = result.error || "Tile is empty or not found.";
              editCodeError.classList.remove("hidden");
            }
            return;
          }

          closeEditBanner();
          openMetaModalForEdit(tileId);
        } catch (err) {
          console.error(`${LOG_PREFIX} Admin tile lookup error:`, err);
          if (editCodeError) {
            editCodeError.textContent = "Lookup failed. Please try again.";
            editCodeError.classList.remove("hidden");
          }
        } finally {
          editBannerContinueBtn.disabled = false;
        }
        return;
      }

      // Normal user path: artwork title + edit code
      const code = (editCodeInput?.value || "").trim();

      if (!title || !code) {
        if (editCodeError) {
          editCodeError.textContent = "Please enter both your artwork title and edit code.";
          editCodeError.classList.remove("hidden");
        }
        return;
      }

      try {
        editBannerContinueBtn.disabled = true;
        const res = await fetch("/api/verify_edit_code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, code })
        });
        const result = await res.json();

        if (!result.ok) {
          if (editCodeError) {
            editCodeError.textContent = result.error || "No matching artwork found. Check your title and edit code.";
            editCodeError.classList.remove("hidden");
          }
          return;
        }

        // Success — close banner and open prefilled metadata modal
        closeEditBanner();
        openMetaModalForEdit(result.tile_id);
      } catch (err) {
        console.error(`${LOG_PREFIX} Edit code verification error:`, err);
        if (editCodeError) {
          editCodeError.textContent = "Verification failed. Please try again.";
          editCodeError.classList.remove("hidden");
        }
      } finally {
        editBannerContinueBtn.disabled = false;
      }
    });
  }

  // "Forgot your edit code?" link toggles resend section
  if (forgotCodeLink) {
    forgotCodeLink.addEventListener("click", (e) => {
      e.preventDefault();
      if (resendCodeSection) {
        resendCodeSection.classList.toggle("hidden");
        if (!resendCodeSection.classList.contains("hidden") && resendEmailInput) {
          resendEmailInput.focus();
        }
      }
    });
  }

  // Resend edit code button
  if (resendCodeBtn) {
    resendCodeBtn.addEventListener("click", async () => {
      const email = (resendEmailInput?.value || "").trim();
      if (!email) {
        if (resendCodeMsg) {
          resendCodeMsg.textContent = "Please enter your email address.";
          resendCodeMsg.classList.remove("hidden");
        }
        return;
      }

      try {
        resendCodeBtn.disabled = true;
        const res = await fetch("/api/resend_edit_code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
        const result = await res.json();

        if (resendCodeMsg) {
          resendCodeMsg.textContent = result.message || "If an edit code exists for this email, it has been resent.";
          resendCodeMsg.classList.remove("hidden");
        }
      } catch (err) {
        console.error(`${LOG_PREFIX} Resend edit code error:`, err);
        if (resendCodeMsg) {
          resendCodeMsg.textContent = "Request failed. Please try again.";
          resendCodeMsg.classList.remove("hidden");
        }
      } finally {
        resendCodeBtn.disabled = false;
      }
    });
  }

  // Enter key on resend email input triggers Resend
  if (resendEmailInput) {
    resendEmailInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && resendCodeBtn) resendCodeBtn.click();
    });
  }

  // Enter key on edit fields triggers Continue
  [editTitleInput, editCodeInput].forEach(input => {
    if (input) {
      input.addEventListener("keypress", (e) => {
        if (e.key === "Enter" && editBannerContinueBtn) {
          editBannerContinueBtn.click();
        }
      });
    }
  });

  // Auto-open edit banner when arriving via /edit deep-link
  if (window.PAGE_MODE === "edit") {
    setTimeout(() => {
      openEditBanner();
      // Prefill artwork title from query param (e.g. /edit?title=My%20Artwork)
      const params = new URLSearchParams(window.location.search);
      const prefillTitle = params.get("title");
      if (prefillTitle && editTitleInput) {
        editTitleInput.value = prefillTitle;
        // Move focus to the edit code field since title is already filled
        if (editCodeInput) editCodeInput.focus();
      }
    }, 300);
  }
});
