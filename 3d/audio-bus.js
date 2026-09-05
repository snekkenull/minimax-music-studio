/**
 * 3D Home Audio — Audio Bus
 *
 * 一个最小事件总线,把现有 <audio> 元素的播放状态广播给订阅者(3D 场景、HUD 等)。
 * 设计目标:
 *  - 单例(挂 window.audioBus),所以 Library / 生成完成 / 3D 场景都能访问同一个实例
 *  - 不引入第三方库;基于 CustomEvent + EventTarget
 *  - 单一职责:只做"转发",不做"控制"。播放/暂停仍由 app.js 控制 audioEl 完成
 *
 * 事件:
 *  - 'track:loaded'  { id, title, source: 'library' | 'generate' }
 *       新曲目塞入 audioEl 时触发(HUD 用它换标题)
 *  - 'play'          无 payload
 *  - 'pause'         无 payload
 *  - 'ended'         无 payload
 *  - 'progress'      { current, duration, ratio }
 *       每个 timeupdate 触发(HUD 进度条用)
 *  - 'level'         { peak: 0..1, rms: 0..1, source: 'analyser' | 'fallback' }
 *       真实频谱电平(MediaElementAudioSourceNode → AnalyserNode(fftSize=512));
 *       当 AudioContext 创建/恢复失败时降级为伪电平,保证扬声器仍会微动。
 *
 * 用法:
 *   import { audioBus } from './audio-bus.js';
 *   audioBus.on('play', () => { ... });
 *
 * 集成(在 app.js 启动时调一次):
 *   import { attachAudioBus } from './audio-bus.js';
 *   attachAudioBus(document.getElementById('audioEl'));
 */

class AudioBus extends EventTarget {
  constructor() {
    super();
    this._currentTrack = null; // { id, title, source }
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  on(name, handler) {
    this.addEventListener(name, (e) => handler(e.detail));
    return () => this.off(name, handler);
  }

  off(name, handler) {
    this.removeEventListener(name, handler);
  }

  setTrack(track) {
    // track: { id, title, source }
    this._currentTrack = track;
    this.emit('track:loaded', track);
  }

  getTrack() {
    return this._currentTrack;
  }

  // 暴露给订阅者查询:AnalyserNode 是否就绪(用于 HUD 显示 "DSP: ON/OFF")
  isAnalyserReady() {
    return _analyserReady && !!_audioCtx && _audioCtx.state === 'running';
  }
  getAudioContextState() {
    return _audioCtx ? _audioCtx.state : 'closed';
  }

  /**
   * F13-A: 返回三段聚合电平（low / mid / high），供 3D 灯带/灯效订阅
   * - low:  0..10 bin   ≈ 0~430Hz   （鼓点/贝斯）
   * - mid:  10..60 bin  ≈ 430~2580Hz（人声/中频）
   * - high: 60..160 bin ≈ 2580~6880Hz（高频/镲片）
   * 返回值 0..1，调用方不必再 try/catch
   * 注：只在真正播放且 AnalyserNode ready 时返回真实频段；否则全 0
   */
  getBands() {
    if (!_analyserReady || !_freqData) return { low: 0, mid: 0, high: 0, peak: 0 };
    // 注意：调用方必须自己保证 audioEl 在播放（否则 _freqData 是上一次缓存）
    const LOW_END = 10;
    const MID_END = 60;
    const HIGH_END = Math.min(160, _freqData.length);
    let lowSum = 0, midSum = 0, highSum = 0, peak = 0;
    for (let i = 0; i < LOW_END; i++) { lowSum += _freqData[i]; if (_freqData[i] > peak) peak = _freqData[i]; }
    for (let i = LOW_END; i < MID_END; i++) midSum += _freqData[i];
    for (let i = MID_END; i < HIGH_END; i++) highSum += _freqData[i];
    return {
      low:  Math.min(1, (lowSum  / LOW_END)  / 255 * 1.3),
      mid:  Math.min(1, (midSum  / (MID_END - LOW_END))    / 255 * 1.5),
      high: Math.min(1, (highSum / (HIGH_END - MID_END))   / 255 * 1.6),
      peak: peak / 255,
    };
  }

  /**
   * F13-B: 返回原始频谱数组（Uint8Array 副本，调用方安全持有）
   * 供幕布波形绘制使用，bin 数量 = analyser.frequencyBinCount (256)
   * 不在播放时返回最近一次缓存（让 waveform 仍有"残影"）
   */
  getFreqDataCopy() {
    if (!_freqData) return null;
    // Uint8Array.copyWithin / slice 都可；用 slice 返回新实例避免外部写穿
    return _freqData.slice();
  }
}

export const audioBus = new AudioBus();
if (typeof window !== 'undefined') window.audioBus = audioBus;

// ---------- 集成 helper ----------
let _attachedEl = null;
let _audioCtx = null;
let _analyser = null;
let _freqData = null;
let _timeData = null;     // F13-E: 用于 RMS(均方根)计算 — 真实音量感知
let _mediaSource = null;
let _analyserReady = false;
let _levelRaf = 0;
let _lastT = 0;
let _lastLogT = 0;
// F13-E: createMediaElementSource 接管 audioEl 输出后,HTMLMediaElement.paused
// 在主流浏览器(MDN 明确)会**失效** —— audioEl.paused 恒为 false。依赖它会
// 误判"持续播放"导致灯/波形不响应真实暂停。改用 _expectedPaused 显式追踪。
let _expectedPaused = true;
let _saturationWarned = false; // F13-E: 频段饱和提示只打一次

function _ensureAudioGraph(audioEl) {
  if (_audioCtx || _mediaSource) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    _audioCtx = new Ctx();
    // AnalyserNode(fftSize=512 → frequencyBinCount=256)
    _analyser = _audioCtx.createAnalyser();
    _analyser.fftSize = 512;
    _analyser.smoothingTimeConstant = 0.8;
    _freqData = new Uint8Array(_analyser.frequencyBinCount);
    // F13-E: time-domain buffer(0..255,中心128),用于 RMS 计算 — 真实音量感知
    _timeData = new Uint8Array(_analyser.fftSize);
    // F13-D 关键修复:createMediaElementSource 一旦挂上,audio 元素的输出
    // 会被**重定向**到该 source node,不再走浏览器原生通道 —— 必须显式
    // 连到 destination 才有声,否则用户进 3D 房间会突然静音。
    // 路径:_mediaSource → _analyser → _audioCtx.destination
    _mediaSource = _audioCtx.createMediaElementSource(audioEl);
    _mediaSource.connect(_analyser);
    _analyser.connect(_audioCtx.destination);
    _analyserReady = true;
    console.info('[audioBus] AnalyserNode ready:', {
      sampleRate: _audioCtx.sampleRate,
      fftSize: _analyser.fftSize,
      bins: _analyser.frequencyBinCount,
      state: _audioCtx.state,
    });
  } catch (e) {
    console.warn('[audioBus] AudioContext init failed, fallback to pseudo level:', e);
    _audioCtx = null;
    _analyser = null;
    _mediaSource = null;
    _analyserReady = false;
  }
}

// 用户首次播放(Generate 或 Library 点歌)时,resume 被 autoplay policy 挂起的 AudioContext
function _resumeOnGesture() {
  if (_audioCtx && _audioCtx.state === 'suspended') {
    _audioCtx.resume().catch((e) => {
      console.warn('[audioBus] AudioContext.resume() failed:', e);
    });
  }
}

export function attachAudioBus(audioEl) {
  if (!audioEl || _attachedEl === audioEl) return;
  _attachedEl = audioEl;

  // F13-D: 立即初始化 AnalyserNode(不等 pointerdown),让 audioEl 第一次 play
  // 时已经在 Web Audio path 上(避免被 createMediaElementSource 重定向却
  // 还没连 destination 导致静默失败)。AudioContext 仍处于 suspended
  // 状态,等首次 play 事件时再 resume(autoplay policy)。
  _ensureAudioGraph(audioEl);

  // F13-F: 同步当前 audioEl 状态 — 如果 attach 之前 user 已经播过(2D 模式
  // 点 Generate 后 race condition 错过 'play' 事件),_expectedPaused 仍 true
  // 但 audioEl 实际 currentTime > 0,以 audioEl 实际状态同步
  if (audioEl.currentTime > 0.01 && !audioEl.paused) {
    _expectedPaused = false;
  } else if (audioEl.paused && audioEl.currentTime === 0) {
    _expectedPaused = true;
  }

  audioEl.addEventListener('play', () => {
    _expectedPaused = false; // F13-E: 显式追踪播放意图
    _resumeOnGesture();
    audioBus.emit('play');
  });
  audioEl.addEventListener('pause', () => {
    _expectedPaused = true;  // F13-E
    audioBus.emit('pause');
  });
  audioEl.addEventListener('ended', () => {
    _expectedPaused = true;  // F13-E
    audioBus.emit('ended');
  });
  audioEl.addEventListener('timeupdate', () => {
    const current = audioEl.currentTime || 0;
    const duration = audioEl.duration || 0;
    const ratio = duration > 0 ? current / duration : 0;
    audioBus.emit('progress', { current, duration, ratio });
  });
  // 兜底:首次任何用户手势(点击页面/键盘)也尝试 resume
  // —— 某些浏览器只在 click 上算 user gesture,library 拖动不算
  const _gestureResume = () => {
    _ensureAudioGraph(audioEl);
    _resumeOnGesture();
  };
  document.addEventListener('pointerdown', _gestureResume, { once: false, passive: true });
  document.addEventListener('keydown', _gestureResume, { once: false, passive: true });

  // F13-E: 获取"真正"暂停状态 —— 不依赖 audioEl.paused(Web Audio 接管后失效)
  // 逻辑:_expectedPaused(用户意图)+ audioCtx.state(系统状态)
  // - 用户调 play() → audio.play() 触发 'play' 事件 → _expectedPaused=false
  // - 用户调 pause() → audio.pause() 触发 'pause' 事件 → _expectedPaused=true
  // - audioCtx 状态异常时也按暂停处理
  const _isEffectivelyPaused = () => {
    if (_expectedPaused) return true;
    if (!_audioCtx || _audioCtx.state !== 'running') return true;
    return false;
  };

  // 电平 RAF —— 真频谱 + 节流
  const _tickLevel = (t) => {
    // 80ms 节流(≈12.5Hz),扬声器振膜不需要 60fps 精度
    if (t - _lastT > 80) {
      _lastT = t;
      let peak = 0;
      let rms = 0;
      let source = 'fallback';
      const isPaused = _isEffectivelyPaused();
      if (_analyserReady && !isPaused) {
        _analyser.getByteFrequencyData(_freqData);
        _analyser.getByteTimeDomainData(_timeData);
        // peak: 关注 0..120 bins(0~5kHz),瞬时最大(驱动振膜)
        const endBin = Math.min(120, _freqData.length);
        let max = 0;
        for (let i = 0; i < endBin; i++) {
          if (_freqData[i] > max) max = _freqData[i];
        }
        peak = max / 255;
        peak = Math.min(1, peak * 1.4); // 微调让振膜更明显

        // rms: time-domain 0..255 → -1..+1,计算真实响度感知
        // 中心 128,signed = (v-128)/128 → 真实音频幅度
        let sumSq = 0;
        const n = _timeData.length;
        for (let i = 0; i < n; i++) {
          const s = (_timeData[i] - 128) / 128; // -1..+1
          sumSq += s * s;
        }
        rms = Math.sqrt(sumSq / n);
        // 额外做一个"频段饱和检测":如果低/中/高三段都 > 0.95,持续饱和
        if (peak >= 0.98 && rms >= 0.5) {
          // 不抛错,只 console.warn 一次
          if (!_saturationWarned) {
            _saturationWarned = true;
            console.warn('[audioBus] 频段持续接近饱和(peak≥0.98,rms≥0.5),可能 sample 源异常/失真');
          }
        }
        source = 'analyser';
        // 调试日志:每 5s 打印一次电平范围
        if (t - _lastLogT > 5000) {
          _lastLogT = t;
          console.debug('[audioBus] level', { peak: peak.toFixed(3), rms: rms.toFixed(3), expectedPaused: _expectedPaused, ctxState: _audioCtx && _audioCtx.state });
        }
      } else if (!isPaused) {
        // fallback:无 AnalyserNode / 未运行时,保持微动
        const base = Math.sin(t * 0.005) * 0.5 + 0.5;
        peak = base * 0.6 + 0.2;
        rms = peak * 0.7;
      } else {
        // idle:不 emit,扬声器停止
        _levelRaf = requestAnimationFrame(_tickLevel);
        return;
      }
      audioBus.emit('level', { peak, rms, source });
    }
    _levelRaf = requestAnimationFrame(_tickLevel);
  };
  _levelRaf = requestAnimationFrame(_tickLevel);
}

// 测试 / 调试用:手动断开 AudioContext
export async function detachAudioBus() {
  if (_levelRaf) cancelAnimationFrame(_levelRaf);
  _levelRaf = 0;
  _attachedEl = null;
  try {
    if (_mediaSource) _mediaSource.disconnect();
    if (_analyser) _analyser.disconnect();
    if (_audioCtx) await _audioCtx.close();
  } catch (e) {
    console.warn('[audioBus] detach cleanup:', e);
  }
  _mediaSource = null;
  _analyser = null;
  _freqData = null;
  _timeData = null;
  _audioCtx = null;
  _analyserReady = false;
  _expectedPaused = true;
  _saturationWarned = false;
}
