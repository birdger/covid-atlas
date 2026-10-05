// js/main.js —— 接线层：输入（按钮/滑杆/键盘/鼠标）→ 数据集 → 渲染
// 地图与折线只吃纯数据，页面逻辑全在这里；游戏规则/统计口径不写进本文件（在 lib/dataset.js）。
import {
  METRICS, METRIC_LIST, buildDataset, valueAt, seriesFor, worldValueAt,
  statsAt, rankAt, formatNumber, formatInt, formatDate,
} from './lib/dataset.js';
import { decodeGeometry } from './lib/topojson.js';
import { RAMPS, SERIES_COLORS, makeColorScale, legendTicks } from './lib/color.js';
import { createMapRenderer } from './render/map.js';
import { createChartRenderer } from './render/chart.js';

const $ = (id) => document.getElementById(id);

// 默认对比：美 / 中 / 印 / 巴西 / 法国
const DEFAULT_SELECTED = ['840', '156', '356', '076', '250'];

const state = {
  metric: 'cases',
  index: 0,
  log: true,
  theme: 'warm',
  selected: new Set(DEFAULT_SELECTED),
  playing: false,
  speed: 220,
  hoverIso: null,
};
const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + e.reason));

let ds = null;
let geoCount = 0;
let draws = 0;
let rankMap = new Map();

const map = createMapRenderer($('map'));
const chart = createChartRenderer($('chart'));

const rampFor = (t) => (t === 'night' ? RAMPS.night : RAMPS.warm);
const clampIdx = (i) => Math.max(0, Math.min((ds ? ds.n : 1) - 1, i));
const dynWrap = (i) => (ds ? (i + ds.n) % ds.n : 0);

// ———————————————————————— 主题 ————————————————————————
function applyTheme(t, persist = true) {
  state.theme = t === 'night' ? 'night' : 'warm';
  document.documentElement.dataset.theme = state.theme;
  const btn = $('btn-theme');
  btn.textContent = state.theme === 'night' ? '日间' : '夜色';
  btn.setAttribute('aria-pressed', String(state.theme === 'night'));
  if (persist) { try { localStorage.setItem('atlas.theme', state.theme); } catch { /* 隐私模式忽略 */ } }
}

// ———————————————————————— 取值 ————————————————————————
function valueOfIso(iso) {
  const c = ds.byIso.get(iso);
  if (!c) return null;
  const v = valueAt(state.metric, c, state.index);
  return v > 0 ? v : null;          // 0 与「无数据」在地图上同样留白
}

function selectedList() {
  const out = [];
  for (const iso of state.selected) { const c = ds.byIso.get(iso); if (c) out.push(c); }
  return out;
}

// ———————————————————————— 渲染 ————————————————————————
function renderAll() {
  if (!ds) return;
  draws++;
  updateMap();
  updateChart();
  updateRank();
  updateClock();
  updateScaleButton();
}

function updateMap() {
  const st = statsAt(ds, state.metric, state.index);
  const ramp = rampFor(state.theme);
  map.draw({
    scale: makeColorScale({ ramp, min: st.min, max: st.max, log: state.log }),
    valueOf: valueOfIso,
    hoverIso: state.hoverIso,
    selected: state.selected,
    ramp,
    domain: [st.min, st.max],
    log: state.log,
    ticks: legendTicks(st.min, st.max, state.log),
  });
}

function updateChart() {
  const list = selectedList();
  const series = list.map((c, k) => ({
    label: c.label,
    color: SERIES_COLORS[k % SERIES_COLORS.length],
    values: seriesFor(ds, state.metric, c),
  }));
  chart.draw({
    dates: ds.dates,
    series,
    index: state.index,
    log: state.log,
    unit: METRICS[state.metric].unit,
    fmt: (v) => formatNumber(v, 1),
  });
  const m = METRICS[state.metric];
  $('chart-title').textContent = `${m.label} · 对比`;
  $('chart-sub').textContent = list.length
    ? `${list.length} 国 · ${state.log ? '对数' : '线性'}刻度 · 点图上任意位置可跳到那一周`
    : '从右侧搜索或点地图添加国家';
}

function updateRank() {
  const rows = rankAt(ds, state.metric, state.index, 10);
  rankMap = new Map();
  rankAt(ds, state.metric, state.index, ds.countries.length).forEach((r, k) => rankMap.set(r.country.iso, k + 1));
  const ol = $('rank-list');
  ol.innerHTML = '';
  rows.forEach((r, k) => {
    const li = document.createElement('li');
    li.dataset.on = state.selected.has(r.country.iso) ? '1' : '0';
    li.dataset.iso = r.country.iso;
    li.innerHTML = `<span class="no">${k + 1}</span><span class="name"></span><span class="val"></span>`;
    li.querySelector('.name').textContent = r.country.label;
    li.querySelector('.val').textContent = formatNumber(r.value, 1) + METRICS[state.metric].unit;
    li.addEventListener('click', () => toggleCountry(r.country.iso));
    ol.appendChild(li);
  });
  $('rank-date').textContent = formatDate(ds.dates[state.index]);
}

function updateClock() {
  $('cur-date').textContent = formatDate(ds.dates[state.index], true);
  const w = worldValueAt(ds, state.metric, state.index);
  const m = METRICS[state.metric];
  $('world-total').textContent = `全球合计 ${formatNumber(w, 1)}${m.unit}`;
}

function updateScaleButton() {
  const b = $('btn-scale');
  b.setAttribute('aria-pressed', String(state.log));
  b.textContent = state.log ? '对数刻度' : '线性刻度';
}

function renderChips() {
  const wrap = $('chips');
  wrap.innerHTML = '';
  selectedList().forEach((c, k) => {
    const el = document.createElement('button');
    el.className = 'chip-country';
    el.dataset.iso = c.iso;
    el.title = '点一下移除';
    el.innerHTML = `<i style="background:${SERIES_COLORS[k % SERIES_COLORS.length]}"></i><span></span>`;
    el.querySelector('span').textContent = c.label;
    el.addEventListener('click', () => toggleCountry(c.iso));
    wrap.appendChild(el);
  });
  $('sel-count').textContent = `${state.selected.size} 国`;
}

// ———————————————————————— 状态变更 ————————————————————————
function setIndex(i, { wrap = false } = {}) {
  if (!ds) return;
  state.index = wrap ? dynWrap(i) : clampIdx(i);
  $('slider').value = String(state.index);
  draws++;
  updateMap();
  updateChart();
  updateRank();
  updateClock();
}

function setMetric(m) {
  if (!METRICS[m] || state.metric === m) return;
  state.metric = m;
  state.log = METRICS[m].log;
  for (const b of $('metric-group').children) b.setAttribute('aria-selected', String(b.dataset.metric === m));
  renderAll();
}

function toggleLog() {
  state.log = !state.log;
  renderAll();
}

function toggleCountry(iso) {
  if (!ds.byIso.has(iso)) return;
  if (state.selected.has(iso)) state.selected.delete(iso);
  else if (state.selected.size >= 8) state.selected.delete([...state.selected][0]);  // 最多 8 条，先出最早的
  else state.selected.add(iso);
  renderChips();
  renderAll();
}

function setTheme(t) {
  applyTheme(t);
  renderAll();
}

// ———————————————————————— 播放 ————————————————————————
let lastTs = 0;
function loop(ts) {
  if (!state.playing) return;
  if (!lastTs) lastTs = ts;
  if (ts - lastTs >= state.speed) {
    lastTs = ts;
    setIndex(state.index + 1, { wrap: true });
  }
  requestAnimationFrame(loop);
}

function setPlaying(v) {
  state.playing = !!v;
  const btn = $('play');
  btn.textContent = state.playing ? '❚❚' : '▶';
  btn.setAttribute('aria-pressed', String(state.playing));
  if (state.playing) { lastTs = 0; requestAnimationFrame(loop); }
}

// ———————————————————————— 交互 ————————————————————————
function buildMetricButtons() {
  const wrap = $('metric-group');
  wrap.innerHTML = '';
  METRIC_LIST.forEach((m, k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = m.label;
    b.dataset.metric = m.id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(m.id === state.metric));
    b.title = `快捷键 ${k + 1}`;
    b.addEventListener('click', () => setMetric(m.id));
    wrap.appendChild(b);
  });
}

function showTip(el, html, x, y) {
  el.innerHTML = html;
  el.hidden = false;
  const pad = 12;
  const w = el.offsetWidth, h = el.offsetHeight;
  const box = el.offsetParent ? el.offsetParent.getBoundingClientRect() : el.parentElement.getBoundingClientRect();
  let left = x + pad, top = y - h - pad;
  if (left + w > box.width - 4) left = x - w - pad;
  if (top < 4) top = y + pad;
  el.style.left = Math.max(4, left) + 'px';
  el.style.top = Math.max(4, top) + 'px';
}
const hideTip = (el) => { el.hidden = true; };

function mapTipHtml(c) {
  const v = valueAt(state.metric, c, state.index);
  const world = worldValueAt(ds, state.metric, state.index);
  const share = world > 0 ? ((v / world) * 100).toFixed(1) : '0.0';
  const rank = rankMap.get(c.iso) || '—';
  const m = METRICS[state.metric];
  const cfr = valueAt('cfr', c, state.index);
  const on = state.selected.has(c.iso) ? '（已加入对比，点一下移除）' : '（点一下加入对比）';
  return `<b>${c.label}</b> ${on}<br>${m.label} <b>${formatInt(v)}</b>${m.unit} · 全球第 ${rank}<br>`
    + `占全球 ${share}% · 累计病死率 ${cfr.toFixed(2)}%`;
}

function chartTipHtml(i) {
  const m = METRICS[state.metric];
  const rows = selectedList().slice(0, 8).map((c, k) => {
    const v = valueAt(state.metric, c, i);
    return `<span style="color:${SERIES_COLORS[k % SERIES_COLORS.length]}">●</span> ${c.label} ${formatInt(v)}${m.unit}`;
  });
  return `<b>${formatDate(ds.dates[i], true)}</b><br>${rows.join('<br>')}`;
}

function onMapMove(ev) {
  const r = ev.target.getBoundingClientRect();
  const x = ev.clientX - r.left, y = ev.clientY - r.top;
  const iso = map.hit(x, y);
  if (iso !== state.hoverIso) {
    state.hoverIso = iso;
    draws++;
    updateMap();
  }
  const c = iso ? ds.byIso.get(iso) : null;
  if (c) showTip($('map-tip'), mapTipHtml(c), x, y);
  else hideTip($('map-tip'));
}

function onChartMove(ev) {
  if (!ds) return;
  const r = ev.target.getBoundingClientRect();
  const x = ev.clientX - r.left, y = ev.clientY - r.top;
  const { x0, x1 } = chart.plot;
  const t = (x - x0) / Math.max(1, x1 - x0);
  const i = clampIdx(Math.round(t * (ds.n - 1)));
  if (x < x0 - 8 || x > x1 + 8) { hideTip($('chart-tip')); return; }
  showTip($('chart-tip'), chartTipHtml(i), x, y);
}

function wireEvents() {
  $('slider').addEventListener('input', (e) => { setPlaying(false); setIndex(Number(e.target.value)); });
  $('play').addEventListener('click', () => setPlaying(!state.playing));
  $('speed').addEventListener('change', (e) => { state.speed = Number(e.target.value); lastTs = 0; });
  $('btn-scale').addEventListener('click', toggleLog);
  $('btn-theme').addEventListener('click', () => setTheme(state.theme === 'night' ? 'warm' : 'night'));

  const mp = $('map');
  mp.addEventListener('mousemove', onMapMove);
  mp.addEventListener('mouseleave', () => { state.hoverIso = null; hideTip($('map-tip')); draws++; updateMap(); });
  mp.addEventListener('click', (ev) => {
    const r = mp.getBoundingClientRect();
    const iso = map.hit(ev.clientX - r.left, ev.clientY - r.top);
    if (iso) toggleCountry(iso);
  });

  const cp = $('chart');
  cp.addEventListener('mousemove', onChartMove);
  cp.addEventListener('mouseleave', () => hideTip($('chart-tip')));
  cp.addEventListener('click', (ev) => {
    const r = cp.getBoundingClientRect();
    const { x0, x1 } = chart.plot;
    const t = (ev.clientX - r.left - x0) / Math.max(1, x1 - x0);
    setPlaying(false);
    setIndex(Math.round(t * (ds.n - 1)));
  });

  const search = $('search');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    const box = $('suggest');
    if (!q) { box.hidden = true; box.innerHTML = ''; return; }
    const hits = ds.countries
      .filter((c) => c.label.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .sort((a, b) => valueAt(state.metric, b, state.index) - valueAt(state.metric, a, state.index))
      .slice(0, 8);
    box.innerHTML = '';
    if (!hits.length) { box.hidden = true; return; }
    for (const c of hits) {
      const d = document.createElement('div');
      d.dataset.iso = c.iso;
      d.innerHTML = `<span></span><small></small>`;
      d.querySelector('span').textContent = c.label;
      d.querySelector('small').textContent = `${formatNumber(valueAt(state.metric, c, state.index), 1)}${METRICS[state.metric].unit}`;
      d.addEventListener('click', () => {
        if (!state.selected.has(c.iso)) toggleCountry(c.iso);
        search.value = ''; box.hidden = true;
      });
      box.appendChild(d);
    }
    box.hidden = false;
  });

  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.search-wrap')) $('suggest').hidden = true;
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.target.tagName === 'INPUT' && ev.key !== 'Escape') return;
    const k = ev.key;
    if (k === ' ') { ev.preventDefault(); setPlaying(!state.playing); }
    else if (k === 'ArrowLeft') { ev.preventDefault(); setPlaying(false); setIndex(state.index - 1, { wrap: true }); }
    else if (k === 'ArrowRight') { ev.preventDefault(); setPlaying(false); setIndex(state.index + 1, { wrap: true }); }
    else if (k >= '1' && k <= '5') { setMetric(METRIC_LIST[Number(k) - 1].id); }
    else if (k === 'l' || k === 'L') { toggleLog(); }
    else if (k === 't' || k === 'T') { setTheme(state.theme === 'night' ? 'warm' : 'night'); }
    else if (k === 'Escape') { $('suggest').hidden = true; }
  });
}

function observeResize() {
  let pending = false;
  const doResize = () => {
    pending = false;
    const mp = $('map').parentElement.getBoundingClientRect();
    map.resize(mp.width, mp.height);
    const cp = $('chart').parentElement.getBoundingClientRect();
    chart.resize(cp.width - 24, cp.height - 46);
    renderAll();
  };
  const ro = new ResizeObserver(() => { if (!pending) { pending = true; requestAnimationFrame(doResize); } });
  ro.observe($('map').parentElement);
  ro.observe($('chart').parentElement);
  window.addEventListener('resize', () => { if (!pending) { pending = true; requestAnimationFrame(doResize); } });
  return doResize;
}

// ———————————————————————— 启动 ————————————————————————
async function boot() {
  try { applyTheme(localStorage.getItem('atlas.theme') === 'night' ? 'night' : 'warm', false); } catch { applyTheme('warm', false); }
  const [raw, topo] = await Promise.all([
    fetch('data/covid.json').then((r) => r.json()),
    fetch('data/countries-50m.json').then((r) => r.json()),
  ]);
  ds = buildDataset(raw);
  $('source-line').textContent =
    `约翰斯·霍普金斯大学 CSSE 公开数据 · 周频 ${ds.n} 点 · ${ds.countries.length} 国 · ${ds.dates[0]} → ${ds.dates[ds.n - 1]}`;
  $('slider').max = String(ds.n - 1);
  const geoms = decodeGeometry(topo);
  geoCount = geoms.length;
  map.setGeometry(geoms);
  buildMetricButtons();
  renderChips();
  wireEvents();
  const doResize = observeResize();
  state.index = ds.n - 1;              // 开局停在最新一周
  doResize();

  window.__atlas = {
    ready: true,
    state,
    errors,
    get ds() { return ds; },
    get draws() { return draws; },
    setIndex: (i) => { setPlaying(false); setIndex(i); },
    setMetric,
    setTheme,
    toggleLog,
    play: (v) => setPlaying(v),
    isPlaying: () => state.playing,
    toggleCountry,
    countSelected: () => state.selected.size,
    status: () => ({
      metric: state.metric, index: state.index, date: ds.dates[state.index],
      log: state.log, theme: state.theme, selected: state.selected.size,
      playing: state.playing, draws,
      world: worldValueAt(ds, state.metric, state.index),
      top: rankAt(ds, state.metric, state.index, 3).map((r) => `${r.country.iso}:${Math.round(r.value)}`),
    }),
    hitAt: (x, y) => map.hit(x, y),
    project: (lon, lat) => map.projection.project(lon, lat),
    geoCount,
    rankTop: (n) => rankAt(ds, state.metric, state.index, n)
      .map((r) => ({ iso: r.country.iso, label: r.country.label, value: r.value })),
    select: (iso) => { if (!state.selected.has(iso)) toggleCountry(iso); },
    deselect: (iso) => { if (state.selected.has(iso)) toggleCountry(iso); },
    toggleTheme: () => setTheme(state.theme === 'night' ? 'warm' : 'night'),
    chartPlot: () => chart.plot,
    pixelProbe: () => {
      const probe = (el) => {
        const g = el.getContext('2d');
        const d = g.getImageData(0, 0, el.width, el.height).data;
        const seen = new Set();
        let ink = 0;
        for (let i = 0; i < d.length; i += 4 * 37) {
          seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
          if (d[i + 3] > 0) ink++;
        }
        return { colors: seen.size, samples: ink, size: [el.width, el.height] };
      };
      return { map: probe($('map')), chart: probe($('chart')) };
    },
  };
}

boot().catch((e) => {
  errors.push('boot: ' + (e && e.message ? e.message : String(e)));
  document.body.insertAdjacentHTML('beforeend', `<p style="color:#b5522f">启动失败：${e}</p>`);
});
