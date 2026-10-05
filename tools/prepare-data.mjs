// tools/prepare-data.mjs
// 数据获取与瘦身：把 JHU 每日原始 CSV 抽样成周频，并与 world-atlas 国界合并。
// 用法： node tools/prepare-data.mjs
// 产出： data/covid.json（周频，按国家聚合）、 data/countries-50m.json（国界 TopoJSON）
// 真实数据来源全部记录在 data/SOURCES.md 与 covid.json 的 source 字段。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const TMP = path.join(ROOT, 'tools', '.cache');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const PROXY = process.env.https_proxy || 'http://127.0.0.1:33210';
const SRC = {
  confirmed: 'https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/time_series_covid19_confirmed_global.csv',
  deaths: 'https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/time_series_covid19_deaths_global.csv',
  atlas: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json',
};

function grab(url, out) {
  execFileSync('curl', ['-sL', '--max-time', '90', '-o', out, url],
    { env: { ...process.env, https_proxy: PROXY, http_proxy: PROXY }, stdio: 'inherit' });
  const n = fs.statSync(out).size;
  if (n < 500) throw new Error(`下载异常 ${url} -> ${n}B`);
  return n;
}

// —— 极简 CSV 解析：处理引号包裹字段（JHU 里有 "Korea, South" 这类值）——
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 && r.some(v => v !== ''));
}

// JHU 表头日期 "1/22/20" -> "2020-01-22"
export function jhuDateToIso(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = 2000 + Number(m[3]);
  return `${y}-${String(Number(m[1])).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

// 按 Country/Region 聚合各省数据（累加）
export function aggregateByCountry(rows) {
  const [header, ...body] = rows;
  const dates = header.slice(4).map(jhuDateToIso);
  const byName = new Map();
  for (const r of body) {
    if (!r || r.length < 5) continue;
    const name = (r[1] || '').trim();
    if (!name) continue;
    const lat = Number(r[2]), lon = Number(r[3]);
    let e = byName.get(name);
    if (!e) { e = { name, lat, lon, vals: new Array(dates.length).fill(0) }; byName.set(name, e); }
    for (let i = 0; i < dates.length; i++) {
      const v = Number(r[4 + i] || 0);
      if (Number.isFinite(v)) e.vals[i] += v;
    }
  }
  return { dates, list: [...byName.values()] };
}

// —— JHU 国名 → world-atlas 国名 的别名表（仅列不同的）——
export const ALIAS = {
  'US': 'United States of America',
  'Korea, South': 'South Korea',
  'Korea, North': 'North Korea',
  'Marshall Islands': 'Marshall Is.',
  'Tuvalu': null,          // Natural Earth 1:50m 未收录图瓦卢，无法上图
  'Burma': 'Myanmar',
  'Congo (Kinshasa)': 'Dem. Rep. Congo',
  'Congo (Brazzaville)': 'Congo',
  "Cote d'Ivoire": "Côte d'Ivoire",
  'West Bank and Gaza': 'Palestine',
  'Western Sahara': 'W. Sahara',
  'Taiwan*': 'Taiwan',
  'Laos': 'Lao PDR',
  'Russia': 'Russia',
  'Iran': 'Iran',
  'Syria': 'Syria',
  'Egypt': 'Egypt',
  'Moldova': 'Moldova',
  'Tanzania': 'Tanzania',
  'Bolivia': 'Bolivia',
  'Venezuela': 'Venezuela',
  'Brunei': 'Brunei',
  'Vietnam': 'Vietnam',
  'Czechia': 'Czechia',
  'Dominican Republic': 'Dominican Rep.',
  'Equatorial Guinea': 'Eq. Guinea',
  'Central African Republic': 'Central African Rep.',
  'South Sudan': 'S. Sudan',
  'Bosnia and Herzegovina': 'Bosnia and Herz.',
  'North Macedonia': 'Macedonia',
  'Eswatini': 'eSwatini',
  'Solomon Islands': 'Solomon Is.',
  'Cabo Verde': 'Cabo Verde',
  'Sao Tome and Principe': 'São Tomé and Principe',
  'Antigua and Barbuda': 'Antigua and Barb.',
  'Saint Vincent and the Grenadines': 'St. Vin. and Gren.',
  'Saint Kitts and Nevis': 'St. Kitts and Nevis',
  'Trinidad and Tobago': 'Trinidad and Tobago',
  'Bahamas': 'Bahamas',
  'The Bahamas': 'Bahamas',
  'Gambia': 'Gambia',
  'Timor-Leste': 'Timor-Leste',
  'Fiji': 'Fiji',
  'Seychelles': 'Seychelles',
  'Mauritius': 'Mauritius',
  'Comoros': 'Comoros',
  'Maldives': 'Maldives',
  'Bhutan': 'Bhutan',
  'Nepal': 'Nepal',
  'Sri Lanka': 'Sri Lanka',
  'Kyrgyzstan': 'Kyrgyzstan',
  'Myanmar': 'Myanmar',
  'Turkey': 'Turkey',
  'Cyprus': 'Cyprus',
  'Greenland': 'Greenland',
  'Micronesia': 'Micronesia',
  'Papua New Guinea': 'Papua New Guinea',
  'South Africa': 'South Africa',
  'New Zealand': 'New Zealand',
  'Holy See': null, 'Monaco': null, 'San Marino': null, 'Liechtenstein': null, 'Andorra': null,
};

function norm(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
}

// —— 中文国名（界面用；未收录的回退英文）——
export const ZH = {
  'US': '美国', 'China': '中国', 'India': '印度', 'Brazil': '巴西', 'France': '法国',
  'Russia': '俄罗斯', 'United Kingdom': '英国', 'Turkey': '土耳其', 'Italy': '意大利',
  'Spain': '西班牙', 'Germany': '德国', 'Argentina': '阿根廷', 'Colombia': '哥伦比亚',
  'Iran': '伊朗', 'Poland': '波兰', 'Mexico': '墨西哥', 'Ukraine': '乌克兰', 'Peru': '秘鲁',
  'Indonesia': '印度尼西亚', 'South Africa': '南非', 'Netherlands': '荷兰', 'Chile': '智利',
  'Japan': '日本', 'South Korea': '韩国', 'Vietnam': '越南', 'Philippines': '菲律宾',
  'Iraq': '伊拉克', 'Israel': '以色列', 'Egypt': '埃及', 'Malaysia': '马来西亚',
  'Pakistan': '巴基斯坦', 'Thailand': '泰国', 'Bangladesh': '孟加拉国', 'Romania': '罗马尼亚',
  'Belgium': '比利时', 'Sweden': '瑞典', 'Czechia': '捷克', 'Portugal': '葡萄牙',
  'Canada': '加拿大', 'Australia': '澳大利亚', 'Saudi Arabia': '沙特阿拉伯', 'Greece': '希腊',
  'Switzerland': '瑞士', 'Austria': '奥地利', 'Hungary': '匈牙利', 'Serbia': '塞尔维亚',
  'Bulgaria': '保加利亚', 'Denmark': '丹麦', 'Finland': '芬兰', 'Norway': '挪威',
  'Ireland': '爱尔兰', 'New Zealand': '新西兰', 'Singapore': '新加坡', 'Kazakhstan': '哈萨克斯坦',
  'Morocco': '摩洛哥', 'Tunisia': '突尼斯', 'Kenya': '肯尼亚', 'Nigeria': '尼日利亚',
  'Ethiopia': '埃塞俄比亚', 'Ghana': '加纳', 'Algeria': '阿尔及利亚', 'Jordan': '约旦',
  'Lebanon': '黎巴嫩', 'Kuwait': '科威特', 'Qatar': '卡塔尔', 'United Arab Emirates': '阿联酋',
  'Oman': '阿曼', 'Yemen': '也门', 'Afghanistan': '阿富汗', 'Nepal': '尼泊尔',
  'Sri Lanka': '斯里兰卡', 'Burma': '缅甸', 'Cambodia': '柬埔寨', 'Mongolia': '蒙古',
  'Belarus': '白俄罗斯', 'Lithuania': '立陶宛', 'Latvia': '拉脱维亚', 'Estonia': '爱沙尼亚',
  'Moldova': '摩尔多瓦', 'Georgia': '格鲁吉亚', 'Armenia': '亚美尼亚', 'Azerbaijan': '阿塞拜疆',
  'Uzbekistan': '乌兹别克斯坦', 'Croatia': '克罗地亚', 'Slovakia': '斯洛伐克',
  'Slovenia': '斯洛文尼亚', 'Bosnia and Herzegovina': '波黑', 'North Macedonia': '北马其顿',
  'Albania': '阿尔巴尼亚', 'Cyprus': '塞浦路斯', 'Malta': '马耳他', 'Iceland': '冰岛',
  'Luxembourg': '卢森堡', 'Cuba': '古巴', 'Guatemala': '危地马拉', 'Honduras': '洪都拉斯',
  'Panama': '巴拿马', 'Costa Rica': '哥斯达黎加', 'Dominican Republic': '多米尼加',
  'Bolivia': '玻利维亚', 'Paraguay': '巴拉圭', 'Uruguay': '乌拉圭', 'Ecuador': '厄瓜多尔',
  'Venezuela': '委内瑞拉', 'Haiti': '海地', 'Puerto Rico': '波多黎各', 'Greenland': '格陵兰',
  'Taiwan*': '台湾', 'Sudan': '苏丹', 'South Sudan': '南苏丹', 'Libya': '利比亚',
  'Somalia': '索马里', 'Uganda': '乌干达', 'Tanzania': '坦桑尼亚', 'Zambia': '赞比亚',
  'Zimbabwe': '津巴布韦', 'Mozambique': '莫桑比克', 'Angola': '安哥拉', 'Cameroon': '喀麦隆',
  "Cote d'Ivoire": '科特迪瓦', 'Senegal': '塞内加尔', 'Mali': '马里',
  'Burkina Faso': '布基纳法索', 'Niger': '尼日尔', 'Chad': '乍得', 'Guinea': '几内亚',
  'Rwanda': '卢旺达', 'Madagascar': '马达加斯加', 'Botswana': '博茨瓦纳', 'Namibia': '纳米比亚',
  'Malawi': '马拉维', 'Papua New Guinea': '巴布亚新几内亚', 'Jamaica': '牙买加',
  'Trinidad and Tobago': '特立尼达和多巴哥', 'Nicaragua': '尼加拉瓜', 'El Salvador': '萨尔瓦多',
  'Belize': '伯利兹', 'Bahamas': '巴哈马', 'Barbados': '巴巴多斯', 'Guyana': '圭亚那',
  'Suriname': '苏里南', 'Bhutan': '不丹', 'Maldives': '马尔代夫', 'Brunei': '文莱',
  'Timor-Leste': '东帝汶', 'Laos': '老挝', 'Kyrgyzstan': '吉尔吉斯斯坦', 'Tajikistan': '塔吉克斯坦',
  'Turkmenistan': '土库曼斯坦', 'Congo (Kinshasa)': '刚果（金）', 'Congo (Brazzaville)': '刚果（布）',
  'Western Sahara': '西撒哈拉', 'West Bank and Gaza': '巴勒斯坦', 'Kosovo': '科索沃',
  'Montenegro': '黑山', 'Haiti': '海地', 'Hong Kong': '香港', 'Macau': '澳门',
  'Eswatini': '斯威士兰', 'Mauritius': '毛里求斯', 'Seychelles': '塞舌尔', 'Comoros': '科摩罗',
  'Cabo Verde': '佛得角', 'Sao Tome and Principe': '圣多美和普林西比',
  'Equatorial Guinea': '赤道几内亚', 'Gabon': '加蓬', 'Liberia': '利比里亚',
  'Sierra Leone': '塞拉利昂', 'Togo': '多哥', 'Benin': '贝宁', 'Djibouti': '吉布提',
  'Eritrea': '厄立特里亚', 'Burundi': '布隆迪', 'Lesotho': '莱索托', 'Mauritania': '毛里塔尼亚',
  'Gambia': '冈比亚', 'Guinea-Bissau': '几内亚比绍', 'Central African Republic': '中非',
  'Somaliland': '索马里兰',
};

function main() {
  console.log('[1/4] 下载真实数据（代理 ' + PROXY + '）');
  const fC = path.join(TMP, 'confirmed.csv');
  const fD = path.join(TMP, 'deaths.csv');
  const fA = path.join(DATA, 'countries-50m.json');
  console.log('  confirmed:', grab(SRC.confirmed, fC), 'B');
  console.log('  deaths   :', grab(SRC.deaths, fD), 'B');
  console.log('  atlas    :', grab(SRC.atlas, fA), 'B');

  console.log('[2/4] 解析与按国家聚合');
  const C = aggregateByCountry(parseCsv(fs.readFileSync(fC, 'utf8')));
  const D = aggregateByCountry(parseCsv(fs.readFileSync(fD, 'utf8')));
  if (C.dates.join() !== D.dates.join()) throw new Error('两份 CSV 日期轴不一致');
  const dates = C.dates;
  console.log(`  日期轴 ${dates[0]} → ${dates[dates.length - 1]}，共 ${dates.length} 天；国家/地区 ${C.list.length} 个`);

  // 周频抽样：首日 + 每 7 天 + 末日
  const idx = [];
  for (let i = 0; i < dates.length; i += 7) idx.push(i);
  if (idx[idx.length - 1] !== dates.length - 1) idx.push(dates.length - 1);

  console.log('[3/4] 国界索引 + 名称匹配');
  const topo = JSON.parse(fs.readFileSync(fA, 'utf8'));
  const atlas = new Map();
  for (const g of topo.objects.countries.geometries) {
    atlas.set(g.properties.name, String(g.id));
    atlas.set(norm(g.properties.name), String(g.id));
  }
  const dmap = new Map(D.list.map(e => [e.name, e]));
  const countries = [];
  const unmatched = [];
  for (const e of C.list) {
    if (ALIAS[e.name] === null) continue;           // 无对应多边形的小国/属地
    let iso = atlas.get(e.name);
    if (!iso) { const a = ALIAS[e.name]; if (a) iso = atlas.get(a); }
    if (!iso) iso = atlas.get(norm(e.name));
    const latest = e.vals[e.vals.length - 1];
    if (!iso) { unmatched.push(`${e.name}(${latest})`); continue; }
    const de = dmap.get(e.name);
    countries.push({
      name: e.name, zh: ZH[e.name] || null, iso, lat: e.lat, lon: e.lon,
      c: idx.map(i => e.vals[i]),
      d: idx.map(i => (de ? de.vals[i] : 0)),
    });
  }
  const total = C.list.length;
  const matched = countries.length;
  console.log(`  匹配 ${matched}/${total - Object.values(ALIAS).filter(v => v === null).length}；未匹配 ${unmatched.length}`);
  if (unmatched.length) console.log('  未匹配：', unmatched.slice(0, 40).join(', '));

  const out = {
    source: {
      dataset: 'COVID-19 Data Repository by the Center for Systems Science and Engineering (CSSE) at Johns Hopkins University',
      url: SRC.confirmed,
      deathUrl: SRC.deaths,
      boundary: 'Natural Earth 1:50m via world-atlas@2 (TopoJSON)',
      retrieved: new Date().toISOString().slice(0, 10),
      note: '原始为每日累计值；本文件按 7 天抽样聚合，国家内各省已累加。',
    },
    dates: idx.map(i => dates[i]),
    countries,
  };
  fs.writeFileSync(path.join(DATA, 'covid.json'), JSON.stringify(out));
  const size = fs.statSync(path.join(DATA, 'covid.json')).size;
  console.log(`[4/4] 写出 data/covid.json ${(size / 1024).toFixed(1)}KB，周频点 ${idx.length} 个`);
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (import.meta.filename === process.argv[1] || process.argv[1]?.endsWith('prepare-data.mjs')) main();
