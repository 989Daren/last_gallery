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

  // ===== Constants =====
  const LOG_PREFIX = "[upload_modal]";
  const SUPPORTED_TYPES_RE = /^image\/(png|jpeg)$/;
  const OUTPUT_SIZE = 1024;
  const OUTPUT_MIME = "image/jpeg";
  const OUTPUT_QUALITY = 0.9;

  // Toggle this if you want quieter console output
  const DEBUG = true;

  // ===== Guard =====
  if (!modal || !openBtn || !cancelBtn || !fileInput || !previewImg || !continueBtn) {
    console.warn(`${LOG_PREFIX} Missing required DOM elements.`);
    return;
  }

  // ===== Helpers =====
  function log(...args) {
    if (!DEBUG) return;
    console.log(LOG_PREFIX, ...args);
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
      background: false
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
  }

  function closeModal() {
    modal.classList.add("hidden");
    destroyCropper();
    resetModalState();
  }

  // ===== Resize/optimize image =====
  async function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // Calculate dimensions maintaining aspect ratio
        let width = img.width;
        let height = img.height;
        
        // If image is larger than OUTPUT_SIZE, scale it down
        if (width > OUTPUT_SIZE || height > OUTPUT_SIZE) {
          if (width > height) {
            height = (height / width) * OUTPUT_SIZE;
            width = OUTPUT_SIZE;
          } else {
            width = (width / height) * OUTPUT_SIZE;
            height = OUTPUT_SIZE;
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
              reject(new Error("Failed to create blob from canvas"));
            }
          },
          OUTPUT_MIME,
          OUTPUT_QUALITY
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        reject(new Error("Failed to load image"));
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
      continueBtn.disabled = false;
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
    if (!selectedFile) {
      console.warn(`${LOG_PREFIX} Continue clicked but no file selected.`);
      return;
    }

    try {
      const resizedBlob = await resizeImage(selectedFile);
      
      log("Image resized/optimized ✅", { 
        originalSize: selectedFile.size, 
        optimizedSize: resizedBlob.size, 
        type: resizedBlob.type 
      });

      // Proof-of-life: show the optimized result
      revokeObjectUrl();
      currentObjectUrl = URL.createObjectURL(resizedBlob);
      previewImg.src = currentObjectUrl;
      previewImg.classList.remove("hidden");

      // Disable Continue after optimization (until user chooses another file)
      continueBtn.disabled = true;

      // Next step: upload `resizedBlob` to Flask with fetch + FormData
      // For now, we just show the optimized preview
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to resize image:`, error);
    }
  });
});
