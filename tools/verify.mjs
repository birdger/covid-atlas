// tools/verify.mjs —— 无头浏览器硬验证（Edge + CDP，零依赖）
// 运行： node tools/verify.mjs        （需先 node tools/serve.mjs 4182）
// 判据：断言全绿 + 0 console 错误 + 截图非空白（像素真值，不看"感觉"）
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// puppeteer 复用同目录 gods-eye-view 已装好的包（避免重复下载 Chromium）；
// 换机器时用 ATLAS_PPTR 指定任意已安装 puppeteer 的 package.json 路径即可。
const req = createRequire(process.env.ATLAS_PPTR || 'file:///F:/道路/AI/vibe-coding/gods-eye-view/package.json');
const puppeteer = req('puppeteer');

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = path.join(ROOT, 'qa-shots', 'verify');
const URL = process.env.ATLAS_URL || 'http://127.0.0.1:4182/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const fails = [];
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fails.push(`${name}${extra ? ' — ' + extra : ''}`); console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

fs.mkdirSync(SHOTS, { recursive: true });
const consoleErrors = [];

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => consoleErrors.push('REQFAIL: ' + r.url() + ' ' + (r.failure()?.errorText || '')));

console.log('\n[1] 启动与数据集');
const resp = await page.goto(URL, { waitUntil: 'domcontentloaded' });
t('页面 HTTP 200', resp.status() === 200, `status=${resp.status()}`);
await page.waitForFunction('window.__atlas && window.__atlas.ready === true', { timeout: 25000 });
t('__atlas.ready 置位', true);

const meta = await page.evaluate(() => {
  const a = window.__atlas;
  return {
    n: a.ds.n, dates: [a.ds.dates[0], a.ds.dates[a.ds.n - 1]], countries: a.ds.countries.length,
    source: (a.ds.source && (a.ds.source.organization || a.ds.source.dataset)) || '',
    srcLine: (document.getElementById('source-line') || {}).textContent || '', geo: a.geoCount,
    seqOk: a.ds.countries.every((c) => c.c.length === a.ds.n && c.d.length === a.ds.n),
  };
});
t('日期数 = 165 周', meta.n === 165, `n=${meta.n}`);
t('时间范围 2020-01-22 → 2023-03-09', meta.dates[0] === '2020-01-22' && meta.dates[1] === '2023-03-09', meta.dates.join(' → '));
t('国家数 ≥ 190', meta.countries >= 190, `${meta.countries} 国`);
t('数据来源标注为 JHU CSSE（元数据 + 页脚）', /Hopkins|CSSE/i.test(meta.source) && /霍普金斯|CSSE/.test(meta.srcLine), `${String(meta.source).slice(0, 40)}… | ${meta.srcLine.slice(0, 28)}`);
t('国界几何 ≥ 200 个', meta.geo >= 200, `${meta.geo} 个多边形`);
t('每国序列长度与日期数一致', meta.seqOk);

console.log('\n[2] 首屏渲染（像素真值）');
await sleep(700);
const probe0 = await page.evaluate(() => window.__atlas.pixelProbe());
t('地图画布非空白', probe0.map.colors >= 50 && probe0.map.samples > 500, `${probe0.map.colors} 色 / ${probe0.map.size.join('x')}`);
t('折线画布非空白', probe0.chart.colors >= 20 && probe0.chart.samples > 200, `${probe0.chart.colors} 色 / ${probe0.chart.size.join('x')}`);
const st0 = await page.evaluate(() => window.__atlas.status());
t('默认停在最后一周（2023-03-09）', st0.date === '2023-03-09', st0.date);
t('默认选中 5 个对比国家', st0.selected === 5, `${st0.selected}`);
t('全球累计确诊 ≈ 6.76 亿', Math.abs(st0.world - 676456135) < 2e6, String(st0.world));

console.log('\n[3] 地图命中与中文标签');
const usCenter = await page.evaluate(() => window.__atlas.project(-98, 39));
const hitUS = await page.evaluate((p) => window.__atlas.hitAt(p[0], p[1]), usCenter);
t('点美国本土经纬度命中 iso=840', hitUS === '840', `hit=${hitUS}`);
const top1 = await page.evaluate(() => window.__atlas.rankTop(1)[0]);
t('排行榜第 1 名是美国', top1.iso === '840', JSON.stringify(top1));
t('中文国名标签生效', top1.label === '美国', top1.label);

console.log('\n[4] 时间轴播放');
const before = await page.evaluate(() => window.__atlas.status());
await page.evaluate(() => window.__atlas.play(true));
t('播放态开启', await page.evaluate(() => window.__atlas.status().playing));
await sleep(1500);
await page.evaluate(() => window.__atlas.play(false));
const after = await page.evaluate(() => window.__atlas.status());
t('播放推进了时间轴', after.index !== before.index, `${before.index} → ${after.index}`);
t('播放后仍在有效范围', after.index >= 0 && after.index < meta.n, String(after.index));
await page.evaluate(() => window.__atlas.setIndex(0));
const at0 = await page.evaluate(() => window.__atlas.status());
t('setIndex(0) → 2020-01-22', at0.date === '2020-01-22', at0.date);
t('首周全球确诊 < 1 万', at0.world < 10000, String(at0.world));

console.log('\n[5] 指标切换（世界合计合理性）');
const metrics = {};
for (const m of ['cases', 'deaths', 'newCases', 'newDeaths', 'cfr']) {
  await page.evaluate((id) => window.__atlas.setMetric(id), m);
  await page.evaluate(() => window.__atlas.setIndex(164));
  metrics[m] = await page.evaluate(() => window.__atlas.status());
}
t('累计确诊 6.7 亿量级', metrics.cases.world > 6e8 && metrics.cases.world < 8e8, String(Math.round(metrics.cases.world)));
t('累计死亡 6700 万量级', metrics.deaths.world > 6e6 && metrics.deaths.world < 8e6, String(Math.round(metrics.deaths.world)));
t('死亡 < 确诊', metrics.deaths.world < metrics.cases.world);
t('每周新增 > 0', metrics.newCases.world > 0, String(Math.round(metrics.newCases.world)));
t('病死率在 0.5%~10% 之间', metrics.cfr.world > 0.5 && metrics.cfr.world < 10, metrics.cfr.world.toFixed(2) + '%');
t('病死率 = 死亡/确诊', Math.abs(metrics.cfr.world - (metrics.deaths.world / metrics.cases.world) * 100) < 0.05);

console.log('\n[6] 刻度、主题与交互');
await page.evaluate(() => window.__atlas.setMetric('cases'));
const drawsBefore = await page.evaluate(() => window.__atlas.status().draws);
await page.evaluate(() => window.__atlas.toggleLog());
const lin = await page.evaluate(() => window.__atlas.status());
t('对数/线性可切换', lin.log === false, 'log=' + lin.log);
t('切换后触发重绘', lin.draws > drawsBefore, `${drawsBefore} → ${lin.draws}`);
const shotLin = await page.screenshot({ encoding: 'binary' });
await page.evaluate(() => window.__atlas.toggleLog());

await page.evaluate(() => window.__atlas.toggleTheme());
const nightTheme = await page.evaluate(() => document.documentElement.dataset.theme);
const probeNight = await page.evaluate(() => window.__atlas.pixelProbe());
t('主题切到夜色', nightTheme === 'night', nightTheme);
t('夜色主题下地图重新着色', probeNight.map.colors >= 50);
t('夜色背景更暗（像素真值）', await page.evaluate(async () => {
  const c = document.getElementById('map');
  const g = c.getContext('2d');
  const d = g.getImageData(2, 2, 1, 1).data;
  return d[0] + d[1] + d[2] < 200;   // 夜色底 #141312
}));
const shotNight = await page.screenshot({ encoding: 'binary' });
t('日/夜两张截图不同', Buffer.compare(shotLin, shotNight) !== 0);
await page.evaluate(() => window.__atlas.toggleTheme());

const selBefore = await page.evaluate(() => window.__atlas.status().selected);
await page.evaluate(() => window.__atlas.select('036'));   // 澳大利亚
const selAfter = await page.evaluate(() => window.__atlas.status().selected);
t('点选国家加入对比', selAfter === selBefore + 1, `${selBefore} → ${selAfter}`);
await page.evaluate(() => window.__atlas.deselect('036'));
t('取消选择生效', await page.evaluate(() => window.__atlas.status().selected) === selBefore);

await page.evaluate(() => window.__atlas.setIndex(100));
await page.keyboard.press('ArrowRight');
const kb = await page.evaluate(() => window.__atlas.status());
t('键盘 → 推进一周', kb.index === 101, String(kb.index));
await page.keyboard.press('Space');
t('空格开始播放', await page.evaluate(() => window.__atlas.status().playing));
await page.keyboard.press('Space');
t('空格暂停', await page.evaluate(() => window.__atlas.status().playing === false));

await page.evaluate(() => { window.__atlas.setIndex(120); window.__atlas.select('076'); });   // 巴西
const suggest = await page.evaluate(async () => {
  const s = document.getElementById('search');
  s.value = '巴西';
  s.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  const box = document.getElementById('suggest');
  return { hidden: box.hidden, items: box.children.length, first: box.textContent.trim().slice(0, 14) };
});
t('搜索"巴西"给出建议', !suggest.hidden && suggest.items >= 1 && /巴西/.test(suggest.first), `${suggest.items} 条 · ${suggest.first}`);

console.log('\n[7] 截图与错误');
await page.evaluate(() => { window.__atlas.setMetric('cases'); window.__atlas.setIndex(150); });
await sleep(500);
const shots = {
  '01-地图与折线.png': await page.screenshot({ encoding: 'binary' }),
};
// 窄屏重排：证明画布按容器自适应（此页为 100vh 单屏仪表盘，fullPage 等于视口，故改用宽度变化作为真实证据）
const wideW = await page.evaluate(() => document.getElementById('map').width);
await page.setViewport({ width: 960, height: 900 });
await sleep(700);
const narrowW = await page.evaluate(() => document.getElementById('map').width);
t('窄屏 960 重排：地图画布变窄', narrowW > 200 && narrowW < wideW, `${wideW} → ${narrowW}`);
shots['02-窄屏960.png'] = await page.screenshot({ encoding: 'binary' });
await page.setViewport({ width: 1440, height: 900 });
await sleep(500);
await page.evaluate(() => { window.__atlas.toggleTheme(); window.__atlas.setMetric('newCases'); window.__atlas.setIndex(80); });
await sleep(600);
shots['03-夜色-每周新增.png'] = await page.screenshot({ encoding: 'binary' });
await page.evaluate(() => { window.__atlas.toggleTheme(); window.__atlas.setMetric('cfr'); window.__atlas.play(true); });
await sleep(1200);
shots['04-播放中-病死率.png'] = await page.screenshot({ encoding: 'binary' });
await page.evaluate(() => window.__atlas.play(false));
for (const [name, buf] of Object.entries(shots)) {
  fs.writeFileSync(path.join(SHOTS, name), buf);
  t(`截图 ${name} 非空白`, buf.length > 30000, `${(buf.length / 1024).toFixed(0)}KB`);
}
const pageErrors = await page.evaluate(() => window.__atlas.errors);
t('页面内 0 未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || '无');
t('控制台 0 错误（含 404/请求失败）', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || '无');

await browser.close();
const total = pass + fails.length;
console.log(`\n浏览器硬验证：${pass}/${total}` + (fails.length ? `\n失败项：\n - ${fails.join('\n - ')}` : ''));
process.exit(fails.length ? 1 : 0);
