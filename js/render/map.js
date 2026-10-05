// js/render/map.js —— 世界地图分级着色渲染层（canvas 2D）
// 只负责画：几何来自 lib/topojson 解码、投影来自 lib/projection、配色来自 lib/color。
// 颜色一律从 CSS 自定义属性读取，换主题只改 CSS，本文件一行不动。
import { makeProjection, projectGeometry, hitTest } from '../lib/projection.js';

const css = (el, name, fallback) => {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
};

export function createMapRenderer(canvas) {
  const g = canvas.getContext('2d');
  let geoms = [], projected = [], proj = null;
  let w = 0, h = 0, dpr = 1;

  /** 按容器尺寸 + 设备像素比重建画布与投影 */
  function resize(cssW, cssH) {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = Math.max(1, Math.round(cssW));
    h = Math.max(1, Math.round(cssH));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (geoms.length) layout();
  }

  function setGeometry(list) {
    geoms = list;
    if (w) layout();
  }

  function layout() {
    proj = makeProjection({ bbox: [-180, -56, 180, 84], width: w, height: h, padding: 14, mode: 'mercator' });
    projected = projectGeometry(geoms, proj);
  }

  const pathOf = (poly) => {
    const p = new Path2D();
    for (const ring of poly) {
      ring.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
      p.closePath();
    }
    return p;
  };

  /**
   * @param {{scale?:Function, valueOf:Function, hoverIso?:string|null, selected?:Set<string>, ramp:string[], domain:number[], log:boolean}} o
   */
  function draw(o) {
    const paper = css(canvas, '--map-ocean', '#eae0d0');
    const nodata = css(canvas, '--map-nodata', '#ded4c4');
    const stroke = css(canvas, '--map-stroke', '#c9bda8');
    const ink = css(canvas, '--ink', '#2a241f');
    const accent = css(canvas, '--accent', '#b5522f');

    g.clearRect(0, 0, w, h);
    g.fillStyle = paper;
    g.fillRect(0, 0, w, h);
    if (!projected.length) return;

    const selected = o.selected || new Set();
    // ① 未命中/无数据层
    g.lineWidth = 0.5;
    g.strokeStyle = stroke;
    for (const geo of projected) {
      for (const poly of geo.polygons) {
        const path = pathOf(poly);
        const v = o.valueOf(geo.id);
        g.fillStyle = v == null ? nodata : (o.scale(v) || nodata);
        g.fill(path);
        g.stroke(path);
      }
    }
    // ② 选中与悬停描边（画在最上层，避免被邻国覆盖）
    g.lineWidth = 2;
    for (const geo of projected) {
      if (!selected.has(geo.id) && geo.id !== o.hoverIso) continue;
      g.strokeStyle = geo.id === o.hoverIso ? accent : ink;
      g.globalAlpha = geo.id === o.hoverIso ? 1 : 0.75;
      for (const poly of geo.polygons) g.stroke(pathOf(poly));
    }
    g.globalAlpha = 1;

    // ③ 图例：横向色带 + 刻度
    const ticks = o.ticks || [];
    if (ticks.length) {
      const lw = Math.min(260, Math.max(160, w * 0.32));
      const x0 = 16, y0 = h - 40, bh = 10;
      const grad = g.createLinearGradient(x0, 0, x0 + lw, 0);
      o.ramp.forEach((c, i) => grad.addColorStop(o.ramp.length === 1 ? 0 : i / (o.ramp.length - 1), c));
      g.fillStyle = grad;
      g.fillRect(x0, y0, lw, bh);
      g.strokeStyle = stroke;
      g.lineWidth = 1;
      g.strokeRect(x0 + 0.5, y0 + 0.5, lw, bh);
      g.fillStyle = ink;
      g.font = '11px ui-sans-serif, system-ui, sans-serif';
      g.textBaseline = 'top';
      const lo = o.log ? Math.log10(Math.max(1, o.domain[0])) : o.domain[0];
      const hi = o.log ? Math.log10(Math.max(10, o.domain[1])) : o.domain[1];
      const span = Math.max(1e-9, hi - lo);
      for (const v of ticks) {
        const t = ((o.log ? Math.log10(Math.max(1, v)) : v) - lo) / span;
        if (t < -0.01 || t > 1.01) continue;
        const x = x0 + t * lw;
        g.fillRect(x - 0.5, y0 + bh, 1, 4);
        const label = v >= 1e8 ? `${v / 1e8}亿` : v >= 1e4 ? `${v / 1e4}万` : String(v);
        g.textAlign = t < 0.05 ? 'left' : t > 0.95 ? 'right' : 'center';
        g.fillText(label, x, y0 + bh + 5);
      }
      g.textAlign = 'left';
      g.fillStyle = css(canvas, '--muted', '#8a7f70');
      g.fillText('无数据', x0, y0 - 14);
    }
  }

  const hit = (x, y) => (projected.length ? hitTest([x, y], projected) : null);

  return { resize, setGeometry, draw, hit, get projection() { return proj; } };
}
