/**
 * W07 结果页 + W08 分享卡片 · 真实浏览器 18 项验收（Node 驱动 Edge/Chromium 无头）
 *
 * 前置：node "30-网页产品/web-v1/tools/本地预览.js" 5187
 * 用法：node "30-网页产品/web-v1/tests/W07_真实浏览器验收.js" [端口]
 *
 * 做法：--dump-dom 打开 tests/W07_自检.html，页面在真实 iframe 里加载 index.html、
 *       派发真实 DOM 点击、真实 Canvas 出图，结果 base64 写进 <pre id="out">。
 *       390px 跑完整 18 项；320/375/390/430 各跑一次布局与外链。
 *       Node 侧另用同一份 scoring.js 独立穷举 13^5，核对 16 组可及组合无遗漏。
 * 注意：不是 Node 里模拟 DOM，页面测量全部来自真实浏览器。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(ROOT, '..', '..');
const OUT_DIR = path.resolve(process.env.ATLAS_OUT || path.join(ROOT, 'tests', '_输出'), 'W07_测试输出');
const PORT = process.argv[2] || '5187';
const BASE = 'http://127.0.0.1:' + PORT;
const S = require(path.join(ROOT, 'js', 'scoring.js'));
const COPY = require(path.join(ROOT, 'data', '结果文案.json'));

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
  const url = BASE + '/tests/W07_自检.html?w=' + w + '&mode=' + mode;
  const prof = path.join(os.tmpdir(), 'wb_w07_' + Date.now() + '_' + Math.floor(Math.random() * 10000));
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
function mark(t) { return t && t.ok ? '✅' : '❌'; }
function savePng(dataUrl, name) {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!m) return 0;
  const buf = Buffer.from(m[1], 'base64');
  fs.writeFileSync(path.join(OUT_DIR, name), buf);
  return buf.length;
}

/** 独立穷举 13^5，确认「可及组合」恰好 16 组且与文案 JSON 的 reachable 标记一致 */
function exhaustiveKeys() {
  const D = ['W', 'L', 'M', 'C', 'G'];
  const seen = {};
  let n = 0;
  // 全扫 371,293 组，不提前退出：确认「可达组合恰好 16 组」而不是「先撞见 16 组」
  for (let a = 0; a < 13; a++) for (let b = 0; b < 13; b++) for (let c = 0; c < 13; c++)
  for (let d = 0; d < 13; d++) for (let e = 0; e < 13; e++) {
    n++;
    const p = [a, b, c, d, e], sums = {};
    D.forEach((k, i) => sums[k] = p[i] + 4);
    const r = S.classifySums(sums);
    const key = r.species + '|' + r.level;
    if (!seen[key]) seen[key] = { key: key, at: n, p: p.slice() };
  }
  return { scanned: n, keys: Object.keys(seen), detail: seen };
}

(function main() {
  log('==== W07 结果页 + W08 分享卡片 · 真实浏览器 18 项验收 ====');
  log('时间 ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
  log('服务 ' + BASE);
  if (!exe) { log('❌ 本机未找到 Edge/Chrome，无法做真实浏览器验收（不计为通过）'); process.exit(1); }
  log('浏览器 ' + exe);
  log('');

  // ---------- 0) Node 侧独立穷举：可及组合恰好 16 组 ----------
  let exh = null;
  try {
    exh = exhaustiveKeys();
    const docKeys = COPY.判词建议.filter(x => x.reachable).map(x => x.物种 + '|' + x.整体状态).sort();
    const algKeys = exh.keys.slice().sort();
    const same = JSON.stringify(docKeys) === JSON.stringify(algKeys);
    log('---- [0] 13^5 穷举校验（Node 侧，与浏览器无关） ----');
    log('  扫描 ' + exh.scanned.toLocaleString() + ' 组，算法可及组合 ' + exh.keys.length + ' 组');
    log('  ' + (same ? '✅' : '❌') + ' 文案 JSON 的 16 条 reachable 标记与算法穷举结果一致');
    if (!same) log('  差异：文档 ' + JSON.stringify(docKeys) + ' / 算法 ' + JSON.stringify(algKeys));
  } catch (e) { log('  ⚠️ 穷举校验异常：' + e.message); }
  log('');

  const results = { browser: exe, base: BASE, exhaustive: exh, full: null, layouts: [], summary: {} };

  // ---------- 1) 390px 完整 18 项 ----------
  let full;
  try { full = runPage(390, 'full'); }
  catch (e) { log('❌ 完整自检失败：' + e.message); process.exit(1); }
  results.full = full;
  log('---- [FULL 390px] done=' + full.done + ' / error=' + (full.error || '无') + ' ----');
  if (full.error) log('  ⚠️ 自检页异常：' + full.error);
  full.tests.forEach(t => log('  ' + mark(t) + ' ' + t.id + ' ' + t.name + '\n      ' + t.detail));
  if (full.samples && full.samples.length) {
    log('  ---- 组合渲染明细（16 可及 + 4 兜底） ----');
    full.samples.forEach(s => log('    ' + (s.ok ? '✓' : '✗') + ' ' + s.key + ' · ' + s.detail));
  }
  log('  布局：clientWidth=' + full.layout.clientWidth + ' / scrollWidth=' + full.layout.scrollWidth +
      ' / 溢出 ' + full.layout.overflow + 'px / 越界元素 ' + full.layout.overCount);
  if (full.layout.over.length) full.layout.over.forEach(s => log('      ' + s));
  log('  外部请求 ' + full.external.length + ' 个 / 外链标签 ' + full.refs.length + ' 个');
  log('');

  // ---------- 2) 四个视口 ----------
  const widths = [320, 375, 390, 430];
  widths.forEach(w => {
    try {
      const r = runPage(w, 'layout');
      results.layouts.push(r);
      log('---- [LAYOUT ' + w + 'px] error=' + (r.error || '无') + ' ----');
      log('  ' + (r.layout.overflow === 0 && r.layout.overCount === 0 ? '✅' : '❌') +
          ' R17 横向溢出 ' + r.layout.overflow + 'px，越界元素 ' + r.layout.overCount +
          '（clientWidth ' + r.layout.clientWidth + ' / scrollWidth ' + r.layout.scrollWidth + '）');
      if (r.layout.over.length) r.layout.over.forEach(s => log('      ' + s));
      const t18 = r.tests.find(x => x.id === 'R18');
      log('  ' + mark(t18) + ' R18 ' + (t18 ? t18.detail : '缺'));
    } catch (e) {
      results.layouts.push({ width: w, error: e.message });
      log('❌ [LAYOUT ' + w + 'px] ' + e.message);
    }
  });
  log('');

  // ---------- 3) 汇总 ----------
  const byId = {};
  full.tests.forEach(t => { byId[t.id] = { ok: t.ok, name: t.name, detail: t.detail, from: 'FULL 390px' }; });
  const allRuns = [full].concat(results.layouts);
  const layoutAll = allRuns.every(r => r.layout && r.layout.overflow === 0 && r.layout.overCount === 0);
  byId['R17'] = {
    ok: layoutAll,
    name: '320/375/390/430px 结果页无横向溢出',
    detail: allRuns.map(r => r.width + 'px:' + (r.layout ? r.layout.overflow : 'ERR') + 'px').join(' / '),
    from: '5 次浏览器运行'
  };
  const extAll = allRuns.every(r => Array.isArray(r.external) && r.external.length === 0 &&
                                    Array.isArray(r.refs) && r.refs.length === 0);
  byId['R18'] = {
    ok: extAll, name: '外部网络请求为零（资源全同源、页面无外链）',
    detail: allRuns.map(r => r.width + 'px:外部 ' + (r.external || []).length + '/外链 ' + (r.refs || []).length).join(' · '),
    from: '5 次浏览器运行'
  };
  const order = ['R1','R2','R3','R4','R5','R6','R7','R8','R9','R10',
                 'R11','R12','R13','R14','R15','R16','R17','R18'];
  log('==== 18 项汇总 ====');
  let pass = 0;
  order.forEach(id => {
    const t = byId[id];
    if (!t) { log('❌ ' + id + ' 未执行'); return; }
    if (t.ok) pass++;
    log('  ' + mark(t) + ' ' + id + ' ' + t.name + '（' + t.from + '）');
  });
  const sampleKeysOK = exh && full.samples &&
    full.samples.filter(s => s.ok).length === 20 &&
    exh.keys.length === 16 &&
    full.samples.slice(0, 16).every(s => exh.keys.indexOf(s.key) >= 0);
  log('');
  log('组合渲染：' + (full.samples || []).filter(s => s.ok).length + ' / 20 组通过；' +
      '16 组 key 与 13^5 穷举结果对齐 = ' + (sampleKeysOK ? '是 ✅' : '否 ❌'));
  log('结果：' + pass + ' / 18 通过');
  results.summary = { pass: pass, total: 18, byId: byId, sampleKeysOK: !!sampleKeysOK };

  // ---------- 4) 证据文件 ----------
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (full.card) {
    const big = savePng(full.card.pngDataUrl, 'K1_分享卡_' + (full.card.species || '结果') + '_1080x1440.png');
    const small = savePng(full.card.thumbDataUrl, 'K2_分享卡_缩略图200.png');
    log('卡片证据：原图 ' + big + ' B / 200px 缩略图 ' + small + ' B');
    // 日志/JSON 里不放 base64 图片数据，避免证据文件膨胀
    delete full.card.pngDataUrl;
    delete full.card.thumbDataUrl;
  }
  fs.writeFileSync(path.join(OUT_DIR, '09_真实浏览器验收.log'), lines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, '09_真实浏览器验收.json'), JSON.stringify(results, null, 2), 'utf8');
  log('证据：' + path.join(OUT_DIR, '09_真实浏览器验收.log'));
  process.exit(pass === 18 && sampleKeysOK && !full.error ? 0 : 1);
})();
