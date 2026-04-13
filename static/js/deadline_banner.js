// ========================================
// 24-Hour Unlock Deadline Banner for The Last Gallery
// Shown after metadata save when a 2nd+ upload needs payment within 24 hours
// ========================================

(function() {
  "use strict";

  if (window.__deadlineBannerInitialized) return;
  window.__deadlineBannerInitialized = true;

  var _overlay = null;
  var _onDismiss = null;

  var CLOCK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

  function createOverlay() {
    if (_overlay) {
      _overlay.remove();
      _overlay = null;
    }

    _overlay = document.createElement("div");
    _overlay.className = "deadline-banner-overlay";
    _overlay.setAttribute("aria-hidden", "false");

    _overlay.innerHTML =
      '<div class="deadline-banner" role="dialog" aria-modal="true">' +
        '<div class="deadline-banner-accent"></div>' +
        '<div class="deadline-banner-body">' +

          '<div class="deadline-banner-headline">' +
            '<span class="deadline-banner-clock">' + CLOCK_SVG + '</span>' +
            '<span>24-Hour Unlock Deadline</span>' +
          '</div>' +

          '<p class="deadline-banner-text">Your artwork is live on the gallery wall! Since you already have a free tile, this upload must be unlocked within 24 hours or it will be removed.</p>' +

          '<div class="deadline-banner-footer">' +
            '<button class="deadline-banner-unlock btn-gold" type="button">Unlock Now</button>' +
            '<button class="deadline-banner-dismiss btn-outline" type="button">OK, I understand</button>' +
          '</div>' +

        '</div>' +
      '</div>';

    document.body.appendChild(_overlay);

    _overlay.querySelector(".deadline-banner-unlock").addEventListener("click", function(e) {
      e.stopPropagation();
      var assetId = _overlay ? _overlay._assetId : null;
      var tileId = _overlay ? _overlay._tileId : null;
      dismissDeadlineBanner();
      if (typeof window.openUnlockModal === "function") {
        window.openUnlockModal(assetId, tileId);
      }
    });

    _overlay.querySelector(".deadline-banner-dismiss").addEventListener("click", function(e) {
      e.stopPropagation();
      dismissDeadlineBanner();
    });

    return _overlay;
  }

  function showDeadlineBanner(opts) {
    _onDismiss = opts.onDismiss || null;

    createOverlay();
    _overlay._assetId = opts.assetId || null;
    _overlay._tileId = opts.tileId || null;
  }

  function dismissDeadlineBanner() {
    if (!_overlay) return;
    var cb = _onDismiss;
    _onDismiss = null;
    _overlay.remove();
    _overlay = null;
    if (typeof cb === "function") cb();
  }

  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && _overlay) {
      dismissDeadlineBanner();
    }
  });

  window.showDeadlineBanner = showDeadlineBanner;
  window.dismissDeadlineBanner = dismissDeadlineBanner;

})();
