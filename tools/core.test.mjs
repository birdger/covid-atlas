// tools/core.test.mjs —— 纯函数层单测（零依赖，自带极简断言器）
// 运行： node tools/core.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { decodeArcs, ringCoords, decodeGeometry, boundsOf, ringArea, ringCentroid } from '../js/lib/topojson.js';
import { makeProjection, projectGeometry, pointInRing, pointInPolygon, hitTest } from '../js/lib/projection.js';
import {
  METRICS, METRIC_LIST, buildDataset, valueAt, seriesFor, worldValueAt,
  statsAt, rankAt, growthAt, formatNumber, formatInt, formatDate,
} from '../js/lib/dataset.js';
import { hexToRgb, rgbToHex, mix, rampAt, RAMPS, SERIES_COLORS, makeColorScale, legendTicks } from '../js/lib/color.js';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0; const fails = [];
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fails.push(`${name} → ${e.message}`); }
}
function ok(v, msg) { if (!v) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) { if (!Object.is(a, b)) throw new Error(`${msg || ''} 期望 ${b}，实得 ${a}`); }
function near(a, b, tol = 1e-6, msg) { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg || ''} 期望≈${b}，实得 ${a}`); }
function setEq(a, b, msg) { eq(JSON.stringify(a), JSON.stringify(b), msg); }
function throws(fn, msg) { try { fn(); } catch { return; } throw new Error(msg || '应当抛错但没有'); }

// ———————————————————————— TopoJSON 解码 ————————————————————————
t('decodeArcs 反量化：增量 × scale + translate', () => {
  const topo = { transform: { scale: [0.5, 0.25], translate: [100, 50] }, arcs: [[[0, 0], [2, 4], [-1, 2]]] };
  const [arc] = decodeArcs(topo);
  setEq(arc[0], [100, 50], '起点');
  setEq(arc[1], [101, 51], '第二点');
  setEq(arc[2], [100.5, 51.5], '第三点');
});

t('decodeArcs 无 transform 时直接累加整数', () => {
  const [arc] = decodeArcs({ arcs: [[[1, 2], [3, -1]]] });
  setEq(arc, [[1, 2], [4, 1]]);
});

const ARCS = [[[0, 0], [0, 10]], [[0, 10], [10, 0]], [[10, 0], [0, -10]]];
t('ringCoords 负索引 = 反向引用第 ~i 条弧', () => {
  const r = ringCoords([~2], ARCS);
  setEq(r, [[0, -10], [10, 0]], '反向弧');
});

t('ringCoords 拼接时去掉相邻弧的重复端点', () => {
  const r = ringCoords([0, 1], ARCS);
  eq(r.length, 3, '3 个点');
  setEq(r[1], [0, 10], '中间端点只出现一次');
});

t('decodeGeometry 支持 Polygon 与 MultiPolygon', () => {
  const topo = {
    arcs: [[[0, 0], [0, 10], [10, 0], [0, -10], [0, 0]]],
    objects: {
      countries: {
        type: 'GeometryCollection',
        geometries: [
          { type: 'Polygon', id: '1', properties: { name: 'A' }, arcs: [[0]] },
          { type: 'MultiPolygon', id: '2', properties: { name: 'B' }, arcs: [[[0]], [[0]]] },
        ],
      },
    },
  };
  const [a, b] = decodeGeometry(topo);
  eq(a.polygons.length, 1, 'Polygon 一个多边形');
  eq(b.polygons.length, 2, 'MultiPolygon 两个多边形');
  eq(a.name, 'A');
  eq(b.id, '2');
});

t('decodeGeometry 遇到不存在的 objects 键要抛错', () => {
  throws(() => decodeGeometry({ arcs: [], objects: {} }, 'nope'), '缺对象应抛错');
});

t('boundsOf 求出经纬度包围盒', () => {
  const geoms = [{ id: '1', name: '', polygons: [[[[1, 2], [5, 2], [5, 8], [1, 8], [1, 2]]]] }];
  setEq(boundsOf(geoms), [1, 2, 5, 8]);
});

t('ringArea 逆时针为正、顺时针为负', () => {
  const ccw = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  ok(ringArea(ccw) > 0, '逆时针应为正');
  ok(ringArea(ccw.slice().reverse()) < 0, '顺时针应为负');
});

t('ringCentroid 取环的平均经纬度', () => {
  setEq(ringCentroid([[0, 0], [2, 0], [2, 2], [0, 2]]), [1, 1]);
});

// ———————————————————————— 投影与命中 ————————————————————————
const WORLD = [-180, -56, 180, 84];
t('makeProjection：整幅世界图落在画布内', () => {
  const p = makeProjection({ bbox: WORLD, width: 800, height: 420 });
  for (const [lon, lat] of [[-180, -56], [180, 84], [0, 0], [-180, 84], [180, -56]]) {
    const [x, y] = p.project(lon, lat);
    ok(x >= -0.001 && x <= 800.001, `x 越界 ${x}`);
    ok(y >= -0.001 && y <= 420.001, `y 越界 ${y}`);
  }
});

t('makeProjection：经度越大 x 越大', () => {
  const p = makeProjection({ bbox: WORLD, width: 800, height: 420 });
  ok(p.project(-170, 0)[0] < p.project(0, 0)[0], '西 → 东应递增');
  ok(p.project(0, 0)[0] < p.project(170, 0)[0]);
});

t('makeProjection：纬度越高 y 越小（屏幕上方）', () => {
  const p = makeProjection({ bbox: WORLD, width: 800, height: 420 });
  ok(p.project(0, 70)[1] < p.project(0, 10)[1], '北在上');
});

t('makeProjection：clipLat 把极地截断到边界内', () => {
  const p = makeProjection({ bbox: WORLD, width: 800, height: 420, clipLat: [-56, 84] });
  const south = p.project(0, -89)[1];
  const north = p.project(0, 89)[1];
  near(south, p.project(0, -56)[1], 1e-9, '南极被截断');
  near(north, p.project(0, 84)[1], 1e-9, '北极被截断');
});

t('makeProjection：padding 让内容缩进', () => {
  const a = makeProjection({ bbox: WORLD, width: 800, height: 420 });
  const b = makeProjection({ bbox: WORLD, width: 800, height: 420, padding: 20 });
  ok(b.scale < a.scale, '留边后缩放比更小');
});

t('makeProjection：unproject 与 project 往返一致', () => {
  const p = makeProjection({ bbox: WORLD, width: 1000, height: 500 });
  for (const lon of [-150, -30, 0, 45, 150]) for (const lat of [-40, 0, 30, 70]) {
    const [x, y] = p.project(lon, lat);
    const [lo, la] = p.unproject(x, y);
    near(lo, lon, 1e-6, '经度往返');
    near(la, lat, 1e-6, '纬度往返');
  }
});

t('等距圆柱与墨卡托投影结果不同', () => {
  const eq2 = makeProjection({ bbox: WORLD, width: 800, height: 420, mode: 'equirect' });
  const me = makeProjection({ bbox: WORLD, width: 800, height: 420, mode: 'mercator' });
  const dy1 = Math.abs(eq2.project(0, 80)[1] - eq2.project(0, 0)[1]);
  const dy2 = Math.abs(me.project(0, 80)[1] - me.project(0, 0)[1]);
  ok(Math.abs(dy1 - dy2) > 1, '两种投影在高纬应有差异');
});

t('pointInRing 判断内外', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  ok(pointInRing([5, 5], square), '内部');
  ok(!pointInRing([15, 5], square), '外部');
});

t('pointInPolygon 把洞当作外部', () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  ok(pointInPolygon([1, 1], [outer, hole]), '环产地带算在内');
  ok(!pointInPolygon([5, 5], [outer, hole]), '洞里的点算在外');
});

t('hitTest 命中多边形并返回其 id', () => {
  const a = { id: '1', name: 'A', polygons: [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]] };
  const b = { id: '2', name: 'B', polygons: [[[[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]]] };
  eq(hitTest([5, 5], [a, b]), '1');
  eq(hitTest([25, 5], [a, b]), '2');
  eq(hitTest([15, 5], [a, b]), null, '空白处返回 null');
});

t('projectGeometry 把经纬度环转成像素环', () => {
  const geoms = [{ id: '1', name: 'A', polygons: [[[[0, 0], [10, 0], [10, 10], [0, 0]]]] }];
  const p = makeProjection({ bbox: [-20, -20, 20, 20], width: 400, height: 400 });
  const out = projectGeometry(geoms, p);
  eq(out[0].id, '1');
  eq(out[0].polygons[0][0].length, 4);
  ok(out[0].polygons[0][0][0][0] >= 0 && out[0].polygons[0][0][0][0] <= 400, 'x 在画布内');
});

// ———————————————————————— 数据集 ————————————————————————
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'covid.json'), 'utf8'));
const ds = buildDataset(raw);
const US = ds.byIso.get('840');
const LAST = ds.n - 1;

t('METRICS 定义五个指标且 id 自洽', () => {
  eq(METRIC_LIST.length, 5);
  for (const [k, m] of Object.entries(METRICS)) eq(m.id, k, `${k}.id`);
});

t('buildDataset 建立索引并补上 label', () => {
  ok(ds.countries.length >= 190, `国家数 ${ds.countries.length}`);
  ok(ds.byIso instanceof Map);
  eq(US.label, '美国');
  eq(ds.dates.length, ds.n);
});

t('valueAt：累计确诊/死亡取原值', () => {
  eq(valueAt('cases', US, LAST), US.c[LAST]);
  eq(valueAt('deaths', US, LAST), US.d[LAST]);
});

t('valueAt：newCases 首周等于首个累计值，其后为相邻差', () => {
  const c = { c: [10, 25, 40], d: [1, 2, 3] };
  eq(valueAt('newCases', c, 0), 10);
  eq(valueAt('newCases', c, 1), 15);
  eq(valueAt('newCases', c, 2), 15);
});

t('valueAt：数据回填导致的负增量被夹到 0', () => {
  eq(valueAt('newCases', { c: [100, 90], d: [1, 1] }, 1), 0);
  eq(valueAt('newDeaths', { c: [1, 1], d: [9, 4] }, 1), 0);
});

t('valueAt：cfr 是百分比', () => {
  near(valueAt('cfr', { c: [1000, 2000], d: [50, 100] }, 1), 5, 1e-9);
  eq(valueAt('cfr', { c: [0], d: [0] }, 0), 0, '零确诊不除零');
});

t('valueAt：越界返回 0，未知指标抛错', () => {
  eq(valueAt('cases', US, -1), 0);
  eq(valueAt('cases', US, 9999), 0);
  throws(() => valueAt('nope', US, 0));
});

t('seriesFor 长度与日期轴一致', () => {
  const s = seriesFor(ds, 'newCases', US);
  eq(s.length, ds.dates.length);
  ok(s.every((v) => v >= 0), '新增非负');
});

t('statsAt：upper 分位截断掉极端值', () => {
  const st = statsAt(ds, 'cases', LAST, 0.98);
  ok(st.max < st.trueMax, `截断值 ${st.max} 应小于真实最大 ${st.trueMax}`);
  ok(st.min > 0, '最小值来自有数据的国家');
});

t('statsAt：空数据兜底不抛错', () => {
  const empty = buildDataset({ dates: ['2020-01-22'], countries: [{ name: 'X', iso: '1', c: [0], d: [0] }] });
  const st = statsAt(empty, 'cases', 0);
  eq(st.count, 0);
  ok(st.max > 0, '兜底上限为正，避免除零');
});

t('rankAt 按降序取前 n 名', () => {
  const r = rankAt(ds, 'cases', LAST, 5);
  eq(r.length, 5);
  for (let i = 1; i < r.length; i++) ok(r[i - 1].value >= r[i].value, '降序');
  // 末周累计确诊世界第一为美国（JHU 数据事实）
  eq(r[0].country.iso, '840');
});

t('worldValueAt：病死率按全球死亡/全球确诊加权，不等于各国均值', () => {
  const w = worldValueAt(ds, 'cfr', LAST);
  const naive = ds.countries.reduce((a, c) => a + valueAt('cfr', c, LAST), 0) / ds.countries.length;
  ok(w > 0 && w < 10, `全球病死率 ${w}`);
  ok(Math.abs(w - naive) > 0.1, `加权 ${w} 与均值 ${naive} 应显著不同`);
});

t('worldValueAt：计数类指标求和且随时间单调不减', () => {
  const a = worldValueAt(ds, 'cases', 10);
  const b = worldValueAt(ds, 'cases', LAST);
  ok(b > a, '累计确诊全球总数增长');
});

t('growthAt 计算相对增幅，前值为 0 时返回 Infinity', () => {
  const c = { c: [0, 0, 50] };
  eq(growthAt(ds, 'cases', c, 2, 2), Infinity);
  const d = { c: [100, 100, 150] };
  near(growthAt(ds, 'cases', d, 2, 2), 50, 1e-9);
});

t('formatNumber 用中文量纲', () => {
  eq(formatNumber(999), '999');
  eq(formatNumber(12345), '1.2万');
  eq(formatNumber(345678901), '3.5亿');
  eq(formatNumber(NaN), '—');
});

t('formatInt 千分位、formatDate 中文日期', () => {
  eq(formatInt(1234567), '1,234,567');
  eq(formatDate('2020-03-05'), '3月5日');
  eq(formatDate('2020-03-05', true), '2020年3月5日');
});

// ———————————————————————— 色带 ————————————————————————
t('hexToRgb 支持 3 位与 6 位写法', () => {
  setEq(hexToRgb('#fff'), [255, 255, 255]);
  setEq(hexToRgb('#b5522f'), [181, 82, 47]);
});

t('rgbToHex 与 hexToRgb 往返一致', () => {
  for (const hex of ['#000000', '#b5522f', '#0a7f3c']) eq(rgbToHex(hexToRgb(hex)), hex);
});

t('mix 端点与中点', () => {
  eq(mix('#000000', '#ffffff', 0), '#000000');
  eq(mix('#000000', '#ffffff', 1), '#ffffff');
  eq(mix('#000000', '#ffffff', 0.5), '#808080');
});

t('rampAt 首尾取端点色，中段取过渡色', () => {
  const ramp = ['#000000', '#ffffff'];
  eq(rampAt(ramp, 0), '#000000');
  eq(rampAt(ramp, 1), '#ffffff');
  eq(rampAt(ramp, 0.5), '#808080');
  eq(rampAt(['#123456'], 0.7), '#123456', '单色色带');
});

t('两套主题色带与折线配色齐全', () => {
  ok(RAMPS.warm.length >= 5 && RAMPS.night.length >= 5);
  eq(RAMPS.warm.length, RAMPS.night.length, '两套色带档数一致');
  ok(SERIES_COLORS.length >= 12, '折线配色够 12 条序列');
  ok(SERIES_COLORS.every((c) => /^#[0-9a-f]{6}$/i.test(c)), '色值格式统一');
});

t('makeColorScale：无数据返回 null，正常值落在色带上', () => {
  const s = makeColorScale({ ramp: RAMPS.warm, min: 1, max: 1000, log: true });
  eq(s(0), null);
  eq(s(NaN), null);
  ok(/^#[0-9a-f]{6}$/.test(s(1000)), '有数据返回色值');
});

t('makeColorScale：对数刻度下低值也能拉开差异', () => {
  const lin = makeColorScale({ ramp: ['#000000', '#ffffff'], min: 0, max: 1000000, log: false });
  const log = makeColorScale({ ramp: ['#000000', '#ffffff'], min: 1, max: 1000000, log: true });
  near(hexToRgb(lin(1000))[0], 0, 1, '线性下 1000 几乎全黑');
  ok(hexToRgb(log(1000))[0] > 80, `对数下 1000 应有明显亮度，实得 ${hexToRgb(log(1000))[0]}`);
});

t('legendTicks 对数刻度给出 10 的幂', () => {
  setEq(legendTicks(1, 10000, true), [1, 10, 100, 1000, 10000]);
  eq(legendTicks(0, 100, false, 4).length, 5);
});

// ———————————————————————— 真实数据完整性 ————————————————————————
t('真实数据：日期轴覆盖 2020-01-22 → 2023-03-09，周频 165 点', () => {
  eq(ds.dates[0], '2020-01-22');
  eq(ds.dates[LAST], '2023-03-09');
  eq(ds.n, 165);
});

t('真实数据：每国序列长度与日期轴一致', () => {
  for (const c of ds.countries) {
    eq(c.c.length, ds.n, `${c.name} 确诊序列长度`);
    eq(c.d.length, ds.n, `${c.name} 死亡序列长度`);
  }
});

t('真实数据：累计确诊基本单调不减（回填修正点 ≤1%）', () => {
  let bad = 0, total = 0;
  for (const c of ds.countries) {
    for (let i = 1; i < ds.n; i++) { total++; if (c.c[i] < c.c[i - 1]) bad++; }
  }
  ok(bad / total <= 0.01, `回退点占比 ${(bad / total * 100).toFixed(2)}% 超过 1%`);
});

t('真实数据：末周累计确诊前五名是美/中/印/法/德这一量级', () => {
  const top = rankAt(ds, 'cases', LAST, 5).map((r) => r.country.iso);
  eq(top[0], '840');
  ok(top.includes('156') || top.includes('356'), '中国或印度应在其中');
  for (const r of rankAt(ds, 'cases', LAST, 5)) ok(r.value > 3e7, `${r.country.name} ${r.value} 量级异常`);
});

t('真实数据：国家中文名覆盖过半且 iso 唯一', () => {
  const zh = ds.countries.filter((c) => c.zh).length;
  ok(zh / ds.countries.length > 0.5, `中文名覆盖 ${zh}/${ds.countries.length}`);
  const isos = new Set(ds.countries.map((c) => c.iso));
  eq(isos.size, ds.countries.length, 'iso 不重复');
});

t('真实数据：源信息被完整记录（可追溯）', () => {
  ok(/Johns Hopkins/.test(ds.source.dataset), '数据集名');
  ok(/CSSEGISandData/.test(ds.source.url), '数据地址');
  ok(/Natural Earth/.test(ds.source.boundary), '底图来源');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(ds.source.retrieved), '抓取日期');
});

t('真实国界：50m 底图可解码且经纬度合理', () => {
  const topo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'countries-50m.json'), 'utf8'));
  const geoms = decodeGeometry(topo);
  ok(geoms.length >= 200, `几何数 ${geoms.length}`);
  const [minLon, minLat, maxLon, maxLat] = boundsOf(geoms);
  ok(minLon >= -180.001 && maxLon <= 180.001, '经度范围');
  ok(minLat >= -90.001 && maxLat <= 90.001, '纬度范围');
  const covered = new Set(geoms.map((g) => g.id));
  const missing = ds.countries.filter((c) => !covered.has(c.iso));
  eq(missing.length, 0, `有数据但底图缺多边形：${missing.map((c) => c.name).join(',')}`);
});

t('真实国界：命中测试能认出中国与美国', () => {
  const topo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'countries-50m.json'), 'utf8'));
  const p = makeProjection({ bbox: WORLD, width: 1200, height: 630 });
  const projected = projectGeometry(decodeGeometry(topo), p);
  eq(hitTest(p.project(105, 35), projected), '156', '成都附近应命中中国');
  eq(hitTest(p.project(-100, 40), projected), '840', '堪萨斯附近应命中美国');
});

// ———————————————————————— 汇总 ————————————————————————
const total = pass + fails.length;
console.log(`\n逻辑单测：${pass}/${total} 全绿`);
if (fails.length) {
  console.log('失败明细：');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
