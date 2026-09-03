/* ===========================================================
 * jobs-rail.js  ·  Phase 23
 * ------------------------------------------------------------
 * 左侧"历史任务"侧栏 — 以「任务组(job)」为粒度渲染,而非「track」。
 *
 * 数据源: NS.library.jobs.list()  (store: minimax-jobs)
 * 每个 job 文档形状 (见 js/job.js):
 *   {
 *     id, status, config, tasks[],
 *     title?, createdAt, updatedAt?
 *   }
 *   tasks[]: { id, idx, status, title, lyrics, prompt,
 *              audioBlob?, audioUrl?, audioMeta?, error? }
 *
 * 渲染规则:
 *   - 单轨 (tasks.length === 1) → 1 row, 不展开
 *   - 多轨                    → 1 row header + 子任务列表(可折叠)
 *   - active job 永远展开     → 子任务显示实时状态
 *   - done/cancelled 折叠     → 点 header 展开看子任务
 *   - active + 有未完子任务    → header 显示 "Resume" 链接
 *
 * 依赖: NS.library.jobs (list/get/put/del),
 *       NS.i18n.t() (可选, 缺则用英文 fallback),
 *       NS.events.on('task:state'|'task:success'|'task:progress', ...) 触发重渲染
 *
 * 不依赖: NS.sessions (Phase 9-22 的 sessions store 不再写入; 老数据保留在 IDB)
 *
 * 暴露: MusicStudio.jobsRail = { mount(), render() }
 * =========================================================== */
(function (root) {
  'use strict';
  if (!root.MusicStudio) { console.error('[jobs-rail] core.js must load first'); return; }

  const NS = root.MusicStudio;
  const VISIBLE_LIMIT = 50;   // 折叠前最多显示 N 个 job
  const SUBTASK_MAX_HEIGHT = 200;  // 子任务列表内部 max-height

  // ── DOM refs ──
  let _listEl, _emptyEl, _moreEl;

  // ── state ──
  let _all = [];            // 全量 job 缓存
  let _expandedIds = new Set();  // 用户手动展开的 job id
  let _resumedIds = new Set();  // 已被用户主动 Resume 过的 job id(防止反复弹)

  // ── helpers ──
  function _t(key, fallback) {
    return (NS.i18n && NS.i18n.t && NS.i18n.t(key)) || fallback;
  }

  function _fmtAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1)  return _t('nav.task.ago.now', 'now');
    if (m < 60) return m + _t('nav.task.ago.min', 'm');
    const h = Math.floor(m / 60);
    if (h < 24) return h + _t('nav.task.ago.hour', 'h');
    const d = Math.floor(h / 24);
    if (d < 7)  return d + _t('nav.task.ago.day', 'd');
    return new Date(ts).toLocaleDateString();
  }

  // 推断 job 标题(老 job 没 title 字段时)
  function _deriveJobTitle(j) {
    if (j.title) return j.title;
    const cfg = j.config || {};
    if (cfg.theme && String(cfg.theme).trim()) return String(cfg.theme).trim().slice(0, 40);
    const first = (j.tasks || [])[0];
    if (first && first.title) return first.title;
    return _t('nav.task.unnamed', 'Task');
  }

  function _jobStats(j) {
    const tasks = Array.isArray(j.tasks) ? j.tasks : [];
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === 'success').length;
    const failed = tasks.filter((t) => t.status === 'failed').length;
    const cancelled = tasks.filter((t) => t.status === 'cancelled').length;
    const active = tasks.filter((t) => t.status === 'running' || t.status === 'planning' || t.status === 'queued').length;
    const finished = done + failed + cancelled;
    const pct = total > 0 ? Math.round((finished / total) * 100) : 0;
    return { total, done, failed, cancelled, active, finished, pct };
  }

  // job 是否处于"可续跑"状态(active + 仍有未完子任务)
  function _isResumable(j) {
    if (!j || j.status !== 'active') return false;
    const tasks = Array.isArray(j.tasks) ? j.tasks : [];
    if (tasks.length === 0) return false;
    return tasks.some((t) => t.status === 'queued' || t.status === 'planning' || t.status === 'running');
  }

  // job 是否应展开(active 永远展开, 否则按 _expandedIds)
  function _shouldExpand(j) {
    if (j.status === 'active') return true;
    return _expandedIds.has(j.id);
  }

  // 子任务状态 → 图标
  function _statusIcon(status) {
    switch (status) {
      case 'success':    return '✓';
      case 'failed':     return '✗';
      case 'cancelled':  return '⊘';
      case 'running':    return '⟳';
      case 'planning':   return '◌';
      case 'queued':     return '⏳';
      default:           return '·';
    }
  }

  function _subtaskHasAudio(t) {
    return !!(t && (t.audioBlob || t.audioUrl));
  }

  // ── DOM 构造 ──
  function _el(tag, cls, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) {
      for (const k in attrs) {
        if (k === 'text') e.textContent = attrs[k];
        else if (k === 'html') e.innerHTML = attrs[k];
        else if (k === 'dataset') {
          for (const dk in attrs[k]) e.dataset[dk] = attrs[k][dk];
        } else e.setAttribute(k, attrs[k]);
      }
    }
    return e;
  }

  function _buildHeaderRow(j) {
    const stats = _jobStats(j);
    const isMulti = stats.total > 1;
    const expanded = _shouldExpand(j);
    const title = _deriveJobTitle(j);

    const row = _el('div', 'tasks-item' + (expanded ? ' expanded' : ''));
    row.dataset.jobId = j.id;
    row.setAttribute('role', 'listitem');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-expanded', expanded ? 'true' : 'false');

    // 左: 折叠箭头
    if (isMulti) {
      const arrow = _el('span', 'tasks-arrow', { text: expanded ? '▾' : '▸' });
      arrow.setAttribute('aria-hidden', 'true');
      row.appendChild(arrow);
    } else {
      const sp = _el('span', 'tasks-arrow-spacer');
      row.appendChild(sp);
    }

    // 中: title
    const titleEl = _el('span', 'tasks-title', { text: title });
    titleEl.setAttribute('data-raw', title);
    titleEl.title = title + ' · ' + new Date(j.createdAt || 0).toLocaleString();
    row.appendChild(titleEl);

    // 中右: 进度摘要 (多轨)
    if (isMulti) {
      const summary = _el('span', 'tasks-summary', { text: `${stats.done}/${stats.total}` });
      row.appendChild(summary);
    }

    // 右: status badge / Resume
    if (_isResumable(j) && !_resumedIds.has(j.id)) {
      const resumeBtn = _el('button', 'tasks-resume', {
        type: 'button',
        text: _t('nav.task.resume', 'Resume'),
        title: _t('nav.task.resumeTitle', 'Resume this task'),
        'aria-label': _t('nav.task.resume', 'Resume'),
      });
      row.appendChild(resumeBtn);
    } else if (j.status === 'active') {
      const badge = _el('span', 'tasks-badge active', { text: _t('nav.task.active', 'Active') });
      row.appendChild(badge);
    } else if (j.status === 'done') {
      const badge = _el('span', 'tasks-badge done', { text: _t('nav.task.done', 'Done') });
      row.appendChild(badge);
    } else if (j.status === 'cancelled') {
      const badge = _el('span', 'tasks-badge cancelled', { text: _t('nav.task.cancelled', 'Cancelled') });
      row.appendChild(badge);
    }

    // 远右: ago
    const ago = _el('span', 'tasks-time', { text: _fmtAgo(j.updatedAt || j.createdAt) });
    row.appendChild(ago);

    // 最右: 删除
    const delBtn = _el('button', 'tasks-del', {
      type: 'button',
      text: '×',
      'aria-label': _t('nav.task.delete', 'Delete task'),
      title: _t('nav.task.delete', 'Delete task'),
    });
    row.appendChild(delBtn);

    return row;
  }

  function _buildSubtaskRow(j, t) {
    const isMulti = _jobStats(j).total > 1;
    const row = _el('div', 'tasks-subtask');
    row.dataset.jobId = j.id;
    row.dataset.taskId = t.id;
    row.dataset.taskIdx = String(t.idx);
    row.setAttribute('role', 'listitem');

    // 左: status icon
    const icon = _el('span', 'tasks-sub-icon ' + (t.status || 'unknown'), { text: _statusIcon(t.status) });
    icon.setAttribute('aria-hidden', 'true');
    row.appendChild(icon);

    // 中: idx + title
    const idxStr = String((t.idx || 0) + 1).padStart(2, '0');
    const subTitle = t.title || (_t('nav.task.subtitle', 'Track') + ' ' + idxStr);
    const titleEl = _el('span', 'tasks-sub-title', { text: `${idxStr} · ${subTitle}` });
    titleEl.title = subTitle;
    row.appendChild(titleEl);

    // ▶ 播放按钮(只在有 audio 时启用)
    const playBtn = _el('button', 'tasks-sub-play', { type: 'button' });
    const playable = _subtaskHasAudio(t);
    playBtn.disabled = !playable;
    const ariaLabel = playable
      ? _t('nav.task.subPlayAria', 'Play this track')
      : _t('nav.task.subNoAudio', 'No audio cached');
    playBtn.setAttribute('aria-label', ariaLabel);
    playBtn.setAttribute('title', ariaLabel);
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M5 3l14 9-14 9V3z"/></svg>';
    row.appendChild(playBtn);

    return row;
  }

  function _buildJobSection(j) {
    const stats = _jobStats(j);
    const isMulti = stats.total > 1;
    const expanded = _shouldExpand(j);

    const wrap = _el('div', 'tasks-job');
    wrap.dataset.jobId = j.id;

    const header = _buildHeaderRow(j);
    wrap.appendChild(header);

    if (isMulti && expanded) {
      const list = _el('div', 'tasks-sub-list');
      (j.tasks || []).forEach((t) => {
        list.appendChild(_buildSubtaskRow(j, t));
      });
      wrap.appendChild(list);
    }

    return wrap;
  }

  // ── events ──
  function _bindEvents() {
    if (!_listEl) return;

    _listEl.addEventListener('click', async (e) => {
      // 删除按钮
      const delBtn = e.target.closest('.tasks-del');
      if (delBtn) {
        e.stopPropagation();
        const jobId = delBtn.closest('.tasks-job')?.dataset.jobId;
        if (!jobId) return;
        if (!confirm(_t('nav.task.confirmDelete', 'Delete this task and its history?'))) return;
        try {
          await NS.library.jobs.del(jobId);
          _all = _all.filter((j) => j.id !== jobId);
          _expandedIds.delete(jobId);
          _resumedIds.delete(jobId);
          render();
        } catch (err) {
          console.warn('[jobs-rail] del failed', err);
        }
        return;
      }

      // Resume 按钮
      const resumeBtn = e.target.closest('.tasks-resume');
      if (resumeBtn) {
        e.stopPropagation();
        const jobId = resumeBtn.closest('.tasks-job')?.dataset.jobId;
        if (!jobId) return;
        _resumedIds.add(jobId);
        // 触发 NS.events 让 app.js 内部接收(resume 协议 Phase 4 已有)
        const j = _all.find((x) => x.id === jobId);
        if (j) {
          try {
            NS.events.emit('job:resume-request', j);
          } catch (err) {
            // 老版本无此事件:回退到 state.pendingResumeJobId
            state_pendingResumeJobId = jobId;
            render();
          }
        }
        return;
      }

      // 子任务 ▶ 按钮
      const subPlay = e.target.closest('.tasks-sub-play');
      if (subPlay) {
        e.stopPropagation();
        if (subPlay.disabled) return;
        const subtaskRow = subPlay.closest('.tasks-subtask');
        if (!subtaskRow) return;
        const { jobId, taskId } = subtaskRow.dataset;
        const j = _all.find((x) => x.id === jobId);
        const t = j && (j.tasks || []).find((x) => x.id === taskId);
        if (!t) return;
        if (!_subtaskHasAudio(t)) return;
        // 调用 app.js 暴露的 _setAudioSrc
        if (typeof _setAudioSrcFn === 'function') {
          _setAudioSrcFn(t.audioBlob || null, t.audioUrl || null);
          const audio = document.getElementById('audioEl');
          audio?.play?.().catch(() => {});
        }
        return;
      }

      // 子任务整行 click → 把 lyrics/prompt 灌回 form
      const subRow = e.target.closest('.tasks-subtask');
      if (subRow) {
        const { jobId, taskId } = subRow.dataset;
        const j = _all.find((x) => x.id === jobId);
        const t = j && (j.tasks || []).find((x) => x.id === taskId);
        if (t) _loadFormFromTask(t);
        return;
      }

      // header 整行 click → 折叠/展开(单轨不展开)
      const headerEl = e.target.closest('.tasks-item');
      if (headerEl) {
        const jobId = headerEl.closest('.tasks-job')?.dataset.jobId;
        if (!jobId) return;
        const j = _all.find((x) => x.id === jobId);
        if (!j) return;
        const isMulti = _jobStats(j).total > 1;
        if (!isMulti) {
          // 单轨: 灌回 form
          const t = (j.tasks || [])[0];
          if (t) _loadFormFromTask(t);
          return;
        }
        // 多轨: 折叠/展开
        if (_expandedIds.has(jobId)) _expandedIds.delete(jobId);
        else _expandedIds.add(jobId);
        render();
      }
    });

    // dblclick on header title → rename
    _listEl.addEventListener('dblclick', (e) => {
      const titleEl = e.target.closest('.tasks-title');
      if (!titleEl) return;
      e.stopPropagation();
      const jobId = titleEl.closest('.tasks-job')?.dataset.jobId;
      if (!jobId) return;
      const j = _all.find((x) => x.id === jobId);
      if (!j) return;
      _enterEditTitle(titleEl, j);
    });

    // 监听 task 事件, 自动重渲染
    NS.events.on('task:state',     () => scheduleRender());
    NS.events.on('task:success',   () => scheduleRender());
    NS.events.on('task:progress',  () => scheduleRender());
    NS.events.on('job:created',    () => scheduleRender());
    NS.events.on('job:updated',    () => scheduleRender());
  }

  // ── render ──
  let _renderTimer = null;
  function scheduleRender(delay) {
    if (_renderTimer) clearTimeout(_renderTimer);
    _renderTimer = setTimeout(() => { render(); }, delay || 80);
  }

  function render() {
    if (!_listEl) return;
    if (!NS.library || !NS.library.jobs) {
      _listEl.innerHTML = '';
      return;
    }
    NS.library.jobs.list().then((docs) => {
      _all = (docs || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const empty = _all.length === 0;
      if (_emptyEl) _emptyEl.classList.toggle('hidden', !empty);
      if (empty) {
        _listEl.innerHTML = '';
        if (_moreEl) _moreEl.style.display = 'none';
        return;
      }
      const visible = _all.slice(0, VISIBLE_LIMIT);
      _listEl.innerHTML = '';
      visible.forEach((j) => {
        _listEl.appendChild(_buildJobSection(j));
      });
      if (_moreEl) {
        const overflow = _all.length > VISIBLE_LIMIT;
        if (overflow) {
          _moreEl.style.display = '';
          _moreEl.textContent = _t('nav.task.more', `Show ${_all.length - VISIBLE_LIMIT} more`);
        } else {
          _moreEl.style.display = 'none';
        }
      }
    }).catch((e) => console.warn('[jobs-rail] list failed', e));
  }

  // ── rename ──
  function _enterEditTitle(titleEl, j) {
    const cur = titleEl.getAttribute('data-raw') || titleEl.textContent;
    titleEl.contentEditable = 'true';
    titleEl.setAttribute('data-prev', cur);
    titleEl.focus();
    // 选中全文
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
          // 同步内存
          const idx = _all.findIndex((x) => x.id === j.id);
          if (idx >= 0) _all[idx] = j;
        } catch (e) {
          console.warn('[jobs-rail] rename failed', e);
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

  // ── 内部引用:由 mount() 注入 app.js 的 helper ──
  let _setAudioSrcFn = null;
  let _loadFormFromTask = null;
  let state_pendingResumeJobId = null;  // 兜底

  // ── 入口 ──
  function mount(opts) {
    _listEl  = document.getElementById('tasksList');
    _emptyEl = document.getElementById('tasksEmpty');
    _moreEl  = document.getElementById('tasksMore');
    if (opts) {
      if (typeof opts.setAudioSrc === 'function') _setAudioSrcFn = opts.setAudioSrc;
      if (typeof opts.loadFormFromTask === 'function') _loadFormFromTask = opts.loadFormFromTask;
    }
    _bindEvents();
    render();
  }

  // ── 公开 ──
  NS.register('jobsRail', {
    mount,
    render,
    setExpanded(jobId, expanded) {
      if (expanded) _expandedIds.add(jobId);
      else _expandedIds.delete(jobId);
    },
    setResumed(jobId) { _resumedIds.add(jobId); },
  });
  console.log('[MusicStudio] jobs-rail loaded (Phase 23)');
})(window);
