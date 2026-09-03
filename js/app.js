/* ===========================================================
 * app.js  ·  Phase 0
 * ------------------------------------------------------------
 * UI 层:DOM 绑定、渲染、事件。所有状态读写走 window.state,
 * 业务调用走 window.MusicStudio.music / .persist。
 * 行为与重构前完全一致 — 此次重构只动文件结构,不动 UX。
 * =========================================================== */
(function (root) {
  'use strict';
  if (!root.MusicStudio) { console.error('[app] core.js must load first'); return; }

  const state = root.state;
  const NS = root.MusicStudio;
  const music = NS.music;
  const persist = NS.persist;

  /* ─── Sample ─────────────────────────────────────── */
  const SAMPLE = {
    lyrics: '[verse]\nStreetlights flicker, the night breeze sighs\nShadows stretch as I walk alone\nAn old coat wraps my silent sorrow\nWandering, longing, where should I go\n\n[chorus]\nPushing the wooden door, the aroma spreads\nIn a familiar corner, a stranger gazes\nCoffee steams, our hands almost touch\nThis quiet moment means so much\n\n[verse]\nPages turn in the candlelight\nEvery word a soft delight\nYou smile, the world slows down\nIn this café, love is found\n\n[chorus]\nPushing the wooden door, the aroma spreads\nIn a familiar corner, a stranger gazes\nCoffee steams, our hands almost touch\nThis quiet moment means so much\n\n[outro]\n(Fade out with gentle piano)',
    prompt: 'Indie folk, melancholic, introspective, longing, solitary walk, coffee shop, soft acoustic guitar, warm vocals, slow tempo',
  };

  /* ─── Custom select ──────────────────────────────── */
  function closeAllSelects() {
    document.querySelectorAll('.select.open').forEach((s) => {
      s.classList.remove('open');
      s.closest('.card')?.classList.remove('menu-open');
    });
  }

  function initSelects() {
    document.querySelectorAll('.select').forEach((sel) => {
      const target = sel.dataset.target;
      const trigger = sel.querySelector('.select-trigger');
      const label = trigger.querySelector('.label');
      const card = sel.closest('.card');

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !sel.classList.contains('open');
        closeAllSelects();
        if (willOpen) {
          sel.classList.add('open');
          card?.classList.add('menu-open');
        }
      });

      sel.querySelectorAll('.opt').forEach((opt) => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const v = opt.dataset.value;
          const isNumeric = target !== 'format';
          state[target] = isNumeric ? Number(v) : v;
          label.textContent = v;
          sel.querySelectorAll('.opt').forEach((o) => o.classList.remove('selected'));
          opt.classList.add('selected');
          closeAllSelects();
          // 持久化偏好
          if (target === 'sampleRate')  persist.setSampleRate(state.sampleRate);
          if (target === 'bitrate')     persist.setBitrate(state.bitrate);
          if (target === 'format')      persist.setFormat(state.format);
          updateCost();
        });
      });
    });
    document.addEventListener('click', closeAllSelects);
    window.addEventListener('scroll', closeAllSelects, { passive: true });
  }

  /* ─── Structure tags ─────────────────────────────── */
  function initTagBar() {
    document.querySelectorAll('#tagBar .tag').forEach((tag) => {
      tag.addEventListener('click', () => {
        const ta = document.getElementById('lyrics');
        const t = tag.dataset.tag;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const before = ta.value.slice(0, start);
        const after = ta.value.slice(end);
        const insert = (before.length && !before.endsWith('\n\n') ? '\n\n' : '') + t + '\n';
        ta.value = before + insert + after;
        ta.focus();
        const pos = before.length + insert.length;
        ta.setSelectionRange(pos, pos);
        updateCount();
      });
    });
  }

  /* ─── Live counters / cost ───────────────────────── */
  const lyricsEl = document.getElementById('lyrics');
  const promptEl = document.getElementById('prompt');
  const countEl = document.getElementById('lyricsCount');
  const costEl = document.getElementById('cost');

  function updateCount() {
    state.lyrics = lyricsEl.value;
    const n = state.lyrics.length;
    countEl.textContent = `${n} / 3500`;
    countEl.style.color = n > 3500 ? 'var(--danger)' : 'var(--text-muted)';
    updateCost();
  }
  function updateCost() {
    const chars = state.lyrics.length;
    const base = 0.10;
    const sizeFactor = (state.bitrate / 256000);
    const lenFactor = 0.7 + Math.min(1.5, chars / 600) * 0.5;
    const total = (base * sizeFactor * lenFactor).toFixed(2);
    costEl.textContent = `~$${total} / track`;
  }

  lyricsEl.addEventListener('input', updateCount);
  promptEl.addEventListener('input', (e) => { state.prompt = e.target.value; });

  /* ─── API key (Phase 7: lives on Settings page) ─────── */
  // API key is hydrated from localStorage by core.js (window.state.apiKey).
  // We only need a chip in head-actions that reflects status + routes to
  // settings.html when clicked. There is no longer a DOM input here.
  const chipEl = document.getElementById('keyStatusChip');
  const chipDot = document.getElementById('keyChipDot');
  const chipText = document.getElementById('keyChipText');
  // Phase 7 P1: chip has 4 visual states. `loading` is the brief pre-hydrate
  // moment so the dot doesn't flash wrong-color before persist returns.
  // `error` is reached when an upstream call rejects with 401/403.
  function paintChip(state, label) {
    const colorVar = ({
      loading: 'var(--accent)',
      ok:      'var(--success)',
      warn:    'var(--warning)',
      error:   'var(--danger)',
    })[state] || 'var(--warning)';
    chipDot.style.background = colorVar;
    chipDot.style.boxShadow = '0 0 8px ' + colorVar;
    chipEl.dataset.state = state;
    chipText.textContent = label;
  }
  function refreshKeyChip() {
    const has = !!(state.apiKey && state.apiKey.trim());
    const i18n = root.MusicStudioI18n;
    const configured = i18n ? i18n.t('studio.apiKeyConfigured') : 'API Key · 已配置';
    const unconfigured = i18n ? i18n.t('studio.apiKeyUnconfigured') : 'API Key · 未配置';
    const prefix = configured.split('·')[0].trim();
    paintChip(has ? 'ok' : 'warn', prefix + ' · ' + (has ? configured.split('·').slice(1).join('·').trim() : unconfigured.split('·').slice(1).join('·').trim()));
  }
  // Phase 7 P1: public hook so any module can flag the chip as `error` when an
  // upstream call rejects with 401/403. The chip will recover to `ok`/`warn`
  // automatically on the next refreshKeyChip() call.
  root.MusicStudio.apiKeyChip = {
    setError(label) {
      const i18n = root.MusicStudioI18n;
      const prefix = i18n ? i18n.t('studio.apiKeyConfigured').split('·')[0].trim() : 'API Key';
      paintChip('error', label || (prefix + ' · 鉴权失败'));
    },
    refresh: refreshKeyChip,
  };
  // Phase 7 P5: re-paint chip on language change so the dynamic label
  // stays in sync. The i18n module dispatches `i18n:change` after apply().
  document.addEventListener('i18n:change', () => { refreshKeyChip(); });
  // Set initial paint to "loading" so the dot settles to a known colour, then
  // hydrate from persist.
  const _i18n = root.MusicStudioI18n;
  const _prefix = _i18n ? _i18n.t('studio.apiKeyConfigured').split('·')[0].trim() : 'API Key';
  paintChip('loading', _prefix + ' · 检测中…');
  refreshKeyChip();
  if (chipEl) {
    const gotoSettings = () => {
      sessionStorage.setItem('settings_return_to', 'studio');
      location.href = 'settings.html';
    };
    chipEl.addEventListener('click', gotoSettings);
    chipEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); gotoSettings(); }
    });
  }

  // Phase 7: API key guard — when missing, show toast + auto-route to settings
  // (option ii). Returns truthy so the caller's `if (!state.apiKey) return requireApiKey()`
  // short-circuits as expected.
  function requireApiKey() {
    showStatus('请先在 Settings 配置 API Key', 'error', 2200);
    setTimeout(() => {
      sessionStorage.setItem('settings_return_to', 'studio');
      location.href = 'settings.html';
    }, 600);
    return true;
  }

  /* ─── LLM Phase 1: pills + cards wiring ──────── */
  const llm = NS.llm;

  function initPillGroup(group) {
    const multi = group.dataset.multi === 'true';
    group.querySelectorAll('.pill').forEach((p) => {
      p.addEventListener('click', () => {
        if (multi) {
          p.classList.toggle('selected');
        } else {
          group.querySelectorAll('.pill').forEach((o) => o.classList.remove('selected'));
          p.classList.add('selected');
        }
      });
    });
  }
  document.querySelectorAll('.pill-group').forEach(initPillGroup);

  function readPillGroup(group) {
    const multi = group.dataset.multi === 'true';
    const sel = Array.from(group.querySelectorAll('.pill.selected')).map((p) => p.dataset.val);
    return multi ? sel : (sel[0] || null);
  }

  // Lang pills: 同步到 state.llmLangs
  document.getElementById('langPills')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('pill')) {
      setTimeout(() => {
        state.llmLangs = readPillGroup(document.getElementById('langPills'));
        persist.setLlmLangs(state.llmLangs);
      }, 0);
    }
  });

  function showLlmResult(containerId, bodyId, content) {
    document.getElementById(containerId).style.display = 'block';
    document.getElementById(bodyId).textContent = content;
  }
  function hideLlmResult(containerId) {
    document.getElementById(containerId).style.display = 'none';
  }
  function setBtnLoading(btn, loading) {
    btn.disabled = loading;
    if (loading) {
      if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.innerHTML;
      btn.innerHTML = '<div class="spinner" style="width:12px;height:12px;border-width:2px"></div> Generating…';
    } else {
      btn.innerHTML = btn.dataset.origLabel;
    }
  }

  // Phase 10 (P10-2): unified song package — 1 LLM call → {title, lyrics, prompt}
  // Falls back to two-step inside llm.generateSongPackage; app.js stays unaware.
  let packageAbort = null;
  let lastPackageDraft = null;
  const btnGenPackage    = document.getElementById('btnGenPackage');
  const btnPackageRetry  = document.getElementById('btnPackageRetry');
  const btnPackageApply  = document.getElementById('btnPackageApply');

  async function runGenPackage() {
    const theme = document.getElementById('llmTheme').value.trim();
    if (!theme) { showStatus('请先写一个 theme / idea。', 'error', 2500); return; }
    if (!state.apiKey) { return requireApiKey(); }
    if (packageAbort) packageAbort.abort();
    packageAbort = new AbortController();

    const mode = readPillGroup(document.getElementById('promptModePills')) || 'random';
    const locked = {
      genre: readPillGroup(document.getElementById('genrePills')),
      mood: readPillGroup(document.getElementById('moodPills')),
      vocal: readPillGroup(document.getElementById('vocalPills')),
    };

    setBtnLoading(btnGenPackage, true);
    btnPackageRetry.disabled = true;
    btnPackageApply.disabled = true;
    showStatus('Generating…', 'loading');

    try {
      const pkg = await llm.generateSongPackage({
        theme, languages: state.llmLangs, targetLen: state.llmTargetLen,
        promptMode: mode, locked, signal: packageAbort.signal,
      });
      lastPackageDraft = pkg;
      const titleEl = document.getElementById('llmTitle');
      if (titleEl) titleEl.value = pkg.title || '';
      const preview = `[${pkg.title}]\n\n${pkg.lyrics}\n\n---\nMusic prompt: ${pkg.prompt}`;
      showLlmResult('packageResult', 'packageResultBody', preview);
      showStatus(
        `Package drafted · lyrics ${pkg.lyrics.length} chars · prompt ${pkg.prompt.length} chars`,
        'success', 2400
      );
      NS.apiKeyChip?.refresh();
    } catch (e) {
      const msg = e?.code === 'auth' ? 'API Key 无效或被拒绝' : (e?.message || 'LLM request failed');
      if (e?.code === 'auth') NS.apiKeyChip?.setError('API Key · 鉴权失败');
      showStatus(`✕ ${msg}`, 'error', 5000);
      hideLlmResult('packageResult');
      console.error('[LLM package]', e);
    } finally {
      setBtnLoading(btnGenPackage, false);
      btnPackageRetry.disabled = false;
      btnPackageApply.disabled = false;
    }
  }
  btnGenPackage?.addEventListener('click', runGenPackage);
  btnPackageRetry?.addEventListener('click', runGenPackage);
  btnPackageApply?.addEventListener('click', () => {
    if (!lastPackageDraft) return;
    const titleEl = document.getElementById('llmTitle');
    const title = (titleEl?.value || lastPackageDraft.title || '').trim();
    lyricsEl.value = lastPackageDraft.lyrics;
    promptEl.value = lastPackageDraft.prompt;
    state.title  = title;  // Phase 12: 写 state.title;fallback 链在 batch 启动处
    state.lyrics = lastPackageDraft.lyrics;
    state.prompt = lastPackageDraft.prompt;
    updateCount();
    showStatus(
      title
        ? `Package applied · title "${title}" + lyrics + prompt`
        : 'Package applied to Lyrics and Music prompt (no title).',
      'success', 1800
    );
    hideLlmResult('packageResult');
  });

  // llmTargetLen select
  document.querySelector('.select[data-target="llmTargetLen"]')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('opt')) {
      setTimeout(() => {
        const v = Number(document.querySelector('.select[data-target="llmTargetLen"] .label').textContent);
        if ([400, 600, 900].includes(v)) {
          state.llmTargetLen = v;
          persist.setLlmTargetLen(v);
        }
      }, 0);
    }
  });

  /* ─── Sample / clear ─────────────────────────────── */
  document.getElementById('btnLoad').addEventListener('click', () => {
    lyricsEl.value = SAMPLE.lyrics;
    promptEl.value = SAMPLE.prompt;
    updateCount();
    state.prompt = SAMPLE.prompt;
    showStatus('Loaded sample lyrics + prompt.', 'success', 1800);
  });
  document.getElementById('btnClear').addEventListener('click', () => {
    lyricsEl.value = '';
    promptEl.value = '';
    state.lyrics = '';
    state.prompt = '';
    updateCount();
  });

  /* ─── Phase 14: 新建任务(完整重置 form + preview + batch + LLM 草稿) ── */
  function newTask() {
    // 1) form 输入
    lyricsEl.value = '';
    promptEl.value = '';
    state.lyrics = '';
    state.prompt = '';
    state.title = '';
    const titleEl = document.getElementById('llmTitle');
    if (titleEl) titleEl.value = '';
    updateCount();

    // 2) preview 区: 回到 emptyState, 隐藏 taskList/resultBox/errorBox
    const empty = document.getElementById('emptyState');
    const taskList = document.getElementById('taskList');
    const resultBox = document.getElementById('resultBox');
    const errorBox = document.getElementById('errorBox');
    if (empty) empty.style.display = '';
    if (taskList) { taskList.style.display = 'none'; taskList.innerHTML = ''; }
    if (resultBox) resultBox.style.display = 'none';
    if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }

    // 3) batch: 退出 batch 模式, 清空 tasks, 隐藏 batchbar
    batchbar.classList.remove('active');
    state.tasks = [];
    state.activeTaskId = null;
    state.outcome = null;
    state.audioUrl = null;
    state.audioBlob = null;
    // 释放 audio src,避免上一个 task 的 blob URL 仍占内存
    _setAudioSrc(null, null);
    if (typeof renderBatchProgress === 'function') renderBatchProgress();
    if (typeof renderTaskList === 'function') renderTaskList();
    if (typeof renderTaskMini === 'function') renderTaskMini();

    // 4) LLM 草稿区: 隐藏 packageResult
    if (typeof hideLlmResult === 'function') hideLlmResult('packageResult');

    // 5) status
    showStatus('已新建任务 · form & preview 已重置', 'success', 1500);
  }

  // click handler 绑定延后到 batchbar const 声明之后(见下);
  // function newTask() 已在 btnClear 下方声明(hoist),运行时可调用。

  /* ─── Status banner ──────────────────────────────── */
  const statusEl = document.getElementById('status');
  let statusTimer = null;
  function showStatus(msg, kind, autoHideMs) {
    clearTimeout(statusTimer);
    if (kind === 'loading') {
      statusEl.innerHTML = `<div class="status loading"><div class="spinner"></div>${msg}</div>`;
    } else if (kind === 'success') {
      statusEl.innerHTML = `<div class="status success">✓ ${msg}</div>`;
    } else {
      statusEl.innerHTML = `<div class="status error">✕ ${msg}</div>`;
    }
    if (autoHideMs) statusTimer = setTimeout(() => { statusEl.innerHTML = ''; }, autoHideMs);
  }

  /* ─── Result render ──────────────────────────────── */
  // Phase 9: 切到 task 时释放上一个 task 的 blob URL,避免内存泄漏
  let _currentBlobUrl = null;
  function _setAudioSrc(blob, remoteUrl) {
    if (_currentBlobUrl) { URL.revokeObjectURL(_currentBlobUrl); _currentBlobUrl = null; }
    const audio = document.getElementById('audioEl');
    if (blob) {
      _currentBlobUrl = URL.createObjectURL(blob);
      audio.src = _currentBlobUrl;
    } else if (remoteUrl) {
      audio.src = remoteUrl;
    } else {
      audio.removeAttribute('src');
    }
    audio.load();
    // P22-2: 同步 state.audioUrl,让 copyBtn 永远能拿到当前 src URL
    // (blob 路径下用 blob: URL,因为它就是 audio.src 实际指向的)
    state.audioUrl = _currentBlobUrl || remoteUrl || null;
  }

  // Phase 22: 把"曲目"面板从 emptyState 切到 resultBox 并填元数据,供 playBtn + Library 整行 click 共用
  // 不调 renderResult(task)(那需要 outcome/sampleRate 等 task 字段),只做最小 reveal
  function _showResultForDoc(doc) {
    const empty = document.getElementById('emptyState');
    const box = document.getElementById('resultBox');
    if (empty) empty.style.display = 'none';
    if (box) box.style.display = 'block';
    const idx = (doc.idx ?? 0);
    const displayTitle = doc.title || (doc.prompt ? doc.prompt.slice(0, 40) : '') || `track ${idx + 1}`;
    const rTitle = document.getElementById('rTitle');
    const rSub = document.getElementById('rSub');
    const rDuration = document.getElementById('rDuration');
    const rSample = document.getElementById('rSample');
    const rFormat = document.getElementById('rFormat');
    const previewMeta = document.getElementById('previewMeta');
    if (rTitle) rTitle.textContent = `track #${String(idx + 1).padStart(2, '0')} · ${displayTitle}`;
    if (rSub) rSub.textContent = doc.status === 'failed' ? `failed · ${doc.error || 'unknown error'}` : '—';
    if (rDuration) rDuration.textContent = '—';
    if (rSample) rSample.textContent = '—';
    if (rFormat) rFormat.textContent = (doc.format || '').toUpperCase() || '—';
    if (previewMeta) previewMeta.textContent = displayTitle;

    // Phase 22 P22-2: 把下载/打开/复制三个按钮绑到当前 doc,而不是 state.tasks
    // (Library doc 不在 state.tasks,旧的 renderResult(task) 路径完全跑不到这里)
    const hasAudio = !!(doc.audioBlob || doc.audioUrl);
    const dl = document.getElementById('dlBtn');
    const op = document.getElementById('openBtn');
    if (hasAudio) {
      // dlBtn: 永远走 click handler(620 行的 libId 分支) — 它会调 lib.exportTrack,
      // exportTrack 内部:有 blob 走 blob 路径,只有 url 走 /api/audio/fetch proxy 中转
      // → 用 downloadBlob() 触发保存(URL.createObjectURL + 模拟 click),绕开
      //   <a download href=cross-origin> 在同源 proxy 上的 Content-Disposition 缺失问题
      //   (Chrome 看到 proxy 响应无 Content-Disposition 会 inline 渲染而非 download)
      dl.removeAttribute('href');
      dl.removeAttribute('download');
      dl.dataset.libId = doc.id;
      dl.style.pointerEvents = '';
      // openBtn: 永远指原始 URL(打开新 tab,不受 CORS 限制)
      op.href = doc.audioUrl || '#';
      op.style.pointerEvents = '';
      // copyBtn: state.audioUrl 由 _setAudioSrc 同步
      document.getElementById('copyBtn').style.pointerEvents = '';
    } else {
      // 没有 audio:三个按钮全 disable
      if (dl) { dl.removeAttribute('href'); dl.removeAttribute('data-lib-id'); dl.style.pointerEvents = 'none'; }
      if (op) { op.removeAttribute('href'); op.style.pointerEvents = 'none'; }
      document.getElementById('copyBtn').style.pointerEvents = 'none';
    }
  }

  function renderResult(task) {
    const empty = document.getElementById('emptyState');
    const box = document.getElementById('resultBox');
    const errBox = document.getElementById('errorBox');
    const linksBox = box.querySelector('.links');

    empty.style.display = 'none';
    box.style.display = 'block';

    state.activeTaskId = task.id;
    state.outcome = task.outcome || null;
    state.audioUrl = task.audioUrl || null;
    state.audioBlob = task.audioBlob || null;

    const outcome = task.outcome;
    const fmt = outcome?.format || state.format;
    const sr = outcome?.sample_rate || state.sampleRate;
    const dur = outcome?.duration_ms;
    const br = outcome?.bitrate || state.bitrate;

    // Phase 9: 优先用本地 blob 喂 audio 元素,绕开 CORS
    _setAudioSrc(task.audioBlob || null, task.audioUrl || null);

    const ts = new Date(task.startedAt).toLocaleTimeString();
    const displayPrompt = task.prompt || state.prompt;
    const displayTitle = task.title || (displayPrompt ? displayPrompt.slice(0, 40) : '');
    const promptBit = displayTitle ? ' · ' + displayTitle : (displayPrompt ? ' · ' + displayPrompt.slice(0, 28) : '');
    document.getElementById('rTitle').textContent =
      `track #${String(task.idx + 1).padStart(2, '0')} · ${ts}${promptBit}`;
    document.getElementById('rSub').textContent = task.status === 'failed'
      ? `failed · ${task.error || 'unknown error'}`
      : `${(fmt || '').toUpperCase()} · ${sr} Hz · ${(br / 1000)} kbps`;
    document.getElementById('rDuration').textContent = music.fmtDuration(dur);
    document.getElementById('rSample').textContent = sr ? `${sr / 1000} kHz` : '—';
    document.getElementById('rFormat').textContent = (fmt || '').toUpperCase();
    document.getElementById('previewMeta').textContent =
      `${state.tasks.length} track${state.tasks.length === 1 ? '' : 's'}`;

    const dl = document.getElementById('dlBtn');
    const op = document.getElementById('openBtn');
    // Phase 9: 命名用 task.title (新生成) 或 (lyrics/prompt 截取) 兜底
    const baseName = (task.title && task.title.trim())
      || (task.prompt ? task.prompt.trim().replace(/\s+/g, ' ').slice(0, 40) : '')
      || `track-${task.idx + 1}`;
    const safeBase = baseName.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
    const trackIdx = String(task.idx + 1).padStart(2, '0');
    const audioName = `${safeBase}-${trackIdx}.${(fmt || 'mp3').toLowerCase()}`;
    const lyricsName = `${safeBase}-${trackIdx}.txt`;
    const hasAudio = !!(task.audioBlob || task.audioUrl);

    if (hasAudio) {
      // 有 audioBlob 时 dlBtn 走 click handler (真正存文件);
      // 没有时回退到 <a href=url download=...> 旧行为(可能开新 tab)。
      // 这里清空 href/download 让 click handler 完全接管 blob 路径
      dl.removeAttribute('href');
      dl.dataset.taskIdx = String(task.idx);
      if (task.audioUrl) op.href = task.audioUrl;
      else op.removeAttribute('href');
      dl.style.pointerEvents = '';
      op.style.pointerEvents = '';
      linksBox.style.display = '';
    } else {
      dl.removeAttribute('href'); op.removeAttribute('href');
      delete dl.dataset.taskIdx;
      dl.style.pointerEvents = 'none';
      op.style.pointerEvents = 'none';
      if (task.status === 'failed') linksBox.style.display = 'none';
    }

    if (task.status === 'failed') {
      errBox.style.display = 'block';
      errBox.textContent = `✕ ${task.error || 'Generation failed.'}`;
    } else {
      errBox.style.display = 'none';
    }

    document.getElementById('payloadView').textContent =
      JSON.stringify(music.buildPayload(), null, 2);
  }

  /* ─── Play button toggle ─────────────────────────── */
  const playBtn = document.getElementById('playBtn');
  const playIcon = document.getElementById('playIcon');
  const audioEl = document.getElementById('audioEl');
  playBtn.addEventListener('click', () => {
    if (!audioEl.src) return;
    if (audioEl.paused) audioEl.play();
    else audioEl.pause();
  });
  audioEl.addEventListener('play', () => {
    playBtn.classList.add('playing');
    playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
  });
  audioEl.addEventListener('pause', () => {
    playBtn.classList.remove('playing');
    playIcon.innerHTML = '<path d="M5 3l14 9-14 9V3z"/>';
  });
  audioEl.addEventListener('ended', () => {
    playBtn.classList.remove('playing');
    playIcon.innerHTML = '<path d="M5 3l14 9-14 9V3z"/>';
  });

  /* ─── Copy URL ────────────────────────────────────── */
  document.getElementById('copyBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    if (!state.audioUrl) return;
    try {
      await navigator.clipboard.writeText(state.audioUrl);
      const c = e.currentTarget;
      const prev = c.textContent;
      c.textContent = 'Copied ✓';
      setTimeout(() => (c.textContent = prev), 1200);
    } catch {
      showStatus('Copy failed — clipboard blocked.', 'error', 2500);
    }
  });

  /* ─── Phase 21: proxy audio fetch (fallback when audioBlob missing) ── */
  // The remote GCS user-assets bucket (storage.googleapis.com) does not return
  // Access-Control-Allow-Origin headers, so the browser's fetch() / <a download>
  // would either throw CORS errors or silently open the URL in a new tab
  // instead of saving the file. The Node proxy exposes /api/audio/fetch which
  // streams the remote audio back to us, sidestepping CORS entirely.
  async function fetchAudioViaProxy(audioUrl) {
    const res = await fetch('/api/audio/fetch?url=' + encodeURIComponent(audioUrl));
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Proxy ${res.status}: ${errBody.slice(0, 120) || res.statusText}`);
    }
    return res.blob();
  }

  /* ─── Phase 9: Download (dlBtn) — 真正存文件 ─────────── */
  // 历史实现: dl.href = remoteUrl  → 浏览器打开远程 URL(跨域忽略 download 属性)
  // 现在: 优先用 task.audioBlob 走 downloadBlob,无 blob 降级到 remote URL
  // (P21)  remote URL 走本地 Node proxy 中转,拿到 blob 后再 downloadBlob
  //        → 绕开 storage.googleapis.com 无 CORS 头的问题。
  const dlBtnEl = document.getElementById('dlBtn');
  dlBtnEl?.addEventListener('click', async (e) => {
    e.preventDefault();
    // P22-2: Library doc 走 data-lib-id 路径(不在 state.tasks)
    const libId = dlBtnEl.dataset.libId;
    if (libId) {
      const doc = state.library.items.find((d) => d.id === libId);
      if (!doc) return;
      if (doc.status !== 'success') {
        showStatus('Only completed tracks can be downloaded.', 'error', 2200);
        return;
      }
      showStatus(`Preparing "${doc.title || libId}"…`, 'loading', 1500);
      try {
        const payload = await lib.exportTrack(libId);
        let count = 0;
        if (payload.audio) {
          downloadBlob(payload.audio.blob, payload.audio.name, payload.audio.mime, false);
          count++;
        }
        if (payload.lyrics) {
          downloadBlob(payload.lyrics.text, payload.lyrics.name, payload.lyrics.mime, false);
          count++;
        }
        if (count === 0) {
          showStatus('Nothing to download for this track.', 'error', 2200);
        } else {
          const hasLyrics = payload.lyrics ? ' + lyrics' : '';
          showStatus(`Downloaded ${doc.title || libId}${hasLyrics}.`, 'success', 2200);
        }
      } catch (err) {
        showStatus('Download failed: ' + (err?.message || err), 'error', 3000);
      }
      return;
    }
    const idxStr = dlBtnEl.dataset.taskIdx;
    if (idxStr == null) return;
    const idx = Number(idxStr);
    const task = state.tasks.find((t) => t.idx === idx);
    if (!task) return;
    if (task.status === 'failed') {
      showStatus('This track failed to generate.', 'error', 2200);
      return;
    }
    const fmt = (task.outcome?.format || state.format || 'mp3').toLowerCase();
    // P21: 文件名 = task.title (Phase 10-2 歌名一等公民) → state.title (用户输入但未入 task) → prompt 截取 → track-NN
    const baseName = (task.title && task.title.trim())
      || (state.title && state.title.trim())
      || (task.prompt ? task.prompt.trim().replace(/\s+/g, ' ').slice(0, 40) : '')
      || `track-${idx + 1}`;
    const safeBase = baseName.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
    const trackIdx = String(idx + 1).padStart(2, '0');
    const audioName = `${safeBase}-${trackIdx}.${fmt}`;
    const lyricsName = `${safeBase}-${trackIdx}.txt`;
    const lyrics = task.lyrics || state.lyrics || '';

    if (task.audioBlob) {
      downloadBlob(task.audioBlob, audioName, `audio/${fmt}`, false);
    } else if (task.audioUrl) {
      // P21: 没有本地 blob 时,通过 Node proxy 中转拿 blob
      // (storage.googleapis.com 没 CORS 头,直接 fetch / <a download> 跨域必失败或开新 tab)
      try {
        const blob = await fetchAudioViaProxy(task.audioUrl);
        downloadBlob(blob, audioName, `audio/${fmt}`, false);
      } catch (err) {
        showStatus('Audio download failed: ' + (err?.message || err), 'error', 3500);
        return;
      }
    } else {
      showStatus('No audio to download.', 'error', 2200);
      return;
    }
    if (lyrics) {
      downloadBlob(lyrics, lyricsName, 'text/plain;charset=utf-8', false);
      showStatus(`Downloaded ${audioName} + lyrics.`, 'success', 2200);
    } else {
      showStatus(`Downloaded ${audioName}.`, 'success', 2200);
    }
  });

  /* ─── Phase 23: 左侧"历史任务"侧栏(由 jobs-rail.js 接管) ─────
   * 旧 sessions 镜像逻辑(sessions.create 写入 + renderSessionsRail)已废弃。
   * 新侧栏: 1 row = 1 个 job(单轨 = 1-job-1-task; 批量 = 1-job-N-task,可展开)
   * 数据源: NS.library.jobs.list()  (store: minimax-jobs,Phase 0/4 已经在写)
   * 旧 NS.sessions 保留在 IDB 不删,UI 不再显示
   * ─────────────────────────────────────────────────────── */
  function _loadTaskIntoForm(t) {
    // Phase 23: 把 job 子任务的 lyrics/prompt 灌回 form
    lyricsEl.value = t.lyrics || '';
    promptEl.value = t.prompt || '';
    state.lyrics = t.lyrics || '';
    state.prompt = t.prompt || '';
    updateCount();
    document.querySelector('.main')?.scrollTo?.({ top: 0, behavior: 'smooth' });
    const msg = (NS.i18n?.t?.('nav.task.loaded')) || 'Loaded from task';
    showStatus(`${msg} · ${t.title || ''}`, 'success', 2200);
  }

  function _enterEditJobTitle(titleEl, j) {
    // Phase 23: rename 通过 NS.library.jobs.put 写回(取代旧 sessions.rename)
    const cur = titleEl.getAttribute('data-raw') || titleEl.textContent;
    titleEl.contentEditable = 'true';
    titleEl.setAttribute('data-prev', cur);
    titleEl.focus();
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const finish = async (commit) => {
      titleEl.removeEventListener('keydown', onKey);
      titleEl.removeEventListener('blur', onBlur);
      titleEl.contentEditable = 'false';
      const next = commit ? (titleEl.textContent || '').trim() : cur;
      titleEl.textContent = next || cur;
      if (commit && next && next !== cur) {
        j.title = next;
        try {
          await NS.library.jobs.put(j.id, j);
        } catch (e) {
          console.warn('[jobs-rail] rename put failed', e);
        }
      }
    };
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);
    titleEl.addEventListener('keydown', onKey);
    titleEl.addEventListener('blur', onBlur);
  }

  /* ─── Validate ───────────────────────────────────── */
  function validate() {
    // API key now lives on the Settings page (Phase 7); state.apiKey is the
    // single source of truth, hydrated from localStorage by core.js.
    if (!state.apiKey) return '请先在 Settings 配置 API Key';
    // Phase 17: 生产面板的 lyrics 由 LLM 自动派生,跳过 lyrics 校验
    // (但 prompt 长度仍校验,免得生成后超限)
    if (!state.production.bypassLyricsCheck) {
      if (!state.lyrics || state.lyrics.trim().length < 1) return '请填写歌词';
      if (state.lyrics.length > 3500) return `歌词超出限制（${state.lyrics.length}/3500）`;
    }
    if (state.prompt.length > 2000) return `Prompt 超出限制（${state.prompt.length}/2000）`;
    return null;
  }

  /* ─── Batch progress UI ──────────────────────────── */
  const BATCH_MAX = music.constants.BATCH_MAX;
  const BATCH_CONCURRENCY = music.constants.BATCH_CONCURRENCY;

  const batchbar = document.getElementById('batchbar');
  const batchFill = document.getElementById('batchFill');
  const batchCounter = document.getElementById('batchCounter');

  // Phase 14: 「新建任务」按钮 click handler
  // (function newTask() 已在 btnClear 下方声明 — 上面 hoisted 到这里)
  document.getElementById('newTaskBtn')?.addEventListener('click', () => {
    // 守卫: 生成中二次确认
    const hasRunning = Array.isArray(state.tasks) && state.tasks.some((t) => t && t.status === 'running');
    if (hasRunning) {
      const ok = window.confirm('当前有生成进行中,确认放弃并新建任务?');
      if (!ok) return;
    }
    newTask();
  });
  const batchStatus = document.getElementById('batchStatus');
  const batchSpinner = document.getElementById('batchSpinner');
  const vuMeter = document.getElementById('vuMeter');  // Phase 6 P3: VU meter
  const taskMini = document.getElementById('taskMini');
  const btnCancel = document.getElementById('btnCancel');

  const batchHint = document.getElementById('batchHint');
  const batchInput = document.getElementById('batchInput');  // Phase 15: 数字 input
  const batchInputWrap = document.getElementById('batchInputWrap');
  const btnGenerateLabel = document.getElementById('btnGenerateLabel');
  const estTimeEl = document.getElementById('estTime');  // Phase 15: 动态 ETA

  // Phase 15: 动态 ETA 估算。
  // 经验值: 单首 ~30–60s (中位数 45s)。
  // Phase 18 (P18-2b): 生产面板 per-track sequential — 整条 batch 时长 ≈ single × n,
  // 不再有 concurrency 摊销。LLM 角度派生 ~3s/首 (无论 vary 与否,vary=false 时只有
  // generateAngles 一次调用;n 首 pipeline 每首 ~3s 的 LLM 派生,已包含在 perTrackSec)。
  // 进度文案: 单首 "~45s"、batch=5 sequential "~3-5 min"。
  function updateEstTime() {
    const n = Math.max(1, state.batchSize | 0);
    const perTrackSec = 45;
    const totalSec = n * perTrackSec;
    if (totalSec < 60) {
      estTimeEl.textContent = `~${totalSec}s`;
    } else {
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      estTimeEl.textContent = s > 0 ? `~${m}m ${s}s` : `~${m}m`;
    }
  }

  function updateBatchControls() {
    if (batchInput && document.activeElement !== batchInput) {
      batchInput.value = String(state.batchSize);
    }
    batchHint.textContent = `×${state.batchSize}`;
    btnGenerateLabel.textContent = state.batchSize > 1
      ? `Generate ×${state.batchSize}` : 'Generate';
    updateCost();
    applyVaryState();  // Phase 2
    updateEstTime();   // Phase 15
  }

  // Phase 15: input 三 event 处理。
  // - input:        边输入边解析 + 实时 clamp,让 batchHint/btnGenerateLabel/cost/ETA 跟着变
  // - change(blur): 提交最终值;非法(empty / 0 / 负 / NaN / 100+) 拒绝并 reset 上一值
  // - keydown:      数字白名单 + Enter 触发 blur + Tab 默认
  function _parseBatchInput(raw) {
    const s = String(raw || '').trim();
    if (s === '') return null;  // 标记"空"
    const n = parseInt(s, 10);
    if (!Number.isFinite(n) || isNaN(n)) return null;
    if (n < 1 || n > 100) return null;
    return n;
  }
  batchInput?.addEventListener('input', (e) => {
    const raw = e.target.value;
    // 接受中间态 (空 / 0 / 临时值),不立刻 commit
    if (raw === '') {
      batchInputWrap?.classList.remove('invalid');
      return;
    }
    const n = _parseBatchInput(raw);
    if (n === null) {
      // 中间态 (如 "0", "-1", "1.5") 暂时不动 state,仅显示 invalid 红框
      batchInputWrap?.classList.add('invalid');
      return;
    }
    batchInputWrap?.classList.remove('invalid');
    if (n === state.batchSize) return;
    state.batchSize = n;
    persist.setBatchSize(n);
    updateBatchControls();
  });
  batchInput?.addEventListener('change', (e) => {
    const n = _parseBatchInput(e.target.value);
    if (n === null) {
      // 拒绝 — reset 到上一合法值
      batchInputWrap?.classList.add('invalid');
      window.setTimeout(() => batchInputWrap?.classList.remove('invalid'), 1500);
      batchInput.value = String(state.batchSize);
      return;
    }
    batchInputWrap?.classList.remove('invalid');
    if (n !== state.batchSize) {
      state.batchSize = n;
      persist.setBatchSize(n);
      updateBatchControls();
    } else {
      // 值没变,但确保显示同步
      batchInput.value = String(n);
    }
  });
  batchInput?.addEventListener('keydown', (e) => {
    // 允许: Backspace / Delete / Arrow / Home / End / Tab / Enter
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Tab' ||
        e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
        e.key === 'Home' || e.key === 'End') return;
    if (e.key === 'Enter') { e.preventDefault(); batchInput.blur(); return; }
    // 只允许 0–9
    if (!/^[0-9]$/.test(e.key)) e.preventDefault();
  });

  // Phase 2: Vary-each toggle (batchSize>1 时启用)
  const varyInput = document.getElementById('varyToggleInput');
  const varyWrap = document.getElementById('varyToggle');
  function applyVaryState() {
    if (!varyInput || !varyWrap) return;
    varyInput.checked = state.llmBatchVary;
    varyWrap.style.opacity = state.batchSize > 1 ? '1' : '0.45';
    varyWrap.style.pointerEvents = state.batchSize > 1 ? '' : 'none';
    varyWrap.title = state.batchSize > 1
      ? '开启后,每首用 LLM 生成独立的歌词+prompt;关闭则共享下面的 textarea'
      : '将 Batch 调到 ≥ 2 后可启用「每首独立生成」';
  }
  varyInput?.addEventListener('change', () => {
    if (state.batchSize < 2) { varyInput.checked = false; return; }
    state.llmBatchVary = varyInput.checked;
    persist.setLlmBatchVary(state.llmBatchVary);
  });
  // (updateBatchControls 内部已调用 applyVaryState,见函数尾部)

  /* ─── Phase 8 (P7): 批量生产线 — 3×3 axis mode hydrate + sync ─── */
  // 每个 axis-mode pill group: data-axis="genre|mood|vocal",单选 (data-multi="false")
  // 点击后立即把 3 个 axis 的 mode 同步到 state.production.axisMode + persist
  function hydrateAxisMode() {
    const modes = persist.getProductionAxisMode();  // ['locked','random','forbidden']
    const axes = ['genre', 'mood', 'vocal'];
    axes.forEach((axis, idx) => {
      const group = document.querySelector(`.axis-mode[data-axis="${axis}"]`);
      if (!group) return;
      const mode = modes[idx] || 'random';
      group.querySelectorAll('.pill').forEach((p) => {
        p.classList.toggle('selected', p.dataset.val === mode);
      });
    });
  }
  function syncAxisMode() {
    const axes = ['genre', 'mood', 'vocal'];
    const arr = axes.map((axis) => {
      const g = document.querySelector(`.axis-mode[data-axis="${axis}"]`);
      return g ? (readPillGroup(g) || 'random') : 'random';
    });
    persist.setProductionAxisMode(arr);
  }
  hydrateAxisMode();
  // axis-mode 单选 pill:点击后立即同步到 persist
  document.querySelectorAll('.axis-mode').forEach((g) => {
    g.addEventListener('click', (e) => {
      if (e.target.classList.contains('pill')) {
        setTimeout(syncAxisMode, 0);
      }
    });
  });

  function renderTaskList() {
    const box = document.getElementById('taskList');
    const empty = document.getElementById('emptyState');
    if (state.tasks.length === 0) {
      box.style.display = 'none';
      box.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    box.style.display = 'flex';
    box.innerHTML = state.tasks.map((t) => {
      const active = t.id === state.activeTaskId ? ' active' : '';
      const status = t.status;
      const label = t.title || (t.prompt ? t.prompt.slice(0, 22) : (state.prompt ? state.prompt.slice(0, 22) : ''));
      const name = label
        ? `track #${String(t.idx + 1).padStart(2, '0')} · ${label}`
        : `track #${String(t.idx + 1).padStart(2, '0')}`;
      const pct = Math.round(t.progress * 100);
      return `
        <div class="task ${status}${active}" data-task-id="${t.id}">
          <span class="idx">${String(t.idx + 1).padStart(2, '0')}</span>
          <span class="name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
          <span class="badge ${status}">${status}</span>
          <span class="mini"><span class="m" style="width:${pct}%"></span></span>
        </div>`;
    }).join('');
    box.querySelectorAll('.task').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-task-id');
        const t = state.tasks.find((x) => x.id === id);
        if (t && (t.status === 'success' || t.status === 'failed' || t.status === 'running')) {
          renderResult(t);
          renderTaskList();
        }
      });
    });
  }

  function renderTaskMini() {
    taskMini.innerHTML = state.tasks.map((t) => {
      const pct = Math.round(t.progress * 100);
      const lbl = `#${String(t.idx + 1).padStart(2, '0')}`;
      return `
        <div class="task ${t.status}" data-task-id="${t.id}">
          <span class="idx">${lbl}</span>
          <span class="name">${t.status === 'success' ? 'ready' : t.status === 'failed' ? (t.error?.slice(0, 30) || 'failed') : t.status}</span>
          <span class="badge ${t.status}">${t.status}</span>
          <span class="mini"><span class="m" style="width:${pct}%"></span></span>
        </div>`;
    }).join('');
  }

  function renderBatchProgress() {
    const total = state.tasks.length;
    const done = state.tasks.filter((t) => t.status === 'success' || t.status === 'failed' || t.status === 'cancelled').length;
    const ok = state.tasks.filter((t) => t.status === 'success').length;
    const err = state.tasks.filter((t) => t.status === 'failed').length;
    const running = state.tasks.filter((t) => t.status === 'running').length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    batchFill.style.width = pct + '%';
    batchCounter.innerHTML =
      `<span>${done}</span><span class="sep">/</span><span>${total}</span>` +
      ` <span class="ok">✓ ${ok}</span><span class="sep">·</span><span class="err">✕ ${err}</span>` +
      (running ? ` <span class="sep">·</span><span>${running} running</span>` : '');
    if (done === total && total > 0) {
      batchStatus.textContent = err ? `Batch finished with ${err} failure${err > 1 ? 's' : ''}` : 'Batch finished.';
      batchSpinner.style.display = 'none';
    } else {
      batchStatus.textContent = `Working on batch · ${running} running`;
      batchSpinner.style.display = '';
    }
    // Phase 6 P3: VU meter (8 seg × 2 ch) — light segments proportional to done/total
    if (vuMeter) {
      // First-time init: build 8 segments per channel
      if (!vuMeter._vuInit) {
        vuMeter.querySelectorAll('.vu-segments').forEach((row) => {
          for (let i = 0; i < 8; i++) {
            const seg = document.createElement('div');
            seg.className = 'seg';
            row.appendChild(seg);
          }
        });
        vuMeter._vuInit = true;
      }
      // Active when there are running tasks; idle when batch finished or not started
      const isActive = running > 0 && done < total;
      vuMeter.classList.toggle('active', isActive);
      vuMeter.classList.toggle('idle', !isActive);
      // Light level: scale 0-16 segments based on overall progress + a small boost for running
      const levelBase = total ? Math.round((done / total) * 16) : 0;
      const levelBoost = running > 0 ? 2 : 0;  // small constant while running
      const level = Math.min(16, levelBase + levelBoost);
      vuMeter.style.setProperty('--vu-level', String(level));
      // Toggle .on for each segment
      vuMeter.querySelectorAll('.vu-segments').forEach((row) => {
        const segs = row.querySelectorAll('.seg');
        segs.forEach((seg, idx) => {
          const lit = idx < level;
          seg.classList.toggle('on', lit);
          // Last 2 segments are 'peak' (red), segments 4-5 are 'warn' (yellow)
          seg.classList.remove('warn', 'peak');
          if (lit) {
            if (idx >= 6) seg.classList.add('peak');
            else if (idx >= 4) seg.classList.add('warn');
          }
        });
      });
    }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /* ─── 接入 music.events,自动刷新 DOM ──────────── */
  // Phase 4: job helper — 把当前 tasks 快照写回 IDB (debounced via microtask)
  let _jobPersistTimer = null;
  function persistCurrentJob() {
    const job = state.currentJob;
    if (!job || !NS.library) return;
    if (_jobPersistTimer) clearTimeout(_jobPersistTimer);
    _jobPersistTimer = setTimeout(() => {
      _jobPersistTimer = null;
      job.updatedAt = Date.now();
      job.tasks = state.tasks.map((t) => ({
        id: t.id,
        idx: t.idx,
        status: t.status,
        progress: typeof t.progress === 'number' ? t.progress : 0,
        title: t.title || '',
        lyrics: t.lyrics || '',
        prompt: t.prompt || '',
        requestId: t.requestId || null,
        outcome: t.outcome || null,
        audioUrl: t.audioUrl || null,
        error: t.error || null,
        startedAt: t.startedAt || job.createdAt,
      }));
      // 全部结束 → mark done (但保留 5 分钟便于查错?这里直接 done 即可)
      const allDone = job.tasks.length > 0 && job.tasks.every((t) =>
        t.status === 'success' || t.status === 'failed' || t.status === 'cancelled'
      );
      if (allDone) job.status = 'done';
      NS.library.jobs.put(job.id, job).catch((e) => console.warn('[job] persist failed', e));
    }, 120);  // 120ms debounce: 多次事件只写一次
  }

  NS.events.on('task:state',  (t) => {
    renderTaskMini(); renderTaskList(); renderBatchProgress();
    persistCurrentJob();
    // Phase 5: 失败时也持久化到 Library (便于重试 + UI 看到)
    if (t && t.status === 'failed' && NS.library) {
      NS.library.saveFromTask(t, {
        title:   t.title   || (state.prompt ? state.prompt.slice(0, 40) : ''),
        lyrics:  t.lyrics  || state.lyrics,
        prompt:  t.prompt  || state.prompt,
        sampleRate: state.sampleRate,
        bitrate:    state.bitrate,
        format:     state.format,
        failed: true,
        error: t.error,
      }).then((doc) => {
        if (doc && !state.library.items.find((d) => d.id === doc.id)) {
          state.library.items.push(doc);
          renderLibraryPanel();
        }
      }).catch((e) => console.warn('[library] save failed', e));
    }
  });
  NS.events.on('task:progress', () => {
    renderTaskMini(); renderBatchProgress();
    persistCurrentJob();
  });
  NS.events.on('task:success', (t) => {
    renderTaskMini(); renderTaskList(); renderBatchProgress();
    if (!state.activeTaskId || state.activeTaskId === t.id) {
      renderResult(t);
      renderTaskList();
    }
    persistCurrentJob();
    // Phase 3: 持久化到 IDB (后台写,失败 warn 不影响 UI)
    const lib = NS.library;
    if (lib) {
      lib.saveFromTask(t, {
        title:   t.title   || (state.prompt ? state.prompt.slice(0, 40) : ''),
        lyrics:  t.lyrics  || state.lyrics,
        prompt:  t.prompt  || state.prompt,
        sampleRate: state.sampleRate,
        bitrate:    state.bitrate,
        format:     state.format,
      }).then((doc) => {
        if (doc) {
          // 写入内存列表 + 重渲染 (只在 doc 不重复时 push)
          const existing = state.library.items.find((d) => d.id === doc.id);
          if (!existing) state.library.items.push(doc);
          else Object.assign(existing, doc);
          renderLibraryPanel();
        }
      }).catch((e) => console.warn('[library] save failed', e));
    }
    // Phase 23: 不再调 NS.sessions.create 写镜像 — jobs store 已经在写
    // (persistCurrentJob 在 task:state / task:progress / task:success 都会被调用)
    // jobs-rail 通过 NS.events.on('task:*') 监听自动重渲染
  });

  /* ─── Submit (single + batch) ───────────────────── */
  const btnGenerate = document.getElementById('btnGenerate');

  /* ─── Phase 8 (P7): 批量生产线 启动按钮 ─── */
  // 启动时把 prodTheme 写进 #llmTheme (供现有 onGenerate 读取)、
  // 把 useVary 强制打开(否则每首共享 lyrics,失去生产线意义)、选 prodLangPills。
  // 之后调用现有 onGenerate 流程即可。
  const btnProdStart = document.getElementById('btnProdStart');
  if (btnProdStart) {
    btnProdStart.addEventListener('click', async () => {
      const prodTheme = (document.getElementById('prodTheme')?.value || '').trim();
      if (!prodTheme) {
        showStatus('请先填写 Theme', 'error', 2500);
        document.getElementById('prodTheme')?.focus();
        return;
      }
      if (state.batchSize < 1) {
        showStatus('请把 Batch 调到 ≥ 1', 'error', 2500);
        return;
      }
      // 1) 把 prodTheme 注入 #llmTheme (供现有 onGenerate 读取)
      const themeEl = document.getElementById('llmTheme');
      if (themeEl) themeEl.value = prodTheme;
      // 2) 同步 prodLangPills → langPills(让现有 onGenerate 读到生产线的语言选择)
      const prodLangs = readPillGroup(document.getElementById('prodLangPills')) || ['zh'];
      const langPills = document.getElementById('langPills');
      if (langPills) {
        langPills.querySelectorAll('.pill').forEach((p) => {
          p.classList.toggle('selected', prodLangs.includes(p.dataset.val));
        });
        state.llmLangs = prodLangs;
        persist.setLlmLangs(prodLangs);
      }
      // 3) 同步 prodTargetLen → state.llmTargetLen
      const prodTargetEl = document.querySelector('[data-target="prodTargetLen"]');
      const prodTargetVal = prodTargetEl ? prodTargetEl.dataset.value : null;
      if (prodTargetVal && [400, 600, 900].includes(parseInt(prodTargetVal, 10))) {
        state.llmTargetLen = parseInt(prodTargetVal, 10);
        persist.setLlmTargetLen(state.llmTargetLen);
      }
      // 4) 强制 useVary: 生产线语义 = 每首独立 lyrics+prompt
      // batch=1 时也强制打开(单首也是"独立生成",无副作用)
      if (state.batchSize < 2) {
        // 单首场景,vary 不需要,因为没有别的歌"共享",但打开也无害
        state.llmBatchVary = true;
      } else {
        state.llmBatchVary = true;
      }
      persist.setLlmBatchVary(state.llmBatchVary);
      // 5) 把 production.angles 清空 — 让 onGenerate 重新派生
      state.production.angles = [];
      // 6) Phase 17: 触发现有 onGenerate,但先设 bypassLyricsCheck 让 validate() 跳过 lyrics 校验
      // (validate() 是同步的, microtask 后清掉,避免污染后续单轨调用)
      state.production.bypassLyricsCheck = true;
      try {
        btnGenerate.click();
      } finally {
        queueMicrotask(() => { state.production.bypassLyricsCheck = false; });
      }
    });
  }

  btnGenerate.addEventListener('click', async () => {
    const err = validate();
    if (err) { showStatus(err, 'error', 3500); return; }

    const n = state.batchSize;
    const token = ++state.batchToken;
    const llmAbort = new AbortController();
    state.llmAbort = llmAbort;
    btnGenerate.disabled = true;
    btnGenerate.classList.add('recording');  // Phase 6 P2: LED pulse
    if (batchInput) batchInput.disabled = true;  // Phase 15: 替代 +/- stepper 的 disabled
    btnCancel.style.display = '';  // Phase 2: 让 cancel 也能中断 LLM 阶段

    // ── Phase 2: 先串行跑 LLM 拿到 N 组变体 (仅 batchSize≥2 + vary=on) ──
    // Phase 17: n >= 1 — 生产面板 batchSize=1 也走 LLM 派生(每首独立生成语义)
    // 单轨 batchSize=1 时 state.llmBatchVary 默认 false,useVary 仍为 false,行为不变
    const useVary = n >= 1 && state.llmBatchVary;
    const initialTasks = useVary
      ? Array.from({ length: n }, (_, i) => music.newTask(i))  // 先空,稍后填
      : Array.from({ length: n }, (_, i) =>
          music.newTask(i, {
            title: state.title || (state.prompt ? state.prompt.slice(0, 40) : ''),
            lyrics: state.lyrics,
            prompt: state.prompt,
          })
        );

    state.tasks = initialTasks;
    state.activeTaskId = null;
    batchbar.classList.add('active');
    batchSpinner.style.display = '';
    renderTaskMini(); renderTaskList(); renderBatchProgress();

    // Phase 4: 启动新 batch 前,把上一个残留的 active job 标记 done (它已经被新 batch 取代)
    if (state.currentJob && state.currentJob.status === 'active' && NS.library) {
      const prevId = state.currentJob.id;
      // 异步清理 (不阻塞主流程)
      NS.library.jobs.get(prevId).then((prev) => {
        if (prev && prev.status === 'active') {
          prev.status = 'superseded';
          return NS.library.jobs.put(prevId, prev);
        }
      }).catch(() => {});
    }

    // Phase 4: 创建/绑定 job,挂到 IDB 让 reload 能续跑
    // - 新建一个 active job (即使后续阶段失败,也会被标记 done 或 cancelled)
    // - 如果已有 active job (从 resume 流程里进来),继续用旧的 (id 不变)
    if (NS.library && NS.job) {
      if (!state.currentJob || state.currentJob.status !== 'active') {
        const job = NS.job.create({
          config: {
            batchSize: n,
            vary: useVary,
            theme: useVary ? (document.getElementById('llmTheme')?.value?.trim() || '') : '',
            sampleRate: state.sampleRate,
            bitrate: state.bitrate,
            format: state.format,
          },
        });
        job.tasks = state.tasks.map((t) => ({
          id: t.id, idx: t.idx, status: t.status, progress: 0,
          title: t.title || '', lyrics: t.lyrics || '', prompt: t.prompt || '',
          requestId: null, outcome: null, audioUrl: null, error: null,
          startedAt: t.startedAt || job.createdAt,
        }));
        state.currentJob = job;
        NS.library.jobs.put(job.id, job).catch((e) => console.warn('[job] create failed', e));
      } else {
        // resume 流程:tasks 已经被恢复,只需要把 id 对齐到 state.tasks
        state.currentJob.tasks = state.tasks.map((t) => ({
          id: t.id, idx: t.idx, status: t.status, progress: t.progress || 0,
          title: t.title || '', lyrics: t.lyrics || '', prompt: t.prompt || '',
          requestId: t.requestId || null, outcome: t.outcome || null,
          audioUrl: t.audioUrl || null, error: t.error || null,
          startedAt: t.startedAt || state.currentJob.createdAt,
        }));
      }
    }

    if (useVary) {
      const theme = document.getElementById('llmTheme')?.value?.trim() || state.lyrics.slice(0, 60);
      const promptMode = readPillGroup(document.getElementById('promptModePills')) || 'random';
      const locked = {
        genre: readPillGroup(document.getElementById('genrePills')),
        mood: readPillGroup(document.getElementById('moodPills')),
        vocal: readPillGroup(document.getElementById('vocalPills')),
      };

      // Phase 8 (P7) T3: 用 theme 一次性派生 N 个独立角度,保证 N 首歌的视角互不重复
      // 失败回退到默认 "Variation #i of N" hint(generateBatchVariations 内部)
      let angleHints = null;
      try {
        showStatus(`LLM 派生 ${n} 个角度 · 0/${n}`, 'loading');
        const angles = await llm.generateAngles({ theme, count: n, signal: llmAbort.signal });
        // 仅当返回长度 === n 时才使用;否则回退到默认提示(避免 LLM 给少了导致错位)
        if (Array.isArray(angles) && angles.length === n) {
          angleHints = angles;
          state.production.angles = angles;
        }
      } catch (e) {
        if (e.name === 'AbortError') {
          // 用户在派生阶段就 cancel,清空 tasks 直接退出
          state.tasks.forEach((t) => { t.status = 'cancelled'; t.error = 'cancelled'; });
          renderTaskMini(); renderTaskList(); renderBatchProgress();
          showStatus('角度派生已取消。', 'error', 4000);
          return;
        }
        // 派生失败不回滚,继续走默认 variation 提示
        console.warn('[batch] generateAngles failed, falling back to default hints:', e?.message);
      }
    }

    // Token mismatch (用户点了 cancel) → 直接退出
    if (token !== state.batchToken) return;

    // ─── Phase 18 (P18-2b): per-track sequential pipeline ───
    // 用户约束: 一首歌 (LLM 派生 + music 提交 + 轮询 + 缓存 audio) 全好才下一首。
    // 旧: [LLM 全 N 歌] → [music 3 并发] ; 新: for i: [LLM i] → [music i]
    // 收益: 完全避开 GMI 队列 + LLM API 的并发限流,进度可预测,cancel 粒度更细。
    // 副作用: batch=N 整体时长 ≈ single × N (无并发摊销),ETA 重新校准 (P15 公式失效)。
    //
    // useVary=false (n=1, 单轨手填 lyrics) 走同一 pipeline 但跳过 LLM 步骤,
    // 语义统一: 每首等全好才进下一首。
    if (n > 1 || useVary) {
      // P18-2b 状态计数 (替代原 `for each task: queue → cancelled planned_failed`)
      const theme = useVary
        ? (document.getElementById('llmTheme')?.value?.trim() || state.lyrics.slice(0, 60))
        : null;
      const promptMode = useVary
        ? (readPillGroup(document.getElementById('promptModePills')) || 'random')
        : 'random';
      const locked = useVary
        ? {
            genre: readPillGroup(document.getElementById('genrePills')),
            mood: readPillGroup(document.getElementById('moodPills')),
            vocal: readPillGroup(document.getElementById('vocalPills')),
          }
        : {};

      // 角度数组 (来自 step 1 generateAngles; 失败/falsy 时 pipeline 内 fallback)
      const angleHints = state.production.angles || null;

      for (let i = 0; i < n; i++) {
        if (token !== state.batchToken) {
          // 取消:把剩余 queued → cancelled
          for (let j = i; j < n; j++) {
            const t = state.tasks[j];
            if (t && t.status === 'queued') { t.status = 'cancelled'; t.error = 'cancelled'; }
          }
          renderTaskMini(); renderTaskList(); renderBatchProgress();
          showStatus('已取消。', 'error', 3000);
          return;
        }

        const task = state.tasks[i];

        // Step A: LLM 派生第 i 首 (useVary 才走)
        if (useVary) {
          showStatus(`LLM · ${i + 1}/${n}`, 'loading');
          try {
            const angleHint = (Array.isArray(angleHints) && angleHints[i] && angleHints[i].trim())
              ? `Distinct angle for THIS song only: ${angleHints[i].trim()}\nDo NOT copy imagery or phrasing from any other song in this batch.`
              : (i > 0
                ? `Variation #${i + 1} of ${n}: try a slightly different angle, mood, or imagery while staying true to the theme. Avoid copying earlier verses.`
                : '');
            const pkg = await llm.generateSongPackage({
              theme: angleHint ? `${theme}\n\n${angleHint}` : theme,
              languages: state.llmLangs, targetLen: state.llmTargetLen,
              promptMode, locked, signal: llmAbort.signal,
            });
            task.title  = pkg.title  || `track #${String(i + 1).padStart(2, '0')}`;
            task.lyrics = pkg.lyrics || '';
            task.prompt = pkg.prompt || '';
            renderTaskMini(); renderTaskList();
          } catch (e) {
            if (e.name === 'AbortError') {
              // 取消路径
              for (let j = i; j < n; j++) {
                const t = state.tasks[j];
                if (t && t.status === 'queued') { t.status = 'cancelled'; t.error = 'cancelled'; }
              }
              renderTaskMini(); renderTaskList(); renderBatchProgress();
              showStatus('已取消。', 'error', 3000);
              return;
            }
            // LLM 派生失败:该首标 failed,pipeline 继续到下一首
            task.status = 'failed';
            task.error = `LLM planning: ${e?.message || e}`;
            console.warn(`[pipeline] track ${i} LLM failed:`, e?.message);
            renderTaskMini(); renderTaskList();
            continue;
          }
        }

        // Step B: Music 提交第 i 首 (串行,等这首 audio 拿到才 i++)
        if (token !== state.batchToken) {
          for (let j = i; j < n; j++) {
            const t = state.tasks[j];
            if (t && t.status === 'queued') { t.status = 'cancelled'; t.error = 'cancelled'; }
          }
          renderTaskMini(); renderTaskList(); renderBatchProgress();
          showStatus('已取消。', 'error', 3000);
          return;
        }
        showStatus(
          n > 1 ? `Submitting track ${i + 1}/${n} · music API` : 'Submitting to GMI Cloud · typically 30–60s …',
          'loading'
        );
        try {
          await music.submitOne(task, token);
          NS.events?.fire('task:state', task);
          // P20: 无条件 fire task:success,library listener 是幂等的(只 push 不重复的 doc)
          // 旧守卫 (!activeTaskId || activeTaskId === t.id) 拦掉 batch/retry/resume
          // 让 batch 出来的轨道不写 IDB → Library 看不到
          if (task.status === 'success') {
            NS.events?.fire('task:success', task);
          }
        } catch (e) {
          // submitOne 内部已 catch e 写入 task.status='failed',这里不再处理
          console.warn(`[pipeline] track ${i} submitOne threw (should already be in task.status):`, e?.message);
        }
        renderTaskMini(); renderTaskList(); renderBatchProgress();

        // Step C: 间隙 200ms 避免突发 (与 P10-2 batch 内部 sleep 一致)
        if (i < n - 1) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      // pipeline 结束:总结
      if (token !== state.batchToken) return;
      const ok = state.tasks.filter((t) => t.status === 'success').length;
      const fail = state.tasks.filter((t) => t.status === 'failed').length;
      const cancelled = state.tasks.filter((t) => t.status === 'cancelled').length;
      if (n === 1) {
        const t = state.tasks[0];
        if (t.status === 'success') showStatus('Generated successfully.', 'success', 2500);
        else showStatus(`Request failed · ${t.error || 'unknown'}`, 'error', 6000);
      } else {
        let msg = `Batch complete · ${ok} success`;
        if (fail) msg += `, ${fail} failed`;
        if (cancelled) msg += `, ${cancelled} skipped`;
        showStatus(msg, fail ? 'error' : 'success', 4000);
      }
      const lastOk = [...state.tasks].reverse().find((t) => t.status === 'success');
      if (lastOk) { renderResult(lastOk); renderTaskList(); }
    } else {
      // 旧路径: 单轨且 useVary=false (n=1, 手填 lyrics) → 走 BATCH_CONCURRENCY=3 不必要 (只有 1 首)
      // 保留 submitOne 直接调用,避免引入 retry (旧实现) 但 P18-2a 已把 retry 加进 submitOne 内部
      const summary = 'Submitting to GMI Cloud · typically 30–60s …';
      showStatus(summary, 'loading');
      try {
        await music.submitOne(state.tasks[0], token);
        NS.events?.fire('task:state', state.tasks[0]);
        if (state.tasks[0].status === 'success') {
          // P20: 无条件 fire (library listener 幂等,守卫只会拦掉 batch/retry/resume 写盘)
          NS.events?.fire('task:success', state.tasks[0]);
        }
        if (state.tasks[0].status === 'success') {
          showStatus('Generated successfully.', 'success', 2500);
        } else {
          showStatus(`Request failed · ${state.tasks[0].error || 'unknown'}`, 'error', 6000);
        }
        const lastOk = state.tasks.find((t) => t.status === 'success');
        if (lastOk) { renderResult(lastOk); renderTaskList(); }
      } finally {
        if (token === state.batchToken) {
          renderTaskMini(); renderTaskList(); renderBatchProgress();
          btnGenerate.disabled = false;
          btnGenerate.classList.remove('recording');
          if (batchInput) batchInput.disabled = false;
        }
      }
      return;
    }

    // P18-2b pipeline finally 收尾
    try {
      // (no-op; the loop above handles the whole flow)
    } finally {
      if (token === state.batchToken) {
        renderTaskMini(); renderTaskList(); renderBatchProgress();
        btnGenerate.disabled = false;
        btnGenerate.classList.remove('recording');  // Phase 6 P2: stop LED
        if (batchInput) batchInput.disabled = false;  // Phase 15
      }
    }
  });

  btnCancel.addEventListener('click', () => {
    let cancelledAny = false;
    // Phase 2: 也要中断 LLM 规划阶段
    if (state.llmAbort) {
      try { state.llmAbort.abort(); } catch {}
      state.llmAbort = null;
    }
    state.tasks.forEach((t) => {
      if (t.status === 'queued') {
        t.status = 'cancelled';
        t.error = 'cancelled';
        cancelledAny = true;
      }
    });
    // Phase 4: 取消时同步把 job 标记 cancelled (避免 reload 误判续跑)
    if (state.currentJob && state.currentJob.status === 'active') {
      state.currentJob.status = 'cancelled';
      persistCurrentJob();
    }
    if (cancelledAny) {
      showStatus('Remaining tasks cancelled.', 'loading', 2000);
      renderTaskMini(); renderTaskList(); renderBatchProgress();
    }
  });

  // ── Phase 5: 失败任务一键重试 ─────────────────────
  // 接受任务对象数组 (id 或 {id, idx, title, lyrics, prompt, ...})
  async function retryFailedTasks(taskInputs) {
    if (!Array.isArray(taskInputs) || taskInputs.length === 0) return;
    if (!state.apiKey) { return requireApiKey(); }
    if (state.currentJob && state.currentJob.status === 'active') {
      showStatus('Wait for current batch to finish before retrying.', 'error', 3000);
      return;
    }
    if (!confirm(`Retry ${taskInputs.length} failed track${taskInputs.length > 1 ? 's' : ''}? Music API will be re-called (charges may apply).`)) return;

    // 重建 task 对象 (接受 object 或 string id; 从 state.tasks / library 找)
    const retryTasks = [];
    for (const input of taskInputs) {
      const id = typeof input === 'string' ? input : input.id;
      let t = state.tasks.find((x) => x.id === id);
      if (t) {
        retryTasks.push({ ...t, status: 'queued', progress: 0, error: null,
                          musicError: null, outcome: null, audioUrl: null,
                          musicAttempts: 0, requestId: null, updatedAt: Date.now() });
        continue;
      }
      let doc = state.library.items.find((d) => d.id === id);
      if (typeof input === 'object' && input.title) doc = doc || input;  // 允许 caller 传 object 直接用
      if (doc) {
        retryTasks.push({
          id: doc.id, idx: doc.idx != null ? doc.idx : retryTasks.length,
          status: 'queued', progress: 0, title: doc.title || '',
          lyrics: doc.lyrics || '', prompt: doc.prompt || '',
          audioUrl: null, outcome: null, error: null,
          llmError: null, musicError: null, musicAttempts: 0, llmAttempts: 0,
          favorite: doc.favorite, createdAt: doc.createdAt || Date.now(),
          updatedAt: Date.now(),
        });
        continue;
      }
    }
    if (retryTasks.length === 0) { showStatus('No tasks to retry.', 'error', 2500); return; }

    // 创建新 job
    const job = NS.job.create({
      config: { batchSize: retryTasks.length, retry: true, sourceTaskIds: taskInputs.map((x) => typeof x === 'string' ? x : x.id) },
    });
    job.tasks = retryTasks.map((t) => ({
      id: t.id, idx: t.idx, status: t.status, progress: 0,
      title: t.title || '', lyrics: t.lyrics || '', prompt: t.prompt || '',
      requestId: null, outcome: null, audioUrl: null, error: null,
      startedAt: t.startedAt || job.createdAt,
    }));
    state.currentJob = job;
    state.tasks = retryTasks;
    state.activeTaskId = null;
    NS.library.jobs.put(job.id, job).catch((e) => console.warn('[job] retry-create failed', e));

    // UI
    batchbar.classList.add('active');
    batchSpinner.style.display = '';
    renderTaskMini(); renderTaskList(); renderBatchProgress();
    showStatus(`Retrying ${retryTasks.length} failed track${retryTasks.length > 1 ? 's' : ''}…`, 'loading', 2500);

    const token = ++state.batchToken;
    try {
      await music.runWithConcurrency(retryTasks, BATCH_CONCURRENCY, token);
    } catch (e) {
      console.error('[retry] runWithConcurrency failed', e);
    } finally {
      if (token === state.batchToken) {
        renderTaskMini(); renderTaskList(); renderBatchProgress();
        const ok = retryTasks.filter((t) => t.status === 'success').length;
        showStatus(`Retry complete · ${ok}/${retryTasks.length} ok.`, ok === retryTasks.length ? 'success' : 'loading', 3000);
      }
    }
  }
  root.retryFailedTasks = retryFailedTasks;

  /* ─── Init ───────────────────────────────────────── */

  /* ─── Phase 3: Library (History) 面板 ──────────── */
  state.library = state.library || { items: [], query: '', filter: 'all', selectMode: false, selected: new Set() };

  const lib = NS.library;
  const libSection = document.getElementById('librarySection');
  const libList    = document.getElementById('libList');
  const libEmpty   = document.getElementById('libEmpty');
  const libEmptyText = document.getElementById('libEmptyText');
  const libCount   = document.getElementById('libCount');
  const libSearch  = document.getElementById('libSearch');
  const libSearchClear = document.getElementById('libSearchClear');
  const libTabs    = document.getElementById('libTabs');
  const libFoot    = document.getElementById('libFoot');
  const libSelectBtn  = document.getElementById('libSelectBtn');
  const libSelectBar  = document.getElementById('libSelectBar');
  const libSelectCount = document.getElementById('libSelectCount');
  const libSelectAll   = document.getElementById('libSelectAll');
  const libSelectNone  = document.getElementById('libSelectNone');
  const libSelectCancel = document.getElementById('libSelectCancel');
  const libSelectZip   = document.getElementById('libSelectZip');
  const libSelectFav   = document.getElementById('libSelectFav');
  const libSelectDel   = document.getElementById('libSelectDel');
  const libDelAll  = document.getElementById('libDelAll');

  function fmtRelative(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
    if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
    if (diff < 7 * 86_400_000) return Math.floor(diff / 86_400_000) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  function fmtDur(ms) {
    if (!ms || ms <= 0) return '—';
    const s = Math.round(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  function renderLibraryPanel() {
    if (!lib) return;
    const isTrash = state.library.filter === 'trash';
    const all = (state.library.items || []).slice().sort((a, b) => {
      // Trash view: sort by deletedAt desc (most recently deleted first)
      if (isTrash) return (b.deletedAt || 0) - (a.deletedAt || 0);
      // Active view: hide deleted; sort by createdAt desc (newest first)
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    let filtered;
    if (isTrash) {
      // Trash view: only show deleted items
      filtered = all.filter((d) => d.deletedAt);
      if (state.library.query) {
        const q = state.library.query.toLowerCase();
        filtered = filtered.filter((d) =>
          (d.title && d.title.toLowerCase().includes(q)) ||
          (d.lyrics && d.lyrics.toLowerCase().includes(q)) ||
          (d.prompt && d.prompt.toLowerCase().includes(q)));
      }
    } else {
      filtered = NS.library.search(all, state.library.query).filter((d) => !d.deletedAt);
      if (state.library.filter === 'favorite') filtered = filtered.filter((d) => d.favorite);
    }

    libCount.textContent = isTrash
      ? `${filtered.length} 🗑`
      : state.library.filter === 'favorite'
        ? `${filtered.length} ★`
        : `${filtered.length}`;

    if (all.length === 0) {
      libList.innerHTML = '';
      libEmpty.style.display = '';
      libFoot.style.display = 'none';
      libEmptyText.innerHTML = 'No saved tracks yet.<br>Generated tracks will appear here automatically.';
      libDelAll.textContent = 'Clear all';
      return;
    }
    if (filtered.length === 0) {
      libList.innerHTML = '';
      libEmpty.style.display = '';
      libFoot.style.display = '';
      libEmptyText.innerHTML = isTrash
        ? 'Trash is empty.<br>Deleted items appear here for 30 days.'
        : state.library.filter === 'favorite'
          ? 'No favorites yet.<br>Click ★ on any track to save it here.'
          : `No matches for “${escapeHtml(state.library.query)}”.`;
      libDelAll.textContent = isTrash ? 'Empty trash' : 'Clear all';
      return;
    }
    libEmpty.style.display = 'none';
    libFoot.style.display = '';
    libDelAll.textContent = isTrash ? 'Empty trash' : 'Clear all';

    libList.innerHTML = filtered.map((d) => {
      const idx = String(d.idx != null ? d.idx + 1 : '').padStart(2, '0');
      const title = d.title || (d.prompt ? d.prompt.slice(0, 32) : `track ${idx}`);
      let sub;
      if (isTrash) {
        // Trash sub: "Deleted 3d ago · expires in 27d"
        const ageMs = Date.now() - (d.deletedAt || 0);
        const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
        const ageStr = ageDays === 0 ? 'today' : `${ageDays}d ago`;
        const remaining = Math.max(0, Math.ceil((NS.library.TRASH_TTL_MS - ageMs) / (24 * 60 * 60 * 1000)));
        sub = `Deleted ${ageStr} · expires in ${remaining}d`;
      } else if (d.status === 'failed') {
        sub = `failed · ${(d.error || 'unknown error').slice(0, 40)}`;
      } else {
        sub = [
            d.format ? d.format.toUpperCase() : 'mp3',
            d.durationMs ? fmtDur(d.durationMs) : '',
            d.sampleRate ? Math.round(d.sampleRate / 1000) + 'k' : '',
            fmtRelative(d.createdAt),
          ].filter(Boolean).join(' · ');
      }
      const favOn = d.favorite ? ' on' : '';
      const isDeleted = !!d.deletedAt;
      const inSelect = state.library.selectMode;
      const isSelected = state.library.selected.has(d.id);
      // Phase 5 P3: select mode hides per-item actions; checkbox in front
      // Phase 6 P0: success-only download (audio + same-basename lyrics .txt)
      const canDownload = d.status === 'success';
      const actions = inSelect ? '' : (isTrash
        ? `<button type="button" class="lib-restore" data-act="restore" data-lib-id="${escapeHtml(d.id)}" aria-label="Restore" title="Restore from trash">↶</button>
           <button type="button" class="lib-purge" data-act="purge" data-lib-id="${escapeHtml(d.id)}" aria-label="Delete permanently" title="Delete permanently">×</button>`
        : `<button type="button" class="lib-play" data-act="play" data-lib-id="${escapeHtml(d.id)}" aria-label="Play this track" title="Play this track"${(d.status === 'success' && d.audioBlob) ? '' : ' style="display:none"'}>▶</button>
           <button type="button" class="lib-fav${favOn}" data-act="fav" data-lib-id="${escapeHtml(d.id)}" aria-label="Toggle favorite" title="Favorite">★</button>
           <button type="button" class="lib-dl" data-act="dl" data-lib-id="${escapeHtml(d.id)}" aria-label="Download audio + lyrics" title="Download audio + lyrics"${canDownload ? '' : ' style="display:none"'}>↓</button>
           <button type="button" class="lib-retry" data-act="retry" data-lib-id="${escapeHtml(d.id)}" aria-label="Retry generation" title="Retry generation"${d.status === 'failed' ? '' : ' style="display:none"'}>↻</button>
           <button type="button" class="lib-del" data-act="del" data-lib-id="${escapeHtml(d.id)}" aria-label="Delete" title="Move to trash">×</button>`);
      const checkbox = inSelect
        ? `<span class="lib-check${isSelected ? ' checked' : ''}" data-act="check" data-lib-id="${escapeHtml(d.id)}" role="checkbox" aria-checked="${isSelected}" tabindex="0" aria-label="Select ${escapeHtml(title)}">${isSelected ? '✓' : ''}</span>`
        : '';
      const actionsEl = actions ? `<div class="lib-actions">${actions}</div>` : '';
      const itemCls = `lib-item${d.favorite && !isTrash ? ' favorite' : ''}${d.status === 'failed' ? ' failed' : ''}${isDeleted ? ' trashed' : ''}${inSelect ? ' select-mode' : ''}${isSelected ? ' selected' : ''}`;
      const ariaLabel = inSelect
        ? (isSelected ? 'Deselect ' : 'Select ') + escapeHtml(title)
        : (isTrash ? 'Restore ' : 'Replay ') + escapeHtml(title);
      return `
        <div class="${itemCls}" data-lib-id="${escapeHtml(d.id)}" tabindex="0" role="button" aria-label="${ariaLabel}">
          ${checkbox}
          <span class="lib-idx">${idx}</span>
          <div class="lib-body">
            <div class="lib-title">${escapeHtml(title)}</div>
            <div class="lib-sub"><span>${escapeHtml(sub)}</span></div>
          </div>
          ${actionsEl}
        </div>`;
    }).join('');
  }

  // 搜索输入 (debounce 用同步即可,数据 < 100)
  libSearch?.addEventListener('input', (e) => {
    state.library.query = e.target.value;
    libSearchClear.style.display = e.target.value ? 'grid' : 'none';
    renderLibraryPanel();
  });
  libSearchClear?.addEventListener('click', () => {
    libSearch.value = '';
    state.library.query = '';
    libSearchClear.style.display = 'none';
    renderLibraryPanel();
    libSearch.focus();
  });
  libTabs?.addEventListener('click', (e) => {
    const btn = e.target.closest('.lib-tab');
    if (!btn) return;
    libTabs.querySelectorAll('.lib-tab').forEach((t) => t.classList.remove('selected'));
    btn.classList.add('selected');
    state.library.filter = btn.dataset.filter || 'all';
    // switching filter drops select mode (otherwise state feels weird)
    if (state.library.selectMode) setSelectMode(false);
    renderLibraryPanel();
  });

  // ── Phase 5: Export 按钮 handlers ─────────────────────
  function downloadBlob(content, filename, mime, withBOM) {
    // P22-3: content 可能是 Blob(来自 exportTrack / fetchAudioViaProxy),
    //         直接用,不要再 Blob-wrapping,否则 .toString() 会变成 "[object Blob]" 几字节
    const blob = (content instanceof Blob)
      ? content
      : new Blob([(withBOM ? '\ufeff' : '') + content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }
  function stampName(ext) {
    return 'minimax-library-' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.' + ext;
  }
  const libExportJSON = document.getElementById('libExportJSON');
  const libExportCSV  = document.getElementById('libExportCSV');
  libExportJSON?.addEventListener('click', async () => {
    const total = state.library.items.length;
    if (!total) { showStatus('Library is empty.', 'error', 2000); return; }
    try {
      const json = await lib.exportJSON();
      downloadBlob(json, stampName('json'), 'application/json', false);
      showStatus(`Exported ${total} track${total > 1 ? 's' : ''} as JSON.`, 'success', 2200);
    } catch (e) {
      showStatus('Export failed: ' + (e?.message || e), 'error', 3000);
    }
  });
  libExportCSV?.addEventListener('click', async () => {
    const total = state.library.items.length;
    if (!total) { showStatus('Library is empty.', 'error', 2000); return; }
    try {
      const csv = await lib.exportCSV();
      downloadBlob(csv, stampName('csv'), 'text/csv;charset=utf-8', true);  // BOM for Excel
      showStatus(`Exported ${total} track${total > 1 ? 's' : ''} as CSV.`, 'success', 2200);
    } catch (e) {
      showStatus('Export failed: ' + (e?.message || e), 'error', 3000);
    }
  });

  // 列表事件代理:check / replay / favorite / delete / retry / restore / purge / download
  libList?.addEventListener('click', async (e) => {
    const checkBtn   = e.target.closest('[data-act="check"]');
    const favBtn     = e.target.closest('[data-act="fav"]');
    const delBtn     = e.target.closest('[data-act="del"]');
    const retryBtn   = e.target.closest('[data-act="retry"]');
    const restoreBtn = e.target.closest('[data-act="restore"]');
    const purgeBtn   = e.target.closest('[data-act="purge"]');
    const dlBtn      = e.target.closest('[data-act="dl"]');
    const playBtn    = e.target.closest('[data-act="play"]');
    const item       = e.target.closest('.lib-item');
    const id         = (checkBtn || favBtn || delBtn || retryBtn || restoreBtn || purgeBtn || dlBtn || playBtn || item)?.dataset?.libId;
    if (checkBtn) {
      e.stopPropagation();
      if (state.library.selected.has(id)) state.library.selected.delete(id);
      else state.library.selected.add(id);
      updateSelectCount();
      renderLibraryPanel();
      return;
    }
    // Phase 5 P3: in select mode, item click toggles selection
    if (state.library.selectMode && item) {
      e.stopPropagation();
      if (state.library.selected.has(id)) state.library.selected.delete(id);
      else state.library.selected.add(id);
      updateSelectCount();
      renderLibraryPanel();
      return;
    }
    if (!id) return;
    if (retryBtn) {
      e.stopPropagation();
      const doc = state.library.items.find((d) => d.id === id);
      if (!doc) return;
      // 同步把失败 doc 从 library items 中删除 (重试成功后会产生新 success doc)
      state.library.items = state.library.items.filter((d) => d.id !== id);
      lib.metadata.del(id).catch(() => {});
      renderLibraryPanel();
      // 把 doc 传给 retryFailedTasks, 避免它在 items 找不到
      retryFailedTasks([{ id: doc.id, idx: doc.idx, title: doc.title, lyrics: doc.lyrics, prompt: doc.prompt, favorite: doc.favorite, createdAt: doc.createdAt }]);
      return;
    }
    if (favBtn) {
      e.stopPropagation();
      const doc = state.library.items.find((d) => d.id === id);
      if (!doc) return;
      doc.favorite = !doc.favorite;
      lib.metadata.put(id, doc).catch((e2) => console.warn('[library] fav put failed', e2));
      renderLibraryPanel();
      return;
    }
    if (delBtn) {
      e.stopPropagation();
      const doc = state.library.items.find((d) => d.id === id);
      if (!doc) return;
      // favorite filter 下删除收藏项 → 自动回 all filter,避免空白
      if (state.library.filter === 'favorite' && doc.favorite) {
        state.library.filter = 'all';
        libTabs.querySelectorAll('.lib-tab').forEach((t) => {
          t.classList.toggle('selected', t.dataset.filter === 'all');
        });
      }
      // Phase 5 P2: 软删除 (移到 trash, 30 天后自动清)
      doc.deletedAt = Date.now();
      lib.metadata.put(id, doc).catch((e2) => console.warn('[library] soft-delete put failed', e2));
      state.library.items = state.library.items.filter((d) => d.id !== id);
      renderLibraryPanel();
      showStatus(`Moved to Trash · restores within 30 days.`, 'loading', 2500);
      return;
    }
    if (restoreBtn) {
      e.stopPropagation();
      const doc = state.library.items.find((d) => d.id === id);
      if (!doc) return;
      doc.deletedAt = null;
      lib.metadata.put(id, doc).catch((e2) => console.warn('[library] restore put failed', e2));
      state.library.items = state.library.items.filter((d) => d.id !== id);
      renderLibraryPanel();
      showStatus('Restored from Trash.', 'success', 2000);
      return;
    }
    if (purgeBtn) {
      e.stopPropagation();
      const doc = state.library.items.find((d) => d.id === id);
      if (!doc) return;
      if (!confirm(`Permanently delete "${doc.title || doc.id}"? This cannot be undone.`)) return;
      lib.metadata.del(id).catch((e2) => console.warn('[library] purge failed', e2));
      state.library.items = state.library.items.filter((d) => d.id !== id);
      renderLibraryPanel();
      showStatus('Permanently deleted.', 'loading', 2000);
      return;
    }
    if (playBtn) {
      // Phase 14: Library 行内 ▶ 播放按钮 — 直接 set audio src from doc.audioBlob/audioUrl
      // 不动 textarea / state.lyrics / state.prompt(那是 replay 干的事)
      e.stopPropagation();
      const doc = state.library.items.find((d) => d.id === id);
      if (!doc || doc.status !== 'success') return;
      if (!doc.audioBlob && !doc.audioUrl) {
        showStatus('No audio cached for this track.', 'error', 2200);
        return;
      }
      // Phase 22: reveal 曲目面板(切 emptyState→resultBox + 填元数据),否则 src 设了也看不见
      _showResultForDoc(doc);
      _setAudioSrc(doc.audioBlob || null, doc.audioUrl || null);
      // best-effort autoplay;浏览器策略失败时静默,用户点 audioEl 控件可继续
      const audio = document.getElementById('audioEl');
      audio?.play?.().catch(() => { /* autoplay blocked — ignore */ });
      showStatus(`▶ ${doc.title || 'track ' + ((doc.idx ?? 0) + 1)}`, 'success', 1500);
      return;
    }
    if (dlBtn) {
      // Phase 6 P0: single-track download (audio + same-basename lyrics .txt)
      e.stopPropagation();
      const doc = state.library.items.find((d) => d.id === id);
      if (!doc) return;
      if (doc.status !== 'success') {
        showStatus('Only completed tracks can be downloaded.', 'error', 2200);
        return;
      }
      showStatus(`Preparing "${doc.title || id}"…`, 'loading', 1500);
      try {
        const payload = await lib.exportTrack(id);
        let count = 0;
        if (payload.audio) {
          downloadBlob(payload.audio.blob, payload.audio.name, payload.audio.mime, false);
          count++;
        }
        if (payload.lyrics) {
          downloadBlob(payload.lyrics.text, payload.lyrics.name, payload.lyrics.mime, false);
          count++;
        }
        if (count === 0) {
          showStatus('Nothing to download for this track.', 'error', 2200);
        } else {
          const hasLyrics = payload.lyrics ? ' + lyrics' : '';
          showStatus(`Downloaded ${doc.title || id}${hasLyrics}.`, 'success', 2200);
        }
      } catch (err) {
        showStatus('Download failed: ' + (err?.message || err), 'error', 3000);
      }
      return;
    }
    if (item) {
      // replay: 把 lyrics/prompt 灌回 textareas, 不自动 submit
      const doc = state.library.items.find((d) => d.id === id);
      if (!doc) return;
      lyricsEl.value = doc.lyrics || '';
      promptEl.value = doc.prompt || '';
      state.lyrics = doc.lyrics || '';
      state.prompt = doc.prompt || '';
      updateCount();
      // 滚动到顶部 (让用户看到 textarea 已填好,再决定 Generate)
      document.querySelector('.main')?.scrollTo?.({ top: 0, behavior: 'smooth' });
      // Phase 22: 同时把 audio 塞进"曲目"面板 — 不自动放,让用户手点 ▶ / 下载。
      // 跟 playBtn 范式一致(set src),但省略 .play() 避免侵入式出声,跟用户
      // "点行 = 想改 prompt 再 submit"的预期不冲突。
      if (doc.status === 'success' && (doc.audioBlob || doc.audioUrl)) {
        _showResultForDoc(doc);
        _setAudioSrc(doc.audioBlob || null, doc.audioUrl || null);
      }
      const showTitle = doc.title || 'track ' + (doc.idx + 1);
      const tail = (doc.status === 'success' && (doc.audioBlob || doc.audioUrl)) ? ' · audio ready' : '';
      showStatus(`Loaded from history · ${showTitle}${tail}`, 'success', 2200);
    }
  });

  // 键盘:Enter on lib-item 触发 replay
  libList?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const item = e.target.closest('.lib-item');
      if (!item) return;
      e.preventDefault();
      item.click();
    }
  });

  // Clear all / Empty trash (二次确认)
  libDelAll?.addEventListener('click', async () => {
    const isTrash = state.library.filter === 'trash';
    const items = (state.library.items || []).filter((d) => isTrash ? !!d.deletedAt : !d.deletedAt);
    const total = items.length;
    if (!total) return;
    if (isTrash) {
      if (!confirm(`Permanently delete ${total} trash item${total > 1 ? 's' : ''}? This cannot be undone.`)) return;
      // 真删 (绕过软删除)
      await Promise.all(items.map((d) => lib.metadata.del(d.id).catch((e) => console.warn('[library] trash purge failed', e))));
      state.library.items = state.library.items.filter((d) => !!d.deletedAt && !items.find((x) => x.id === d.id));
      renderLibraryPanel();
      showStatus(`Trash emptied (${total} item${total > 1 ? 's' : ''} permanently deleted).`, 'success', 2000);
    } else {
      if (!confirm(`Move all ${total} saved track${total > 1 ? 's' : ''} to Trash? Restorable for 30 days.`)) return;
      const now = Date.now();
      await Promise.all(items.map((d) => {
        d.deletedAt = now;
        return lib.metadata.put(d.id, d).catch((e) => console.warn('[library] soft-delete put failed', e));
      }));
      state.library.items = state.library.items.filter((d) => !d.deletedAt);
      renderLibraryPanel();
      showStatus(`Moved ${total} track${total > 1 ? 's' : ''} to Trash.`, 'success', 2200);
    }
  });

  // ── Phase 5 P3: Multi-select 模式 (checkbox + bulk actions) ──
  function setSelectMode(on) {
    state.library.selectMode = !!on;
    if (!on) state.library.selected = new Set();
    // libSelectBtn 显示/隐藏 (在 select mode 时隐藏)
    if (libSelectBtn) libSelectBtn.style.display = on ? 'none' : '';
    if (libSelectBar) libSelectBar.style.display = on ? '' : 'none';
    updateSelectCount();
    renderLibraryPanel();
  }
  function updateSelectCount() {
    if (!libSelectCount) return;
    const n = state.library.selected.size;
    libSelectCount.textContent = n === 0 ? 'Select tracks' : `${n} selected`;
    // disable bulk buttons if 0 selected
    if (libSelectZip) libSelectZip.disabled = n === 0;
    if (libSelectFav) libSelectFav.disabled = n === 0;
    if (libSelectDel) libSelectDel.disabled = n === 0;
  }

  libSelectBtn?.addEventListener('click', () => setSelectMode(true));
  libSelectCancel?.addEventListener('click', () => setSelectMode(false));
  libSelectAll?.addEventListener('click', () => {
    // select all in current filtered view (skip trashed items)
    const isTrash = state.library.filter === 'trash';
    if (isTrash) return;
    const items = document.querySelectorAll('.lib-item:not(.trashed)');
    for (const el of items) {
      const id = el.dataset.libId;
      if (id) state.library.selected.add(id);
    }
    updateSelectCount();
    renderLibraryPanel();
  });
  libSelectNone?.addEventListener('click', () => {
    state.library.selected = new Set();
    updateSelectCount();
    renderLibraryPanel();
  });
  libSelectZip?.addEventListener('click', async () => {
    const ids = [...state.library.selected];
    if (ids.length === 0) return;
    showStatus(`Building ZIP (${ids.length} track${ids.length > 1 ? 's' : ''})…`, 'loading', 2000);
    try {
      const blob = await lib.exportZip(ids);
      const fname = 'minimax-library-' + ids.length + 'tracks-' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.zip';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
      showStatus(`Downloaded ${ids.length} track${ids.length > 1 ? 's' : ''} as ZIP.`, 'success', 2500);
    } catch (e) {
      showStatus('ZIP export failed: ' + (e?.message || e), 'error', 3000);
    }
  });
  libSelectFav?.addEventListener('click', async () => {
    const ids = [...state.library.selected];
    if (ids.length === 0) return;
    const ops = ids.map((id) => {
      const d = state.library.items.find((x) => x.id === id);
      if (!d) return Promise.resolve();
      d.favorite = !d.favorite;   // toggle (bulk: invert to "all-fav" if mixed)
      return lib.metadata.put(id, d).catch((e) => console.warn('[library] fav put failed', e));
    });
    await Promise.all(ops);
    showStatus(`Toggled favorite on ${ids.length} track${ids.length > 1 ? 's' : ''}.`, 'success', 1800);
    renderLibraryPanel();
  });
  libSelectDel?.addEventListener('click', async () => {
    const ids = [...state.library.selected];
    if (ids.length === 0) return;
    if (!confirm(`Move ${ids.length} track${ids.length > 1 ? 's' : ''} to Trash? Restorable for 30 days.`)) return;
    const now = Date.now();
    await Promise.all(ids.map((id) => {
      const d = state.library.items.find((x) => x.id === id);
      if (!d) return Promise.resolve();
      d.deletedAt = now;
      return lib.metadata.put(id, d).catch((e) => console.warn('[library] bulk soft-delete failed', e));
    }));
    state.library.items = state.library.items.filter((d) => !d.deletedAt);
    state.library.selected = new Set();
    updateSelectCount();
    showStatus(`Moved ${ids.length} track${ids.length > 1 ? 's' : ''} to Trash.`, 'success', 2200);
    renderLibraryPanel();
  });

  /* ─── Phase 4: Resume banner + 续跑流程 ────────── */
  const resumebar   = document.getElementById('resumebar');
  const resumeSummary = document.getElementById('resumeSummary');
  const resumeMeta  = document.getElementById('resumeMeta');
  const btnResumeNow = document.getElementById('btnResumeNow');
  const btnResumeDiscard = document.getElementById('btnResumeDiscard');

  // 把一个从 IDB 恢复的 job 反映到 banner 上 (只展示,不启动)
  function showResumeBanner(job) {
    if (!resumebar || !job || !NS.job) return;
    const summary = NS.job.summarize(job);
    resumeSummary.textContent =
      `${summary.done}/${summary.total} done (${summary.ok} ok, ${summary.err} failed, ${summary.skip} skipped) · ${summary.live} to go`;
    const ageMin = Math.max(0, Math.round((Date.now() - (job.updatedAt || job.createdAt)) / 60000));
    resumeMeta.textContent = ageMin < 1 ? 'just now' : (ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`);
    resumebar.classList.add('active');
    btnResumeNow.disabled = false;
    btnResumeNow.textContent = 'Resume';
  }
  function hideResumeBanner() {
    if (!resumebar) return;
    resumebar.classList.remove('active');
    state.pendingResumeJobId = null;
  }

  // 实际启动续跑:把 tasks 灌回 state.tasks,然后调 runWithConcurrency
  async function executeResume(job) {
    if (!job || !NS.job || !NS.library || !music) return;
    const tasks = NS.job.reorderForResume(job);
    if (!tasks.length) { hideResumeBanner(); return; }
    // 已经被 abort 的 controller 失效,这里重建;状态保留 (running/queued)
    tasks.forEach((t) => { t.controller = null; });
    state.tasks = tasks;
    state.activeTaskId = null;
    state.currentJob = job;  // 续用旧 job (id 不变),更新时走 persistCurrentJob
    state.pendingResumeJobId = null;

    // UI 立即反映
    batchbar.classList.add('active');
    batchSpinner.style.display = '';
    renderTaskMini(); renderTaskList(); renderBatchProgress();
    hideResumeBanner();
    showStatus(`Resumed ${tasks.length} tracks from previous session.`, 'loading', 2200);

    // 派一个全新的 token + 复用现有并发 runner
    const token = ++state.batchToken;
    btnResumeNow.disabled = true;
    try {
      await music.runWithConcurrency(state.tasks, BATCH_CONCURRENCY, token);
      if (token !== state.batchToken) return;
      const ok = state.tasks.filter((t) => t.status === 'success').length;
      const fail = state.tasks.filter((t) => t.status === 'failed').length;
      const skip = state.tasks.filter((t) => t.status === 'cancelled').length;
      const summary = `Resume complete · ${ok} ok` + (fail ? `, ${fail} failed` : '') + (skip ? `, ${skip} skipped` : '');
      showStatus(summary, fail ? 'error' : 'success', 4000);
      const lastOk = [...state.tasks].reverse().find((t) => t.status === 'success');
      if (lastOk) { renderResult(lastOk); renderTaskList(); }
    } finally {
      if (token === state.batchToken) {
        renderTaskMini(); renderTaskList(); renderBatchProgress();
        btnResumeNow.disabled = false;
      }
    }
  }

  btnResumeNow?.addEventListener('click', async () => {
    const id = state.pendingResumeJobId;
    if (!id || !NS.library) return;
    const job = await NS.library.jobs.get(id);
    if (!job) { hideResumeBanner(); showStatus('Resume target not found.', 'error', 2500); return; }
    await executeResume(job);
  });

  btnResumeDiscard?.addEventListener('click', async () => {
    const id = state.pendingResumeJobId;
    if (!id || !NS.library) { hideResumeBanner(); return; }
    if (!confirm('Discard the unfinished batch? Already-saved tracks will stay in History; only the unfinished part is dropped.')) return;
    // 把 job 标记 cancelled (避免再次显示 banner),然后从 IDB 删除
    const job = await NS.library.jobs.get(id);
    if (job) {
      job.status = 'cancelled';
      await NS.library.jobs.put(id, job).catch(() => {});
      await NS.library.jobs.del(id).catch(() => {});
    }
    hideResumeBanner();
    showStatus('Unfinished batch discarded.', 'loading', 1800);
  });

  // 启动时检查是否有 active job 可续跑
  async function checkForResumableJob() {
    if (!NS.library || !NS.job) return;
    try {
      const job = await NS.library.jobs.getActive();
      if (!job || !NS.job.isResumable(job)) return;
      // 已经有进行中的 batch (用户没刷新,只是切回页面) → 不打扰
      if (state.currentJob && state.currentJob.status === 'active') return;
      state.pendingResumeJobId = job.id;
      showResumeBanner(job);
    } catch (e) {
      console.warn('[resume] check failed', e);
    }
  }

  function init() {
    initSelects();
    initTagBar();
    // Phase 23: jobs-rail 的 "Resume" 按钮 → 复用现成 resume 协议
    // (沿用 checkForResumableJob / showResumeBanner 路径,避免再写一份续跑流程)
    NS.events.on('job:resume-request', (job) => {
      if (!job || !NS.library) return;
      // 如果 checkForResumableJob 已显示过 banner,只 set pendingResumeJobId
      state.pendingResumeJobId = job.id;
      showResumeBanner(job);
    });
    // Phase 7 P5: wire language toggle button. cycle() in i18n.js
    // re-applies all data-i18n elements and dispatches i18n:change so
    // dynamic UI (key chip, toasts, status) updates too.
    const langBtn = document.getElementById('langToggle');
    if (langBtn) {
      langBtn.addEventListener('click', () => {
        if (root.MusicStudioI18n) root.MusicStudioI18n.cycle();
      });
    }
    // 同步 UI ↔ state (core.js 已从 localStorage 恢复,这里只 reflect 到 DOM)
    // Phase 7: API key input is gone — chip in head-actions reflects state.apiKey.
    refreshKeyChip();
    document.getElementById('lyrics').value = state.lyrics;
    document.getElementById('prompt').value = state.prompt;
    document.querySelectorAll('.select').forEach((sel) => {
      const target = sel.dataset.target;
      const label = sel.querySelector('.label');
      if (target === 'sampleRate') label.textContent = String(state.sampleRate);
      if (target === 'bitrate')    label.textContent = String(state.bitrate);
      if (target === 'format')     label.textContent = state.format;
      // 高亮 selected
      const v = String(state[target]);
      sel.querySelectorAll('.opt').forEach((o) => {
        o.classList.toggle('selected', o.dataset.value === v);
      });
    });
    updateCount();
    updateCost();
    updateBatchControls();
    // Phase 6 P6.1: ensure VU meter is built (8 seg × 2 ch) on first paint,
    // even if the user hasn't started a batch yet. Without this the box
    // looks empty until the first renderBatchProgress event fires.
    if (vuMeter && !vuMeter._vuInit) {
      vuMeter.querySelectorAll('.vu-segments').forEach((row) => {
        for (let i = 0; i < 8; i++) {
          const seg = document.createElement('div');
          seg.className = 'seg';
          row.appendChild(seg);
        }
      });
      vuMeter._vuInit = true;
      vuMeter.classList.add('idle');
    }
    // Phase 1: 同步 lang pills (state.llmLangs → DOM)
    const langGrp = document.getElementById('langPills');
    if (langGrp && Array.isArray(state.llmLangs)) {
      langGrp.querySelectorAll('.pill').forEach((p) => {
        p.classList.toggle('selected', state.llmLangs.includes(p.dataset.val));
      });
    }
    // Phase 3: 还原 library (从 IDB 拉到内存,再渲染)
    if (lib) {
      lib.metadata.list().then((docs) => {
        state.library.items = Array.isArray(docs) ? docs : [];
        renderLibraryPanel();
      }).catch((e) => console.warn('[library] list failed', e));
    }
    // Phase 4: 检查是否需要续跑
    checkForResumableJob();

    // Phase 23: 挂载 jobs-rail(接管左侧"历史任务"侧栏)
    if (NS.jobsRail) {
      NS.jobsRail.mount({
        setAudioSrc: (blob, url) => _setAudioSrc(blob, url),
        loadFormFromTask: (t) => _loadTaskIntoForm(t),
      });
    }

    // Phase 7 P1: if we just returned from settings (settings_return_to=studio
    // flag), focus the lyrics textarea so the user can keep working.
    if (sessionStorage.getItem('settings_return_to') === 'studio') {
      sessionStorage.removeItem('settings_return_to');
      setTimeout(() => {
        const el = document.getElementById('lyrics') || document.getElementById('prompt');
        if (el) el.focus();
      }, 200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('[MusicStudio] app loaded');
})(window);
