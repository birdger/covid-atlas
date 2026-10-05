// js/render/chart.js —— 多序列折线图渲染层（canvas 2D）
// 纵轴支持线性/对数；横轴是日期轴；竖线光标跟着时间轴走。
const css = (el, name, fallback) => {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
};

/** 「好看」的刻度：把区间切成 1/2/5×10^n 的整数档 */
export function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const rough = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** 对数刻度：每 10 倍一档 */
export function logTicks(min, max) {
  const out = [];
  const lo = Math.floor(Math.log10(Math.max(1, min)));
  const hi = Math.ceil(Math.log10(Math.max(10, max)));
  for (let e = lo; e <= hi; e++) out.push(Math.pow(10, e));
  return out;
}

export function createChartRenderer(canvas) {
  const g = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1;
  const PAD = { l: 56, r: 14, t: 14, b: 26 };

  function resize(cssW, cssH) {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = Math.max(1, Math.round(cssW));
    h = Math.max(1, Math.round(cssH));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * @param {{dates:string[], series:Array<{label:string,color:string,values:number[]}>,
   *          index:number, log:boolean, unit:string, fmt:(v:number)=>string}} o
   */
  function draw(o) {
    const ink = css(canvas, '--ink', '#2a241f');
    const muted = css(canvas, '--muted', '#8a7f70');
    const grid = css(canvas, '--grid', '#ddd2c0');
    const cursor = css(canvas, '--accent', '#b5522f');
    const plotW = w - PAD.l - PAD.r;
    const plotH = h - PAD.t - PAD.b;
    g.clearRect(0, 0, w, h);
    if (plotW <= 8 || plotH <= 8) return;

    const all = o.series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
    if (!all.length) return;
    const log = !!o.log;
    const tf = (v) => (log ? Math.log10(Math.max(1, v)) : v);
    let min = Math.min(...all), max = Math.max(...all);
    if (log) { min = Math.max(1, min); max = Math.max(10, max); }
    if (max === min) max = min + 1;
    const tMin = tf(min), tMax = tf(max);
    const yOf = (v) => PAD.t + plotH - ((tf(v) - tMin) / (tMax - tMin)) * plotH;
    const n = o.dates.length;
    const xOf = (i) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * plotW);

    // 网格 + 纵轴刻度
    const ticks = log ? logTicks(min, max) : niceTicks(min, max, 5);
    g.font = '11px ui-sans-serif, system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    for (const v of ticks) {
      if (log && (v < min * 0.9 || v > max * 1.1)) continue;
      const y = yOf(v);
      if (y < PAD.t - 1 || y > h - PAD.b + 1) continue;
      g.strokeStyle = grid;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(PAD.l, Math.round(y) + 0.5);
      g.lineTo(w - PAD.r, Math.round(y) + 0.5);
      g.stroke();
      g.fillStyle = muted;
      g.fillText(o.fmt ? o.fmt(v) : String(v), PAD.l - 8, y);
    }

    // 横轴：按年份打点
    g.textAlign = 'center';
    g.textBaseline = 'top';
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      const y = o.dates[i].slice(0, 4);
      if (y === o.dates[i - 1]?.slice(0, 4)) continue;
      if (seen.has(y)) continue;
      seen.add(y);
      const x = xOf(i);
      if (x < PAD.l + 12 || x > w - PAD.r - 12) continue;
      g.strokeStyle = grid;
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, PAD.t);
      g.lineTo(Math.round(x) + 0.5, h - PAD.b);
      g.stroke();
      g.fillStyle = muted;
      g.fillText(y, x, h - PAD.b + 6);
    }

    // 折线
    g.lineJoin = 'round';
    for (const s of o.series) {
      g.strokeStyle = s.color;
      g.lineWidth = 2;
      g.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        const v = s.values[i];
        if (!Number.isFinite(v)) { started = false; continue; }
        const x = xOf(i), y = yOf(Math.max(log ? 1 : -Infinity, v));
        if (started) g.lineTo(x, y); else { g.moveTo(x, y); started = true; }
      }
      g.stroke();
    }

    // 时间轴光标 + 当前值圆点
    if (o.index >= 0 && o.index < n) {
      const x = xOf(o.index);
      g.strokeStyle = cursor;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, PAD.t);
      g.lineTo(Math.round(x) + 0.5, h - PAD.b);
      g.stroke();
      for (const s of o.series) {
        const v = s.values[o.index];
        if (!Number.isFinite(v)) continue;
        g.fillStyle = s.color;
        g.beginPath();
        g.arc(x, yOf(Math.max(log ? 1 : -Infinity, v)), 3.2, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = css(canvas, '--paper', '#f4efe4');
        g.lineWidth = 1.5;
        g.stroke();
      }
    }

    // 纵轴单位
    g.fillStyle = muted;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText(o.unit ? `单位：${o.unit}${log ? '（对数刻度）' : ''}` : '', PAD.l - 46, 0);
  }

  /** 鼠标 x → 最近的数据点下标（主程序用 chart.plot 自行换算，这里留着方便调试） */
  function indexAt(px, n) {
    const plotW = w - PAD.l - PAD.r;
    if (plotW <= 0 || !n) return -1;
    return Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / plotW) * (n - 1))));
  }

  return {
    resize, draw, indexAt,
    n: 0,
    get pad() { return PAD; },
    get width() { return w; },
    get height() { return h; },
    get plot() { return { x0: PAD.l, y0: PAD.t, x1: w - PAD.r, y1: h - PAD.b }; },
  };
}
