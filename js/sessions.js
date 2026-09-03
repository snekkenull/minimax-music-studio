/* ===========================================================
 * sessions.js  ·  Phase 9
 * ------------------------------------------------------------
 * 左侧"历史会话"侧栏的 IDB 持久化层
 *
 * 每次 Generate 成功后,app.js 调 sessions.create({快照}) 入库。
 * 用户点击侧栏会话 → app.js 把 lyrics/prompt 灌回 textarea。
 *
 * 命名规则:
 *   - 优先用 state.prompt 前 32 字 (截断加 …)
 *   - 空 prompt → "Session #NN" 序号
 *
 * Store: minimax-sessions (kv)
 * Doc:   { id, title, createdAt, lyrics, prompt,
 *          model, format, sampleRate, bitrate, idx,
 *          // Phase 16:audio artifact + outcome snapshot
 *          audioBlob, audioUrl, outcome, status }
 *
 * 暴露:
 *   MusicStudio.sessions = {
 *     create(payload),       // -> Promise<doc>
 *     list(),                // -> Promise<doc[]>  (按 createdAt 倒序)
 *     get(id),               // -> Promise<doc|null>
 *     rename(id, title),     // -> Promise<doc|null>
 *     del(id),               // -> Promise<void>
 *     clear(),               // -> Promise<void>   (清空全部)
 *   }
 *
 * Phase 16 变更:
 *   - create payload 新增 audioBlob / audioUrl / outcome / status
 *   - 老 session(无这些字段)读取时为 undefined,UI 通过 _hasAudio(s) 降级 disabled
 * =========================================================== */
(function (root) {
  'use strict';
  if (!root.MusicStudio) { console.error('[sessions] core.js must load first'); return; }
  if (!root.idbKeyVal)  { console.error('[sessions] idb-keyval.min.js must load first'); return; }

  const NS = root.MusicStudio;
  const { createStore, get, set, del, keys, values } = root.idbKeyVal;
  const store = createStore('minimax-sessions', 'kv');

  // ── helpers ─────────────────────────────────────────
  function safeGet(k)  { return get(k, store).catch((e) => { console.warn('[sessions] get failed', k, e); return null; }); }
  function safeSet(k,v){ return set(k, v, store).catch((e) => console.warn('[sessions] set failed', k, e)); }
  function safeDel(k)  { return del(k, store).catch(() => {}); }

  // 截断 prompt 为会话名 (空时返 null 让调用方用序号)
  function deriveName(prompt) {
    const p = (prompt || '').trim().replace(/\s+/g, ' ');
    if (!p) return null;
    return p.length > 32 ? (p.slice(0, 32) + '…') : p;
  }

  // 生成 doc id: sess-<timestamp>-<rand>
  function newId() {
    return 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  // ── API ─────────────────────────────────────────────
  const sessions = {
    /**
     * 入库一次 generate 快照
     * payload: { lyrics, prompt, model, format, sampleRate, bitrate, idx, title?,
     *            audioBlob?, audioUrl?, outcome?, status? }
     * 自动按当前已有 doc 数派生 "Session #NN" 序号
     */
    async create(payload) {
      const p = payload || {};
      const now = Date.now();
      // 用现有 count 派生序号(并发安全: 同时多次 create 时可能重复,接受)
      const all = await values(store).catch(() => []);
      const fallback = `Session #${all.length + 1}`;
      const title = (p.title && p.title.trim()) || deriveName(p.prompt) || fallback;
      const doc = {
        id: newId(),
        title,
        createdAt: now,
        lyrics: p.lyrics || '',
        prompt: p.prompt || '',
        model: p.model || null,
        format: p.format || null,
        sampleRate: p.sampleRate || null,
        bitrate: p.bitrate || null,
        idx: p.idx != null ? p.idx : null,
        // Phase 16: audio artifact + outcome snapshot
        audioBlob: p.audioBlob || null,
        audioUrl:  p.audioUrl  || null,
        outcome:   p.outcome   || null,
        status:    p.status    || null,
      };
      await safeSet(doc.id, doc);
      return doc;
    },

    /** 按 createdAt 倒序 */
    list: () => values(store).then((arr) => arr.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))).catch(() => []),

    get: (id) => safeGet(id),

    rename: async (id, title) => {
      const d = await safeGet(id);
      if (!d) return null;
      const t = (title || '').trim() || d.title;
      d.title = t;
      await safeSet(id, d);
      return d;
    },

    del: (id) => safeDel(id),

    clear: async () => {
      const ks = await keys(store).catch(() => []);
      await Promise.all(ks.map(safeDel));
    },
  };

  NS.register('sessions', sessions);
  console.log('[MusicStudio] sessions loaded (Phase 9)');
})(window);
