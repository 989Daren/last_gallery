// ========================================
// Post-Upload Success Banner for The Last Gallery
// Shown after metadata save, before sheen animation
// ========================================

(function() {
  "use strict";

  if (window.__successBannerInitialized) return;
  window.__successBannerInitialized = true;

  let _overlay = null;
  let _onDismiss = null;

  const LOCK_OPEN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';

  function escapeHtml(str) {
    if (!str) return "";
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function createOverlay(email) {
    // Remove any existing overlay
    if (_overlay) {
      _overlay.remove();
      _overlay = null;
    }

    _overlay = document.createElement("div");
    _overlay.className = "success-banner-overlay";
    _overlay.setAttribute("aria-hidden", "false");

    var emailHtml = email ? '<em class="success-banner-email">' + escapeHtml(email) + '</em>' : 'your email';

    _overlay.innerHTML =
      '<div class="success-banner" role="dialog" aria-modal="true">' +
        '<div class="success-banner-accent"></div>' +
        '<div class="success-banner-body">' +

          // Section 1: Headline
          '<div class="success-banner-headline">' +
            '<span class="success-banner-dot"></span>' +
            '<span>Your artwork is live.</span>' +
          '</div>' +
          '<p class="success-banner-subtitle">It\'s now on the gallery wall.</p>' +

          '<div class="success-banner-divider"></div>' +

          // Section 2: Edit code notice
          '<div class="success-banner-email-notice">' +
            '<span class="success-banner-envelope">&#9993;</span>' +
            '<span>Your edit code has been sent to ' + emailHtml + '. Use it anytime to update your artwork\'s information.</span>' +
          '</div>' +

          '<div class="success-banner-divider"></div>' +

          // Section 3: Unlock CTA hint
          '<div class="success-banner-unlock-hint">' +
            '<div class="success-banner-unlock-header">' +
              '<span class="success-banner-unlock-icon">' + LOCK_OPEN_SVG + '</span>' +
              '<span class="success-banner-next-step">NEXT STEP</span>' +
            '</div>' +
            '<p class="success-banner-unlock-text">Want to see your creative work in larger tiles and other benefits? Tap the menu to explore the Unlock to Upgrade.</p>' +
          '</div>' +

          // Footer
          '<div class="success-banner-footer">' +
            '<button class="success-banner-dismiss" type="button">View My Artwork \u2192</button>' +
          '</div>' +

        '</div>' +
      '</div>';

    document.body.appendChild(_overlay);

    // Wire dismiss button
    var dismissBtn = _overlay.querySelector(".success-banner-dismiss");
    dismissBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      dismissSuccessBanner();
    });

    return _overlay;
  }

  function showSuccessBanner(opts) {
    var email = opts.email || "";
    var tileId = opts.tileId || "";
    _onDismiss = opts.onDismiss || null;

    createOverlay(email);
  }

  function dismissSuccessBanner() {
    if (!_overlay) return;
    var cb = _onDismiss;
    _onDismiss = null;
    _overlay.remove();
    _overlay = null;
    if (typeof cb === "function") cb();
  }

  // Escape key dismisses
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && _overlay) {
      dismissSuccessBanner();
    }
  });

  window.showSuccessBanner = showSuccessBanner;
  window.dismissSuccessBanner = dismissSuccessBanner;

})();
