// ========================================
// Owner Edit Module
// Stores edit code in localStorage. Shows "edit" link on the metadata ribbon
// for owned artworks. Click opens metadata editor or exhibit dashboard.
// ========================================

(function() {
  "use strict";

  if (window.__ownerEditInitialized) return;
  window.__ownerEditInitialized = true;

  var STORAGE_KEY = 'tlg_edit_code';
  var _ownedAssets = null; // [{ asset_id, tile_id, asset_type }] or null

  // ===== localStorage helpers =====
  function storeCode(code) {
    try { localStorage.setItem(STORAGE_KEY, code); } catch(e) {}
  }

  function getStoredCode() {
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch(e) { return ''; }
  }

  function clearCode() {
    try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
  }

  // ===== Fetch owned assets =====
  function fetchOwnedAssets(code, callback) {
    fetch('/api/my_artworks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data.ok) {
          clearCode();
          _ownedAssets = null;
          callback(null);
          return;
        }
        _ownedAssets = [];
        for (var i = 0; i < data.artworks.length; i++) {
          var a = data.artworks[i];
          _ownedAssets.push({
            asset_id: a.asset_id,
            tile_id: a.tile_id || null,
            asset_type: a.asset_type || 'artwork'
          });
        }
        callback(_ownedAssets);
      })
      .catch(function() {
        _ownedAssets = null;
        callback(null);
      });
  }

  // ===== Check if an asset is owned =====
  function findOwnedAsset(assetId) {
    if (!_ownedAssets || !assetId) return null;
    var id = parseInt(assetId, 10);
    for (var i = 0; i < _ownedAssets.length; i++) {
      if (_ownedAssets[i].asset_id === id) return _ownedAssets[i];
    }
    return null;
  }

  // ===== Public API =====
  window.storeEditCode = function(code) {
    storeCode(code);
    fetchOwnedAssets(code, function() {});
  };

  window.getStoredEditCode = function() {
    return getStoredCode();
  };

  // Check if a given asset_id is owned by the stored code holder.
  // Returns { asset_id, tile_id, asset_type } or null.
  window.getOwnedAssetInfo = function(assetId) {
    return findOwnedAsset(assetId);
  };

  // Refresh ownership data (call after wall refresh)
  window.refreshOwnerData = function() {
    var code = getStoredCode();
    if (!code) {
      _ownedAssets = null;
      return;
    }
    fetchOwnedAssets(code, function() {});
  };

  // ===== Init on page load =====
  document.addEventListener('DOMContentLoaded', function() {
    var code = getStoredCode();
    if (code) {
      fetchOwnedAssets(code, function() {});
    }
  });

})();
