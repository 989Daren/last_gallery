# Button CSS Consolidation Guide

## Problem

`static/css/styles.css` (5,815 lines) has 3 button styling patterns copy-pasted across 34 selectors. Each copy repeats 5-10 identical CSS properties. This guide consolidates them into shared base classes, eliminating ~120 redundant declarations without changing any visual appearance.

## Strategy

1. Define 3 base utility classes near the top of `styles.css` (after the `:root` block)
2. Add those classes to HTML elements and JS-created elements
3. Strip the now-redundant properties from each individual CSS selector, keeping only unique overrides (padding, border-radius, font-size, position, width, etc.)

**Key principle**: Base classes are defined early in the file with low specificity. Individual selectors later in the file naturally override them via higher specificity or source order, so unique overrides just work.

---

## Step 1: Add Base Classes to CSS

Insert this block in `static/css/styles.css` immediately after the `:root { ... }` closing brace (after line 46):

```css
/* ===== Shared Button Foundations ===== */
.btn-gold {
  background: linear-gradient(135deg, #b8860b, #ffd700);
  color: #111;
  font-weight: 700;
  border: none;
  cursor: pointer;
  transition: filter 0.2s;
}
.btn-gold:hover { filter: brightness(1.1); }

.btn-outline {
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}
.btn-outline:hover {
  border-color: rgba(255, 255, 255, 0.4);
  color: rgba(255, 255, 255, 0.85);
}

.btn-circle {
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 0.2s;
}
.btn-circle:hover { background: rgba(0, 0, 0, 0.9); }
```

---

## Step 2: Add Classes to HTML Elements

In `templates/index.html`, add the base class to each button's existing `class` attribute:

### Gold buttons — add `btn-gold`

| Line | Element ID | Current class attr | Change to |
|------|------------|-------------------|-----------|
| 196 | `uploadContinue` | *(none)* | `class="btn-gold"` |
| 293 | `metaContinueBtn` | `class="primary-btn"` | `class="primary-btn btn-gold"` |
| 309 | `confirmSaveBtn` | `class="primary-btn"` | `class="primary-btn btn-gold"` |
| 361 | `cotmProfileSaveBtn` | `class="primary-btn"` | `class="primary-btn btn-gold"` |
| 399 | `editBannerContinueBtn` | `class="edit-banner-continue"` | `class="edit-banner-continue btn-gold"` |
| 679 | `aboutExhibitsPricingBtn` | `class="about-exhibits-btn about-exhibits-btn-primary"` | `class="about-exhibits-btn about-exhibits-btn-primary btn-gold"` |
| 748 | `pricingUpgradeBtn` | `class="pricing-cta"` | `class="pricing-cta btn-gold"` |
| 797 | `cdSaveBtn` | `class="cd-save-btn"` | `class="cd-save-btn btn-gold"` |

### Outline buttons — add `btn-outline`

| Line | Element ID | Current class attr | Change to |
|------|------------|-------------------|-----------|
| 195 | `cancelUploadBtn` | *(none)* | `class="btn-outline"` |
| 292 | `metaSkipBtn` | `class="secondary-btn"` | `class="secondary-btn btn-outline"` |
| 308 | `confirmCancelBtn` | `class="secondary-btn"` | `class="secondary-btn btn-outline"` |
| 360 | `cotmProfileCancelBtn` | `class="secondary-btn"` | `class="secondary-btn btn-outline"` |
| 393 | `resendCodeBtn` | `class="resend-btn"` | `class="resend-btn btn-outline"` |
| 398 | `editBannerCancelBtn` | `class="edit-banner-cancel"` | `class="edit-banner-cancel btn-outline"` |
| 678 | `aboutExhibitsCloseFooterBtn` | `class="about-exhibits-btn about-exhibits-btn-secondary"` | `class="about-exhibits-btn about-exhibits-btn-secondary btn-outline"` |
| 796 | `cdCancelBtn` | `class="cd-cancel-btn"` | `class="cd-cancel-btn btn-outline"` |

---

## Step 3: Add Classes to JS-Created Elements

For elements created dynamically in JavaScript, add the base class to the `className` assignment or template literal.

### `static/js/main.js`

| Line | Element | How to add |
|------|---------|------------|
| 811 | `.popup-share-btn` | Change `class="popup-share-btn"` to `class="popup-share-btn btn-circle"` in template literal |
| 817 | `.popup-close-btn` | Change `class="popup-close-btn"` to `class="popup-close-btn btn-circle"` in template literal |
| 822 | `.ribbon-close-btn` | Change `class="ribbon-close-btn"` to `class="ribbon-close-btn btn-circle"` in template literal |
| 1064 | `.ribbon-upgrade-btn` | Change `actionBtn.className = "ribbon-upgrade-btn"` to `"ribbon-upgrade-btn btn-gold"` |
| 2055 | `.purchase-success-btn` | Change `class="purchase-success-btn"` to `class="purchase-success-btn btn-gold"` in innerHTML |

### `static/js/unlock_modal.js`

| Line | Element | How to add |
|------|---------|------------|
| 80 | `.unlock-modal-cta` (step 1) | Change `class="unlock-modal-cta"` to `class="unlock-modal-cta btn-gold"` in template |
| 95 | `.unlock-modal-cta` (step 2) | Change `class="unlock-modal-cta"` to `class="unlock-modal-cta btn-gold"` in template |
| 470 | `.unlock-tier-cta` | Change `class="unlock-tier-cta"` to `class="unlock-tier-cta btn-gold"` in template |

### `static/js/cotm.js`

| Line | Element | How to add |
|------|---------|------------|
| 299 | `.cotm-enter` | Change `class="cotm-enter"` to `class="cotm-enter btn-gold"` in template |
| 363 | `.cotm-share-btn` | Change `shareBtn.className = 'cotm-share-btn'` to `'cotm-share-btn btn-circle'` |
| 539 | `.cotm-edit-toggle-btn` | Change `class="cotm-edit-toggle-btn"` to `class="cotm-edit-toggle-btn btn-outline"` in template |
| 554 | `.cotm-edit-photo-btn` | Change `class="cotm-edit-photo-btn"` to `class="cotm-edit-photo-btn btn-outline"` in template |
| 604 | `.cotm-edit-save` | Change `class="cotm-edit-save"` to `class="cotm-edit-save btn-gold"` in template |
| 605 | `.cotm-edit-done` | Change `class="cotm-edit-done"` to `class="cotm-edit-done btn-outline"` in template |

### `static/js/exhibit.js`

| Line | Element | How to add |
|------|---------|------------|
| 203 | `.exhibit-intro-cancel` | Change `class="exhibit-intro-cancel"` to `class="exhibit-intro-cancel btn-outline"` in template |
| 204 | `.exhibit-intro-enter` | Change `class="exhibit-intro-enter"` to `class="exhibit-intro-enter btn-gold"` in template |
| 271 | `.exhibit-intro-share-btn` | Change `shareBtn.className = 'exhibit-intro-share-btn'` to `'exhibit-intro-share-btn btn-circle'` |

### `static/js/deadline_banner.js`

| Line | Element | How to add |
|------|---------|------------|
| 40 | `.deadline-banner-unlock` | Change `class="deadline-banner-unlock"` to `class="deadline-banner-unlock btn-gold"` in template |
| 41 | `.deadline-banner-dismiss` | Change `class="deadline-banner-dismiss"` to `class="deadline-banner-dismiss btn-outline"` in template |

### `static/js/exhibit_dashboard.js`

| Line | Element | How to add |
|------|---------|------------|
| 178 | `.exdash-save-profile` (profile) | Change `class="exdash-save-profile"` to `class="exdash-save-profile btn-gold"` in template |
| 192 | `.exdash-add-btn` | Change `class="exdash-add-btn"` to `class="exdash-add-btn btn-gold"` in template |
| 657 | `.exdash-save-profile` (meta) | Change `class="exdash-save-profile"` to `class="exdash-save-profile btn-gold"` in template |

---

## Step 4: Strip Redundant CSS Properties

For each selector below, remove the properties now provided by the base class. Keep only the unique overrides listed. If a selector becomes empty after stripping, delete the entire rule block. Also delete hover rules that are now identical to the base class hover.

### Gold buttons (`.btn-gold`)

Properties to REMOVE from each: `background: linear-gradient(...)`, `color: #111`, `font-weight: 700`, `border: none`, `cursor: pointer`, `transition: filter 0.2s`

| Selector (line) | Action | Keep these unique overrides |
|-----------------|--------|---------------------------|
| `.about-exhibits-btn-primary` (517) | Delete entire block + hover (522) | *(none, parent handles sizing)* |
| `.cd-save-btn` (735) | Delete entire block + hover (741) | *(none, parent handles sizing)* |
| `.modal-actions-tier2 .primary-btn` (1328) | Delete entire block + hover (1334) | *(none, parent handles sizing)* |
| `#metaModal .primary-btn` (1399) | Strip, keep: `padding: 10px 28px`, `border-radius: 8px`, `font-size: 0.9rem`. Delete hover (1410) | padding, border-radius, font-size |
| `.confirm-banner-actions .primary-btn` (1551) | Delete entire block + hover (1558) | *(none, parent handles sizing)* |
| `.edit-banner-continue` (1789) | Strip, keep: `padding: 10px 20px`, `font-size: 0.9rem`, `border-radius: 8px`. Delete hover (1801) | padding, font-size, border-radius |
| `.cotm-profile-actions .primary-btn` (2055) | Strip, keep: `padding: 10px 28px`, `border-radius: 8px`, `font-size: 0.9rem`. Delete hover (2066) | padding, border-radius, font-size |
| `#uploadModal #uploadContinue` (2246) | Strip, keep: `padding: 10px 28px`, `border-radius: 8px`, `font-size: 0.9rem`. Delete hover (2258) | padding, border-radius, font-size |
| `.ribbon-upgrade-btn` (1019) | Strip, keep: `color: #000`, `font-size: 0.8rem`, `letter-spacing: 0.05em`, `padding: 4px 14px`, `border-radius: 3px`, `pointer-events: auto`, `margin-left: 8px`. Keep hover (1034) because it uses `brightness(1.15)` not `1.1` | color, font-size, letter-spacing, padding, border-radius, pointer-events, margin-left |
| `.deadline-banner-unlock` (3575) | Strip, keep: `color: #000`, `padding: 10px 20px`, `font-size: 0.9rem`, `font-weight: 600`, `border-radius: 6px`. Delete hover (3587) | color, padding, font-size, font-weight, border-radius |
| `.unlock-modal-cta` (3727) | Strip, keep: `display: block`, `width: 100%`, `padding: 14px`, `font-size: 1rem`, `border-radius: 8px`, `transition: filter 0.2s, opacity 0.2s` (extended transition), `margin-bottom: 12px`. Delete hover (3742) | display, width, padding, font-size, border-radius, transition (replace with extended), margin-bottom |
| `.unlock-tier-cta` (4056) | Strip, keep: `display: block`, `width: 100%`, `padding: 10px`, `font-size: 0.9rem`, `border-radius: 6px`, `transition: filter 0.2s, opacity 0.2s` (extended transition), `margin-top: 4px`. Delete hover (4071) | display, width, padding, font-size, border-radius, transition (replace with extended), margin-top |
| `.purchase-success-btn` (4167) | Strip, keep: `display: inline-block`, `padding: 12px 28px`, `font-size: 0.95rem`, `border-radius: 8px`. Delete hover (4180) | display, padding, font-size, border-radius |
| `.pricing-cta` (4405) | Strip, keep: `display: block`, `margin-top: 12px`, `padding: 12px`, `font-size: 1rem`, `border-radius: 8px`. Delete hover (4420) | display, margin-top, padding, font-size, border-radius |
| `.exhibit-intro-enter` (4678) | Strip, keep: `flex: 1`, `padding: 12px`, `border-radius: 8px`, `font-size: 0.95rem`. Delete hover (4690) | flex, padding, border-radius, font-size |
| `.exdash-add-btn` (5230) | Strip, keep: `flex: 1`, `color: #000`, `border-radius: 6px`, `padding: 10px 0`, `font-size: 0.85rem`, `font-weight: 600` | flex, color, border-radius, padding, font-size, font-weight |
| `.exdash-save-profile` (5065) | Strip, keep: `color: #000`, `border-radius: 6px`, `padding: 9px 20px`, `font-size: 0.85rem`, `font-weight: 600`, `width: 100%` | color, border-radius, padding, font-size, font-weight, width |
| `.cotm-edit-save` (5765) | Strip, keep: `padding: 9px 22px`, `border-radius: 8px`, `font-size: 0.9rem`. Delete hover (5776) | padding, border-radius, font-size |
| `.cotm-enter` (line of `.cotm-enter` rule) | Strip, keep: `padding: 10px 28px`, `border-radius: 8px`, `font-size: 0.95rem`. Delete hover | padding, border-radius, font-size |

### Outline buttons (`.btn-outline`)

Properties to REMOVE from each: `border: 1px solid rgba(255, 255, 255, 0.2)`, `background: transparent`, `color: rgba(255, 255, 255, 0.6)`, `cursor: pointer`, `transition: border-color 0.2s, color 0.2s`

| Selector (line) | Action | Keep these unique overrides |
|-----------------|--------|---------------------------|
| `.about-exhibits-btn-secondary` (525) | Delete entire block + hover (530) | *(none, parent handles sizing)* |
| `.cd-cancel-btn` (724) | Delete entire block + hover (730) | *(none, parent handles sizing)* |
| `.modal-actions-tier2 .secondary-btn` (1317) | Delete entire block + hover (1323) | *(none, parent handles sizing)* |
| `#metaModal .secondary-btn` (1415) | Strip, keep: `padding: 10px 24px`, `border-radius: 8px`, `font-size: 0.9rem`. Delete hover (1425) | padding, border-radius, font-size |
| `.confirm-banner-actions .secondary-btn` (1539) | Delete entire block + hover (1546) | *(none, parent handles sizing)* |
| `.edit-banner-cancel` (1772) | Strip, keep: `padding: 10px 20px`, `font-size: 0.9rem`, `border-radius: 8px`, `font-weight: 500`. Delete hover (1784) | padding, font-size, border-radius, font-weight |
| `.resend-btn` (1805) | Strip, keep: `padding: 8px 16px`, `font-size: 0.85rem`, `border-radius: 6px`, `font-weight: 500`, `white-space: nowrap`. Delete hover (1818) | padding, font-size, border-radius, font-weight, white-space |
| `.cotm-profile-actions .secondary-btn` (2041) | Strip, keep: `padding: 10px 24px`, `border-radius: 8px`, `font-size: 0.9rem`. Delete hover (2051) | padding, border-radius, font-size |
| `#uploadModal #cancelUploadBtn` (2230) | Strip, keep: `padding: 10px 24px`, `border-radius: 8px`, `font-size: 0.9rem`. Delete hover (2241) | padding, border-radius, font-size |
| `.deadline-banner-dismiss` (3591) | Strip, keep: `padding: 10px 20px`, `font-size: 0.9rem`, `font-weight: 500`, `border-radius: 8px`. Delete hover (3603) | padding, font-size, font-weight, border-radius |
| `.exhibit-intro-cancel` (4661) | Strip, keep: `flex: 1`, `padding: 12px`, `border-radius: 8px`, `font-size: 0.95rem`, `font-weight: 500`. Delete hover (4673) | flex, padding, border-radius, font-size, font-weight |
| `.cotm-edit-done` (5783) | Strip, keep: `padding: 9px 22px`, `border-radius: 8px`, `font-size: 0.9rem`, `font-weight: 500`. Delete hover (5794) | padding, border-radius, font-size, font-weight |
| `.cotm-edit-photo-btn` (5700) | Strip, keep: `padding: 6px 14px`, `border-radius: 6px`, `font-size: 0.82rem`. Keep hover (5710) — uses custom gold colors | padding, border-radius, font-size |
| `.cotm-edit-toggle-btn` (5745) | Strip, keep: `padding: 4px 10px`, `border-radius: 6px`, `font-size: 0.75rem`, `flex-shrink: 0`. Keep hover (5756) — uses custom gold colors | padding, border-radius, font-size, flex-shrink |

### Circular buttons (`.btn-circle`)

Properties to REMOVE from each: `border: none`, `border-radius: 50%`, `background: rgba(0, 0, 0, 0.7)`, `color: white`, `cursor: pointer`, `display: flex`, `align-items: center`, `justify-content: center`, `padding: 0`, `transition: background 0.2s`

| Selector (line) | Action | Keep these unique overrides |
|-----------------|--------|---------------------------|
| `.popup-share-btn` (2913) | Strip, keep: `position`, `top`, `right`, `width: 29px`, `height: 29px`, `transition: background 0.2s, opacity 0.3s` (extended), `z-index`, `opacity`, `pointer-events`. Delete hover (2940) | position, top, right, width, height, transition (extended), z-index, opacity, pointer-events |
| `.popup-close-btn` (2950) | Strip, keep: `position`, `top`, `right`, `width: 29px`, `height: 29px`, `font-size: 22px`, `line-height: 1`, `transition: background 0.2s, opacity 0.3s` (extended), `z-index`, `opacity`, `pointer-events`. Delete hover (2979) | position, top, right, width, height, font-size, line-height, transition (extended), z-index, opacity, pointer-events |
| `.ribbon-close-btn` (3006) | Strip, keep: `position`, `top`, `right`, `width: 28px`, `height: 28px`, `font-size: 20px`, `line-height: 1`, `transition: background 0.2s, opacity 0.2s` (extended), `z-index`, `opacity`, `pointer-events`. Delete hover (3035) | position, top, right, width, height, font-size, line-height, transition (extended), z-index, opacity, pointer-events |
| `.exhibit-intro-share-btn` (4641) | Strip, keep: `position: absolute`, `width: 27px`, `height: 27px`, `z-index: 2`. Delete hover (4657) | position, width, height, z-index |
| `.cotm-share-btn` (5577) | Strip, keep: `position: absolute`, `width: 27px`, `height: 27px`, `z-index: 2`. Delete hover (5593) | position, width, height, z-index |

---

## Step 5: Slim Parent/Container Rules

These parent rules set shared sizing for child buttons. Remove properties now covered by the base classes (typically `cursor`, `border`, `transition`). Keep sizing properties (`padding`, `border-radius`, `font-size`, `font-weight`).

| Parent rule (line) | Remove | Keep |
|--------------------|--------|------|
| `.about-exhibits-btn` (509) | `cursor: pointer`, `transition: filter 0.2s, border-color 0.2s, color 0.2s` | `padding`, `border-radius`, `font-size`, `font-weight` |
| `.countdownModalCard .cd-actions button` (714) | `border: none`, `cursor: pointer`, `transition: filter 0.2s, border-color 0.2s, color 0.2s` | `padding`, `border-radius`, `font-size`, `font-weight` |
| `.modal-actions-tier2 button` (1307) | `border: none`, `cursor: pointer`, `transition: filter 0.2s, border-color 0.2s, color 0.2s` | `padding`, `font-size`, `border-radius`, `font-weight` |
| `.confirm-banner-actions button` (1530) | `border: none`, `cursor: pointer` | `padding`, `font-size`, `border-radius`, `font-weight` |

---

## What NOT to Change

These selectors look similar but have meaningful differences — leave them alone:

| Selector | Why it's excluded |
|----------|-------------------|
| `.success-banner-dismiss` | Different hover — adds `background`, changes color to `0.95` opacity |
| `.unlock-modal-resend-btn` | Gold border (`#D4A843`), gold text, custom hover |
| `.exdash-done-btn` | Different border opacity (`0.25`), different color (`0.7`), different hover |
| `.exdash-photo-btn` | Gold-tinted with `#444` border, gold text |
| `.ribbon-edit-btn`, `.cotm-edit-btn`, `.exhibit-intro-edit-btn` | Gold-bordered edit pill buttons — distinct pattern |
| `.countdown-info-btn` | Unique gold info circle with serif font |
| `.ribbon-upgrade-btn:hover` | Uses `brightness(1.15)` not `1.1` — keep custom hover |
| `.cotm-edit-photo-btn:hover`, `.cotm-edit-toggle-btn:hover` | Uses gold colors (`#D4A843`) — keep custom hover |
| Admin buttons | Unstyled, no pattern to consolidate |

---

## Verification Checklist

After making all changes, run `python3 app.py` and check every button type in the browser:

- [ ] Upload flow: Cancel, Continue (disabled + enabled states)
- [ ] Metadata modal: Skip (Return to Artwork Edit), Continue
- [ ] Confirm banner: Cancel, Save
- [ ] Edit banner: Cancel, Continue, Resend
- [ ] COTM profile overlay: Cancel, Save & Enter (disabled + enabled states)
- [ ] COTM edit form: Photo button, toggle buttons, Save (disabled + enabled), Done
- [ ] Art popup: Share circle, Close circle, Ribbon close circle
- [ ] Ribbon: Upgrade button, Edit pill (should be unchanged)
- [ ] Unlock modal: Continue (step 1 + 2), tier Purchase buttons (disabled + enabled)
- [ ] Deadline banner: Unlock Now, OK I understand
- [ ] Exhibit intro: Cancel, Enter Exhibit, Share circle
- [ ] Exhibit dashboard: Add button, Save Profile, Save Details
- [ ] Info popups: Pricing button (Upgrade Now), About Exhibits close
- [ ] Purchase success: View My Artwork
- [ ] Hover states on every button above
- [ ] Disabled states: upload continue, COTM save, unlock CTAs, exdash add

## Estimated Impact

- ~120 property declarations removed across 34 selectors
- ~30 lines added for 3 base classes + hovers
- Net reduction: ~90 lines
- Zero visual change
