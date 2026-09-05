/**
 * 3D Home Audio — HUD
 *
 * 极简浮层,挂在 #stage3d 容器顶部。
 * 职责:显示当前曲目名 / 播放按钮 / 进度条 / 频谱电平 / DSP 状态。
 * 不控制播放本身(交给 app.js 的 audioEl)。
 * 事件源:window.audioBus
 *
 * DOM 结构(inject 到 stageEl 内部):
 *   <div class="stage3d-hud-panel">
 *     <div class="hud-meter">  <!-- 顶部 24 段 LED 电平条 -->
 *       ...24 个 .hud-meter-seg + 24 个 .hud-meter-hold
 *     </div>
 *     <div class="hud-row">
 *       <div class="hud-track">
 *         <div class="hud-title">—</div>
 *         <div class="hud-sub">no track</div>
 *       </div>
 *       <div class="hud-stats">  <!-- DSP 状态 + dB -->
 *         <span class="hud-dsp">DSP: —</span>
 *         <span class="hud-db">−∞ dB</span>
 *       </div>
 *       <button class="hud-play" aria-label="播放/暂停">
 *         <svg class="ico-play" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
 *         <svg class="ico-pause" viewBox="0 0 24 24" fill="currentColor" style="display:none">
 *           <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
 *         </svg>
 *       </button>
 *       <div class="hud-progress"><div class="hud-progress-fill"></div></div>
 *     </div>
 *   </div>
 */

let _panel = null;
let _stageEl = null;
let _unsubs = [];

// 电平条配置
const METER_SEGS = 24;        // 总段数
const METER_GREEN_END = 16;   // 0..16 绿
const METER_YELLOW_END = 20;  // 16..20 黄
// 20..24 红(剩余)
const METER_HOLD_DECAY = 0.012; // hold 标记每帧衰减 1.2%,约 1.5s 归零
const METER_HOLD_MIN_PEAK = 0.04; // 低于此值不点亮 hold,避免常亮

function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// peak(0..1) → dB(FS),peak 0 映射到 -60dB 实际显示 -∞,peak 1 映射到 0dB
function peakToDb(peak) {
  if (!Number.isFinite(peak) || peak <= 0) return -Infinity;
  return 20 * Math.log10(peak);
}
function fmtDb(db) {
  if (!Number.isFinite(db) || db <= -60) return '−∞ dB';
  return `${db.toFixed(1)} dB`;
}

function ensurePanel(stageEl) {
  if (_panel && _stageEl === stageEl) return _panel;
  // 清理旧的
  if (_panel && _panel.parentNode) _panel.parentNode.removeChild(_panel);
  _stageEl = stageEl;

  const segsHtml = Array.from({ length: METER_SEGS }, (_, i) => {
    let colorClass = 'hud-meter-seg-green';
    if (i >= METER_YELLOW_END) colorClass = 'hud-meter-seg-red';
    else if (i >= METER_GREEN_END) colorClass = 'hud-meter-seg-yellow';
    return `<div class="hud-meter-seg ${colorClass}" data-i="${i}"></div>`;
  }).join('');
  const holdsHtml = Array.from({ length: METER_SEGS }, (_, i) => {
    let colorClass = 'hud-meter-hold-green';
    if (i >= METER_YELLOW_END) colorClass = 'hud-meter-hold-red';
    else if (i >= METER_GREEN_END) colorClass = 'hud-meter-hold-yellow';
    return `<div class="hud-meter-hold ${colorClass}" data-i="${i}" style="opacity:0"></div>`;
  }).join('');

  const panel = document.createElement('div');
  panel.className = 'stage3d-hud-panel';
  panel.innerHTML = `
    <div class="hud-meter" role="meter" aria-label="音频电平">
      <div class="hud-meter-segs">${segsHtml}</div>
      <div class="hud-meter-holds">${holdsHtml}</div>
    </div>
    <div class="hud-row">
      <div class="hud-track">
        <div class="hud-title">—</div>
        <div class="hud-sub">no track loaded</div>
      </div>
      <div class="hud-stats">
        <span class="hud-dsp" title="AnalyserNode 状态">DSP: —</span>
        <span class="hud-db" title="实时峰值电平">−∞ dB</span>
        <button type="button" class="hud-vhs" aria-label="切换 VHS 滤镜" aria-pressed="false" title="VHS 复古滤镜">
          <svg class="ico-vhs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="2.5" y="6" width="19" height="12" rx="2"/>
            <path d="M2.5 9.5h19M2.5 14.5h19"/>
            <circle cx="6" cy="6" r="0.8" fill="currentColor"/>
            <circle cx="6" cy="18" r="0.8" fill="currentColor"/>
            <circle cx="18" cy="6" r="0.8" fill="currentColor"/>
            <circle cx="18" cy="18" r="0.8" fill="currentColor"/>
          </svg>
          <span class="hud-vhs-label">VHS</span>
        </button>
      </div>
      <button type="button" class="hud-play" aria-label="播放/暂停">
        <svg class="ico-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 3l14 9-14 9V3z"/></svg>
        <svg class="ico-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="display:none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
      </button>
    </div>
    <div class="hud-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="hud-progress-fill"></div>
    </div>
  `;
  stageEl.appendChild(panel);
  _panel = panel;
  return panel;
}

export function mountHud(audioBus) {
  const stageEl = document.getElementById('stage3d');
  if (!stageEl) return;
  const panel = ensurePanel(stageEl);

  const titleEl = panel.querySelector('.hud-title');
  const subEl = panel.querySelector('.hud-sub');
  const playBtn = panel.querySelector('.hud-play');
  const icoPlay = panel.querySelector('.ico-play');
  const icoPause = panel.querySelector('.ico-pause');
  const progressBar = panel.querySelector('.hud-progress');
  const fill = panel.querySelector('.hud-progress-fill');
  const dspEl = panel.querySelector('.hud-dsp');
  const dbEl = panel.querySelector('.hud-db');
  const vhsBtn = panel.querySelector('.hud-vhs');
  const vhsLabel = panel.querySelector('.hud-vhs-label');
  const meterSegs = panel.querySelectorAll('.hud-meter-seg');
  const meterHolds = panel.querySelectorAll('.hud-meter-hold');

  // 初始状态
  const init = audioBus.getTrack();
  if (init) {
    titleEl.textContent = init.title || 'Untitled';
    subEl.textContent = init.source === 'generate' ? 'just generated' : 'from library';
  }

  // 订阅
  _unsubs.push(audioBus.on('track:loaded', (t) => {
    if (!t) return;
    titleEl.textContent = t.title || 'Untitled';
    subEl.textContent = t.source === 'generate' ? 'just generated' : 'from library';
    fill.style.width = '0%';
    progressBar.setAttribute('aria-valuenow', '0');
  }));

  _unsubs.push(audioBus.on('play', () => {
    icoPlay.style.display = 'none';
    icoPause.style.display = '';
  }));

  _unsubs.push(audioBus.on('pause', () => {
    icoPlay.style.display = '';
    icoPause.style.display = 'none';
  }));

  _unsubs.push(audioBus.on('ended', () => {
    icoPlay.style.display = '';
    icoPause.style.display = 'none';
  }));

  _unsubs.push(audioBus.on('progress', ({ current, duration, ratio }) => {
    const pct = Math.min(100, Math.max(0, (ratio || 0) * 100));
    fill.style.width = pct + '%';
    progressBar.setAttribute('aria-valuenow', String(Math.round(pct)));
    if (duration) {
      subEl.textContent = `${fmtTime(current)} / ${fmtTime(duration)}`;
    }
  }));

  // 播放按钮:点击切 audioEl 状态
  // F13-D: 捕获并打印 play() 失败原因(autoplay policy / 资源未就绪 /
  // source 被 Web Audio 接管后状态错乱等),方便排查"按了没反应"的问题
  playBtn.addEventListener('click', () => {
    const audio = document.getElementById('audioEl');
    if (!audio || !audio.src) return;
    if (audio.paused) {
      audio.play().catch((err) => {
        console.warn('[hud] audio.play() failed:', err && err.name, err && err.message);
      });
    } else {
      audio.pause();
    }
  });

  // ---- E5: 频谱电平 + DSP 状态 ----
  // 1) DSP 状态:只在 mount 时检查一次足够,变化时再更新
  const refreshDsp = () => {
    const ready = audioBus.isAnalyserReady ? audioBus.isAnalyserReady() : false;
    dspEl.textContent = ready ? 'DSP: ON' : 'DSP: OFF';
    dspEl.classList.toggle('hud-dsp-on', ready);
    dspEl.classList.toggle('hud-dsp-off', !ready);
  };
  refreshDsp();
  // 2) 订阅 level 事件,更新 dB + 喂给 meter RAF
  let _latestPeak = 0;
  let _latestRms = 0;
  _unsubs.push(audioBus.on('level', ({ peak = 0, rms = 0, source } = {}) => {
    _latestPeak = peak;
    _latestRms = rms;
    // F13-E: dB 文本改用 rms(真实响度感知),peak 只作为 hot 标记参考
    // rms 反映"听着有多大",peak 是瞬时最大;频段饱和的 sample 在 peak 上永远 0.0 dB
    // 但 rms 仍能显示真实音量(典型 -20 ~ -6 dB)
    dbEl.textContent = fmtDb(peakToDb(rms));
    dbEl.classList.toggle('hud-db-hot', peak > 0.85);
    // 反馈给用户:source 是 analyser 还是 fallback
    if (source === 'analyser') refreshDsp();
  }));

  // 3) meter RAF:把所有 .hud-meter-seg 按当前 peak 点亮
  //    + hold marker 缓慢衰减(类似音频软件经典样式)
  // ---- F14-A: VHS 按钮 ----
  // 点击 → 调 window.__vhsPass.setEnabled(!state) 做 300ms 渐变
  // 按下状态用 aria-pressed + .is-on class 视觉区分
  if (vhsBtn) {
    // F14-A: 从 localStorage 读上次偏好,跟 scene 一致
    let _vhsInit = true;
    try {
      const stored = localStorage.getItem('milo.vhs.enabled');
      if (stored !== null) _vhsInit = stored === '1';
    } catch (_) {}
    vhsBtn.setAttribute('aria-pressed', String(_vhsInit));
    const syncVhsLabel = () => {
      const on = vhsBtn.getAttribute('aria-pressed') === 'true';
      vhsLabel.textContent = on ? 'VHS ON' : 'VHS';
      vhsBtn.classList.toggle('is-on', on);
    };
    syncVhsLabel();
    vhsBtn.addEventListener('click', () => {
      const on = vhsBtn.getAttribute('aria-pressed') === 'true';
      const next = !on;
      vhsBtn.setAttribute('aria-pressed', String(next));
      syncVhsLabel();
      const ctrl = (typeof window !== 'undefined') ? window.__vhsPass : null;
      if (ctrl && typeof ctrl.setEnabled === 'function') {
        ctrl.setEnabled(next);
      } else {
        console.warn('[hud] window.__vhsPass not available (scene not init yet?)');
      }
    });
  }

  const holdLevels = new Array(METER_SEGS).fill(0);
  let _meterRaf = 0;
  const _tickMeter = () => {
    // 把 peak 映射到段数(对数刻度,模仿人耳)
    // peak 0..1 → 段 0..METER_SEGS,但用 sqrt 让低电平也看得见
    const segLit = Math.round(Math.sqrt(_latestPeak) * METER_SEGS);
    for (let i = 0; i < METER_SEGS; i++) {
      const on = i < segLit;
      meterSegs[i].style.opacity = on ? '1' : '0.08';
    }
    // hold:仅在该段曾经被点亮且当前未点亮的"边缘段"保留
    // 简化:整条 hold 跟一个衰减
    const targetHold = segLit > 0 ? segLit - 1 : -1; // 最高点前一段
    for (let i = 0; i < METER_SEGS; i++) {
      if (i === targetHold && _latestPeak > METER_HOLD_MIN_PEAK) {
        // 拉到 1
        holdLevels[i] = 1;
      } else {
        // 衰减
        holdLevels[i] = Math.max(0, holdLevels[i] - METER_HOLD_DECAY);
      }
      meterHolds[i].style.opacity = String(holdLevels[i].toFixed(3));
    }
    _meterRaf = requestAnimationFrame(_tickMeter);
  };
  _meterRaf = requestAnimationFrame(_tickMeter);

  // 保存 raf 句柄供 unmount 清理
  _meterRafHandle = _meterRaf;
}

let _meterRafHandle = 0;

export function unmountHud() {
  _unsubs.forEach((off) => { try { off(); } catch (_) {} });
  _unsubs = [];
  if (_meterRafHandle) cancelAnimationFrame(_meterRafHandle);
  _meterRafHandle = 0;
  if (_panel && _panel.parentNode) _panel.parentNode.removeChild(_panel);
  _panel = null;
  _stageEl = null;
}
