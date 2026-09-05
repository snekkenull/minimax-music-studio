/**
 * F14-A + F15: VHS 后处理 Shader
 *
 * 实现经典 VHS 录像带视觉:
 *  - 扫描线 (2px 横线周期,亮度衰减 0.92)
 *  - 微弱色差 (RGB 通道 uv 偏移,模拟复合视频解码)
 *  - 水平白噪点 (time-based,带 hash 分布)
 *  - 水平微抖动 (sin(time*2) 极小幅 x 偏移)
 *  - 色度降采样 (每隔 2 像素复用,模拟 NTSC 低色分辨率)
 *  - 暗角 (中心亮、边缘暗)
 *
 * Uniforms:
 *   tDiffuse     - 输入纹理 (EffectComposer 自动注入)
 *   uTime        - 秒 (每帧更新,做噪点和抖动动画)
 *   uIntensity   - 0..1, 渐显/渐隐用 (HUD 切换)
 *   uResolution  - vec2, 屏幕尺寸 (像素)
 *
 * F14-G: 删除 uFlash 顶部白闪(F14-A 设计的"模拟跟踪错误"功能)— 像素分析
 *   证实它在每 2-5s 触发一次,持续约 50ms,顶部 15% 区域覆盖 50% 白色
 *   (RGB ~129..173),被用户反复反馈为"顶部灰白闪烁块"。此功能视觉上
 *   弊大于利,完全移除(只保留 VHS 复古基底:扫描线/色差/噪点/暗角)。
 *
 * F15: 强度恢复 (用户反馈 F14-E 减半后"复古感太弱")。
 *   - uIntensity 默认 0.35 → 0.55
 *   - chromaOffset 0.0015 → 0.0028 (色差更明显,红蓝边缘)
 *   - scanline 0.96+0.04 → 0.93+0.07 (扫描线更清晰)
 *   - noise 0.02 → 0.035 (噪点更"沙")
 *   - vig 0.35 → 0.5 (暗角更"复古")
 *   - jitterX 0.0008 → 0.0012 (微抖动更"老式录像带")
 *   仍不闪顶部白闪(F14-G 锁死);所有改动在 uIntensity=0 时归零
 *
 * 强度档位说明:
 *   uIntensity = 0 → 完全无效果 (passthrough)
 *   uIntensity = 1 → 完整 VHS 效果
 *   HUD 切换时由 CPU 端做 300ms 渐变
 */
import * as THREE from 'three';

export const VHSShader = {
  name: 'VHSPass',

  uniforms: {
    tDiffuse:    { value: null },
    uTime:       { value: 0 },
    uIntensity:  { value: 0.55 },  // F15: 0.35 → 0.55 (复古感回调,F14-E 减半后太弱)
    uResolution: { value: new THREE.Vector2(1, 1) },
  },

  vertexShader: [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}',
  ].join('\n'),

  fragmentShader: [
    'precision highp float;',
    '',
    'uniform sampler2D tDiffuse;',
    'uniform float uTime;',
    'uniform float uIntensity;',
    'uniform vec2  uResolution;',
    'varying vec2  vUv;',
    '',
    'float hash11(float n) { return fract(sin(n) * 43758.5453123); }',
    'float hash21(vec2 p) {',
    '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = vUv;',
    '',
    '  // 1) 水平微抖动 (sin(time*2) 极小幅 x 偏移)',
    '  // F15: 0.0008 → 0.0012 (老式录像带水平不稳定)',
    '  float jitterX = sin(uTime * 2.0) * 0.0012;',
    '  uv.x += jitterX;',
    '',
    '  // 2) 色差 (RGB 通道 uv 偏移)',
    '  // F15: 0.0015 → 0.0028 (红蓝边缘更明显)',
    '  float chromaOffset = 0.0028 * uIntensity;',
    '  float r = texture2D(tDiffuse, uv + vec2( 1.0, 0.0) * chromaOffset).r;',
    '  float g = texture2D(tDiffuse, uv).g;',
    '  float b = texture2D(tDiffuse, uv + vec2(-1.0, 0.0) * chromaOffset).b;',
    '  vec3 col = vec3(r, g, b);',
    '',
    '  // 3) 色度降采样 (每隔 2 像素复用 R/B)',
    '  vec2 quantUv = floor(uv * uResolution * 0.5) / (uResolution * 0.5);',
    '  float r2 = texture2D(tDiffuse, quantUv + vec2( 1.0, 0.0) * chromaOffset * 0.5).r;',
    '  float b2 = texture2D(tDiffuse, quantUv + vec2(-1.0, 0.0) * chromaOffset * 0.5).b;',
    '  col.r = mix(col.r, r2, 0.5);',
    '  col.b = mix(col.b, b2, 0.5);',
    '',
    '  // 4) 扫描线 (2px 周期)',
    '  // F15: 0.96+0.04 → 0.93+0.07 (扫描线更清晰,亮度衰减更明显)',
    '  float scanline = 0.93 + 0.07 * mod(floor(uv.y * uResolution.y), 2.0);',
    '  col *= scanline;',
    '',
    '  // 5) 白噪点 (time-based)',
    '  // F15: 0.02 → 0.035 (噪点更"沙")',
    '  float noise = hash21(uv * uResolution + uTime * 60.0) - 0.5;',
    '  col += noise * 0.035 * uIntensity;',
    '',
    '  // 6) 暗角',
    '  // F15: 0.35 → 0.5 (暗角更"复古",边缘更暗)',
    '  vec2 vc = uv - 0.5;',
    '  float vig = 1.0 - dot(vc, vc) * 0.5;',
    '  col *= vig;',
    '',
    '  // 7) uIntensity 渐变 — 0=无效果,1=完整 VHS',
    '  vec3 original = texture2D(tDiffuse, vUv).rgb;',
    '  col = mix(original, col, uIntensity);',
    '',
    '  gl_FragColor = vec4(col, 1.0);',
    '}',
  ].join('\n'),
};
