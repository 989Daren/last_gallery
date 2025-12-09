// static/js/tile_popup.js
// Makes all .tile elements clickable via event delegation on #galleryWall.
// Clicking a tile shows a centered 800x800 grey popup with that tile's ID.

(function () {
  const popupState = {
    overlay: null,
    box: null,
    textEl: null,
    closeBtn: null,
    isOpen: false,
  };

  function createPopupElements() {
    if (popupState.overlay) return;

    const overlay = document.createElement("div");
    const box = document.createElement("div");
    const textEl = document.createElement("div");
    const closeBtn = document.createElement("button");

    // Full-screen dim background
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.right = "0";
    overlay.style.bottom = "0";
    overlay.style.display = "none"; // hidden until used
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.4)";
    overlay.style.zIndex = "2000";

    // 800x800 grey square
    box.style.width = "500px";
    box.style.height = "500px";
    box.style.backgroundColor = "#666666";
    box.style.display = "flex";
    box.style.flexDirection = "column";
    box.style.alignItems = "center";
    box.style.justifyContent = "center";
    box.style.position = "relative";
    box.style.boxShadow = "0 12px 48px rgba(0, 0, 0, 0.6)";
    box.style.borderRadius = "8px";

    // Tile ID text
    textEl.style.color = "#ffffff";
    textEl.style.fontSize = "3rem";
    textEl.style.fontFamily =
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    textEl.style.textAlign = "center";
    textEl.textContent = "";

    // Close button
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Close popup");
    closeBtn.style.position = "absolute";
    closeBtn.style.top = "10px";
    closeBtn.style.right = "14px";
    closeBtn.style.border = "none";
    closeBtn.style.background = "transparent";
    closeBtn.style.color = "#ffffff";
    closeBtn.style.fontSize = "2rem";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.lineHeight = "1";

    closeBtn.addEventListener("click", closePopup);

    // Click outside the box closes popup
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) {
        closePopup();
      }
    });

    box.appendChild(closeBtn);
    box.appendChild(textEl);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    popupState.overlay = overlay;
    popupState.box = box;
    popupState.textEl = textEl;
    popupState.closeBtn = closeBtn;
  }

  function openPopup(tileId) {
    createPopupElements();
    popupState.textEl.textContent = tileId || "(no tile ID)";
    popupState.overlay.style.display = "flex";
    popupState.isOpen = true;
  }

  function closePopup() {
    if (!popupState.overlay || !popupState.isOpen) return;
    popupState.overlay.style.display = "none";
    popupState.isOpen = false;
  }

  function handleWallClick(event) {
    // Look for the closest .tile ancestor from the actual click target
    const tile = event.target.closest(".tile");
    if (!tile) return;

    const tileId =
      tile.dataset.id ||
      tile.getAttribute("data-id") ||
      tile.id ||
      "Unknown tile";

    openPopup(tileId);
  }

  function initPopupSystem() {
    createPopupElements();

    const wall = document.getElementById("galleryWall");
    if (!wall) {
      console.error("tile_popup.js: #galleryWall not found.");
      return;
    }

    // Event delegation: one listener for all current and future tiles
    wall.addEventListener("click", handleWallClick);
  }

  document.addEventListener("DOMContentLoaded", initPopupSystem);
})();