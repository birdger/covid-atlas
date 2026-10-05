// js/lib/color.js —— 色带与色标（纯函数）
// 地图分级着色 / 折线配色都从这里取，换主题只换 ramp，不改调用方。

/** #rrggbb → [r,g,b] */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** [r,g,b] → #rrggbb */
export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/** 在两色之间线性插值，t∈[0,1] */
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k]);
}

/** 多段色带取色：ramp 为色值数组，t∈[0,1] 均分到各段 */
export function rampAt(ramp, t) {
  if (!ramp.length) return '#000000';
  if (ramp.length === 1) return ramp[0];
  const k = Math.max(0, Math.min(1, t));
  const seg = Math.min(ramp.length - 2, Math.floor(k * (ramp.length - 1)));
  const local = k * (ramp.length - 1) - seg;
  return mix(ramp[seg], ramp[seg + 1], local);
}

/** 两套主题色带：暖色编辑风（默认）与夜色 */
export const RAMPS = {
  warm: ['#f2e6d6', '#efd7bd', '#e6bb94', '#d6936a', '#bd6a41', '#93472a', '#6b2f19'],
  night: ['#241f1c', '#40302a', '#6b4630', '#9d6535', '#cf8f47', '#f0c07a', '#ffe6b8'],
};

/** 折线用的分类色（暖色编辑风，够 12 条序列区分） */
export const SERIES_COLORS = [
  '#b5522f', '#2f6f6b', '#7a4a8c', '#a8721c', '#3c6e3a', '#8c3a52',
  '#2b5d8a', '#8a6a2b', '#5c4b8a', '#a34a1f', '#467a6a', '#7a3a3a',
];

/** 造一个色标：值 → 颜色。log=true 时用对数刻度（跨数量级数据的正确姿势） */
export function makeColorScale({ ramp = RAMPS.warm, min = 0, max = 1, log = false } = {}) {
  const lo = log ? Math.log10(Math.max(1, min)) : min;
  const hi = log ? Math.log10(Math.max(10, max)) : max;
  const span = Math.max(1e-9, hi - lo);
  return (v) => {
    if (!Number.isFinite(v) || v <= 0) return null;           // 无数据 → 交给调用方画底色
    const t = ((log ? Math.log10(Math.max(1, v)) : v) - lo) / span;
    return rampAt(ramp, t);
  };
}

/** 图例刻度：对数取每 10 倍一档，线性取等分 */
export function legendTicks(min, max, log = false, n = 5) {
  if (log) {
    const lo = Math.floor(Math.log10(Math.max(1, min)));
    const hi = Math.ceil(Math.log10(Math.max(10, max)));
    const out = [];
    for (let e = lo; e <= hi; e++) out.push(Math.pow(10, e));
    return out;
  }
  const out = [];
  for (let i = 0; i <= n; i++) out.push(min + ((max - min) * i) / n);
  return out;
}
