/* ===========================================================
 * job.js  ·  Phase 0
 * ------------------------------------------------------------
 * Job 队列的「数据模型 + schema + factory」层。
 * 调度器在 Phase 4 接入,本阶段仅定义形状并提供构造函数。
 *
 * 暴露:
 *   MusicStudio.job = {
 *     schemaVersion,            // 当前 schema 版本号
 *     create({ config }),       // -> job 对象 (只生成,不写入 IDB)
 *     taskFactory(idx),         // -> task 对象
 *     isValidTask(t),           // 校验
 *   }
 * =========================================================== */
(function (root) {
  'use strict';
  if (!root.MusicStudio) { console.error('[job] core.js must load first'); return; }

  const NS = root.MusicStudio;

  // 当前 schema 版本,Phase 4 升级时做迁移用
  const schemaVersion = 1;

  function taskFactory(idx) {
    return {
      id: `t_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
      idx,
      // status 状态机:
      //   queued → planning → ready → running → success
      //                                 ↘ failed
      //                  ↘ planned_failed (LLM 失败,跳过 music)
      //                  ↘ cancelled
      status: 'queued',
      progress: 0,
      title: '',
      lyrics: '',
      prompt: '',
      audioUrl: null,
      audioMeta: null,        // {durationMs, format, sampleRate, bitrate, sizeBytes}
      llmError: null,
      musicError: null,
      llmAttempts: 0,
      musicAttempts: 0,
      favorite: false,
      deleted: false,          // 软删除标记
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function create({ config } = {}) {
    return {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      schemaVersion,
      status: 'active',        // active | paused | done | cancelled
      config: config || {},    // 用户当时的参数(theme, languages, promptMode, lockedChips, llmModel ...)
      tasks: [],
      cursor: { planning: 0, running: 0 },  // 调度游标,Phase 4 启用
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function isValidTask(t) {
    return t && typeof t.id === 'string' && typeof t.status === 'string'
        && Number.isInteger(t.idx);
  }

  // ── Phase 4: 队列统计 + 续跑判定 ─────────────────
  // 仅包含「尚未结束」的状态 (success/failed/cancelled 都不算 active)
  const ACTIVE_STATUSES = new Set(['queued', 'running', 'planning']);

  function summarize(job) {
    const tasks = Array.isArray(job?.tasks) ? job.tasks : [];
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === 'success' || t.status === 'failed' || t.status === 'cancelled').length;
    const ok = tasks.filter((t) => t.status === 'success').length;
    const err = tasks.filter((t) => t.status === 'failed').length;
    const skip = tasks.filter((t) => t.status === 'cancelled').length;
    const live = total - done;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { total, done, ok, err, skip, live, pct };
  }

  function isResumable(job) {
    if (!job || job.status !== 'active') return false;
    return Array.isArray(job.tasks) && job.tasks.some((t) => ACTIVE_STATUSES.has(t.status));
  }

  // 把任务列表按 idx 升序排好;剔除掉无 idx 的损坏项
  function reorderForResume(job) {
    if (!job || !Array.isArray(job.tasks)) return [];
    return job.tasks
      .filter((t) => Number.isInteger(t.idx))
      .slice()
      .sort((a, b) => a.idx - b.idx)
      .map((t) => ({
        // 重新规整字段:丢掉 controller (跨页面无效),保留 metadata 用于续跑
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
        startedAt: t.startedAt || Date.now(),
        // 续跑标识:这批任务来自历史 job (UI 可能用得上)
        resumed: true,
      }));
  }

  NS.register('job', {
    schemaVersion,
    create,
    taskFactory,
    isValidTask,
    summarize,
    isResumable,
    reorderForResume,
    ACTIVE_STATUSES,
  });

  console.log('[MusicStudio] job loaded · schema v' + schemaVersion);
})(window);
