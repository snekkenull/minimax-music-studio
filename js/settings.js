/* ===========================================================
 * settings.js · Phase 7
 * ------------------------------------------------------------
 * Settings page controller — 5 fields, hydrate from core.persist,
 * save on submit, reset to defaults, route-aware (auto-redirected
 * here from main page when API key missing).
 *
 * Shares the same zero-build IIFE namespace pattern as the other
 * modules. No DOM-side state machine — pure form binding.
 * =========================================================== */
(function (root) {
  'use strict';
  if (!root.MusicStudio) { console.error('[settings] core.js must load first'); return; }
  if (!root.MusicStudio.persist) { console.error('[settings] core.persist missing'); return; }

  const NS = root.MusicStudio;
  const persist = NS.persist;
  const D = NS.defaults;

  // ── DOM refs (resolved on init) ─────────────────────
  const $ = (id) => document.getElementById(id);
  let form, apiKeyInput, musicModelSel, musicApiUrlInput, llmModelSel, llmApiUrlInput;
  let revealBtn, keyStatus, resetBtn, toastEl;
  let actionsEl, dirtyDot, testAllBtn, musicProbe, llmProbe;
  // Phase 10 (P10-1): custom model combo
  let customMusicModelInput, customLlmModelInput, customMusicModelRow, customLlmModelRow;
  const CUSTOM_SENTINEL = '__custom__';

  // ── Toast helper (3-state: ok / err / info) ─────────
  let toastTimer = null;
  function toast(msg, kind = 'info', ms = 2400) {
    if (!toastEl) return;
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.className = 'show ' + kind;
    toastTimer = setTimeout(() => { toastEl.className = ''; }, ms);
  }

  // ── Hydrate form from persist ────────────────────────
  function hydrate() { hydrateForm(); updateKeyStatus(); snapshot(); updateDirty(); }
  function hydrateForm() {
    apiKeyInput.value = root.state.apiKey || '';
    setSelOrCustom(musicModelSel, customMusicModelInput, customMusicModelRow, persist.getCustomMusicModel(), persist.getMusicModel());
    setSelOrCustom(llmModelSel, customLlmModelInput, customLlmModelRow, persist.getCustomLlmModel(), persist.getLlmModel());
    musicApiUrlInput.value = persist.getMusicApiUrl();
    llmApiUrlInput.value  = persist.getLlmApiUrl();
  }
  // Phase 10 (P10-1): when a custom value exists, the dropdown shows the
  // "__custom__" sentinel and the custom row is revealed. Otherwise the
  // dropdown shows the default model id and the row is hidden.
  function setSelOrCustom(sel, customInput, customRow, customVal, defaultVal) {
    if (customVal) {
      sel.value = CUSTOM_SENTINEL;
      customInput.value = customVal;
      customRow.hidden = false;
    } else {
      sel.value = defaultVal;
      customInput.value = '';
      customRow.hidden = true;
    }
  }

  function updateKeyStatus() {
    const has = (root.state.apiKey || '').trim().length > 0;
    keyStatus.classList.remove('ok', 'warn');
    const i18n = window.MusicStudioI18n;
    if (has) {
      const masked = root.state.apiKey.slice(0, 4) + '…' + root.state.apiKey.slice(-4);
      keyStatus.classList.add('ok');
      const okLabel = i18n ? i18n.t('settings.status.configured') : '已配置';
      keyStatus.querySelector('.t').textContent = okLabel + ' · ' + masked;
    } else {
      keyStatus.classList.add('warn');
      const noLabel = i18n ? i18n.t('settings.status.unconfigured') : '未配置';
      keyStatus.querySelector('.t').textContent = noLabel;
    }
  }

  // ── Save handler ─────────────────────────────────────
  // Phase 7 P1: URL sanity — must look like http(s)://… or a same-origin /path.
  // Empty is allowed (will fall back to default on the next read).
  function isValidEndpoint(s) {
    if (!s) return true;
    if (s.startsWith('/')) return true;
    return /^https?:\/\/.+/i.test(s);
  }

  // P1.1: clear any prior error marks before revalidating
  function clearUrlErrors() {
    [musicApiUrlInput, llmApiUrlInput].forEach((el) => {
      if (!el) return;
      el.classList.remove('invalid');
      const next = el.parentElement?.querySelector('.err-tip');
      if (next) next.remove();
    });
  }

  function markInvalid(el, msg) {
    el.classList.add('invalid');
    el.setAttribute('aria-invalid', 'true');
    const tip = document.createElement('div');
    tip.className = 'err-tip';
    tip.setAttribute('role', 'alert');
    tip.textContent = msg;
    el.insertAdjacentElement('afterend', tip);
  }

  function onSubmit(e) {
    e.preventDefault();
    clearUrlErrors();

    const musicUrl = musicApiUrlInput.value.trim();
    const llmUrl   = llmApiUrlInput.value.trim();
    let bad = null;
    if (!isValidEndpoint(musicUrl)) bad = [musicApiUrlInput, '音乐 API URL 需以 http(s):// 或 / 开头'];
    else if (!isValidEndpoint(llmUrl)) bad = [llmApiUrlInput, 'LLM API URL 需以 http(s):// 或 / 开头'];

    if (bad) {
      const [el, msg] = bad;
      markInvalid(el, msg);
      el.focus();
      toast(msg, 'err', 3200);
      return;
    }

    const newKey = apiKeyInput.value.trim();
    persist.setApiKey(newKey);
    persist.setMusicModel(musicModelSel.value);
    persist.setMusicApiUrl(musicUrl);
    persist.setLlmModel(llmModelSel.value);
    // Phase 10 (P10-1): when sentinel is chosen, the dropdown value is
    // cosmetic — the real model id lives in the custom input. The getter
    // prioritises non-empty custom over the dropdown, so this is enough.
    persist.setCustomMusicModel(
      musicModelSel.value === CUSTOM_SENTINEL ? customMusicModelInput.value.trim() : ''
    );
    persist.setCustomLlmModel(
      llmModelSel.value === CUSTOM_SENTINEL ? customLlmModelInput.value.trim() : ''
    );
    persist.setLlmApiUrl(llmUrl);

    // Sync the in-memory state (some modules read state.apiKey directly)
    root.state.apiKey = newKey;

    updateKeyStatus();
    snapshot();
    updateDirty();
    pulseSave();
    toast(window.MusicStudioI18n ? window.MusicStudioI18n.t('toast.saved') : '设置已保存', 'ok');

    // Phase 7: if a #settings route flag was set (came from main page via
    // "未配置 API key" toast), bounce back to studio after a short delay so
    // user can see the saved confirmation.
    if (sessionStorage.getItem('settings_return_to') === 'studio') {
      sessionStorage.removeItem('settings_return_to');
      setTimeout(() => { location.href = 'music-generator.html'; }, 700);
    }
  }

  // ── Reset all to defaults ────────────────────────────
  function onReset() {
    const i18n = window.MusicStudioI18n;
    const confirmMsg = i18n
      ? i18n.t('settings.confirmReset')
      : '确定要重置所有设置为默认值吗?\n(API Key 也会被清空,需重新输入)';
    if (!confirm(confirmMsg)) return;
    persist.setApiKey('');
    persist.setMusicModel(D.musicModel);
    persist.setMusicApiUrl(D.musicApiUrl);
    persist.setLlmModel(D.llmModel);
    // Phase 10 (P10-1): reset also clears any custom model value.
    persist.setCustomMusicModel('');
    persist.setCustomLlmModel('');
    persist.setLlmApiUrl(D.llmApiUrl);
    root.state.apiKey = '';
    hydrate();
    toast(i18n ? i18n.t('toast.reset') : '已重置为默认值', 'ok');
  }

  // ── Reveal/hide API key ──────────────────────────────
  function onReveal() {
    const isPwd = apiKeyInput.type === 'password';
    apiKeyInput.type = isPwd ? 'text' : 'password';
    const i18n = window.MusicStudioI18n;
    revealBtn.textContent = isPwd
      ? (i18n ? i18n.t('settings.input.hide') : '隐藏')
      : (i18n ? i18n.t('settings.input.reveal') : '显示');
  }

  // ── Phase 7 P1: save / reset pulse ───────────────────
  // Briefly stamp the primary action with a checkmark, then return to label.
  // Uses CSS class .pulse + .saved on the existing button, no extra DOM.
  function pulseSave() {
    const saveBtn = document.getElementById('saveBtn');
    if (!saveBtn) return;
    const original = saveBtn.textContent;
    saveBtn.classList.add('pulse', 'saved');
    saveBtn.textContent = '✓ 已保存';
    setTimeout(() => {
      saveBtn.classList.remove('pulse', 'saved');
      saveBtn.textContent = original;
    }, 1100);
  }

  // ── Init ─────────────────────────────────────────────
  function init() {
    form             = $('settingsForm');
    apiKeyInput      = $('apiKey');
    musicModelSel    = $('musicModel');
    musicApiUrlInput = $('musicApiUrl');
    llmModelSel      = $('llmModel');
    llmApiUrlInput   = $('llmApiUrl');
    // Phase 10 (P10-1): custom model combo refs
    customMusicModelInput = $('customMusicModel');
    customLlmModelInput   = $('customLlmModel');
    customMusicModelRow   = $('customMusicModelRow');
    customLlmModelRow     = $('customLlmModelRow');
    revealBtn        = $('revealKey');
    keyStatus        = $('keyStatus');
    resetBtn         = $('resetBtn');
    // Phase 7 P5: language toggle — cycle zh ↔ en, re-apply, persist.
    const langBtn = $('langToggle');
    if (langBtn) {
      langBtn.addEventListener('click', () => {
        if (window.MusicStudioI18n) window.MusicStudioI18n.cycle();
      });
    }
    toastEl          = $('toast');
    actionsEl        = $('formActions');
    dirtyDot         = $('dirtyDot');
    testAllBtn       = $('testAllBtn');
    musicProbe       = $('musicApiUrlProbe');
    llmProbe         = $('llmApiUrlProbe');

    if (!form) { console.error('[settings] form not found'); return; }

    hydrate();
    form.addEventListener('submit', onSubmit);
    resetBtn.addEventListener('click', onReset);
    revealBtn.addEventListener('click', onReveal);
    testAllBtn.addEventListener('click', onTestAll);
    // Phase 7 P6: if URL contains ?import=<base64>, decode + confirm + apply
    // + clear the parameter. Must run AFTER hydrate so the imported values
    // actually win (otherwise hydrate would overwrite them on the next tick).
    tryImportFromUrl();
    // Phase 7 P5: on language change, re-render status text + probe text
    // so the dynamic UI matches the new dictionary.
    document.addEventListener('i18n:change', () => {
      updateKeyStatus();
      // Reveal button label: depends on current apiKeyInput.type.
      const i18n = window.MusicStudioI18n;
      if (revealBtn) {
        revealBtn.textContent = apiKeyInput.type === 'password'
          ? (i18n ? i18n.t('settings.input.reveal') : '显示')
          : (i18n ? i18n.t('settings.input.hide') : '隐藏');
      }
      // Re-paint any active probe with the right idle text.
      if (musicProbe && musicProbe.dataset.state === 'idle') {
        musicProbe.querySelector('.probe-text').textContent = i18n ? i18n.t('settings.status.idle') : '未测试';
      }
      if (llmProbe && llmProbe.dataset.state === 'idle') {
        llmProbe.querySelector('.probe-text').textContent = i18n ? i18n.t('settings.status.idle') : '未测试';
      }
    });

    // Live update of status pill while typing in key field
    apiKeyInput.addEventListener('input', () => {
      root.state.apiKey = apiKeyInput.value;  // ephemeral preview
      updateKeyStatus();
      updateDirty();
      // Re-probe the music endpoint: probe state is only meaningful with
      // the same key that submit will use. Without this, the probe
      // forever shows the result from when the page first loaded
      // (possibly before the key was pasted).
      scheduleProbe('music');
    });

    // Phase 7 P2: dirty state + live probe on every persisted field
    [musicModelSel, musicApiUrlInput, llmModelSel, llmApiUrlInput].forEach((el) => {
      el.addEventListener('input', updateDirty);
      el.addEventListener('change', updateDirty);
    });
    // Phase 10 (P10-1): custom-model combo wiring — switching the dropdown
    // to "__custom__" reveals the row; switching away hides it (without
    // clearing the typed value, so the user can toggle back without losing
    // their typing — submit clears custom only when sentinel is unselected).
    musicModelSel.addEventListener('change', () => {
      if (musicModelSel.value === CUSTOM_SENTINEL) {
        customMusicModelRow.hidden = false;
        customMusicModelInput.focus();
      } else {
        customMusicModelRow.hidden = true;
      }
      updateDirty();
    });
    llmModelSel.addEventListener('change', () => {
      if (llmModelSel.value === CUSTOM_SENTINEL) {
        customLlmModelRow.hidden = false;
        customLlmModelInput.focus();
      } else {
        customLlmModelRow.hidden = true;
      }
      updateDirty();
    });
    [customMusicModelInput, customLlmModelInput].forEach((el) => {
      el.addEventListener('input', updateDirty);
    });
    musicApiUrlInput.addEventListener('input', () => scheduleProbe('music'));
    llmApiUrlInput.addEventListener('input',   () => scheduleProbe('llm'));

    // Initial probe of the persisted URLs (so user lands on a known signal,
    // not "untested")
    probeNow('music');
    probeNow('llm');

    console.log('[MusicStudio] settings loaded');
  }

  // ── Phase 7 P2: dirty state + live reachability probe ─
  // dirty = any field differs from its persisted value. The dot lives in
  // .actions so the user sees "you have unsaved changes" at the bottom.
  let musicSnapshot, llmSnapshot, apiKeySnapshot, musicModelSnapshot, llmModelSnapshot;
  let customMusicSnapshot, customLlmSnapshot;
  function snapshot() {
    musicSnapshot        = persist.getMusicApiUrl();
    llmSnapshot          = persist.getLlmApiUrl();
    apiKeySnapshot       = root.state.apiKey || '';
    // Phase 10 (P10-1): snapshot the EFFECTIVE model (custom > dropdown) so
    // the dirty check matches what the user actually sees.
    musicModelSnapshot   = persist.getMusicModel();
    llmModelSnapshot     = persist.getLlmModel();
    customMusicSnapshot  = persist.getCustomMusicModel();
    customLlmSnapshot    = persist.getCustomLlmModel();
  }
  function isDirty() {
    // Phase 10 (P10-1): dirty if the effective model or either custom input
    // differs from its snapshot. The dropdown's literal value is allowed to
    // toggle between "__custom__" and a real id without being dirty, as long
    // as the effective model resolves to the same string.
    const effectiveMusic = musicModelSel.value === CUSTOM_SENTINEL
      ? customMusicModelInput.value.trim()
      : musicModelSel.value;
    const effectiveLlm = llmModelSel.value === CUSTOM_SENTINEL
      ? customLlmModelInput.value.trim()
      : llmModelSel.value;
    return apiKeyInput.value.trim()    !== apiKeySnapshot
        || musicApiUrlInput.value.trim() !== musicSnapshot
        || llmApiUrlInput.value.trim()   !== llmSnapshot
        || effectiveMusic                !== musicModelSnapshot
        || effectiveLlm                  !== llmModelSnapshot;
  }
  function updateDirty() {
    const d = isDirty();
    actionsEl.classList.toggle('dirty', d);
  }

  // Reachability probe — same-origin gets a real status code, cross-origin
  // gets an opaque no-cors response (success = reachable, error = unreachable).
  // Anything that throws (DNS, CORS, abort) is unreachable.
  function paintProbe(slot, state, text) {
    slot.dataset.state = state;
    slot.querySelector('.probe-text').textContent = text;
  }
  async function probeUrl(raw) {
    const url = (raw || '').trim();
    const i18n = window.MusicStudioI18n;
    const t = (k, fallback) => i18n ? i18n.t(k) : fallback;
    if (!url) return { state: 'idle', text: t('settings.status.unconfigured', '未配置') };
    if (!isValidEndpoint(url)) return { state: 'unreachable', text: t('settings.probe.invalid', 'URL 格式不合法') };
    const sameOrigin = url.startsWith('/');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      if (sameOrigin) {
        // Same-origin path goes through local proxy which forwards
        // Authorization. Probe with the saved key so 401 means "real auth
        // failure", not "no header sent" (which would be a false negative).
        const probeHeaders = {};
        const key = (root.state.apiKey || '').trim();
        if (key) probeHeaders['Authorization'] = `Bearer ${key}`;
        const res = await fetch(url, { method: 'GET', headers: probeHeaders, signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) return { state: 'ok', text: `${t('settings.probe.reachable', '可达')} · ${res.status}` };
        // 401/403 with a key sent = "key rejected"; without a key, surface
        // a clearer hint so the user knows why.
        if (!key) return { state: 'unreachable', text: `${t('settings.probe.unreachable', '不可达')} · ${res.status} (${t('settings.probe.noKey', '未带 key')})` };
        return { state: 'unreachable', text: `${t('settings.probe.authFail', '鉴权失败')} · ${res.status}` };
      } else {
        await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
        clearTimeout(timer);
        return { state: 'ok', text: t('settings.probe.crossOrigin', '跨域可达') };
      }
    } catch (e) {
      clearTimeout(timer);
      return { state: 'unreachable', text: t('settings.status.unreachableNet', '不可达 · 网络错误') };
    }
  }
  let musicProbeTimer = null, llmProbeTimer = null;
  function scheduleProbe(which) {
    const i18n = window.MusicStudioI18n;
    const msg = i18n ? i18n.t('settings.status.checking') : '检测中…';
    paintProbe(which === 'music' ? musicProbe : llmProbe, 'checking', msg);
    clearTimeout(which === 'music' ? musicProbeTimer : llmProbeTimer);
    const t = setTimeout(() => probeNow(which), 600);
    if (which === 'music') musicProbeTimer = t; else llmProbeTimer = t;
  }
  async function probeNow(which) {
    const slot = which === 'music' ? musicProbe : llmProbe;
    const input = which === 'music' ? musicApiUrlInput : llmApiUrlInput;
    const r = await probeUrl(input.value);
    paintProbe(slot, r.state, r.text);
  }

  // One-click all-field validation: probes both URLs + reports key presence.
  // Reuses probeUrl() so the dot state updates live.
  async function onTestAll() {
    const i18n = window.MusicStudioI18n;
    const t = (k, fb) => i18n ? i18n.t(k) : fb;
    const oldLabel = testAllBtn.textContent;
    testAllBtn.disabled = true;
    testAllBtn.textContent = t('settings.probe.testing', 'Testing…');
    try {
      await Promise.all([probeNow('music'), probeNow('llm')]);
      const musicOk = musicProbe.dataset.state === 'ok';
      const llmOk   = llmProbe.dataset.state   === 'ok';
      const hasKey  = apiKeyInput.value.trim().length > 0;
      const parts = [];
      parts.push(`API Key · ${hasKey ? '✓' : '✗ ' + t('settings.probe.empty', '未填写')}`);
      parts.push(`Music URL · ${musicOk ? '✓' : '✗ ' + musicProbe.querySelector('.probe-text').textContent}`);
      parts.push(`LLM URL · ${llmOk ? '✓' : '✗ ' + llmProbe.querySelector('.probe-text').textContent}`);
      const allOk = hasKey && musicOk && llmOk;
      toast(parts.join('  ·  '), allOk ? 'ok' : 'err', 4500);
    } finally {
      testAllBtn.disabled = false;
      testAllBtn.textContent = oldLabel;
    }
  }

  // ── Phase 7 P6: URL-parameter import ─────────────────────────
  // schema: ?import=<base64url-encoded JSON> where JSON is
  //   { v: 1, t: <unix-ms timestamp>, data: { apiKey, musicModel,
  //     musicApiUrl, llmModel, llmApiUrl } }
  // On load, if the param is present, decode → validate → confirm
  // → write to localStorage → re-hydrate form → strip the param.
  // Invalid links show an error toast and KEEP the param so the
  // user can inspect what they pasted.
  function decodeBase64Url(s) {
    // base64url → base64: replace -/_ and add padding
    let b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    // atob exists in browsers. Node 16+ also has it; older runtimes
    // can polyfill via Buffer. For the app we just call atob.
    return atob(b64);
  }
  function tryImportFromUrl() {
    const i18n = window.MusicStudioI18n;
    const fail = (msg) => {
      toast(i18n ? i18n.t(msg) : msg, 'err', 4000);
    };
    let url;
    try { url = new URL(location.href); } catch (e) { return; }
    const raw = url.searchParams.get('import');
    if (!raw) return;
    let text;
    try {
      text = decodeBase64Url(raw);
    } catch (e) {
      console.warn('[import] base64 decode failed', e);
      fail('settings.import.invalidLink');
      return;
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      console.warn('[import] JSON parse failed', e);
      fail('settings.import.errorParse');
      return;
    }
    if (!payload || payload.v !== 1 || typeof payload.data !== 'object' || !payload.data) {
      fail('settings.import.invalidLink');
      return;
    }
    const d = payload.data;
    // Phase 10 (P10-1): custom model fields are optional in the import
    // payload — older shares that lack them still work (treated as empty).
    const fieldKeys = ['apiKey', 'musicModel', 'musicApiUrl', 'llmModel', 'llmApiUrl'];
    for (const k of fieldKeys) {
      if (!(k in d)) {
        fail('settings.import.invalidLink');
        return;
      }
    }
    const customMusic = (d.customMusicModel || '').trim();
    const customLlm   = (d.customLlmModel   || '').trim();
    if (!window.confirm(buildImportConfirmPrompt(d, i18n).join('\n'))) {
      // User declined — strip the param so a reload doesn't re-prompt.
      stripImportParam();
      return;
    }
    // Apply to localStorage. We bypass the onSubmit flow so we don't
    // trigger the dirty-pulse animation (the user just confirmed).
    persist.setApiKey(String(d.apiKey || '').trim());
    persist.setMusicModel(String(d.musicModel || '').trim());
    persist.setCustomMusicModel(customMusic);
    persist.setMusicApiUrl(String(d.musicApiUrl || '').trim());
    persist.setLlmModel(String(d.llmModel || '').trim());
    persist.setCustomLlmModel(customLlm);
    persist.setLlmApiUrl(String(d.llmApiUrl || '').trim());
    // Update the in-memory state.
    root.state.apiKey = persist.getApiKey();
    // Re-hydrate form so all <input> reflect the new values.
    hydrate();
    updateKeyStatus();
    updateDirty();
    stripImportParam();
    toast(i18n ? i18n.t('settings.import.success') : 'Settings imported', 'ok', 2400);
  }
  function stripImportParam() {
    try {
      const u = new URL(location.href);
      u.searchParams.delete('import');
      history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash);
    } catch (e) { /* fine — just leave the URL alone */ }
  }
  // Build a confirm prompt for the import dialog. Mask the API key so the
  // user sees the shape but not the full secret. Localised via i18n.
  function buildImportConfirmPrompt(d, i18n) {
    const t = (k, fb) => i18n ? i18n.t(k) : fb;
    const masked = d.apiKey
      ? (d.apiKey.length > 8 ? d.apiKey.slice(0, 4) + '…' + d.apiKey.slice(-4) : '(short)')
      : '(empty)';
    return [
      t('settings.import.confirmTitle', 'Import these settings?'),
      '',
      `${t('settings.import.fieldApiKey', 'API Key')}: ${masked}`,
      `${t('settings.import.fieldMusicModel', 'Music model')}: ${d.musicModel || '(empty)'}`,
      `${t('settings.import.fieldMusicApiUrl', 'Music API URL')}: ${d.musicApiUrl || '(empty)'}`,
      `${t('settings.import.fieldLlmModel', 'LLM model')}: ${d.llmModel || '(empty)'}`,
      `${t('settings.import.fieldLlmApiUrl', 'LLM API URL')}: ${d.llmApiUrl || '(empty)'}`,
    ];
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
