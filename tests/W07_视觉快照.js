/**
 * W07 结果页视觉快照（真实 Edge 无头截图）
 * 前置：node "tools/本地预览.js" 5187
 * 用法：node "tests/W07_视觉快照.js" [端口]
 * 输出：tests/_输出/W07_测试输出/（可用 ATLAS_OUT 环境变量改到别处）S1~S6_*.png
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.env.ATLAS_OUT || path.join(ROOT, 'tests', '_输出'), 'W07_测试输出');
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
  { w: 390, h: 844,  state: 'result', sp: '',      file: 'S1_结果页_首屏390.png' },
  { w: 390, h: 2400, state: 'result', sp: '',      file: 'S2_结果页_整页390.png' },
  { w: 390, h: 844,  state: 'result', sp: '水豚',  file: 'S3_结果页_水豚390.png' },
  { w: 390, h: 844,  state: 'result', sp: '狐狸',  file: 'S4_结果页_狐狸390.png' },
  { w: 320, h: 844,  state: 'result', sp: '',      file: 'S5_结果页_320.png' },
  // UX01：分享卡改为弹窗，按手机视口截（固定层会铺满窗口，不能再用 2300px 高的整页壳）
  { w: 390, h: 844,  state: 'card',   sp: '',      file: 'S6_分享卡弹窗390.png' },
  { w: 320, h: 780,  state: 'card',   sp: '',      file: 'S7_分享卡弹窗320.png' }
];

const page = encodeURIComponent('W07_视觉快照.html');
shots.forEach(function (s) {
  const url = BASE + '/tests/' + page + '?w=' + s.w + '&h=' + s.h +
              '&state=' + s.state + '&sp=' + encodeURIComponent(s.sp);
  const out = path.join(OUT, s.file);
  const prof = path.join(os.tmpdir(), 'wb_w07_shot_' + Date.now() + '_' + Math.floor(Math.random() * 10000));
  try {
    execFileSync(exe, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', '--force-device-scale-factor=1',
      '--user-data-dir=' + prof,
      '--window-size=' + s.w + ',' + s.h,
      '--virtual-time-budget=20000',
      '--screenshot=' + out, url
    ], { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
    console.log((size > 1000 ? '✅' : '❌') + ' ' + s.file + '  ' + size + ' B  (' + s.w + '×' + s.h + ' / ' + (s.sp || s.state) + ')');
  } catch (e) {
    console.log('❌ ' + s.file + ' 截图失败：' + String(e.message || e).slice(0, 160));
  } finally {
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (_) {}
  }
});
console.log('输出目录：' + OUT);
