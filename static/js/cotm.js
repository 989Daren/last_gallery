// ========================================
// Creator of the Month (COTM) Module
// Handles: Intro card, thumbnail grid, edit form, action bar
// ========================================

(function() {
  "use strict";

  if (window.__cotmModuleInitialized) return;
  window.__cotmModuleInitialized = true;

  // ===== State =====
  var _data = null;         // { cotm, artworks } from /api/cotm
  var _fetchPromise = null;  // pending fetch
  var _overlay = null;       // #cotmOverlay
  var _isOpen = false;
  var _afterCloseCallback = null;  // called after card close (e.g. showPinchHint)

  var escapeHtml = window.escapeHtml;

  // ===== Helpers =====
  // Check if the viewer has a stored edit code that matches the COTM artist's email.
  // Reads from owner_edit.js localStorage key (tlg_edit_codes: {email: code}).
  // Returns the matching code or null.
  function _findOwnerCode(artworks) {
    try {
      var map = JSON.parse(localStorage.getItem('tlg_edit_codes') || '{}');
      for (var i = 0; i < artworks.length; i++) {
        var email = (artworks[i].contact1_value || '').toLowerCase();
        if (email && map[email]) return map[email];
      }
    } catch(e) {}
    return null;
  }

  // ===== Public API =====
  window.openCotmCard = openCotmCard;
  window.closeCotmCard = closeCotmCard;
  window.fetchCotmData = fetchCotmData;
  window.initCotmAutoShow = initCotmAutoShow;
  window.openCotmEditAsAdmin = openCotmEditAsAdmin;
  window.isCotmCardOpen = function() { return _isOpen; };

  // ===== Data Fetching =====
  function fetchCotmData() {
    if (_fetchPromise) return _fetchPromise;
    _fetchPromise = fetch('/api/cotm')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.ok) _data = data;
        // Show/hide action bar and menu item based on active COTM
        if (data.ok && data.active) {
          showActionBar();
          showMenuItem();
        }
        return data;
      })
      .catch(function() { _data = null; });
    return _fetchPromise;
  }

  // ===== Action Bar =====
  function showActionBar() {
    var bar = document.getElementById('cotmActionBar');
    if (!bar) return;
    bar.classList.remove('hidden');
    updateActionBarPosition();

    // Recalculate wall viewport to account for the new bar
    window.dispatchEvent(new Event('resize'));

    // Observe countdown bar visibility changes (guard against duplicate observers)
    var countdownBar = document.getElementById('countdownBar');
    if (countdownBar && typeof MutationObserver !== 'undefined' && !countdownBar._cotmObserver) {
      countdownBar._cotmObserver = new MutationObserver(updateActionBarPosition);
      countdownBar._cotmObserver.observe(countdownBar, { attributes: true, attributeFilter: ['class'] });
    }

    var btn = document.getElementById('cotmActionBtn');
    if (btn && !btn._cotmWired) {
      btn._cotmWired = true;
      btn.addEventListener('click', function() { openCotmCard(); });
    }
  }

  function updateActionBarPosition() {
    var bar = document.getElementById('cotmActionBar');
    var countdownBar = document.getElementById('countdownBar');
    if (!bar) return;
    if (countdownBar && !countdownBar.classList.contains('hidden')) {
      bar.classList.add('below-countdown');
    } else {
      bar.classList.remove('below-countdown');
    }
  }

  // ===== Hamburger Menu Item =====
  function showMenuItem() {
    var li = document.getElementById('cotmMenuItem');
    if (li) li.classList.remove('hidden');
    var btn = document.getElementById('menu-item-cotm');
    if (btn && !btn._cotmWired) {
      btn._cotmWired = true;
      btn.addEventListener('click', function() {
        // Close hamburger menu
        var menu = document.getElementById('hamburger-menu');
        var menuBtn = document.getElementById('hamburger-btn');
        if (menu) { menu.classList.remove('open'); menu.setAttribute('aria-hidden', 'true'); }
        if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
        openCotmCard();
      });
    }
  }

  // ===== Auto-Show (after welcome) =====
  function initCotmAutoShow() {
    var showPinchHint = window.showPinchHint || function() {};

    function proceed() {
      if (!_data || !_data.active) {
        showPinchHint();
        return;
      }
      // Show once per COTM cycle; new winner = new key = shows again
      var key = 'cotm_seen_' + _data.cotm.month;
      if (localStorage.getItem(key)) {
        showPinchHint();
        return;
      }
      localStorage.setItem(key, '1');
      _afterCloseCallback = function() {
        setTimeout(showPinchHint, 300);
      };
      openCotmCard();
    }

    if (_data) {
      proceed();
    } else if (_fetchPromise) {
      _fetchPromise.then(proceed);
    } else {
      fetchCotmData().then(proceed);
    }
  }

  // ===== Open Card =====
  function openCotmCard() {
    if (_isOpen) return;

    _overlay = document.getElementById('cotmOverlay');
    if (!_overlay) return;

    if (!_data) {
      // Data not yet loaded — fetch first, then open
      fetchCotmData().then(function() {
        if (_data && _data.active) openCotmCard();
      });
      return;
    }

    if (!_data.active) return;

    _isOpen = true;
    renderCard(_data);
    _overlay.classList.remove('hidden');
    _overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Push hash for back-button navigation
    window.ConicalNav && window.ConicalNav.pushToMatchUi();
  }

  // ===== Close Card =====
  // silent=true when closed by ConicalNav (back button) — skip hash pop
  function closeCotmCard(silent) {
    if (!_isOpen) return;
    _isOpen = false;

    document.removeEventListener('keydown', _onKeyDown);

    if (_overlay) {
      _overlay.classList.add('hidden');
      _overlay.setAttribute('aria-hidden', 'true');
      _overlay.classList.remove('cotm-dimmed');
    }
    document.body.style.overflow = '';

    if (!silent) {
      window.ConicalNav && window.ConicalNav.popFromUiClose();
    }

    if (_afterCloseCallback) {
      var cb = _afterCloseCallback;
      _afterCloseCallback = null;
      cb();
    }
  }

  // ===== Render Card =====
  function renderCard(data) {
    var cotm = data.cotm;
    var artworks = data.artworks || [];

    // Hero image: headshot if available, else first artwork tile
    var heroUrl = cotm.bio_photo_url || (artworks.length > 0 ? artworks[0].tile_url : '');
    var heroHtml = heroUrl
      ? '<img class="cotm-hero" src="' + escapeHtml(heroUrl) + '" alt="" />'
      : '';

    var locationHtml = cotm.artist_location
      ? '<div class="cotm-location">' + escapeHtml(cotm.artist_location) + '</div>'
      : '';

    // Medium line (below header, like exhibit)
    var mediumHtml = cotm.medium_techniques
      ? '<div class="cotm-medium">' + escapeHtml(cotm.medium_techniques) + '</div>'
      : '';

    // Bio with expand/collapse (mirrors exhibit intro pattern)
    var bioText = cotm.bio_text
      ? escapeHtml(cotm.bio_text).replace(/\n/g, '<br>')
      : '';
    var bioEmpty = !cotm.bio_text;
    var hasExtraFields = !!(cotm.artistic_focus || cotm.background_education || cotm.professional_highlights);
    var longBio = !bioEmpty && cotm.bio_text.length > 200;
    var hasExpand = hasExtraFields || longBio;

    var bioHtml;
    if (bioEmpty) {
      bioHtml = '<div class="cotm-bio-wrap"></div>';
    } else {
      bioHtml = '<div class="cotm-bio-wrap' + (longBio ? ' cotm-truncated' : '') + '">' +
        '<div class="cotm-bio">' + bioText + '</div>' +
        '</div>';
    }

    // Expanded details
    var expandedHtml = '';
    if (hasExpand) {
      expandedHtml = '<div class="cotm-details hidden">';
      if (cotm.artistic_focus) {
        expandedHtml +=
          '<div class="cotm-detail">' +
            '<div class="cotm-detail-label">Artistic Focus</div>' +
            '<div class="cotm-detail-text">' + escapeHtml(cotm.artistic_focus).replace(/\n/g, '<br>') + '</div>' +
          '</div>';
      }
      if (cotm.background_education) {
        expandedHtml +=
          '<div class="cotm-detail">' +
            '<div class="cotm-detail-label">Background &amp; Education</div>' +
            '<div class="cotm-detail-text">' + escapeHtml(cotm.background_education).replace(/\n/g, '<br>') + '</div>' +
          '</div>';
      }
      if (cotm.professional_highlights) {
        expandedHtml +=
          '<div class="cotm-detail">' +
            '<div class="cotm-detail-label">Professional Highlights</div>' +
            '<div class="cotm-detail-text">' + escapeHtml(cotm.professional_highlights).replace(/\n/g, '<br>') + '</div>' +
          '</div>';
      }
      expandedHtml += '</div>';
      expandedHtml += '<a class="cotm-more-link" href="javascript:void(0)">More about this artist</a>';
    }

    // Thumbnail grid
    var count = artworks.length;
    var countClass = count > 4 ? 4 : count;
    var thumbsHtml = '';
    if (count > 0) {
      thumbsHtml = '<div class="cotm-thumbnails cotm-thumbnails-' + countClass + '">';
      for (var i = 0; i < count && i < 4; i++) {
        thumbsHtml += '<div class="cotm-thumb" data-index="' + i + '">' +
          '<img src="' + escapeHtml(artworks[i].tile_url) + '" alt="' + escapeHtml(artworks[i].artwork_title || '') + '" />' +
          '</div>';
      }
      thumbsHtml += '</div>';
      thumbsHtml += '<div class="cotm-thumb-hint">Tap image to enlarge</div>';
    }

    _overlay.innerHTML =
      '<div class="cotm-container">' +
        '<div class="cotm-welcome"><img src="/static/images/logo_email.png" class="cotm-welcome-logo" alt=""> Creator of the Month</div>' +
        '<div class="cotm-card">' +
          '<div class="cotm-accent"></div>' +
          '<button class="cotm-close" aria-label="Close">&times;</button>' +
          '<div class="cotm-header">' +
            heroHtml +
            '<div class="cotm-artist-info">' +
              '<h2 class="cotm-name">' + escapeHtml(cotm.artist_name) + '</h2>' +
              locationHtml +
            '</div>' +
          '</div>' +
          mediumHtml +
          bioHtml +
          expandedHtml +
          thumbsHtml +
          '<div class="cotm-actions">' +
            '<button class="cotm-enter">Enter Gallery</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Wire events
    var closeBtn = _overlay.querySelector('.cotm-close');
    var enterBtn = _overlay.querySelector('.cotm-enter');
    if (closeBtn) closeBtn.addEventListener('click', closeCotmCard);
    if (enterBtn) enterBtn.addEventListener('click', closeCotmCard);

    // Tap anywhere to close — skip interactive elements (buttons, links, thumbnails)
    _overlay.removeEventListener('click', _onOverlayClick);
    _overlay.addEventListener('click', _onOverlayClick);

    // Escape key
    document.addEventListener('keydown', _onKeyDown);

    // Wire expand/collapse toggle
    var moreLink = _overlay.querySelector('.cotm-more-link');
    if (moreLink) {
      moreLink.addEventListener('click', function(e) {
        e.stopPropagation();
        var card = _overlay.querySelector('.cotm-card');
        var bioWrap = _overlay.querySelector('.cotm-bio-wrap');
        var details = _overlay.querySelector('.cotm-details');
        var isExpanded = !details.classList.contains('hidden');

        if (isExpanded) {
          details.classList.add('hidden');
          if (longBio && bioWrap) bioWrap.classList.add('cotm-truncated');
          card.classList.remove('cotm-expanded-card');
          moreLink.textContent = 'More about this artist';
          card.scrollTop = 0;
        } else {
          details.classList.remove('hidden');
          if (bioWrap) bioWrap.classList.remove('cotm-truncated');
          card.classList.add('cotm-expanded-card');
          moreLink.textContent = 'Less';
        }
      });
    }

    // Thumbnail clicks → open artwork popup
    var thumbs = _overlay.querySelectorAll('.cotm-thumb');
    for (var t = 0; t < thumbs.length; t++) {
      thumbs[t].addEventListener('click', (function(idx) {
        return function(e) {
          e.stopPropagation();
          openArtworkFromCotm(artworks[idx]);
        };
      })(t));
    }

    // Share button — absolute positioned above card top-right
    var shareBtn = document.createElement('button');
    shareBtn.className = 'cotm-share-btn';
    shareBtn.type = 'button';
    shareBtn.setAttribute('aria-label', 'Share');
    shareBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>'
      + '<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>'
      + '</svg>';
    shareBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var url = window.location.origin + '/creator-of-the-month';
      if (navigator.share) {
        navigator.share({ title: 'The Last Gallery — Creator of the Month', url: url }).catch(function() {});
      } else {
        navigator.clipboard.writeText(url).then(function() {
          if (typeof window.showShareToast === 'function') window.showShareToast();
        }).catch(function() {});
      }
    });

    // Edit button — shown for owner (via localStorage edit code) or admin
    var editBtn = null;
    var ownerCode = _findOwnerCode(artworks);
    var isAdmin = typeof window.isAdminActive === 'function' && window.isAdminActive();
    if (ownerCode || isAdmin) {
      editBtn = document.createElement('button');
      editBtn.className = 'cotm-edit-btn';
      editBtn.type = 'button';
      editBtn.textContent = 'edit';
      editBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        closeCotmCard();
        if (ownerCode) {
          _editAuth = { code: ownerCode };
          _openEditFormWithFetch('/api/cotm/edit?code=' + encodeURIComponent(ownerCode), {});
        } else {
          var pin = typeof window.getAdminPin === 'function' ? window.getAdminPin() : '';
          openCotmEditAsAdmin(pin);
        }
      });
    }

    var containerEl = _overlay.querySelector('.cotm-container');
    var cardEl = _overlay.querySelector('.cotm-card');
    if (containerEl && cardEl) {
      containerEl.appendChild(shareBtn);
      if (editBtn) containerEl.appendChild(editBtn);
      // Position buttons above the card's top-right corner
      requestAnimationFrame(function() {
        var baseRight = containerEl.offsetWidth - cardEl.offsetLeft - cardEl.offsetWidth;
        var rowTop = cardEl.offsetTop - 6;
        if (editBtn) {
          editBtn.style.top = (rowTop - editBtn.offsetHeight) + 'px';
          editBtn.style.right = baseRight + 'px';
          shareBtn.style.top = (rowTop - shareBtn.offsetHeight) + 'px';
          shareBtn.style.right = (baseRight + editBtn.offsetWidth + 6) + 'px';
        } else {
          shareBtn.style.top = (rowTop - shareBtn.offsetHeight) + 'px';
          shareBtn.style.right = baseRight + 'px';
        }
      });
    }
  }

  function _onOverlayClick(e) {
    if (e.target.closest('a, button, .cotm-thumb, .cotm-share-btn')) return;
    closeCotmCard();
  }

  function _onKeyDown(e) {
    if (e.key === 'Escape' && _isOpen) {
      closeCotmCard();
    }
  }

  // ===== Open Artwork Popup from Thumbnail =====
  function openArtworkFromCotm(artwork) {
    // Dim the COTM card
    if (_overlay) {
      _overlay.classList.add('cotm-dimmed');
    }

    // Open standard artwork popup
    if (typeof window.openArtworkPopup === 'function') {
      window.openArtworkPopup({
        imgSrc: artwork.popup_url || artwork.tile_url,
        title: artwork.artwork_title || '',
        artist: artwork.artist_name || '',
        yearCreated: artwork.year_created || '',
        medium: artwork.medium || '',
        dimensions: artwork.dimensions || '',
        editionInfo: artwork.edition_info || '',
        forSale: artwork.for_sale || '',
        saleType: artwork.sale_type || '',
        contact1Type: artwork.contact1_type || '',
        contact1Value: artwork.contact1_value || '',
        contact2Type: artwork.contact2_type || '',
        contact2Value: artwork.contact2_value || '',
        assetId: artwork.asset_id || '',
        tileId: ''
      });
    }

    // Listen for popup close to restore COTM card
    window._onCotmPopupClosed = function() {
      if (_overlay) {
        _overlay.classList.remove('cotm-dimmed');
      }
      window._onCotmPopupClosed = null;
    };
  }

  // ===== COTM Edit Form =====
  // Auth context: either { code: '...' } or { adminPin: '...' }
  var _editAuth = null;

  function _editHeaders() {
    var h = {};
    if (_editAuth && _editAuth.adminPin) h['X-Admin-Pin'] = _editAuth.adminPin;
    return h;
  }

  function _editCodeParam() {
    return (_editAuth && _editAuth.code) ? _editAuth.code : '';
  }

  function openCotmEditAsAdmin(adminPin) {
    _editAuth = { adminPin: adminPin };
    _openEditFormWithFetch('/api/cotm/edit?code=', { 'X-Admin-Pin': adminPin });
  }

  function openCotmEditForm(code) {
    _editAuth = { code: code };
    _openEditFormWithFetch('/api/cotm/edit?code=' + encodeURIComponent(code), {});
  }

  function _openEditFormWithFetch(url, headers) {
    _overlay = document.getElementById('cotmOverlay');
    if (!_overlay) return;

    _overlay.classList.remove('hidden');
    _overlay.setAttribute('aria-hidden', 'false');
    _overlay.innerHTML = '<div class="cotm-container"><div class="cotm-edit-loading">Loading...</div></div>';
    document.body.style.overflow = 'hidden';

    fetch(url, { headers: headers })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data.ok) {
          _overlay.innerHTML = '<div class="cotm-container"><div class="cotm-edit-loading">' +
            escapeHtml(data.error || 'Error loading COTM profile.') + '</div></div>';
          return;
        }
        renderEditForm(data);
      })
      .catch(function() {
        _overlay.innerHTML = '<div class="cotm-container"><div class="cotm-edit-loading">Failed to load.</div></div>';
      });
  }

  function renderEditForm(data) {
    var cotm = data.cotm;
    var artworks = data.artworks || [];

    var photoPreview = cotm.bio_photo_url
      ? '<img src="' + escapeHtml(cotm.bio_photo_url) + '" alt="" />'
      : '<span class="cotm-edit-photo-placeholder">&#128247;</span>';

    // Build artwork toggles
    var artworkListHtml = '';
    for (var i = 0; i < artworks.length; i++) {
      var a = artworks[i];
      var excluded = a.excluded;
      artworkListHtml +=
        '<div class="cotm-edit-artwork-row' + (excluded ? ' cotm-edit-excluded' : '') + '" data-asset-id="' + a.asset_id + '">' +
          '<img class="cotm-edit-artwork-thumb" src="' + escapeHtml(a.tile_url) + '" alt="" />' +
          '<div class="cotm-edit-artwork-title">' + escapeHtml(a.artwork_title || 'Untitled') + '</div>' +
          '<button class="cotm-edit-toggle-btn" type="button">' + (excluded ? 'Include' : 'Exclude') + '</button>' +
        '</div>';
    }

    _overlay.innerHTML =
      '<div class="cotm-container">' +
        '<div class="cotm-welcome"><img src="/static/images/logo_email.png" class="cotm-welcome-logo" alt=""> Creator of the Month</div>' +
        '<div class="cotm-card cotm-edit-card">' +
          '<div class="cotm-accent"></div>' +
          '<button class="cotm-close" aria-label="Close">&times;</button>' +
          '<h2 class="cotm-edit-title">Personalize Your Spotlight</h2>' +

          '<div class="cotm-edit-section">' +
            '<div class="cotm-edit-photo-field">' +
              '<div class="cotm-edit-photo-preview" id="cotmEditPhotoPreview">' + photoPreview + '</div>' +
              '<button class="cotm-edit-photo-btn" id="cotmEditPhotoBtn" type="button">' +
                (cotm.bio_photo_url ? 'Change Photo' : 'Add Headshot') +
              '</button>' +
            '</div>' +
            '<div class="cotm-edit-field">' +
              '<label class="cotm-edit-label" for="cotmEditLocation">Location</label>' +
              '<input type="text" id="cotmEditLocation" class="cotm-edit-input" ' +
                'value="' + escapeHtml(cotm.artist_location || '') + '" ' +
                'placeholder="e.g. Brooklyn, NY" maxlength="100" />' +
            '</div>' +
            '<div class="cotm-edit-field">' +
              '<label class="cotm-edit-label" for="cotmEditMedium">Medium / Techniques</label>' +
              '<input type="text" id="cotmEditMedium" class="cotm-edit-input" ' +
                'value="' + escapeHtml(cotm.medium_techniques || '') + '" ' +
                'placeholder="e.g. Oil, watercolor, mixed media" maxlength="200" />' +
            '</div>' +
            '<div class="cotm-edit-field">' +
              '<label class="cotm-edit-label" for="cotmEditBio">Bio / Artist Statement</label>' +
              '<textarea id="cotmEditBio" class="cotm-edit-textarea" ' +
                'placeholder="Tell visitors about yourself and your work" ' +
                'maxlength="500" rows="4">' + escapeHtml(cotm.bio_text || '') + '</textarea>' +
            '</div>' +
            '<div class="cotm-edit-field">' +
              '<label class="cotm-edit-label" for="cotmEditFocus">Artistic Focus</label>' +
              '<textarea id="cotmEditFocus" class="cotm-edit-textarea" ' +
                'placeholder="Your style, subject matter, and the themes driving your work" ' +
                'maxlength="1000" rows="3">' + escapeHtml(cotm.artistic_focus || '') + '</textarea>' +
            '</div>' +
            '<div class="cotm-edit-field">' +
              '<label class="cotm-edit-label" for="cotmEditEducation">Background / Education</label>' +
              '<textarea id="cotmEditEducation" class="cotm-edit-textarea" ' +
                'placeholder="Artistic training, degrees, or how you developed your skills" ' +
                'maxlength="1000" rows="3">' + escapeHtml(cotm.background_education || '') + '</textarea>' +
            '</div>' +
            '<div class="cotm-edit-field">' +
              '<label class="cotm-edit-label" for="cotmEditHighlights">Professional Highlights</label>' +
              '<textarea id="cotmEditHighlights" class="cotm-edit-textarea" ' +
                'placeholder="Awards, residencies, exhibitions, collections, press" ' +
                'maxlength="1000" rows="3">' + escapeHtml(cotm.professional_highlights || '') + '</textarea>' +
            '</div>' +
          '</div>' +

          (artworks.length > 0
            ? '<div class="cotm-edit-section">' +
                '<h3 class="cotm-edit-section-heading">Featured Artwork</h3>' +
                '<div class="cotm-edit-artwork-list" id="cotmEditArtworkList">' + artworkListHtml + '</div>' +
              '</div>'
            : '') +

          '<div class="cotm-edit-actions">' +
            '<button class="cotm-edit-save" id="cotmEditSave">Save</button>' +
            '<button class="cotm-edit-done" id="cotmEditDone">Done</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Wire close
    var closeBtn = _overlay.querySelector('.cotm-close');
    if (closeBtn) closeBtn.addEventListener('click', closeCotmEdit);

    // Wire photo upload
    var photoBtn = document.getElementById('cotmEditPhotoBtn');
    if (photoBtn) {
      photoBtn.addEventListener('click', function() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', function() {
          if (!input.files || !input.files[0]) return;
          uploadCotmPhoto(input.files[0]);
        });
        input.click();
      });
    }

    // Wire artwork toggles (event delegation)
    var artworkList = document.getElementById('cotmEditArtworkList');
    if (artworkList) {
      artworkList.addEventListener('click', function(e) {
        var btn = e.target.closest('.cotm-edit-toggle-btn');
        if (!btn) return;
        var row = btn.closest('.cotm-edit-artwork-row');
        if (!row) return;

        // Count currently included
        var allRows = artworkList.querySelectorAll('.cotm-edit-artwork-row');
        var includedCount = 0;
        for (var r = 0; r < allRows.length; r++) {
          if (!allRows[r].classList.contains('cotm-edit-excluded')) includedCount++;
        }

        if (row.classList.contains('cotm-edit-excluded')) {
          // Including — check we don't exceed 4
          if (includedCount >= 4) return;
          row.classList.remove('cotm-edit-excluded');
          btn.textContent = 'Exclude';
        } else {
          // Excluding — must keep at least 1
          if (includedCount <= 1) return;
          row.classList.add('cotm-edit-excluded');
          btn.textContent = 'Include';
        }
      });
    }

    // Wire save
    var saveBtn = document.getElementById('cotmEditSave');
    if (saveBtn) {
      saveBtn.addEventListener('click', function() {
        saveCotmProfile();
      });
    }

    // Wire done
    var doneBtn = document.getElementById('cotmEditDone');
    if (doneBtn) {
      doneBtn.addEventListener('click', closeCotmEdit);
    }

    // Tap outside
    _overlay.removeEventListener('click', _onEditOverlayClick);
    _overlay.addEventListener('click', _onEditOverlayClick);
  }

  function _onEditOverlayClick(e) {
    if (e.target === _overlay) closeCotmEdit();
  }

  function saveCotmProfile() {
    var bio = (document.getElementById('cotmEditBio') || {}).value || '';
    var location = (document.getElementById('cotmEditLocation') || {}).value || '';
    var medium = (document.getElementById('cotmEditMedium') || {}).value || '';
    var focus = (document.getElementById('cotmEditFocus') || {}).value || '';
    var education = (document.getElementById('cotmEditEducation') || {}).value || '';
    var highlights = (document.getElementById('cotmEditHighlights') || {}).value || '';

    // Collect excluded asset IDs
    var excluded = [];
    var rows = document.querySelectorAll('#cotmEditArtworkList .cotm-edit-artwork-row.cotm-edit-excluded');
    for (var i = 0; i < rows.length; i++) {
      var id = parseInt(rows[i].getAttribute('data-asset-id'));
      if (!isNaN(id)) excluded.push(id);
    }

    var saveBtn = document.getElementById('cotmEditSave');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

    var headers = { 'Content-Type': 'application/json' };
    var h = _editHeaders();
    for (var k in h) headers[k] = h[k];

    fetch('/api/cotm/profile', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        code: _editCodeParam(),
        bio_text: bio,
        artist_location: location,
        medium_techniques: medium,
        artistic_focus: focus,
        background_education: education,
        professional_highlights: highlights,
        excluded_asset_ids: excluded
      })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = data.ok ? 'Saved!' : 'Error';
        if (data.ok) {
          setTimeout(function() { saveBtn.textContent = 'Save'; }, 2000);
          // Invalidate cached data so next card open reflects changes
          _data = null;
          _fetchPromise = null;
        }
      }
    })
    .catch(function() {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Error'; }
    });
  }

  function uploadCotmPhoto(file) {
    var formData = new FormData();
    formData.append('photo', file);
    formData.append('code', _editCodeParam());

    var preview = document.getElementById('cotmEditPhotoPreview');
    if (preview) preview.innerHTML = '<span class="cotm-edit-photo-placeholder">Uploading...</span>';

    fetch('/api/cotm/photo', { method: 'POST', headers: _editHeaders(), body: formData })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.ok && data.photo_url && preview) {
          preview.innerHTML = '<img src="' + escapeHtml(data.photo_url) + '" alt="" />';
          var photoBtn = document.getElementById('cotmEditPhotoBtn');
          if (photoBtn) photoBtn.textContent = 'Change Photo';
          // Invalidate cache
          _data = null;
          _fetchPromise = null;
        } else if (preview) {
          preview.innerHTML = '<span class="cotm-edit-photo-placeholder">&#128247;</span>';
        }
      })
      .catch(function() {
        if (preview) preview.innerHTML = '<span class="cotm-edit-photo-placeholder">&#128247;</span>';
      });
  }

  function closeCotmEdit() {
    if (_overlay) {
      _overlay.classList.add('hidden');
      _overlay.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';
    // Redirect to gallery
    history.replaceState(null, '', '/');
    window.PAGE_MODE = '';
  }

  // ===== Init: handle PAGE_MODE =====
  document.addEventListener('DOMContentLoaded', function() {
    // If PAGE_MODE is creator-of-the-month and code param is present, open edit form
    if (window.PAGE_MODE === 'creator-of-the-month') {
      var params = new URLSearchParams(window.location.search);
      var code = params.get('code');
      if (code) {
        openCotmEditForm(code);
        return;
      }
      // Otherwise, the card will be opened by the main.js PAGE_MODE handler or auto-show
    }

    // Pre-fetch COTM data
    fetchCotmData();
  });

})();
