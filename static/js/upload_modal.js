document.addEventListener("DOMContentLoaded", () => {
  // ===== DOM refs =====
  const modal = document.getElementById("uploadModal");
  const openBtn = document.getElementById("addArtworkBtn");
  const cancelBtn = document.getElementById("cancelUploadBtn");

  const fileInput = document.getElementById("uploadFile");
  const previewImg = document.getElementById("previewImage");
  const continueBtn = document.getElementById("uploadContinue");
  const artworkNameInput = document.getElementById("artworkName");
  const artistNameInput = document.getElementById("artistName");

  // ===== State =====
  let selectedFile = null;
  let currentObjectUrl = null;
  let cropper = null;
  let uploadInFlight = false;  // Guard to ensure "Uploading..." only shows during actual upload

  // ================================
  // Cropper: Block Android "Copy image"
  // ================================
  let cropperContextMenuBlocker = null;

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
  const TILE_SIZE = 1024;        // Square tile image (cropped)
  const POPUP_MAX_SIZE = 1792;   // Popup image max long edge (uncropped)
  const OUTPUT_MIME = "image/jpeg";
  const OUTPUT_QUALITY = 0.9;

  // Toggle this if you want quieter console output
  const DEBUG = false;

  // ===== Guard =====
  if (!modal || !openBtn || !cancelBtn || !fileInput || !previewImg || !continueBtn || !artworkNameInput || !artistNameInput) {
    console.warn(`${LOG_PREFIX} Missing required DOM elements.`);
    return;
  }

  // ===== Helpers =====
  function log(...args) {
    if (!DEBUG) return;
    console.log(LOG_PREFIX, ...args);
  }

  function setPrimaryButtonState(mode) {
    /**
     * Centralized button state management to prevent race conditions.
     * 
     * @param {string} mode - One of: "continue" | "uploading" | "disabled"
     */
    switch (mode) {
      case "continue":
        continueBtn.textContent = "Continue";
        continueBtn.disabled = false;
        break;
      case "uploading":
        continueBtn.textContent = "Uploading...";
        continueBtn.disabled = true;
        break;
      case "disabled":
        continueBtn.textContent = "Continue";
        continueBtn.disabled = true;
        break;
      default:
        console.warn(`${LOG_PREFIX} Unknown button state: ${mode}`);
    }
  }

  function revokeObjectUrl() {
    if (!currentObjectUrl) return;
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  function initCropper() {
    if (cropper) return; // Guard against duplicate init
    cropper = new Cropper(previewImg, {
      aspectRatio: 1,         // lock crop box to square
      autoCropArea: 1,        // start as large as possible
      viewMode: 1,            // stable bounds inside modal
      cropBoxMovable: true,   // allow dragging crop box
      cropBoxResizable: true, // allow resizing via handles
      responsive: true,       // respond to container sizing
      dragMode: "crop",       // dragging inside crop box moves crop box
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
    artworkNameInput.value = "";
    artistNameInput.value = "";
    selectedFile = null;
    uploadInFlight = false;
    setPrimaryButtonState("disabled");
  }

  function openModal() {
    modal.classList.remove("hidden");
    uploadInFlight = false;
    setPrimaryButtonState("disabled");
    enableCropperContextMenuBlocker();
  }

  function closeModal() {
    modal.classList.add("hidden");
    destroyCropper();
    resetModalState();
    disableCropperContextMenuBlocker();
  }

  // ===== Generate tile image (square crop from Cropper) =====
  async function getTileImage() {
    if (!cropper) {
      throw new Error("Cropper not initialized");
    }

    return new Promise((resolve, reject) => {
      const canvas = cropper.getCroppedCanvas({
        width: TILE_SIZE,
        height: TILE_SIZE,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high"
      });

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to create tile image blob"));
          }
        },
        OUTPUT_MIME,
        OUTPUT_QUALITY
      );
    });
  }

  // ===== Generate popup image (uncropped, max 1792 long edge) =====
  async function getPopupImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        let width = img.width;
        let height = img.height;
        
        // Scale down if larger than POPUP_MAX_SIZE on either dimension
        if (width > POPUP_MAX_SIZE || height > POPUP_MAX_SIZE) {
          if (width > height) {
            height = (height / width) * POPUP_MAX_SIZE;
            width = POPUP_MAX_SIZE;
          } else {
            width = (width / height) * POPUP_MAX_SIZE;
            height = POPUP_MAX_SIZE;
          }
        }

        canvas.width = width;
        canvas.height = height;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(img.src);
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Failed to create popup image blob"));
            }
          },
          OUTPUT_MIME,
          OUTPUT_QUALITY
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        reject(new Error("Failed to load image for popup"));
      };

      img.src = URL.createObjectURL(file);
    });
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

    // Reset any previous selection
    revokeObjectUrl();

    selectedFile = file;
    currentObjectUrl = URL.createObjectURL(file);

    previewImg.onload = () => {
      previewImg.onload = null;
      previewImg.onerror = null;

      previewImg.classList.remove("hidden");
      
      // Only enable button if no upload is in flight
      if (!uploadInFlight) {
        setPrimaryButtonState("continue");
      }
      
      log("Image loaded successfully");

      destroyCropper(); // Clean up any existing instance
      initCropper();    // Initialize with square crop constraint
    };

    previewImg.onerror = () => {
      previewImg.onload = null;
      previewImg.onerror = null;

      console.error(`${LOG_PREFIX} Image failed to load.`);
      resetModalState();
    };

    previewImg.src = currentObjectUrl;
    log("Loaded image object URL:", currentObjectUrl);
  });

  continueBtn.addEventListener("click", async () => {
    if (DEBUG) console.log("UPLOAD CLICKED: about to POST /api/upload_assets");
    
    if (!selectedFile) {
      console.warn("Upload blocked: no file selected");
      return;
    }

    if (!cropper) {
      console.warn("Upload blocked: cropper not initialized");
      return;
    }

    try {
      // Disable button during image generation but keep "Continue" text
      setPrimaryButtonState("disabled");

      // Generate both images (button stays "Continue" during generation)
      log("Generating tile image (square crop)...");
      const tileBlob = await getTileImage();
      
      if (!tileBlob) {
        console.warn("Upload blocked: missing tile image blob");
        throw new Error("Failed to generate tile image");
      }
      
      log("Generating popup image (uncropped)...");
      const popupBlob = await getPopupImage(selectedFile);
      
      if (!popupBlob) {
        console.warn("Upload blocked: missing popup image blob");
        throw new Error("Failed to generate popup image");
      }
      
      log("Images generated ✅", { 
        tileSize: tileBlob.size, 
        popupSize: popupBlob.size 
      });

      // Prepare form data
      const formData = new FormData();
      formData.append("tile_image", tileBlob, "tile.jpg");
      formData.append("popup_image", popupBlob, "popup.jpg");
      formData.append("artwork_name", artworkNameInput.value.trim() || "Untitled");
      formData.append("artist_name", artistNameInput.value.trim() || "Anonymous");

      // CRITICAL: Only set "Uploading..." immediately before network request begins
      uploadInFlight = true;
      setPrimaryButtonState("uploading");
      
      // Upload to server
      if (DEBUG) console.log("FormData ready, sending...");
      log("Uploading to /api/upload_assets...");
      const response = await fetch("/api/upload_assets", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      log("Upload successful ✅", result);
      if (DEBUG) console.log(`${LOG_PREFIX} Server response:`, result);

      // Select a random empty XS tile for the uploaded artwork
      const wall = document.getElementById("galleryWall");
      if (!wall) {
        console.error(`${LOG_PREFIX} Gallery wall not found`);
        closeModal();
        return;
      }

      // Build list of eligible empty XS tiles using computed dimensions
      const allTiles = Array.from(wall.querySelectorAll('.tile'));
      if (DEBUG) console.log("tiles total:", allTiles.length);

      // Identify XS tiles by their rendered size (85x85 ±2px tolerance)
      const XS_SIZE = 85;
      const TOLERANCE = 2;
      
      const xsTiles = allTiles.filter(tile => {
        const rect = tile.getBoundingClientRect();
        const widthMatch = Math.abs(rect.width - XS_SIZE) <= TOLERANCE;
        const heightMatch = Math.abs(rect.height - XS_SIZE) <= TOLERANCE;
        return widthMatch && heightMatch;
      });
      
      if (DEBUG) console.log("xs tiles found:", xsTiles.length);

      // Filter for empty XS tiles (no occupied dataset AND no occupied class)
      const emptyXSTiles = xsTiles.filter(tile => {
        const hasOccupiedData = tile.dataset.occupied === "1";
        const hasOccupiedClass = tile.classList.contains("occupied");
        return !hasOccupiedData && !hasOccupiedClass;
      });

      if (DEBUG) console.log("eligible empty xs:", emptyXSTiles.length);

      if (emptyXSTiles.length === 0) {
        console.warn(`${LOG_PREFIX} No empty XS tiles available`);
        alert("Upload successful, but no empty XS tiles available to display artwork.");
        closeModal();
        return;
      }

      // Randomly select one
      const randomIndex = Math.floor(Math.random() * emptyXSTiles.length);
      const selectedTile = emptyXSTiles[randomIndex];
      const tileId = selectedTile.dataset.id;
      
      if (DEBUG) console.log(`${LOG_PREFIX} Chosen tile_id: ${tileId}`);

      // Assign the asset to the selected tile
      log("Assigning asset to tile via /api/assign_tile...");
      const assignResponse = await fetch("/api/assign_tile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          tile_id: tileId,
          asset_id: result.asset_id
        })
      });

      if (!assignResponse.ok) {
        throw new Error(`Tile assignment failed: ${assignResponse.status} ${assignResponse.statusText}`);
      }

      const assignResult = await assignResponse.json();
      if (assignResult.ok) {
        log("Tile assignment successful ✅");
        if (DEBUG) console.log(`${LOG_PREFIX} Assignment confirmed:`, assignResult);
        
        // Apply the asset to the tile visually
        const tileEl = wall.querySelector(`.tile[data-id="${tileId}"]`);
        if (tileEl && window.applyAssetToTile) {
          window.applyAssetToTile(tileEl, result);
          log("Asset applied to tile visually ✅");
        } else {
          console.warn(`${LOG_PREFIX} Could not find tile element or applyAssetToTile function`);
        }
      } else {
        throw new Error("Tile assignment returned ok: false");
      }

      // Close modal and reset
      closeModal();
      
    } catch (error) {
      console.error(`${LOG_PREFIX} Upload failed:`, error);
      uploadInFlight = false;
      setPrimaryButtonState("continue");
    }
  });
});
