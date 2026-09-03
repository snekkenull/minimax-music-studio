/* ===========================================================
 * core.js  ·  Phase 0
 * ------------------------------------------------------------
 * 全局命名空间 + state 单例 + localStorage 桥接
 * 不引入任何 DOM 绑定 / 业务逻辑,只负责「状态 + 跨模块数据」
 * =========================================================== */
(function (root) {
  'use strict';

  // 防止重复加载
  if (root.MusicStudio) return;

  // ── 命名空间 ─────────────────────────────────────────
  const NS = root.MusicStudio = {
    version: '0.1.0-phase0',
    modules: {},
    register(name, api) {
      this.modules[name] = api;
      this[name] = api;
    },
  };

  // ── 状态单例 ─────────────────────────────────────────
  // 保持与旧代码完全一致:window.state 仍是可变全局
  const state = {
    apiKey: '',
    title: '',  // Phase 12: LLM-generated song title (filled by Apply); batch 启动时给 task 当 fallback
    lyrics: '',
    prompt: '',
    sampleRate: 44100,
    bitrate: 256000,
    format: 'mp3',
    audioUrl: null,
    outcome: null,
    batchSize: 1,
    tasks: [],
    activeTaskId: null,
    batchToken: 0,
    // Phase 1: LLM form state (UI 临时,刷新可丢;但 lang/targetLen 我们持久化)
    llmTargetLen: 600,
    llmLangs: ['zh'],  // default 中文 first
    // Phase 2: 批量变体 toggle (开则每首独立 lyrics+prompt;关则共享 textarea 内容)
    llmBatchVary: false,
    // Phase 4: 续跑相关 (由 app.js 设置,这里只占位保证存在性)
    currentJob: null,
    pendingResumeJobId: null,
    // Phase 8 (P7): 批量生产线 — 3 个轴各自的 mode (locked/random/forbidden)
    // 当 production tab 启用时,会按 (axisMode + 已选 pill) 决定每首的 prompt 风格
    production: {
      axisMode: ['random', 'random', 'random'],  // [genre, mood, vocal]
      angles: [],  // runtime: T3 派生 N 个独立角度,启动后填充
      bypassLyricsCheck: false,  // Phase 17: 生产面板走 LLM 派生,跳过 validate() 的 lyrics 校验
    },
  };
  root.state = state;

  // ── localStorage 键名常量 (集中放这里便于以后改) ───
  const LS_KEYS = {
    apiKey: 'gmicloud_music_apikey',
    batchSize: 'gmicloud_music_batchsize',
    sampleRate: 'gmicloud_music_samplerate',
    bitrate: 'gmicloud_music_bitrate',
    format: 'gmicloud_music_format',
    llmModel: 'gmicloud_music_llmmodel',  // Phase 1 启用
    llmTargetLen: 'gmicloud_music_llm_targetlen',
    llmLangs: 'gmicloud_music_llm_langs',
    llmBatchVary: 'gmicloud_music_llm_batchvary',  // Phase 2 启用
    // Phase 8 (P7): 生产线 axis mode — 持久 [genre, mood, vocal] mode (locked/random/forbidden)
    productionAxisMode: 'gmicloud_music_production_axis',
    // Phase 7: Settings page — model selectors + URL endpoints
    musicModel: 'gmicloud_music_model',          // 音乐生成 model id (e.g. minimax-music-3.0)
    musicApiUrl: 'gmicloud_music_apiurl',        // 音乐 API base (proxy-relative path; user rarely overrides)
    llmApiUrl: 'gmicloud_music_llm_apiurl',      // LLM API base (override e.g. for self-hosted gateway)
    // Phase 10 (P10-1): user-supplied custom model ids. Non-empty string overrides
    // musicModel/llmModel from the dropdown. Empty / unset → fall back to dropdown value.
    customMusicModel: 'gmicloud_music_custommodel',
    customLlmModel:   'gmicloud_music_custom_llmmodel',
  };

  // Phase 7: hardcoded defaults kept here so music.js / llm.js can import the
  // same source of truth. Settings page uses these for "Reset" and the
  // dropdown defaults. DO NOT delete without updating music.js / llm.js.
  const DEFAULTS = {
    musicModel: 'minimax-music-3.0',
    musicApiUrl: '/api/v1/ie/requestqueue/apikey/requests',  // proxy-relative (CORS solved by proxy.js)
    llmApiUrl: 'https://api.gmi-serving.com/v1/chat/completions',
    llmModel: 'MiniMaxAI/MiniMax-M2.7',
  };

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function lsSet(key, val) {
    try { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch {}
  }

  // ── 启动时恢复用户偏好 ─────────────────────────────
  function hydrate() {
    const k = lsGet(LS_KEYS.apiKey);
    if (k) state.apiKey = k;
    const bs = parseInt(lsGet(LS_KEYS.batchSize) || '1', 10);
    if (bs >= 1 && bs <= 100) state.batchSize = bs;
    const sr = parseInt(lsGet(LS_KEYS.sampleRate) || '44100', 10);
    if (sr) state.sampleRate = sr;
    const br = parseInt(lsGet(LS_KEYS.bitrate) || '256000', 10);
    if (br) state.bitrate = br;
    const fmt = lsGet(LS_KEYS.format);
    if (fmt === 'mp3' || fmt === 'wav' || fmt === 'flac') state.format = fmt;
    // Phase 1: LLM form restore
    const tl = parseInt(lsGet(LS_KEYS.llmTargetLen) || '600', 10);
    if (tl === 400 || tl === 600 || tl === 900) state.llmTargetLen = tl;
    try {
      const langs = JSON.parse(lsGet(LS_KEYS.llmLangs) || '["zh"]');
      if (Array.isArray(langs) && langs.every((l) => ['en','zh','ja','ko','es'].includes(l))) {
        state.llmLangs = langs;
      }
    } catch {}
    // Phase 2: 批量变体 toggle
    const bv = lsGet(LS_KEYS.llmBatchVary);
    if (bv === '1' || bv === '0') state.llmBatchVary = bv === '1';
    // Phase 8 (P7): 生产线 axis mode 持久
    try {
      const am = JSON.parse(lsGet(LS_KEYS.productionAxisMode) || '["random","random","random"]');
      if (Array.isArray(am) && am.length === 3
          && am.every((m) => ['locked','random','forbidden'].includes(m))) {
        state.production.axisMode = am;
      }
    } catch {}
  }
  hydrate();

  // ── 持久化 helper (供 UI 模块调用) ─────────────────
  NS.persist = {
    setApiKey: (k) => { state.apiKey = (k || '').trim(); lsSet(LS_KEYS.apiKey, state.apiKey); },
    setBatchSize: (n) => { state.batchSize = n; lsSet(LS_KEYS.batchSize, String(n)); },
    setSampleRate: (n) => { state.sampleRate = n; lsSet(LS_KEYS.sampleRate, String(n)); },
    setBitrate: (n) => { state.bitrate = n; lsSet(LS_KEYS.bitrate, String(n)); },
    setFormat: (f) => { state.format = f; lsSet(LS_KEYS.format, f); },
    setLlmModel: (m) => { lsSet(LS_KEYS.llmModel, m); },
    getLlmModel: () => {
      // Phase 10 (P10-1): custom (non-empty) wins over dropdown value.
      const custom = lsGet(LS_KEYS.customLlmModel);
      if (custom && custom.trim()) return custom.trim();
      return lsGet(LS_KEYS.llmModel) || DEFAULTS.llmModel;
    },
    setLlmTargetLen: (n) => { state.llmTargetLen = n; lsSet(LS_KEYS.llmTargetLen, String(n)); },
    setLlmLangs: (arr) => { state.llmLangs = arr; lsSet(LS_KEYS.llmLangs, JSON.stringify(arr)); },
    setLlmBatchVary: (b) => { state.llmBatchVary = !!b; lsSet(LS_KEYS.llmBatchVary, b ? '1' : '0'); },
    // Phase 8 (P7): 生产线 axis mode — [genre, mood, vocal] 各自 locked/random/forbidden
    setProductionAxisMode: (arr) => {
      if (!Array.isArray(arr) || arr.length !== 3
          || !arr.every((m) => ['locked','random','forbidden'].includes(m))) return;
      state.production.axisMode = arr.slice();
      lsSet(LS_KEYS.productionAxisMode, JSON.stringify(arr));
    },
    getProductionAxisMode: () => (state.production.axisMode || ['random','random','random']).slice(),
    // Phase 7: Settings page (model + URL endpoints)
    getMusicModel: () => {
      // Phase 10 (P10-1): custom (non-empty) wins over dropdown value.
      const custom = lsGet(LS_KEYS.customMusicModel);
      if (custom && custom.trim()) return custom.trim();
      return lsGet(LS_KEYS.musicModel) || DEFAULTS.musicModel;
    },
    setMusicModel: (m) => lsSet(LS_KEYS.musicModel, (m || '').trim()),
    getCustomMusicModel: () => (lsGet(LS_KEYS.customMusicModel) || '').trim(),
    setCustomMusicModel: (v) => lsSet(LS_KEYS.customMusicModel, (v || '').trim()),
    getCustomLlmModel: () => (lsGet(LS_KEYS.customLlmModel) || '').trim(),
    setCustomLlmModel: (v) => lsSet(LS_KEYS.customLlmModel, (v || '').trim()),
    getMusicApiUrl: () => lsGet(LS_KEYS.musicApiUrl) || DEFAULTS.musicApiUrl,
    setMusicApiUrl: (u) => lsSet(LS_KEYS.musicApiUrl, (u || '').trim()),
    getLlmApiUrl: () => lsGet(LS_KEYS.llmApiUrl) || DEFAULTS.llmApiUrl,
    setLlmApiUrl: (u) => lsSet(LS_KEYS.llmApiUrl, (u || '').trim()),
    keys: LS_KEYS,
    defaults: DEFAULTS,
  };

  // ── 调试钩子:devtools 可用 NS.debug() 查看 ─────────
  NS.debug = () => ({
    version: NS.version,
    state: JSON.parse(JSON.stringify(state)),
    defaults: DEFAULTS,
    keysLoaded: Object.fromEntries(
      Object.entries(LS_KEYS).map(([k, v]) => [k, lsGet(v) != null])
    ),
  });

  // Phase 7: public defaults (settings.js 用作 Reset 行为 + dropdown seed)
  NS.defaults = DEFAULTS;

  console.log('[MusicStudio] core loaded · v' + NS.version);
})(window);
