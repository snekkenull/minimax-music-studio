/**
 * 3D Home Audio — Room Builder
 *
 * 极简客厅 + 音乐工作室元素：
 *  - 浅色墙 + 吸音棉条纹墙（音乐工作室标签）
 *  - 木地板（程序化条纹，无外部贴图）
 *  - 墙上挂电吉他（Les Paul 风格，琴体 + 琴颈 + 琴头 + 拾音器 + 旋钮）
 *  - 角落黑胶架（5 张黑胶 + 唱片盒 + 角度倾斜）
 *  - 调音台（主体 + 倾斜面板 + 24 旋钮 + 8 推子 + 显示屏 + VU 表 + LED 灯柱）
 *  - 落地灯（底座 + 灯杆 + 半透灯罩 + 真实 emissive 发光）
 *  - 吸顶灯（吊线 + 碗形灯罩 + emissive）
 *  - 音乐主题抽象画（声波 + 黑胶轮廓）
 *  - 沙发（主体 + 靠背 + 3 坐垫 + 2 扶手 + 4 脚 + 2 抱枕）— 朝向 -Z（面对前场）
 *  - 茶几 + 桌垫 + 遥控器 + 书
 *  - 投影幕（2.0×1.2 中心幕布 + 黑色边框 + 卷轴 + 顶挂件）— 居中前墙主视觉
 *  - 投影仪（天花板下短焦投影仪 + 镜头 + 状态灯）
 *  - 沙发/扬声器/调音台下的 contact shadow（圆形暗影）
 *  - 一盆小绿植（角落）
 *
 * 全部程序化生成，0 外部模型依赖。贴图只用 canvas 生成的 procedural。
 *
 * 公共 API：
 *   buildRoom() -> THREE.Group（包含 room.userData.speakers 给 E4 振膜用）
 */

import * as THREE from './lib/three.module.js';

// ============================================================
// RoundedBoxGeometry（内联实现，源自 three.js addons）
//   用于沙发/茶几/调音台/扬声器/灯罩等所有"应该圆角"的家具
//   优势：边缘弧度自然 + 保持 Box 拓扑（更省面）
// ============================================================
function makeRoundedBoxGeometry(width, height, depth, radius, smoothness = 4) {
  // 基于 RoundedBoxBufferGeometry 算法：内嵌一个稍小的 box，所有顶点沿
  // 法线方向推一段距离来"膨胀"成圆角。简化版用 sphere 化顶点。
  const shape = new THREE.Shape();
  const w = width, h = height, r = Math.min(radius, Math.min(w, h) / 2 - 0.001);
  const eps = 0.00001;
  const radius2 = r - eps;
  shape.absarc(eps, eps, radius2, -Math.PI / 2, -Math.PI, true);
  shape.absarc(eps, h - radius2 * 2, radius2, Math.PI, Math.PI / 2, true);
  shape.absarc(w - radius2 * 2, h - radius2 * 2, radius2, Math.PI / 2, 0, true);
  shape.absarc(w - radius2 * 2, eps, radius2, 0, -Math.PI / 2, true);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: depth - r * 2,
    bevelEnabled: true,
    bevelSegments: smoothness * 2,
    steps: 1,
    bevelSize: r - eps,
    bevelThickness: r - eps,
    curveSegments: smoothness,
  });
  geo.translate(-w / 2, -h / 2, -(depth - r * 2) / 2 - r + eps);
  geo.computeVertexNormals();
  return geo;
}

// ============================================================
// F9：赛博雨夜城市全景（程序化 canvas 贴图，1024×1024）
//   元素：深紫黑天 + 多层视差建筑 + 赛博灯光窗 + 飞船 + 雨丝 + 雨雾
// ============================================================
function makeCyberCityTexture(side = 'left') {  // Task A: legacy alias
  return makeNightCityTexture(side);
}

function makeNightCityTexture(side = 'left') {
  const W = 1024, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // -------- 1. 天空渐变（深紫黑→深蓝紫） --------
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0.0, '#0a0612');
  sky.addColorStop(0.4, '#150a26');
  sky.addColorStop(0.7, '#1a0a2e');
  sky.addColorStop(1.0, '#08051a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // -------- 2. 远景剪影（最暗，仅顶部一道轮廓） --------
  ctx.fillStyle = '#06030f';
  const farBuildings = [
    [0, 0.55, 0.30], [60, 0.45, 0.35], [140, 0.55, 0.25],
    [220, 0.40, 0.45], [320, 0.55, 0.30], [400, 0.50, 0.40],
    [490, 0.45, 0.35], [580, 0.55, 0.30], [670, 0.40, 0.45],
    [780, 0.50, 0.35], [880, 0.55, 0.30], [970, 0.45, 0.40],
  ];
  for (const [x, topR, wR] of farBuildings) {
    const w = wR * W;
    const h = topR * H;
    ctx.fillRect(x, H * 0.45 - h * 0.5, w, H - (H * 0.45 - h * 0.5));
  }

  // -------- 3. 中景建筑（带霓虹窗格，3-5 栋） --------
  //   每栋建筑：竖向矩形 + 顶冠变化（尖顶/平顶/天线）
  //   窗户：随机 8×N 网格，部分亮（赛博色）
  const cyberColors = [
    '#ff2bd6', '#00e0ff', '#ff007a', '#ffa040',
    '#40ff90', '#a060ff', '#ff5050', '#80f0ff',
  ];
  const midBuildings = [
    { x: 0.02, w: 0.12, top: 0.30, seed: 11, topType: 'spire' },
    { x: 0.16, w: 0.10, top: 0.22, seed: 23, topType: 'antenna' },
    { x: 0.28, w: 0.16, top: 0.35, seed: 37, topType: 'flat' },
    { x: 0.46, w: 0.11, top: 0.25, seed: 53, topType: 'antenna' },
    { x: 0.59, w: 0.14, top: 0.40, seed: 71, topType: 'spire' },
    { x: 0.75, w: 0.12, top: 0.28, seed: 89, topType: 'flat' },
    { x: 0.88, w: 0.10, top: 0.32, seed: 97, topType: 'antenna' },
  ];
  for (const b of midBuildings) {
    const bx = b.x * W, bw = b.w * W;
    const by = H * 0.5 - b.top * H;
    // 建筑主体：深蓝紫
    const bodyGrad = ctx.createLinearGradient(bx, by, bx, H);
    bodyGrad.addColorStop(0, '#1a1530');
    bodyGrad.addColorStop(0.5, '#120e22');
    bodyGrad.addColorStop(1, '#08060f');
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(bx, by, bw, H - by);

    // 顶冠装饰
    if (b.topType === 'spire') {
      ctx.fillStyle = '#0a0815';
      ctx.beginPath();
      ctx.moveTo(bx + bw * 0.4, by);
      ctx.lineTo(bx + bw * 0.5, by - 30);
      ctx.lineTo(bx + bw * 0.6, by);
      ctx.closePath();
      ctx.fill();
      // 塔尖红光
      ctx.fillStyle = '#ff2040';
      ctx.beginPath();
      ctx.arc(bx + bw * 0.5, by - 32, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (b.topType === 'antenna') {
      ctx.fillStyle = '#1a1a28';
      ctx.fillRect(bx + bw * 0.48, by - 40, 3, 40);
      ctx.fillStyle = '#ff3060';
      ctx.beginPath();
      ctx.arc(bx + bw * 0.5, by - 42, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 窗户：8×N 网格 + 随机赛博灯光
    const cols = 6, winW = bw / (cols + 2);
    const rows = Math.floor((H - by) / 18);
    for (let r = 0; r < rows; r++) {
      for (let cc = 0; cc < cols; cc++) {
        // 伪随机 (b.seed + r * 7 + cc * 13)
        const seedVal = (b.seed * 31 + r * 7 + cc * 13) % 100;
        if (seedVal < 22) continue; // 22% 概率无窗（更密）
        const winX = bx + (cc + 1) * (bw / (cols + 1)) - winW * 0.5;
        const winY = by + 10 + r * 18;
        if (winY > H - 5) continue;
        if (seedVal < 38) {
          // 16% 暗窗
          ctx.fillStyle = '#18142a';
        } else {
          // 62% 亮窗（赛博色）— 提亮
          const colorIdx = (b.seed + r + cc) % cyberColors.length;
          ctx.fillStyle = cyberColors[colorIdx];
        }
        ctx.fillRect(winX, winY, winW * 0.7, 10);
      }
    }

    // 招牌 / 横向霓虹带
    const bandCount = 1 + Math.floor((b.seed % 3));
    for (let bb = 0; bb < bandCount; bb++) {
      const bandY = by + 60 + bb * 120 + (b.seed % 50);
      if (bandY > H - 20) continue;
      const bandH = 4 + (b.seed % 3);
      const bandColor = cyberColors[(b.seed + bb * 5) % cyberColors.length];
      ctx.fillStyle = bandColor;
      ctx.shadowColor = bandColor;
      ctx.shadowBlur = 8;
      ctx.fillRect(bx + 4, bandY, bw - 8, bandH);
      ctx.shadowBlur = 0;
    }
  }

  // -------- 4. 近景建筑剪影（最黑，遮挡雨景） --------
  ctx.fillStyle = '#020108';
  const nearBuildings = [
    { x: 0, w: 0.18, top: 0.55 },
    { x: 0.20, w: 0.10, top: 0.60 },
    { x: 0.34, w: 0.22, top: 0.50 },
    { x: 0.58, w: 0.16, top: 0.62 },
    { x: 0.76, w: 0.24, top: 0.52 },
  ];
  for (const b of nearBuildings) {
    const bx = b.x * W, bw = b.w * W;
    const by = H * 0.5 - b.top * H * 0.5;
    ctx.fillRect(bx, by, bw, H - by);
    // 顶冠矩形（楼顶水箱/天线）
    ctx.fillRect(bx + bw * 0.2, by - 12, bw * 0.6, 12);
  }

  // -------- 5. 飞船（5-6 个飞行器剪影 + 引擎尾迹） --------
  const ships = [
    { x: 0.12, y: 0.16, type: 'cruiser', dir: 1 },
    { x: 0.32, y: 0.08, type: 'pod', dir: -1 },
    { x: 0.48, y: 0.20, type: 'cruiser', dir: 1 },
    { x: 0.68, y: 0.12, type: 'pod', dir: 1 },
    { x: 0.85, y: 0.18, type: 'cruiser', dir: -1 },
    { x: 0.92, y: 0.30, type: 'pod', dir: 1 },
  ];
  for (const s of ships) {
    const sx = s.x * W, sy = s.y * H;
    if (s.type === 'cruiser') {
      // 大型巡洋舰：横椭圆 + 引擎尾光
      ctx.fillStyle = '#3a3550';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 44, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      // 船体下侧悬翼
      ctx.fillStyle = '#2a2538';
      ctx.fillRect(sx - 30, sy + 6, 60, 3);
      // 引擎尾光
      ctx.fillStyle = '#00e0ff';
      ctx.shadowColor = '#00e0ff';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.ellipse(sx - 44 * s.dir, sy, 18, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // 顶部驾驶舱亮窗
      ctx.fillStyle = '#ff2bd6';
      ctx.shadowColor = '#ff2bd6';
      ctx.shadowBlur = 6;
      ctx.fillRect(sx - 8, sy - 5, 5, 4);
      ctx.fillRect(sx + 3, sy - 5, 5, 4);
      ctx.shadowBlur = 0;
    } else {
      // 小型 pod：圆形 + 单引擎
      ctx.fillStyle = '#3a3550';
      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffa040';
      ctx.shadowColor = '#ffa040';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.ellipse(sx - 14 * s.dir, sy, 10, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // -------- 5b. 巨型顶部霓虹招牌（中景） --------
  //   横向广告灯条，几栋楼顶带大字
  for (let i = 0; i < 4; i++) {
    const bIdx = i % midBuildings.length;
    const b = midBuildings[bIdx];
    const signX = (b.x + b.w * 0.5) * W;
    const signY = (0.5 - b.top) * H - 18;
    const signW = 60 + (i * 17) % 30;
    const signH = 14;
    const signColor = cyberColors[(i * 3) % cyberColors.length];
    ctx.fillStyle = signColor;
    ctx.shadowColor = signColor;
    ctx.shadowBlur = 16;
    ctx.fillRect(signX - signW / 2, signY, signW, signH);
    ctx.shadowBlur = 0;
    // 内部小竖线（伪文字）
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    for (let k = 0; k < 5; k++) {
      ctx.fillRect(signX - signW / 2 + 6 + k * 11, signY + 3, 4, signH - 6);
    }
  }

  // -------- 6. 雨丝（多层斜线，倾斜 70°，覆盖全图） --------
  //   用 setLineDash 做有节奏的雨纹
  ctx.strokeStyle = 'rgba(180, 200, 230, 0.20)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const len = 12 + Math.random() * 18;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - len * 0.36, y + len);
    ctx.stroke();
  }
  // 第二层（更亮但短）
  ctx.strokeStyle = 'rgba(200, 220, 255, 0.30)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 110; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const len = 8 + Math.random() * 10;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - len * 0.36, y + len);
    ctx.stroke();
  }
  // 第三层（最近，最细，玻璃面雨）
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const len = 6 + Math.random() * 8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - len * 0.36, y + len);
    ctx.stroke();
  }

  // -------- 7. 雨雾（顶部蒙黑，模拟景深模糊/雨天灰雾） --------
  const fog = ctx.createLinearGradient(0, 0, 0, H);
  fog.addColorStop(0.0, 'rgba(8, 6, 18, 0.65)');
  fog.addColorStop(0.3, 'rgba(8, 6, 18, 0.25)');
  fog.addColorStop(0.6, 'rgba(8, 6, 18, 0.0)');
  fog.addColorStop(1.0, 'rgba(8, 6, 18, 0.45)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, W, H);

  // -------- 8. 玻璃面水流痕（5-6 条垂直透明带，玻璃雨水流下） --------
  ctx.strokeStyle = 'rgba(180, 200, 220, 0.25)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const sx = 80 + Math.random() * (W - 160);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    // 微微 S 形
    for (let y = 0; y < H; y += 30) {
      const dx = Math.sin(y * 0.04 + i) * 3;
      ctx.lineTo(sx + dx, y);
    }
    ctx.stroke();
  }

  // -------- 9. 顶部高光反射（建筑灯光映在玻璃上的水平亮带） --------
  for (let i = 0; i < 5; i++) {
    const y = 50 + i * 70 + Math.random() * 20;
    const grad = ctx.createLinearGradient(0, y - 1, 0, y + 1);
    grad.addColorStop(0, 'rgba(120, 180, 220, 0)');
    grad.addColorStop(0.5, 'rgba(140, 200, 240, 0.18)');
    grad.addColorStop(1, 'rgba(120, 180, 220, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - 1, W, 2);
  }

  // 镜像反转（让左右两侧城市不完全相同）
  if (side === 'right') {
    const imgData = ctx.getImageData(0, 0, W, H);
    const flipped = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const srcIdx = (y * W + x) * 4;
        const dstIdx = (y * W + (W - 1 - x)) * 4;
        flipped.data[dstIdx] = imgData.data[srcIdx];
        flipped.data[dstIdx + 1] = imgData.data[srcIdx + 1];
        flipped.data[dstIdx + 2] = imgData.data[srcIdx + 2];
        flipped.data[dstIdx + 3] = imgData.data[srcIdx + 3];
      }
    }
    ctx.putImageData(flipped, 0, 0);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ============================================================
// Task A：白天城市贴图（亮主题用）
//   元素：蓝天 + 阳光 + 白天建筑 + 玻璃幕墙反光 + 鸟群 + 云朵 + 太阳光斑
// ============================================================
function makeDayCityTexture(side = 'left') {
  const W = 1024, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // 1. 天空渐变（亮蓝→淡白）
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0.0, '#3a7ec8');   // 顶天深蓝
  sky.addColorStop(0.4, '#7ab0e0');   // 中天中蓝
  sky.addColorStop(0.7, '#b8d4e8');   // 地平线浅蓝
  sky.addColorStop(1.0, '#dde6ec');   // 雾霾淡白
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // 2. 太阳光斑（左上角）
  const sun = ctx.createRadialGradient(180, 120, 10, 180, 120, 180);
  sun.addColorStop(0, 'rgba(255, 240, 200, 0.95)');
  sun.addColorStop(0.3, 'rgba(255, 230, 180, 0.4)');
  sun.addColorStop(1, 'rgba(255, 220, 160, 0)');
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(180, 120, 180, 0, Math.PI * 2);
  ctx.fill();

  // 3. 远景剪影（最淡，灰蓝）
  ctx.fillStyle = '#a8b8c8';
  const farBuildings = [
    [0, 0.55, 0.30], [60, 0.45, 0.35], [140, 0.55, 0.25],
    [220, 0.40, 0.45], [320, 0.55, 0.30], [400, 0.50, 0.40],
    [490, 0.45, 0.35], [580, 0.55, 0.30], [670, 0.40, 0.45],
    [780, 0.50, 0.35], [880, 0.55, 0.30], [970, 0.45, 0.40],
  ];
  for (const [x, topR, wR] of farBuildings) {
    const w = wR * W;
    const h = topR * H;
    ctx.fillRect(x, H * 0.45 - h * 0.5, w, H - (H * 0.45 - h * 0.5));
  }

  // 4. 中景建筑（浅米色玻璃幕墙 + 真实窗）
  const midBuildings = [
    { x: 0.02, w: 0.12, top: 0.30 }, { x: 0.16, w: 0.10, top: 0.22 },
    { x: 0.28, w: 0.16, top: 0.35 }, { x: 0.46, w: 0.11, top: 0.25 },
    { x: 0.59, w: 0.14, top: 0.40 }, { x: 0.75, w: 0.12, top: 0.28 },
    { x: 0.88, w: 0.10, top: 0.32 },
  ];
  const windowTints = ['#5a7088', '#7090a8', '#88a0b0', '#4a5a68'];
  for (const b of midBuildings) {
    const bx = b.x * W, bw = b.w * W;
    const by = H * 0.5 - b.top * H;
    // 建筑主体：浅米色玻璃幕墙
    const bodyGrad = ctx.createLinearGradient(bx, by, bx, H);
    bodyGrad.addColorStop(0, '#d8d2c4');
    bodyGrad.addColorStop(0.5, '#b8b0a0');
    bodyGrad.addColorStop(1, '#7a7468');
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(bx, by, bw, H - by);

    // 窗户：白天真实窗（深蓝灰，反射天光）
    const cols = 6, winW = bw / (cols + 2);
    const rows = Math.floor((H - by) / 18);
    for (let r = 0; r < rows; r++) {
      for (let cc = 0; cc < cols; cc++) {
        const seedVal = (r * 7 + cc * 13 + 11) % 100;
        if (seedVal < 22) continue;
        const winX = bx + (cc + 1) * (bw / (cols + 1)) - winW * 0.5;
        const winY = by + 10 + r * 18;
        if (winY > H - 5) continue;
        ctx.fillStyle = windowTints[(r + cc + b.x * 10) % windowTints.length];
        ctx.fillRect(winX, winY, winW * 0.7, 10);
      }
    }
  }

  // 5. 鸟群（5 个 M 形小鸟剪影）
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1.5;
  const birds = [
    { x: 0.15, y: 0.10 }, { x: 0.28, y: 0.14 }, { x: 0.45, y: 0.08 },
    { x: 0.62, y: 0.16 }, { x: 0.78, y: 0.11 },
  ];
  for (const b of birds) {
    const bx = b.x * W, by = b.y * H;
    ctx.beginPath();
    ctx.moveTo(bx - 6, by);
    ctx.quadraticCurveTo(bx - 3, by - 3, bx, by);
    ctx.quadraticCurveTo(bx + 3, by - 3, bx + 6, by);
    ctx.stroke();
  }

  // 6. 云朵（6 个柔和白色团块）
  for (let i = 0; i < 6; i++) {
    const cx = (i * 173 + 50) % W;
    const cy = 60 + (i * 53) % 200;
    const cloudGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 50);
    cloudGrad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    cloudGrad.addColorStop(0.7, 'rgba(255, 255, 255, 0.4)');
    cloudGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = cloudGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 50, 14, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 7. 大气散射（顶部微白）
  const fog = ctx.createLinearGradient(0, 0, 0, H);
  fog.addColorStop(0.0, 'rgba(220, 230, 240, 0.30)');
  fog.addColorStop(0.3, 'rgba(220, 230, 240, 0.10)');
  fog.addColorStop(0.6, 'rgba(220, 230, 240, 0.0)');
  fog.addColorStop(1.0, 'rgba(220, 230, 240, 0.20)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, W, H);

  // 8. 玻璃反光带（5 条横向亮带，模拟阳光打在玻璃幕墙）
  for (let i = 0; i < 5; i++) {
    const y = 50 + i * 70;
    const grad = ctx.createLinearGradient(0, y - 1, 0, y + 1);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    grad.addColorStop(0.5, 'rgba(255, 255, 240, 0.35)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - 1, W, 2);
  }

  // 镜像反转
  if (side === 'right') {
    const imgData = ctx.getImageData(0, 0, W, H);
    const flipped = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const srcIdx = (y * W + x) * 4;
        const dstIdx = (y * W + (W - 1 - x)) * 4;
        flipped.data[dstIdx]     = imgData.data[srcIdx];
        flipped.data[dstIdx + 1] = imgData.data[srcIdx + 1];
        flipped.data[dstIdx + 2] = imgData.data[srcIdx + 2];
        flipped.data[dstIdx + 3] = imgData.data[srcIdx + 3];
      }
    }
    ctx.putImageData(flipped, 0, 0);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ============================================================
// 程序化贴图（每张分辨率精细，repeat 调合理）
// ============================================================

// F14-D: 真实木地板（2048×2048，4K 视感）
//   - 8 块宽木板（每块 256 宽），缝隙 4px
//   - 每块木板：基础色 + 60 道年轮 + 1-2 个节疤
//   - 增加早期木纹色相（warm chestnut）和微反射（明暗交替）
//   - 提高 anisotropy 16（侧视不糊）
function makeWoodTexture() {
  const W = 2048, H = 2048;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  // 底色（温润橡木 + 顶亮底暗）
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#9a6840');
  base.addColorStop(0.5, '#8a5a36');
  base.addColorStop(1, '#6a3e22');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  // 8 块宽木板（256 宽，缝隙 4px）
  const plankW = 256;
  const plankCount = 8;
  for (let p = 0; p < plankCount; p++) {
    const px = p * plankW;
    // 每块板自己的微妙色差（板间颜色变化明显）
    const hueShift = (Math.random() - 0.5) * 28;
    const satShift = (Math.random() - 0.5) * 18;
    const r = Math.max(40, Math.min(200, 154 + hueShift));
    const g = Math.max(30, Math.min(160, 104 + hueShift * 0.7 + satShift));
    const b = Math.max(20, Math.min(120, 64 + hueShift * 0.5));
    // 板的纵向渐变（上下色差，模拟光照）
    const plankGrad = ctx.createLinearGradient(0, 0, 0, H);
    plankGrad.addColorStop(0, `rgb(${r + 12},${g + 8},${b + 6})`);
    plankGrad.addColorStop(0.5, `rgb(${r},${g},${b})`);
    plankGrad.addColorStop(1, `rgb(${r - 18},${g - 12},${b - 8})`);
    ctx.fillStyle = plankGrad;
    ctx.fillRect(px, 0, plankW - 4, H);
    // 板缝（深 4px）
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(px + plankW - 4, 0, 4, H);
    // 板内年轮 + 纹路（120 道 → 比 1024 翻倍密度）
    for (let i = 0; i < 120; i++) {
      const y = Math.random() * H;
      const rr = 90 + Math.random() * 40;
      const gg = 60 + Math.random() * 30;
      const bb = 30 + Math.random() * 22;
      const a = 0.06 + Math.random() * 0.14;
      ctx.strokeStyle = `rgba(${rr},${gg},${bb},${a})`;
      ctx.lineWidth = 0.5 + Math.random() * 1.6;
      ctx.beginPath();
      ctx.moveTo(px, y);
      // 真实木纹:波动 + 抖
      for (let x = 0; x <= plankW - 4; x += 3) {
        const ny = y + Math.sin(x * 0.05 + i * 0.3) * 3
                    + Math.sin(x * 0.18 + i * 0.7) * 1.2
                    + (Math.random() - 0.5) * 0.8;
        ctx.lineTo(px + x, ny);
      }
      ctx.stroke();
    }
    // 细密竖纹（短而密，模拟切削纹理）
    for (let i = 0; i < 400; i++) {
      const y = Math.random() * H;
      const x = px + Math.random() * (plankW - 4);
      const len = 4 + Math.random() * 14;
      ctx.strokeStyle = `rgba(40,25,12,${0.05 + Math.random() * 0.10})`;
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 1, y + len);
      ctx.stroke();
    }
    // 偶发节疤（每板 1-3 个）
    const knotCount = 1 + Math.floor(Math.random() * 3);
    for (let k = 0; k < knotCount; k++) {
      const kx = px + 30 + Math.random() * (plankW - 60);
      const ky = 80 + Math.random() * (H - 160);
      const kr = 8 + Math.random() * 12;
      // 节疤核心（深）
      const grad = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
      grad.addColorStop(0, 'rgba(35,20,8,0.95)');
      grad.addColorStop(0.5, 'rgba(60,40,20,0.7)');
      grad.addColorStop(1, 'rgba(80,55,28,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(kx, ky, kr, 0, Math.PI * 2); ctx.fill();
      // 节疤暗心
      ctx.fillStyle = 'rgba(20,12,5,0.85)';
      ctx.beginPath(); ctx.arc(kx, ky, kr * 0.3, 0, Math.PI * 2); ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

// F14-D: 吸音棉尖劈墙 (升级 2048×1024, 密度翻倍, 阴影更明显)
function makeAcousticPanelTexture() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 1024;
  const ctx = c.getContext('2d');
  // 底色（深炭灰）
  ctx.fillStyle = '#1c1c20';
  ctx.fillRect(0, 0, 2048, 1024);
  // 尖劈三角阵列：列 128 个,每列 16 像素（密度翻倍,边缘更锐利）
  const W = 16;
  const H = 32;
  for (let col = 0; col < 128; col++) {
    const x = col * W;
    for (let row = 0; row < 32; row++) {
      const y = row * H;
      // 中心尖劈顶点
      const cx = x + W / 2;
      const cy = y + 2;
      // 左半（受光面）：浅灰填充 + 强高光
      ctx.fillStyle = '#4a4a52';
      ctx.beginPath();
      ctx.moveTo(x, y + H);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, y + H);
      ctx.closePath();
      ctx.fill();
      // 右半（背光面）：深灰填充
      ctx.fillStyle = '#18181c';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x + W, y + H);
      ctx.lineTo(cx, y + H);
      ctx.closePath();
      ctx.fill();
      // 高光线：左斜面
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y + H);
      ctx.stroke();
      // 阴线：右斜面
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x + W, y + H);
      ctx.stroke();
      // 顶线（深色，勾出尖劈顶）
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.moveTo(cx - W / 2, y + H);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + W / 2, y + H);
      ctx.stroke();
    }
  }
  // 整体噪点
  for (let i = 0; i < 8000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`;
    ctx.fillRect(Math.random() * 2048, Math.random() * 1024, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

// F14-D: 音乐主题抽象画（声波 + 黑胶轮廓 + 暖色几何）— 升级 1024×1024
function makeArtTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const ctx = c.getContext('2d');
  // 暖色渐变背景
  const g = ctx.createLinearGradient(0, 0, 1024, 1024);
  g.addColorStop(0, '#3a2418');
  g.addColorStop(0.5, '#7a3e1e');
  g.addColorStop(1, '#d4a574');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 1024);
  // 中央黑胶轮廓（直径 320，比 512 时翻倍）
  ctx.fillStyle = 'rgba(20,18,15,0.85)';
  ctx.beginPath(); ctx.arc(512, 512, 320, 0, Math.PI * 2); ctx.fill();
  // 沟槽（密度翻倍,共 90 道）
  for (let r = 120; r < 300; r += 2) {
    ctx.strokeStyle = `rgba(255,255,255,${0.04 + (r % 40) * 0.005})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(512, 512, r, 0, Math.PI * 2); ctx.stroke();
  }
  // 中心标签
  ctx.fillStyle = '#d4a574';
  ctx.beginPath(); ctx.arc(512, 512, 110, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a2418';
  ctx.beginPath(); ctx.arc(512, 512, 12, 0, Math.PI * 2); ctx.fill();
  // 声波（左下到右上, 1024 宽）
  ctx.strokeStyle = 'rgba(255,250,240,0.85)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let x = 120; x < 920; x += 2) {
    const y = 840 - 120 * Math.sin(x * 0.02) - 60 * Math.sin(x * 0.06);
    if (x === 120) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // 副声波
  ctx.strokeStyle = 'rgba(255,250,240,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 120; x < 920; x += 2) {
    const y = 880 - 80 * Math.sin(x * 0.025 + 1);
    if (x === 120) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // 第三声波（更密）
  ctx.strokeStyle = 'rgba(255,200,140,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 120; x < 920; x += 2) {
    const y = 800 - 40 * Math.sin(x * 0.04 + 2);
    if (x === 120) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // 标题文字
  ctx.fillStyle = 'rgba(255,250,240,0.9)';
  ctx.font = 'bold 44px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('SIDE A', 512, 940);
  // 副标题
  ctx.font = 'italic 22px Georgia, serif';
  ctx.fillStyle = 'rgba(255,200,140,0.7)';
  ctx.fillText('33⅓ RPM  ·  STEREO', 512, 980);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// F14-D: 录音棚墙面 — 声学吸音板（深炭灰带细密小孔）
// 1024×1024 可平铺，左右后墙均用
function makeWallTexture() {
  const W = 1024, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  // 底色（深暖灰）
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#3a3530');
  base.addColorStop(0.5, '#2e2a26');
  base.addColorStop(1, '#26221e');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  // 4×8 吸音板阵列（每板 256×128）
  const panelW = 256, panelH = 128;
  const cols = 4, rows = 8;
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const px = cIdx * panelW;
      const py = r * panelH;
      // 板面微色差
      const tint = (Math.random() - 0.5) * 14;
      const rr = 50 + tint;
      const gg = 46 + tint * 0.9;
      const bb = 40 + tint * 0.7;
      const pGrad = ctx.createLinearGradient(px, py, px, py + panelH);
      pGrad.addColorStop(0, `rgb(${rr + 6},${gg + 5},${bb + 4})`);
      pGrad.addColorStop(0.5, `rgb(${rr},${gg},${bb})`);
      pGrad.addColorStop(1, `rgb(${rr - 8},${gg - 7},${bb - 6})`);
      ctx.fillStyle = pGrad;
      ctx.fillRect(px + 2, py + 2, panelW - 4, panelH - 4);
      // 板边暗缝
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(px, py + panelH - 2, panelW, 2);
      ctx.fillRect(px + panelW - 2, py, 2, panelH);
      // 板内吸音小孔（密集点阵）
      for (let i = 0; i < 80; i++) {
        const fx = px + 6 + Math.random() * (panelW - 12);
        const fy = py + 6 + Math.random() * (panelH - 12);
        const fr = 0.6 + Math.random() * 1.2;
        ctx.fillStyle = `rgba(0,0,0,${0.3 + Math.random() * 0.4})`;
        ctx.beginPath(); ctx.arc(fx, fy, fr, 0, Math.PI * 2); ctx.fill();
        // 孔的右上高光（凹陷感）
        ctx.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.05})`;
        ctx.beginPath(); ctx.arc(fx - fr * 0.3, fy - fr * 0.3, fr * 0.5, 0, Math.PI * 2); ctx.fill();
      }
      // 板面微噪点（粗糙感）
      for (let i = 0; i < 200; i++) {
        const nx = px + 4 + Math.random() * (panelW - 8);
        const ny = py + 4 + Math.random() * (panelH - 8);
        const na = Math.random() * 0.10;
        ctx.fillStyle = `rgba(255,255,255,${na})`;
        ctx.fillRect(nx, ny, 1, 1);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// F14-D: 天花板 — 哑光石膏板（米白带细密麻点）
function makeCeilingTexture() {
  const W = 1024, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  // 底色（米白）
  ctx.fillStyle = '#e8e2d4';
  ctx.fillRect(0, 0, W, H);
  // 整体微亮渐变（中心稍亮）
  const center = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7);
  center.addColorStop(0, 'rgba(255,250,235,0.4)');
  center.addColorStop(1, 'rgba(180,170,150,0.2)');
  ctx.fillStyle = center;
  ctx.fillRect(0, 0, W, H);
  // 细密麻点（隔音石膏）
  for (let i = 0; i < 8000; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const a = Math.random() * 0.18;
    const dark = Math.random() < 0.5;
    ctx.fillStyle = dark ? `rgba(80,70,55,${a})` : `rgba(255,255,250,${a * 0.7})`;
    ctx.fillRect(x, y, 1, 1);
  }
  // 长裂缝（4-5 条微妙斜线）
  for (let i = 0; i < 4; i++) {
    ctx.strokeStyle = `rgba(100,90,75,${0.04 + Math.random() * 0.06})`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    let x = Math.random() * W;
    let y = Math.random() * H;
    ctx.moveTo(x, y);
    for (let s = 0; s < 30; s++) {
      x += (Math.random() - 0.5) * 18;
      y += (Math.random() - 0.5) * 8;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// 织物纹理（沙发用，bumpMap）
function makeFabricTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a4a48';
  ctx.fillRect(0, 0, 512, 512);
  // 织物编织（细密十字斜纹）
  for (let y = 0; y < 512; y += 3) {
    for (let x = 0; x < 512; x += 3) {
      const v = Math.random() * 0.18;
      ctx.fillStyle = `rgba(255,255,255,${v})`;
      ctx.fillRect(x, y, 1.5, 1.5);
      const v2 = Math.random() * 0.12;
      ctx.fillStyle = `rgba(0,0,0,${v2})`;
      ctx.fillRect(x + 1.5, y + 1.5, 1.5, 1.5);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// 投影幕纹理（哑光白带极细水平纹理）
function makeScreenTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  // 底色
  ctx.fillStyle = '#eaeaea';
  ctx.fillRect(0, 0, 512, 512);
  // 极细水平织物纹
  for (let y = 0; y < 512; y += 2) {
    ctx.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.02})`;
    ctx.fillRect(0, y, 512, 1);
  }
  // 微噪点
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.04})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// 调音台显示屏（频谱 + 双轨波形 + 通道电平 + 顶部时间码 + dB 标尺）
function makeConsoleScreenTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  // 暗青底
  ctx.fillStyle = '#0a1a18';
  ctx.fillRect(0, 0, 256, 96);
  // 扫描网格
  ctx.strokeStyle = 'rgba(80,255,200,0.10)';
  ctx.lineWidth = 1;
  for (let x = 0; x < 256; x += 16) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 96); ctx.stroke();
  }
  for (let y = 0; y < 96; y += 12) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke();
  }
  // dB 标尺（左侧）
  ctx.fillStyle = 'rgba(90,255,200,0.55)';
  ctx.font = '7px monospace';
  ['0','-6','-12','-24','-∞'].forEach((label, i) => {
    ctx.fillText(label, 1, 14 + i * 18);
  });

  // 频谱（8 个频段柱状图，左侧）
  const bands = [22, 28, 32, 26, 30, 24, 18, 14];
  for (let i = 0; i < bands.length; i++) {
    const h = bands[i];
    const gradient = ctx.createLinearGradient(0, 80 - h, 0, 80);
    gradient.addColorStop(0, '#5affc8');
    gradient.addColorStop(1, '#0a4a3a');
    ctx.fillStyle = gradient;
    ctx.fillRect(18 + i * 4, 80 - h, 3, h);
  }

  // 双轨波形（右侧）
  ctx.strokeStyle = '#5affc8';
  ctx.lineWidth = 1.2;
  for (let track = 0; track < 2; track++) {
    const baseY = track === 0 ? 36 : 68;
    ctx.beginPath();
    for (let x = 56; x < 256; x += 2) {
      const y = baseY + 12 * Math.sin(x * 0.18 + track) * Math.exp(-Math.abs(x - 156) / 90);
      if (x === 56) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // 双轨通道标签
  ctx.fillStyle = '#5affc8';
  ctx.font = 'bold 7px monospace';
  ctx.fillText('L', 56, 14);
  ctx.fillText('R', 56, 90);

  // 顶部时间码 + 状态
  ctx.fillStyle = '#5affc8';
  ctx.font = 'bold 8px monospace';
  ctx.fillText('02:34:17', 80, 9);
  ctx.fillStyle = 'rgba(90,255,200,0.7)';
  ctx.fillText('48kHz 24bit', 140, 9);
  ctx.fillText('REC', 200, 9);
  // REC 红点
  ctx.fillStyle = '#ff3030';
  ctx.beginPath(); ctx.arc(222, 7, 2, 0, Math.PI * 2); ctx.fill();

  // 底部状态条
  ctx.fillStyle = 'rgba(90,255,200,0.4)';
  ctx.fillRect(0, 88, 180, 1);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 调音台屏幕 VU 表内容（半圆刻度 + 数字 + 红区）
function makeVuDialTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 64);
  const cx = 64, cy = 56, r = 38;
  const startA = Math.PI;
  const endA = 0;
  // 弧线背景
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, r, startA, endA, false);
  ctx.stroke();
  // 红区（右侧最后 ~20%）
  ctx.strokeStyle = '#ff3030';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, r, startA + (endA - startA) * 0.78, endA, false);
  ctx.stroke();
  // 刻度线 + 数字
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1;
  const labels = ['-20', '-10', '-5', '-3', '0', '+3'];
  for (let i = 0; i < labels.length; i++) {
    const a = startA + (endA - startA) * (i / (labels.length - 1));
    const x1 = cx + (r - 8) * Math.cos(a);
    const y1 = cy - (r - 8) * Math.sin(a);
    const x2 = cx + (r - 1) * Math.cos(a);
    const y2 = cy - (r - 1) * Math.sin(a);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const tx = cx + (r - 16) * Math.cos(a);
    const ty = cy - (r - 16) * Math.sin(a);
    ctx.fillStyle = i >= 4 ? '#ff7a7a' : 'rgba(255,255,255,0.85)';
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i], tx, ty + 2);
  }
  // VU 标签
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = 'bold 6px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('VU', 4, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 黑胶标签（F7-C：同心纹路 + 中心标贴 + 曲名 + 多色环 + 中心孔）
function makeVinylLabelTexture(title = 'Side A', accentColor = '#d4a25a') {
  // F14-D: 升级 256→512（黑胶标签细节翻倍）
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  // 1. 黑胶底色（深黑 + 极淡径向渐变模拟光泽）— 中心 256
  const baseGrad = ctx.createRadialGradient(256, 256, 60, 256, 256, 256);
  baseGrad.addColorStop(0, '#0a0a0a');
  baseGrad.addColorStop(0.5, '#0d0d0d');
  baseGrad.addColorStop(1, '#050505');
  ctx.fillStyle = baseGrad;
  ctx.beginPath(); ctx.arc(256, 256, 248, 0, Math.PI * 2); ctx.fill();
  // 2. 密集同心纹路（黑胶沟纹 — F14-D 密度翻倍）
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 0.6;
  for (let r = 72; r < 248; r += 0.8) {
    ctx.beginPath(); ctx.arc(256, 256, r, 0, Math.PI * 2); ctx.stroke();
  }
  // 3. 外缘亮环（光线反射的"sheen"）
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(256, 256, 244, 0, Math.PI * 2); ctx.stroke();
  // 4. 中心标贴（彩色圆 + 曲名）— 半径 76（原 38 翻倍）
  ctx.fillStyle = accentColor;
  ctx.beginPath(); ctx.arc(256, 256, 76, 0, Math.PI * 2); ctx.fill();
  // 标贴外环（深一圈）
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(256, 256, 76, 0, Math.PI * 2); ctx.stroke();
  // 标贴内环（小一圈）
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(256, 256, 60, 0, Math.PI * 2); ctx.stroke();
  // 5. 曲名（顶部弧形 + 底部副标题）
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 18px serif';
  ctx.textAlign = 'center';
  // 沿弧形排列标题
  ctx.save();
  ctx.translate(256, 256);
  ctx.fillText(title.toUpperCase(), 0, -32);
  ctx.restore();
  ctx.font = 'italic 12px serif';
  ctx.fillText('33⅓ RPM', 256, 290);
  ctx.fillText('STEREO', 256, 304);
  // 6. 中心孔（深色小圆）
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(256, 256, 6, 0, Math.PI * 2); ctx.fill();
  // 中心孔高光
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath(); ctx.arc(254, 254, 2, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// 唱片盒封面（F7-C：彩色封面 + 标题 + 装饰条 + 角标）— F14-D 升级 512×1024
function makeSleeveCoverTexture(title = 'Album', trackCount = 12, baseColor = '#a83a3a') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 1024;
  const ctx = c.getContext('2d');
  // 底色
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 512, 1024);
  // 上半部分深色阴影（vignette）
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  // 顶部装饰条（黑）
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 32, 512, 112);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 32px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('♫ LP RECORDS', 24, 104);
  // 中部圆形装饰（大黑胶轮廓）— 中心 256,440, 大圆 152
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(256, 440, 152, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(256, 440, 112, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(256, 440, 24, 0, Math.PI * 2); ctx.stroke();
  // 中心亮点
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath(); ctx.arc(256, 440, 6, 0, Math.PI * 2); ctx.fill();
  // 中部微渐变（更亮）
  const ringGrad = ctx.createRadialGradient(256, 440, 0, 256, 440, 152);
  ringGrad.addColorStop(0, 'rgba(255,255,255,0.05)');
  ringGrad.addColorStop(1, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = ringGrad;
  ctx.beginPath(); ctx.arc(256, 440, 152, 0, Math.PI * 2); ctx.fill();
  // 标题（黑色色块上白字）
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(32, 660, 448, 200);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = 'bold 56px serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, 256, 740);
  ctx.font = '36px monospace';
  ctx.fillStyle = 'rgba(255,200,100,0.85)';
  ctx.fillText(`${trackCount} TRACKS`, 256, 808);
  // 底部条形码（黑白条）
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(32, 920, 448, 80);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  let bx = 48;
  // 条形码宽度翻倍
  const widths = [2, 4, 2, 6, 2, 2, 4, 2, 6, 4, 2, 2, 4, 6, 2, 4, 2, 6, 2, 4, 6, 2, 4, 2];
  for (const w of widths) {
    ctx.fillRect(bx, 932, w, 56);
    bx += w + 4;
  }
  // 右下角小标志
  ctx.fillStyle = 'rgba(255,200,100,0.7)';
  ctx.font = 'italic 24px serif';
  ctx.textAlign = 'right';
  ctx.fillText('Side A · 2024', 488, 992);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ============================================================
// 房间尺寸
// ============================================================
export const ROOM = { w: 10, h: 3, d: 8 }; // 宽10 高3 深8

// Task A: 暴露城市贴图生成器给 scene.js 用于主题切换
export { makeNightCityTexture, makeDayCityTexture };

// ============================================================
// F12-D: 天花板四边灯带 + 地板四边踢脚灯带
//   - 8 条 emissive 灯条(纯自发光装饰,不增加 Light)
//   - 贴墙四边: 4 条沿天花板 (0.04m 厚 × 0.04m 高)
//              4 条沿踢脚线 (0.04m 厚 × 0.08m 高)
//   - 颜色/强度跟主题走(THEME_PRESETS.ambientStripI / kickStripI)
//   - 灯带位置: 紧贴墙体内侧, 离墙 0.01m 避免 z-fighting
// ============================================================
function buildAmbientStrips() {
  const g = new THREE.Group();
  g.name = 'AmbientStrips';

  // ---- 1. 天花板四边灯带 ----
  //   沿 -X 方向两条 + 沿 -Z 方向两条, 在四角用 BoxGeometry 拼出框架
  //   几何: 沿 X 长 = ROOM.w - 2*margin, 沿 Z 长 = ROOM.d - 2*margin
  //   实际放置: y = ROOM.h - 0.06 (下沉 0.04 离开天花板底面, 避免 z-fight 闪烁)
  //   实际放置: z = ±(ROOM.d/2 - 0.01)
  //   实际放置: x = ±(ROOM.w/2 - 0.01)
  //   尺寸: 厚 0.04, 高 0.04
  //   F14-E fix: 旧版 y = ROOM.h - 0.02 灯带顶面正好在天花板底面 (y=ROOM.h) → z-fight 闪烁
  const ceilStripGeoLR = new THREE.BoxGeometry(ROOM.w - 0.02, 0.04, 0.04);
  const ceilStripGeoFB = new THREE.BoxGeometry(0.04, 0.04, ROOM.d - 0.02);
  const ceilStripMat = new THREE.MeshBasicMaterial({
    color: 0x6a3a90,  // 深紫 (dark 主题色)
    toneMapped: false,  // 关键: 不参与 toneMapping → 始终保持亮
  });

  // 后墙方向 (z = -ROOM.d/2 + 0.01)
  const ceilBack = new THREE.Mesh(ceilStripGeoLR, ceilStripMat);
  ceilBack.position.set(0, ROOM.h - 0.06, -ROOM.d / 2 + 0.01);
  g.add(ceilBack);
  // 前墙方向 (z = +ROOM.d/2 - 0.01)
  const ceilFront = new THREE.Mesh(ceilStripGeoLR, ceilStripMat);
  ceilFront.position.set(0, ROOM.h - 0.06, ROOM.d / 2 - 0.01);
  g.add(ceilFront);
  // 左墙方向 (x = -ROOM.w/2 + 0.01)
  const ceilLeft = new THREE.Mesh(ceilStripGeoFB, ceilStripMat);
  ceilLeft.position.set(-ROOM.w / 2 + 0.01, ROOM.h - 0.06, 0);
  g.add(ceilLeft);
  // 右墙方向 (x = +ROOM.w/2 - 0.01)
  const ceilRight = new THREE.Mesh(ceilStripGeoFB, ceilStripMat);
  ceilRight.position.set(ROOM.w / 2 - 0.01, ROOM.h - 0.06, 0);
  g.add(ceilRight);

  // ---- 2. 地板四边踢脚灯带 ----
  //   沿踢脚线, 厚 0.04, 高 0.08
  //   y = 0.05 (底面离地 0.01, 顶面 0.09) — 抬离地板 0.01 避免 z-fight
  //   F14-E fix: 旧版 y = 0.04 底面恰好贴地板 (y=0) → 边缘 z-fight 微闪
  const kickStripGeoLR = new THREE.BoxGeometry(ROOM.w - 0.02, 0.08, 0.04);
  const kickStripGeoFB = new THREE.BoxGeometry(0.04, 0.08, ROOM.d - 0.02);
  const kickStripMat = new THREE.MeshBasicMaterial({
    color: 0x4020a0,  // 深蓝紫 (dark 主题色)
    toneMapped: false,
  });

  const kickBack = new THREE.Mesh(kickStripGeoLR, kickStripMat);
  kickBack.position.set(0, 0.05, -ROOM.d / 2 + 0.01);
  g.add(kickBack);
  const kickFront = new THREE.Mesh(kickStripGeoLR, kickStripMat);
  kickFront.position.set(0, 0.05, ROOM.d / 2 - 0.01);
  g.add(kickFront);
  const kickLeft = new THREE.Mesh(kickStripGeoFB, kickStripMat);
  kickLeft.position.set(-ROOM.w / 2 + 0.01, 0.05, 0);
  g.add(kickLeft);
  const kickRight = new THREE.Mesh(kickStripGeoFB, kickStripMat);
  kickRight.position.set(ROOM.w / 2 - 0.01, 0.05, 0);
  g.add(kickRight);

  // ---- 3. 暴露材质引用 + group 自身(给 setTheme 改色) ----
  g.userData = {
    ceilStripMat,  // 单材质共享 → 4 条天花板灯带同时变色
    kickStripMat,  // 单材质共享 → 4 条踢脚灯带同时变色
  };

  return g;
}

// ============================================================
// 主体
// ============================================================
export function buildRoom(mode = 'dark') {
  const root = new THREE.Group();
  root.name = 'HomeAudioRoom';

  // ---------- 共享材质 ----------
  // F14-D: 墙/天花板从纯色升级为程序化贴图
  //   - 墙：1024 吸音板阵列（小孔/暗缝/微噪点）
  //   - 天花：1024 哑光石膏板（米白 + 麻点 + 微裂缝）
  const wallTex = makeWallTexture();
  wallTex.repeat.set(2, 1); // 宽墙 2 次, 短墙 1 次
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex,
    color: 0xb8a890, // 微染色让吸音板偏暖,不被纹理压暗
    roughness: 0.88, metalness: 0.0,
  });
  const ceilingTex = makeCeilingTexture();
  ceilingTex.repeat.set(2, 1);
  const ceilingMat = new THREE.MeshStandardMaterial({
    map: ceilingTex,
    color: 0xffffff,
    roughness: 0.95, metalness: 0.0,
  });
  const woodTex = makeWoodTexture();
  woodTex.repeat.set(2, 2);
  const floorMat = new THREE.MeshStandardMaterial({
    map: woodTex, roughness: 0.55, metalness: 0.0,
  });
  const acousticTex = makeAcousticPanelTexture(); // F7-A 保留函数，材质不再使用
  acousticTex.repeat.set(2, 1); // 1024 宽 × repeat 2 = 一次 512 横向内看见 2 次尖劈（保留兼容）

  // ---------- 地板 ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  // ---------- 天花 ----------
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM.h;
  ceiling.receiveShadow = true;
  root.add(ceiling);

  // ---------- 后墙（吸音棉墙）----------
  // F7-A：把"贴图假尖劈"升级为"真 3D 尖劈 InstancedMesh"
  //   - 后墙 PlaneGeometry 用纯深炭灰底色（去掉尖劈贴图，因为现在是真 3D 尖劈）
  //   - 在墙前 0.05m 铺一层 4 棱锥（楔形）InstancedMesh，接收光照 + 投射阴影
  //   - 排除区域：幕布 + 画 + 吉他挂墙位置（中心 ±3m）不铺，避免遮挡
  const backWallMat = new THREE.MeshStandardMaterial({
    color: 0x14141a, roughness: 0.95, metalness: 0.0,
  });
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.h), backWallMat);
  backWall.position.set(0, ROOM.h / 2, -ROOM.d / 2);
  backWall.receiveShadow = true;
  root.add(backWall);

  // F7-A: 真 3D 尖劈阵列
  //   - 单元：四棱锥 ConeGeometry(radius=0.12, height=0.18, radialSegments=4)
  //     顶点在 +Y（指向房间内），底面在 -Y（贴墙），高 0.18m
  //   - 密度：横向 0.2m 间距 × 纵向 0.2m 间距 → 10/0.2 × 3/0.2 = 50 × 15 = 750 实例
  //   - 排除中央 [-3, +3] 区间（幕布 + 吉他 + 画）→ 只在边缘铺
  //   - 微微错位（每实例微随机 ±0.005m）让尖劈不齐整更像手工安装
  const WEDGE_W = 0.20;       // 横向间距
  const WEDGE_H = 0.20;       // 纵向间距
  const WEDGE_SIZE = 0.10;    // 底面半径（让相邻尖劈几乎贴住但有缝）
  const WEDGE_HEIGHT = 0.18;  // 尖劈高度（指向房间内）
  const WEDGE_Z = -ROOM.d / 2 + 0.05;  // 距墙 0.05m
  const WEDGE_EXCLUDE_X = 3.2;          // 中心 ±3.2m 不铺（让幕布+画+吉他区域干净）
  const wedgeGeo = new THREE.ConeGeometry(WEDGE_SIZE, WEDGE_HEIGHT, 4, 1);
  // ConeGeometry 默认顶点朝 +Y、底面朝 -Y，正好是我们要的姿态（尖朝房间内）
  // 但 4 段圆周 = 4 边形 + 顶点，要 rotate 让 4 个侧面有"棱"而不是"圆滑"。
  // 默认已经够用（4 radialSegments 自然形成 4 个三角面）。
  const wedgeMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a32,
    roughness: 0.88,
    metalness: 0.0,
  });
  // 统计实例数：横向 ROW_X = round(ROOM.w / WEDGE_W) = 50
  // 纵向 ROW_Y = round(ROOM.h / WEDGE_H) = 15
  // 排除中央 -WEDGE_EXCLUDE_X ~ +WEDGE_EXCLUDE_X → 只在 X 方向排除
  const cols = Math.round(ROOM.w / WEDGE_W); // 50
  const rows = Math.round(ROOM.h / WEDGE_H); // 15
  // 实际位置：墙范围 X[-5, +5] Y[0, 3] Z=-4
  //   X 中心 = -5 + (col + 0.5) * WEDGE_W
  //   Y 底 = (row + 0.5) * WEDGE_H
  // 排除条件：X 中心在 [-WEDGE_EXCLUDE_X, +WEDGE_EXCLUDE_X] → 不创建
  let wedgeCount = 0;
  const wedgePositions = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = -ROOM.w / 2 + (col + 0.5) * WEDGE_W;
      const cy = (row + 0.5) * WEDGE_H;
      // 排除中央 [−3.2, +3.2]（让出幕布/画/吉他）
      if (cx > -WEDGE_EXCLUDE_X && cx < WEDGE_EXCLUDE_X) continue;
      // 微随机错位（让阵列不齐整）
      const jitterX = (Math.random() - 0.5) * 0.01;
      const jitterY = (Math.random() - 0.5) * 0.01;
      wedgePositions.push({ x: cx + jitterX, y: cy + jitterY });
    }
  }
  // 创建 InstancedMesh
  const wedgeMesh = new THREE.InstancedMesh(wedgeGeo, wedgeMat, wedgePositions.length);
  wedgeMesh.castShadow = true;
  wedgeMesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < wedgePositions.length; i++) {
    const p = wedgePositions[i];
    // ConeGeometry 顶点在 +Y 高度一半，底面在 -Y 一半。我们想让"底面贴墙、顶点朝房间内"
    //   底面 Y = cy - 0（贴墙）→ 几何中心 Y = cy + WEDGE_HEIGHT/2
    //   底面 Z = WEDGE_Z（贴墙前 0.05m）→ 几何中心 Z = WEDGE_Z（中心已经在前 0.05m，因为 height 全在 +Y）
    // 但 Z 方向是"前"，没有"厚度"。我们要让尖劈的底面**贴在墙面**（Z=WEDGE_Z+底面凸起 0），
    //   顶点朝房间内 +Z 方向：这是错的，ConeGeometry 的轴向是 Y，不是 Z。
    // 解决：把几何 rotate 让轴朝 +Z
    dummy.position.set(p.x, p.y - WEDGE_HEIGHT / 2, WEDGE_Z);
    // ConeGeometry 顶点 Y=+height/2，底面 Y=-height/2
    // 我们让底面 Y = p.y - WEDGE_HEIGHT/2（贴墙）→ 中心 Y = p.y
    // 顶点在 Y=+WEDGE_HEIGHT → 朝房间内上方（+Y），不是 +Z
    // 想让尖朝 +Z（房间内）→ 旋转 -90° 绕 X 轴
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    wedgeMesh.setMatrixAt(i, dummy.matrix);
  }
  // 但要"尖朝房间内"，需要把整个 wedgeMesh 的几何改成轴向 +Z
  // 简化：建一个 group，旋转 wedgeMesh 让轴朝 +Z
  wedgeMesh.geometry.rotateX(-Math.PI / 2); // 现在轴沿 +Z，底面在 Z=0，顶点在 Z=+WEDGE_HEIGHT
  // 重新计算位置：底面 Z = WEDGE_Z，顶点 Z = WEDGE_Z + WEDGE_HEIGHT
  for (let i = 0; i < wedgePositions.length; i++) {
    const p = wedgePositions[i];
    // 底面中心应在墙面 Z=WEDGE_Z，几何中心 Z = WEDGE_Z + WEDGE_HEIGHT/2
    dummy.position.set(p.x, p.y, WEDGE_Z + WEDGE_HEIGHT / 2);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    wedgeMesh.setMatrixAt(i, dummy.matrix);
  }
  wedgeMesh.instanceMatrix.needsUpdate = true;
  root.add(wedgeMesh);

  // ---------- F9：左/右墙改为全玻璃幕墙 ----------
  //   - 城市背景（程序化赛博雨夜贴图，emissive 自发光）
  //   - 玻璃层（MeshPhysicalMaterial，transmission 真透光）
  //   - 窗框（3×2 黑色金属网格，6 块窗格 × 2 墙）
  //   - 玻璃雨水流痕增强真实感
  const GLASS_CELL_W = 1.0;   // 每格宽（沿墙深度方向）
  const GLASS_CELL_H = 1.5;   // 每格高
  const GLASS_GRID_X = 3;     // 横向 3 格
  const GLASS_GRID_Y = 2;     // 纵向 2 格
  const FRAME_W = 0.07;       // 框宽（加粗让窗格分割明显）
  const FRAME_T = 0.12;       // 框厚（向房间内侧突出，更显眼）
  const GLASS_GAP = 0.005;    // 玻璃与背景间距
  const GLASS_OFFSET = 0.06;  // 玻璃面比窗框前面稍后（在框内凹）

  function buildGlassWall(sideX, mode = 'dark') {
    const wallGroup = new THREE.Group();
    // Task A: mode='light' 用白天, 否则用夜晚
    const cityTex = (mode === 'light')
      ? makeDayCityTexture(sideX > 0 ? 'right' : 'left')
      : makeNightCityTexture(sideX > 0 ? 'right' : 'left');

    // 城市背景（emissive，让雨夜霓虹自己发光，不需要被照亮）
    const cityMat = new THREE.MeshStandardMaterial({
      map: cityTex,
      emissive: 0xffffff,
      emissiveMap: cityTex,
      emissiveIntensity: 1.1,    // 提亮：雨夜霓虹要看得清
      color: 0x404058,
      roughness: 0.95,
      metalness: 0.0,
    });
    const cityBg = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM.d, ROOM.h),
      cityMat,
    );
    cityBg.rotation.y = sideX > 0 ? -Math.PI / 2 : Math.PI / 2;
    cityBg.position.set(sideX - (sideX > 0 ? GLASS_GAP : -GLASS_GAP), ROOM.h / 2, 0);
    wallGroup.add(cityBg);
    wallGroup.userData.cityBg = cityBg;  // Task A: 暴露给 setTheme 切换

    // F12-B+C: 去 transmission + 湿反射增强（雨后玻璃质感）
    //   F12-B 原因：transmission 触发 WebGL 二次 RT，6 块玻璃 + 9 灯 + 2048 阴影 → GPU 死锁
    //   F12-C 增强：roughness 0.04 + clearcoat 0.85 = 雨后玻璃（赛博朋克标志质感）
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x9ab4d8,             // 冷蓝：深色玻璃基调
      transparent: true,
      opacity: 0.42,
      roughness: 0.04,              // F12-C: 0.08→0.04 湿镜面
      metalness: 0.1,
      // transmission: 0            // F12-B: 关闭折射 RT（性能关键）
      envMapIntensity: 1.8,        // 提亮（弥补 transmission 损失）
      side: THREE.DoubleSide,
      clearcoat: 0.85,             // F12-C: 0.6→0.85 更亮清漆
      clearcoatRoughness: 0.05,    // F12-C: 0.08→0.05 清漆更光滑
    });

    // 窗框（黑色金属）
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a12, roughness: 0.35, metalness: 0.85,
    });

    // 网格中心化：3 列 × 2 行 = 6 格
    const totalW = GLASS_GRID_X * GLASS_CELL_W;
    const totalH = GLASS_GRID_Y * GLASS_CELL_H;
    const startZ = -totalW / 2 + GLASS_CELL_W / 2;
    const startY = ROOM.h / 2 - totalH / 2 + GLASS_CELL_H / 2;

    for (let row = 0; row < GLASS_GRID_Y; row++) {
      for (let col = 0; col < GLASS_GRID_X; col++) {
        const cz = startZ + col * GLASS_CELL_W;
        const cy = startY + row * GLASS_CELL_H;

        // 玻璃面板（带雨水流痕的微调亮度）
        const glass = new THREE.Mesh(
          new THREE.PlaneGeometry(GLASS_CELL_W * 0.98, GLASS_CELL_H * 0.98),
          glassMat,
        );
        glass.rotation.y = sideX > 0 ? -Math.PI / 2 : Math.PI / 2;
        glass.position.set(
          sideX + (sideX > 0 ? GLASS_OFFSET : -GLASS_OFFSET),
          cy,
          cz,
        );
        wallGroup.add(glass);
      }
    }

    // 横向窗框（2 条：上下边界 + 1 条中分线）
    for (let i = 0; i <= GLASS_GRID_Y; i++) {
      const fy = ROOM.h / 2 - totalH / 2 + i * GLASS_CELL_H;
      const horizFrame = new THREE.Mesh(
        new THREE.BoxGeometry(FRAME_T, FRAME_W, totalW + FRAME_W * 2),
        frameMat,
      );
      horizFrame.position.set(sideX, fy, 0);
      wallGroup.add(horizFrame);
    }
    // 纵向窗框（4 条：左右边界 + 2 条中分线）
    for (let i = 0; i <= GLASS_GRID_X; i++) {
      const fz = -totalW / 2 + i * GLASS_CELL_W;
      const vertFrame = new THREE.Mesh(
        new THREE.BoxGeometry(FRAME_T, totalH + FRAME_W * 2, FRAME_W),
        frameMat,
      );
      vertFrame.position.set(sideX, ROOM.h / 2, fz);
      wallGroup.add(vertFrame);
    }
    // 顶/底窗框（最外圈略厚于内框）
    const topFrame = new THREE.Mesh(
      new THREE.BoxGeometry(FRAME_T * 1.5, FRAME_W * 1.5, totalW + FRAME_W * 4),
      frameMat,
    );
    topFrame.position.set(sideX, ROOM.h - FRAME_W * 0.5, 0);
    wallGroup.add(topFrame);
    const botFrame = new THREE.Mesh(
      new THREE.BoxGeometry(FRAME_T * 1.5, FRAME_W * 1.5, totalW + FRAME_W * 4),
      frameMat,
    );
    botFrame.position.set(sideX, FRAME_W * 0.5, 0);
    wallGroup.add(botFrame);

    return wallGroup;
  }
  // Task A: 玻璃墙接受 mode 参数, 暴露 glassWalls 给 setTheme
  const _leftWall  = buildGlassWall(-ROOM.w / 2, mode);
  const _rightWall = buildGlassWall(ROOM.w / 2, mode);
  root.add(_leftWall);
  root.add(_rightWall);
  root.userData.glassWalls = [_leftWall, _rightWall];

  // ---------- F0/F1：前场布局重整 ----------
  // 中心：投影幕（z = -3.9，y = 1.7）
  // 幕下方：调音台（z = -3.4）
  // 幕两侧：扬声器（落地式,标准 HiFi 三角定位: x=±3.0, z=-3.0）
  // 幕两侧 吸音棉墙上：画（左）/ 吉他（右）
  // 前墙角：黑胶架（左前角）/ 落地灯（沙发右侧,容易看到的光源）
  // 茶几 + 沙发：沙发 z=2.6 朝 -Z 看幕

  // F13-B: 投影幕（同时持有 DataTexture + screenMat 供 scene.js 频谱更新）
  const projectorScreen = buildProjectorScreen(new THREE.Vector3(0, 1.7, -3.92));
  root.add(projectorScreen);
  root.userData.projectorScreen = projectorScreen.userData;  // { waveTex, screenMat, WAVE_W, WAVE_H }
  root.add(buildProjector(new THREE.Vector3(0, ROOM.h - 0.32, -1.2)));
    // 调音台：幕布正下方居中（z=-3.1, 离幕布 0.8m 留出深度感）
  root.add(buildMixingConsole(new THREE.Vector3(0, 0, -3.1)));
  // 黑胶架：左前角
  root.add(buildVinylShelf(new THREE.Vector3(-4.2, 0, -3.4)));
  // 落地灯：沙发右侧（z=2.6, x=+2.6 — 在沙发右扶手外,灯光照沙发)
  const floorLamp = buildFloorLamp(new THREE.Vector3(2.6, 0, 2.6));
  root.add(floorLamp);
  // F11: 落地灯灯组引用暴露给 setTheme
  root.userData.floorLamp = { shadeMat: floorLamp.userData.shadeMat, bulbMat: floorLamp.userData.bulbMat, baseLedMat: floorLamp.userData.baseLedMat };
  // F12-A: 主题化材质引用(墙/天花/地板/后墙)— 让 setTheme 切 dark 主题时这些也变深色
  // F12-D fix: 同时保存 woodTex 引用 — dark 主题 setTheme 时用它还原 light 主题
  root.userData.themeMaterials = {
    wallMat,
    ceilingMat,
    floorMat,
    backWallMat,
    floorWoodTex: woodTex,  // F12-D fix: 用于主题切换时还原 light 主题贴图
  };
  // 吉他：吸音棉墙右半（z=-3.6, y=1.3, x=+2.0 — F6 修复：group.rotation.x=-35° 让琴头朝 -Z 方向
  //   旋转，但 neck 在局部 +Y 末端，旋转后实际位置 z=-3.78+0.98*sin(-35°)=-4.34 → 穿出墙 0.34m
  //   表现为"琴头脱离墙悬浮"。改为 group.rotation.x=+35°（+Y 偏 +Z），琴头朝房间内斜上
  //   同时把 group 离墙近一点（z=-3.6），让琴体仍贴墙，琴头在房间内不穿墙）
  root.add(buildElectricGuitar(new THREE.Vector3(2.0, 1.3, -3.6)));
  // 抽象画：吸音棉墙左半（幕布左侧）
  root.add(buildAbstractArt(new THREE.Vector3(-2.6, 1.7, -3.78)));
  // 沙发：z=2.6，面朝 -Z（看幕）
  root.add(buildSofa(new THREE.Vector3(0, 0, 2.6)));
  // 茶几：沙发与幕之间
  root.add(buildCoffeeTable(new THREE.Vector3(0, 0, 0.8)));
  // 扬声器对：移到幕两侧靠墙（标准 HiFi 三角定位：与沙发成 60° 角）
  const speakerPair = buildSpeakerPair(
    new THREE.Vector3(-3.0, 0, -3.0),
    new THREE.Vector3(3.0, 0, -3.0),
  );
  root.add(speakerPair);
  root.userData.speakers = speakerPair.userData.wooferRefs;
  // 吸顶灯
  const ceilingLamp = buildCeilingLamp(new THREE.Vector3(0, ROOM.h - 0.4, 1.0));
  root.add(ceilingLamp);
  // F11: 吸顶灯灯组引用暴露给 setTheme
  root.userData.ceilingLamp = { shadeMat: ceilingLamp.userData.shadeMat, bulbMat: ceilingLamp.userData.bulbMat, rimMat: ceilingLamp.userData.rimMat };
  // F12-D: 天花板四边灯带 + 地板四边踢脚灯带(8 条 emissive 装饰)
  const ambientStrips = buildAmbientStrips();
  root.add(ambientStrips);
  root.userData.ambientStrips = ambientStrips.userData;  // 暴露 {ceilStripMat, kickStripMat} 给 setTheme
  // 地毯：沙发与茶几之间
  root.add(buildRug(new THREE.Vector3(0, 0.01, 1.6)));
  // 角落绿植（左后）
  root.add(buildPlant(new THREE.Vector3(-4.5, 0, 3.0)));
  // 接触阴影（关键家具下方圆形暗影）
  root.add(buildContactShadow(new THREE.Vector3(0, 0.005, 2.6), 1.4, 0.55));     // 沙发
  root.add(buildContactShadow(new THREE.Vector3(0, 0.005, 0.8), 0.8, 0.45));     // 茶几
  root.add(buildContactShadow(new THREE.Vector3(-3.0, 0.005, -3.0), 0.32, 0.32)); // 左扬声器
  root.add(buildContactShadow(new THREE.Vector3(3.0, 0.005, -3.0), 0.32, 0.32));  // 右扬声器
  root.add(buildContactShadow(new THREE.Vector3(0, 0.005, -3.1), 0.55, 0.30));   // 调音台
  root.add(buildContactShadow(new THREE.Vector3(-4.2, 0.005, -3.4), 0.50, 0.40)); // 黑胶架
  root.add(buildContactShadow(new THREE.Vector3(2.6, 0.005, 2.6), 0.30, 0.30));   // 落地灯
  root.add(buildContactShadow(new THREE.Vector3(-4.5, 0.005, 3.0), 0.30, 0.30));  // 绿植

  return root;
}

// ============================================================
// F1：投影幕（居中，2.0×1.2m 哑光白幕 + 黑色边框 + 卷轴 + 顶挂件）
// ============================================================
function buildProjectorScreen(pos) {
  const g = new THREE.Group();
  g.position.copy(pos);

  // F13-B: 幕布本体用动态 DataTexture（256×64 RGBA），初始为"待机"暗屏
  // 让 scene.js 在播放时填入频谱波形;暂停时维持 last 帧或淡出到黑
  const WAVE_W = 256, WAVE_H = 64;
  const initialData = new Uint8Array(WAVE_W * WAVE_H * 4);
  // 待机底色: 深蓝黑 (#0a0a18)
  for (let i = 0; i < WAVE_W * WAVE_H; i++) {
    initialData[i * 4 + 0] = 0x0a;
    initialData[i * 4 + 1] = 0x0a;
    initialData[i * 4 + 2] = 0x18;
    initialData[i * 4 + 3] = 0xff;
  }
  const waveTex = new THREE.DataTexture(initialData, WAVE_W, WAVE_H, THREE.RGBAFormat);
  waveTex.colorSpace = THREE.SRGBColorSpace;
  waveTex.minFilter = THREE.LinearFilter;
  waveTex.magFilter = THREE.LinearFilter;
  waveTex.needsUpdate = true;

  const screenMat = new THREE.MeshStandardMaterial({
    map: waveTex,
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0.0,
    emissive: 0xffffff,        // 让波形颜色自发光,幕布看得清
    emissiveMap: waveTex,      // emissive 也用波形贴图
    emissiveIntensity: 0.85,   // F13-B: 0.1→0.85 让波形真的"亮起来"
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a, roughness: 0.5, metalness: 0.0,
  });
  const rollerMat = new THREE.MeshStandardMaterial({
    color: 0x222222, roughness: 0.4, metalness: 0.6,
  });

  const W = 2.0, H = 1.2, T = 0.025; // 幕布宽高厚
  const F = 0.04; // 边框宽

  // 幕布本体（中心面）
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), screenMat);
  screen.position.z = T / 2;
  g.add(screen);

  // 黑色边框（4 条）
  // 上
  const topFrame = new THREE.Mesh(new THREE.BoxGeometry(W + F * 2, F, T + 0.01), frameMat);
  topFrame.position.set(0, H / 2 + F / 2, 0);
  g.add(topFrame);
  // 下
  const botFrame = new THREE.Mesh(new THREE.BoxGeometry(W + F * 2, F, T + 0.01), frameMat);
  botFrame.position.set(0, -H / 2 - F / 2, 0);
  g.add(botFrame);
  // 左
  const leftFrame = new THREE.Mesh(new THREE.BoxGeometry(F, H, T + 0.01), frameMat);
  leftFrame.position.set(-W / 2 - F / 2, 0, 0);
  g.add(leftFrame);
  // 右
  const rightFrame = new THREE.Mesh(new THREE.BoxGeometry(F, H, T + 0.01), frameMat);
  rightFrame.position.set(W / 2 + F / 2, 0, 0);
  g.add(rightFrame);

  // 顶部卷轴
  const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, W + F * 2 + 0.04, 16), rollerMat);
  roller.rotation.z = Math.PI / 2;
  roller.position.set(0, H / 2 + F + 0.05, 0);
  g.add(roller);

  // 顶挂件（连到天花板，两根细线 + 横杆）
  const hangerMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.8 });
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, W + F * 2 + 0.1, 8), hangerMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, H / 2 + F + 0.07, 0);
  g.add(bar);
  // 吊线（两根，从屏幕顶部到天花板）
  // 注：实际长度由外部调用时根据 room.h - screen.y 决定，这里画到 ROOM.h
  const wireL = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, ROOM.h - pos.y - (H / 2 + F + 0.07), 6), hangerMat);
  wireL.position.set(-W / 2, (ROOM.h - pos.y) / 2 - (H / 2 + F + 0.07) / 2 + pos.y / 2, 0);
  // 简化：直接放在 group 局部坐标
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.4, metalness: 0.7 });
  const wireHeight = 0.5; // 幕顶到卷轴上面，再到 ceiling 的实际距离
  // 这里不画吊线，bar 顶到天花板的部分由场景层处理（避免穿模）

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // F13-B: 暴露给 scene.js 在播放时更新 waveform
  // - waveTex: DataTexture(RGBA 256x64) — scene.js 每帧重写 pixel data
  // - screenMat: 材质本身,scene.js 可以动态调 emissiveIntensity / map
  // - WAVE_W/WAVE_H: 写入时直接读
  g.userData = { waveTex, screenMat, WAVE_W, WAVE_H };
  return g;
}

// ============================================================
// F1：短焦投影仪（天花板下挂，金属盒 + 镜头 + 状态灯）
// ============================================================
function buildProjector(pos) {
  const g = new THREE.Group();
  g.position.copy(pos);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.6 });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.9 });
  const lensGlassMat = new THREE.MeshStandardMaterial({
    color: 0x4a6a8a, roughness: 0.1, metalness: 0.0,
    emissive: 0x6a8aaa, emissiveIntensity: 0.3,
  });
  const ledMat = new THREE.MeshStandardMaterial({
    color: 0x52ff7a, emissive: 0x52ff7a, emissiveIntensity: 1.2,
  });

  // 主体
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.22), bodyMat);
  g.add(body);
  // 镜头筒
  const lensBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 24), bodyMat);
  lensBarrel.rotation.x = Math.PI / 2;
  lensBarrel.position.set(0, 0, -0.14);
  g.add(lensBarrel);
  // 镜头玻璃
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.045, 24), lensGlassMat);
  glass.position.set(0, 0, -0.181);
  g.add(glass);
  // 状态灯
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 8), ledMat);
  led.position.set(0.12, 0.05, -0.111);
  g.add(led);
  // 散热孔（顶面几条细线用 box）
  for (let i = -2; i <= 2; i++) {
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.005, 0.005), lensMat);
    slit.position.set(0, 0.071, i * 0.025);
    g.add(slit);
  }
  // 顶挂件（小盒子接到天花板）
  const mount = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.08), bodyMat);
  mount.position.y = 0.085;
  g.add(mount);

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ============================================================
// 黑胶架（F7-C：5 张黑胶带纹路 + 5 个封面唱片盒 + 立放展示大唱片）
// ============================================================
function buildVinylShelf(pos) {
  const g = new THREE.Group();
  g.position.copy(pos);

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a2e1c, roughness: 0.6, metalness: 0.0 });
  const albums = [
    { title: 'Midnight Jazz', count: 12, color: '#7a3a2a' },
    { title: 'Lo-Fi Beats',  count: 10, color: '#2a4a7a' },
    { title: 'Soul Sessions', count: 14, color: '#5a2a6a' },
    { title: 'Blues Roots',  count: 11, color: '#6a4a1a' },
    { title: 'Acoustic',     count: 9,  color: '#1a5a4a' },
  ];
  const labelColors = ['#d4a25a', '#8aa4d4', '#c47ad4', '#d4b56a', '#7ad4a8'];

  // 木质立架
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 0.6), woodMat);
  left.position.set(-0.4, 0.6, 0);
  g.add(left);
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 0.6), woodMat);
  right.position.set(0.4, 0.6, 0);
  g.add(right);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.04, 0.6), woodMat);
  base.position.set(0, 0.05, 0);
  g.add(base);
  // 顶板
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.04, 0.6), woodMat);
  top.position.set(0, 1.18, 0);
  g.add(top);
  // 唱片盒（5 个方格 — F7-C 加封面纹理）
  for (let i = 0; i < 5; i++) {
    const coverTex = makeSleeveCoverTexture(albums[i].title, albums[i].count, albums[i].color);
    const sleeveFront = new THREE.Mesh(
      new THREE.PlaneGeometry(0.13, 0.28),
      new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.7 }),
    );
    sleeveFront.position.set(-0.3 + i * 0.15, 0.6, 0.276);
    g.add(sleeveFront);
    // 唱片盒侧面（深色 — 让盒子有厚度感）
    const sleeveSide = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.28, 0.005),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 }),
    );
    sleeveSide.position.set(-0.3 + i * 0.15, 0.6, 0.27);
    g.add(sleeveSide);
  }
  // 5 张黑胶（轻微角度倾斜 + F7-C 真实纹路标贴）
  for (let i = 0; i < 5; i++) {
    const labelTex = makeVinylLabelTexture(albums[i].title, labelColors[i]);
    const mat = new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.3, metalness: 0.1 });
    const vinyl = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.005, 32), mat);
    vinyl.rotation.x = Math.PI / 2;
    vinyl.position.set(-0.3 + i * 0.15, 0.4, 0.255);
    // 微微倾斜
    vinyl.rotation.z = (i % 2 === 0 ? 0.05 : -0.05);
    g.add(vinyl);
  }

  // F7-C 立放展示唱片（架顶放一张 12 寸大黑胶，斜靠顶板 — 视觉焦点）
  const showcaseTex = makeVinylLabelTexture('Best of', '#e8b870');
  const showcaseVinyl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.004, 32),
    new THREE.MeshStandardMaterial({ map: showcaseTex, roughness: 0.3, metalness: 0.1 }),
  );
  showcaseVinyl.rotation.x = Math.PI / 2; // 立放：圆面在 YZ 平面
  showcaseVinyl.position.set(0.30, 1.05, 0.18);
  showcaseVinyl.rotation.z = 0.20; // 微微后仰
  g.add(showcaseVinyl);
  // 立放唱片的小底座（细圆托）
  const standMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.6 });
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.06, 16), standMat);
  stand.position.set(0.30, 1.00, 0.18);
  g.add(stand);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ============================================================
// 吉他（Les Paul 风格：双切角 + 弧面 + 琴码 + 拾音器 + 旋钮）
// ============================================================
function buildElectricGuitar(pos) {
  const g = new THREE.Group();
  g.position.copy(pos);
  // F6c 重写：放弃 F5/F6 混乱的 rotation.x=π/2 链 + g.rotation.x=±35° 倾斜。
  // 新设计：让 ExtrudeGeometry 默认 +Z 拉伸的厚度方向 = 琴面/琴背法线。
  //   - 琴体 Shape 在 X-Y 平面，琴面/琴背在 X-Y，厚度沿 +Z 方向
  //   - 琴颈沿 +Y 方向延伸 0.7m
  //   - 琴头在 neck 末端
  //   - 整组 g.rotation.y = 0（不旋转）→ 琴体 X-Y 面 = 墙面（与墙平行），
  //     厚度 +Z 方向 = 房间内方向（朝 +Z）→ 琴背贴墙（z=-3.6 表面），琴面朝房间内
  //   - 琴头沿 +Y 垂直向上（Y 从 1.3-0.2=1.1m 琴体底到 1.3+1.04=2.34m 琴头顶）
  //   - 不放 X 倾斜，琴体正挂墙不"歪斜"
  //   F6d: 让 neck 整体绕 Z 轴 -12° 仰角（绕 Z 旋转 -12° 让 +Y 偏 -X），
  //   模拟真实吉他 neck pitch（与琴面成 ~12° 仰角），同时避免"neck 像垂直从 body 顶部插入的细棒"
  g.rotation.y = 0;
  g.rotation.z = THREE.MathUtils.degToRad(-12);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc94e1b, roughness: 0.35, metalness: 0.0, clearcoat: 0.3 });
  const neckMat = new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.55, metalness: 0.0 });
  const fretMat = new THREE.MeshStandardMaterial({ color: 0xc8c8d0, roughness: 0.3, metalness: 0.9 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.2, metalness: 0.95 });

  // 琴体：LP 双切角 + 圆弧腰身，X-Y 平面内的 Shape，ExtrudeGeometry 默认沿 +Z 拉伸 0.06m
  // 轮廓：X 范围 [-0.2, +0.2]，Y 范围 [-0.2, +0.2]
  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(0, -0.2);
  bodyShape.lineTo(-0.18, -0.05);
  bodyShape.absarc(-0.05, 0, 0.17, -Math.PI / 2 - 0.3, Math.PI / 2 + 0.5, false);
  bodyShape.lineTo(-0.05, 0.18);
  bodyShape.lineTo(0.05, 0.18);
  bodyShape.lineTo(0.18, -0.05);
  bodyShape.absarc(0.05, 0, 0.17, Math.PI / 2 - 0.5, -Math.PI / 2 + 0.3, true);
  const body = new THREE.Mesh(
    new THREE.ExtrudeGeometry(bodyShape, {
      depth: 0.06,
      bevelEnabled: true,
      bevelSegments: 4,
      bevelSize: 0.015,
      bevelThickness: 0.015,
      curveSegments: 12,
    }),
    bodyMat,
  );
  // 居中：Extrude 默认从 z=0 拉伸到 z=0.06，translate 让厚度中心在 z=0（这样 z=-0.03 贴墙，z=+0.03 朝房间内）
  body.geometry.translate(0, 0, -0.03);
  g.add(body);

  // 琴颈：从琴体上沿 y=+0.18 出发，沿 +Y 方向延伸到 y=+0.88（长 0.7m）
  // 梯形（琴体端宽 0.07，琴头端宽 0.054）
  const neckShape = new THREE.Shape();
  neckShape.moveTo(-0.035, 0);
  neckShape.lineTo(0.035, 0);
  neckShape.lineTo(0.027, 0.70);
  neckShape.lineTo(-0.027, 0.70);
  neckShape.closePath();
  const neck = new THREE.Mesh(
    new THREE.ExtrudeGeometry(neckShape, {
      depth: 0.03,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize: 0.008,
      bevelThickness: 0.008,
      curveSegments: 2,
    }),
    neckMat,
  );
  // 琴颈厚度 0.03 居中：z=-0.015~+0.015
  neck.position.set(0, 0.18, -0.015);
  g.add(neck);

  // 指板：比琴颈略宽，贴在琴颈 +Z 面（朝房间内）
  const fretboardShape = new THREE.Shape();
  fretboardShape.moveTo(-0.038, 0);
  fretboardShape.lineTo(0.038, 0);
  fretboardShape.lineTo(0.030, 0.68);
  fretboardShape.lineTo(-0.030, 0.68);
  fretboardShape.closePath();
  const fretboard = new THREE.Mesh(
    new THREE.ExtrudeGeometry(fretboardShape, {
      depth: 0.008,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.003,
      bevelThickness: 0.003,
      curveSegments: 2,
    }),
    fretMat,
  );
  // 指板在琴颈 +Z 表面 z=+0.015 之上
  fretboard.position.set(0, 0.18, 0.015);
  g.add(fretboard);

  // 品丝：7 根细线，沿 +Y 方向均匀分布（横跨 X 方向）
  for (let i = 0; i < 7; i++) {
    const fret = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.003, 0.010), metalMat);
    fret.position.set(0, 0.22 + i * 0.08, 0.024);
    g.add(fret);
  }

  // 琴头：LP 经典"开瓶器"梯形 + 圆角，比琴颈宽 2x
  const headShape = new THREE.Shape();
  headShape.moveTo(-0.04, 0);
  headShape.lineTo(0.04, 0);
  headShape.lineTo(0.075, 0.14);
  headShape.lineTo(0.0, 0.16);
  headShape.lineTo(-0.075, 0.14);
  headShape.closePath();
  const head = new THREE.Mesh(
    new THREE.ExtrudeGeometry(headShape, {
      depth: 0.03,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize: 0.008,
      bevelThickness: 0.008,
      curveSegments: 2,
    }),
    neckMat,
  );
  // 琴头在 neck 末端 y=+0.88 开始，厚度居中
  head.position.set(0, 0.88, -0.015);
  g.add(head);

  // 琴头上的弦钮（6 个小圆柱，沿 X 排列在琴头 +Z 面）
  for (let i = 0; i < 6; i++) {
    const tuner = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.02, 8), metalMat);
    // CylinderGeometry 默认沿 Y 轴（高）— 让轴朝 +Z（指板方向）
    tuner.rotation.x = Math.PI / 2;
    tuner.position.set(0.04 * (i - 2.5), 0.96, 0.018);
    g.add(tuner);
  }

  // 琴码（金属长条，在琴体下方 y=-0.08）
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 0.02), metalMat);
  bridge.position.set(0, -0.08, 0.04);
  g.add(bridge);

  // 拾音器（2 个，琴颈拾 y=+0.05，琴桥拾 y=-0.04）
  const pickupNeck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.018), metalMat);
  pickupNeck.position.set(0, 0.05, 0.04);
  g.add(pickupNeck);
  const pickupBridge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.018), metalMat);
  pickupBridge.position.set(0, -0.04, 0.04);
  g.add(pickupBridge);

  // 4 个音量/音色旋钮（沿 X 排列，琴体下沿 y=-0.14）
  for (let i = 0; i < 4; i++) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.015, 12), metalMat);
    // 让圆柱高方向朝 +Z
    knob.rotation.x = Math.PI / 2;
    knob.position.set(0.04 * (i - 1.5), -0.14, 0.04);
    g.add(knob);
  }

  // 拨片挡板（小三角，黑色，琴体中部 z=+0.045 朝房间内）
  const pickguard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.10, 0.004),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }));
  pickguard.position.set(0.0, 0.0, 0.045);
  g.add(pickguard);

  // 挂墙支架：黑色小方块在琴体背面（z=-0.04 紧贴墙）
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.4 }),
  );
  stand.position.set(0, 0, -0.04);
  g.add(stand);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ============================================================
// 调音台：显示屏 + 24 旋钮 + 8 推子 + LED 灯柱 + VU 表
// ============================================================
function buildMixingConsole(pos) {
  const g = new THREE.Group();
  g.position.copy(pos);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.3 });
  const surfaceMat = new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.5, metalness: 0.3 });
  const knobMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.6 });
  const knobColored = new THREE.MeshStandardMaterial({ color: 0xff8a3a, roughness: 0.4, metalness: 0.5 });
  const ledOn = new THREE.MeshStandardMaterial({ color: 0x52ff7a, emissive: 0x52ff7a, emissiveIntensity: 1.0 });
  const ledRed = new THREE.MeshStandardMaterial({ color: 0xff5252, emissive: 0xff5252, emissiveIntensity: 0.8 });
  const screenMat = new THREE.MeshStandardMaterial({
    map: makeConsoleScreenTexture(),
    emissive: 0xffffff,
    emissiveIntensity: 0.6,
    roughness: 0.2,
  });
  const faderMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5, metalness: 0.3 });

  // 主体（F5：圆角外壳 + 圆角面板）
  const body = new THREE.Mesh(
    makeRoundedBoxGeometry(0.85, 0.16, 0.4, 0.03, 4),
    bodyMat,
  );
  body.position.y = 0.08;
  g.add(body);
  // 前面板（F5：圆角 + 真实调音台微微上拱）
  // 用 Shape 画一个梯形（后高前低），拉伸 + 圆角
  const surfaceShape = new THREE.Shape();
  const sw = 0.83, sd = 0.38, fr = 0.02;
  const fwdW = sw * 0.95; // 前缘略窄（梯形上窄下宽的镜像）
  surfaceShape.moveTo(-sw / 2 + fr, sd / 2);
  surfaceShape.lineTo(sw / 2 - fr, sd / 2);
  surfaceShape.absarc(sw / 2 - fr, sd / 2 - fr, fr, 0, -Math.PI / 2, true);
  surfaceShape.lineTo(sw / 2 - fr, -sd / 2 + fr);
  surfaceShape.absarc(sw / 2 - fr, -sd / 2 + fr, fr, -Math.PI / 2, -Math.PI, true);
  surfaceShape.lineTo(-sw / 2 + fr, -sd / 2 + fr);
  surfaceShape.absarc(-sw / 2 + fr, -sd / 2 + fr, fr, -Math.PI, -Math.PI * 1.5, true);
  surfaceShape.lineTo(-sw / 2 + fr, sd / 2 - fr);
  surfaceShape.absarc(-sw / 2 + fr, sd / 2 - fr, fr, -Math.PI * 1.5, -Math.PI * 2, true);
  const surface = new THREE.Mesh(
    new THREE.ExtrudeGeometry(surfaceShape, {
      depth: 0.02,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize: 0.008,
      bevelThickness: 0.008,
      curveSegments: 4,
    }),
    surfaceMat,
  );
  surface.position.set(0, 0.17, -0.05);
  surface.rotation.x = THREE.MathUtils.degToRad(-12);
  g.add(surface);

  // 显示屏（顶部居中，倾斜）
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.13), screenMat);
  screen.position.set(0, 0.2, -0.16);
  screen.rotation.x = THREE.MathUtils.degToRad(-12);
  g.add(screen);
  // 显示屏边框
  const screenFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.16, 0.012),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.5 }),
  );
  screenFrame.position.set(0, 0.2, -0.165);
  screenFrame.rotation.x = THREE.MathUtils.degToRad(-12);
  g.add(screenFrame);

  // 旋钮阵列：8 通道 × 3 行（F5：圆柱 24 段 + 顶端凹槽 + 底部刻度环）
  for (let ch = 0; ch < 8; ch++) {
    for (let row = 0; row < 3; row++) {
      const isColored = row === 0;
      const x = -0.3 + ch * 0.085;
      const z = -0.10 + row * 0.038;
      // 旋钮主体（旋转后顶面朝 +Y）
      const k = new THREE.Mesh(
        new THREE.CylinderGeometry(0.013, 0.011, 0.022, 24),
        isColored ? knobColored : knobMat,
      );
      k.position.set(x, 0.19, z);
      k.rotation.x = Math.PI / 2; // 立起来：顶面朝上
      g.add(k);
      // 顶面刻度环（深色小圆环 — 真实旋钮的"底盘"）
      const baseRing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, 0.001, 24),
        new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 }),
      );
      baseRing.position.set(x, 0.179, z);
      g.add(baseRing);
      // 指示线（旋钮顶面上一根细线，按通道不同方向旋转 — F7-B 真实指针感）
      // 旋钮经 rotation.x=π/2 后顶面在 +z 方向（z = +0.011），顶面法线 = +Z
      // 指示线是一根从中心沿 +Z 方向延伸的细 Box，绕 +Z 轴旋转不同角度
      const indicatorAngle = ch * 0.6 + row * 0.4; // 不同通道/行的指示方向
      const indicator = new THREE.Mesh(
        new THREE.BoxGeometry(0.0015, 0.0015, 0.011), // 沿 z 拉长 0.011（指向顶面外）
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 }),
      );
      indicator.position.set(x, 0.19, z + 0.005); // 顶面位置 = z + 半径(0.011)，居中
      indicator.rotation.z = indicatorAngle; // 绕 +Z 旋转 = 顶面法线 = 改变指示方向
      g.add(indicator);
    }
  }

  // 8 个通道推子（F5：圆角滑轨 + 圆角推子头） + 通道号标签
  // 通道号纹理（一次性生成 8 个数字）
  const labelTexCache = [];
  for (let n = 1; n <= 8; n++) {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const cx = c.getContext('2d');
    cx.clearRect(0, 0, 32, 32);
    cx.fillStyle = 'rgba(90,255,200,0.85)';
    cx.font = 'bold 18px monospace';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText(String(n), 16, 16);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    labelTexCache.push(t);
  }
  const labelMat = new THREE.MeshBasicMaterial({ map: null, transparent: true, depthWrite: false });

  for (let ch = 0; ch < 8; ch++) {
    const x = -0.3 + ch * 0.085;
    // 滑轨凹槽（圆角 box 嵌入面板）
    const slot = new THREE.Mesh(
      makeRoundedBoxGeometry(0.014, 0.065, 0.006, 0.003, 2),
      new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.6 }),
    );
    slot.position.set(x, 0.19, 0.05);
    g.add(slot);
    // 推子头（圆角 box — 比滑轨宽 2 倍，真实推子头比滑轨宽）
    const fader = new THREE.Mesh(
      makeRoundedBoxGeometry(0.028, 0.018, 0.014, 0.004, 2),
      faderMat,
    );
    fader.position.set(x, 0.19 + (ch - 4) * 0.005, 0.058);
    g.add(fader);
    // 推子头上的指示线（白色细线，提示当前位置 — F7-B 真实推子头中央有白线）
    const faderLine = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, 0.001, 0.0005),
      new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 }),
    );
    faderLine.position.set(x, 0.19 + (ch - 4) * 0.005, 0.0655); // 在推子头顶面 +Z
    g.add(faderLine);
    // 通道号标签（推子上方 — 旋转对齐倾斜面板）
    labelMat.map = labelTexCache[ch];
    labelMat.needsUpdate = true;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 0.018), labelMat);
    label.position.set(x, 0.198, -0.06); // 在面板最前排（z=-0.10 上方）
    label.rotation.x = THREE.MathUtils.degToRad(-12);
    g.add(label);
  }

  // 主推子（右侧，比通道推子更大、更突出 — F7-B 真实调音台都有 master fader）
  const masterFaderSlot = new THREE.Mesh(
    makeRoundedBoxGeometry(0.018, 0.085, 0.008, 0.003, 2),
    new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.6 }),
  );
  masterFaderSlot.position.set(0.40, 0.19, 0.04);
  g.add(masterFaderSlot);
  const masterFader = new THREE.Mesh(
    makeRoundedBoxGeometry(0.035, 0.024, 0.018, 0.005, 2),
    faderMat,
  );
  masterFader.position.set(0.40, 0.196, 0.05); // 推到略高于 0dB
  g.add(masterFader);
  // 主推子头指示线
  const masterLine = new THREE.Mesh(
    new THREE.BoxGeometry(0.028, 0.001, 0.0005),
    new THREE.MeshStandardMaterial({ color: 0xff3030, roughness: 0.4, emissive: 0xff3030, emissiveIntensity: 0.4 }),
  );
  masterLine.position.set(0.40, 0.196, 0.0595);
  g.add(masterLine);
  // MASTER 标签
  const masterLabelCanvas = document.createElement('canvas');
  masterLabelCanvas.width = 64; masterLabelCanvas.height = 16;
  const mctx = masterLabelCanvas.getContext('2d');
  mctx.fillStyle = 'rgba(255,90,90,0.95)';
  mctx.font = 'bold 10px monospace';
  mctx.textAlign = 'center';
  mctx.fillText('MASTER', 32, 12);
  const masterLabelTex = new THREE.CanvasTexture(masterLabelCanvas);
  masterLabelTex.colorSpace = THREE.SRGBColorSpace;
  const masterLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.05, 0.012),
    new THREE.MeshBasicMaterial({ map: masterLabelTex, transparent: true, depthWrite: false }),
  );
  masterLabel.position.set(0.40, 0.198, -0.06);
  masterLabel.rotation.x = THREE.MathUtils.degToRad(-12);
  g.add(masterLabel);

  // LED 灯柱（每个通道一个：绿/黄/红）
  for (let ch = 0; ch < 8; ch++) {
    for (let i = 0; i < 3; i++) {
      const mat = i === 0 ? ledOn : (i === 1 ? ledOn : ledRed);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 8), mat);
      led.position.set(-0.3 + ch * 0.085, 0.19, 0.10 + i * 0.012);
      g.add(led);
    }
  }

  // VU 表（圆盘 + 刻度纹理 + 红区 + 真实指针 — F7-B 专业感）
  // 调音台面板有 -12° 倾角（绕 X 旋转 -12°）。圆盘默认在 XY 平面（法线 +Z），
  // 我们要它"平躺"在面板上（法线朝 +Y），所以基础旋转 = rotation.x = -π/2，
  // 再叠加 -12° = rotation.x = -π/2 - 12° = -102°
  const vuTex = makeVuDialTexture();
  const vuTilt = THREE.MathUtils.degToRad(-12) - Math.PI / 2;
  const vuDial = new THREE.Mesh(
    new THREE.CircleGeometry(0.07, 64),
    new THREE.MeshStandardMaterial({
      map: vuTex,
      color: 0x1a1a1a,
      emissive: 0xffffff,
      emissiveMap: vuTex,
      emissiveIntensity: 0.5,
      roughness: 0.4,
    }),
  );
  vuDial.position.set(0.4, 0.198, -0.13);
  vuDial.rotation.x = vuTilt;
  vuDial.rotation.z = Math.PI; // 让刻度开口朝 +Y（半圆朝上）
  g.add(vuDial);
  // VU 表外圈边框（金属圈）
  const vuRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.072, 0.004, 8, 48),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.3, metalness: 0.85 }),
  );
  vuRim.position.set(0.4, 0.198, -0.13);
  vuRim.rotation.x = vuTilt;
  g.add(vuRim);
  // VU 指针（细针 — 红色发光，固定在 -3dB 位置）
  const vuNeedle = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.0015, 0.0025),
    new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff3030, emissiveIntensity: 0.7 }),
  );
  vuNeedle.position.set(0.4, 0.198, -0.125); // 略高于表盘
  vuNeedle.rotation.x = vuTilt;
  vuNeedle.rotation.z = Math.PI + 0.35; // 指针偏右（半圆 0°=左，PI=右）
  g.add(vuNeedle);
  // VU 指针中心销
  const vuPin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, 0.003, 12),
    new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.8 }),
  );
  vuPin.position.set(0.4, 0.198, -0.122);
  vuPin.rotation.x = vuTilt;
  g.add(vuPin);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ============================================================
// 落地灯（半透灯罩 + 真实 emissive 发光 + castShadow）
// ============================================================
function buildFloorLamp(pos) {
  const g = new THREE.Group();
  g.position.copy(pos);

  const metalMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.35, metalness: 0.75 });
  // F8：落地灯更暖（2600K 钨丝感）
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xffe4b0,
    roughness: 0.55,
    metalness: 0.0,
    emissive: 0xffb060,
    emissiveIntensity: 0.85,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92,
  });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffe4a0,
    emissive: 0xffa050,
    emissiveIntensity: 2.4,
  });
  // F10: 底座赛博青色 LED 灯带（环底圈冷光，模拟赛博朋克公寓的"科技地板"细节）
  const baseLedMat = new THREE.MeshStandardMaterial({
    color: 0x00d0e8,
    emissive: 0x00d0e8,
    emissiveIntensity: 1.6,
  });

  // 底座
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.04, 24), metalMat);
  base.position.y = 0.02;
  g.add(base);
  // F10: 底座下圈冷青色 LED 环（紧贴底座底面外缘）
  //   TorusGeometry 半径 0.19m（底座下沿），管径 0.008m（细 LED 灯条感）
  const baseLed = new THREE.Mesh(
    new THREE.TorusGeometry(0.19, 0.008, 6, 36),
    baseLedMat,
  );
  baseLed.rotation.x = Math.PI / 2;
  baseLed.position.y = 0.005; // 底座下沿
  g.add(baseLed);
  // 灯杆
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.6, 12), metalMat);
  pole.position.y = 0.84;
  g.add(pole);
  // 灯罩（截锥形，更像真实灯罩）
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.22, 0.30, 32, 1, true),
    shadeMat,
  );
  shade.position.y = 1.72;
  g.add(shade);
  // 灯罩顶/底盖
  const shadeTop = new THREE.Mesh(new THREE.CircleGeometry(0.12, 32), shadeMat);
  shadeTop.rotation.x = -Math.PI / 2;
  shadeTop.position.y = 1.87;
  g.add(shadeTop);
  // 灯泡（灯罩内）
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), bulbMat);
  bulb.position.y = 1.72;
  g.add(bulb);

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // F11: 暴露灯组 mesh 引用,让 setTheme 调 emissiveIntensity/色
  g.userData.kind = 'floorLamp';
  g.userData.shadeMat = shadeMat;
  g.userData.bulbMat = bulbMat;
  g.userData.baseLedMat = baseLedMat;
  return g;
}
function buildAbstractArt(pos) {
  const g = new THREE.Group();
  g.position.copy(pos);
  // 画在前墙，画平面朝 +Z（朝房间内 = 朝相机）
  // 默认 PlaneGeometry 朝 +Z,无需旋转

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.5, metalness: 0.0 });
  const artMat = new THREE.MeshStandardMaterial({ map: makeArtTexture(), roughness: 0.7, metalness: 0.0 });

  // 画框（深木色，加深度感）
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.05), frameMat);
  g.add(frame);
  // 画布（z=+0.027 朝房间）
  const art = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.82), artMat);
  art.position.z = 0.027;
  g.add(art);

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ============================================================
// F0：沙发（朝 -Z：靠背 z=+0.4，主体面朝 -Z）
// ============================================================
function buildSofa(pos) {
  const g = new THREE.Group();
  g.position.copy(pos);

  // 织物材质（带 bumpMap）
  const fabricTex = makeFabricTexture();
  fabricTex.repeat.set(2, 2);
  const fabricMat = new THREE.MeshStandardMaterial({
    map: fabricTex,
    color: 0x3a4a48,
    roughness: 0.95,
    metalness: 0.0,
    bumpMap: fabricTex,
    bumpScale: 0.02,
  });
  const cushionMat = new THREE.MeshStandardMaterial({
    color: 0x2a3a38,
    roughness: 0.95,
    metalness: 0.0,
  });
  const pillowMat = new THREE.MeshStandardMaterial({ color: 0xc9a876, roughness: 0.9, metalness: 0.0 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.5 });

  // 主体（F5：圆角 box 替代直方体，弧度 radius=0.08 让边缘自然）
  const base = new THREE.Mesh(
    makeRoundedBoxGeometry(2.4, 0.5, 0.95, 0.08, 5),
    fabricMat,
  );
  base.position.y = 0.25;
  g.add(base);
  // 靠背（F5：圆角 + 微弧形（用 LatheGeometry 顶视弧面））
  // 简化做法：圆角 box + 略向前倾 5° 模拟靠背弧度
  const back = new THREE.Mesh(
    makeRoundedBoxGeometry(2.4, 0.7, 0.18, 0.06, 4),
    fabricMat,
  );
  back.position.set(0, 0.75, 0.4);
  back.rotation.x = THREE.MathUtils.degToRad(-5); // 微后仰 5°
  g.add(back);
  // 坐垫（F5：鼓包 — 用 SphereGeometry 切顶部 1/4，倒扣成圆角坐垫）
  for (let i = -1; i <= 1; i++) {
    const cushionGeo = new THREE.SphereGeometry(0.46, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const c = new THREE.Mesh(cushionGeo, cushionMat);
    c.scale.set(0.78, 0.18, 0.85); // 扁压成坐垫形状
    c.position.set(i * 0.78, 0.5, -0.05);
    g.add(c);
  }
  // 扶手（F6 修复：之前用 0.95m 高独立圆柱+圆球盖，看起来像"独立方块"立在主体外侧。
  // 真实沙发扶手：高度只到坐垫上沿（≈ 0.6m），贴主体侧面、与坐垫同宽延伸。
  // 改用：RoundedBox 矮扶手（0.45m 高 × 0.95m 深 + 主体深度），z 向与主体对齐，
  //       圆角 0.05 与主体圆角统一，位置 x=±1.2 内嵌一点让扶手与主体几何相接
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(
      makeRoundedBoxGeometry(0.18, 0.45, 0.95, 0.05, 4),
      fabricMat,
    );
    arm.position.set(sx * 1.2, 0.475, 0); // 高度居中（0.25~0.7），x 内嵌 0.02 紧贴主体边缘
    g.add(arm);
  }
  // 抱枕（F5：圆角 + 鼓包；F6：贴坐垫、靠靠背、贴扶手 — 真实抱枕是堆在坐垫后部靠背前的）
  for (const sx of [-1, 1]) {
    const pillowGeo = new THREE.SphereGeometry(0.18, 16, 12);
    const pillow = new THREE.Mesh(pillowGeo, pillowMat);
    pillow.scale.set(1, 1, 0.4);
    pillow.position.set(sx * 0.95, 0.55, 0.12);
    pillow.rotation.z = sx * 0.18;
    pillow.rotation.y = sx * 0.08;
    g.add(pillow);
  }
  // 沙发脚
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sz = -1; sz <= 1; sz += 2) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 10), legMat);
      leg.position.set(sx * 1.15, 0.05, sz * 0.42);
      g.add(leg);
    }
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ============================================================
// 茶几：桌面 + 桌垫 + 遥控器 + 书
// ============================================================
function buildCoffeeTable(pos) {
  const g = new THREE.Group();
  g.position.copy(pos);

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.4, metalness: 0.0 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3, metalness: 0.8 });
  const matMat = new THREE.MeshStandardMaterial({ color: 0x6a5040, roughness: 0.95, metalness: 0.0 });
  const remoteMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.3 });
  const bookMat = new THREE.MeshStandardMaterial({ color: 0x8b3a2a, roughness: 0.7 });

  // 桌面（F5：圆角 box 替代直板）
  const top = new THREE.Mesh(
    makeRoundedBoxGeometry(1.2, 0.04, 0.6, 0.025, 4),
    woodMat,
  );
  top.position.y = 0.42;
  g.add(top);
  // 桌腿（4 根，F5：上粗下细，金属支架观感）
  for (let x = -1; x <= 1; x += 2) {
    for (let z = -1; z <= 1; z += 2) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.018, 0.4, 12),
        metalMat,
      );
      leg.position.set(x * 0.55, 0.2, z * 0.25);
      g.add(leg);
      // 桌腿顶端圆形封盖
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.028, 0.012, 16),
        metalMat,
      );
      cap.position.set(x * 0.55, 0.4, z * 0.25);
      g.add(cap);
    }
  }
  // 桌垫（中心 0.8×0.4 浅色布）
  const tableMat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.008, 0.4), matMat);
  tableMat.position.set(-0.1, 0.445, 0);
  g.add(tableMat);
  // 遥控器（黑色细长方块 + 几个小按钮）
  const remote = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.16), remoteMat);
  remote.position.set(0.4, 0.45, 0.1);
  g.add(remote);
  for (let i = 0; i < 3; i++) {
    const btn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.005, 0.005, 0.003, 8),
      new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 }),
    );
    btn.position.set(0.4, 0.458, 0.06 + i * 0.025);
    g.add(btn);
  }
  // 书
  const book = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.16), bookMat);
  book.position.set(0.0, 0.455, -0.15);
  g.add(book);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ============================================================
// 扬声器对（E4 微动 API 保持不变）
// ============================================================
function buildSpeakerPair(posL, posR) {
  const g = new THREE.Group();
  const left = makeOneSpeaker(posL);
  const right = makeOneSpeaker(posR);
  g.add(left);
  g.add(right);
  g.userData.wooferRefs = [
    { woofer: left.userData.wooferRefs.woofer, tweeter: left.userData.wooferRefs.tweeter, mid: left.userData.wooferRefs.mid },
    { woofer: right.userData.wooferRefs.woofer, tweeter: right.userData.wooferRefs.tweeter, mid: right.userData.wooferRefs.mid },
  ];
  return g;
}

function makeOneSpeaker(pos) {
  const s = new THREE.Group();
  s.position.copy(pos);

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.5, metalness: 0.0 });
  const coneMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.3 });
  const dustMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.2 });

  // 箱体（F5：圆角 box — 真实音箱前面板都是圆角倒边的）
  const box = new THREE.Mesh(
    makeRoundedBoxGeometry(0.5, 1.0, 0.45, 0.04, 4),
    woodMat,
  );
  box.position.y = 0.5;
  s.add(box);
  // 高音
  const tweeter = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), dustMat);
  tweeter.position.set(0, 0.82, 0.226);
  tweeter.userData.baseZ = 0.226;
  tweeter.userData.kind = 'tweeter';
  s.add(tweeter);
  // 低音 sub-Group
  const wooferGroup = new THREE.Group();
  wooferGroup.position.set(0, 0.45, 0.225);
  wooferGroup.userData.baseZ = 0.225;
  wooferGroup.userData.kind = 'woofer';
  const woofer = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 24), coneMat);
  woofer.rotation.x = Math.PI / 2;
  woofer.position.z = 0;
  wooferGroup.add(woofer);
  const dust = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), dustMat);
  dust.position.set(0, 0, 0.03);
  wooferGroup.add(dust);
  s.add(wooferGroup);
  // 中音
  const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 18), coneMat);
  mid.rotation.x = Math.PI / 2;
  mid.position.set(0, 0.18, 0.223);
  mid.userData.baseZ = 0.223;
  mid.userData.kind = 'mid';
  s.add(mid);

  s.userData.wooferRefs = { woofer: wooferGroup, tweeter, mid };
  s.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return s;
}

// ============================================================
// 吸顶灯
// ============================================================
function buildCeilingLamp(pos) {
  const g = new THREE.Group();
  g.position.copy(pos);

  // F8：吸顶灯暖化（3000K 钨丝感）
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.7 });
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xffe8c0,
    roughness: 0.6,
    metalness: 0.0,
    emissive: 0xffd49a,
    emissiveIntensity: 0.6,
    side: THREE.DoubleSide,
  });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffeac0,
    emissive: 0xffc880,
    emissiveIntensity: 1.8,
  });
  // F10 赛博外环 LED 灯带（冷白偏蓝，模拟"夜灯"待机）
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xc0d8ff,
    emissive: 0x80a0d8,
    emissiveIntensity: 1.4,
  });

  // 吊线
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.4, 8), metalMat);
  wire.position.y = 0.2;
  g.add(wire);
  // 灯罩（半球朝下）
  const shade = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    shadeMat,
  );
  shade.position.y = 0;
  g.add(shade);
  // 灯泡
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), bulbMat);
  bulb.position.y = -0.04;
  g.add(bulb);

  // F10: 赛博外环 LED 灯带（灯罩外圈冷光环，模拟"夜灯/待机"状态）
  //   TorusGeometry（圆环）：紧贴灯罩底部外侧，半径 0.22m（略大于灯罩半径 0.18）
  //   管径 0.012m（细线感）
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.012, 8, 48),
    rimMat,
  );
  rim.rotation.x = Math.PI / 2; // 圆环水平
  rim.position.y = -0.05;       // 灯罩底部略下
  g.add(rim);

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // F11: 暴露吸顶灯灯组 mesh 引用
  g.userData.kind = 'ceilingLamp';
  g.userData.shadeMat = shadeMat;
  g.userData.bulbMat = bulbMat;
  g.userData.rimMat = rimMat;
  return g;
}
// ============================================================
function buildRug(pos) {
  // F14-D: 地毯升级 256→1024, 编织纹更细密
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const ctx = c.getContext('2d');
  // 底色（暖米驼）
  ctx.fillStyle = '#9a7050';
  ctx.fillRect(0, 0, 1024, 1024);
  // 横向条纹(更细密, 4 倍密度)
  for (let y = 0; y < 1024; y += 8) {
    ctx.fillStyle = y % 16 === 0 ? '#7a5238' : '#8a6244';
    ctx.fillRect(0, y, 1024, 4);
  }
  // 边框（深木色, 32px 宽）
  ctx.strokeStyle = '#4a2e1a';
  ctx.lineWidth = 24;
  ctx.strokeRect(12, 12, 1000, 1000);
  // 边框内细线
  ctx.strokeStyle = '#5a3a22';
  ctx.lineWidth = 4;
  ctx.strokeRect(48, 48, 928, 928);
  // 中心装饰菱形
  ctx.save();
  ctx.translate(512, 512);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = 'rgba(120, 80, 50, 0.4)';
  ctx.fillRect(-80, -80, 160, 160);
  ctx.strokeStyle = '#3a1e0a';
  ctx.lineWidth = 3;
  ctx.strokeRect(-80, -80, 160, 160);
  ctx.restore();
  // 细密织物纹（10000 个点,4 倍密度）
  for (let i = 0; i < 10000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.10})`;
    ctx.fillRect(Math.random() * 1024, Math.random() * 1024, 1, 1);
  }
  // 微高光点（模拟绒毛）
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = `rgba(255,235,210,${Math.random() * 0.10})`;
    ctx.fillRect(Math.random() * 1024, Math.random() * 1024, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0.0 });
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), mat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.copy(pos);
  rug.receiveShadow = true;
  return rug;
}

// ============================================================
// 接触阴影（家具下方的圆形暗影，独立 plane）
// ============================================================
function buildContactShadow(pos, w, h) {
  // 简单径向渐变贴图的 plane，叠在地毯/地板上
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.65)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    opacity: 0.85,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.copy(pos);
  return plane;
}

// ============================================================
// 角落绿植（盆栽）
// ============================================================
function buildPlant(pos) {
  const g = new THREE.Group();
  g.position.copy(pos);

  // 陶土花盆
  const potMat = new THREE.MeshStandardMaterial({ color: 0x8a4a2a, roughness: 0.85, metalness: 0.0 });
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.32, 16), potMat);
  pot.position.y = 0.16;
  g.add(pot);
  // 土壤
  const soil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.02, 16),
    new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.95 }),
  );
  soil.position.y = 0.32;
  g.add(soil);
  // 叶片（6 片椭圆 plane，随机倾斜）
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x2a5a32, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide,
  });
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6, 0, Math.PI), leafMat);
    leaf.scale.set(1, 1.5, 0.3);
    const angle = (i / 7) * Math.PI * 2;
    leaf.position.set(Math.cos(angle) * 0.08, 0.45 + Math.random() * 0.2, Math.sin(angle) * 0.08);
    leaf.rotation.set(
      (Math.random() - 0.5) * 0.5,
      angle,
      (Math.random() - 0.5) * 0.5,
    );
    g.add(leaf);
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
