/**
 * W06 答题页视觉快照（真实 Edge 无头截图）
 * 前置：node "tools/本地预览.js" 5187
 * 用法：node "tests/W06_视觉快照.js" [端口]
 * 输出：tests/_输出/W06_测试输出/（可用 ATLAS_OUT 环境变量改到别处）S1~S5_*.png
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.env.ATLAS_OUT || path.join(ROOT, 'tests', '_输出'), 'W06_测试输出');
const PORT = process.argv[2] || '5187';
const BASE = 'http://127.0.0.1:' + PORT;
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];
const exe = BROWSERS.filter(p => fs.existsSync(p))[0];
if (!exe) { console.log('❌ 未找到 Edge/Chrome'); process.exit(1); }
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const shots = [
  { w: 390, h: 844, state: 'first',     file: 'S1_答题页_首题390.png' },
  { w: 390, h: 844, state: 'selected',  file: 'S2_答题页_选中态390.png' },
  { w: 390, h: 844, state: 'middle',    file: 'S3_答题页_第9题390.png' },
  { w: 390, h: 844, state: 'lastq',     file: 'S4_答题页_第20题完成反馈390.png' },
  { w: 320, h: 844, state: 'selected',  file: 'S5_答题页_320.png' }
];

const page = encodeURIComponent('W06_视觉快照.html');
shots.forEach(function (s) {
  const url = BASE + '/tests/' + page + '?w=' + s.w + '&h=' + s.h + '&state=' + s.state;
  const out = path.join(OUT, s.file);
  const prof = path.join(os.tmpdir(), 'wb_w06_shot_' + Date.now() + '_' + Math.floor(Math.random() * 10000));
  try {
    execFileSync(exe, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', '--force-device-scale-factor=1',
      '--window-size=' + s.w + ',' + s.h,
      '--virtual-time-budget=15000',
      '--screenshot=' + out, url
    ], { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
    console.log((size > 1000 ? '✅' : '❌') + ' ' + s.file + '  ' + size + ' B  (' + s.w + 'px / ' + s.state + ')');
  } catch (e) {
    console.log('❌ ' + s.file + ' 截图失败：' + String(e.message || e).slice(0, 160));
  } finally {
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (_) {}
  }
});
console.log('输出目录：' + OUT);
