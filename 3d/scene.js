/**
 * 3D Home Audio — Scene Module
 *
 * 极简客厅 + 音乐工作室装饰：
 * - 浅色墙 / 木地板 / 吸音棉墙（音乐工作室元素）
 * - 墙上挂电吉他、角落黑胶架、窗边调音台、落地灯、抽象画
 * - PBR 材质 + HDRI 环境贴图（PMREM 烘焙）
 * - ACESFilmic 色调映射，柔和室内光
 * - OrbitControls 限制极角（防止穿地）
 *
 * Public API:
 *   import { initScene, disposeScene } from './3d/scene.js';
 *   initScene(canvas) -> { scene, camera, renderer, controls, setTheme, onResize }
 */

import * as THREE from './lib/three.module.js';
import { OrbitControls } from './lib/OrbitControls.js';
import { RoomEnvironment } from './lib/RoomEnvironment.js';
import { RGBELoader } from './lib/RGBELoader.js';
import { buildRoom, ROOM, makeNightCityTexture, makeDayCityTexture } from './room.js';  // Task A
import { audioBus } from './audio-bus.js';
import { mountHud, unmountHud } from './hud.js';
// F14-A: 后处理 (EffectComposer + RenderPass + ShaderPass + OutputPass)
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VHSShader } from './post/VHSShader.js';

// ---------- Renderer ----------
// D1.1: Pixel-ratio cap with device-class detection.
// - 桌面 + 高端 GPU: ≤ 2
// - 移动 / 低端(内存 < 4GB): ≤ 1.5 (避免 3x 屏上 9x 像素开销)
// - 老旧 / 低端移动: ≤ 1 (省电、稳住 30fps)
function pickPixelRatio() {
  const dpr = window.devicePixelRatio || 1;
  const ua = (navigator.userAgent || '').toLowerCase();
  const isMobile = /mobi|android|iphone|ipad|ipod/.test(ua) || (navigator.maxTouchPoints > 1);
  const memGB = Number(navigator.deviceMemory || 0); // 0 = 未知
  let cap = 2;
  if (isMobile) cap = memGB && memGB < 4 ? 1 : 1.5;
  else if (memGB && memGB < 4) cap = 1.25;
  return Math.min(dpr, cap);
}

function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(pickPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

// ---------- Scene + Camera ----------
function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1f); // dark fallback before IBL kicks in
  return scene;
}

function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    72,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  // F6b 默认视角：站在"房间后侧"（沙发后 z=+2.6 那个方向）看向幕布（-Z 方向）
  //   用户给的修复参考截图就是这个角度 — 经典客厅视角：能看到沙发正面/抱枕/扶手/茶几/落地灯/幕布/吉他
  //   F6b 调整：fov 65→72 拉更宽，相机拉到 z=8.5 容下沙发+茶几+幕+墙边装饰+左右扬声器
  //   x=+0.8 略偏右，y=1.8 站姿看向房间中部
  camera.position.set(-1.5, 1.8, 8.5);
  camera.lookAt(0.5, 1.0, -2.5);
  return camera;
}

// ---------- Lights ----------
// F10 赛博朋克灯光重塑：
//   - 删掉"自然日光"概念（高层公寓全玻璃被摩天楼包围，没有阳光）
//   - 替换为"赛博天光"（强冷蓝紫，模拟所有远处霓虹汇总照下来的天光）
//   - 新增洋红/青色玻璃透入光（左侧玻璃渗洋红、右侧玻璃渗青色，赛博朋克经典对比色）
//   - 保留暖色落地灯+台灯（不破坏 F8 暖色温馨基底，做冷暖对比）
//   - 加 HemisphereLight 顶冷紫底深蓝（空间大环境色）
function addLights(scene) {
  // ---- 基础环境光：冷蓝紫（替代 F8 暖白）----
  const ambient = new THREE.AmbientLight(0x6a78c8, 0.18);
  scene.add(ambient);

  // ---- "赛博天光"：替代 F8 暖太阳光
  // 模拟所有远处摩天楼霓虹汇总，从天顶斜射下来的冷蓝紫强光
  // 仍保留 F2 阴影优化参数，但色温从暖变冷
  const sun = new THREE.DirectionalLight(0x5870a8, 1.1);
  sun.position.set(-4, 5, 3);
  sun.target.position.set(0, 0.5, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);  // F12-B: 2048→1024 (-75% shadow cost)
  sun.shadow.camera.left = -5;
  sun.shadow.camera.right = 5;
  sun.shadow.camera.top = 4;
  sun.shadow.camera.bottom = -4;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 18;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 4;
  scene.add(sun);
  scene.add(sun.target);

  // ---- 落地灯（保留暖色，但降强度 — 让它成为"温馨点缀"而非"主光") ----
  // F10 调色：2800K 暖橙 → 2500K 更深橙 + 强度 1.9 → 1.3（不再盖过赛博冷色）
  const lamp = new THREE.PointLight(0xff9040, 1.3, 8, 2);
  lamp.position.set(2.6, 1.7, 2.6);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(512, 512);
  lamp.shadow.bias = -0.001;
  lamp.shadow.normalBias = 0.02;
  scene.add(lamp);

  // ---- 吸顶灯：双层 — 中央暖聚光 + 外圈冷白（让天花板在赛博夜色中有"夜灯"感）----
  // F10: 0xffe2a0 单灯 → 双灯（中央暖 + 外圈冷白）
  const ceiling = new THREE.PointLight(0xfff0c8, 0.4, 8, 2);
  ceiling.position.set(0, 2.6, 1.0);
  scene.add(ceiling);
  // F12-B 删 ceilingRim（冗余冷色环——其作用被 cyberHemi + ceiling 覆盖）

  // ---- F8 调音台台灯：保留（音乐工作区需要中性光）----
  // F10: 0xfff8e0 (4500K 暖白) → 0xfff0d8 (4000K 中性)
  const deskLamp = new THREE.SpotLight(0xfff0d8, 1.0, 4, Math.PI / 6, 0.4, 1.5);
  deskLamp.position.set(0, 2.2, -2.4);
  deskLamp.target.position.set(0, 0.3, -3.1);
  scene.add(deskLamp);
  scene.add(deskLamp.target);

  // ---- F10 赛博朋克新增：玻璃透入的洋红/青色光（赛博经典对比色）----
  //   左侧玻璃：洋红 #ff2bd6 — 模拟窗外洋红招牌群的光渗入
  //   右侧玻璃：青色 #00e0ff — 模拟窗外青色招牌群的光渗入
  //   距离 12m（覆盖整个房间）+ 强度 1.5/1.4（dark 主题下）
  //   位置：紧贴玻璃内侧，让光从墙面向房间中心"打"过来
  const cyberMagenta = new THREE.PointLight(0xff2bd6, 3.0, 12, 2);  // F12-C: 1.5→3.0
  cyberMagenta.position.set(-ROOM.w / 2 + 0.3, 1.5, 0);
  scene.add(cyberMagenta);

  const cyberCyan = new THREE.PointLight(0x00e0ff, 3.0, 12, 2);  // F12-C: 1.4→3.0
  cyberCyan.position.set(ROOM.w / 2 - 0.3, 1.5, 0);
  scene.add(cyberCyan);

  // ---- F12-D: 房间 4 角落氛围灯（对角线分布：洋红 ↔ 青）----
  //   左后+右前 角 = 洋红（从后墙的洋红招牌群 + 前场暖橙台灯延伸）
  //   左前+右后 角 = 青色（与左侧玻璃青色招牌群形成色彩呼应）
  //   F12-D 修复：Y=0.35 (贴地,从踢脚线高度打) + distance=1.8 (只染近处 1.8m)
  //   + intensity 0.8 (dark) — 避免 4 灯叠加把地板中心打成白纸
  //   主要打亮踢脚墙 + 地板边缘 1.8m 范围，地板中心(沙发/茶几位置)由其他光源负责
  const cornerMagentaBL = new THREE.PointLight(0xff2bd6, 0.8, 1.8, 2);
  cornerMagentaBL.position.set(-ROOM.w / 2 + 0.2, 0.35, -ROOM.d / 2 + 0.2);
  scene.add(cornerMagentaBL);
  const cornerMagentaFR = new THREE.PointLight(0xff2bd6, 0.8, 1.8, 2);
  cornerMagentaFR.position.set(ROOM.w / 2 - 0.2, 0.35, ROOM.d / 2 - 0.2);
  scene.add(cornerMagentaFR);
  const cornerCyanFL = new THREE.PointLight(0x00e0ff, 0.8, 1.8, 2);
  cornerCyanFL.position.set(-ROOM.w / 2 + 0.2, 0.35, ROOM.d / 2 - 0.2);
  scene.add(cornerCyanFL);
  const cornerCyanBR = new THREE.PointLight(0x00e0ff, 0.8, 1.8, 2);
  cornerCyanBR.position.set(ROOM.w / 2 - 0.2, 0.35, -ROOM.d / 2 + 0.2);
  scene.add(cornerCyanBR);

  // ---- F10 HemisphereLight：空间大环境色（顶冷紫 / 底深蓝）----
  //   模拟天顶霓虹汇总照下来的"天色"，地面反射回深蓝
  //   强度 0.55（dark 主题下；light 主题下调到 0.25）
  const cyberHemi = new THREE.HemisphereLight(0x9a8aff, 0x1a1530, 0.4)  // F12-B: 0.55→0.4;
  cyberHemi.position.set(0, 2.6, 0);
  scene.add(cyberHemi);

  return {
    ambient, sun, lamp, ceiling, deskLamp,
    cyberMagenta, cyberCyan, cyberHemi,
    // F12-D: 4 盏角落氛围灯 (对角线洋红/青)
    cornerMagentaBL, cornerMagentaFR, cornerCyanFL, cornerCyanBR,
  };  // F12-B + F12-D
}

// F12-C: 霓虹灯呼吸（错相 + 不同频率 → 活气）
//   ⚠️ 必须用 module-level 引用,不能用 addLights 局部变量 — tick() 每帧调用,丢失 = 黑屏
// F12-D: 角落灯也加入呼吸(更慢 + 更大振幅,营造"氛围漂浮"感)
let _cyber_t0 = performance.now();
let _cyberMagenta = null;       // 由 initScene 注入（addLights 返回的引用）
let _cyberCyan = null;          // 同上
let _cornerMagentaBL = null;    // F12-D
let _cornerMagentaFR = null;    // F12-D
let _cornerCyanFL = null;       // F12-D
let _cornerCyanBR = null;       // F12-D
export function animateCyberLights() {
  if (!_cyberMagenta || !_cyberCyan) return;
  const t = (performance.now() - _cyber_t0) * 0.001;  // 秒
  // 洋红慢呼吸 0.4 Hz, 青色快闪 1.2 Hz (错相 1.2)
  _cyberMagenta.intensity = 3.0 + Math.sin(t * 2.5) * 0.4;
  _cyberCyan.intensity    = 3.0 + Math.sin(t * 7.5 + 1.2) * 0.5;
  // F12-D 修复:基线 1.5→0.8,呼吸幅度 0.5→0.25 — 范围 0.55~1.05,地板不再过曝
  if (_cornerMagentaBL) _cornerMagentaBL.intensity = 0.8 + Math.sin(t * 1.8) * 0.25;
  if (_cornerMagentaFR) _cornerMagentaFR.intensity = 0.8 + Math.sin(t * 1.8 + 1.5) * 0.25;
  if (_cornerCyanFL)    _cornerCyanFL.intensity    = 0.8 + Math.sin(t * 2.6 + 0.8) * 0.2;
  if (_cornerCyanBR)    _cornerCyanBR.intensity    = 0.8 + Math.sin(t * 2.6 + 2.3) * 0.2;
}

// ---------- Environment (PMREM from HDRI or RoomEnvironment fallback) ----------
function applyEnvironment(scene, renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  // 先尝试加载外部 HDRI
  const loader = new RGBELoader();
  loader.load(
    'hdri/studio_small_03_1k.hdr',
    (hdrTexture) => {
      hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
      const envMap = pmrem.fromEquirectangular(hdrTexture).texture;
      scene.environment = envMap;
      // 背景仍保持暗色，让房间本身是视觉中心
      hdrTexture.dispose();
      pmrem.dispose();
    },
    undefined,
    () => {
      // HDRI 加载失败（开发环境无文件等） → 退到内置 RoomEnvironment
      const fallback = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = fallback;
      pmrem.dispose();
    },
  );
}

// ---------- Controls ----------
function createControls(camera, dom) {
  const controls = new OrbitControls(camera, dom);
  controls.target.set(0.5, 1.0, -2.5);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2.5;
  controls.maxDistance = 10;
  // 限制极角：不能从地板看，也不能从天花板看
  controls.minPolarAngle = THREE.MathUtils.degToRad(40);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(85);
  // 限制水平旋转：±75° 让用户能看到侧景(扬声器、画、吉他),又不会转穿墙
  controls.minAzimuthAngle = THREE.MathUtils.degToRad(-75);
  controls.maxAzimuthAngle = THREE.MathUtils.degToRad(75);
  controls.enablePan = false;
  controls.update();
  return controls;
}

// ---------- Theme (E1: 灯光色温+强度 + 背景 + 曝光 + envMapIntensity) ----------
// F10 赛博朋克主题化：
//   - dark 主题：完全赛博（强洋红+青色+冷蓝紫+暖橙点缀），模拟赛博朋克高层公寓夜景
//   - light 主题：保留自然光基底，但加微赛博（天光冷色 + 微洋红/青渗透）
//   - auto 模式由调用方在传入前解析为 light/dark
const THEME_PRESETS = {
  light: {
    background:    0xe8e2d6, // 米色
    exposure:      1.15,
    ambientColor:  0xc8d0e8, // 冷白（替代原 fff 白）
    ambientI:      0.22,
    sunColor:      0xe0d8f0, // 微冷"阴天日光透过赛博天"
    sunI:          1.4,
    lampColor:     0xffb878, // 暖橙
    lampI:         1.0,
    ceilingColor:  0xfff0d8,
    ceilingI:      0.5,
    cyberMagentaColor: 0xff80c0, // 微洋红（减弱版，避免破坏 light 主题）
    cyberMagentaI:     0.35,
    cyberCyanColor:    0x80c8e0, // 微青（减弱版）
    cyberCyanI:        0.30,
    cyberHemiSky:      0xc8b8e8, // 微紫
    cyberHemiGround:   0x303048,
    cyberHemiI:        0.25,
    envIntensity:      0.7,  // F12-B: 0.6→0.7 (light 提亮)
    // F11: 灯组 emissive 强度（light 主题：温和）
    floorLampShadeI:   0.85,
    floorLampBulbI:    2.4,
    baseLedI:          0.6,
    ceilingShadeI:     0.6,
    ceilingBulbI:      1.8,
    // F12-A: 主题化房间色（light 主题：米白基底）
    wallColor:        0xe8e0d0,
    wallRoughness:    0.92,
    ceilingColor:     0xf2ece0,
    ceilingRoughness: 0.95,
    backWallColor:    0x14141a,  // 吸音棉深炭灰（不变）
    floorColor:       0xffffff,  // 不染色,用贴图本色
    // F12-D: 4 角落灯 (light 主题：温和,几乎不显)
    cornerMagentaColor: 0xffa0d0,  // 浅粉
    cornerMagentaI:     0.4,
    cornerCyanColor:    0x80c8e0,  // 浅青
    cornerCyanI:        0.35,
    // F12-D: 灯带颜色 (light: 微暖白,几乎融入墙面)
    ceilStripColor:     0xc8a888,  // 暖米色
    kickStripColor:     0x9080b0,  // 浅紫
  },
  dark: {
    // F11 赛博朋克夜景 v2: 降低 sun/envMap,让赛博光真的主导
    //   - sunI 1.1→0.5: 赛博房间不靠"太阳",靠霓虹
    //   - envMapIntensity 0.6→0.25: HDRI 反射只点缀,不要主导整体明暗
    //   - cyberMagenta 1.5→2.5, cyberCyan 1.4→2.4: 玻璃透光要"染色"房间
    background:    0x0a0816, // 深夜紫黑
    exposure:      0.85,    // 略降,让深色更深
    ambientColor:  0x6a78c8, // 冷蓝紫
    ambientI:      0.18,
    sunColor:      0x5870a8, // "赛博天光"冷蓝紫
    sunI:          0.5,     // F11: 1.1→0.5
    lampColor:     0xff9040, // 暖橙
    lampI:         1.5,     // F11: 1.3→1.5(主光之一)
    ceilingColor:  0xfff0c8,
    ceilingI:      0.5,
    cyberMagentaColor: 0xff2bd6,
    cyberMagentaI:     3.0,  // F12-C: 2.5→3.0 (匹配 addLights 初值,避免 setTheme 拉低)
    cyberCyanColor:    0x00e0ff,
    cyberCyanI:        3.0,  // F12-C: 2.4→3.0 (匹配 addLights 初值)
    cyberHemiSky:      0x9a8aff,
    cyberHemiGround:   0x1a1530,
    cyberHemiI:        0.4,  // F12-B: 0.55→0.4 (匹配 addLights 初值)
    envIntensity:      0.4,  // F12-B: 0.25→0.4 (dark 提亮)
    // F11: dark 主题下灯罩更亮(暖光对抗冷色),LED 环更显眼
    floorLampShadeI:   1.6,  // 0.85→1.6
    floorLampBulbI:    3.4,  // 2.4→3.4
    baseLedI:          2.4,  // 0.6→2.4(底座冷光)
    ceilingShadeI:     0.9,  // 0.6→0.9
    ceilingBulbI:      2.4,  // 1.8→2.4
    // F12-A: dark 主题下房间变深色(让赛博光能"染"上墙,不被白墙稀释)
    //   墙: 米白 → 深炭紫(让洋红/青光吸收有底色)
    //   天花: 灰白 → 深紫黑(让吸顶灯/夜灯的强光更突出)
    //   后墙: 不变(已经是深炭灰)
    //   地板: 暖木 → 暗夜木(贴图切换)
    wallColor:        0x1a1828, // 深炭紫(微冷,吸收暖光)
    wallRoughness:    0.95,
    ceilingColor:     0x14121c, // 深紫黑
    ceilingRoughness: 0.96,
    backWallColor:    0x14141a, // 不变
    floorColor:       0x6a5078, // 紫色调,配合暗木纹
    // F12-D 修复:角落灯 I 1.5→0.8 (避免地板过曝)
    cornerMagentaColor: 0xff2bd6,  // 赛博洋红
    cornerMagentaI:     0.8,       // 匹配 addLights 初值(由 animateCyberLights 覆盖)
    cornerCyanColor:    0x00e0ff,  // 赛博青
    cornerCyanI:        0.8,       // 匹配 addLights 初值
    // F12-D: 灯带颜色 (dark: 强烈赛博紫,自发光,即使 toneMapped:false 也会被 ACES 影响)
    //   因为 toneMapped:false → ACES 不作用,色值直接显示,选亮一点
    ceilStripColor:     0xc060ff,  // 亮紫 (天花板灯带)
    kickStripColor:     0x8040ff,  // 深蓝紫 (踢脚灯)
  },
};

function setTheme(scene, renderer, lights, room, mode) {
  const preset = THEME_PRESETS[mode] || THEME_PRESETS.light;
  scene.background = new THREE.Color(preset.background);
  renderer.toneMappingExposure = preset.exposure;
  if (lights) {
    lights.ambient.color.setHex(preset.ambientColor);
    lights.ambient.intensity = preset.ambientI;
    lights.sun.color.setHex(preset.sunColor);
    lights.sun.intensity = preset.sunI;
    lights.lamp.color.setHex(preset.lampColor);
    lights.lamp.intensity = preset.lampI;
    lights.ceiling.color.setHex(preset.ceilingColor);
    lights.ceiling.intensity = preset.ceilingI;
    // F12-B: ceilingRim deleted (was redundant with cyberHemi)
    // F10: 赛博朋克洋红/青色玻璃透入光
    if (lights.cyberMagenta) {
      lights.cyberMagenta.color.setHex(preset.cyberMagentaColor);
      lights.cyberMagenta.intensity = preset.cyberMagentaI;
    }
    if (lights.cyberCyan) {
      lights.cyberCyan.color.setHex(preset.cyberCyanColor);
      lights.cyberCyan.intensity = preset.cyberCyanI;
    }
    // F10: HemisphereLight 空间大环境色
    if (lights.cyberHemi) {
      lights.cyberHemi.color.setHex(preset.cyberHemiSky);
      lights.cyberHemi.groundColor.setHex(preset.cyberHemiGround);
      lights.cyberHemi.intensity = preset.cyberHemiI;
    }
    // F12-D: 4 角落氛围灯(对角线洋红/青)
    if (lights.cornerMagentaBL) {
      lights.cornerMagentaBL.color.setHex(preset.cornerMagentaColor);
      lights.cornerMagentaBL.intensity = preset.cornerMagentaI;
    }
    if (lights.cornerMagentaFR) {
      lights.cornerMagentaFR.color.setHex(preset.cornerMagentaColor);
      lights.cornerMagentaFR.intensity = preset.cornerMagentaI;
    }
    if (lights.cornerCyanFL) {
      lights.cornerCyanFL.color.setHex(preset.cornerCyanColor);
      lights.cornerCyanFL.intensity = preset.cornerCyanI;
    }
    if (lights.cornerCyanBR) {
      lights.cornerCyanBR.color.setHex(preset.cornerCyanColor);
      lights.cornerCyanBR.intensity = preset.cornerCyanI;
    }
  }
  // 调整所有 PBR 材质的 envMapIntensity(让 IBL 跟着主题走)
  if (room) {
    room.traverse((obj) => {
      if (obj.isMesh && obj.material && obj.material.isMeshStandardMaterial) {
        obj.material.envMapIntensity = preset.envIntensity;
      }
    });
  }

  // F11: 灯罩/LED 环的 emissive 强度跟主题走(让灯效真的"契合"赛博朋克)
  //   dark: 灯罩更亮、暖橙更显眼,LED 环偏冷
  //   light: 灯罩温和、LED 环几乎不显(自然光基底)
  if (room && room.userData) {
    if (room.userData.floorLamp) {
      const fl = room.userData.floorLamp;
      if (fl.shadeMat) fl.shadeMat.emissiveIntensity = preset.floorLampShadeI;
      if (fl.bulbMat) fl.bulbMat.emissiveIntensity = preset.floorLampBulbI;
      if (fl.baseLedMat) fl.baseLedMat.emissiveIntensity = preset.baseLedI;
    }
    if (room.userData.ceilingLamp) {
      const cl = room.userData.ceilingLamp;
      if (cl.shadeMat) cl.shadeMat.emissiveIntensity = preset.ceilingShadeI;
      if (cl.bulbMat) cl.bulbMat.emissiveIntensity = preset.ceilingBulbI;
      if (cl.rimMat) cl.rimMat.emissiveIntensity = 0.6;  // F12-B: const
    }
  }

  // Task A: 主题切换 → 重建窗外城市贴图
  if (room && room.userData && Array.isArray(room.userData.glassWalls)) {
    for (const wall of room.userData.glassWalls) {
      const side = wall.position.x > 0 ? 'right' : 'left';
      const newTex = (mode === 'light')
        ? makeDayCityTexture(side)
        : makeNightCityTexture(side);
      const cityBg = wall.userData.cityBg;
      if (cityBg && cityBg.material) {
        // 释放旧贴图
        if (cityBg.material.map) cityBg.material.map.dispose();
        if (cityBg.material.emissiveMap) cityBg.material.emissiveMap.dispose();
        cityBg.material.map = newTex;
        cityBg.material.emissiveMap = newTex;
        cityBg.material.needsUpdate = true;
      }
    }
  }

  // F12-A: dark 主题切墙/天花/地板的 baseColor + 换地板贴图
  //   不然"赛博朋克深色灯光"打不到"米白墙"上,赛博感被白墙稀释
  if (room && room.userData && room.userData.themeMaterials) {
    const tm = room.userData.themeMaterials;
    if (tm.wallMat) {
      tm.wallMat.color.setHex(preset.wallColor);
      tm.wallMat.roughness = preset.wallRoughness;
    }
    if (tm.ceilingMat) {
      tm.ceilingMat.color.setHex(preset.ceilingColor);
      tm.ceilingMat.roughness = preset.ceilingRoughness;
    }
    if (tm.backWallMat) {
      tm.backWallMat.color.setHex(preset.backWallColor);
    }
    if (tm.floorMat) {
      // F12-D 修复 v5: 保留 woodTex 纹理 + 提亮 color 让纹理可见
      //   v4 #3a2a1c 太暗 → color × map 把纹理压成黑,看起来一片灰
      //   v5 #6a4828 中深棕 (木纹原色 0.41x) → 纹理亮度可读,仍不刺眼
      if (mode === 'dark') {
        if (tm.floorWoodTex) {
          tm.floorMat.map = tm.floorWoodTex;
          tm.floorMat.map.needsUpdate = true;
        }
        tm.floorMat.color.setHex(0x6a4828);   // 中深棕木,纹理亮度可见 (RGB ~ 0.41 倍木纹原色)
        tm.floorMat.roughness = 0.85;          // 高粗糙,微纹理感
        tm.floorMat.envMapIntensity = 0.0;     // 不让 HDRI Fresnel 染白
      } else {
        // light: 还原 woodTex + 米色 color
        if (tm.floorWoodTex) {
          tm.floorMat.map = tm.floorWoodTex;
          tm.floorMat.map.needsUpdate = true;
        }
        tm.floorMat.color.setHex(0xffffff);  // 用贴图本色
        tm.floorMat.roughness = 0.55;
        tm.floorMat.envMapIntensity = 0.4;   // light 主题用一点 HDRI 增加层次
      }
      tm.floorMat.needsUpdate = true;
    }
  }

  // F12-D: 主题化灯带颜色 (天花灯带 + 踢脚灯带)
  if (room && room.userData && room.userData.ambientStrips) {
    const as = room.userData.ambientStrips;
    if (as.ceilStripMat) as.ceilStripMat.color.setHex(preset.ceilStripColor);
    if (as.kickStripMat) as.kickStripMat.color.setHex(preset.kickStripColor);
  }
}

// ---------- Public: init / dispose ----------
export function initScene(container) {
  // Task B: 防止旧 canvas 残留（第二次 enter3D 时 exit3D dispose 还没完成）
  while (container.firstChild) container.removeChild(container.firstChild);

  // 容器可以是任意 DOM 元素,我们动态塞一个 <canvas> 进去
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);

  const renderer = createRenderer(canvas);
  const scene = createScene();
  const camera = createCamera();
  const controls = createControls(camera, renderer.domElement);

  const lights = addLights(scene);
  // F12-C fix: animateCyberLights 用 module-level 引用,必须在 addLights 之后注入
  _cyberMagenta = lights.cyberMagenta;
  _cyberCyan    = lights.cyberCyan;
  // F12-D: 4 盏角落灯同样注入
  _cornerMagentaBL = lights.cornerMagentaBL;
  _cornerMagentaFR = lights.cornerMagentaFR;
  _cornerCyanFL    = lights.cornerCyanFL;
  _cornerCyanBR    = lights.cornerCyanBR;
  applyEnvironment(scene, renderer);

  // 房间（地板 / 墙 / 天花 / 装饰物）
  const room = buildRoom();
  scene.add(room);

  // 全局 envMapIntensity = 1.0，让 PBR 材质有真实 IBL 高光
  room.traverse((obj) => {
    if (obj.isMesh && obj.material && obj.material.isMeshStandardMaterial) {
      obj.material.envMapIntensity = 1.0;
    }
  });

  // E4: 扬声器三组单元引用(从 room.userData.speakers 拿到)
  // 结构: [{ woofer: Group, tweeter: Mesh, mid: Mesh }, ...] 每只音箱一份
  const speakerUnits = Array.isArray(room.userData.speakers) ? room.userData.speakers : [];

  // ----- audioBus 订阅:扬声器微动 + HUD 状态同步 -----
  const subs = [];
  let currentLevel = 0; // 平滑后的 peak,0..1
  // F13-A: 灯带/灯光节拍响应 — 平滑三段(low/mid/high) + 整体 energy
  const currentBands = { low: 0, mid: 0, high: 0, energy: 0 };

  // 振膜微动 + 灯带:跟随 level 事件
  subs.push(audioBus.on('level', ({ peak }) => {
    // 指数平滑,避免跳变
    currentLevel = currentLevel * 0.7 + peak * 0.3;
    // F13-A: 从 analyser 取三段,做更强的平滑(灯光不像扬声器那么快)
    const b = audioBus.getBands();
    // 灯光平滑更慢(0.15) — 让节拍"呼吸"而不是抖动
    currentBands.low     = currentBands.low     * 0.85 + b.low  * 0.15;
    currentBands.mid     = currentBands.mid     * 0.85 + b.mid  * 0.15;
    currentBands.high    = currentBands.high    * 0.85 + b.high * 0.15;
    currentBands.energy  = (currentBands.low + currentBands.mid + currentBands.high) / 3;
  }));
  // play 触发时给一个"开机"脉冲,让用户感觉到扬声器活了
  subs.push(audioBus.on('play', () => {
    currentLevel = 0.95;
    // 灯光开机 flash — 4 灯带同时高亮一拍
    currentBands.low = 0.9;
    currentBands.mid = 0.7;
    currentBands.high = 0.8;
    currentBands.energy = 0.8;
  }));
  // pause 回到 idle 微动
  subs.push(audioBus.on('pause', () => {
    currentLevel = 0;
  }));
  subs.push(audioBus.on('ended', () => {
    currentLevel = 0;
  }));

  // 挂 HUD（接受 audioBus 事件做标题/进度/播放按钮）
  mountHud(audioBus);

  // F13-A: 灯带/灯组引用（inject by initScene 之前）— 我们直接用 lights 中已有的 cyber 系列
  // 同时拿到 room.userData.ambientStrips (ceilStripMat + kickStripMat)
  const stripRefs = room.userData.ambientStrips || {};
  const ceilStripMat = stripRefs.ceilStripMat;
  const kickStripMat = stripRefs.kickStripMat;
  // F13-A 颜色基线（深色主题）
  const STRIP_BASE_CEIL = new THREE.Color(0x6a3a90);    // 深紫
  const STRIP_BASE_KICK = new THREE.Color(0x4020a0);    // 深蓝紫
  const STRIP_BASE_CYBER_M = new THREE.Color(0xff2bd6); // 洋红
  const STRIP_BASE_CYBER_C = new THREE.Color(0x00e0ff); // 青
  const _scratchColor = new THREE.Color();
  const _scratchColor2 = new THREE.Color();
  // F15: 节拍瞬态增益 — 监听 low 突变,灯带短时高亮 200ms 衰减
  // 比直接乘 low 更"撞":鼓点落下的一瞬整圈灯带闪一下,而不是持续高亮
  const F15_FLASH = { prevLow: 0, gain: 0, decayMs: 220, threshold: 0.18 };
  // F13-B: 投影幕引用
  const screenRefs = room.userData.projectorScreen || null;
  const WAVE_W = screenRefs?.WAVE_W || 256;
  const WAVE_H = screenRefs?.WAVE_H || 64;
  // F13-G fix: 直接用 DataTexture 的 image.data — 别再新建 buffer 后忘了上传
  // 之前 new Uint8Array() 后只设 needsUpdate=true,GPU 上看到的还是 initialData
  const wavePixelBuf = screenRefs?.waveTex?.image?.data || null;

  // D1.4: Resize 150ms trailing-edge debounce
  // - iOS 横竖屏切换会连发 5+ 个 resize 事件,逐个 setSize 会让 GPU buffer 反复重建
  let _resizeTimer = 0;
  const onResize = () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      // F14-A: composer 也要 resize (RT 跟着 renderer)
      composer.setSize(w, h);
      vhsPass.uniforms.uResolution.value.set(
        w * renderer.getPixelRatio(),
        h * renderer.getPixelRatio(),
      );
    }, 150);
  };
  window.addEventListener('resize', onResize);

  // D1.2 + D1.3: Adaptive frame rate + visibility pause
  // - 60fps when playing OR user 最近在交互 (orbit/zoom)
  // - 15fps when idle (audio paused, no recent input) → 桌面 4x 省电
  // - 完全 stop when document.hidden (标签页不可见)
  //   → 重新可见时,从当前 frame 继续,无撕裂
  let rafId = 0;
  let lastInteractionAt = performance.now();
  let lastAudioPlayAt = 0;          // 0 = 没在播
  let _running = true;              // 可见性 / dispose 控制的总开关
  let _targetInterval = 1000 / 60;  // 动态帧间隔(ms)
  let _lastFrameAt = 0;
  const IDLE_AFTER_MS = 2000;       // 多久没交互/播放 → 进 idle
  const IDLE_FPS = 15;
  const ACTIVE_FPS = 60;

  // 用户交互时打点(OrbitControls 的 start/end)
  controls.addEventListener('start', () => { lastInteractionAt = performance.now(); });
  controls.addEventListener('change', () => { lastInteractionAt = performance.now(); });

  // audioBus 事件 → 更新"是否在播"
  const playState = { playing: false };
  const offPlay = audioBus.on('play',  () => { playState.playing = true;  lastAudioPlayAt = performance.now(); });
  const offPause = audioBus.on('pause', () => { playState.playing = false; });
  const offEnded = audioBus.on('ended', () => { playState.playing = false; });
  subs.push(offPlay, offPause, offEnded);

  // F13-F: 播放状态兜底 — 不依赖 bus 'play' 事件链
  // (F13-D 把 'play' 事件挂到 attachAudioBus 的 audioEl 上,但 bus 异步 import 可能
  // 晚于用户首次点 play;bus 'play' 事件链任一环节掉 → 灯/波形全静默)
  // 兜底:每帧自己读 audioEl 真实状态,任一为 true 即视为"在播"
  const _audioEl = document.getElementById('audioEl');
  let _lastCurT = 0;
  let _lastCurTTick = 0;
  const _detectPlayingFallback = () => {
    // A) audioEl.paused=false + currentTime 持续推进(过去 200ms 走过) — 最强信号
    if (_audioEl) {
      if (!_audioEl.paused) return true;
      // 某些情况下 paused 状态不对(Web Audio 接管后),用 currentTime 在动做二次确认
      const now = performance.now();
      if (now - _lastCurTTick > 200) {
        if (_audioEl.currentTime > _lastCurT) return true;
        _lastCurT = _audioEl.currentTime;
        _lastCurTTick = now;
      }
    }
    // B) AudioContext running — 说明 audio graph 已通,大概率在播
    if (audioBus._audioCtx && audioBus._audioCtx.state === 'running') {
      // 不直接返回 true — 避免 paused 后 ctx 仍 running 误判
      // 必须配合 audioEl 状态
    }
    return false;
  };
  // 诊断日志:每 2s 一次
  let _lastDiagT = 0;
  const _diagnosePlaying = (now) => {
    if (now - _lastDiagT < 2000) return;
    _lastDiagT = now;
    const b = audioBus.getBands?.() || { low: 0, mid: 0, high: 0 };
    console.debug('[F13-F]', {
      busPlaying: playState.playing,
      fallback: _detectPlayingFallback(),
      bands: { l: b.low.toFixed(2), m: b.mid.toFixed(2), h: b.high.toFixed(2) },
      curBands: { l: currentBands.low.toFixed(2), m: currentBands.mid.toFixed(2), h: currentBands.high.toFixed(2) },
      ctx: audioBus._audioCtx?.state,
    });
  };

  // 可见性 → pause/resume 整个 RAF
  const onVisibility = () => {
    if (document.hidden) {
      _running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    } else if (!_running) {
      _running = true;
      _lastFrameAt = 0; // 下一帧立刻跑(不等节流)
      if (!rafId) rafId = requestAnimationFrame(tick);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const computeInterval = () => {
    const now = performance.now();
    const sinceInteraction = now - lastInteractionAt;
    const isActivelyPlaying = playState.playing;
    const recentlyInteracted = sinceInteraction < IDLE_AFTER_MS;
    if (isActivelyPlaying || recentlyInteracted) {
      _targetInterval = 1000 / ACTIVE_FPS;
    } else {
      _targetInterval = 1000 / IDLE_FPS;
    }
  };

  const tick = (now) => {
    if (!_running) return;
    computeInterval();

    // 帧率节流:距上一帧 < 目标间隔则跳过
    if (_lastFrameAt && (now - _lastFrameAt) < _targetInterval) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    _lastFrameAt = now;

    // F13-F: 播放状态兜底 — bus 事件链任一环节失败时,这里仍能正确判定
    const _effectivePlaying = playState.playing || _detectPlayingFallback();
    _diagnosePlaying(now);

    controls.update();
    // E4: 扬声器三组单元独立微动
    // - woofer (低频): 主力,位移最大 (0..0.025m)
    // - tweeter (高频): 反相 + 小幅 (0..-0.012m),模拟振膜高频快速微动
    // - mid (中频):   中等 (0..0.008m)
    if (speakerUnits.length) {
      const lvl = currentLevel;
      // 高频单元给一点点"高频抖动",让视觉更有活力
      const tweeterJitter = (Math.sin(performance.now() * 0.04) * 0.3 + 0.7) * lvl;
      for (let i = 0; i < speakerUnits.length; i++) {
        const u = speakerUnits[i];
        if (!u) continue;
        if (u.woofer?.userData?.baseZ != null) {
          u.woofer.position.z = u.woofer.userData.baseZ + lvl * 0.025;
        }
        if (u.tweeter?.userData?.baseZ != null) {
          // 反相:推出时低音吸进去,高音顶出来
          u.tweeter.position.z = u.tweeter.userData.baseZ - tweeterJitter * 0.012;
        }
        if (u.mid?.userData?.baseZ != null) {
          u.mid.position.z = u.mid.userData.baseZ + lvl * 0.008;
        }
      }
    }
    animateCyberLights();  // F12-C: cyber neon pulse

    // ===== F13-A + F15: 灯带/灯组节拍响应 =====
    // - 天花板灯带: low + mid 驱动,深紫→热粉(随鼓点升温)
    // - 踢脚灯带:  low 驱动,深蓝紫→亮蓝(随贝斯跳动)
    // - cyber 灯: 本身已经 sin 呼吸,这里叠加"节拍增益"让它们真的脉冲
    // - F15: 亮度整体放大(灯带 max 2.5→3.8,踢脚 2.6→4.2),加节拍瞬态白闪
    if (_effectivePlaying) {
      const e = currentBands.energy;       // 0..1
      const l = currentBands.low;
      const m = currentBands.mid;
      const h = currentBands.high;
      // F15: 节拍瞬态 — 检测 low 突变(dLow/dt),整圈灯带闪 200ms 衰减
      const dLow = l - F15_FLASH.prevLow;
      F15_FLASH.prevLow = l;
      if (dLow > F15_FLASH.threshold) {
        F15_FLASH.gain = Math.max(F15_FLASH.gain, Math.min(0.9, dLow * 2.2));
      } else {
        // 指数衰减(0.92/帧 ≈ 220ms 半衰)
        F15_FLASH.gain *= 0.92;
      }
      const flashMul = 1 + F15_FLASH.gain * 0.8;  // 最大 ×1.72
      if (ceilStripMat) {
        // 深紫基色 + 随 mid 往品红偏移
        _scratchColor.copy(STRIP_BASE_CEIL).lerp(STRIP_BASE_CYBER_M, m * 0.8);
        // F15: 亮度 0.7+1.8*l → 0.6+2.8*l (上限 2.5→3.4),加 pow 让低值也亮
        const ceilBright = (0.6 + Math.pow(l, 0.55) * 2.8) * flashMul;
        ceilStripMat.color.copy(_scratchColor).multiplyScalar(ceilBright);
      }
      if (kickStripMat) {
        _scratchColor.copy(STRIP_BASE_KICK).lerp(STRIP_BASE_CYBER_C, h * 0.7);
        // F15: 亮度 0.6+2.0*l → 0.5+3.2*l (上限 2.6→3.7)
        const kickBright = (0.5 + Math.pow(l, 0.5) * 3.2) * flashMul;
        kickStripMat.color.copy(_scratchColor).multiplyScalar(kickBright);
      }
      // cyber 灯: 叠加节拍增益(基础是 sin 呼吸 3.0±0.4/0.5)
      // F15: gain 0.8→1.5,让节拍真的"撞"
      if (_cyberMagenta) {
        _cyberMagenta.intensity = (3.0 + Math.sin(now * 0.0025) * 0.4) * (1 + l * 1.5);
      }
      if (_cyberCyan) {
        _cyberCyan.intensity = (3.0 + Math.sin(now * 0.0075 + 1.2) * 0.5) * (1 + h * 1.2);
      }
    } else {
      // 暂停/未播放: 让灯带平滑回到基线,避免突变
      F15_FLASH.gain = 0;       // 暂停时清空瞬态
      F15_FLASH.prevLow = 0;
      if (ceilStripMat) {
        ceilStripMat.color.copy(STRIP_BASE_CEIL);
      }
      if (kickStripMat) {
        kickStripMat.color.copy(STRIP_BASE_KICK);
      }
      // cyber 灯回到 sin 基线(下一帧 animateCyberLights 会覆盖)
    }

    // ===== F13-B: 投影幕波形更新 =====
    // - 每帧从 audioBus.getFreqDataCopy() 读 256 bin
    // - 256 bin 横向映射到 WAVE_W=256 列
    // - 频谱值(0..255) 映射到垂直 bar 高度(0..WAVE_H)
    // - 颜色: 暗底 + 频谱柱(低频红/中频青/高频白) — 像音乐播放器
    if (screenRefs && wavePixelBuf) {
      const freq = audioBus.getFreqDataCopy();
      const data = wavePixelBuf;
      if (_effectivePlaying && freq && freq.length >= WAVE_W) {
        // 1) 清屏(深蓝黑底)
        for (let i = 0; i < WAVE_W * WAVE_H; i++) {
          data[i * 4 + 0] = 0x0a;
          data[i * 4 + 1] = 0x0a;
          data[i * 4 + 2] = 0x18;
          data[i * 4 + 3] = 0xff;
        }
        // 2) 画中心基线(水平中线,稍微亮一点)
        const midY = WAVE_H >> 1;
        for (let x = 0; x < WAVE_W; x++) {
          data[(midY * WAVE_W + x) * 4 + 0] = 0x40;
          data[(midY * WAVE_W + x) * 4 + 1] = 0x40;
          data[(midY * WAVE_W + x) * 4 + 2] = 0x55;
        }
        // 3) 画频谱柱(对称向上+向下) — bin x 对应一列,值越大柱越长
        for (let x = 0; x < WAVE_W; x++) {
          // freq bin x → 0..255, 映射到像素高度
          // 给 0..128 bin 留出更多空间(主频),掐掉 > 128 (噪音)
          const rawIdx = x < 128 ? x : (128 + (x - 128) >> 1);
          const v = freq[rawIdx] || 0;        // 0..255
          // 视觉夸张: 让低值也能看见(> 4 才有)
          const h = Math.min(WAVE_H >> 1, Math.round((v / 255) * WAVE_H * 0.95));
          if (h < 1) continue;
          // 颜色:低频红(0..32 bin)/中频青(32..96)/高频品红(96..128)
          let r, g, b;
          if (x < 32) {
            // 红→橙
            r = 0xff; g = 0x60 + Math.min(0x60, h * 3); b = 0x20;
          } else if (x < 96) {
            // 青→绿
            r = 0x20; g = 0xe0; b = 0x80 + Math.min(0x60, h * 2);
          } else {
            // 品红→白
            r = 0xff; g = 0x60 + Math.min(0xa0, h * 4); b = 0xd0;
          }
          // 画柱: 从 midY 向上 + 向下(对称)
          for (let y = midY - h; y < midY + h; y++) {
            if (y < 0 || y >= WAVE_H) continue;
            const idx = (y * WAVE_W + x) * 4;
            data[idx + 0] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 0xff;
          }
        }
        // 4) 标记 DataTexture 需要上传到 GPU
        screenRefs.waveTex.needsUpdate = true;
        // emissive 强度随整体电平呼吸(0.5 ~ 1.4)
        if (screenRefs.screenMat) {
          screenRefs.screenMat.emissiveIntensity = 0.7 + currentBands.energy * 0.7;
        }
      } else {
        // 暂停/未播放:渐暗到基线 — 每帧 *0.92 直到接近待机色
        let any = false;
        for (let i = 0; i < WAVE_W * WAVE_H; i++) {
          const r = data[i * 4 + 0];
          const g = data[i * 4 + 1];
          const b = data[i * 4 + 2];
          if (r !== 0x0a || g !== 0x0a || b !== 0x18) {
            data[i * 4 + 0] = Math.max(0x0a, r - 4);
            data[i * 4 + 1] = Math.max(0x0a, g - 4);
            data[i * 4 + 2] = Math.min(0x18, b + 1);
            any = true;
          }
        }
        if (any) screenRefs.waveTex.needsUpdate = true;
        if (screenRefs.screenMat) {
          screenRefs.screenMat.emissiveIntensity = Math.max(0.3, screenRefs.screenMat.emissiveIntensity - 0.02);
        }
      }
    }

    // F14-A: VHS pass uniforms (time / flash / 渐变进度)
    if (vhsPass.enabled) {
      // 1) 渐变进度 (linear 插值)
      const fadeT = Math.min(1, (now - _vhsFadeStart) / VHS_FADE_MS);
      _vhsCurrent = _vhsFadeFrom + (_vhsFadeTo - _vhsFadeFrom) * fadeT;
      vhsPass.uniforms.uIntensity.value = _vhsCurrent;
      // 2) uTime (秒)
      vhsPass.uniforms.uTime.value = (now - _cyber_t0) * 0.001;
      // F14-G: 顶部白闪 uFlash 已删除(见 VHSShader.js) — 不再每 2-5s 触发顶部白闪
    }

    // F14-A: 用 composer 渲染 (含 RenderPass + VHS + OutputPass)
    composer.render();

    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  // E3: 相机进出动画
  // 进入:相机从远处 + 俯视 lerp 到目标位,约 400ms ease-out
  // 退出:相机 lerp 远离 + 抬高,然后调用方 dispose
  // 关键:动画期间 controls.enabled = false 避免用户拖拽错位
  // F6b 默认视角：用户原图角度（沙发后看向 -Z 幕方向），fov 72 拉宽容下沙发+吉他+左右扬声器
  const TARGET_CAM = { pos: new THREE.Vector3(-1.5, 1.8, 8.5), look: new THREE.Vector3(0.5, 1.0, -2.5) };
  const ENTRY_CAM = { pos: new THREE.Vector3(-2.0, 3.0, 11.0), look: new THREE.Vector3(0.5, 0.8, -2.5) };
  const EXIT_CAM  = { pos: new THREE.Vector3(-2.0, 3.0, 11.0), look: new THREE.Vector3(0.5, 0.8, -2.5) };
  const CAM_ANIM_MS = 420;
  let _camAnimHandle = 0;

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function animateCamera(fromPos, fromLook, toPos, toLook, durationMs) {
    if (_camAnimHandle) { cancelAnimationFrame(_camAnimHandle); _camAnimHandle = 0; }
    const start = performance.now();
    controls.enabled = false;
    // 立即设起始位
    camera.position.copy(fromPos);
    camera.lookAt(fromLook);
    controls.target.copy(fromLook);
    const step = () => {
      const now = performance.now();
      const t = Math.min(1, (now - start) / durationMs);
      const e = easeOutCubic(t);
      camera.position.lerpVectors(fromPos, toPos, e);
      const look = new THREE.Vector3().lerpVectors(fromLook, toLook, e);
      camera.lookAt(look);
      controls.target.copy(look);
      if (t < 1) {
        _camAnimHandle = requestAnimationFrame(step);
      } else {
        _camAnimHandle = 0;
        controls.enabled = true;
      }
    };
    _camAnimHandle = requestAnimationFrame(step);
  }
  // 启动时跑一次进入动画:从 ENTRY_CAM 推到 TARGET_CAM
  animateCamera(ENTRY_CAM.pos, ENTRY_CAM.look, TARGET_CAM.pos, TARGET_CAM.look, CAM_ANIM_MS);

  // F13-G: 诊断导出 — 上层(Dashboard/Preview)能读 _effectivePlaying / freq / screenRefs
  if (typeof window !== 'undefined') {
    window.__SCENE_DBG__ = {
      get _effectivePlaying() { return playState.playing || _detectPlayingFallback(); },
      get playState() { return { ...playState }; },
      get currentBands() { return { ...currentBands }; },
      get screenRefs() { return screenRefs; },
      get wavePixelBuf() { return wavePixelBuf; },
      get freq() { return audioBus.getFreqDataCopy(); },
      get audioEl() { return _audioEl ? { paused: _audioEl.paused, currentTime: _audioEl.currentTime, src: _audioEl.src?.split('/').pop() } : null; },
      get busState() { return audioBus.getState?.(); },
    };
  }

  // ==================== F14-A: 后处理 (EffectComposer + VHS) ====================
  // 1) 建 composer (用 renderer 当前 size + pixelRatio,渲染到 RT,最终 OutputPass 输出到屏幕)
  // 2) RenderPass: 主场景渲染
  // 3) VHSPass: 自定义 VHS 滤镜 (默认 enabled,带 300ms 渐显动画)
  // 4) OutputPass: tone mapping + sRGB 转换 (与 renderer 保持一致)
  // → tick() 里调 composer.render() 替代 renderer.render()
  const composer = new EffectComposer(renderer);
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // VHS pass — 初始 enabled, uIntensity 在 setEnabled 时做 300ms 渐变
  // F14-A: 从 localStorage 读取用户上次偏好,默认开启
  const _vhsStored = (() => {
    try { return localStorage.getItem('milo.vhs.enabled'); } catch (_) { return null; }
  })();
  const _vhsInitEnabled = _vhsStored === null ? true : _vhsStored === '1';
  const vhsPass = new ShaderPass(VHSShader);
  vhsPass.uniforms.uResolution.value.set(
    window.innerWidth * renderer.getPixelRatio(),
    window.innerHeight * renderer.getPixelRatio(),
  );
  // 默认 on — 用户首次进入 3D 就看到复古效果 (符合"整个客厅像被老录像带拍下来")
  vhsPass.enabled = _vhsInitEnabled;
  vhsPass.uniforms.uIntensity.value = _vhsInitEnabled ? 0 : 0;  // 启动后从 0 → 1 渐显
  composer.addPass(vhsPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // VHS 状态机 — 渐变 + 顶部白闪随机触发
  let _vhsEnabled = _vhsInitEnabled;
  let _vhsTarget = 1.0;
  let _vhsCurrent = 0.0;     // 0..1
  const VHS_FADE_MS = 300;
  let _vhsFadeStart = performance.now();
  let _vhsFadeFrom = 0.0;
  let _vhsFadeTo = 1.0;
  const vhsController = {
    isEnabled: () => _vhsEnabled,
    setEnabled(next) {
      next = !!next;
      if (next === _vhsEnabled) return;
      _vhsEnabled = next;
      vhsPass.enabled = next;
      _vhsTarget = next ? 1.0 : 0.0;
      _vhsFadeFrom = _vhsCurrent;
      _vhsFadeTo = _vhsTarget;
      _vhsFadeStart = performance.now();
      // F14-A: 持久化用户偏好(下次进 3D 恢复)
      try { localStorage.setItem('milo.vhs.enabled', next ? '1' : '0'); } catch (_) {}
    },
    toggle() { vhsController.setEnabled(!_vhsEnabled); },
  };
  // 暴露给 HUD (3d/hud.js 点击按钮时调 setEnabled)
  if (typeof window !== 'undefined') {
    window.__vhsPass = vhsController;
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    setTheme: (mode) => setTheme(scene, renderer, lights, room, mode),
    // E3: 退场动画。返回 Promise,动画结束后再 dispose。
    // 由调用方在 then() 里 dispose()。
    playExit: () => new Promise((resolve) => {
      animateCamera(TARGET_CAM.pos, TARGET_CAM.look, EXIT_CAM.pos, EXIT_CAM.look, CAM_ANIM_MS);
      setTimeout(resolve, CAM_ANIM_MS);
    }),
    onResize,
    dispose: () => {
      _running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (_camAnimHandle) { cancelAnimationFrame(_camAnimHandle); _camAnimHandle = 0; }
      if (_resizeTimer) { clearTimeout(_resizeTimer); _resizeTimer = 0; }
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      controls.dispose();
      // F14-A: composer + pass 释放 (RT + shader material)
      composer.dispose();
      renderer.dispose();
      // 卸 VHS controller
      if (typeof window !== 'undefined' && window.__vhsPass === vhsController) {
        window.__vhsPass = null;
      }
      // 取消 audioBus 订阅
      subs.forEach((off) => { try { off(); } catch (_) {} });
      // 卸 HUD
      unmountHud();
      // 几何体/材质在 room 内部已分离，调用方负责 scene.traverse 释放
      scene.traverse((obj) => {
        if (obj.isMesh) {
          obj.geometry?.dispose?.();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material?.dispose?.();
        }
      });
      // F12-C fix: 清空 module-level 引用,防下次 initScene 拿到 disposed light
      if (_cyberMagenta === lights.cyberMagenta) _cyberMagenta = null;
      if (_cyberCyan    === lights.cyberCyan)    _cyberCyan    = null;
      // F12-D: 同样清空 4 盏角落灯引用
      if (_cornerMagentaBL === lights.cornerMagentaBL) _cornerMagentaBL = null;
      if (_cornerMagentaFR === lights.cornerMagentaFR) _cornerMagentaFR = null;
      if (_cornerCyanFL    === lights.cornerCyanFL)    _cornerCyanFL    = null;
      if (_cornerCyanBR    === lights.cornerCyanBR)    _cornerCyanBR    = null;
    },
  };
}
