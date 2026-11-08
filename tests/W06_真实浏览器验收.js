/**
 * W06 答题页 · 真实浏览器 12 项验收（Node 驱动 Edge/Chromium 无头）
 *
 * 前置：先启动本地预览服务器
 *   node "30-网页产品/web-v1/tools/本地预览.js" 5187
 *
 * 用法：
 *   node "30-网页产品/web-v1/tests/W06_真实浏览器验收.js" [端口]
 *
 * 做法：用 --dump-dom 打开 tests/W06_答题页自检.html，页面在真实 iframe 里
 *       加载 index.html 并派发真实 DOM 点击；结果 base64 写进 <pre id="out">。
 *       4 个视口各跑一次布局自检，390px 跑一次完整 12 项交互。
 * 注意：不是 Node 里模拟 DOM，全部测量都来自真实浏览器。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(ROOT, '..', '..');
const OUT_DIR = path.resolve(process.env.ATLAS_OUT || path.join(ROOT, 'tests', '_输出'), 'W06_测试输出');
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

function runPage(w, mode) {
  const page = encodeURIComponent('W06_答题页自检.html');
  const url = BASE + '/tests/' + page + '?w=' + w + '&mode=' + mode;
  const prof = path.join(os.tmpdir(), 'wb_w06_' + Date.now() + '_' + Math.floor(Math.random() * 10000));
  let dom = '';
  try {
    dom = execFileSync(exe, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + prof, '--virtual-time-budget=90000', '--dump-dom', url
    ], { encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new Error('浏览器启动/访问失败：' + String(e.message || e).slice(0, 200));
  } finally {
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (_) {}
  }
  const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
  if (!m) throw new Error('页面未输出 <pre id="out">（可能被服务器拦截或脚本报错）');
  const raw = m[1].trim();
  if (raw === 'PENDING' || !raw) throw new Error('自检页未跑完（输出 PENDING）');
  let json;
  try { json = Buffer.from(raw, 'base64').toString('utf8'); }
  catch (e) { throw new Error('base64 解码失败：' + e.message); }
  let got;
  try { got = JSON.parse(json); }
  catch (e) { throw new Error('输出不是合法 JSON：' + json.slice(0, 120)); }
  return got;
}

function mark(t) { return t.ok ? '✅' : '❌'; }

(function main() {
  log('==== W06 答题页 · 真实浏览器 12 项验收 ====');
  log('时间 ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
  log('服务 ' + BASE);
  if (!exe) {
    log('❌ 本机未找到 Edge/Chrome，无法做真实浏览器验收（不计为通过）');
    process.exit(1);
  }
  log('浏览器 ' + exe);
  log('');

  const results = { browser: exe, base: BASE, full: null, layouts: [], summary: {} };

  // ---------- 1) 390px 完整 12 项交互 ----------
  let full;
  try {
    full = runPage(390, 'full');
  } catch (e) {
    log('❌ 完整交互自检失败：' + e.message);
    process.exit(1);
  }
  results.full = full;
  log('---- [FULL 390px] ready=' + full.ready + ' / error=' + (full.error || '无') + ' ----');
  if (full.error) log('  ⚠️ 自检页异常：' + full.error);
  log('  题库 ' + JSON.stringify(full.bankInfo));
  full.tests.forEach(t => log('  ' + mark(t) + ' ' + t.id + ' ' + t.name + '\n      ' + t.detail));
  if (full.extras && full.extras.length) {
    log('  ---- 附加验证（不计入 12 项） ----');
    full.extras.forEach(t => log('  ' + mark(t) + ' ' + t.id + ' ' + t.name + '\n      ' + t.detail));
  }
  log('  布局：clientWidth=' + full.layout.clientWidth + ' / scrollWidth=' + full.layout.scrollWidth +
      ' / 溢出 ' + full.layout.overflow + 'px / 越界元素 ' + full.layout.overCount);
  full.layout.geom.forEach(g => log('      ' + g));
  log('  外部请求 ' + full.external.length + ' 个 / 外链标签 ' + full.refs.length + ' 个');
  log('  存档长度 ' + full.storage.length + ' B / 含个人信息字段=' + full.storage.hasPII);
  log('');

  // ---------- 2) 四个视口布局 ----------
  const widths = [320, 375, 390, 430];
  widths.forEach(w => {
    try {
      const r = runPage(w, 'layout');
      results.layouts.push(r);
      const t10 = r.tests.find(x => x.id === 'T12') || { ok: false, detail: '缺 T12' };
      log('---- [LAYOUT ' + w + 'px] ready=' + r.ready + ' / error=' + (r.error || '无') + ' ----');
      log('  ' + (r.layout.overflow === 0 && r.layout.overCount === 0 ? '✅' : '❌') +
          ' T10 横向溢出 ' + r.layout.overflow + 'px，越界元素 ' + r.layout.overCount + ' 个' +
          '（clientWidth ' + r.layout.clientWidth + ' / scrollWidth ' + r.layout.scrollWidth + '）');
      if (r.layout.over.length) r.layout.over.forEach(s => log('      ' + s));
      const t11 = r.tests.find(x => x.id === 'T11');
      log('  ' + (t11 ? mark(t11) : '—') + ' T11 ' + (t11 ? t11.detail : '无'));
      log('  ' + mark(t10) + ' T12 ' + t10.detail);
    } catch (e) {
      results.layouts.push({ width: w, error: e.message });
      log('❌ [LAYOUT ' + w + 'px] ' + e.message);
    }
  });
  log('');

  // ---------- 3) 汇总 12 项 ----------
  const byId = {};
  full.tests.forEach(t => { byId[t.id] = { ok: t.ok, name: t.name, detail: t.detail, from: 'FULL 390px' }; });
  // T10 / T11 必须四个视口全过
  const t10all = results.layouts.every(r => r.layout && r.layout.overflow === 0 && r.layout.overCount === 0);
  const t10details = results.layouts.map(r => r.width + 'px:' + (r.layout ? r.layout.overflow : 'ERR') + 'px').join(' / ');
  byId['T10'] = { ok: t10all, name: '320/375/390/430px 视口无横向溢出', detail: t10details, from: '4 个视口' };
  const t11all = [full].concat(results.layouts).every(r => {
    const t = r.tests && r.tests.find(x => x.id === 'T11');
    return t && t.ok;
  });
  byId['T11'] = {
    ok: t11all,
    name: '长题干和长选项可正常阅读',
    detail: '390px 完整自检 + 4 个视口布局自检全部通过；最长题干 ' +
            (full.fit ? full.fit.stemLen : '?') + ' 字 / 最长选项 ' + (full.fit ? full.fit.optionLen : '?') + ' 字',
    from: '5 次浏览器运行'
  };

  const order = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'];
  log('==== 12 项汇总 ====');
  let pass = 0;
  order.forEach(id => {
    const t = byId[id];
    if (!t) { log('❌ ' + id + ' 未执行'); return; }
    if (t.ok) pass++;
    log('  ' + mark(t) + ' ' + id + ' ' + t.name + '（' + t.from + '）');
  });
  const extras = full.extras || [];
  const epass = extras.filter(t => t.ok).length;
  log('');
  log('附加验证（超长文本 / 版本变化 / 异常存档）：' + epass + ' / ' + extras.length + ' 通过');
  log('结果：' + pass + ' / 12 通过');
  results.summary = { pass: pass, total: 12, byId: byId, extrasPass: epass, extrasTotal: extras.length };

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, '08_真实浏览器验收.log'), lines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, '08_真实浏览器验收.json'), JSON.stringify(results, null, 2), 'utf8');
  log('证据：' + path.join(OUT_DIR, '08_真实浏览器验收.log'));
  process.exit(pass === 12 && epass === extras.length ? 0 : 1);
})();
