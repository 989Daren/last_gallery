// ========================================
// Unlock Info Modal for The Last Gallery
// Shared entry point: hamburger menu + ribbon icon
// ========================================

(function() {
  "use strict";

  if (window.__unlockModalInitialized) return;
  window.__unlockModalInitialized = true;

  let _overlay = null;
  let _currentAssetId = null;
  let _currentTileId = null;

  const LOCK_OPEN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';

  function createOverlay() {
    if (_overlay) return _overlay;

    _overlay = document.createElement("div");
    _overlay.className = "unlock-modal-overlay hidden";
    _overlay.setAttribute("aria-hidden", "true");

    _overlay.innerHTML =
      '<div class="unlock-modal" role="dialog" aria-modal="true">' +
        '<div class="unlock-modal-accent"></div>' +
        '<div class="unlock-modal-body">' +
          '<div class="unlock-modal-icon">' + LOCK_OPEN_SVG + '</div>' +
          '<h2 class="unlock-modal-headline">Unlock Your Artwork</h2>' +
          '<p class="unlock-modal-subtitle">Take your submission to the next level.</p>' +
          '<div class="unlock-modal-graphic"><span>[ unlock graphic ]</span></div>' +
          '<div class="unlock-modal-benefits">' +
            '<div class="unlock-modal-benefits-label">What you get</div>' +
            '<div class="unlock-modal-benefit">' +
              '<span class="unlock-modal-check">\u2713</span>' +
              '<div><strong>Larger tile eligibility</strong> &mdash; Your creative work becomes eligible to be placed into larger tiles during our weekly random gallery shuffle. You will then be given the opportunity to upgrade your work to the larger tile, ensuring it will never drop back down in size, for the life of the gallery.</div>' +
            '</div>' +
            '<div class="unlock-modal-benefit">' +
              '<span class="unlock-modal-check">\u2713</span>' +
              '<div><strong>Creator of the Month</strong> &mdash; You\'re entered into our monthly Creator of the Month drawing, where you and your creative work will be prominently featured on The Last Gallery website until the following month\'s drawing. Drawing winners will also receive a link to their work inside every email that goes out from The Last Gallery website &mdash; until the following month\'s drawing.</div>' +
            '</div>' +
          '</div>' +
          '<button class="unlock-modal-cta" type="button">Unlock My Artwork</button>' +
          '<button class="unlock-modal-close-link" type="button">Maybe Later</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(_overlay);

    // Wire events
    const modal = _overlay.querySelector(".unlock-modal");
    const ctaBtn = _overlay.querySelector(".unlock-modal-cta");
    const closeLink = _overlay.querySelector(".unlock-modal-close-link");

    // CTA click
    ctaBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (typeof window.initiateUnlockCheckout === "function") {
        window.initiateUnlockCheckout(_currentAssetId, _currentTileId);
      }
    });

    // Close link
    closeLink.addEventListener("click", (e) => {
      e.stopPropagation();
      closeUnlockModal();
    });

    // Backdrop click
    _overlay.addEventListener("click", (e) => {
      if (e.target === _overlay) closeUnlockModal();
    });

    // Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && _overlay && !_overlay.classList.contains("hidden")) {
        closeUnlockModal();
      }
    });

    return _overlay;
  }

  function openUnlockModal(assetId, tileId) {
    _currentAssetId = assetId || null;
    _currentTileId = tileId || null;
    const overlay = createOverlay();
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
  }

  function closeUnlockModal() {
    if (!_overlay) return;
    _overlay.classList.add("hidden");
    _overlay.setAttribute("aria-hidden", "true");
  }

  // TODO: wire to Stripe checkout
  function initiateUnlockCheckout(assetId, tileId) {
    console.log("[UNLOCK] initiateUnlockCheckout called", { assetId, tileId });
    // TODO: wire to Stripe checkout — replace this stub with Stripe.redirectToCheckout() or payment link redirect
  }

  window.openUnlockModal = openUnlockModal;
  window.closeUnlockModal = closeUnlockModal;
  window.initiateUnlockCheckout = initiateUnlockCheckout;

})();
