// ========================================
// Countdown Timer Module for The Last Gallery
// ========================================

(function() {
  "use strict";

  if (window.__countdownModuleInitialized) return;
  window.__countdownModuleInitialized = true;

  const $ = (id) => document.getElementById(id);

  let _tickInterval = null;
  let _targetTime = null;
  let _status = "cleared";

  function showBar() {
    const bar = $("countdownBar");
    if (!bar) return;
    bar.classList.remove("hidden");
    // Trigger header offset recalculation
    window.dispatchEvent(new Event("resize"));
  }

  function hideBar() {
    const bar = $("countdownBar");
    if (!bar) return;
    bar.classList.add("hidden");
    // Trigger header offset recalculation
    window.dispatchEvent(new Event("resize"));
  }

  function stopTicking() {
    if (_tickInterval) {
      clearInterval(_tickInterval);
      _tickInterval = null;
    }
  }

  function renderCountdown() {
    const textEl = $("countdownText");
    if (!textEl || !_targetTime) return;

    const now = Date.now();
    const diff = _targetTime - now;

    if (diff <= 0) {
      // Countdown finished — show "Shuffling..." with pulse
      stopTicking();
      textEl.className = "countdown-text shuffling";
      textEl.textContent = "Shuffling...";

      // After 3 seconds, re-fetch state (server auto-resets the cycle)
      setTimeout(fetchAndApply, 3000);
      return;
    }

    const totalMinutes = Math.floor(diff / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    // Build HTML with gold numbers and soft white units
    const parts = [];
    if (days > 0) {
      parts.push('<span class="countdown-number">' + days + '</span> <span class="countdown-unit">' + (days === 1 ? 'day' : 'days') + '</span>');
    }
    if (days > 0 || hours > 0) {
      parts.push('<span class="countdown-number">' + hours + '</span> <span class="countdown-unit">' + (hours === 1 ? 'hour' : 'hours') + '</span>');
    }
    parts.push('<span class="countdown-number">' + minutes + '</span> <span class="countdown-unit">' + (minutes === 1 ? 'minute' : 'minutes') + '</span>');

    textEl.className = "countdown-unit";
    textEl.innerHTML = parts.join(', ');
  }

  function startTicking(targetISO) {
    stopTicking();
    _targetTime = new Date(targetISO).getTime();
    renderCountdown();
    _tickInterval = setInterval(renderCountdown, 10000); // update every 10s (minutes resolution)
  }

  function applyState(data) {
    _status = data.status || "cleared";

    if (_status === "cleared") {
      stopTicking();
      hideBar();
      return;
    }

    if (_status === "scheduled") {
      stopTicking();
      const textEl = $("countdownText");
      if (textEl) {
        textEl.className = "countdown-unit";
        textEl.textContent = "Countdown begins soon";
      }
      showBar();

      // Check periodically if scheduled -> active transition happened
      setTimeout(fetchAndApply, 30000);
      return;
    }

    if (_status === "active" && data.target_time) {
      startTicking(data.target_time);
      showBar();
      return;
    }

    // Fallback: hide
    stopTicking();
    hideBar();
  }

  async function fetchAndApply() {
    try {
      const resp = await fetch("/api/countdown_state", { cache: "no-store" });
      if (resp.ok) {
        const data = await resp.json();
        applyState(data);
      }
    } catch (err) {
      console.warn("[countdown] Failed to fetch state:", err);
    }
  }

  // Public API for admin.js
  window.refreshCountdown = fetchAndApply;

  // Info modal
  function initInfoModal() {
    const infoBtn = $("countdownInfoBtn");
    const overlay = $("countdownInfoOverlay");
    const closeBtn = $("countdownInfoCloseBtn");

    function open() { if (overlay) overlay.classList.remove("hidden"); }
    function close() { if (overlay) overlay.classList.add("hidden"); }

    const unlockLink = $("countdownInfoUnlockLink");

    infoBtn?.addEventListener("click", open);
    closeBtn?.addEventListener("click", close);
    overlay?.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && overlay && !overlay.classList.contains("hidden")) close();
    });
    unlockLink?.addEventListener("click", (e) => {
      e.preventDefault();
      close();
      if (typeof window.openUnlockModal === "function") {
        window.openUnlockModal(null, null);
      }
    });
  }

  // Initialize on DOM ready
  function init() {
    fetchAndApply();
    initInfoModal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
