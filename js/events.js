/* ===========================================================
 * events.js  ·  Phase 0
 * ------------------------------------------------------------
 * 极简 pub/sub,让 music 模块在状态变化时通知 app 模块刷新 DOM,
 * 避免 music 反向 import app 形成循环依赖
 *
 * 暴露:
 *   MusicStudio.events = { on, fire, off }
 * =========================================================== */
(function (root) {
  'use strict';
  if (!root.MusicStudio) { console.error('[events] core.js must load first'); return; }

  const NS = root.MusicStudio;
  const listeners = new Map();  // eventName -> Set<fn>

  function on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => off(name, fn);
  }
  function off(name, fn) {
    listeners.get(name)?.delete(fn);
  }
  function fire(name, payload) {
    listeners.get(name)?.forEach((fn) => {
      try { fn(payload); } catch (e) { console.error('[events] listener error for', name, e); }
    });
  }

  NS.events = { on, off, fire };
  console.log('[MusicStudio] events loaded');
})(window);
