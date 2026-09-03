/* ===========================================================
 * music.js  ·  Phase 0
 * ------------------------------------------------------------
 * GMI Cloud 音乐 API 调用层 (现有 submitOne/pollStatus/runner
 * 原样迁移,行为零差异)
 *
 * 暴露:
 *   MusicStudio.music = {
 *     constants: { ENDPOINT, STATUS_ENDPOINT, BATCH_MAX, BATCH_CONCURRENCY, POLL_MAX },
 *     buildPayload(),                       // -> { model, payload }
 *     submitOne(task, token),               // async: 提交一首 + 轮询
 *     pollStatus(task, token, attempts),    // async: 单独轮询
 *     runWithConcurrency(tasks, limit, token),
 *     fmtDuration(ms), fmtBytes(n),
 *   }
 * =========================================================== */
(function (root) {
  'use strict';
  if (!root.MusicStudio) { console.error('[music] core.js must load first'); return; }

  const NS = root.MusicStudio;

  // Same-origin endpoints — require `node proxy.js` running on :8787
  // to forward to https://console.gmicloud.ai (no CORS upstream).
  // Phase 7: settings-aware. Read from persist each call so the Settings page
  // changes take effect immediately without a reload. Falls back to defaults
  // registered by core.js.
  function _endpoint() { return NS.persist.getMusicApiUrl(); }
  function _statusEndpoint(id) { return _endpoint() + '/' + id; }

  // Phase 15: 上限放宽到 100 (替代旋钮,允许自定义数值)
  const BATCH_MAX = 100;
  const BATCH_CONCURRENCY = 3;
  const POLL_MAX = 30;

  function buildPayload(task) {
    // Phase 2: per-task override; if task has its own lyrics/prompt, use it.
    // Falls back to global state for backward-compat (batch=1 default).
    const lyrics = (task && typeof task.lyrics === 'string' && task.lyrics.length > 0)
      ? task.lyrics : root.state.lyrics;
    const prompt = (task && typeof task.prompt === 'string' && task.prompt.length > 0)
      ? task.prompt : (root.state.prompt || undefined);
    return {
      model: NS.persist.getMusicModel(),
      payload: {
        lyrics,
        prompt,
        sample_rate: root.state.sampleRate,
        bitrate: root.state.bitrate,
        format: root.state.format,
      },
    };
  }

  function fmtDuration(ms) {
    if (!ms || ms <= 0) return '—';
    const s = Math.round(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }
  function fmtBytes(n) {
    if (!n) return '—';
    if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB';
    if (n > 1e3) return (n / 1e3).toFixed(1) + ' KB';
    return n + ' B';
  }

  // Phase 9: 把远程 audio_url 提前转 blob 缓存到 task.audioBlob,
  // 供后续 dlBtn 真正下载 + 侧栏会话持久化用,绕开 CORS。
  async function _cacheAudioBlob(task) {
    if (!task.audioUrl) return;
    try {
      const res = await fetch(task.audioUrl);
      if (res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 0) {
          task.audioBlob = blob;
          NS.events?.fire('task:progress', { task, progress: 1 });
        }
      } else {
        console.warn('[music] audio blob fetch HTTP', res.status);
      }
    } catch (e) {
      console.warn('[music] audio blob fetch failed:', e?.message || e);
      // audioBlob 保持 undefined,降级用 URL 模式
    }
  }

  // ── Phase 18 (P18-2a): fetch with 5xx/network retry ──
  // 4xx (除 429) 立即 fail — auth/validation 错误是确定性的。
  // 5xx / 429 / network error → 重试 3 次,jitter backoff。
  // 用户取消 (signal.aborted) 优先检测,立即 throw AbortError。
  const SUBMIT_RETRY_MAX = 3;
  const SUBMIT_BACKOFF_BASE = 600;     // ms
  const SUBMIT_BACKOFF_FACTOR = 2;     // 600, 1200, 2400
  const RETRYABLE_HTTP_STATUS = new Set([500, 502, 503, 504, 429]);
  async function _fetchWithRetry(url, opts, { signal, onRetry } = {}) {
    let lastErr;
    for (let attempt = 0; attempt < SUBMIT_RETRY_MAX; attempt++) {
      try {
        const res = await fetch(url, opts);
        if (res.ok) return res;
        // 4xx (除 429) → 立即抛错,不可重试 (auth/validation 错误是确定性的)
        // 抛出的错误在 catch 块用 _isNonRetryableHttp 标记,避免被误判为 network error
        if (!RETRYABLE_HTTP_STATUS.has(res.status) && res.status >= 400) {
          const text = await res.text();
          let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
          const msg = data?.error?.message || data?.message || data?.raw || `HTTP ${res.status}`;
          const e = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
          e.status = res.status;
          e.nonRetryable = true;  // 标记:catch 块遇到此标记立即抛,不重试
          throw e;
        }
        // 5xx / 429 → retry
        // P19.1: 透传 GMI 5xx response body 的 error.message,供 UI 诊断 "哪个字段 schema 错"
        // 4xx 路径已经做了同样的事;这里补齐 5xx。3 次 retry 每次都读一次 text (body < 1KB,忽略不计)
        const errText5xx = await res.text().catch(() => '');
        let errMsg5xx;
        try {
          const j = JSON.parse(errText5xx);
          errMsg5xx = j?.error?.message || j?.message || errText5xx;
        } catch {
          errMsg5xx = errText5xx;
        }
        lastErr = new Error(`HTTP ${res.status} · ${String(errMsg5xx).slice(0, 200)}`);
        if (attempt < SUBMIT_RETRY_MAX - 1) {
          const backoff = SUBMIT_BACKOFF_BASE * Math.pow(SUBMIT_BACKOFF_FACTOR, attempt) * (0.5 + Math.random() * 0.5);
          console.warn(`[music] submit HTTP ${res.status}, retry ${attempt + 1}/${SUBMIT_RETRY_MAX} in ${backoff | 0}ms`);
          onRetry?.(attempt + 1, res.status);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw lastErr;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        // Phase 18 (P18-2a): 4xx 不可重试 — 立即抛,不进入 backoff
        if (e.nonRetryable) throw e;
        // network error → retry
        if (attempt < SUBMIT_RETRY_MAX - 1) {
          const backoff = SUBMIT_BACKOFF_BASE * Math.pow(SUBMIT_BACKOFF_FACTOR, attempt) * (0.5 + Math.random() * 0.5);
          console.warn(`[music] submit network error: ${e.message}, retry ${attempt + 1}/${SUBMIT_RETRY_MAX}`);
          onRetry?.(attempt + 1, 'network');
          await new Promise((r) => setTimeout(r, backoff));
          lastErr = e;
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  // ── 提交一首 (原 submitOne 逻辑) ─────────────────────
  async function submitOne(task, token) {
    task.status = 'running';
    task.startedAt = Date.now();
    task.controller = new AbortController();
    // 通知 UI 刷新 (回调式,避免 music 模块反向 import app)
    NS.events?.fire('task:state', task);

    const body = buildPayload(task);  // P19: 传 task 让 buildPayload 走 per-task 覆盖分支,
    // 之前不传导致批量 100 首全提交 state.lyrics/prompt → GMI 同内容 500。
    // 单轨 useVary=false 时 task.lyrics 为空,buildPayload 内部 fallback 到 state,行为不变。
    let data;
    try {
      const res = await _fetchWithRetry(_endpoint(), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${root.state.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: task.controller.signal,
      }, {
        signal: task.controller.signal,
        onRetry: (n, status) => {
          // progress 文案带 retry 提示,用户看到 "重试中 1/3..." (后续被 success/failed 覆盖)
          task.error = `重试中 (${n}/${SUBMIT_RETRY_MAX - 1}, HTTP ${status})...`;
          NS.events?.fire('task:progress', { task, progress: 0 });
        },
      });

      const text = await res.text();
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      // immediate success
      if (data.outcome && (data.outcome.audio_url || data.outcome.status === 'music_generated_successfully')) {
        task.outcome = data.outcome;
        task.audioUrl = data.outcome.audio_url || null;
        task.status = 'success';
        task.progress = 1;
        task.error = null;     // clear retry hint
        await _cacheAudioBlob(task);
        NS.events?.fire('task:state', task);
        return;
      }

      // queued → poll
      if (data.request_id) {
        task.requestId = data.request_id;
        await pollStatus(task, token);
        return;
      }
      throw new Error('Unexpected response: ' + JSON.stringify(data).slice(0, 240));
    } catch (e) {
      if (e.name === 'AbortError') {
        task.status = 'cancelled';
        task.error = 'cancelled';
      } else {
        task.status = 'failed';
        task.error = e.message || String(e);
      }
    }
  }

  async function pollStatus(task, token, attempts) {
    attempts = attempts || POLL_MAX;
    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      if (token !== root.state.batchToken) return; // batch superseded
      try {
        const res = await fetch(_statusEndpoint(task.requestId), {
          headers: { 'Authorization': `Bearer ${root.state.apiKey}` },
          signal: task.controller?.signal,
        });
        const data = await res.json();
        if (data.status === 'success' && data.outcome) {
          task.outcome = data.outcome;
          task.audioUrl = data.outcome.audio_url || null;
          task.status = 'success';
          task.progress = 1;
          await _cacheAudioBlob(task);
          NS.events?.fire('task:state', task);
          return;
        }
        if (data.status === 'failed') {
          throw new Error(data.outcome?.error || data.outcome?.status || 'failed');
        }
        task.progress = Math.min(0.95, (i + 1) / attempts * 0.9);
        NS.events?.fire('task:progress', { task, progress: task.progress });
      } catch (e) {
        if (e.name === 'AbortError') { task.status = 'cancelled'; task.error = 'cancelled'; return; }
        if (i === attempts - 1) throw e;
      }
    }
    throw new Error('Timed out waiting for music generation.');
  }

  // ── 并发 worker 池 (原 runWithConcurrency 逻辑) ─────
  async function runWithConcurrency(tasks, limit, token) {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (true) {
        if (token !== root.state.batchToken) return;
        const i = cursor++;
        if (i >= tasks.length) return;
        const t = tasks[i];
        if (t.status === 'cancelled') continue;
        await submitOne(t, token);
        NS.events?.fire('task:state', t);
        // P20: 无条件 fire task:success (同 app.js pipeline 注释,library listener 幂等)
        if (t.status === 'success') {
          NS.events?.fire('task:success', t);
        }
      }
    });
    await Promise.all(workers);
  }

  // ── 任务工厂 (从原 newTask 迁出,供 app 模块使用) ──
  function newTask(idx, { title = '', lyrics = '', prompt = '' } = {}) {
    return {
      id: `t${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
      idx,
      status: 'queued',
      progress: 0,
      title,
      lyrics,
      prompt,
      requestId: null,
      outcome: null,
      audioUrl: null,
      audioBlob: null,
      error: null,
      startedAt: Date.now(),
      controller: null,
    };
  }

  NS.register('music', {
    constants: { BATCH_MAX, BATCH_CONCURRENCY, POLL_MAX },
    buildPayload,
    submitOne,
    pollStatus,
    runWithConcurrency,
    fmtDuration,
    fmtBytes,
    newTask,
  });

  console.log('[MusicStudio] music loaded');
})(window);
