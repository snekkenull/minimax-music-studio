#!/usr/bin/env node
/**
 * Local CORS proxy for the GMI Cloud Inference Engine endpoint.
 *
 * The upstream API at https://console.gmicloud.ai/api/v1/ie/requestqueue/...
 * does not send Access-Control-Allow-Origin headers, so browsers refuse
 * direct cross-origin fetches with "Failed to fetch". This proxy:
 *
 *   - Listens on http://127.0.0.1:8787
 *   - Forwards /api/v1/* requests to https://console.gmicloud.ai/api/v1/*
 *   - Streams the request body through and pipes the response back
 *   - Injects permissive CORS headers and answers OPTIONS preflights locally
 *   - Re-emits upstream errors with their original status code so the UI
 *     can still surface HTTP errors (401, 400, 5xx, ...)
 *
 * Usage:
 *   node proxy.js            # foreground
 *   PORT=9000 node proxy.js  # override port
 *
 * Then open http://127.0.0.1:8787/music-generator.html
 */

const http = require('node:http');
const { URL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const UPSTREAM = 'https://console.gmicloud.ai';
const STATIC_ROOT = __dirname;

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

/** Skip headers the Node runtime / fetch stack adds that we must not relay. */
const SKIP_REQ_HEADERS = new Set([
  'host', 'connection', 'content-length', 'transfer-encoding',
  'origin', 'referer',
]);

/** Headers we always overwrite on the way back so browsers accept the response. */
const OVERRIDE_RES_HEADERS = {
  'access-control-allow-origin': CORS['Access-Control-Allow-Origin'],
  'access-control-allow-methods': CORS['Access-Control-Allow-Methods'],
  'access-control-allow-headers': CORS['Access-Control-Allow-Headers'],
};

/** Hop-by-hop / unsafe-to-relay response headers. */
const SKIP_RES_HEADERS = new Set([
  'content-encoding', // we pass through the body unmodified, so don't lie about encoding
  'transfer-encoding',
  'connection',
  'keep-alive',
  'content-length', // recomputed by Node
]);

function send(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...CORS,
    ...extraHeaders,
  });
  res.end(body);
}

function serveStatic(res, relPath) {
  // Reject path traversal and absolute paths.
  if (!relPath || relPath.includes('..') || path.isAbsolute(relPath)) {
    send(res, 400, 'Bad path');
    return;
  }
  const filePath = path.join(STATIC_ROOT, relPath);
  if (!filePath.startsWith(STATIC_ROOT + path.sep) && filePath !== STATIC_ROOT) {
    send(res, 400, 'Bad path');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      send(res, 404, `Not found: ${relPath}`);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = STATIC_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      ...CORS,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ── /api/llm/mock  ·  Phase 1.2 local mock LLM ──────────
// Returns a fake OpenAI-compatible /v1/chat/completions response so the
// browser can exercise the full LLM pipeline (request → JSON parse → Apply)
// without a real GMI key. Triggered when apiKey starts with "mock_".
//
// Reads the same request body as the upstream path, looks at the last
// "user" message's content to detect which template was sent
// (title-and-lyrics vs music-prompt), and returns a realistic JSON object
// in the same shape GMI would return.
async function handleMockLlm(req, res, bodyBuf, startedAt) {
  if (req.method !== 'POST') {
    send(res, 405, 'Method not allowed');
    return;
  }
  // Simulate ~600ms latency so the spinner is visible in the UI
  await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));

  let body;
  try {
    body = JSON.parse(bodyBuf.toString('utf8'));
  } catch (e) {
    send(res, 400, `Invalid JSON body: ${e.message}`);
    return;
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const userText = (lastUser?.content || '').toString();
  // Concatenate every message so system+user prompts both contribute to template detection.
  const allText = messages.map((m) => (m?.content || '').toString()).join('\n');

  // Detect template by scanning for telltale phrases across the full prompt
  const isTitleAndLyrics = /lyrics|song title|结构标签|verse|chorus/i.test(allText);
  const isMusicPrompt = /music prompt|pill|locked|genre|mood|vocal/i.test(allText);

  let content;
  if (isTitleAndLyrics) {
    const titleEn = 'Quiet Hours';
    const titleZh = '静默时分';
    content = JSON.stringify({
      title_en: titleEn,
      title_zh: titleZh,
      title: titleEn,
      language: 'zh',
      languages: ['zh'],
      lyrics:
        '[verse]\n路灯在雨里眨了眨眼\n' +
        '我推开那扇玻璃门\n' +
        '你抬头的瞬间\n' +
        '世界慢了一拍\n\n' +
        '[chorus]\n' +
        '咖啡冒着白气\n' +
        '两双手差一点就碰到一起\n' +
        '在安静的角落里\n' +
        '我们什么都没说\n\n' +
        '[verse]\n' +
        '雨声敲着窗台\n' +
        '我把目光收回来\n' +
        '你笑了一下\n' +
        '像是旧相识\n\n' +
        '[chorus]\n' +
        '咖啡冒着白气\n' +
        '两双手差一点就碰到一起\n' +
        '在安静的角落里\n' +
        '我们什么都没说\n\n' +
        '[outro]\n' +
        '（轻哼 渐弱）',
    });
  } else if (isMusicPrompt) {
    // Pull locked tags (after "Locked:" / "Locked tags:" line in the prompt)
    const lm = allText.match(/Locked(?:\s+tags)?[:：]\s*([^\n]+(?:\n(?!Mode)[^\n]+)*)/i);
    const locked = lm ? lm[1].split(/[,\n]/).map((s) => s.trim()).filter(Boolean) : [];
    const genre = locked.find((t) => /folk|pop|jazz|trap|wave|orchestral/i.test(t)) || 'Indie folk';
    const mood = locked.find((t) => /melancholic|dreamy|serene|nostalgic/i.test(t)) || 'dreamy';
    const vocal = locked.find((t) => /vocal|whisper|choir/i.test(t)) || 'soft female vocal';
    const fillers = ['warm analog synth', 'soft acoustic guitar', 'lush reverb', 'gentle piano'];
    const tail = fillers.slice(0, 3).join(', ');
    const prompt = `${genre}, ${mood}, ${vocal}, ${themeWord()}, ${tail}, 85 bpm, intimate, conversational`;
    content = JSON.stringify({ prompt });
  } else {
    content = JSON.stringify({ reply: 'mock: unrecognized template' });
  }

  // OpenAI-compatible response shape
  const payload = {
    id: 'mock-chatcmpl-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model || 'mock-llm',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: userText.length / 4 | 0,
      completion_tokens: content.length / 4 | 0,
      total_tokens: 0,
    },
  };
  payload.usage.total_tokens = payload.usage.prompt_tokens + payload.usage.completion_tokens;

  const ms = Date.now() - startedAt;
  console.log(`[mock-llm] ${body.model} → ${payload.id} (${ms}ms, ${payload.usage.total_tokens} tok)`);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS,
  });
  res.end(JSON.stringify(payload));
}

function themeWord() {
  const ws = ['rainy afternoon', 'a quiet café', 'flickering streetlight', 'old photograph', 'shared silence'];
  return ws[Math.floor(Math.random() * ws.length)];
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Preflight — answer locally, do not touch upstream.
  if (req.method === 'OPTIONS') {
    send(res, 204, '');
    return;
  }

  // Root → music generator UI.
  if (url.pathname === '/' || url.pathname === '/index.html') {
    serveStatic(res, 'music-generator.html');
    return;
  }

  // Other static assets: /foo.html, /assets/x.js, etc. — but never anything
  // outside this directory. Reject path traversal explicitly.
  if (!url.pathname.startsWith('/api/')) {
    serveStatic(res, url.pathname.slice(1));
    return;
  }

  // Buffer the request body. The upstream is JSON over HTTPS and bodies are
  // small (a few KB), so streaming is not worth the complexity. Collect it
  // before branching so both the mock LLM and the upstream proxy can read it.
  const MAX_BODY = 4 * 1024 * 1024; // 4 MB hard cap
  const bodyPromise = new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      total += c.length;
      if (total > MAX_BODY) {
        aborted = true;
        req.destroy();
        send(res, 413, 'Request body too large for local proxy.');
        reject(new Error('body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('error', (err) => {
      if (!aborted) {
        aborted = true;
        send(res, 400, `Client request error: ${err.message}`);
        reject(err);
      }
    });
    req.on('end', () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks));
    });
  });

  // ── /api/llm/mock  ·  Phase 1.2 local mock LLM ───────
  // Returns a fake OpenAI-compatible /v1/chat/completions response so the
  // browser can exercise the full LLM pipeline (request → JSON parse → Apply)
  // without a real GMI key. Triggered by sending a real POST to this path;
  // the browser detects mock_ prefix in apiKey and switches URLs.

  // ── /api/audio/fetch  ·  Phase 21 proxy audio download ─
  // Streams a remote audio file (e.g. GCS user-assets) back to the browser
  // so the client can wrap it in a Blob and call downloadBlob(). Bypasses
  // the storage.googleapis.com CORS gap (which omits Access-Control-Allow-Origin
  // headers entirely, so browser fetch() / <a download> would fail or open a
  // new tab instead of downloading).
  //
  // Security:
  //   - https only (blocks file://, http://, data:, etc.)
  //   - hostname allowlist (storage.googleapis.com, console.gmicloud.ai)
  //   - path prefix check (GCS user-assets buckets this project actually uses)
  //   - 50 MB size cap (audio mp3/wav is typically < 10 MB)
  //   - 30 s upstream timeout
  //
  // Errors are passed through with their status code and the first 4 KB of
  // body so the browser can show a useful message ("Upstream 403 …" etc.).
  const AUDIO_FETCH_HOSTS = new Set([
    'storage.googleapis.com',
    'console.gmicloud.ai',
  ]);
  // Dev/test only: AUDIO_FETCH_ALLOW_LOCAL=1 also permits 127.0.0.1 / localhost
  // so e2e can self-serve a fixture through the proxy. Never set in production.
  if (process.env.AUDIO_FETCH_ALLOW_LOCAL === '1') {
    AUDIO_FETCH_HOSTS.add('127.0.0.1');
    AUDIO_FETCH_HOSTS.add('localhost');
  }
  const AUDIO_FETCH_PATH_OK = (p) =>
    p.startsWith('/gmi-') ||
    /^\/[^/]+-assests-prod\//.test(p) ||
    /^\/[^/]+-assets\//.test(p) ||
    // Dev/test only: AUDIO_FETCH_ALLOW_LOCAL=1 also allows /sample.mp3 etc.
    (process.env.AUDIO_FETCH_ALLOW_LOCAL === '1' && /^\/[a-z0-9._-]+\.mp3$/i.test(p));
  const AUDIO_FETCH_MAX_BYTES = 50 * 1024 * 1024;     // 50 MB
  const AUDIO_FETCH_TIMEOUT_MS = 30_000;              // first-byte timeout
  const AUDIO_FETCH_TOTAL_TIMEOUT_MS = 5 * 60_000;    // 5 min total (covers 50 MB on slow links)
  const AUDIO_FETCH_STALL_TIMEOUT_MS = 60_000;        // 60 s of no upstream bytes → abort

  async function handleAudioFetch(req, res, url, startedAt) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method not allowed');
      return;
    }
    const target = url.searchParams.get('url');
    if (!target) {
      send(res, 400, 'Missing ?url= parameter');
      return;
    }
    let parsed;
    try { parsed = new URL(target); } catch {
      send(res, 400, 'Invalid url parameter (not a URL)');
      return;
    }
    const isLocalDev =
      process.env.AUDIO_FETCH_ALLOW_LOCAL === '1' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
    if (parsed.protocol !== 'https:' && !isLocalDev) {
      send(res, 400, 'Refusing non-https url: ' + parsed.protocol);
      return;
    }
    if (!AUDIO_FETCH_HOSTS.has(parsed.hostname)) {
      send(res, 403, 'Refusing host: ' + parsed.hostname);
      return;
    }
    if (!AUDIO_FETCH_PATH_OK(parsed.pathname)) {
      send(res, 403, 'Refusing path on allowed host: ' + parsed.pathname);
      return;
    }

    // Drain any body so the socket doesn't leak; for GET there is none.
    let bodyBuf;
    try { bodyBuf = await bodyPromise; } catch { return; /* 4xx already sent */ }
    void bodyBuf;

    const ac = new AbortController();
    // First-byte timeout: how long to wait for upstream headers.
    const firstByteTimer = setTimeout(() => ac.abort(), AUDIO_FETCH_TIMEOUT_MS);
    // Total-request hard cap: 5 min for the entire fetch including streaming body.
    const totalCapTimer = setTimeout(() => ac.abort(), AUDIO_FETCH_TOTAL_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(parsed.toString(), {
        method: req.method,
        signal: ac.signal,
        headers: { 'user-agent': 'minimax-local-proxy/1.0 (node)' },
      });
    } catch (err) {
      clearTimeout(firstByteTimer);
      clearTimeout(totalCapTimer);
      const msg = err.name === 'AbortError' ? 'Upstream timeout' : err.message;
      console.error(`[audio-fetch] upstream error: ${target} — ${msg}`);
      send(res, 502, `Upstream fetch failed: ${msg}`);
      return;
    }
    clearTimeout(firstByteTimer);
    // totalCapTimer stays armed; it must trigger the AbortController if the
    // body stream stalls (res.write blocks or upstream gets slow).
    // The pump loop will catch the abort via reader.read() and bail.

    const resHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (SKIP_RES_HEADERS.has(key.toLowerCase())) return;
      resHeaders[key] = value;
    });
    Object.assign(resHeaders, OVERRIDE_RES_HEADERS);
    resHeaders['cache-control'] = 'no-store';

    const cl = Number(upstream.headers.get('content-length') || 0);
    if (cl > AUDIO_FETCH_MAX_BYTES) {
      clearTimeout(firstByteTimer);
      clearTimeout(totalCapTimer);
      upstream.body?.cancel?.();
      send(res, 413, `Upstream too large: ${cl} bytes (max ${AUDIO_FETCH_MAX_BYTES})`);
      return;
    }

    res.writeHead(upstream.status, resHeaders);
    // Flush headers immediately so undici/fetch sees the response and starts
    // draining the body. Without this, the body pump runs after writeHead's
    // implicit flush, but some clients (Node fetch / undici) treat the lack
    // of an immediate flush as a problem on localhost.
    res.flushHeaders?.();

    let received = 0;
    const finalize = () => {
      clearTimeout(totalCapTimer);
      const ms = Date.now() - startedAt;
      console.log(`[audio-fetch] ${req.method} ${parsed.hostname}${parsed.pathname} → ${upstream.status} (${ms}ms, ${received} bytes)`);
    };
    if (upstream.body) {
      const reader = upstream.body.getReader();
      // Stall timer: reset on every successful read; fires if upstream goes
      // silent for AUDIO_FETCH_STALL_TIMEOUT_MS during the body stream.
      let stallTimer = setTimeout(() => ac.abort(), AUDIO_FETCH_STALL_TIMEOUT_MS);
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => ac.abort(), AUDIO_FETCH_STALL_TIMEOUT_MS);
            received += value.length;
            if (received > AUDIO_FETCH_MAX_BYTES) {
              console.warn(`[audio-fetch] size cap exceeded for ${target}`);
              res.destroy();
              try { await reader.cancel(); } catch { /* ignore */ }
              return;
            }
            // If the client has gone away, stop pumping immediately.
            if (!res.writable) {
              try { await reader.cancel(); } catch { /* ignore */ }
              return;
            }
            const ok = res.write(Buffer.from(value));
            if (!ok) {
              // Backpressure: wait for drain before reading more (with a safety
              // cap so a stuck client cannot pin a worker forever).
              await new Promise((resolve) => {
                const onDrain = () => { clearTimeout(drainTimer); resolve(); };
                const drainTimer = setTimeout(onDrain, 30_000);
                res.once('drain', onDrain);
              });
            }
          }
          res.end();
        } catch (err) {
          console.error(`[audio-fetch] stream error: ${err.message}`);
          try { res.destroy(); } catch { /* ignore */ }
        } finally {
          clearTimeout(stallTimer);
          finalize();
        }
      };
      pump();
    } else {
      res.end();
      finalize();
    }
  }

  if (url.pathname === '/api/audio/fetch') {
    handleAudioFetch(req, res, url, startedAt);
    return;
  }

  if (url.pathname === '/api/llm/mock' && req.method === 'POST') {
    let bodyBuf;
    try { bodyBuf = await bodyPromise; } catch { return; /* 4xx already sent */ }
    handleMockLlm(req, res, bodyBuf, startedAt);
    return;
  }

  const target = `${UPSTREAM}${url.pathname}${url.search}`;

  // Build upstream headers, dropping hop-by-hop / browser-only fields.
  const fwdHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (SKIP_REQ_HEADERS.has(k.toLowerCase())) continue;
    fwdHeaders[k] = v;
  }
  // No User-Agent leak; identify ourselves so upstream logs are readable.
  fwdHeaders['user-agent'] = 'minimax-local-proxy/1.0 (node)';
  fwdHeaders['host'] = new URL(UPSTREAM).host;

  bodyPromise.then(async (body) => {
    let upstream;
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers: fwdHeaders,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
        // No AbortSignal plumbing — the upstream timeout is its own concern.
      });
    } catch (err) {
      console.error(`[proxy] upstream fetch failed: ${target} — ${err.message}`);
      send(res, 502, `Upstream fetch failed: ${err.message}`);
      return;
    }

    // Copy upstream headers, strip ones we must recompute, and override CORS.
    const resHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (SKIP_RES_HEADERS.has(key.toLowerCase())) return;
      resHeaders[key] = value;
    });
    Object.assign(resHeaders, OVERRIDE_RES_HEADERS);

    res.writeHead(upstream.status, resHeaders);

    if (upstream.body) {
      // Node 18+ exposes a Web ReadableStream on fetch responses.
      const reader = upstream.body.getReader();
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
          res.end();
        } catch (err) {
          console.error(`[proxy] stream error from upstream: ${err.message}`);
          res.destroy();
        }
      };
      pump().catch((err) => {
        console.error(`[proxy] pump error: ${err.message}`);
        res.destroy();
      });
    } else {
      res.end();
    }

    const ms = Date.now() - startedAt;
    console.log(`[proxy] ${req.method} ${url.pathname}${url.search} → ${upstream.status} (${ms}ms)`);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`minimax local proxy listening on http://${HOST}:${PORT}`);
  console.log(`  static files served from ${STATIC_ROOT}`);
  console.log(`  forwards /api/* → ${UPSTREAM}/api/*`);
  console.log(`  open http://${HOST}:${PORT}/ to use the UI`);
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    console.log(`\n[proxy] ${sig} received, closing.`);
    server.close(() => process.exit(0));
  });
}
// Diagnose silent death: log unexpected exit & keepalive tick
process.on('exit', (code) => {
  console.log(`[proxy] process.exit(${code}) — uptime=${Math.round(process.uptime())}s`);
});
setInterval(() => {}, 60_000).unref(); // keep event loop alive only while listeners exist
