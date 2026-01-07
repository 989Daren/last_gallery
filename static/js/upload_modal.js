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
  let cropper = null

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

  // Simple continue button: just close modal
  continueBtn.addEventListener("click", () => {
    console.log(`${LOG_PREFIX} Continue clicked (no backend upload)`);
    alert("Image cropped successfully! (No upload configured)");
    closeModal();
  });
});
