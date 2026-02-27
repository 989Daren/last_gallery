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
          '<div class="unlock-modal-graphic"><img src="/static/images/unlock_graphic.jpg" alt="Unlock your artwork to larger tiles"></div>' +
          '<div class="unlock-modal-benefits">' +
            '<div class="unlock-modal-benefits-label">What you get</div>' +
            '<div class="unlock-modal-benefit">' +
              '<span class="unlock-modal-check">\u2713</span>' +
              '<div><strong>Larger tile eligibility</strong> &mdash; Your work can land in larger tiles during the weekly shuffle. Lock it in so it never drops back down.</div>' +
            '</div>' +
            '<div class="unlock-modal-benefit">' +
              '<span class="unlock-modal-check">\u2713</span>' +
              '<div><strong>Creator of the Month</strong> &mdash; You\'re entered into our monthly drawing, where you and your work will be featured on The Last Gallery website.</div>' +
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

    // Tap anywhere to close (CTA + close link stopPropagation to stay interactive)
    _overlay.addEventListener("click", () => {
      closeUnlockModal();
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
    // Push hash for back-button support
    window.ConicalNav && window.ConicalNav.pushToMatchUi();
  }

  function closeUnlockModal(fromHashChange) {
    if (!_overlay) return;
    _overlay.classList.add("hidden");
    _overlay.setAttribute("aria-hidden", "true");
    // Pop hash unless triggered by back button
    if (!fromHashChange) {
      window.ConicalNav && window.ConicalNav.popFromUiClose();
    }
  }

  function isUnlockModalOpen() {
    return _overlay ? !_overlay.classList.contains("hidden") : false;
  }

  // Stripe checkout integration stub
  // Intended flow:
  //   1. Client calls server endpoint to create a Stripe Checkout session
  //      e.g. POST /api/create_checkout_session { asset_id, tile_id }
  //   2. Server creates session via Stripe API, returns { checkout_url }
  //   3. Client redirects to Stripe: window.location.href = checkout_url
  //   4. On success, Stripe webhook calls POST /api/lock_tile { asset_id, payment_id }
  //      which sets qualified_floor to the current tile size and unlocked=1
  function initiateUnlockCheckout(assetId, tileId) {
    console.log("[UNLOCK] initiateUnlockCheckout called", { assetId, tileId });
    // TODO: implement Stripe Checkout session creation + redirect
  }

  window.openUnlockModal = openUnlockModal;
  window.closeUnlockModal = closeUnlockModal;
  window.isUnlockModalOpen = isUnlockModalOpen;
  window.initiateUnlockCheckout = initiateUnlockCheckout;

})();
