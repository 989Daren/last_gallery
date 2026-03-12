// ========================================
// Exhibit Dashboard Module
// Handles: Artist profile editing, image list management
// ========================================

(function() {
  "use strict";

  if (window.__exhibitDashboardInitialized) return;
  window.__exhibitDashboardInitialized = true;

  // ===== State =====
  var _modal = null;
  var _currentData = null;  // { exhibit, images } from API
  var _editCode = '';
  var _assetId = null;
  var _dirty = false;       // profile fields changed

  // ===== Helpers =====
  var escapeHtml = window.escapeHtml;

  // ===== Build Modal (once) =====
  function ensureModal() {
    if (_modal) return;
    _modal = document.createElement('div');
    _modal.id = 'exhibitDashboardModal';
    _modal.className = 'exdash-overlay hidden';
    _modal.setAttribute('aria-hidden', 'true');
    document.body.appendChild(_modal);
  }

  // ===== Open Dashboard =====
  function openDashboard(assetId, editCode) {
    ensureModal();
    _assetId = assetId;
    _editCode = editCode;
    _dirty = false;

    _modal.classList.remove('hidden');
    _modal.setAttribute('aria-hidden', 'false');
    _modal.innerHTML = '<div class="exdash-loading">Loading dashboard...</div>';

    fetch('/api/exhibit/' + assetId + '/dashboard?code=' + encodeURIComponent(editCode))
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data.ok) {
          _modal.innerHTML = '<div class="exdash-loading">Error: ' + escapeHtml(data.error) + '</div>';
          return;
        }
        _currentData = data;
        renderDashboard();
      })
      .catch(function() {
        _modal.innerHTML = '<div class="exdash-loading">Failed to load dashboard.</div>';
      });
  }

  // ===== Render Dashboard =====
  function renderDashboard() {
    var exhibit = _currentData.exhibit;
    var images = _currentData.images;
    var imageCount = images.length;

    var countText = imageCount >= 20
      ? '20 of 20 — Maximum reached'
      : imageCount + ' of 20 images';

    // Build image list HTML
    var listHtml = '';
    for (var i = 0; i < images.length; i++) {
      var img = images[i];
      listHtml +=
        '<div class="exdash-image-row" data-image-id="' + img.image_id + '">' +
          '<img class="exdash-thumb" src="' + escapeHtml(img.image_url) + '" alt="" />' +
          '<div class="exdash-image-info">' +
            '<div class="exdash-image-title">' + escapeHtml(img.artwork_title || 'Untitled') + '</div>' +
            '<div class="exdash-image-artist">' + escapeHtml(img.artist_name || '') + '</div>' +
          '</div>' +
          '<div class="exdash-drag-handle" title="Drag to reorder">&#10495;</div>' +
        '</div>';
    }

    _modal.innerHTML =
      '<div class="exdash-container">' +
        '<div class="exdash-accent"></div>' +
        '<div class="exdash-header">' +
          '<h2 class="exdash-title">Exhibit Dashboard</h2>' +
          '<button class="exdash-close" aria-label="Close">&times;</button>' +
        '</div>' +

        // ===== Profile Section =====
        '<div class="exdash-section">' +
          '<h3 class="exdash-section-label">Artist Profile</h3>' +
          '<div class="exdash-field">' +
            '<label class="exdash-label" for="exdashArtistName">Artist Name</label>' +
            '<input type="text" id="exdashArtistName" class="exdash-input" ' +
              'value="' + escapeHtml(exhibit.artist_name) + '" ' +
              'placeholder="e.g. Jane Doe" maxlength="100" />' +
          '</div>' +
          '<div class="exdash-field">' +
            '<label class="exdash-label" for="exdashExhibitTitle">Exhibit Title</label>' +
            '<div class="exdash-title-wrap">' +
              '<input type="text" id="exdashExhibitTitle" class="exdash-input" ' +
                'value="' + escapeHtml(exhibit.exhibit_title) + '" ' +
                'placeholder="e.g. Smith Family" maxlength="100" />' +
              '<span class="exdash-title-suffix">Art Exhibit</span>' +
            '</div>' +
            '<div class="exdash-field-hint">Leave blank to display simply as "Art Exhibit"</div>' +
          '</div>' +
          '<div class="exdash-field">' +
            '<label class="exdash-label" for="exdashLocation">Location</label>' +
            '<input type="text" id="exdashLocation" class="exdash-input" ' +
              'value="' + escapeHtml(exhibit.artist_location) + '" ' +
              'placeholder="e.g. Brooklyn, NY" maxlength="100" />' +
          '</div>' +
          '<div class="exdash-field">' +
            '<label class="exdash-label" for="exdashMedium">Medium / Techniques</label>' +
            '<input type="text" id="exdashMedium" class="exdash-input" ' +
              'value="' + escapeHtml(exhibit.medium_techniques) + '" ' +
              'placeholder="e.g. Oil, watercolor, mixed media" maxlength="200" />' +
          '</div>' +
          '<div class="exdash-field">' +
            '<label class="exdash-label" for="exdashBio">Artist Statement</label>' +
            '<textarea id="exdashBio" class="exdash-textarea" ' +
              'placeholder="Tell visitors about yourself (2-3 paragraphs)" ' +
              'maxlength="1500" rows="4">' + escapeHtml(exhibit.artist_bio) + '</textarea>' +
          '</div>' +
          '<div class="exdash-field">' +
            '<label class="exdash-label" for="exdashFocus">Artistic Focus</label>' +
            '<textarea id="exdashFocus" class="exdash-textarea" ' +
              'placeholder="Your style, subject matter, and the themes driving your work" ' +
              'maxlength="1000" rows="3">' + escapeHtml(exhibit.artistic_focus) + '</textarea>' +
          '</div>' +
          '<div class="exdash-field">' +
            '<label class="exdash-label" for="exdashEducation">Background / Education</label>' +
            '<textarea id="exdashEducation" class="exdash-textarea" ' +
              'placeholder="Artistic training, degrees, or how you developed your skills" ' +
              'maxlength="1000" rows="3">' + escapeHtml(exhibit.background_education) + '</textarea>' +
          '</div>' +
          '<div class="exdash-field">' +
            '<label class="exdash-label" for="exdashHighlights">Professional Highlights</label>' +
            '<textarea id="exdashHighlights" class="exdash-textarea" ' +
              'placeholder="Awards, residencies, exhibitions, collections, press" ' +
              'maxlength="1000" rows="3">' + escapeHtml(exhibit.professional_highlights) + '</textarea>' +
          '</div>' +
          '<button class="exdash-save-profile" id="exdashSaveProfile">Save Profile</button>' +
        '</div>' +

        // ===== Image List Section =====
        '<div class="exdash-section">' +
          '<div class="exdash-images-header">' +
            '<h3 class="exdash-section-label">Exhibit Images</h3>' +
            '<span class="exdash-image-count">' + countText + '</span>' +
          '</div>' +
          '<div class="exdash-image-list" id="exdashImageList">' +
            listHtml +
          '</div>' +
          '<div class="exdash-bottom-bar">' +
            '<button class="exdash-add-btn" id="exdashAddBtn"' +
              (imageCount >= 20 ? ' disabled' : '') + '>Add Artwork</button>' +
            '<button class="exdash-done-btn" id="exdashDoneBtn">Done</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Wire events
    _modal.querySelector('.exdash-close').addEventListener('click', closeDashboard);
    _modal.querySelector('#exdashDoneBtn').addEventListener('click', closeDashboard);
    _modal.querySelector('#exdashSaveProfile').addEventListener('click', saveProfile);

    // Mark dirty on input change
    var inputs = _modal.querySelectorAll('.exdash-input, .exdash-textarea');
    for (var j = 0; j < inputs.length; j++) {
      inputs[j].addEventListener('input', function() { _dirty = true; });
    }

    // Close on backdrop click
    _modal.addEventListener('click', function(e) {
      if (e.target === _modal) closeDashboard();
    });
  }

  // ===== Save Profile =====
  function saveProfile() {
    var btn = _modal.querySelector('#exdashSaveProfile');
    var origText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    var payload = {
      code: _editCode,
      artist_name: (_modal.querySelector('#exdashArtistName').value || '').trim(),
      exhibit_title: (_modal.querySelector('#exdashExhibitTitle').value || '').trim(),
      artist_location: (_modal.querySelector('#exdashLocation').value || '').trim(),
      medium_techniques: (_modal.querySelector('#exdashMedium').value || '').trim(),
      artist_bio: (_modal.querySelector('#exdashBio').value || '').trim(),
      artistic_focus: (_modal.querySelector('#exdashFocus').value || '').trim(),
      background_education: (_modal.querySelector('#exdashEducation').value || '').trim(),
      professional_highlights: (_modal.querySelector('#exdashHighlights').value || '').trim()
    };

    fetch('/api/exhibit/' + _assetId + '/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.ok) {
          btn.textContent = 'Saved!';
          _dirty = false;
          setTimeout(function() {
            if (btn) btn.textContent = origText;
            if (btn) btn.disabled = false;
          }, 1500);
        } else {
          btn.textContent = 'Error — try again';
          setTimeout(function() {
            if (btn) btn.textContent = origText;
            if (btn) btn.disabled = false;
          }, 2000);
        }
      })
      .catch(function() {
        btn.textContent = 'Error — try again';
        setTimeout(function() {
          if (btn) btn.textContent = origText;
          if (btn) btn.disabled = false;
        }, 2000);
      });
  }

  // ===== Close Dashboard =====
  function closeDashboard() {
    _currentData = null;
    _assetId = null;
    _editCode = '';
    _dirty = false;

    if (_modal) {
      _modal.classList.add('hidden');
      _modal.setAttribute('aria-hidden', 'true');
      _modal.innerHTML = '';
    }
  }

  // ===== Public API =====
  window.openExhibitDashboard = openDashboard;
  window.closeExhibitDashboard = closeDashboard;

})();
