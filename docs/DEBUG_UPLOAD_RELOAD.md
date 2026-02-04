DEBUG GUIDE: Upload Page Reload Investigation
==============================================

ISSUE: Unexpected page reload occurs during/after upload, causing welcome banner to reappear

INSTRUMENTATION ADDED (TEMPORARY):
-----------------------------------
- Navigation listeners: beforeunload, pageshow, pagehide
- Form submit detection (capture phase)
- Button/link click logging
- Upload flow markers: [UPLOAD] and [META]

REPRODUCTION STEPS:
------------------
1. Open DevTools (F12)
2. Go to Console tab - clear it
3. Go to Network tab:
   - Check ✓ "Preserve log" checkbox (CRITICAL)
   - Clear network log
4. Perform upload:
   - Click "Add Artwork"
   - Select an image
   - Crop and click "Continue"
   - Fill in metadata in Tier-2 modal
   - Click "Save"
5. Watch for welcome banner reappearing (indicates reload)

EVIDENCE TO COLLECT:
--------------------

A) CONSOLE LOGS
---------------
Look for these markers in order:
- [CLICK] - What button was clicked
- [UPLOAD] upload complete reached
- [META] metadata save success reached
- [NAV] beforeunload fired - SMOKING GUN if present
- [FORM] submit fired - Would indicate accidental form submit
- [NAV] pageshow - Confirms reload happened

Copy the entire sequence with timestamps.

B) NETWORK TAB (with Preserve Log enabled)
------------------------------------------
1. Find the request with Type = "document"
   - This is the full page reload
   - Usually the LAST request in the log
   
2. Click on that document request

3. Check HEADERS tab:
   - Request URL: Should be http://127.0.0.1:5000/
   - Request Method: GET or POST?
   - Status Code: 200 or 302 redirect?

4. Check INITIATOR tab:
   - Shows what triggered the request
   - May show file + line number
   - May show "Other" or "Script" or "Navigation"

5. Copy/paste:
   - Request URL
   - Request Method
   - Status Code
   - Initiator info

C) STACK TRACES
---------------
If you see [NAV] stack or [FORM] submit stack:
- Expand the console.trace() output
- Copy the full stack trace
- This shows the exact call chain that triggered the event

COMMON CAUSES TO INVESTIGATE:
-----------------------------

1. Form Submit Without preventDefault
   - Look for [FORM] submit fired in console
   - Check if buttons have type="submit" but are inside a <form>
   - Check if form has no action (defaults to current page)

2. Explicit window.location Reload
   - Search upload_modal.js for:
     - window.location.reload()
     - window.location.href = 
     - location.reload()
   - Check if any exists in Tier-2 modal close/success handlers

3. Anchor Tag Click
   - Look for [CLICK] with tag: A and href: "#" or empty
   - Default anchor behavior navigates to href

4. Browser Back/Forward
   - Check [NAV] beforeunload stack trace
   - May show browser-initiated navigation

5. Fetch Redirect (302)
   - Check Network document request Status Code
   - If 302, server is redirecting
   - Check which endpoint returned 302

DIAGNOSIS TEMPLATE:
------------------
Copy this and fill in:

```
RELOAD CONFIRMED: [Yes/No]
TRIGGER: [Form submit / window.location / Anchor click / Browser nav / Other]

CONSOLE LOG SEQUENCE:
[Paste relevant [CLICK], [UPLOAD], [META], [NAV], [FORM] logs with timestamps]

NETWORK EVIDENCE:
Document Request URL: 
Request Method: 
Status Code: 
Initiator: 

STACK TRACE:
[Paste if [NAV] stack or [FORM] submit stack appeared]

HYPOTHESIS:
[What you think is causing the reload based on evidence]
```

AFTER DIAGNOSIS:
---------------
1. Remove TEMP DEBUG block from main.js (bottom of file)
2. Remove TEMP DEBUG markers from upload_modal.js
3. Implement fix based on diagnosis
4. Test without diagnostics

LIKELY FIXES (once diagnosed):
-----------------------------
- Add type="button" to buttons inside forms
- Add event.preventDefault() to form submit
- Remove window.location.reload() calls
- Add event.preventDefault() to anchor clicks
- Fix backend endpoint returning 302 instead of JSON
