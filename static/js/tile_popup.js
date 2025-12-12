// static/js/tile_popup.js
// Clicking a tile with data-art-url shows the full artwork
// in the #artPopup lightbox defined in index.html.

(function () {
  let popup, popupImg, backdrop;
  let isOpen = false;

  function cacheElements() {
    if (popup && popupImg && backdrop) return;

    popup    = document.getElementById("artPopup");
    popupImg = document.getElementById("artPopupImage");
    backdrop = popup ? popup.querySelector(".art-popup-backdrop") : null;

    if (!popup || !popupImg || !backdrop) {
      console.error("tile_popup.js: popup elements not found.");
    }
  }

  function openPopup(artUrl) {
    cacheElements();
    if (!popup || !popupImg || !artUrl) return;

    popupImg.src = artUrl;
    popup.classList.add("visible");
    popup.classList.remove("hidden");
    isOpen = true;
  }

  function closePopup() {
    if (!popup || !popupImg || !isOpen) return;

    popup.classList.remove("visible");
    popup.classList.add("hidden");
    popupImg.src = "";
    isOpen = false;
  }

  function handleWallClick(event) {
    const tile = event.target.closest(".tile");
    if (!tile) return;

    // We only open the popup if the tile has an artwork URL
    const artUrl = tile.dataset.artUrl || tile.getAttribute("data-art-url");
    if (!artUrl) return;

    openPopup(artUrl);
  }

  function handleBackdropClick(event) {
    if (!popup || !backdrop) return;
    if (event.target === backdrop) {
      closePopup();
    }
  }

  function handleKeydown(event) {
    if (event.key === "Escape" && isOpen) {
      closePopup();
    }
  }

  function initPopupSystem() {
    cacheElements();

    const wall = document.getElementById("galleryWall");
    if (!wall) {
      console.error("tile_popup.js: #galleryWall not found.");
      return;
    }

    // One listener for all tiles
    wall.addEventListener("click", handleWallClick);

    if (backdrop) {
      backdrop.addEventListener("click", handleBackdropClick);
    }

    if (popupImg) {
      // Click on the image itself to close
      popupImg.addEventListener("click", closePopup);
    }

    document.addEventListener("keydown", handleKeydown);
  }

  document.addEventListener("DOMContentLoaded", initPopupSystem);
})();