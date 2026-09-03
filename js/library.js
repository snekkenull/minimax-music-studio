/* ===========================================================
 * library.js  ·  Phase 3
 * ------------------------------------------------------------
 * IndexedDB 持久化层 (依赖 lib/idb-keyval.min.js)
 *
 * 三个 store:
 *   - minimax-metadata  作品卡片 (每次 task:success 写一条)
 *   - minimax-jobs      队列状态 (Phase 4 断点续跑用)
 *   - minimax-settings  长期偏好 (llmModel, library view prefs)
 *
 * Phase 3 启用 metadata + settings:
 *   - 成功任务 → put metadata
 *   - 启动时 → list 还原到 state.library.items
 *   - search/favorite/delete 走对应 helper
 *
 * 暴露:
 *   MusicStudio.library = {
 *     ready,
 *     metadata: { list, get, put, del, clear },
 *     jobs:     { get, put, del, getActive, list },
 *     settings: { get, set },
 *     search,                     // 字符串模糊匹配 title/lyrics/prompt
 *     saveFromTask(task, payload),// task → metadata doc (含 favorite 字段)
 *   }
 * =========================================================== */
(function (root) {
  'use strict';
  if (!root.MusicStudio) { console.error('[library] core.js must load first'); return; }
  if (!root.idbKeyVal)  { console.error('[library] idb-keyval.min.js must load first'); return; }

  const NS = root.MusicStudio;
  const { createStore, get, set, del, keys, values } = root.idbKeyVal;

  const metadataStore = createStore('minimax-metadata', 'kv');
  const jobsStore     = createStore('minimax-jobs',     'kv');
  const settingsStore = createStore('minimax-settings', 'kv');

  // ── helpers ───────────────────────────────────────────
  function safeGet(store, key) {
    return get(key, store).catch((e) => {
      console.warn('[library] get failed', key, e);
      return undefined;
    });
  }
  function safeSet(store, key, val) {
    return set(key, val, store).catch((e) => {
      console.warn('[library] set failed', key, e);
    });
  }
  function safeDel(store, key) {
    return del(key, store).catch(() => {});
  }

  // ── metadata (Library 卡片里的作品) ─────────────────
  const metadata = {
    list: () => values(metadataStore).catch(() => []),
    get:  (id) => safeGet(metadataStore, id),
    put:  (id, doc) => safeSet(metadataStore, id, doc),
    del:  (id) => safeDel(metadataStore, id),
    clear: async () => {
      const ks = await keys(metadataStore).catch(() => []);
      await Promise.all(ks.map((k) => safeDel(metadataStore, k)));
    },
  };

  // ── jobs (Phase 4 启用) ────────────────────────────
  const jobs = {
    get: (id) => safeGet(jobsStore, id),
    put: (id, doc) => safeSet(jobsStore, id, doc),
    del: (id) => safeDel(jobsStore, id),
    getActive: async () => {
      const all = await values(jobsStore).catch(() => []);
      return all.find((j) => j.status === 'active') || null;
    },
    list: () => values(jobsStore).catch(() => []),
  };

  // ── settings (跨 session 偏好) ─────────────────────
  const settings = {
    get: (key) => safeGet(settingsStore, key),
    set: (key, val) => safeSet(settingsStore, key, val),
  };

  // ── Phase 3: 写一条 history doc ────────────────────
  // task (music.js 的 task 对象) + 生成时的 payload (用于回填元数据)
  // doc 字段:
  //   id, idx, title, lyrics, prompt, audioUrl, outcome,
  //   sampleRate, bitrate, format, duration_ms, createdAt, favorite
  function saveFromTask(task, extra = {}) {
    if (!task) return Promise.resolve(null);
    // Phase 5: failed 状态也持久化 (用于 Library 显示 + 一键重试)
    if (task.status !== 'success' && !extra.failed) return Promise.resolve(null);
    const outcome = task.outcome || {};
    const doc = {
      id: task.id,
      idx: task.idx,
      status: task.status,                 // Phase 5: 加 status 字段
      title: task.title || extra.title || '',
      lyrics: task.lyrics || extra.lyrics || '',
      prompt: task.prompt || extra.prompt || '',
      audioUrl: task.status === 'success' ? (task.audioUrl || outcome.audio_url || null) : null,
      // Phase 9: 持久化本地 blob — 跨 CORS / 跨会话都能下载,不再依赖 remote URL
      audioBlob: task.status === 'success' ? (task.audioBlob || null) : null,
      outcome: task.status === 'success' ? outcome : null,
      sampleRate: outcome.sample_rate || extra.sampleRate || 0,
      bitrate:    outcome.bitrate || extra.bitrate || 0,
      format:     outcome.format || extra.format || 'mp3',
      durationMs: outcome.duration_ms || 0,
      createdAt:  task.startedAt || Date.now(),
      favorite:   extra.favorite || false,
      error:      task.error || null,      // Phase 5: 失败原因
      deletedAt:  null,                    // Phase 5 P2: 软删除时间戳 (null = 未删除)
    };
    return safeSet(metadataStore, doc.id, doc).then(() => doc);
  }

  // ── Phase 3: 搜索 (title/lyrics/prompt 串模糊匹配) ─
  function search(items, q) {
    if (!q) return items;
    const needle = q.toLowerCase();
    return items.filter((it) => {
      return (it.title   && it.title.toLowerCase().includes(needle)) ||
             (it.lyrics  && it.lyrics.toLowerCase().includes(needle)) ||
             (it.prompt  && it.prompt.toLowerCase().includes(needle));
    });
  }

  // ── Phase 5 P2: 软删除 / 回收站 (30 天保留) ───────────
  const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 天

  // 启动时 sweep: 把超过 30 天的真正删掉
  function sweepExpired() {
    const cutoff = Date.now() - TRASH_TTL_MS;
    return values(metadataStore).then((items) => {
      const expired = items.filter((d) => d.deletedAt && d.deletedAt < cutoff);
      return Promise.all(expired.map((d) => del(d.id).then(() => null))).then(() => expired.length);
    });
  }

  // 软删除:设置 deletedAt,保留数据 30 天
  function softDelete(id) {
    return get(id).then((doc) => {
      if (!doc) return null;
      doc.deletedAt = Date.now();
      return safeSet(metadataStore, id, doc).then(() => doc);
    });
  }

  // 还原:清 deletedAt
  function restore(id) {
    return get(id).then((doc) => {
      if (!doc) return null;
      doc.deletedAt = null;
      return safeSet(metadataStore, id, doc).then(() => doc);
    });
  }

  // 列出已删除的 (trash 视图)
  function listTrash() {
    return values(metadataStore).then((items) => {
      return items
        .filter((d) => d.deletedAt)
        .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
    });
  }

  // 真正删除 trash 中某项 (绕过软删除)
  function purge(id) {
    return del(id);
  }

  // 列出未删除的 (默认 list 应该也过滤, 但保留向后兼容)
  function listActive() {
    return values(metadataStore).then((items) => {
      return items
        .filter((d) => !d.deletedAt)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    });
  }

  // ── Phase 5: 导出 (JSON 全字段 / CSV 关键字段) ──
  function exportJSON() {
    return values(metadataStore).then((items) => {
      const sorted = items.slice().sort((a, b) => (a.idx || 0) - (b.idx || 0));
      const payload = {
        exportedAt: new Date().toISOString(),
        version: 1,
        count: sorted.length,
        items: sorted.map((d) => ({
          id:         d.id,
          idx:        d.idx,
          status:     d.status || 'success',
          title:      d.title || '',
          lyrics:     d.lyrics || '',
          prompt:     d.prompt || '',
          audioUrl:   d.audioUrl || null,
          outcome:    d.outcome || null,
          sampleRate: d.sampleRate || 0,
          bitrate:    d.bitrate || 0,
          format:     d.format || 'mp3',
          durationMs: d.durationMs || 0,
          createdAt:  d.createdAt || 0,
          favorite:   !!d.favorite,
          error:      d.error || null,
        })),
      };
      return JSON.stringify(payload, null, 2);
    });
  }

  // RFC 4180: 双引号包起来, 内部 " 转 ""
  function csvCell(s) {
    if (s == null) return '';
    const str = String(s);
    if (/[",\n\r]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function exportCSV() {
    return values(metadataStore).then((items) => {
      const sorted = items.slice().sort((a, b) => (a.idx || 0) - (b.idx || 0));
      const headers = [
        'idx', 'status', 'title', 'duration_sec', 'format', 'sample_rate',
        'bitrate', 'favorite', 'createdAt_iso', 'error',
        'lyrics_preview', 'prompt_preview', 'lyrics', 'prompt',
      ];
      const lines = [headers.join(',')];
      const preview = (s, n) => (s || '').slice(0, n).replace(/\s+/g, ' ').trim();
      for (const d of sorted) {
        const createdISO = d.createdAt ? new Date(d.createdAt).toISOString() : '';
        const durSec = d.durationMs ? (d.durationMs / 1000).toFixed(1) : '';
        lines.push([
          d.idx != null ? d.idx : '',
          d.status || 'success',
          csvCell(d.title || ''),
          durSec,
          csvCell(d.format || 'mp3'),
          d.sampleRate || '',
          d.bitrate || '',
          d.favorite ? '1' : '0',
          csvCell(createdISO),
          csvCell(d.error || ''),
          csvCell(preview(d.lyrics, 80)),
          csvCell(preview(d.prompt, 80)),
          csvCell(d.lyrics || ''),
          csvCell(d.prompt || ''),
        ].join(','));
      }
      return lines.join('\r\n');   // RFC 4180 用 CRLF
    });
  }

  // ── Phase 5 P3: ZIP 打包 ──
  // Minimal ZIP writer (no compression, STORED method only).
  // Format: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
  //   - Local File Header (LFH)
  //   - File data
  //   - Central Directory Header (CDH)
  //   - End of Central Directory (EOCD)
  // Supports: UTF-8 filenames, CRC32, no compression (audio is already compressed).
  function _utf8(s) {
    return new TextEncoder().encode(s);
  }

  // CRC32 table (polynomial 0xEDB88320)
  const _crcTable = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function _crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = _crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function _dosTime(d) {
    // DOS time: bits 11-15 hour, 5-10 minute, 0-4 second/2
    return ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F);
  }
  function _dosDate(d) {
    // DOS date: bits 9-15 year-1980, 5-8 month, 0-4 day
    return (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
  }

  // Build a ZIP from [{name, data:Uint8Array}] entries
  function _buildZip(entries) {
    const now = new Date();
    const time = _dosTime(now);
    const date = _dosDate(now);
    const chunks = [];
    const cdEntries = [];
    let offset = 0;

    for (const e of entries) {
      const nameBytes = _utf8(e.name);
      const data = e.data;
      const crc = _crc32(data);
      const size = data.length;

      // Local file header (30 bytes + name)
      const lfh = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(lfh.buffer);
      lv.setUint32(0, 0x04034b50, true);       // signature
      lv.setUint16(4, 20, true);                // version needed (2.0 = 20)
      lv.setUint16(6, 0, true);                 // flags
      lv.setUint16(8, 0, true);                 // method (0 = stored)
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);             // compressed size
      lv.setUint32(22, size, true);             // uncompressed size
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);                // extra length
      lfh.set(nameBytes, 30);

      chunks.push(lfh);
      chunks.push(data);

      // Central directory entry
      const cdh = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cdh.buffer);
      cv.setUint32(0, 0x02014b50, true);        // signature
      cv.setUint16(4, 20, true);                 // version made by
      cv.setUint16(6, 20, true);                 // version needed
      cv.setUint16(8, 0, true);                  // flags
      cv.setUint16(10, 0, true);                 // method
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);              // compressed
      cv.setUint32(24, size, true);              // uncompressed
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);                 // extra length
      cv.setUint16(32, 0, true);                 // comment length
      cv.setUint16(34, 0, true);                 // disk number
      cv.setUint16(36, 0, true);                 // internal attrs
      cv.setUint32(38, 0, true);                 // external attrs
      cv.setUint32(42, offset, true);            // LFH offset
      cdh.set(nameBytes, 46);

      cdEntries.push(cdh);
      offset += lfh.length + data.length;
    }

    const cdSize = cdEntries.reduce((s, c) => s + c.length, 0);
    const cdOffset = offset;
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);                   // disk number
    ev.setUint16(6, 0, true);                   // disk with CD
    ev.setUint16(8, cdEntries.length, true);    // entries on disk
    ev.setUint16(10, cdEntries.length, true);   // total entries
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdOffset, true);
    ev.setUint16(20, 0, true);                  // comment length

    // concat all
    const total = chunks.reduce((s, c) => s + c.length, 0) + cdSize + eocd.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    for (const c of cdEntries) { out.set(c, p); p += c.length; }
    out.set(eocd, p);
    return out;
  }

  // Sanitize a track into a safe filename
  function _safeName(s, ext) {
    const base = (s || 'track').replace(/[\\/:*?"<>|\r\n]+/g, '_').replace(/\s+/g, '_').slice(0, 80);
    return base + (ext ? '.' + ext : '');
  }

  // fetch a blob URL and return its bytes (audio is already a blob; for failed/missing we skip)
  async function _fetchAudio(url) {
    if (!url) return null;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const buf = await resp.arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) {
      return null;
    }
  }

  // Build a single track entry: { name, data } with audio + metadata
  async function _buildTrackEntry(d, idx) {
    const safe = _safeName(d.title || ('track_' + String(idx).padStart(3, '0')), null);
    const idxStr = String(idx).padStart(3, '0');
    const basename = idxStr + '_' + safe;
    const entries = [];

    // Audio file
    const fmt = (d.format || 'mp3').toLowerCase();
    const audio = await _fetchAudio(d.audioUrl);
    if (audio) {
      entries.push({ name: 'audio/' + basename + '.' + fmt, data: audio });
    }

    // Metadata JSON
    const metaJson = JSON.stringify({
      idx: d.idx, status: d.status, title: d.title, lyrics: d.lyrics, prompt: d.prompt,
      sampleRate: d.sampleRate, bitrate: d.bitrate, format: d.format,
      durationMs: d.durationMs, createdAt: d.createdAt,
      createdAtISO: d.createdAt ? new Date(d.createdAt).toISOString() : null,
      favorite: !!d.favorite, error: d.error,
    }, null, 2);
    entries.push({ name: 'meta/' + basename + '.json', data: _utf8(metaJson) });

    // Lyrics file (Phase 6 P0): same basename as audio, just the lyrics text.
    // This is what users care about most — drop the lyrics into any audio player
    // or share it standalone.
    if (d.lyrics && d.lyrics.trim()) {
      entries.push({ name: 'meta/' + basename + '.lyrics.txt', data: _utf8(d.lyrics) });
    }

    return entries;
  }

  // Build a manifest at zip root
  function _buildManifest(docs) {
    const lines = [
      'minimax library export',
      'Generated: ' + new Date().toISOString(),
      'Tracks: ' + docs.length,
      '',
      'Index | Title | Status | Format | Duration(s) | Created',
    ];
    for (const d of docs) {
      const idx = String(d.idx != null ? d.idx : '-').padStart(3, '0');
      const title = (d.title || '(untitled)').slice(0, 40);
      const status = d.status || 'success';
      const fmt = d.format || 'mp3';
      const dur = d.durationMs ? (d.durationMs / 1000).toFixed(1) : '-';
      const created = d.createdAt ? new Date(d.createdAt).toISOString() : '-';
      lines.push([idx, title, status, fmt, dur, created].join(' | '));
    }
    return _utf8(lines.join('\n') + '\n');
  }

  /**
   * Phase 6 P0 / Phase 9: Build per-track download payload (audio + same-basename lyrics).
   * Returns structured data so the caller can trigger two separate downloads
   * (or pass them into a ZIP). Lyrics omitted when track has no lyrics.
   *
   * Phase 9 修复: 不再 fetch(remoteUrl)(CORS 经常失败),直接读 doc.audioBlob
   * (本地 IndexedDB 缓存,music.js 生成完成时已存)。
   *
   * Phase 21 兜底: 如果 doc 没有本地 audioBlob(老存档 / 当时 _cacheAudioBlob 失败),
   * 走 Node proxy `/api/audio/fetch?url=...` 中转,绕开 storage.googleapis.com 无 CORS 头。
   * 命名: <safeBase>-<NN>.<ext> + <safeBase>-<NN>.txt
   *
   * @param {string} id
   * @returns {Promise<{
   *   title: string, idx: number,
   *   audio: {blob: Blob, name: string, mime: string} | null,
   *   lyrics: {text: string, name: string, mime: string} | null,
   * }>}
   */
  async function exportTrack(id) {
    const d = await metadata.get(id);
    if (!d) throw new Error('Track not found: ' + id);
    if (d.deletedAt) throw new Error('Track is in trash: ' + id);

    // Phase 9: 与 app.js dlBtn 同款命名 (空格保留, 不用 _)
    const baseRaw = ((d.title || d.prompt || '').trim()
      || ('track-' + ((d.idx != null ? d.idx : 0) + 1)));
    const safeBase = baseRaw.replace(/[\\/:*?"<>|\r\n]+/g, '_').replace(/\s+/g, ' ').slice(0, 80);
    const trackIdx = String((d.idx != null ? d.idx : 0) + 1).padStart(2, '0');
    const fmt = (d.format || 'mp3').toLowerCase();
    const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac' };
    const audioMime = mimeMap[fmt] || ('audio/' + fmt);

    const out = {
      title: d.title || ('track-' + ((d.idx != null ? d.idx : 0) + 1)),
      idx: d.idx != null ? d.idx : 0,
      audio: null,
      lyrics: null,
    };

    // Phase 9: 优先 doc.audioBlob (本地 IDB 缓存)
    if (d.audioBlob) {
      out.audio = { blob: d.audioBlob, name: `${safeBase}-${trackIdx}.${fmt}`, mime: audioMime };
    } else if (d.audioUrl) {
      // P21: 老存档 / _cacheAudioBlob 失败时, 走本地 Node proxy 中转
      const res = await fetch('/api/audio/fetch?url=' + encodeURIComponent(d.audioUrl));
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Proxy ${res.status}: ${errBody.slice(0, 120) || res.statusText}`);
      }
      const blob = await res.blob();
      out.audio = { blob, name: `${safeBase}-${trackIdx}.${fmt}`, mime: audioMime };
    }

    if (d.lyrics && d.lyrics.trim()) {
      out.lyrics = { text: d.lyrics, name: `${safeBase}-${trackIdx}.txt`, mime: 'text/plain;charset=utf-8' };
    }

    return out;
  }

  /**
   * Build a ZIP blob containing audio + metadata for the given doc ids.
   * @param {string[]} ids  empty = all active (non-trashed)
   * @returns {Promise<Blob>} application/zip
   */
  async function exportZip(ids) {
    let docs;
    if (Array.isArray(ids) && ids.length > 0) {
      const all = await values(metadataStore);
      const set = new Set(ids);
      docs = all.filter((d) => set.has(d.id) && !d.deletedAt);
    } else {
      docs = await listActive();
    }
    docs.sort((a, b) => (a.idx || 0) - (b.idx || 0));

    if (docs.length === 0) {
      throw new Error('No tracks to export.');
    }

    const entries = [];
    entries.push({ name: 'README.txt', data: _utf8(
      'minimax library export\n' +
      'Tracks: ' + docs.length + '\n' +
      'Structure:\n' +
      '  audio/             - audio files (.mp3 / .wav)\n' +
      '  meta/<basename>.json       - full track metadata (idx, title, lyrics, prompt, etc.)\n' +
      '  meta/<basename>.lyrics.txt - lyrics text only, same basename as audio\n' +
      '  manifest.txt       - one-line-per-track index\n'
    )});
    entries.push({ name: 'manifest.txt', data: _buildManifest(docs) });

    for (let i = 0; i < docs.length; i++) {
      const trackEntries = await _buildTrackEntry(docs[i], docs[i].idx != null ? docs[i].idx : i);
      for (const te of trackEntries) entries.push(te);
    }

    const zipBytes = _buildZip(entries);
    return new Blob([zipBytes], { type: 'application/zip' });
  }

  // ── ready promise: 第一次 list 预热,UI 起来用 ────
  let _readyResolve;
  const ready = new Promise((res) => { _readyResolve = res; });
  values(metadataStore).then(() => _readyResolve()).catch(() => _readyResolve());

  NS.register('library', {
    ready: Promise.resolve(ready),  // 兼容旧调用
    metadata,
    jobs,
    settings,
    saveFromTask,
    search,
    exportJSON,        // Phase 5
    exportCSV,         // Phase 5
    exportTrack,       // Phase 6 P0: single-track download (audio + lyrics)
    exportZip,         // Phase 5 P3
    sweepExpired,      // Phase 5 P2
    softDelete,        // Phase 5 P2
    restore,           // Phase 5 P2
    listTrash,         // Phase 5 P2
    listActive,        // Phase 5 P2
    purge,             // Phase 5 P2
    TRASH_TTL_MS,      // Phase 5 P2
    _stores: { metadataStore, jobsStore, settingsStore },
  });

  // 启动时 sweep 一次过期 trash
  sweepExpired().then((n) => {
    if (n > 0) console.log(`[library] swept ${n} expired trash item${n > 1 ? 's' : ''}`);
  }).catch(() => {});

  console.log('[MusicStudio] library loaded (Phase 3 + Phase 5 P0 + P2: trash + sweep)');
})(window);
