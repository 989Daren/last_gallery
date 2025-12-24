# Phase 2 Verification Guide

## Quick Test Checklist

### 1. Initial Page Load ✓
**What to check:**
- Open http://127.0.0.1:5000
- Wall should render with all tiles
- Console should show: `[RENDER] renderWallFromState`
- Console should show: `[RENDER] boot state-driven hydration completed`
- No JavaScript errors

**Expected canary output:**
```
wallState hydrated: 60 tiles (or whatever count)
[RENDER] renderWallFromState
[RENDER] boot state-driven hydration completed
```

---

### 2. Admin Login
**Steps:**
1. Click "Admin" button
2. Enter PIN: `8375`
3. Click "Unlock"

**Expected:** Admin panel opens, no errors

---

### 3. Clear One Tile
**Steps:**
1. Find a tile with artwork (note the tile ID, e.g., "S5")
2. Enter tile ID in "Clear Tile" field
3. Click "Clear Tile"
4. Confirm the deletion

**Expected canary output:**
```
State snapshot captured, history depth: 1
Refreshed wall state, assignments: [remaining count]
[RENDER] renderWallFromState
[RENDER] refreshWallFromServer completed
⚠️ IMAGE SHIFT DETECTED ... (should NOT appear)
```

**Visual check:**
- [ ] Tile clears immediately
- [ ] No image shift
- [ ] Wall color/spotlights remain intact
- [ ] Admin labels remain visible (if toggle ON)

---

### 4. Clear All Tiles
**Steps:**
1. Click "Clear All Tiles"
2. Confirm

**Expected canary output:**
```
State snapshot captured, history depth: 2
Refreshed wall state, assignments: 0
[RENDER] renderWallFromState
[RENDER] refreshWallFromServer completed
```

**Visual check:**
- [ ] All tiles clear instantly
- [ ] Grid remains visible
- [ ] Wall lighting intact
- [ ] No shift warnings

---

### 5. Move Tile
**Steps:**
1. Upload artwork to two tiles (use upload modal)
2. Note source tile ID (e.g., "S1")
3. Note destination tile ID (e.g., "S2")
4. Clear destination tile
5. Enter "From: S1" and "To: S2"
6. Click "Move"
7. Confirm

**Expected canary output:**
```
State snapshot captured, history depth: 3
Refreshed wall state, assignments: [count]
[RENDER] renderWallFromState
[RENDER] refreshWallFromServer completed
```

**Visual check:**
- [ ] Artwork moves from S1 to S2
- [ ] S1 becomes empty
- [ ] S2 shows artwork with no shift
- [ ] No canary warnings

---

### 6. Shuffle
**Steps:**
1. Ensure at least 3 artworks are placed
2. Click "Shuffle" in admin panel
3. Confirm

**Expected canary output:**
```
State snapshot captured, history depth: 4
Refreshed wall state, assignments: [count]
[RENDER] renderWallFromState
[RENDER] refreshWallFromServer completed
[RENDER] shuffle completed
```

**Visual check:**
- [ ] All artworks move to new random tiles
- [ ] No shift
- [ ] No overlapping
- [ ] Wall lighting intact

---

### 7. Undo (Server-Side Currently)
**Steps:**
1. Click "Undo" button
2. Confirm

**Expected canary output:**
```
Refreshed wall state, assignments: [restored count]
[RENDER] renderWallFromState
[RENDER] refreshWallFromServer completed
```

**Visual check:**
- [ ] Previous state restored
- [ ] **THIS IS THE CRITICAL TEST:** No image shift
- [ ] Artwork appears in original positions
- [ ] No shift warnings from canary

**Hypothesis:** Image shift should be GONE because `renderWallFromState()` does full rebuild.

---

### 8. Refresh Page
**Steps:**
1. Perform any admin operation (clear, move, etc.)
2. Press F5 to refresh browser
3. Compare before/after

**Visual check:**
- [ ] Appearance identical before and after refresh
- [ ] No layout changes
- [ ] No position shifts
- [ ] Server state matches visual state

---

## Success Criteria

### Phase 2 Complete If:
1. ✅ No JavaScript console errors on load
2. ✅ All admin operations work
3. ✅ No `⚠️ IMAGE SHIFT DETECTED` warnings
4. ✅ Undo restores state without shift
5. ✅ Visuals identical to Phase 1
6. ✅ Wall lighting (color + spotlights) intact
7. ✅ Admin overlays refresh correctly

### Known Acceptable Warnings:
- "wallState hydrated..." (informational)
- "[RENDER] ..." (Phase 1 instrumentation)

### NOT Acceptable:
- "⚠️ IMAGE SHIFT DETECTED" after any operation
- JavaScript errors
- Missing tiles
- Broken wall lighting
- Missing admin overlays

---

## Debugging Tips

### If Canary Fires (Image Shift Detected):
1. Note which operation triggered it (logged in console)
2. Check if state was updated before render
3. Verify `renderWallFromState()` ran
4. Inspect `wallState.tiles` in console: `console.log(wallState)`
5. Check if DOM was partially mutated outside render pipeline

### If Page Doesn't Load:
1. Open browser DevTools (F12)
2. Check Console tab for errors
3. Common issues:
   - Syntax error in main.js
   - Missing function reference
   - JSON parse error in state hydration

### If Admin Operations Fail:
1. Check Network tab (F12) for failed API calls
2. Check Flask terminal for Python errors
3. Verify ADMIN_PIN in main.js matches app.py

---

## Performance Check

Open Chrome DevTools → Performance tab:
1. Record a shuffle operation
2. Check "renderWallFromState" duration
3. Should be < 20ms for 60 tiles

If > 50ms:
- Profile individual operations
- Check if DOM operations are batched
- Verify no unnecessary reflows

---

## Clean Up Test (Post-Verification)

Once all tests pass, verify legacy functions are unused:

```javascript
// Search main.js for calls to these functions:
renderTiles()       // Should NOT be called except during boot
applyAssetToTile()  // Should NOT be called except in renderWallFromState inline
resetTileToEmpty()  // Should NOT be called anywhere
```

Use VS Code search:
- `Ctrl+F`: Search for function names
- Check if any calls outside expected locations
- If none found, safe to comment out function definitions

---

## Final Verification

Run all 8 tests above, then:

**Stress Test:**
1. Rapid-fire operations: Clear All → Undo → Shuffle → Undo → Move → Undo
2. No shift should occur at any step
3. State should remain consistent

**If all pass:** Phase 2 is production-ready ✅

**If any fail:** Review [phase2_state_architecture_summary.md](phase2_state_architecture_summary.md) and debug specific step.

---

**End of Verification Guide**
