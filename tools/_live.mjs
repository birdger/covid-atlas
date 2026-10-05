// tools/_live.mjs —— 实况检查：无头浏览器打开页面，看它真的画出来了（人眼替代品：像素真值）
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// puppeteer 装在 gods-eye-view 的 node_modules 里，从这里借（本项目零依赖）
const req = createRequire('file:///F:/道路/AI/vibe-coding/gods-eye-view/package.json');
const puppeteer = req('puppeteer');

const ROOT = path.resolve(import.meta.dirname, '..');
const URL = process.env.ATLAS_URL || 'http://127.0.0.1:4182/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__atlas && window.__atlas.ready === true', { timeout: 20000 });
await sleep(600);

const before = await page.evaluate(() => window.__atlas.status());
await page.evaluate(() => window.__atlas.play(true));
await sleep(1600);
await page.evaluate(() => window.__atlas.play(false));
await sleep(200);
const after = await page.evaluate(() => window.__atlas.status());
const probe = await page.evaluate(() => window.__atlas.pixelProbe());

fs.mkdirSync(path.join(ROOT, 'qa-shots'), { recursive: true });
await page.screenshot({ path: path.join(ROOT, 'qa-shots', 'live-preview.png') });
await page.screenshot({ path: path.join(ROOT, 'qa-shots', 'live-full.png'), fullPage: true });

console.log('播放前:', JSON.stringify(before));
console.log('播放后:', JSON.stringify(after));
console.log('地图像素:', JSON.stringify(probe));
console.log('控制台:', logs.length ? logs.slice(0, 10).join(' | ') : '（无输出，即 0 错误）');
console.log('截图: qa-shots/live-preview.png + live-full.png');
await browser.close();
