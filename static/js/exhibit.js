// ========================================
// Exhibit Module for The Last Gallery
// Handles: Intro Modal, Scrolling Gallery, 2-State + Popup Interaction
// ========================================
//
// Ribbon architecture (track model):
//   - Each image has a fixed position (x) in "track space"
//   - A single container translateX(-scrollPos) scrolls all images
//   - New clones appended on the right when the track's right edge nears the viewport
//   - Left-side items pruned when far off-screen
//   - Absolute positioning: adding/removing items never shifts others
//   - Works with any image count (3 to 20+)

(function() {
  "use strict";

  if (window.__exhibitModuleInitialized) return;
  window.__exhibitModuleInitialized = true;

  // ===== State =====
  var _overlay = null;
  var _currentExhibit = null;   // { exhibit, images } from API
  var _currentState = 'closed'; // 'closed' | 'intro' | 'scrolling' | 'paused' | 'popup'
  var _scrollRAF = null;
  var _ribbonEl = null;
  var _tickerEl = null;
  var _centeredIndex = -1;      // logical index of centered image

  // Track model
  var _trackItems = [];         // { el, x, width, logIdx }
  var _imageWidths = {};        // cached rendered width per logical index
  var _scrollPos = 0;           // current scroll offset in track space

  // Constants
  var SPACING = 40;             // px between images
  var SPEED = 0.81;             // px per animation frame
  var BUFFER = 300;             // off-screen buffer before pruning (px)

  // Swipe state (mobile browse-while-paused)
  var _touchStartX = 0;
  var _touchStartY = 0;
  var _touchStartTime = 0;
  var _swipeAnimating = false;

  // Drag state (desktop browse-while-paused)
  var _dragging = false;
  var _didDrag = false;         // true if mouse moved enough to count as drag (suppresses click)
  var _dragStartX = 0;
  var _dragLastX = 0;
  var _dragLastTime = 0;
  var _dragVelocity = 0;        // px/ms, smoothed
  var _dragMoveBound = null;    // stored reference for cleanup
  var _dragEndBound = null;

  // About Exhibits popup handle
  var _aboutExhibitsPopup = null;

  // ===== Helpers =====
  var escapeHtml = window.escapeHtml;

  function origCount() {
    return _currentExhibit ? _currentExhibit.images.length : 0;
  }

  function getRibbonWidth() {
    if (_ribbonEl && _ribbonEl.parentElement) {
      return _ribbonEl.parentElement.offsetWidth;
    }
    return window.innerWidth;
  }

  // ===== Build Overlay (once) =====
  function ensureOverlay() {
    if (_overlay) return;

    _overlay = document.createElement('div');
    _overlay.id = 'exhibitOverlay';
    _overlay.className = 'exhibit-full-overlay hidden';
    _overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(_overlay);
  }

  // ===== Intro Modal =====
  function openIntro(assetId) {
    ensureOverlay();

    _currentState = 'intro';
    _overlay.classList.remove('hidden');
    _overlay.setAttribute('aria-hidden', 'false');
    _overlay.innerHTML = '<div class="exhibit-intro-loading">Loading exhibit...</div>';

    // Push hash for back-button navigation
    location.hash = 'exhibit';
    window._pushedExhibitHash = true;

    fetch('/api/exhibit/public/' + assetId)
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data.ok) {
          _overlay.innerHTML = '<div class="exhibit-intro-error">Exhibit not available.</div>';
          return;
        }
        _currentExhibit = data;
        renderIntro(data);
      })
      .catch(function() {
        _overlay.innerHTML = '<div class="exhibit-intro-error">Failed to load exhibit.</div>';
      });
  }

  function renderIntro(data) {
    var exhibit = data.exhibit;
    var heroUrl = exhibit.artist_photo_url || exhibit.tile_url || '';
    var heroHtml = heroUrl
      ? '<img class="exhibit-intro-hero" src="' + escapeHtml(heroUrl) + '" alt="" />'
      : '';

    var locationHtml = exhibit.artist_location
      ? '<div class="exhibit-intro-location">' + escapeHtml(exhibit.artist_location) + '</div>'
      : '';

    // Medium/techniques one-liner
    var mediumHtml = exhibit.medium_techniques
      ? '<div class="exhibit-intro-medium">' + escapeHtml(exhibit.medium_techniques) + '</div>'
      : '';

    // Bio
    var bioText = exhibit.artist_bio
      ? escapeHtml(exhibit.artist_bio).replace(/\n/g, '<br>')
      : '';
    var bioEmpty = !exhibit.artist_bio;

    // Determine expandable content
    var hasExtraFields = !!(exhibit.artistic_focus || exhibit.background_education || exhibit.professional_highlights);
    var longBio = !bioEmpty && exhibit.artist_bio.length > 200;
    var hasExpand = hasExtraFields || longBio;

    var bioHtml;
    if (bioEmpty) {
      bioHtml = '<div class="exhibit-intro-bio-wrap">' +
        '<div class="exhibit-intro-bio exhibit-intro-bio-empty">This artist hasn\'t added a bio yet.</div>' +
        '</div>';
    } else {
      bioHtml = '<div class="exhibit-intro-bio-wrap' + (longBio ? ' exhibit-intro-truncated' : '') + '">' +
        '<div class="exhibit-intro-bio">' + bioText + '</div>' +
        '</div>';
    }

    // Expanded details
    var expandedHtml = '';
    if (hasExpand) {
      expandedHtml = '<div class="exhibit-intro-details hidden">';
      if (exhibit.artistic_focus) {
        expandedHtml +=
          '<div class="exhibit-intro-detail">' +
            '<div class="exhibit-intro-detail-label">Artistic Focus</div>' +
            '<div class="exhibit-intro-detail-text">' + escapeHtml(exhibit.artistic_focus).replace(/\n/g, '<br>') + '</div>' +
          '</div>';
      }
      if (exhibit.background_education) {
        expandedHtml +=
          '<div class="exhibit-intro-detail">' +
            '<div class="exhibit-intro-detail-label">Background &amp; Education</div>' +
            '<div class="exhibit-intro-detail-text">' + escapeHtml(exhibit.background_education).replace(/\n/g, '<br>') + '</div>' +
          '</div>';
      }
      if (exhibit.professional_highlights) {
        expandedHtml +=
          '<div class="exhibit-intro-detail">' +
            '<div class="exhibit-intro-detail-label">Professional Highlights</div>' +
            '<div class="exhibit-intro-detail-text">' + escapeHtml(exhibit.professional_highlights).replace(/\n/g, '<br>') + '</div>' +
          '</div>';
      }
      expandedHtml += '</div>';
      expandedHtml += '<a class="exhibit-intro-more-link" href="javascript:void(0)">More about this artist</a>';
    }

    _overlay.innerHTML =
      '<div class="exhibit-intro-container">' +
        '<div class="exhibit-intro-welcome">' +
          (exhibit.exhibit_title ? escapeHtml(exhibit.exhibit_title) + ' Art Exhibit' : 'Art Exhibit') +
        '</div>' +
        '<div class="exhibit-intro-card">' +
          '<div class="exhibit-intro-accent"></div>' +
          '<button class="exhibit-intro-close" aria-label="Close">&times;</button>' +
          '<div class="exhibit-intro-header">' +
            heroHtml +
            '<div class="exhibit-intro-artist-info">' +
              '<h2 class="exhibit-intro-name">' + escapeHtml(exhibit.artist_name) + '</h2>' +
              locationHtml +
            '</div>' +
          '</div>' +
          mediumHtml +
          bioHtml +
          expandedHtml +
          '<div class="exhibit-intro-actions">' +
            '<button class="exhibit-intro-cancel">Cancel</button>' +
            '<button class="exhibit-intro-enter">Enter Exhibit</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Wire events
    var closeBtn = _overlay.querySelector('.exhibit-intro-close');
    var cancelBtn = _overlay.querySelector('.exhibit-intro-cancel');
    var enterBtn = _overlay.querySelector('.exhibit-intro-enter');

    closeBtn.addEventListener('click', closeExhibit);
    cancelBtn.addEventListener('click', closeExhibit);
    enterBtn.addEventListener('click', function() {
      openScrollingGallery();
    });

    // Wire expand/collapse toggle
    var moreLink = _overlay.querySelector('.exhibit-intro-more-link');
    if (moreLink) {
      moreLink.addEventListener('click', function() {
        var card = _overlay.querySelector('.exhibit-intro-card');
        var bioWrap = _overlay.querySelector('.exhibit-intro-bio-wrap');
        var details = _overlay.querySelector('.exhibit-intro-details');
        var isExpanded = !details.classList.contains('hidden');

        if (isExpanded) {
          details.classList.add('hidden');
          if (longBio && bioWrap) bioWrap.classList.add('exhibit-intro-truncated');
          card.classList.remove('exhibit-intro-expanded-card');
          moreLink.textContent = 'More about this artist';
          card.scrollTop = 0;
        } else {
          details.classList.remove('hidden');
          if (bioWrap) bioWrap.classList.remove('exhibit-intro-truncated');
          card.classList.add('exhibit-intro-expanded-card');
          moreLink.textContent = 'Less';
        }
      });
    }

    // Owner edit button — absolute above intro card top-right
    var ownedInfo = typeof window.getOwnedAssetInfo === 'function'
      ? window.getOwnedAssetInfo(exhibit.asset_id) : null;
    var editBtn = null;
    if (ownedInfo) {
      editBtn = document.createElement('button');
      editBtn.className = 'exhibit-intro-edit-btn';
      editBtn.type = 'button';
      editBtn.textContent = 'edit';
      editBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var code = typeof window.getStoredEditCode === 'function' ? window.getStoredEditCode() : '';
        closeExhibit();
        if (typeof window.openExhibitDashboard === 'function') {
          window.openExhibitDashboard(ownedInfo.asset_id, code);
        }
      });
    }

    // Share button — absolute above intro card, to the left of edit (if present)
    var shareBtn = document.createElement('button');
    shareBtn.className = 'exhibit-intro-share-btn';
    shareBtn.type = 'button';
    shareBtn.setAttribute('aria-label', 'Share exhibit');
    shareBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>'
      + '<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>'
      + '</svg>';
    shareBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var url = window.location.origin + '/?art=' + exhibit.asset_id;
      if (navigator.share) {
        navigator.share({ title: 'The Last Gallery', url: url }).catch(function() {});
      } else {
        navigator.clipboard.writeText(url).then(function() {
          if (typeof window.showShareToast === 'function') window.showShareToast();
        }).catch(function() {});
      }
    });

    var cardEl = _overlay.querySelector('.exhibit-intro-card');
    var containerEl = _overlay.querySelector('.exhibit-intro-container');
    if (cardEl && containerEl) {
      containerEl.appendChild(shareBtn);
      if (editBtn) containerEl.appendChild(editBtn);
      // Position both buttons above the card's top-right corner
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

    // Close on backdrop click (wired once on overlay, not per renderIntro call)
    if (!_overlay.__backdropWired) {
      _overlay.__backdropWired = true;
      _overlay.addEventListener('click', function(e) {
        if (e.target === _overlay) closeExhibit();
      });
    }
  }

  // ===== Track Item Creation =====
  function createTrackItem(logIdx, x, knownWidth) {
    var imgData = _currentExhibit.images[logIdx];
    var div = document.createElement('div');
    div.className = 'exhibit-ribbon-item';
    div.setAttribute('data-index', String(logIdx));
    div.style.left = x + 'px';
    if (knownWidth) {
      div.style.width = knownWidth + 'px';
    }

    var img = document.createElement('img');
    img.src = imgData.scroll_url || imgData.image_url;
    img.alt = imgData.artwork_title || '';
    div.appendChild(img);

    return { el: div, x: x, width: knownWidth || 0, logIdx: logIdx };
  }

  // ===== Scrolling Gallery =====
  function openScrollingGallery() {
    if (!_currentExhibit || !_currentExhibit.images || _currentExhibit.images.length === 0) return;

    _currentState = 'scrolling';

    // Replace intro hash with exhibitview
    history.replaceState(null, '', '#exhibitview');

    var images = _currentExhibit.images;

    // Build gallery DOM
    // Close button is outside .exhibit-ribbon-wrapper (which has overflow:hidden)
    // but inside .exhibit-ribbon-area (positioning context, no clipping)
    _overlay.innerHTML =
      '<div class="exhibit-gallery-container">' +
        '<div class="exhibit-ribbon-area">' +
          '<button class="exhibit-gallery-close" aria-label="Exit exhibit">&times;</button>' +
          '<div class="exhibit-ribbon-wrapper">' +
            '<a class="exhibit-about-link" id="exhibitAboutLink">About Exhibits</a>' +
            '<div class="exhibit-gold-line exhibit-gold-line-top"></div>' +
            '<div class="exhibit-ribbon" id="exhibitRibbon"></div>' +
            '<div class="exhibit-gold-line exhibit-gold-line-bottom"></div>' +
          '</div>' +
        '</div>' +
        '<div class="exhibit-ticker" id="exhibitTicker">tap to pause</div>' +
      '</div>';

    _ribbonEl = document.getElementById('exhibitRibbon');
    _tickerEl = document.getElementById('exhibitTicker');

    // Wire events
    _overlay.querySelector('.exhibit-gallery-close')
      .addEventListener('click', closeExhibit);
    var aboutLink = document.getElementById('exhibitAboutLink');
    if (aboutLink) {
      aboutLink.addEventListener('click', function(e) {
        e.stopPropagation();
        // Open without hash push so #exhibitview stays intact
        if (_aboutExhibitsPopup) _aboutExhibitsPopup.open(true);
      });
    }
    var galleryContainer = _overlay.querySelector('.exhibit-gallery-container');
    galleryContainer.addEventListener('click', handleGalleryTap);
    wireSwipeEvents(galleryContainer);
    wireDragEvents(galleryContainer);

    // Reset state
    _scrollPos = 0;
    _trackItems = [];
    _imageWidths = {};

    // Hide ribbon until images are measured and positioned
    _ribbonEl.style.visibility = 'hidden';

    // Place one copy of source images (all at left:0 temporarily)
    for (var i = 0; i < images.length; i++) {
      var item = createTrackItem(i, 0, 0);
      _ribbonEl.appendChild(item.el);
      _trackItems.push(item);
    }

    // Wait for all images to load, then measure, position, and start
    var loadedCount = 0;
    var totalToLoad = images.length;
    var allImgs = _ribbonEl.querySelectorAll('img');

    function onAllLoaded() {
      // Measure rendered widths
      for (var i = 0; i < _trackItems.length; i++) {
        var w = _trackItems[i].el.offsetWidth;
        if (w < 10) w = 100; // fallback for failed images
        _trackItems[i].width = w;
        _imageWidths[_trackItems[i].logIdx] = w;
      }

      // Lay out sequentially: x₀=0, x₁=x₀+w₀+spacing, ...
      var x = 0;
      for (var i = 0; i < _trackItems.length; i++) {
        _trackItems[i].x = x;
        _trackItems[i].el.style.left = x + 'px';
        x += _trackItems[i].width + SPACING;
      }

      // Fill viewport with clones
      feedRight();

      // Show ribbon and start scrolling
      _ribbonEl.style.visibility = 'visible';
      _ribbonEl.style.transform = 'translateX(0px)';
      startScroll();
    }

    for (var j = 0; j < allImgs.length; j++) {
      if (allImgs[j].complete) {
        loadedCount++;
      } else {
        allImgs[j].addEventListener('load', function() {
          loadedCount++;
          if (loadedCount >= totalToLoad) onAllLoaded();
        });
        allImgs[j].addEventListener('error', function() {
          loadedCount++;
          if (loadedCount >= totalToLoad) onAllLoaded();
        });
      }
    }
    if (loadedCount >= totalToLoad) onAllLoaded();
  }

  // ===== Feed & Prune =====

  // Append images on the right to keep the track filled beyond the viewport.
  // Uses tracked coordinates — no DOM reads in this function.
  function feedRight() {
    if (!_ribbonEl || _trackItems.length === 0) return;
    var rw = getRibbonWidth();

    for (var safety = 0; safety < 60; safety++) {
      var last = _trackItems[_trackItems.length - 1];
      var rightEdge = last.x + last.width;

      // Stop when the right edge extends past viewport + spacing (in screen space)
      if (rightEdge - _scrollPos >= rw + SPACING) break;

      var nextIdx = (last.logIdx + 1) % origCount();
      var w = _imageWidths[nextIdx];
      if (!w) break; // safety: no cached width

      var newX = rightEdge + SPACING;
      var item = createTrackItem(nextIdx, newX, w);
      item.width = w;
      _ribbonEl.appendChild(item.el);
      _trackItems.push(item);
    }
  }

  // Remove images that have fully exited the left edge.
  // No scroll position adjustment needed — items have fixed track positions.
  function pruneLeft() {
    if (!_ribbonEl) return;
    while (_trackItems.length > 2) {
      var first = _trackItems[0];
      if (first.x + first.width < _scrollPos - BUFFER) {
        _ribbonEl.removeChild(first.el);
        _trackItems.shift();
      } else {
        break;
      }
    }
  }

  // Prepend one image on the left (for backward swipe navigation).
  // Returns true if an item was added, false otherwise.
  function prependOne() {
    if (!_ribbonEl || _trackItems.length === 0) return false;
    var first = _trackItems[0];
    var prevIdx = (first.logIdx - 1 + origCount()) % origCount();
    var w = _imageWidths[prevIdx];
    if (!w) return false;

    var newX = first.x - SPACING - w;
    var item = createTrackItem(prevIdx, newX, w);
    item.width = w;
    _ribbonEl.insertBefore(item.el, first.el);
    _trackItems.unshift(item);
    return true;
  }

  // Fill content to the left until the viewport's left edge is covered.
  function feedLeft() {
    if (!_ribbonEl || _trackItems.length === 0) return;
    for (var safety = 0; safety < 60; safety++) {
      if (_trackItems[0].x < _scrollPos - SPACING) break;
      if (!prependOne()) break;
    }
  }

  // Remove images far past the right viewport edge (after backward swiping).
  function pruneRight() {
    if (!_ribbonEl) return;
    var rw = getRibbonWidth();
    while (_trackItems.length > 2) {
      var last = _trackItems[_trackItems.length - 1];
      if (last.x > _scrollPos + rw + BUFFER) {
        _ribbonEl.removeChild(last.el);
        _trackItems.pop();
      } else {
        break;
      }
    }
  }

  // ===== Scroll Animation =====
  function startScroll() {
    _currentState = 'scrolling';
    if (_ribbonEl) _ribbonEl.classList.remove('exhibit-paused');
    if (_tickerEl) _tickerEl.textContent = 'tap image to view \u00b7 tap to pause';
    clearDimming();
    animateScroll();
  }

  function animateScroll() {
    if (_currentState !== 'scrolling') return;

    _scrollPos += SPEED;
    _ribbonEl.style.transform = 'translateX(' + (-_scrollPos) + 'px)';

    feedRight();
    pruneLeft();

    _scrollRAF = requestAnimationFrame(animateScroll);
  }

  function stopScroll() {
    if (_scrollRAF) {
      cancelAnimationFrame(_scrollRAF);
      _scrollRAF = null;
    }
  }

  // ===== Find nearest track item to viewport center =====
  function findNearestCenter() {
    if (_trackItems.length === 0) return null;
    var rw = getRibbonWidth();
    var centerInTrack = _scrollPos + rw / 2;

    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < _trackItems.length; i++) {
      var itemCenter = _trackItems[i].x + _trackItems[i].width / 2;
      var dist = Math.abs(itemCenter - centerInTrack);
      if (dist < bestDist) {
        bestDist = dist;
        best = _trackItems[i];
      }
    }
    return best;
  }

  // ===== Snap a track item to viewport center =====
  function snapToCenter(trackItem, duration, easing) {
    var dur = duration || 0.25;
    var ease = easing || 'cubic-bezier(0.22, 0.61, 0.36, 1)';
    var rw = getRibbonWidth();

    // Set scrollPos so the item's center aligns with viewport center
    _scrollPos = trackItem.x + trackItem.width / 2 - rw / 2;

    // Ensure content fills the viewport at the new scroll position
    // (must happen before transition so items exist during the animation)
    feedLeft();
    feedRight();

    _ribbonEl.style.transition = 'transform ' + dur + 's ' + ease;
    _ribbonEl.style.transform = 'translateX(' + (-_scrollPos) + 'px)';

    setTimeout(function() {
      if (!_ribbonEl) return;
      _ribbonEl.style.transition = '';
      // Clean up excess items after animation completes
      pruneLeft();
      pruneRight();
    }, Math.round(dur * 1000) + 30);
  }

  // ===== Dimming =====
  function dimExcept(logIdx) {
    for (var i = 0; i < _trackItems.length; i++) {
      if (_trackItems[i].logIdx === logIdx) {
        _trackItems[i].el.classList.remove('exhibit-ribbon-dimmed');
      } else {
        _trackItems[i].el.classList.add('exhibit-ribbon-dimmed');
      }
    }
  }

  function clearDimming() {
    for (var i = 0; i < _trackItems.length; i++) {
      _trackItems[i].el.classList.remove('exhibit-ribbon-dimmed');
    }
  }

  // ===== Pause =====
  function pause() {
    stopScroll();
    _currentState = 'paused';
    if (_ribbonEl) _ribbonEl.classList.add('exhibit-paused');
    var hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (_tickerEl) _tickerEl.textContent = hasTouch
      ? 'swipe to browse \u00b7 tap image to view \u00b7 tap to resume'
      : 'drag to browse \u00b7 click image to view \u00b7 click to resume';

    var nearest = findNearestCenter();
    if (nearest) {
      _centeredIndex = nearest.logIdx;
      snapToCenter(nearest);
    }
  }

  // ===== Focus + Popup =====
  function focusAndPopup(trackItem) {
    stopScroll();
    _centeredIndex = trackItem.logIdx;
    snapToCenter(trackItem);
    dimExcept(_centeredIndex);

    setTimeout(function() {
      openExhibitPopup(_centeredIndex);
    }, 280);
  }

  // ===== Swipe-to-Browse (paused state, mobile) =====
  function wireSwipeEvents(container) {
    container.addEventListener('touchstart', onSwipeTouchStart, { passive: true });
    container.addEventListener('touchend', onSwipeTouchEnd, { passive: false });
  }

  function onSwipeTouchStart(e) {
    if (_currentState !== 'paused') return;
    if (e.touches.length !== 1) return;
    _touchStartX = e.touches[0].clientX;
    _touchStartY = e.touches[0].clientY;
    _touchStartTime = Date.now();
  }

  function onSwipeTouchEnd(e) {
    if (_currentState !== 'paused') return;
    if (e.changedTouches.length === 0) return;

    var dx = e.changedTouches[0].clientX - _touchStartX;
    var dy = e.changedTouches[0].clientY - _touchStartY;
    var dt = Math.max(Date.now() - _touchStartTime, 1);

    // Must be a horizontal swipe: |dx| > 30px, more horizontal than vertical, under 600ms
    if (Math.abs(dx) < 30 || Math.abs(dy) > Math.abs(dx) || dt > 600) return;

    // Prevent the tap handler from also firing
    e.preventDefault();

    var direction = dx < 0 ? 1 : -1; // swipe left = advance forward (+1)

    // Velocity-proportional count: gentle flick = 1, strong swipe = many
    var velocity = Math.abs(dx) / dt; // px/ms
    var count = Math.max(1, Math.round(velocity * 3.5));
    var maxCount = Math.min(origCount(), 15);
    count = Math.min(count, maxCount);

    advanceBySwipe(direction, count);
  }

  function advanceBySwipe(direction, count) {
    if (!_ribbonEl || _swipeAnimating) return;

    var n = origCount();
    if (count > n) count = n;

    // Find current centered item in the track array
    var curItem = findNearestCenter();
    if (!curItem) return;
    var curIdx = _trackItems.indexOf(curItem);
    var targetIdx = curIdx + direction * count;

    // Ensure enough items exist in the target direction.
    // Cannot use feedRight/prependOne helpers here — they use viewport-based
    // conditions tied to _scrollPos, which hasn't moved yet. Instead, directly
    // append/prepend until the track covers the target index.
    if (direction > 0) {
      while (targetIdx >= _trackItems.length) {
        var last = _trackItems[_trackItems.length - 1];
        var nextIdx = (last.logIdx + 1) % origCount();
        var w = _imageWidths[nextIdx];
        if (!w) break;
        var newX = last.x + last.width + SPACING;
        var item = createTrackItem(nextIdx, newX, w);
        item.width = w;
        _ribbonEl.appendChild(item.el);
        _trackItems.push(item);
      }
    } else {
      while (targetIdx < 0) {
        var first = _trackItems[0];
        var prevIdx = (first.logIdx - 1 + origCount()) % origCount();
        var w = _imageWidths[prevIdx];
        if (!w) break;
        var newX = first.x - SPACING - w;
        var item = createTrackItem(prevIdx, newX, w);
        item.width = w;
        _ribbonEl.insertBefore(item.el, first.el);
        _trackItems.unshift(item);
        targetIdx++;
        curIdx++;
      }
    }

    // Clamp to valid range
    targetIdx = Math.max(0, Math.min(targetIdx, _trackItems.length - 1));

    var target = _trackItems[targetIdx];
    _centeredIndex = target.logIdx;
    _swipeAnimating = true;

    var duration = 0.25 + count * 0.07;
    snapToCenter(target, duration, 'cubic-bezier(0.08, 0.82, 0.17, 1)');

    setTimeout(function() {
      _swipeAnimating = false;
      pruneRight();
    }, Math.round(duration * 1000) + 50);
  }

  // ===== Desktop Drag-to-Browse (paused state) =====
  function wireDragEvents(container) {
    container.addEventListener('mousedown', onDragStart);
    // Bind move/up to document so drag continues even if pointer leaves the container
    _dragMoveBound = onDragMove;
    _dragEndBound = onDragEnd;
    document.addEventListener('mousemove', _dragMoveBound);
    document.addEventListener('mouseup', _dragEndBound);
  }

  function cleanupDragEvents() {
    if (_dragMoveBound) {
      document.removeEventListener('mousemove', _dragMoveBound);
      _dragMoveBound = null;
    }
    if (_dragEndBound) {
      document.removeEventListener('mouseup', _dragEndBound);
      _dragEndBound = null;
    }
    _dragging = false;
  }

  function onDragStart(e) {
    if (_currentState !== 'paused') return;
    if (e.button !== 0) return; // left click only
    if (e.target.closest('.exhibit-gallery-close')) return;

    _dragging = true;
    _didDrag = false;
    _dragStartX = e.clientX;
    _dragLastX = e.clientX;
    _dragLastTime = Date.now();
    _dragVelocity = 0;

    _ribbonEl.style.transition = '';
    e.preventDefault(); // prevent text selection
  }

  function onDragMove(e) {
    if (!_dragging) return;

    var dx = e.clientX - _dragLastX;
    var now = Date.now();
    var dt = Math.max(now - _dragLastTime, 1);

    // Flag as drag once mouse moves more than 4px from start
    if (!_didDrag && Math.abs(e.clientX - _dragStartX) > 4) {
      _didDrag = true;
      if (_ribbonEl) _ribbonEl.style.cursor = 'grabbing';
    }

    // Move ribbon: dragging right = negative scrollPos delta (content follows pointer)
    _scrollPos -= dx;
    if (_ribbonEl) {
      _ribbonEl.style.transform = 'translateX(' + (-_scrollPos) + 'px)';
    }

    // Feed content in the drag direction to prevent blank space
    if (dx < 0) feedRight();  // dragging left = need content on right
    else if (dx > 0) feedLeft(); // dragging right = need content on left

    // Smooth velocity (weighted average of current and previous)
    var instantVelocity = -dx / dt; // positive = scrolling forward (left)
    _dragVelocity = _dragVelocity * 0.3 + instantVelocity * 0.7;

    _dragLastX = e.clientX;
    _dragLastTime = now;
  }

  function onDragEnd(e) {
    if (!_dragging) return;
    _dragging = false;

    if (_ribbonEl) _ribbonEl.style.cursor = '';

    if (!_didDrag) return; // was a click, not a drag — let click handler handle it

    // Decay velocity if the pointer was stationary before release
    var dt = Date.now() - _dragLastTime;
    if (dt > 80) _dragVelocity = 0;

    var absV = Math.abs(_dragVelocity); // px/ms

    if (absV < 0.15) {
      // Low velocity — just snap to nearest
      var nearest = findNearestCenter();
      if (nearest) {
        _centeredIndex = nearest.logIdx;
        snapToCenter(nearest);
      }
    } else {
      // Momentum: convert velocity to image count
      var direction = _dragVelocity > 0 ? 1 : -1;
      var count = Math.max(1, Math.round(absV * 3.5));
      var maxCount = Math.min(origCount(), 15);
      count = Math.min(count, maxCount);
      advanceBySwipe(direction, count);
    }
  }

  // ===== Gallery Tap Handler (State Machine) =====
  //
  // Scrolling → tap image    → snap + dim + popup
  // Scrolling → tap empty    → pause (snap, no dim)
  // Paused   → tap image    → snap + dim + popup
  // Paused   → tap empty    → resume scrolling
  // Paused   → swipe        → advance (no dim)
  // Popup dismiss            → resume scrolling (dim clears)
  //
  function handleGalleryTap(e) {
    if (e.target.closest('.exhibit-gallery-close')) return;
    // A drag-release fires a click — suppress it
    if (_didDrag) { _didDrag = false; return; }

    var tappedEl = e.target.closest('.exhibit-ribbon-item');
    var tappedItem = null;

    if (tappedEl) {
      for (var i = 0; i < _trackItems.length; i++) {
        if (_trackItems[i].el === tappedEl) {
          tappedItem = _trackItems[i];
          break;
        }
      }
    }

    if (_currentState === 'scrolling') {
      if (tappedItem) {
        focusAndPopup(tappedItem);
      } else {
        pause();
      }
    } else if (_currentState === 'paused') {
      if (tappedItem) {
        focusAndPopup(tappedItem);
      } else {
        startScroll();
      }
    }
  }

  // ===== Exhibit Popup (uses existing popup with gold ribbon) =====
  function openExhibitPopup(imgIndex) {
    _currentState = 'popup';

    var imgData = _currentExhibit.images[imgIndex];
    if (!imgData) return;

    if (typeof window.openArtworkPopup === 'function') {
      window.openArtworkPopup({
        imgSrc: imgData.image_url,
        title: imgData.artwork_title || '',
        artist: imgData.artist_name || '',
        yearCreated: imgData.year_created || '',
        medium: imgData.medium || '',
        dimensions: imgData.dimensions || '',
        editionInfo: imgData.edition_info || '',
        forSale: imgData.for_sale || '',
        saleType: imgData.sale_type || '',
        contact1Type: imgData.contact1_type || '',
        contact1Value: imgData.contact1_value || '',
        contact2Type: imgData.contact2_type || '',
        contact2Value: imgData.contact2_value || ''
      });
    }
  }

  // ===== Close =====
  function closeExhibit(silent) {
    stopScroll();
    cleanupDragEvents();
    _currentState = 'closed';
    _currentExhibit = null;
    _centeredIndex = -1;
    _ribbonEl = null;
    _tickerEl = null;
    _trackItems = [];
    _imageWidths = {};
    _scrollPos = 0;

    if (_overlay) {
      _overlay.classList.add('hidden');
      _overlay.setAttribute('aria-hidden', 'true');
      _overlay.innerHTML = '';
    }

    if (!silent && window._pushedExhibitHash) {
      window._pushedExhibitHash = false;
      window.ConicalNav && window.ConicalNav.popFromUiClose();
    }
  }

  // ===== Handle popup close → resume scrolling =====
  function onPopupClosed() {
    if (_currentState === 'popup') {
      startScroll();
    }
  }

  // ===== Register About Exhibits popup =====
  if (typeof window.registerDismissible === 'function') {
    _aboutExhibitsPopup = window.registerDismissible(
      "aboutExhibitsOverlay", "aboutExhibitsCloseBtn", "aboutexhibits"
    );
  }

  // Wire About Exhibits footer buttons
  // Open pricing as a sub-overlay without hiding About Exhibits or pushing hash —
  // so dismissing pricing reveals About Exhibits still underneath.
  var pricingBtn = document.getElementById('aboutExhibitsPricingBtn');
  if (pricingBtn) {
    pricingBtn.addEventListener('click', function() {
      var pricingOverlay = document.getElementById('pricingOverlay');
      if (pricingOverlay) pricingOverlay.classList.remove('hidden');
    });
  }
  var closeFooterBtn = document.getElementById('aboutExhibitsCloseFooterBtn');
  if (closeFooterBtn) {
    closeFooterBtn.addEventListener('click', function() {
      if (_aboutExhibitsPopup) _aboutExhibitsPopup.close();
    });
  }

  // ===== Public API =====
  window.openExhibitIntro = openIntro;
  window.closeExhibit = closeExhibit;
  window.isExhibitOpen = function() { return _currentState !== 'closed'; };
  window.closeAboutExhibits = function(silent) { if (_aboutExhibitsPopup) _aboutExhibitsPopup.close(silent); };
  window._onExhibitPopupClosed = onPopupClosed;

})();
