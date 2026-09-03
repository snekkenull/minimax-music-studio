/* theme.js — dark / light / auto toggle for Music Studio.
 *
 * Three modes:
 *   - "dark"  → force dark; <html data-theme="dark">
 *   - "light" → force light; <html data-theme="light">
 *   - "auto"  → follow prefers-color-scheme; resolved to "dark"/"light"
 *               and applied to data-theme, then re-resolved if the user
 *               flips their OS setting.
 *
 * Persists to localStorage under "minimax_theme" (single key). The init
 * block below runs at parse-time, before <body> paints, by being loaded
 * with no `defer` and placed in <head>. The visible toggle button (with
 * `.theme-toggle` class) is wired here so pages don't need their own
 * glue.
 *
 * The button is optional — if no element with class="theme-toggle" is
 * present (e.g. on a test page), the toggle is silently skipped. The
 * theme is still applied to <html>.
 */
(function () {
  'use strict';
  const LS_KEY = 'minimax_theme';
  const root = document.documentElement;
  const VALID = ['dark', 'light', 'auto'];

  function readStored() {
    try {
      const v = localStorage.getItem(LS_KEY);
      if (VALID.includes(v)) return v;
    } catch (e) { /* localStorage may be blocked in private mode */ }
    return 'auto'; // Phase 29: first-visit follows prefers-color-scheme.
  }

  function resolveAuto() {
    return window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light' : 'dark';
  }

  function apply(mode) {
    const resolved = mode === 'auto' ? resolveAuto() : mode;
    root.setAttribute('data-theme', resolved);
    root.dataset.themeMode = mode; // "what the user picked" (dark/light/auto)
    // Mark body class too so any page-level styles can hook it
    if (document.body) document.body.dataset.theme = resolved;
    // Re-paint toggle aria/label if present
    const btn = document.querySelector('.theme-toggle');
    if (btn) {
      const label = mode === 'auto'
        ? `Theme: auto (${resolved})`
        : `Theme: ${mode}`;
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
      btn.dataset.mode = mode;
      btn.dataset.resolved = resolved;
    }
  }

  function cycle() {
    const current = readStored();
    const i = VALID.indexOf(current);
    const next = VALID[(i + 1) % VALID.length];
    try { localStorage.setItem(LS_KEY, next); } catch (e) {}
    apply(next);
  }

  // Expose for tests / dev tools
  window.MusicStudioTheme = { apply, cycle, readStored, VALID };

  // 1. Initial paint — set data-theme synchronously so the first frame
  //    already has the right colors (avoids dark→light flash).
  apply(readStored());

  // 2. Wire the toggle button (any element with .theme-toggle class).
  //    We delegate via capture so this works even if the button is added
  //    after the script runs.
  function wireButton() {
    const btn = document.querySelector('.theme-toggle');
    if (!btn || btn.dataset.themeWired === '1') return;
    btn.dataset.themeWired = '1';
    btn.addEventListener('click', cycle);
    // Re-apply with the current stored mode so the button's aria-label
    // reflects the actual state (the initial apply() ran before the
    // button existed in the DOM, so its label is still the static HTML
    // default).
    apply(readStored());
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireButton, { once: true });
  } else {
    wireButton();
  }

  // 3. Live follow OS preference when mode=auto.
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { if (readStored() === 'auto') apply('auto'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange); // Safari < 14
  }
})();
