/* ===========================================================
 * llm.js  ·  Phase 1
 * ------------------------------------------------------------
 * LLM 客户端:
 *   - complete({ messages, jsonMode, maxTokens, temperature })
 *   - generateTitleAndLyrics(theme, languages, targetLen)
 *   - generateMusicPrompt(mode, locked)
 * 浏览器直连 api.gmi-serving.com (已验证 CORS 完整)
 * =========================================================== */
(function (root) {
  'use strict';
  if (!root.MusicStudio) { console.error('[llm] core.js must load first'); return; }

  const NS = root.MusicStudio;
  const persist = NS.persist;

  // ── 配置常量 ──────────────────────────────────────
  // Production endpoint (GMI's OpenAI-compatible chat completions).
  // When apiKey starts with "mock_", complete() routes to the local
  // /api/llm/mock endpoint instead (Phase 1.2 self-test).
  // Phase 7: LLM endpoint read from persist each call (Settings page)
  const MOCK_LLM_ENDPOINT = '/api/llm/mock'; // same-origin, served by proxy.js
  function _llmEndpoint() { return NS.persist.getLlmApiUrl(); }
  // DEFAULT_MODEL kept for export / compat — actual value comes from persist
  const DEFAULT_MODEL = 'MiniMaxAI/MiniMax-M2.7';
  const MOCK_PREFIX = 'mock_';

  // ── 4 个 prompt 模板 ID ──────────────────────────
  const TEMPLATES = {
    TITLE_AND_LYRICS: 'title-and-lyrics',
    MUSIC_PROMPT: 'music-prompt',
  };

  // ── 错误类 ────────────────────────────────────────
  class LlmError extends Error {
    constructor(status, code, message) {
      super(message);
      this.name = 'LlmError';
      this.status = status;
      this.code = code;
    }
  }

  /**
   * 调 OpenAI-compatible /v1/chat/completions
   * @param {Object} args
   * @param {Array<{role,content}>} args.messages
   * @param {boolean} [args.jsonMode] - 强制 JSON 输出 (response_format)
   * @param {number} [args.maxTokens=1024]
   * @param {number} [args.temperature=0.8]
   * @param {AbortSignal} [args.signal]
   * @returns {Promise<{content:string, raw:Object, usage:Object}>}
   */
  // Phase 18 (P18-1): reasoning model (MiniMaxAI/MiniMax-M2.7) routinely
  // spends 200-400 tokens on `reasoning_content` then returns
  // finish_reason=length with content=null. One retry with +50% was
  // not enough under batch loads — second attempt also truncated.
  // Upgrade to 3 attempts with progressive maxTokens growth [1.0×,
  // 1.75×, 2.5×] and progressive temperature decay [1.0×, 0.7×, 0.5×]
  // to give the model more headroom AND more determinism on later
  // attempts. Hard ceiling MAX_TOKENS_CEILING=8000 prevents a runaway
  // 2.5× multiplier from exploding a single request.
  const MAX_PARSE_RETRIES = 3;
  const MAX_TOKENS_GROWTH = [1.0, 1.75, 2.5];
  const TEMPERATURE_DECAY = [1.0, 0.7, 0.5];
  const MAX_TOKENS_CEILING = 8000;
  async function complete({ messages, jsonMode = false, maxTokens = 1024, temperature = 0.8, signal } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new LlmError(0, 'bad_request', 'messages array is required');
    }
    // Auth / 429 / network errors fail fast (no retry) — only
    // `parse` (finishReason=length or empty content) is worth retrying.
    // If the caller passed no signal at all, retry is still allowed —
    // they have no way to abort us, so the safety check is moot.
    const isRetryable = (e) =>
      e instanceof LlmError && e.code === 'parse' && (!signal || !signal.aborted);

    let lastErr;
    for (let attempt = 0; attempt < MAX_PARSE_RETRIES; attempt++) {
      const curMax = Math.min(maxTokens * MAX_TOKENS_GROWTH[attempt] | 0, MAX_TOKENS_CEILING);
      const curTemp = +(TEMPERATURE_DECAY[attempt] * temperature).toFixed(3);
      try {
        return await completeOnce({
          messages, jsonMode,
          maxTokens: curMax,
          temperature: curTemp,
          signal,
        });
      } catch (e) {
        if (!isRetryable(e)) throw e;
        lastErr = e;
        if (attempt < MAX_PARSE_RETRIES - 1) {
          const nextMax = Math.min(maxTokens * MAX_TOKENS_GROWTH[attempt + 1] | 0, MAX_TOKENS_CEILING);
          const nextTemp = +(TEMPERATURE_DECAY[attempt + 1] * temperature).toFixed(3);
          console.warn(
            `[llm] attempt ${attempt + 1}/${MAX_PARSE_RETRIES} failed (${e.message}), ` +
            `retrying with maxTokens=${nextMax}, temperature=${nextTemp}`
          );
        }
      }
    }
    throw new LlmError(
      lastErr?.status || 200,
      'parse',
      `LLM returned no content after ${MAX_PARSE_RETRIES} attempts (last: ${lastErr?.message || 'unknown'})`
    );
  }
  async function completeOnce({ messages, jsonMode, maxTokens, temperature, signal }) {
    const apiKey = (state?.apiKey || '').trim();
    if (!apiKey) {
      throw new LlmError(0, 'auth', '请先填写 API Key');
    }
    const model = persist.getLlmModel() || DEFAULT_MODEL;
    const isMock = apiKey.startsWith(MOCK_PREFIX);
    const endpoint = isMock ? MOCK_LLM_ENDPOINT : _llmEndpoint();

    const body = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    };
    if (jsonMode && !isMock) body.response_format = { type: 'json_object' };
    // Mock ignores response_format — it hard-codes a JSON content string,
    // which our parser handles the same way.

    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Mock endpoint doesn't auth-check; we still send the key so the
          // server can log it. Real endpoint requires the Bearer token.
          ...(isMock ? {} : { 'Authorization': `Bearer ${apiKey}` }),
        },
        body: JSON.stringify(body),
        signal,
      });
      if (isMock) console.log('[llm] using mock endpoint');
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new LlmError(0, 'network', `Network error: ${e.message || e}`);
    }

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 300); } catch {}
      let code = 'bad_request';
      if (res.status === 401 || res.status === 403) code = 'auth';
      else if (res.status === 429) code = 'rate_limit';
      throw new LlmError(res.status, code, `HTTP ${res.status} · ${detail || res.statusText}`);
    }

    let raw;
    try {
      raw = await res.json();
    } catch (e) {
      throw new LlmError(res.status, 'parse', `Response is not valid JSON: ${e.message}`);
    }

    const content = raw?.choices?.[0]?.message?.content;
    // Phase 8 (bug fix, take 2): real GMI sometimes returns content as
    // a *partial* JSON object (not a string) when the response was
    // truncated by max_tokens. Before throwing, try to recover a string
    // from a few common shapes:
    //   1. string                     → use as-is
    //   2. { prompt / text / content }  → use that nested field
    //   3. array of {type:'text', text}  → concat text fields
    //   4. anything else                → fall through to the throw
    let recovered = null;
    if (typeof content === 'string') {
      recovered = content;
    } else if (content && typeof content === 'object') {
      if (typeof content.prompt === 'string') recovered = content.prompt;
      else if (typeof content.text === 'string') recovered = content.text;
      else if (typeof content.content === 'string') recovered = content.content;
      else if (Array.isArray(content)) {
        const parts = content
          .map((p) => (p && typeof p.text === 'string' ? p.text : null))
          .filter(Boolean);
        if (parts.length) recovered = parts.join('\n');
      }
      // Else: unrecognised object shape — leave recovered=null and
      // throw below. We intentionally do NOT JSON.stringify as a
      // last-ditch: that would silently return '"{garbage}"' to the
      // caller and hide the real upstream bug.
    }
    if (recovered == null) {
      const finishReason = raw?.choices?.[0]?.finish_reason;
      const message = raw?.choices?.[0]?.message;
      // Print a single-line JSON dump so users can paste it without
      // needing to click-to-expand in DevTools. Truncate very large
      // `raw` payloads so a single record stays readable.
      let rawDump = null;
      try { rawDump = JSON.stringify(raw); } catch {}
      if (rawDump && rawDump.length > 1200) rawDump = rawDump.slice(0, 1200) + '…(truncated)';
      console.error(
        '[llm] no string content in response\n' +
        '  finishReason: ' + JSON.stringify(finishReason) + '\n' +
        '  messageKeys:  ' + JSON.stringify(message ? Object.keys(message) : null) + '\n' +
        '  contentType:  ' + JSON.stringify(typeof message?.content) + '\n' +
        '  content:      ' + JSON.stringify(message?.content) + '\n' +
        '  raw:          ' + rawDump
      );
      const reason = finishReason === 'length'
        ? `No content (truncated: finish_reason=length, max_tokens=${maxTokens})`
        : `No content in response.choices[0].message (finish_reason=${finishReason || 'unknown'})`;
      throw new LlmError(res.status, 'parse', reason);
    }
    const contentStr = recovered;

    return { content: contentStr, raw, usage: raw.usage || null };
  }

  /* ─────────────────────────────────────────────────────
   * 1. 标题 + 歌词 联合生成
   * ───────────────────────────────────────────────────── */
  async function generateTitleAndLyrics({ theme, languages = ['zh'], targetLen = 600, signal } = {}) {
    if (!theme || !theme.trim()) {
      throw new LlmError(0, 'bad_request', 'Theme is required');
    }
    const langNote = languages.length > 1
      ? `Use multiple languages. Mark each section with [lang:xx] meta tag (xx in ${languages.join(',')}).`
      : `Write entirely in ${languageName(languages[0])}. Do NOT use [lang:xx] tags.`;

    const systemPrompt = `You are a songwriter. Output STRICT JSON:
{
  "title": "Song title (max 30 chars)",
  "lyrics": "Full lyrics with structure tags, ${targetLen} chars target"
}

Rules:
- Structure tags: [intro] [verse] [pre chorus] [chorus] [bridge] [hook] [inst] [solo] [outro]
- One tag per line, then 2-4 lines of lyrics per section
- TAG FORMAT — CRITICAL: Every section tag MUST occupy its own line. Lyrics follow on the line(s) AFTER the tag. NEVER inline a tag with the first lyric word (NEVER write "[verse]I met you on a summer day" — write "[verse]\\nI met you on a summer day"). Inline tags break downstream parsing and the lyrics on that line get dropped.
- ${langNote}
- ${targetLen} chars target (±20%)
- No prose, no markdown, no \`\`\` blocks
- JSON only, parseable by JSON.parse`;

    const userPrompt = `Theme: ${theme.trim()}\n\nGenerate a song matching this theme.`;

    const { content } = await complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      jsonMode: true,
      maxTokens: Math.max(800, Math.ceil(targetLen * 1.6)),
      temperature: 0.9,
      signal,
    });

    let parsed;
    try { parsed = JSON.parse(content); }
    catch { throw new LlmError(200, 'parse', 'LLM did not return valid JSON'); }

    return {
      title: (parsed.title || '').trim().slice(0, 60),
      // Phase 13 (P13-1): prompt 强化 + 客户端兜底 — 把 inline tag ([verse]xxx)
      // 强制改写为独占行 ([verse]\nxxx),防止下游解析丢行。
      lyrics: _normalizeLyricsInlineTags((parsed.lyrics || '').trim()),
    };
  }

  /* ─────────────────────────────────────────────────────
   * 1.5 T3: 批量生产线 — 一次性派生 N 个独立角度
   *    用于"Theme 一次 + 自动派生 N 个不同角度",
   *    保证 N 首歌的视角/意象/情绪互不重复。
   *    返回 string[] 长度 N,失败抛 LlmError。
   * ───────────────────────────────────────────────────── */
  async function generateAngles({ theme, count = 4, signal } = {}) {
    if (!theme || !theme.trim()) {
      throw new LlmError(0, 'bad_request', 'Theme is required');
    }
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      throw new LlmError(0, 'bad_request', 'count must be 1..50');
    }
    const systemPrompt = `You are a creative director. Given a song theme, generate ${count} DISTINCT angles for songs that share the theme.

Output STRICT JSON:
{
  "angles": ["angle 1", "angle 2", ..., "angle ${count}"]
}

Rules:
- Each angle is a single short sentence (10-30 words) describing one unique perspective, scene, character, or emotional hook.
- Angles MUST be distinct from each other (different POV, different time of day, different relationship dynamic, different genre-adjacent vibe).
- No two angles should feel like the same song idea rephrased.
- Output JSON only, parseable by JSON.parse. No prose, no markdown, no \`\`\` blocks.`;

    const userPrompt = `Theme: ${theme.trim()}\n\nGenerate ${count} distinct angles for songs that match this theme.`;

    const { content } = await complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      jsonMode: true,
      // 每条 angle 约 30 词,JSON 总开销 ~50 tokens/angle + system overhead
      maxTokens: 80 + count * 60,
      temperature: 0.95,  // 角度要发散,温度高一些
      signal,
    });

    let parsed;
    try { parsed = JSON.parse(content); }
    catch { throw new LlmError(200, 'parse', 'LLM did not return valid JSON'); }

    const angles = Array.isArray(parsed?.angles) ? parsed.angles : [];
    const cleaned = angles
      .map((a) => (typeof a === 'string' ? a.trim() : ''))
      .filter((a) => a.length > 0)
      .slice(0, count);

    if (cleaned.length === 0) {
      throw new LlmError(200, 'parse', 'LLM returned empty angles array');
    }
    // 如果 LLM 给少了(常见:count 大时),用空字符串补足 — 上层会把 angle 接到 theme 后,
    // 空 angle 等价于"无角度提示",不会让 generateBatchVariations 崩
    while (cleaned.length < count) cleaned.push('');

    return cleaned;
  }

  /* ─────────────────────────────────────────────────────
   * 1.75 Phase 10 (P10-2): 歌名 + 歌词 + 音乐提示词 三合一
   *    1 次 LLM 调用返回 {title, lyrics, prompt}。参考官方
   *    music-caption-rewriter 的 5 段输入边界 + 5 级 constraint
   *    precedence + 4 段自检清单。失败/字段缺失自动降级到老的两步。
   * ───────────────────────────────────────────────────── */
  async function generateSongPackage({
    theme,
    languages = ['zh'],
    targetLen = 600,
    promptMode = 'random',
    locked = {},
    signal,
  } = {}) {
    if (!theme || !theme.trim()) {
      throw new LlmError(0, 'bad_request', 'Theme is required');
    }
    const { genre = [], mood = [], vocal = [] } = locked;
    const langNote = languages.length > 1
      ? `Use multiple languages. Mark each section with [lang:xx] meta tag (xx in ${languages.join(',')}).`
      : `Write entirely in ${languageName(languages[0])}. Do NOT use [lang:xx] tags.`;

    // 5 段输入边界 (mirrors music-caption-rewriter "Inputs")
    const systemPrompt = `You are a senior music director and songwriter. You produce generation-ready metadata for a music model in one strict JSON output. You never output prose, markdown, or \`\`\` blocks.

# Inputs you receive
1. Theme — a free-form subject, mood, or scenario
2. Languages — one or more language codes (e.g. zh, en)
3. Locked tags — pre-pinned genre/mood/vocal labels the user has chosen
4. Format — JSON object with three top-level string fields: title, lyrics, prompt
5. Exclusions — implicit: do not output BPM/key, do not copy theme, no marketing prose

# Constraint precedence (highest wins)
1. Locked tags (user-chosen) — must appear verbatim in \`prompt\` field
2. Length bounds — \`lyrics\` within ±20% of ${targetLen} chars
3. Language rules — ${langNote}
4. Theme fidelity — single coherent narrative, no contradictions
5. Style freedom — when no locked tag applies, choose freely from the supported genres

# Output contract (strict JSON, no other text)
{
  "title":  "Song title (max 30 chars)",
  "lyrics": "Section-tagged lyrics, ~${targetLen} chars target",
  "prompt": "Comma-separated tags for music model, max 200 chars"
}

\`prompt\` MUST start with all locked tags verbatim (in any order, comma-separated), then optional 2-6 freely-chosen tags from genre/mood/vocal. Total ≤ 200 chars, no period at end.

Locked tags to embed in \`prompt\`:
- Genre: ${genre.join(', ') || '(none)'}
- Mood:  ${mood.join(', ')  || '(none)'}
- Vocal: ${vocal.join(', ') || '(none)'}

# Self-check before responding (silent, do not output)
[ ] All locked tags present in \`prompt\` field, verbatim
[ ] \`lyrics\` within ±20% of ${targetLen} chars
[ ] Every section starts with one tag from [intro,verse,pre-chorus,chorus,bridge,hook,inst,solo,outro]
[ ] Every tag is on its own line. NEVER inline a tag with the first lyric word (NEVER write "[verse]I met you on a summer day" — write "[verse]\\nI met you on a summer day"). Inline tags break downstream parsing and the lyrics on that line get dropped.
[ ] \`prompt\` ≤ 200 chars, comma-separated, no markdown`;

    const userPrompt = `Theme: ${theme.trim()}

Locked tags (must appear in \`prompt\` field verbatim):
- Genre: ${genre.join(', ') || '(none)'}
- Mood:  ${mood.join(', ')  || '(none)'}
- Vocal: ${vocal.join(', ') || '(none)'}

Languages: ${languages.join(', ')}
Target lyrics length: ${targetLen} chars (±20%)
Prompt mode: ${promptMode} (fixed = locked only; locked_random = locked + 1-3 extras; random = ignore locked)`;

    try {
      const { content } = await complete({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        jsonMode: true,
        // Phase 8 (bug fix): reasoning model needs headroom; package is
        // 3 fields × ~targetLen tokens. Allow 2.4× to keep finish_reason=stop.
        maxTokens: Math.max(900, Math.ceil(targetLen * 2.4)),
        // Lower from default 0.9 → 0.7 to keep title+lyrics focused.
        temperature: 0.7,
        signal,
      });

      let parsed;
      try { parsed = JSON.parse(content); }
      catch { throw new LlmError(200, 'parse', 'LLM did not return valid JSON'); }

      const out = {
        title:  (typeof parsed.title  === 'string' ? parsed.title.trim()  : '').slice(0, 60),
        // Phase 13 (P13-1): prompt 强化 + 客户端兜底 — 把 inline tag 强制改写为独占行
        lyrics: _normalizeLyricsInlineTags(typeof parsed.lyrics === 'string' ? parsed.lyrics.trim() : ''),
        prompt: (typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '').slice(0, 200),
      };
      if (!isComplete(out)) {
        throw new LlmError(200, 'parse', 'song package missing required fields');
      }
      return out;
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      console.warn('[llm] songPackage failed, falling back to two-step:', e?.message || e);
      // 降级:串行两步。沿用现有 generateTitleAndLyrics + generateMusicPrompt
      // 的输出契约,UI 无感。
      // Phase 18 (P18-3): 如果 two-step 也 fail,把两层错误信息聚合抛出,
      // UI 能看到完整诊断,不再静默吞掉。
      try {
        const tl = await generateTitleAndLyrics({ theme, languages, targetLen, signal });
        const prompt = await generateMusicPrompt({ mode: promptMode, locked, signal });
        return { title: tl.title, lyrics: tl.lyrics, prompt };
      } catch (twoStepErr) {
        if (twoStepErr?.name === 'AbortError') throw twoStepErr;
        const pkgMsg = (e?.message || String(e)).slice(0, 140);
        const tsMsg = (twoStepErr?.message || String(twoStepErr)).slice(0, 140);
        throw new LlmError(
          twoStepErr?.status || 200,
          twoStepErr?.code || 'parse',
          `songPackage+fallback both failed: pkg="${pkgMsg}" twoStep="${tsMsg}"`
        );
      }
    }
  }
  // Validate that a song-package object has all three required non-empty
  // string fields. Used by generateSongPackage's primary path to decide
  // whether to fall back to the two-step pipeline.
  function isComplete(pkg) {
    return pkg
      && typeof pkg.title  === 'string' && pkg.title.length  > 0
      && typeof pkg.lyrics === 'string' && pkg.lyrics.length > 0
      && typeof pkg.prompt === 'string' && pkg.prompt.length > 0;
  }

  /* ─────────────────────────────────────────────────────
   * 2. Music prompt 生成
   * ───────────────────────────────────────────────────── */
  async function generateMusicPrompt({ mode = 'random', locked = {}, signal } = {}) {
    const { genre = [], mood = [], vocal = [] } = locked;

    let instructions;
    if (mode === 'fixed') {
      if (genre.length + mood.length + vocal.length === 0) {
        throw new LlmError(0, 'bad_request', 'Fixed mode requires at least one locked tag');
      }
      instructions = `Use EXACTLY these tags and nothing more:
- Genre: ${genre.join(', ') || '(none)'}
- Mood: ${mood.join(', ') || '(none)'}
- Vocal: ${vocal.join(', ') || '(none)'}

Output: comma-separated phrase, ≤150 chars, no period at end.`;
    } else if (mode === 'locked_random') {
      instructions = `Keep these locked tags, then ADD 1-3 complementary tags from a different category.
Locked: ${[...genre, ...mood, ...vocal].join(', ') || '(none)'}

Output: comma-separated phrase, ≤150 chars, no period at end.`;
    } else {
      // random
      instructions = `Pick 3-5 tags total across genre, mood, and vocal — vary it.
Use a creative, fresh combination. Avoid clichés.

Output: comma-separated phrase, ≤150 chars, no period at end.`;
    }

    const systemPrompt = `You generate music generation prompts for a text-to-music model.
You MUST output valid JSON: {"prompt": "<comma-separated tags, ≤150 chars, no period at end>"}
No other text, no markdown fences, no extra fields.

${instructions}`;

    const { content } = await complete({
      messages: [
        { role: 'system', content: systemPrompt },
        // Phase 8 (bug fix): GMI sometimes returns an empty/null content
        // when user message is too short ("Generate one prompt.") and
        // json_mode is off — the model hits EOS with no body. Give it
        // a slightly more explicit anchor prompt so it always has a
        // direction. Locked tags are also embedded so the model has
        // a concrete starting point.
        {
          role: 'user',
          content: lockedGenreMoodVocal(locked)
            ? `Locked tags to start from: ${lockedGenreMoodVocal(locked)}.`
            : `Please output one short music generation prompt phrase now.`,
        },
      ],
      jsonMode: true,
      // Phase 8 P1: real GMI endpoint (MiniMaxAI/MiniMax-M2.7) is a
      // reasoning model — it spends 200-300 tokens on chain-of-thought
      // before the actual content. maxTokens=200 was too tight: the
      // model's reasoning_content alone filled the budget, leaving
      // content=null + finish_reason=length. Raise the default to 500
      // so the model has room for both thinking AND the final JSON
      // body in a single call (retry stays as the safety net).
      maxTokens: 500,
      // Lower from 1.0 → 0.7 to reduce reasoning exploration steps;
      // keeps the same fixed-mode 0.3 for deterministic output.
      temperature: mode === 'fixed' ? 0.3 : 0.7,
      signal,
    });

    // Tolerate both shapes: a bare prompt phrase, or a JSON object with
    // { prompt: "..." } (some models wrap the output even without json_mode).
    let out = content.trim().replace(/^["']|["']$/g, '');
    if (out.startsWith('{')) {
      try {
        const parsed = JSON.parse(out);
        if (typeof parsed.prompt === 'string') out = parsed.prompt.trim();
        else if (typeof parsed.text === 'string') out = parsed.text.trim();
      } catch { /* not JSON — keep raw text */ }
    }
    return out.slice(0, 200);
  }

  // ── 药丸标签预置词典 ─────────────────────────────
  // Phase 10 (P10-3): 扩展 8+8+8 → 12+12+12 = 36, 覆盖官方 18 family
  // 中用户最可能直接选的 4 个 genre。旧 tag 名 100% 保留(向后兼容,
  // 已有 session/library 不会丢标签)。新 tag 选择贴近官方 family 名,
  // 但用人类可读形式(kebab-case → Title Case)以便 pill UI 显示。
  const PILL_TAGS = {
    genre: [
      // 旧 8 (保持原有顺序与拼写)
      'Indie folk', 'Lo-fi hip hop', 'Synthwave', 'Jazz ballad',
      'Cinematic orchestral', 'City pop', 'Trap', 'Dream pop',
      // 新 4: 官方 family 的可读版本
      'East Asian modern', 'East Asian ballad', 'Modern R&B', 'Soul and gospel',
    ],
    mood: [
      // 旧 8
      'melancholic', 'hopeful', 'nostalgic', 'dreamy',
      'energetic', 'serene', 'romantic', 'mysterious',
      // 新 4
      'bittersweet', 'anthemic', 'ethereal', 'noir',
    ],
    vocal: [
      // 旧 8
      'soft female vocal', 'warm male vocal', 'breathy whisper',
      'choir ensemble', 'no vocal', 'raspy alto', 'duet',
      'spoken word',
      // 新 4
      'airy soprano', 'gritty baritone', 'falsetto', 'operatic',
    ],
  };

  // ── helpers ────────────────────────────────────────
  function languageName(code) {
    return ({ en: 'English', zh: 'Chinese (Simplified)', ja: 'Japanese', ko: 'Korean', es: 'Spanish' })[code] || code;
  }
  // Phase 8 (bug fix): used by generateMusicPrompt to enrich the user
  // message — GMI in plain mode (no response_format) sometimes returns
  // empty content for ultra-short user messages, so we anchor the prompt
  // with the user's locked tags to give the model a concrete starting
  // point. Always returns a non-empty string.
  function lockedGenreMoodVocal({ genre = [], mood = [], vocal = [] } = {}) {
    return [...genre, ...mood, ...vocal].filter(Boolean).join(', ');
  }
  // Phase 13 (P13-1): safety net for LLM lyrics output. If the model writes
  // "[verse]I met you on a summer day" instead of
  //   [verse]
  //   I met you on a summer day
  // we split inline tags onto their own line so downstream parsing keeps every
  // lyric line. Prompt 强化是治本(让模型少犯),这个函数是兜底(让错误无法
  // 到达 UI)。只在 LLM 输出路径用,不动用户已 Apply 的 state.lyrics。
  //
  // 规则:
  //   - 匹配 [tag] / [tag:lang] / [tag:en,ja] 紧跟非换行字符(可能含前导空格) →
  //     在 ] 后插入 \n,把歌词挤到下一行并吃掉中间空格,得到 [tag]\n<lyric>
  //   - 已正确格式 (tag 后是 \n) → no-op
  //   - 行末 tag (无 lyric 文字) → no-op
  //   - 非字符串 / 空字符串 → no-op
  //   - 修复范围:行首 AND 歌词中间 — 任何 inline [tag] 都会修正,符合 Suno 格式
  function _normalizeLyricsInlineTags(lyrics) {
    if (typeof lyrics !== 'string' || !lyrics) return lyrics;
    return lyrics.replace(/\[([^\]\n]+)\][ \t]*/g, (m, tag, offset, src) => {
      const after = src.slice(offset + m.length);
      if (after.length === 0) return m;            // 行末(无 lyric 文字)→ no-op
      if (after[0] === '\n') return m;              // 已正确格式 → no-op
      return `[${tag}]\n`;                          // inline → 修正
    });
  }

  /* ─────────────────────────────────────────────────────
   * 3. 批量变体生成 (Phase 2)
   *    串行 N 次: 每首独立 (title, lyrics, prompt)
   *    sleep 200ms 间隔 (避免突发);任一首失败→该项标 planned_failed,
   *    不影响其他项继续
   * ───────────────────────────────────────────────────── */
  async function generateBatchVariations({
    count,
    theme,
    languages = ['zh'],
    targetLen = 600,
    promptMode = 'random',
    locked = {},
    angleHints = null,  // Phase 8 (P7): 生产线 T3 — string[] 长度 N,每首用对应 hint;空/falsy 时回退到默认 "Variation #i of N" 提示
    onProgress = null,  // ({index, total, stage, item}) => void
    signal,
  } = {}) {
    if (!Number.isInteger(count) || count < 1) {
      throw new LlmError(0, 'bad_request', 'count must be a positive integer');
    }
    const out = [];
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) {
        // Mark remaining as cancelled
        for (let j = i; j < count; j++) {
          out.push({ idx: j, status: 'planned_failed', title: '', lyrics: '', prompt: '', error: 'cancelled' });
        }
        break;
      }
      // Each variation gets a slightly different "angle" hint to encourage
      // diversity. Caller can pass an explicit angleHints[] (production line
      // T3 mode); falls back to a generic Variation #i prompt if not provided.
      let angleHint;
      if (Array.isArray(angleHints) && angleHints[i] && angleHints[i].trim()) {
        angleHint = `Distinct angle for THIS song only: ${angleHints[i].trim()}\nDo NOT copy imagery or phrasing from any other song in this batch.`;
      } else if (i > 0) {
        angleHint = `Variation #${i + 1} of ${count}: try a slightly different angle, mood, or imagery while staying true to the theme. Avoid copying earlier verses.`;
      } else {
        angleHint = '';
      }

      const stageLyrics = { index: i, total: count, stage: 'lyrics', item: null };
      onProgress?.(stageLyrics);

      const result = { idx: i, status: 'ready', title: '', lyrics: '', prompt: '', error: null };
      try {
        // Phase 10 (P10-2): collapse two LLM calls per variation into one
        // generateSongPackage call. The function falls back to the two-step
        // pipeline internally if the unified response is malformed.
        const pkg = await generateSongPackage({
          theme: angleHint ? `${theme}\n\n${angleHint}` : theme,
          languages,
          targetLen,
          promptMode,
          locked,
          signal,
        });
        result.title  = pkg.title  || `track #${String(i + 1).padStart(2, '0')}`;
        result.lyrics = pkg.lyrics || '';
        result.prompt = pkg.prompt || '';
        onProgress?.({ index: i, total: count, stage: 'lyrics', item: { ...result } });
        onProgress?.({ index: i, total: count, stage: 'prompt', item: { ...result } });
      } catch (e) {
        if (e.name === 'AbortError') {
          result.status = 'planned_failed';
          result.error = 'cancelled';
        } else {
          result.status = 'planned_failed';
          result.error = e?.message || String(e);
        }
        onProgress?.({ index: i, total: count, stage: 'done', item: { ...result } });
      }
      out.push(result);
      // Small delay between variations
      if (i < count - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    return out;
  }

  NS.register('llm', {
    constants: { DEFAULT_MODEL, TEMPLATES },
    PILL_TAGS,
    LlmError,
    complete,
    generateTitleAndLyrics,
    generateMusicPrompt,
    generateBatchVariations,
    generateAngles,
    // Phase 10 (P10-2): unified song package (1 LLM call → {title, lyrics, prompt}).
    generateSongPackage,
  });

  console.log('[MusicStudio] llm loaded (Phase 1)');
})(window);
