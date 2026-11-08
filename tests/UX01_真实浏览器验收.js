/**
 * UX01 移动端答题与分享体验 · 真实浏览器验收（Node 驱动 Edge/Chromium 无头）
 *
 * 前置：node "30-网页产品/web-v1/tools/本地预览.js" 5187
 * 用法：node "30-网页产品/web-v1/tests/UX01_真实浏览器验收.js" [端口]
 *
 * 做法：--dump-dom 打开 tests/UX01_自检.html，页面在真实 iframe 里加载 index.html，
 *       派发真实 MouseEvent / TouchEvent、真实 Canvas 出图，结果 base64 写进 <pre id="out">。
 *       390px 跑 16 项功能；320/375/390/430 各跑一次布局 + 弹窗尺寸。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(ROOT, '..', '..');
const OUT_DIR = path.resolve(process.env.ATLAS_OUT || path.join(ROOT, 'tests', '_输出'), 'UX01_测试输出');
const PORT = process.argv[2] || '5187';
const BASE = 'http://127.0.0.1:' + PORT;

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];
const exe = BROWSERS.filter(p => fs.existsSync(p))[0];
const lines = [];
function log(s) { lines.push(s); console.log(s); }
function mark(t) { return t && t.ok ? '✅' : '❌'; }

function runPage(w, mode) {
  const url = BASE + '/tests/UX01_%E8%87%AA%E6%A3%80.html?w=' + w + '&mode=' + mode;
  const prof = path.join(os.tmpdir(), 'wb_ux01_' + Date.now() + '_' + Math.floor(Math.random() * 10000));
  let dom = '';
  try {
    dom = execFileSync(exe, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + prof, '--virtual-time-budget=120000', '--dump-dom', url
    ], { encoding: 'utf8', timeout: 240000, maxBuffer: 96 * 1024 * 1024 });
  } catch (e) {
    throw new Error('浏览器启动/访问失败：' + String(e.message || e).slice(0, 200));
  } finally {
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (_) {}
  }
  const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
  if (!m) throw new Error('页面未输出 <pre id="out">');
  const raw = m[1].trim();
  if (raw === 'PENDING' || !raw) throw new Error('自检页未跑完（输出 PENDING）');
  let got;
  try { got = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
  catch (e) { throw new Error('输出不是合法 JSON：' + String(e.message) + ' / ' + raw.slice(0, 120)); }
  return got;
}

(function main() {
  log('==== UX01 移动端答题与分享体验 · 真实浏览器验收 ====');
  log('时间 ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
  log('服务 ' + BASE);
  if (!exe) { log('❌ 本机未找到 Edge/Chrome，无法做真实浏览器验收（不计为通过）'); process.exit(1); }
  log('浏览器 ' + exe);
  log('');

  const results = { browser: exe, base: BASE, full: null, layouts: [], summary: {} };

  // ---------- 1) 390px 功能 16 项 ----------
  let full;
  try { full = runPage(390, 'full'); }
  catch (e) { log('❌ 功能自检失败：' + e.message); process.exit(1); }
  results.full = full;
  log('---- [FULL 390px] tests=' + full.tests.length + ' / error=' + (full.error || '无') + ' ----');
  if (full.error) log('  ⚠️ 自检页异常：' + full.error);
  full.tests.forEach(t => log('  ' + mark(t) + ' ' + t.id + ' ' + t.name + '\n      ' + t.detail));
  log('  布局：clientWidth=' + full.layout.clientWidth + ' / scrollWidth=' + full.layout.scrollWidth +
      ' / 溢出 ' + full.layout.overflow + 'px / 越界元素 ' + full.layout.overCount);
  if (full.layout.over.length) full.layout.over.forEach(s => log('      ' + s));
  log('  外部请求 ' + full.external.length + ' 个 / 外链标签 ' + full.refs.length + ' 个');
  log('');

  // ---------- 2) 四视口布局 + 弹窗 ----------
  const widths = [320, 375, 390, 430];
  widths.forEach(w => {
    try {
      const r = runPage(w, 'layout');
      results.layouts.push(r);
      const okOverflow = r.layout.overflow === 0 && r.layout.overCount === 0;
      log('---- [LAYOUT ' + w + 'px] error=' + (r.error || '无') + ' ----');
      log('  ' + (okOverflow ? '✅' : '❌') + ' 无横向溢出 ' + r.layout.overflow + 'px，越界元素 ' + r.layout.overCount +
          '（clientWidth ' + r.layout.clientWidth + ' / scrollWidth ' + r.layout.scrollWidth + '）');
      if (r.layout.over.length) r.layout.over.forEach(s => log('      ' + s));
      log('  ' + (r.modalOk ? '✅' : '❌') + ' 弹窗在视口内、图片按比例完整显示 ' +
          JSON.stringify(r.modal || {}));
      log('  关键元素：' + JSON.stringify(r.layout.geo));
    } catch (e) {
      results.layouts.push({ width: w, error: e.message });
      log('❌ [LAYOUT ' + w + 'px] ' + e.message);
    }
  });
  log('');

  // ---------- 3) 汇总 ----------
  const byId = {};
  (full.tests || []).forEach(t => { byId[t.id] = t; });
  const order = ['U1','U2','U3','U4','U5','U6','U7','U8','U9','U10','U11','U12','U13','U14','U15','U16','U17'];

  const layoutAll = results.layouts.length === 4 &&
    results.layouts.every(r => r.layout && r.layout.overflow === 0 && r.layout.overCount === 0);
  const modalAll = results.layouts.length === 4 && results.layouts.every(r => r.modalOk === true);
  const extAll = [full].concat(results.layouts).every(r =>
    Array.isArray(r.external) && r.external.length === 0 && Array.isArray(r.refs) && r.refs.length === 0);

  byId['U18'] = {
    ok: layoutAll, name: '320 / 375 / 390 / 430px 无横向溢出',
    detail: results.layouts.map(r => r.width + 'px:' + (r.layout ? r.layout.overflow : 'ERR') + 'px').join(' / ')
  };
  byId['U19'] = {
    ok: modalAll, name: '四视口下弹窗都在视口内，图片按比例完整显示',
    detail: results.layouts.map(r => r.width + 'px:' + (r.modalOk ? 'ok' : 'fail')).join(' / ')
  };
  byId['U20'] = {
    ok: extAll, name: '外部网络请求为零（含所有视口与弹窗状态）',
    detail: [full].concat(results.layouts).map(r => (r.width || 390) + 'px:外部 ' + (r.external || []).length).join(' · ')
  };

  const finalOrder = order.concat(['U18', 'U19', 'U20']);
  log('==== 20 项汇总（17 功能 + 3 跨视口） ====');
  let pass = 0, failIds = [];
  finalOrder.forEach(id => {
    const t = byId[id];
    if (!t) { log('❌ ' + id + ' 未执行'); failIds.push(id); return; }
    if (t.ok) pass++; else failIds.push(id);
    log('  ' + mark(t) + ' ' + id + ' ' + t.name);
    if (!t.ok) log('      ' + t.detail);
  });
  log('');
  log('结果：' + pass + ' / ' + finalOrder.length + ' 通过' + (failIds.length ? '；失败：' + failIds.join(',') : ''));
  results.summary = { pass, total: finalOrder.length, failIds, byId };

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, '10_真实浏览器验收.log'), lines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, '10_真实浏览器验收.json'), JSON.stringify(results, null, 2), 'utf8');
  log('证据：' + path.join(OUT_DIR, '10_真实浏览器验收.log'));
  process.exit(pass === finalOrder.length && !full.error ? 0 : 1);
})();
