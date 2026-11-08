/**
 * UX02 跳过题目 · 真实浏览器验收（Node 驱动 Edge/Chromium 无头）
 *
 * 前置：node "30-网页产品/web-v1/tools/本地预览.js" 5187
 * 用法：node "30-网页产品/web-v1/tests/UX02_真实浏览器验收.js" [端口]
 *
 * 做法：--dump-dom 打开 tests/UX02_自检.html，页面在真实 iframe 里加载 index.html，
 *       派发真实 MouseEvent / TouchEvent、真实 Canvas 出图，结果 base64 写进 <pre id="out">。
 *       390px 跑 14 项功能；320/375/390/430 各跑一次「首题 / 拦截面板 / 部分作答结果页」三态布局。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(ROOT, '..', '..');
const OUT_DIR = path.resolve(process.env.ATLAS_OUT || path.join(ROOT, 'tests', '_输出'), 'UX02_测试输出');
const PORT = process.argv[2] || '5187';
const BASE = 'http://127.0.0.1:' + PORT;
const PAGE = '/tests/UX02_%E8%87%AA%E6%A3%80.html';

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
  const url = BASE + PAGE + '?w=' + w + '&mode=' + mode;
  const prof = path.join(os.tmpdir(), 'wb_ux02_' + Date.now() + '_' + Math.floor(Math.random() * 10000));
  let dom = '';
  try {
    dom = execFileSync(exe, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + prof, '--virtual-time-budget=150000', '--dump-dom', url
    ], { encoding: 'utf8', timeout: 300000, maxBuffer: 96 * 1024 * 1024 });
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
  log('==== UX02 跳过题目 · 真实浏览器验收 ====');
  log('时间 ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
  log('服务 ' + BASE);
  if (!exe) { log('❌ 本机未找到 Edge/Chrome，无法做真实浏览器验收（不计为通过）'); process.exit(1); }
  log('浏览器 ' + exe);
  log('');

  const results = { browser: exe, base: BASE, full: null, layouts: [], summary: {} };

  // ---------- 1) 390px 功能 14 项 ----------
  let full;
  try { full = runPage(390, 'full'); }
  catch (e) { log('❌ 功能自检失败：' + e.message); process.exit(1); }
  results.full = full;
  log('---- [FULL 390px] stage=' + (full.stage || '?') + ' / tests=' + full.tests.length + ' / error=' + (full.error || '无') + ' ----');
  if (full.error) log('  ⚠️ 自检页异常：' + full.error);
  full.tests.forEach(t => log('  ' + mark(t) + ' ' + t.id + ' ' + t.name + '\n      ' + t.detail));
  log('  布局：clientWidth=' + full.layout.clientWidth + ' / scrollWidth=' + full.layout.scrollWidth +
      ' / 溢出 ' + full.layout.overflow + 'px / 越界元素 ' + full.layout.overCount);
  if (full.layout.over.length) full.layout.over.forEach(s => log('      ' + s));
  log('  外部请求 ' + full.external.length + ' 个 / 外链标签 ' + full.refs.length + ' 个');
  log('');

  // ---------- 2) 四视口 × 三态布局 ----------
  const widths = [320, 375, 390, 430];
  widths.forEach(w => {
    try {
      const r = runPage(w, 'layout');
      results.layouts.push(r);
      log('---- [LAYOUT ' + w + 'px] error=' + (r.error || '无') + ' ----');
      [['首题', r.layout], ['拦截面板', r.layoutBlock], ['部分作答结果页', r.layoutResult]].forEach(pair => {
        const g = pair[1];
        if (!g) { log('  ❌ ' + pair[0] + ' 未测量'); return; }
        const ok = g.overflow === 0 && g.overCount === 0;
        log('  ' + (ok ? '✅' : '❌') + ' ' + pair[0] + '：溢出 ' + g.overflow + 'px，越界元素 ' + g.overCount +
            '（clientWidth ' + g.clientWidth + ' / scrollWidth ' + g.scrollWidth + '）');
        if (g.over.length) g.over.forEach(s => log('      ' + s));
      });
      log('  跳过说明在视口内=' + (r.noteOk ? '✅' : '❌'));
    } catch (e) {
      results.layouts.push({ width: w, error: e.message });
      log('❌ [LAYOUT ' + w + 'px] ' + e.message);
    }
  });
  log('');

  // ---------- 3) 汇总 ----------
  const byId = {};
  (full.tests || []).forEach(t => { byId[t.id] = t; });
  const order = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12', 'V13', 'V14'];

  const okAll = (key) => results.layouts.length === 4 && results.layouts.every(r => r[key] && r[key].overflow === 0 && r[key].overCount === 0);
  const detailOf = (key) => results.layouts.map(r => r.width + 'px:' + (r[key] ? r[key].overflow + 'px' : 'ERR')).join(' / ');
  const extAll = [full].concat(results.layouts).every(r =>
    Array.isArray(r.external) && r.external.length === 0 && Array.isArray(r.refs) && r.refs.length === 0);

  byId['V15'] = { ok: okAll('layout'), name: '320 / 375 / 390 / 430px 答题页（含「跳过本题」按钮）无横向溢出', detail: detailOf('layout') };
  byId['V16'] = { ok: okAll('layoutBlock'), name: '四视口下「有效回答不足」拦截面板无横向溢出', detail: detailOf('layoutBlock') };
  byId['V17'] = { ok: okAll('layoutResult') && results.layouts.every(r => r.noteOk !== false), name: '四视口下部分作答结果页（跳过说明 + X/4 列）无横向溢出', detail: detailOf('layoutResult') };
  byId['V18'] = {
    ok: extAll, name: '外部网络请求为零（含所有视口与三种状态）',
    detail: [full].concat(results.layouts).map(r => (r.width || 390) + 'px:外部 ' + (r.external || []).length).join(' · ')
  };

  const finalOrder = order.concat(['V15', 'V16', 'V17', 'V18']);
  log('==== ' + finalOrder.length + ' 项汇总（14 功能 + 4 跨视口） ====');
  let pass = 0; const failIds = [];
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
