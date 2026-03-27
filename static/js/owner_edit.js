// ========================================
// Owner Edit Module
// Stores edit codes in localStorage ({email: code} map). Shows "edit" and
// "unlock"/"upgrade" links on the metadata ribbon for owned artworks.
// ========================================

(function() {
  "use strict";

  if (window.__ownerEditInitialized) return;
  window.__ownerEditInitialized = true;

  var STORAGE_KEY = 'tlg_edit_codes';
  var OLD_STORAGE_KEY = 'tlg_edit_code';

  var _ownedAssets = null;   // [{ asset_id, tile_id, asset_type, ... }] or null
  var _codeForAsset = {};    // { asset_id: code } reverse lookup

  // ===== localStorage helpers =====

  function readMap() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch(e) { return {}; }
  }

  function writeMap(map) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch(e) {}
  }

  function storeCode(code, email) {
    var map = readMap();
    var key = email ? email.toLowerCase() : '_' + code;
    map[key] = code;
    writeMap(map);
  }

  function removeCode(code) {
    var map = readMap();
    for (var k in map) {
      if (map.hasOwnProperty(k) && map[k] === code) {
        delete map[k];
      }
    }
    writeMap(map);
  }

  function getAllCodes() {
    var map = readMap();
    var codes = [];
    var seen = {};
    for (var k in map) {
      if (map.hasOwnProperty(k) && map[k] && !seen[map[k]]) {
        codes.push(map[k]);
        seen[map[k]] = true;
      }
    }
    return codes;
  }

  // Migrate old single-code key to new map format
  function migrateOldKey() {
    try {
      var old = localStorage.getItem(OLD_STORAGE_KEY);
      if (old) {
        storeCode(old);
        localStorage.removeItem(OLD_STORAGE_KEY);
      }
    } catch(e) {}
  }

  // ===== Fetch owned assets for all stored codes =====
  function fetchAllOwnedAssets(callback) {
    var codes = getAllCodes();
    if (codes.length === 0) {
      _ownedAssets = null;
      _codeForAsset = {};
      callback(null);
      return;
    }

    var pending = codes.length;
    var allAssets = [];
    var newCodeMap = {};

    codes.forEach(function(code) {
      fetch('/api/my_artworks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code })
      })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.ok && data.artworks) {
            // Update map with real email from API response
            if (data.email) {
              newCodeMap[data.email.toLowerCase()] = code;
            }
            for (var i = 0; i < data.artworks.length; i++) {
              var a = data.artworks[i];
              allAssets.push({
                asset_id: a.asset_id,
                tile_id: a.tile_id || null,
                asset_type: a.asset_type || 'artwork',
                artwork_title: a.artwork_title || '',
                artist_name: a.artist_name || '',
                tile_url: a.tile_url || '',
                unlocked: a.unlocked || 0,
                qualified_floor: a.qualified_floor || 's'
              });
              _codeForAsset[a.asset_id] = code;
            }
          } else {
            removeCode(code);
          }
          finish();
        })
        .catch(function() { finish(); });
    });

    function finish() {
      pending--;
      if (pending > 0) return;
      // Consolidate map with real emails (replace _code placeholder keys)
      if (Object.keys(newCodeMap).length > 0) writeMap(newCodeMap);
      _ownedAssets = allAssets.length > 0 ? allAssets : null;
      callback(_ownedAssets);
    }
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
  window.storeEditCode = function(code, email) {
    storeCode(code, email);
    fetchAllOwnedAssets(function() {});
  };

  window.getStoredEditCode = function() {
    var codes = getAllCodes();
    return codes.length > 0 ? codes[0] : '';
  };

  window.getEditCodeForAsset = function(assetId) {
    var id = parseInt(assetId, 10);
    return _codeForAsset[id] || window.getStoredEditCode();
  };

  // Check if a given asset_id is owned by any stored code holder.
  // Returns { asset_id, tile_id, asset_type, ... } or null.
  window.getOwnedAssetInfo = function(assetId) {
    return findOwnedAsset(assetId);
  };

  // Refresh ownership data (call after wall refresh)
  window.refreshOwnerData = function() {
    fetchAllOwnedAssets(function() {});
  };

  // ===== Init on page load =====
  document.addEventListener('DOMContentLoaded', function() {
    migrateOldKey();
    fetchAllOwnedAssets(function() {});
  });

})();
