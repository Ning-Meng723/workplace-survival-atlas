// tools/校验题库同步.js
// 用途：确认仓库里的 data/题库.json 与项目权威题库「同一份内容」，防止两份题库悄悄漂移。
//
// 算法来源：沿用 70-质量检查/版本快照.js 第 19–33 行的规范化算法（同一套，不另造一套），
//           分别给「题目+选项+分值」和「scoring 规则」算 sha256 前 16 位，再与 版本快照.json 登记值比对。
//
// 三方一致才算通过：项目题库 / 仓库题库 / 版本快照登记值。
//
// 用法（在仓库根目录下）：
//   node "30-网页产品/web-v1/tools/校验题库同步.js"
// 退出码 0 = 通过；1 = 有失败项。
//
// 只读：本脚本不写任何文件。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// tools/ → web-v1/ → 30-网页产品/ → 项目根
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(PROJECT_ROOT, '20-测试内容', '题库.json');
const COPY = path.resolve(__dirname, '..', 'data', '题库.json');
const SNAP = path.join(PROJECT_ROOT, '70-质量检查', '版本快照.json');
const REPO_ROOT = path.resolve(__dirname, '..');

// 【公开仓库说明】本脚本校验「私有源题库 ↔ 仓库副本 ↔ 版本快照」三方一致，
// 需要项目私有的 20-测试内容/ 与 70-质量检查/。公开仓库只发布网页产品本身，
// 不含这两个目录，因此在这里提示跳过 —— 产品运行不依赖本脚本。
if (!fs.existsSync(path.join(PROJECT_ROOT, '20-测试内容')) || !fs.existsSync(path.join(PROJECT_ROOT, '70-质量检查'))) {
  console.log('[跳过] 未找到 20-测试内容/ 或 70-质量检查/（公开仓库不含私有源目录）。');
  console.log('       本脚本只在完整项目内可用；答题、计分、结果页不依赖它。');
  process.exit(0);
}

const sha16 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
const sha256File = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---------- 与 版本快照.js 完全相同的规范化算法 ----------
function fingerprints(db) {
  const qs = db.questions || [];
  const normQuestions = JSON.stringify(qs.map(q => ({
    id: q.id, dim: q.dim, text: q.text,
    options: (q.options || []).map(o => ({ oid: o.option_id, t: o.text, s: o.score }))
  })));
  const normScoring = JSON.stringify(db.scoring || {});
  return { questions: sha16(normQuestions), scoring: sha16(normScoring) };
}

const VERSION_KEYS = ['product_id', 'question_version', 'scoring_version', 'algorithm_version', 'result_content_version'];
const DIMS = ['W', 'L', 'M', 'C', 'G'];

const errs = [];
const ok = [];

// ---------- 0. 文件存在 ----------
for (const [label, p] of [['项目题库', SRC], ['仓库题库', COPY], ['版本快照', SNAP]]) {
  if (!fs.existsSync(p)) { errs.push(label + ' 不存在：' + p); }
}
if (errs.length) {
  console.log('❌ 前置文件缺失，无法继续：');
  errs.forEach(e => console.log('  - ' + e));
  process.exit(1);
}

const srcBuf = fs.readFileSync(SRC);
const copyBuf = fs.readFileSync(COPY);
const srcText = srcBuf.toString('utf8');
const copyText = copyBuf.toString('utf8');
const srcDb = JSON.parse(srcText);
const copyDb = JSON.parse(copyText);
const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));

// ---------- 1. 整文件字节一致（「原样复制」的最强证明） ----------
const hSrc = sha256File(srcBuf), hCopy = sha256File(copyBuf);
if (hSrc !== hCopy) {
  errs.push('两份题库字节不一致：项目 ' + hSrc.slice(0, 16) + '… / 仓库 ' + hCopy.slice(0, 16) + '…（' + srcBuf.length + ' B vs ' + copyBuf.length + ' B）');
} else {
  ok.push('整文件字节一致（sha256 ' + hSrc.slice(0, 16) + '…，' + srcBuf.length + ' B）—— 未裁剪、未重排、未改字段');
}

// ---------- 2. 三方指纹一致 ----------
const fpSrc = fingerprints(srcDb);
const fpCopy = fingerprints(copyDb);
const fpSnap = snap['指纹'] || {};

for (const key of ['questions', 'scoring']) {
  const label = key === 'questions' ? '题目+选项+分值' : 'scoring 规则';
  if (fpSrc[key] !== fpCopy[key]) {
    errs.push(label + ' 指纹不一致：项目 ' + fpSrc[key] + ' / 仓库 ' + fpCopy[key]);
  } else if (fpSrc[key] !== fpSnap[key]) {
    errs.push(label + ' 指纹与版本快照不一致：项目 ' + fpSrc[key] + ' / 快照 ' + fpSnap[key]
      + '（说明题库改过但没跑 版本快照.js --update，或快照过期）');
  } else {
    ok.push('「' + label + '」三方指纹一致：' + fpSrc[key]);
  }
}

// ---------- 3. 版本号三方一致 ----------
const srcVer = (srcDb.meta && srcDb.meta['数据版本']) || {};
const copyVer = (copyDb.meta && copyDb.meta['数据版本']) || {};
for (const k of VERSION_KEYS) {
  if (!srcVer[k]) { errs.push('项目题库 meta.数据版本 缺字段：' + k); continue; }
  if (copyVer[k] !== srcVer[k]) errs.push('仓库题库版本号与项目不一致：' + k + '（' + copyVer[k] + ' vs ' + srcVer[k] + '）');
  if (snap['版本'] && snap['版本'][k] !== srcVer[k]) errs.push('版本快照与项目题库不一致：' + k + '（快照 ' + (snap['版本'] || {})[k] + ' / 题库 ' + srcVer[k] + '）');
}
if (!errs.some(e => e.indexOf('版本号') >= 0 || e.indexOf('版本快照与项目题库') >= 0)) {
  ok.push('5 个版本号三方一致：' + VERSION_KEYS.map(k => k + '=' + srcVer[k]).join(' / '));
}

// ---------- 4. 仓库题库结构完整性（20 题 / 80 选项 / option_id 与 score 绑定） ----------
(function structure() {
  const qs = copyDb.questions || [];
  const localErrs = [];
  if (qs.length !== 20) localErrs.push('题数不是 20：' + qs.length);
  if (!copyDb.meta || !copyDb.meta['题量'] || copyDb.meta['题量']['总计'] !== 20) localErrs.push('meta.题量.总计 不是 20');

  const ids = new Set(), dimCount = { W: 0, L: 0, M: 0, C: 0, G: 0 };
  const oids = [];
  for (const q of qs) {
    if (ids.has(q.id)) localErrs.push('题号重复：' + q.id);
    ids.add(q.id);
    if (!(q.dim in dimCount)) localErrs.push('未知维度：' + q.id + ' / ' + q.dim); else dimCount[q.dim]++;
    if (!Array.isArray(q.options) || q.options.length !== 4) { localErrs.push('选项数不是 4：' + q.id); continue; }
    const scores = q.options.map(o => o.score).slice().sort((a, b) => a - b);
    if (JSON.stringify(scores) !== JSON.stringify([1, 2, 3, 4])) localErrs.push('分值不是 1/2/3/4 各一次：' + q.id);
    for (const o of q.options) {
      oids.push(o.option_id);
      if (!/^Q\d{2}-O[1-4]$/.test(o.option_id || '')) localErrs.push('option_id 格式不合规：' + q.id + ' → ' + o.option_id);
      if (!String(o.option_id || '').startsWith(q.id + '-')) localErrs.push('option_id 前缀与题号不符：' + o.option_id);
      if (!Number.isInteger(o.score) || o.score < 1 || o.score > 4) localErrs.push('score 非 1–4 整数：' + o.option_id);
    }
  }
  for (const d of DIMS) if (dimCount[d] !== 4) localErrs.push('维度 ' + d + ' 题数不是 4：' + dimCount[d]);
  if (oids.length !== 80) localErrs.push('选项总数不是 80：' + oids.length);
  if (new Set(oids).size !== oids.length) localErrs.push('option_id 有重复');

  // 「分值绑定 option_id」的结构证明：option_id 与 score 一一配对，且 score 与选项在数组中的位置无关
  const byPos = qs.every(q => q.options.every((o, i) => o.option_id.endsWith('-O' + (i + 1))));
  if (!byPos) localErrs.push('存在 option_id 序号与数组位置不一致的题（不影响计分，但需人工确认）');

  if (localErrs.length) localErrs.forEach(e => errs.push('结构：' + e));
  else ok.push('仓库题库结构：20 题 / 每维 4 题 / 每题 4 选项 / 80 个 option_id 唯一且格式合规 / 每题分值 1,2,3,4 各一次');
})();

// ---------- 5. 仓库内不得混入不应发布的文件 ----------
(function forbidden() {
  const bad = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (/\.bak|归档|质量报告|计分表|测试记录|压力测试结果|重测稳定性结果|版本快照/i.test(name)) bad.push(path.relative(REPO_ROOT, p));
    }
  };
  walk(REPO_ROOT);
  if (bad.length) bad.forEach(b => errs.push('仓库内不应存在的文件：' + b));
  else ok.push('仓库内未混入 .bak / 归档旧版 / 计分表 / 内部质量报告');
})();

// ---------- 输出 ----------
console.log('==== 题库同步校验（' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '）====');
console.log('项目题库 ' + SRC);
console.log('仓库题库 ' + COPY);
console.log('版本快照 ' + SNAP + '（生成于 ' + snap['生成时间'] + '）');
console.log('');
ok.forEach(s => console.log('  ✅ ' + s));
if (errs.length) {
  errs.forEach(s => console.log('  ❌ ' + s));
  console.log('---- 失败 ' + errs.length + ' 项 ----');
  process.exit(1);
}
console.log('---- 全部通过 ----');
