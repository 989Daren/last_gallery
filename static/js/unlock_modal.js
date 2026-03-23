// ========================================
// Unlock / Upgrade Modal for The Last Gallery
// Three-step purchase flow: Identify → Select Artwork → Choose Tier
// ========================================

(function() {
  "use strict";

  if (window.__unlockModalInitialized) return;
  window.__unlockModalInitialized = true;

  let _overlay = null;
  let _currentStep = 1;
  let _editCode = '';
  let _email = '';
  let _artworks = [];
  let _selectedArtwork = null;
  let _autoSelectAssetId = null;
  let _floorUpgradeOnly = false;

  const LOCK_OPEN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';

  const TIER_DESCRIPTIONS = {
    'unlock_s':  'Unlock your artwork for larger tile eligibility during the weekly shuffle + enter Creator of the Month drawings.',
    'floor_m':   'Your artwork will never drop below a Medium tile during shuffles.',
    'floor_lg':  'Your artwork will never drop below a Large tile during shuffles.',
    'floor_xl':  'Your artwork will never drop below an Extra Large tile during shuffles.',
    'exhibit':   'A dedicated exhibit space to showcase your portfolio with a scrolling gallery of your works.',
  };

  function maskEmail(email) {
    if (!email) return '';
    var parts = email.split('@');
    if (parts.length !== 2) return email;
    var local = parts[0];
    var domain = parts[1];
    if (local.length <= 2) return local[0] + '***@' + domain;
    return local[0] + local[1] + '***@' + domain;
  }

  function formatPrice(cents) {
    return '$' + (cents / 100).toFixed(2);
  }

  function statusBadgeText(artwork) {
    if (artwork.asset_type === 'exhibit') return 'Exhibit';
    if (!artwork.unlocked) return 'Locked';
    var floor = (artwork.qualified_floor || 's').toUpperCase();
    if (floor === 'S') return 'Unlocked';
    return 'Floor: ' + floor;
  }

  function statusBadgeClass(artwork) {
    if (!artwork.unlocked) return 'status-locked';
    return 'status-unlocked';
  }

  function createOverlay() {
    if (_overlay) return _overlay;

    _overlay = document.createElement("div");
    _overlay.className = "unlock-modal-overlay hidden";
    _overlay.setAttribute("aria-hidden", "true");

    _overlay.innerHTML =
      '<div class="unlock-modal" role="dialog" aria-modal="true">' +
        '<div class="unlock-modal-accent"></div>' +
        '<div class="unlock-modal-body">' +

          // Step 1: Identification
          '<div class="unlock-modal-step" data-step="1">' +
            '<div class="unlock-modal-icon">' + LOCK_OPEN_SVG + '</div>' +
            '<h2 class="unlock-modal-headline">Upgrade Your Artwork</h2>' +
            '<p class="unlock-modal-subtitle">Enter the edit code that was sent to<br>your email when you uploaded your artwork.</p>' +
            '<div class="unlock-modal-input-group">' +
              '<label class="unlock-modal-label">Upgrade / Edit Code</label>' +
              '<input type="text" class="unlock-modal-input" id="unlockCodeInput" maxlength="8" placeholder="8-character code" autocomplete="off" />' +
              '<div class="unlock-modal-inline-error hidden" id="unlockCodeError"></div>' +
            '</div>' +
            '<button class="unlock-modal-cta" type="button" id="unlockStep1Btn">Continue</button>' +
            '<div class="unlock-modal-forgot" id="unlockForgotLink">Forgot your edit code?</div>' +
            '<div class="unlock-modal-resend-section hidden" id="unlockResendSection">' +
              '<input type="email" class="unlock-modal-input" id="unlockResendEmail" placeholder="Your email address" />' +
              '<button class="unlock-modal-resend-btn" type="button" id="unlockResendBtn">Resend Code</button>' +
              '<div class="unlock-modal-resend-msg hidden" id="unlockResendMsg"></div>' +
            '</div>' +
            '<button class="unlock-modal-close-link" type="button" id="unlockStep1Close">Cancel</button>' +
          '</div>' +

          // Step 2: Artwork Selection
          '<div class="unlock-modal-step hidden" data-step="2">' +
            '<h2 class="unlock-modal-headline">Your Artworks</h2>' +
            '<p class="unlock-modal-subtitle" id="unlockEmailDisplay"></p>' +
            '<div class="unlock-artwork-list" id="unlockArtworkList"></div>' +
            '<button class="unlock-modal-cta" type="button" id="unlockStep2Btn" disabled>Continue</button>' +
            '<div class="unlock-modal-back-link" id="unlockStep2Back">Back</div>' +
          '</div>' +

          // Step 3: Upgrade Options
          '<div class="unlock-modal-step hidden" data-step="3">' +
            '<div class="unlock-selected-artwork" id="unlockSelectedArtwork"></div>' +
            '<h2 class="unlock-modal-headline">Eligible Upgrade:</h2>' +
            '<div class="unlock-tier-current-size" id="unlockCurrentSize"></div>' +
            '<div class="unlock-tier-list" id="unlockTierList"></div>' +
            '<div class="unlock-tier-note">Use the same email for all uploads to qualify for future upgrade tiers.</div>' +
            '<div class="unlock-modal-back-link" id="unlockStep3Back">Back</div>' +
          '</div>' +

        '</div>' +
      '</div>';

    document.body.appendChild(_overlay);
    wireEvents();
    return _overlay;
  }

  function wireEvents() {
    var modal = _overlay.querySelector(".unlock-modal");

    // Prevent clicks inside modal from closing
    modal.addEventListener("click", function(e) { e.stopPropagation(); });

    // Backdrop click closes
    _overlay.addEventListener("click", function() { closeUnlockModal(); });

    // Escape key
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape" && _overlay && !_overlay.classList.contains("hidden")) {
        closeUnlockModal();
      }
    });

    // Step 1: Continue
    var step1Btn = _overlay.querySelector("#unlockStep1Btn");
    step1Btn.addEventListener("click", function(e) {
      e.stopPropagation();
      handleStep1Submit();
    });

    // Step 1: Enter key on input
    var codeInput = _overlay.querySelector("#unlockCodeInput");
    codeInput.addEventListener("keydown", function(e) {
      if (e.key === "Enter") { e.preventDefault(); handleStep1Submit(); }
    });

    // Step 1: Close
    _overlay.querySelector("#unlockStep1Close").addEventListener("click", function(e) {
      e.stopPropagation();
      closeUnlockModal();
    });

    // Step 1: Forgot code toggle
    _overlay.querySelector("#unlockForgotLink").addEventListener("click", function(e) {
      e.stopPropagation();
      var section = _overlay.querySelector("#unlockResendSection");
      section.classList.toggle("hidden");
      if (!section.classList.contains("hidden")) {
        _overlay.querySelector("#unlockResendEmail").focus();
      }
    });

    // Step 1: Resend button
    _overlay.querySelector("#unlockResendBtn").addEventListener("click", function(e) {
      e.stopPropagation();
      handleResendCode();
    });

    // Step 2: Continue
    _overlay.querySelector("#unlockStep2Btn").addEventListener("click", function(e) {
      e.stopPropagation();
      if (_selectedArtwork) goToStep(3);
    });

    // Step 2: Back
    _overlay.querySelector("#unlockStep2Back").addEventListener("click", function(e) {
      e.stopPropagation();
      goToStep(1);
    });

    // Step 3: Back
    _overlay.querySelector("#unlockStep3Back").addEventListener("click", function(e) {
      e.stopPropagation();
      goToStep(2);
    });
  }

  function goToStep(step) {
    _currentStep = step;
    var steps = _overlay.querySelectorAll(".unlock-modal-step");
    for (var i = 0; i < steps.length; i++) {
      var s = parseInt(steps[i].getAttribute("data-step"));
      if (s === step) {
        steps[i].classList.remove("hidden");
      } else {
        steps[i].classList.add("hidden");
      }
    }

    if (step === 1) {
      var input = _overlay.querySelector("#unlockCodeInput");
      if (input) setTimeout(function() { input.focus(); }, 100);
    }
    if (step === 2) renderArtworkList();
    if (step === 3) renderTierOptions();

    // Scroll modal body to top
    var body = _overlay.querySelector(".unlock-modal-body");
    if (body) body.scrollTop = 0;
  }

  function showError(id, msg) {
    var el = _overlay.querySelector("#" + id);
    if (el) {
      el.textContent = msg;
      el.classList.remove("hidden");
    }
  }

  function hideError(id) {
    var el = _overlay.querySelector("#" + id);
    if (el) el.classList.add("hidden");
  }

  function setLoading(btnId, loading) {
    var btn = _overlay.querySelector("#" + btnId);
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn.dataset.origText = btn.textContent;
      btn.textContent = "Loading...";
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.origText || "Continue";
    }
  }

  // Step 1: Submit edit code
  async function handleStep1Submit() {
    var codeInput = _overlay.querySelector("#unlockCodeInput");
    var code = (codeInput.value || "").trim();

    hideError("unlockCodeError");

    if (!code || code.length < 1) {
      showError("unlockCodeError", "Please enter your edit code.");
      return;
    }

    setLoading("unlockStep1Btn", true);

    try {
      var resp = await fetch("/api/my_artworks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code }),
      });
      var data = await resp.json();

      if (!data.ok) {
        showError("unlockCodeError", data.error || "Invalid edit code.");
        setLoading("unlockStep1Btn", false);
        return;
      }

      _editCode = code;
      _email = data.email || '';
      _artworks = data.artworks || [];

      if (_artworks.length === 0) {
        showError("unlockCodeError", "No artworks found for this edit code.");
        setLoading("unlockStep1Btn", false);
        return;
      }

      setLoading("unlockStep1Btn", false);

      // Auto-select if only 1 artwork or if a specific asset was requested
      if (_autoSelectAssetId) {
        var match = _artworks.find(function(a) { return a.asset_id === _autoSelectAssetId; });
        if (match) {
          _selectedArtwork = match;
          _autoSelectAssetId = null;
          goToStep(3);
          return;
        }
      }

      if (_artworks.length === 1) {
        _selectedArtwork = _artworks[0];
        goToStep(3);
        return;
      }

      _selectedArtwork = null;
      goToStep(2);

    } catch (err) {
      showError("unlockCodeError", "Network error. Please try again.");
      setLoading("unlockStep1Btn", false);
    }
  }

  // Step 1: Resend edit code
  async function handleResendCode() {
    var emailInput = _overlay.querySelector("#unlockResendEmail");
    var email = (emailInput.value || "").trim();
    var msgEl = _overlay.querySelector("#unlockResendMsg");

    if (!email) {
      msgEl.textContent = "Please enter your email.";
      msgEl.className = "unlock-modal-resend-msg error";
      msgEl.classList.remove("hidden");
      return;
    }

    var btn = _overlay.querySelector("#unlockResendBtn");
    btn.disabled = true;
    btn.textContent = "Sending...";

    try {
      var resp = await fetch("/api/resend_edit_code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email }),
      });
      var data = await resp.json();
      msgEl.textContent = data.message || "If an edit code exists for this email, it has been resent.";
      msgEl.className = "unlock-modal-resend-msg success";
      msgEl.classList.remove("hidden");
    } catch (err) {
      msgEl.textContent = "Network error. Please try again.";
      msgEl.className = "unlock-modal-resend-msg error";
      msgEl.classList.remove("hidden");
    }

    btn.disabled = false;
    btn.textContent = "Resend Code";
  }

  // Step 2: Render artwork cards
  function renderArtworkList() {
    _overlay.querySelector("#unlockEmailDisplay").textContent = maskEmail(_email);

    var list = _overlay.querySelector("#unlockArtworkList");
    list.innerHTML = '';

    var continueBtn = _overlay.querySelector("#unlockStep2Btn");
    continueBtn.disabled = true;

    _artworks.forEach(function(artwork) {
      var card = document.createElement("div");
      card.className = "unlock-artwork-card";
      if (_selectedArtwork && _selectedArtwork.asset_id === artwork.asset_id) {
        card.classList.add("selected");
        continueBtn.disabled = false;
      }

      var thumbUrl = artwork.tile_url || '';
      var thumbHtml = thumbUrl
        ? '<img class="unlock-artwork-thumb" src="' + thumbUrl + '" alt="" />'
        : '<div class="unlock-artwork-thumb unlock-artwork-thumb-empty"></div>';

      card.innerHTML =
        thumbHtml +
        '<div class="unlock-artwork-info">' +
          '<div class="unlock-artwork-title">' + escapeHtml(artwork.artwork_title || 'Untitled') + '</div>' +
          '<div class="unlock-artwork-artist">' + escapeHtml(artwork.artist_name || '') + '</div>' +
        '</div>' +
        '<div class="unlock-artwork-status ' + statusBadgeClass(artwork) + '">' + statusBadgeText(artwork) + '</div>';

      card.addEventListener("click", function(e) {
        e.stopPropagation();
        _selectedArtwork = artwork;
        // Update selection UI
        var cards = list.querySelectorAll(".unlock-artwork-card");
        for (var i = 0; i < cards.length; i++) cards[i].classList.remove("selected");
        card.classList.add("selected");
        continueBtn.disabled = false;
      });

      list.appendChild(card);
    });
  }

  // Step 3: Render upgrade tier options
  async function renderTierOptions() {
    if (!_selectedArtwork) return;

    // Render selected artwork summary (skip in floor-upgrade mode — user already knows which artwork)
    var summaryEl = _overlay.querySelector("#unlockSelectedArtwork");
    if (_floorUpgradeOnly) {
      summaryEl.innerHTML = '';
      summaryEl.classList.add("hidden");
    } else {
      summaryEl.classList.remove("hidden");
      var thumbUrl = _selectedArtwork.tile_url || '';
      var thumbHtml = thumbUrl
        ? '<img class="unlock-artwork-thumb" src="' + thumbUrl + '" alt="" />'
        : '<div class="unlock-artwork-thumb unlock-artwork-thumb-empty"></div>';

      summaryEl.innerHTML =
        thumbHtml +
        '<div class="unlock-artwork-info">' +
          '<div class="unlock-artwork-title">' + escapeHtml(_selectedArtwork.artwork_title || 'Untitled') + '</div>' +
          '<div class="unlock-artwork-artist">' + escapeHtml(_selectedArtwork.artist_name || '') + '</div>' +
        '</div>' +
        '<div class="unlock-artwork-status ' + statusBadgeClass(_selectedArtwork) + '">' + statusBadgeText(_selectedArtwork) + '</div>';
    }

    // Hide Back button in floor-upgrade mode — no prior step to return to
    var backLink = _overlay.querySelector("#unlockStep3Back");
    if (backLink) backLink.classList.toggle("hidden", _floorUpgradeOnly);

    // Fetch tier options from server
    var tierList = _overlay.querySelector("#unlockTierList");
    tierList.innerHTML = '<div class="unlock-tier-loading">Loading options...</div>';

    try {
      var resp = await fetch("/api/upgrade_options/" + _selectedArtwork.asset_id + "?code=" + encodeURIComponent(_editCode));
      var data = await resp.json();

      if (!data.ok) {
        tierList.innerHTML = '<div class="unlock-tier-loading">' + escapeHtml(data.error || 'Error loading options.') + '</div>';
        return;
      }

      tierList.innerHTML = '';

      // Update current tile size display
      var sizeEl = _overlay.querySelector("#unlockCurrentSize");
      if (sizeEl && data.current_tile_size) {
        var sizeNames = {'s': 'Small', 'm': 'Medium', 'lg': 'Large', 'xl': 'Extra Large'};
        sizeEl.textContent = sizeNames[data.current_tile_size] || data.current_tile_size.toUpperCase();
      } else if (sizeEl) {
        sizeEl.textContent = '';
      }

      data.tiers.forEach(function(tier) {

        var card = document.createElement("div");
        card.className = "unlock-tier-card";

        if (tier.status === 'available') {
          card.classList.add("available");
        } else {
          card.classList.add("disabled");
        }

        var priceHtml = '';
        var tc = (window.TIER_CONFIG || {})[tier.tier];
        var origCents = tc && tc.original_cents;
        if (origCents && origCents > tier.price_cents && tier.status === 'available') {
          var pctOff = Math.round((1 - tier.price_cents / origCents) * 100);
          priceHtml =
            '<span class="unlock-tier-price-original">' + formatPrice(origCents) + '</span> ' +
            '<span class="unlock-tier-price">' + formatPrice(tier.price_cents) + '</span> ' +
            '<span class="unlock-tier-badge">' + pctOff + '% OFF</span>';
        } else {
          priceHtml = '<span class="unlock-tier-price">' + formatPrice(tier.price_cents) + '</span>';
        }

        var descText = TIER_DESCRIPTIONS[tier.tier] || '';
        var reasonHtml = '';
        if (tier.status !== 'available' && tier.reason) {
          reasonHtml = '<div class="unlock-tier-reason">' + escapeHtml(tier.reason) + '</div>';
        }

        var ctaHtml = '';
        if (tier.status === 'available') {
          ctaHtml = '<button class="unlock-tier-cta" type="button" data-tier="' + tier.tier + '">Purchase</button>';
        }

        card.innerHTML =
          '<div class="unlock-tier-header">' +
            '<div class="unlock-tier-label">' + escapeHtml(tier.label) + '</div>' +
            '<div class="unlock-tier-price-wrap">' + priceHtml + '</div>' +
            '<div class="unlock-tier-onetime">One-time payment</div>' +
          '</div>' +
          '<div class="unlock-tier-desc">' + escapeHtml(descText) + '</div>' +
          reasonHtml +
          ctaHtml;

        // Wire purchase click
        if (tier.status === 'available') {
          var ctaBtn = card.querySelector(".unlock-tier-cta");
          ctaBtn.addEventListener("click", function(e) {
            e.stopPropagation();
            handlePurchase(tier.tier, this);
          });
        }

        tierList.appendChild(card);
      });

    } catch (err) {
      tierList.innerHTML = '<div class="unlock-tier-loading">Network error. Please try again.</div>';
    }
  }

  // Handle purchase CTA click
  async function handlePurchase(tierName, btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = "Redirecting...";

    try {
      var resp = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_id: _selectedArtwork.asset_id,
          tier: tierName,
          code: _editCode,
        }),
      });
      var data = await resp.json();

      if (data.ok && data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }

      // Error
      btnEl.disabled = false;
      btnEl.textContent = "Purchase";
      alert(data.error || "Unable to start checkout. Please try again.");

    } catch (err) {
      btnEl.disabled = false;
      btnEl.textContent = "Purchase";
      alert("Network error. Please try again.");
    }
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function resetState() {
    _currentStep = 1;
    _editCode = '';
    _email = '';
    _artworks = [];
    _selectedArtwork = null;

    if (_overlay) {
      var codeInput = _overlay.querySelector("#unlockCodeInput");
      if (codeInput) codeInput.value = '';
      hideError("unlockCodeError");

      var resendSection = _overlay.querySelector("#unlockResendSection");
      if (resendSection) resendSection.classList.add("hidden");

      var resendMsg = _overlay.querySelector("#unlockResendMsg");
      if (resendMsg) resendMsg.classList.add("hidden");

      var resendEmail = _overlay.querySelector("#unlockResendEmail");
      if (resendEmail) resendEmail.value = '';

      goToStep(1);
    }
  }

  function openUnlockModal(assetId, tileId) {
    _autoSelectAssetId = assetId ? parseInt(assetId) : null;
    _floorUpgradeOnly = false;
    var overlay = createOverlay();
    resetState();
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");

    // Focus code input
    setTimeout(function() {
      var input = _overlay.querySelector("#unlockCodeInput");
      if (input) input.focus();
    }, 100);

    // Push hash for back-button support
    window.ConicalNav && window.ConicalNav.pushToMatchUi();
  }

  // Direct upgrade flow: caller already knows the artwork and edit code.
  // Opens straight to tier selection — no identification step.
  function openFloorUpgrade(artwork, editCode) {
    _floorUpgradeOnly = true;
    _autoSelectAssetId = null;
    var overlay = createOverlay();
    resetState();
    _editCode = editCode;
    _artworks = [artwork];
    _selectedArtwork = artwork;
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    goToStep(3);
    window.ConicalNav && window.ConicalNav.pushToMatchUi();
  }

  function closeUnlockModal(fromHashChange) {
    if (!_overlay) return;
    _overlay.classList.add("hidden");
    _overlay.setAttribute("aria-hidden", "true");
    if (!fromHashChange) {
      window.ConicalNav && window.ConicalNav.popFromUiClose();
    }
  }

  function isUnlockModalOpen() {
    return _overlay ? !_overlay.classList.contains("hidden") : false;
  }

  window.openUnlockModal = openUnlockModal;
  window.openFloorUpgrade = openFloorUpgrade;
  window.closeUnlockModal = closeUnlockModal;
  window.isUnlockModalOpen = isUnlockModalOpen;

})();
