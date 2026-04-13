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

  var _fileInput = null;  // hidden file input, created once

  // ===== Helpers =====
  var escapeHtml = window.escapeHtml;

  function buildImageRowHtml(img, assetId) {
    var thumbSrc = img.thumb_url || img.image_url;
    var isSource = img.source_asset_id && img.source_asset_id === assetId;
    return '<div class="exdash-image-row" data-image-id="' + img.image_id + '">' +
      '<img class="exdash-thumb" src="' + escapeHtml(thumbSrc) + '" alt="" />' +
      '<div class="exdash-image-info">' +
        '<div class="exdash-image-title">' + escapeHtml(img.artwork_title || 'Untitled') + '</div>' +
        '<div class="exdash-image-artist">' + escapeHtml(img.artist_name || '') + '</div>' +
      '</div>' +
      (isSource
        ? ''
        : '<button class="exdash-delete-btn" data-image-id="' + img.image_id + '" title="Remove image">&times;</button>') +
      '<div class="exdash-drag-handle" title="Drag to reorder">&#10495;</div>' +
    '</div>';
  }

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
  var _adminPin = '';

  function _headers(extra) {
    var h = {};
    if (_adminPin) h['X-Admin-Pin'] = _adminPin;
    if (extra) { for (var k in extra) h[k] = extra[k]; }
    return h;
  }

  function openDashboard(assetId, editCode, adminPin) {
    ensureModal();
    _assetId = assetId;
    _editCode = editCode || '';
    _adminPin = adminPin || '';
    _dirty = false;

    _modal.classList.remove('hidden');
    _modal.setAttribute('aria-hidden', 'false');
    _modal.innerHTML = '<div class="exdash-loading">Loading dashboard...</div>';

    fetch('/api/exhibit/' + assetId + '/dashboard?code=' + encodeURIComponent(_editCode), { headers: _headers() })
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
      listHtml += buildImageRowHtml(images[i], exhibit.asset_id);
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
          '<h3 class="exdash-section-label exdash-collapsible" id="exdashProfileToggle">' +
            '<span class="exdash-chevron">&#9662;</span> Artist Profile' +
          '</h3>' +
          '<div id="exdashProfileBody">' +
          '<div class="exdash-photo-field">' +
            '<div class="exdash-photo-preview" id="exdashPhotoPreview">' +
              (exhibit.artist_photo_url
                ? '<img src="' + escapeHtml(exhibit.artist_photo_url) + '" alt="" />'
                : '<span class="exdash-photo-placeholder">&#128247;</span>') +
            '</div>' +
            '<button class="exdash-photo-btn" id="exdashPhotoBtn" type="button">' +
              (exhibit.artist_photo_url ? 'Change Photo' : 'Add Headshot') +
            '</button>' +
          '</div>' +
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
          '<button class="exdash-save-profile btn-gold" id="exdashSaveProfile">Save Profile</button>' +
          '</div>' +
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
            '<button class="exdash-add-btn btn-gold" id="exdashAddBtn"' +
              (imageCount >= 20 ? ' disabled' : '') + '>Add Artwork</button>' +
            '<button class="exdash-done-btn" id="exdashDoneBtn">Done</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Wire events
    _modal.querySelector('.exdash-close').addEventListener('click', closeDashboard);
    _modal.querySelector('#exdashDoneBtn').addEventListener('click', closeDashboard);
    _modal.querySelector('#exdashSaveProfile').addEventListener('click', saveProfile);
    _modal.querySelector('#exdashPhotoBtn').addEventListener('click', triggerPhotoUpload);

    // Profile section collapse/expand
    _modal.querySelector('#exdashProfileToggle').addEventListener('click', function() {
      var body = _modal.querySelector('#exdashProfileBody');
      var chevron = this.querySelector('.exdash-chevron');
      var container = _modal.querySelector('.exdash-container');
      if (body.classList.contains('hidden')) {
        body.classList.remove('hidden');
        container.classList.remove('exdash-profile-collapsed');
        chevron.innerHTML = '&#9662;';
      } else {
        body.classList.add('hidden');
        container.classList.add('exdash-profile-collapsed');
        chevron.innerHTML = '&#9656;';
      }
    });
    _modal.querySelector('#exdashAddBtn').addEventListener('click', triggerAddArtwork);

    // Image list event delegation: delete or edit
    _modal.querySelector('#exdashImageList').addEventListener('click', function(e) {
      var delBtn = e.target.closest('.exdash-delete-btn');
      if (delBtn) {
        e.stopPropagation();
        var delId = delBtn.getAttribute('data-image-id');
        if (delId) deleteImage(parseInt(delId, 10));
        return;
      }
      // Ignore clicks on drag handle
      if (e.target.closest('.exdash-drag-handle')) return;
      var row = e.target.closest('.exdash-image-row');
      if (row) {
        var editId = parseInt(row.getAttribute('data-image-id'), 10);
        if (editId) openImageEditor(editId);
      }
    });

    // Mark dirty on input change
    var inputs = _modal.querySelectorAll('.exdash-input, .exdash-textarea');
    for (var j = 0; j < inputs.length; j++) {
      inputs[j].addEventListener('input', function() { _dirty = true; });
    }

    // Init drag-to-reorder on image list
    initDragHandles();

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
      headers: _headers({ 'Content-Type': 'application/json' }),
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

  // ===== Artist Photo Upload =====
  var _photoInput = null;

  function triggerPhotoUpload() {
    if (!_photoInput) {
      _photoInput = document.createElement('input');
      _photoInput.type = 'file';
      _photoInput.accept = 'image/jpeg,image/png,image/webp';
      _photoInput.style.display = 'none';
      document.body.appendChild(_photoInput);

      _photoInput.addEventListener('change', function() {
        if (!_photoInput.files || !_photoInput.files[0]) return;
        uploadPhoto(_photoInput.files[0]);
        _photoInput.value = '';
      });
    }
    _photoInput.click();
  }

  function uploadPhoto(file) {
    if (!_assetId) return;

    var btn = _modal ? _modal.querySelector('#exdashPhotoBtn') : null;
    if (btn) { btn.textContent = 'Uploading...'; btn.disabled = true; }

    var formData = new FormData();
    formData.append('photo', file);
    formData.append('code', _editCode);

    fetch('/api/exhibit/' + _assetId + '/photo', {
      method: 'POST',
      headers: _headers(),
      body: formData
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.ok) {
          // Update preview
          var preview = _modal ? _modal.querySelector('#exdashPhotoPreview') : null;
          if (preview) preview.innerHTML = '<img src="' + escapeHtml(data.photo_url) + '" alt="" />';
          if (btn) { btn.textContent = 'Change Photo'; btn.disabled = false; }
          if (_currentData && _currentData.exhibit) _currentData.exhibit.artist_photo_url = data.photo_url;
        } else {
          if (btn) { btn.textContent = 'Upload failed'; btn.disabled = false; }
          setTimeout(function() { if (btn) btn.textContent = 'Change Photo'; }, 2000);
        }
      })
      .catch(function() {
        if (btn) { btn.textContent = 'Upload failed'; btn.disabled = false; }
        setTimeout(function() { if (btn) btn.textContent = 'Change Photo'; }, 2000);
      });
  }

  // ===== Add Artwork (file picker → upload → refresh) =====
  function ensureFileInput() {
    if (_fileInput) return;
    _fileInput = document.createElement('input');
    _fileInput.type = 'file';
    _fileInput.accept = 'image/jpeg,image/png,image/webp';
    _fileInput.style.display = 'none';
    document.body.appendChild(_fileInput);

    _fileInput.addEventListener('change', function() {
      if (!_fileInput.files || !_fileInput.files[0]) return;
      uploadImage(_fileInput.files[0]);
      _fileInput.value = '';  // reset so same file can be re-selected
    });
  }

  function triggerAddArtwork() {
    ensureFileInput();
    _fileInput.click();
  }

  function uploadImage(file) {
    if (!_currentData || !_currentData.exhibit) return;
    var exhibitId = _currentData.exhibit.exhibit_id;

    // Disable add button and show uploading state
    var addBtn = _modal ? _modal.querySelector('#exdashAddBtn') : null;
    if (addBtn) {
      addBtn.disabled = true;
      addBtn.textContent = 'Uploading...';
    }

    var formData = new FormData();
    formData.append('image', file);
    formData.append('code', _editCode);

    fetch('/api/exhibit/' + exhibitId + '/upload_image', {
      method: 'POST',
      headers: _headers(),
      body: formData
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.ok) {
          refreshImageList();
        } else {
          if (addBtn) {
            addBtn.textContent = data.error || 'Upload failed';
            addBtn.disabled = false;
            setTimeout(function() {
              if (addBtn) addBtn.textContent = 'Add Artwork';
            }, 2000);
          }
        }
      })
      .catch(function() {
        if (addBtn) {
          addBtn.textContent = 'Upload failed';
          addBtn.disabled = false;
          setTimeout(function() {
            if (addBtn) addBtn.textContent = 'Add Artwork';
          }, 2000);
        }
      });
  }

  function deleteImage(imageId) {
    if (!_currentData || !_currentData.exhibit) return;
    var exhibitId = _currentData.exhibit.exhibit_id;

    // Find the row and fade it
    var row = _modal ? _modal.querySelector('.exdash-image-row[data-image-id="' + imageId + '"]') : null;
    if (row) row.style.opacity = '0.4';

    fetch('/api/exhibit/' + exhibitId + '/image/' + imageId, {
      method: 'DELETE',
      headers: _headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code: _editCode })
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.ok) {
          refreshImageList();
        } else {
          if (row) row.style.opacity = '';
        }
      })
      .catch(function() {
        if (row) row.style.opacity = '';
      });
  }

  // ===== Drag-to-Reorder =====
  var _dragState = null;

  function initDragHandles() {
    var list = _modal ? _modal.querySelector('#exdashImageList') : null;
    if (!list) return;
    list.addEventListener('touchstart', onDragStart, { passive: false });
    list.addEventListener('mousedown', onDragStart);
  }

  function onDragStart(e) {
    var handle = e.target.closest('.exdash-drag-handle');
    if (!handle) return;
    e.preventDefault();

    var row = handle.closest('.exdash-image-row');
    if (!row) return;
    var list = row.parentElement;

    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    row.classList.add('exdash-row-dragging');

    _dragState = {
      el: row,
      list: list,
      startY: clientY
    };

    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  function onDragMove(e) {
    if (!_dragState) return;
    e.preventDefault();

    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    var list = _dragState.list;
    var rows = list.querySelectorAll('.exdash-image-row');

    for (var i = 0; i < rows.length; i++) {
      if (rows[i] === _dragState.el) continue;
      var rect = rows[i].getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      var dragIdx = indexOf(rows, _dragState.el);
      var targetIdx = indexOf(rows, rows[i]);

      if (clientY < midY && dragIdx > targetIdx) {
        list.insertBefore(_dragState.el, rows[i]);
        break;
      } else if (clientY > midY && dragIdx < targetIdx) {
        list.insertBefore(_dragState.el, rows[i].nextSibling);
        break;
      }
    }
  }

  function onDragEnd() {
    if (!_dragState) return;

    _dragState.el.classList.remove('exdash-row-dragging');

    var rows = _dragState.list.querySelectorAll('.exdash-image-row');
    var order = [];
    for (var i = 0; i < rows.length; i++) {
      order.push(parseInt(rows[i].getAttribute('data-image-id'), 10));
    }

    _dragState = null;

    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('touchend', onDragEnd);
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);

    saveReorder(order);
  }

  function indexOf(nodeList, el) {
    for (var i = 0; i < nodeList.length; i++) {
      if (nodeList[i] === el) return i;
    }
    return -1;
  }

  function saveReorder(order) {
    if (!_currentData || !_currentData.exhibit) return;
    var exhibitId = _currentData.exhibit.exhibit_id;

    fetch('/api/exhibit/' + exhibitId + '/reorder', {
      method: 'POST',
      headers: _headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code: _editCode, order: order })
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.ok) {
          // Update local order to match DOM
          var reordered = [];
          for (var i = 0; i < order.length; i++) {
            var img = findImageById(order[i]);
            if (img) reordered.push(img);
          }
          _currentData.images = reordered;
        }
      })
      .catch(function() {});
  }

  // ===== Image Metadata Editor =====
  function findImageById(imageId) {
    if (!_currentData || !_currentData.images) return null;
    for (var i = 0; i < _currentData.images.length; i++) {
      if (_currentData.images[i].image_id === imageId) return _currentData.images[i];
    }
    return null;
  }

  function openImageEditor(imageId) {
    var img = findImageById(imageId);
    if (!img) return;

    var container = _modal ? _modal.querySelector('.exdash-container') : null;
    if (!container) return;

    // Store scroll position and hide main content
    container.setAttribute('data-scroll', container.scrollTop);
    container.innerHTML =
      '<div class="exdash-accent"></div>' +
      '<div class="exdash-header">' +
        '<button class="exdash-back" aria-label="Back" id="exdashBack">&#8249;</button>' +
        '<h2 class="exdash-title">Edit Image Details</h2>' +
        '<div style="width:28px"></div>' +
      '</div>' +
      '<div class="exdash-section">' +
        '<div class="exdash-meta-thumb-wrap">' +
          '<img class="exdash-meta-thumb" src="' + escapeHtml(img.thumb_url || img.image_url) + '" alt="" />' +
        '</div>' +
        '<div class="exdash-field">' +
          '<label class="exdash-label">Artwork Title</label>' +
          '<input type="text" id="exdashMetaTitle" class="exdash-input" value="' + escapeHtml(img.artwork_title || '') + '" maxlength="200" />' +
        '</div>' +
        '<div class="exdash-field">' +
          '<label class="exdash-label">Artist Name</label>' +
          '<input type="text" id="exdashMetaArtist" class="exdash-input" value="' + escapeHtml(img.artist_name || '') + '" maxlength="100" />' +
        '</div>' +
        '<div class="exdash-field">' +
          '<label class="exdash-label">Year Created</label>' +
          '<input type="text" id="exdashMetaYear" class="exdash-input" value="' + escapeHtml(img.year_created || '') + '" maxlength="20" />' +
        '</div>' +
        '<div class="exdash-field">' +
          '<label class="exdash-label">Medium</label>' +
          '<input type="text" id="exdashMetaMedium" class="exdash-input" value="' + escapeHtml(img.medium || '') + '" maxlength="200" />' +
        '</div>' +
        '<div class="exdash-field">' +
          '<label class="exdash-label">Dimensions</label>' +
          '<input type="text" id="exdashMetaDimensions" class="exdash-input" value="' + escapeHtml(img.dimensions || '') + '" maxlength="100" />' +
        '</div>' +
        '<div class="exdash-field">' +
          '<label class="exdash-label">Artist Note or Edition Info</label>' +
          '<textarea id="exdashMetaEdition" class="exdash-textarea" placeholder="e.g. 1 of 10, Artist Proof, or a brief note about this piece" maxlength="500" rows="2">' + escapeHtml(img.edition_info || '') + '</textarea>' +
        '</div>' +
        '<div class="exdash-field">' +
          '<label class="exdash-label">For Sale</label>' +
          '<select id="exdashMetaForSale" class="exdash-input">' +
            '<option value=""' + (!img.for_sale ? ' selected' : '') + '>—</option>' +
            '<option value="yes"' + (img.for_sale === 'yes' ? ' selected' : '') + '>Yes</option>' +
            '<option value="no"' + (img.for_sale === 'no' ? ' selected' : '') + '>No</option>' +
          '</select>' +
        '</div>' +
        '<div class="exdash-field">' +
          '<label class="exdash-label">Sale Type</label>' +
          '<select id="exdashMetaSaleType" class="exdash-input"' +
            (img.for_sale === 'no' ? ' disabled' : '') + '>' +
            '<option value=""' + (!img.sale_type ? ' selected' : '') + '>—</option>' +
            '<option value="original"' + (img.sale_type === 'original' ? ' selected' : '') + '>Original</option>' +
            '<option value="print"' + (img.sale_type === 'print' ? ' selected' : '') + '>Print</option>' +
            '<option value="both"' + (img.sale_type === 'both' ? ' selected' : '') + '>Both</option>' +
          '</select>' +
        '</div>' +
        '<div class="exdash-field">' +
          '<label class="exdash-label">Contact 1</label>' +
          '<div class="exdash-contact-row">' +
            '<select id="exdashMetaC1Type" class="exdash-input exdash-contact-type">' +
              '<option value=""' + (!img.contact1_type ? ' selected' : '') + '>Type</option>' +
              '<option value="email"' + (img.contact1_type === 'email' ? ' selected' : '') + '>Email</option>' +
              '<option value="social"' + (img.contact1_type === 'social' ? ' selected' : '') + '>Social</option>' +
              '<option value="website"' + (img.contact1_type === 'website' ? ' selected' : '') + '>Website</option>' +
            '</select>' +
            '<input type="text" id="exdashMetaC1Value" class="exdash-input exdash-contact-value" value="' + escapeHtml(img.contact1_value || '') + '" />' +
          '</div>' +
        '</div>' +
        '<div class="exdash-field">' +
          '<label class="exdash-label">Contact 2</label>' +
          '<div class="exdash-contact-row">' +
            '<select id="exdashMetaC2Type" class="exdash-input exdash-contact-type">' +
              '<option value=""' + (!img.contact2_type ? ' selected' : '') + '>Type</option>' +
              '<option value="email"' + (img.contact2_type === 'email' ? ' selected' : '') + '>Email</option>' +
              '<option value="social"' + (img.contact2_type === 'social' ? ' selected' : '') + '>Social</option>' +
              '<option value="website"' + (img.contact2_type === 'website' ? ' selected' : '') + '>Website</option>' +
            '</select>' +
            '<input type="text" id="exdashMetaC2Value" class="exdash-input exdash-contact-value" value="' + escapeHtml(img.contact2_value || '') + '" />' +
          '</div>' +
        '</div>' +
        '<button class="exdash-save-profile btn-gold" id="exdashSaveMeta">Save Details</button>' +
      '</div>';

    container.scrollTop = 0;

    // Wire back button
    _modal.querySelector('#exdashBack').addEventListener('click', function() {
      _currentData && renderDashboard();
    });

    // Wire save
    _modal.querySelector('#exdashSaveMeta').addEventListener('click', function() {
      saveImageMeta(imageId);
    });

    // Grey out Sale Type when For Sale is "no"
    _modal.querySelector('#exdashMetaForSale').addEventListener('change', function() {
      var saleType = _modal.querySelector('#exdashMetaSaleType');
      if (this.value === 'no') {
        saleType.disabled = true;
        saleType.value = '';
      } else {
        saleType.disabled = false;
      }
    });
  }

  function saveImageMeta(imageId) {
    if (!_currentData || !_currentData.exhibit) return;
    var exhibitId = _currentData.exhibit.exhibit_id;

    var btn = _modal.querySelector('#exdashSaveMeta');
    var origText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    var payload = {
      code: _editCode,
      artwork_title: (_modal.querySelector('#exdashMetaTitle').value || '').trim(),
      artist_name: (_modal.querySelector('#exdashMetaArtist').value || '').trim(),
      year_created: (_modal.querySelector('#exdashMetaYear').value || '').trim(),
      medium: (_modal.querySelector('#exdashMetaMedium').value || '').trim(),
      dimensions: (_modal.querySelector('#exdashMetaDimensions').value || '').trim(),
      edition_info: (_modal.querySelector('#exdashMetaEdition').value || '').trim(),
      for_sale: (_modal.querySelector('#exdashMetaForSale').value || '').trim(),
      sale_type: (_modal.querySelector('#exdashMetaSaleType').value || '').trim(),
      contact1_type: (_modal.querySelector('#exdashMetaC1Type').value || '').trim(),
      contact1_value: (_modal.querySelector('#exdashMetaC1Value').value || '').trim(),
      contact2_type: (_modal.querySelector('#exdashMetaC2Type').value || '').trim(),
      contact2_value: (_modal.querySelector('#exdashMetaC2Value').value || '').trim()
    };

    fetch('/api/exhibit/' + exhibitId + '/image/' + imageId + '/metadata', {
      method: 'POST',
      headers: _headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.ok) {
          btn.textContent = 'Saved!';
          // Update local data so the list shows the new title/artist
          var img = findImageById(imageId);
          if (img) {
            img.artwork_title = payload.artwork_title;
            img.artist_name = payload.artist_name;
            img.year_created = payload.year_created;
            img.medium = payload.medium;
            img.dimensions = payload.dimensions;
            img.edition_info = payload.edition_info;
            img.for_sale = payload.for_sale;
            img.sale_type = payload.sale_type;
            img.contact1_type = payload.contact1_type;
            img.contact1_value = payload.contact1_value;
            img.contact2_type = payload.contact2_type;
            img.contact2_value = payload.contact2_value;
          }
          setTimeout(function() {
            renderDashboard();
          }, 800);
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

  function refreshImageList() {
    if (!_assetId || (!_editCode && !_adminPin)) return;

    fetch('/api/exhibit/' + _assetId + '/dashboard?code=' + encodeURIComponent(_editCode), { headers: _headers() })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data.ok) return;
        _currentData = data;
        // Re-render just the image list section and update count
        var images = data.images;
        var imageCount = images.length;
        var countText = imageCount >= 20
          ? '20 of 20 — Maximum reached'
          : imageCount + ' of 20 images';

        var assetId = data.exhibit.asset_id;
        var listHtml = '';
        for (var i = 0; i < images.length; i++) {
          listHtml += buildImageRowHtml(images[i], assetId);
        }

        var listEl = _modal ? _modal.querySelector('#exdashImageList') : null;
        if (listEl) listEl.innerHTML = listHtml;

        var countEl = _modal ? _modal.querySelector('.exdash-image-count') : null;
        if (countEl) countEl.textContent = countText;

        var addBtn = _modal ? _modal.querySelector('#exdashAddBtn') : null;
        if (addBtn) {
          addBtn.textContent = 'Add Artwork';
          addBtn.disabled = imageCount >= 20;
        }
      })
      .catch(function() {});
  }

  // ===== Close Dashboard =====
  function cleanupDrag() {
    if (_dragState) {
      _dragState.el.classList.remove('exdash-row-dragging');
      _dragState = null;
    }
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('touchend', onDragEnd);
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  }

  function closeDashboard() {
    cleanupDrag();
    _currentData = null;
    _assetId = null;
    _editCode = '';
    _adminPin = '';
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
