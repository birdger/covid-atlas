// js/lib/dataset.js —— 数据集层（纯函数）：指标定义、取值、排名、量纲格式化
// 输入 data/covid.json 的原始对象；不碰 DOM，可直接在 node 里单测。

/** 五种可切换指标。log: 地图/折线默认是否用对数刻度（累计量跨 6 个数量级） */
export const METRICS = {
  cases: { id: 'cases', label: '累计确诊', short: '确诊', unit: '例', log: true },
  deaths: { id: 'deaths', label: '累计死亡', short: '死亡', unit: '例', log: true },
  newCases: { id: 'newCases', label: '每周新增确诊', short: '周增', unit: '例', log: false },
  newDeaths: { id: 'newDeaths', label: '每周新增死亡', short: '周增亡', unit: '例', log: false },
  cfr: { id: 'cfr', label: '病死率', short: '病死率', unit: '%', log: false },
};
export const METRIC_LIST = Object.values(METRICS);

/** 把原始 JSON 包成带索引的数据集对象 */
export function buildDataset(raw) {
  const countries = (raw.countries || []).map((c) => ({ ...c, label: c.zh || c.name }));
  const byIso = new Map();
  for (const c of countries) byIso.set(c.iso, c);
  return { dates: raw.dates.slice(), countries, byIso, source: raw.source || {}, n: raw.dates.length };
}

/** 某指标在某国第 i 周的值。newX 为相邻两周差值，cfr 为病死率百分比 */
export function valueAt(metric, country, i) {
  if (i < 0 || i >= country.c.length) return 0;
  switch (metric) {
    case 'cases': return country.c[i];
    case 'deaths': return country.d[i];
    case 'newCases': return i === 0 ? country.c[0] : Math.max(0, country.c[i] - country.c[i - 1]);
    case 'newDeaths': return i === 0 ? country.d[0] : Math.max(0, country.d[i] - country.d[i - 1]);
    case 'cfr': return country.c[i] > 0 ? (country.d[i] / country.c[i]) * 100 : 0;
    default: throw new Error(`未知指标 ${metric}`);
  }
}

/** 某国整条序列 */
export function seriesFor(ds, metric, country) {
  return ds.dates.map((_, i) => valueAt(metric, country, i));
}

/** 全球合计：计数类直接求和；病死率用「全球死亡 / 全球确诊」加权，不能平均 */
export function worldValueAt(ds, metric, i) {
  if (metric === 'cfr') {
    let cc = 0, dd = 0;
    for (const c of ds.countries) { cc += c.c[i] || 0; dd += c.d[i] || 0; }
    return cc > 0 ? (dd / cc) * 100 : 0;
  }
  let v = 0;
  for (const c of ds.countries) v += valueAt(metric, c, i);
  return v;
}

/** 排序后的取值域。upper 用分位数截断（默认 98%），避免个别极端值把整幅地图压黑 */
export function statsAt(ds, metric, i, upper = 0.98) {
  const vals = [];
  for (const c of ds.countries) {
    const v = valueAt(metric, c, i);
    if (v > 0) vals.push(v);
  }
  if (!vals.length) return { min: 0, max: 1, p: 0, count: 0 };
  vals.sort((a, b) => a - b);
  const min = vals[0];
  const p = vals[Math.min(vals.length - 1, Math.floor(vals.length * upper))];
  return { min, max: p, p, count: vals.length, trueMax: vals[vals.length - 1] };
}

/** 排行榜：按第 i 周取值降序，取前 n 名 */
export function rankAt(ds, metric, i, n = 10) {
  return ds.countries
    .map((c) => ({ country: c, value: valueAt(metric, c, i) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

/** 增长率（对比第 i 周与前 n 周）：用于「上升最快」提示 */
export function growthAt(ds, metric, country, i, back = 4) {
  const prev = valueAt(metric, country, Math.max(0, i - back));
  const cur = valueAt(metric, country, i);
  if (prev <= 0) return cur > 0 ? Infinity : 0;
  return ((cur - prev) / prev) * 100;
}

/** 中文数字量纲：1.2万 / 3.4亿 */
export function formatNumber(v, digits = 1) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(digits)}亿`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(digits)}万`;
  if (a >= 100) return Math.round(v).toLocaleString('en-US');
  return a >= 10 ? v.toFixed(0) : v.toFixed(digits);
}

/** 千分位整数（用于排行榜/悬停提示） */
export function formatInt(v) {
  if (!Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('en-US');
}

/** ISO 日期 → 中文短日期 2020-03-05 → 3月5日（跨年时带年份） */
export function formatDate(iso, withYear = false) {
  const [y, m, d] = iso.split('-').map(Number);
  return withYear ? `${y}年${m}月${d}日` : `${m}月${d}日`;
}
