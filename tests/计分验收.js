// tests/计分验收.js
// 目的：证明 js/scoring.js（网页版）与 70-质量检查/计算核心.js（母版）行为完全一致，
//       并覆盖本次任务书第四节要求的 8 类验收。
//
// 用法（在仓库根目录下）：
//   node "30-网页产品/web-v1/tests/计分验收.js"
// 退出码 0 = 全部通过；1 = 有失败项。
//
// 说明：
//   - 只读。不写任何项目文件（浏览器测试用临时 profile 目录，跑完即删）。
//   - E2/E9 会真跑 371,293 组（约 1–3 秒）；E9 会拉起本机 Edge 无头浏览器，找不到浏览器时记为「跳过」而非「通过」。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const WEB_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(WEB_ROOT, '..', '..');
// 母版（唯一算法标准）的定位：
//   完整项目里 → 项目根的 70-质量检查/计算核心.js（活文件，跟着项目走）
//   公开仓库里 → 随仓库附带的 tests/参考实现/计算核心.js（与母版同一份，逐字节相同）
// 之所以两处并存，是为了让「网页版 ↔ 母版」的对账在克隆下来的仓库里也能自己跑一遍。
const MOTHER_PRIVATE = path.join(PROJECT_ROOT, '70-质量检查', '计算核心.js');
const MOTHER_BUNDLED = path.join(WEB_ROOT, 'tests', '参考实现', '计算核心.js');
const MOTHER_PATH = fs.existsSync(MOTHER_PRIVATE) ? MOTHER_PRIVATE : MOTHER_BUNDLED;

const M = require(MOTHER_PATH);              // 母版（唯一算法标准）
const S = require(path.join(WEB_ROOT, 'js', 'scoring.js'));  // 网页版
const bank = JSON.parse(fs.readFileSync(path.join(WEB_ROOT, 'data', '题库.json'), 'utf8'));
const contentJson = JSON.parse(fs.readFileSync(path.join(WEB_ROOT, 'data', '结果文案.json'), 'utf8'));

const DIMS = ['W', 'L', 'M', 'C', 'G'];
const results = [];
const ck = (id, name, pass, detail) => results.push({ id, name, pass: !!pass, detail: detail || '' });
const r1 = (x) => Math.round(x * 10) / 10;

// 把 20 个分值数组换成 20 个 option_id（按 score 反查，每题 1/2/3/4 各一次 → 唯一解）
function answersFromScores(bank, scoreArr) {
  const out = {};
  bank.questions.forEach((q, i) => {
    const hit = q.options.filter(o => o.score === scoreArr[i]);
    if (hit.length !== 1) throw new Error(q.id + ' 上分值为 ' + scoreArr[i] + ' 的选项有 ' + hit.length + ' 个，无法唯一反查');
    out[q.id] = hit[0].option_id;
  });
  return out;
}
// 维度总分 → 20 个分值（每维 4 题，和为该维总分）
function expand(sum) {
  const o = [1, 1, 1, 1];
  let e = sum - 4, j = 0;
  while (e > 0) { if (o[j] < 4) { o[j]++; e--; } j = (j + 1) % 4; }
  return o;
}
const dimMap = bank.questions.map(q => q.dim);

// ============================================================
// E0 前置：版本号来源一致（题库 vs 母版）
// ============================================================
(function E0() {
  const vBank = S.versionsFromBank(bank);
  const keys = Object.keys(M.VERSIONS);
  const bad = keys.filter(k => vBank[k] !== M.VERSIONS[k]);
  ck('E0', '题库 meta.数据版本 与母版 VERSIONS 逐字段一致（证明版本号可从题库读且未漂移）', !bad.length,
    bad.length ? bad.map(k => k + '：题库 ' + vBank[k] + ' / 母版 ' + M.VERSIONS[k]).join('；')
      : keys.map(k => k + '=' + vBank[k]).join(' / '));
})();

// ============================================================
// E1 两个原有手算案例：走「option_id → 计分」完整链路，8 项输出逐项比对
// ============================================================
(function E1() {
  const cases = bank['端到端用例'].slice(0, 2);
  const bad = [];
  const lines = [];
  for (const c of cases) {
    const answers = answersFromScores(bank, c.作答);
    const got = S.scoreBank(bank, answers);   // 网页版：题库 + option_id → 结果
    const exp = c.预期;
    const g = {
      维度总分: DIMS.map(d => got.dimSums[d]),
      五维指数: DIMS.map(d => r1(got.dims[d])),
      A: r1(got.A), R: r1(got.R),
      物种: got.species, 整体状态: got.overallLevel,
      副称号维度: got.subTitleDim, 副称号: got.subTitle
    };
    const diff = Object.keys(exp).filter(k => JSON.stringify(exp[k]) !== JSON.stringify(g[k]));
    if (diff.length) bad.push(c.名称 + '：' + diff.map(k => k + ' 预期 ' + JSON.stringify(exp[k]) + ' 实得 ' + JSON.stringify(g[k])).join('；'));
    // 同时与母版直接比一次（同一组 option_id 反查出的分值）
    const mother = M.classifyAnswers(c.作答, dimMap);
    if (JSON.stringify(mother) !== JSON.stringify(got)) bad.push(c.名称 + '：网页版与母版结果对象不一致');
    lines.push(c.名称 + ' → ' + g.物种 + '/' + g.整体状态 + '/' + g.副称号 + '（A=' + g.A + ', R=' + g.R + '，维度总分 ' + g.维度总分.join(',') + '）');
  }
  ck('E1', '两个手算案例（示例 A 水豚路径 / 示例 B 狐狸路径）8 项输出逐项相等', !bad.length,
    bad.length ? bad.join('；') : lines.join('｜'));
})();

// ============================================================
// E2 13^5 全穷举：371,293 组，网页版 vs 母版 逐组比对完整结果对象
// ============================================================
let exhaustive = { n: 0, diff: 0, sample: '', species: {} };
(function E2() {
  const versions = S.versionsFromBank(bank);
  const t0 = Date.now();
  for (let a = 4; a <= 16; a++) for (let b = 4; b <= 16; b++) for (let c = 4; c <= 16; c++) for (let d = 4; d <= 16; d++) for (let e = 4; e <= 16; e++) {
    const scores = expand(a).concat(expand(b), expand(c), expand(d), expand(e));
    const mine = S.classifyAnswers(scores, dimMap, versions);
    const mother = M.classifyAnswers(scores, dimMap);
    exhaustive.n++;
    exhaustive.species[mine.species] = (exhaustive.species[mine.species] || 0) + 1;
    if (JSON.stringify(mine) !== JSON.stringify(mother)) {
      exhaustive.diff++;
      if (!exhaustive.sample) exhaustive.sample = '[' + [a, b, c, d, e].join(',') + '] 网页 ' + mine.species + '/' + mine.overallLevel + ' vs 母版 ' + mother.species + '/' + mother.overallLevel;
    }
  }
  const ms = Date.now() - t0;
  ck('E2', '13^5 = 371,293 组五维组合，网页版与母版逐组结果完全一致', exhaustive.n === 371293 && exhaustive.diff === 0,
    exhaustive.n.toLocaleString() + ' 组，不一致 ' + exhaustive.diff + ' 组（' + ms + ' ms）'
    + (exhaustive.sample ? '｜首例 ' + exhaustive.sample : '')
    + '｜物种分布 ' + Object.entries(exhaustive.species).map(([k, v]) => k + ' ' + (v / exhaustive.n * 100).toFixed(1) + '%').join(' / '));
})();

// ============================================================
// E3 物种并列边界
// ============================================================
(function E3() {
  const bad = [];
  // ① 三物种并列（树懒/狐狸/企鹅 匹配分均 120）→ 直接按固定优先级取树懒，tieCandidates 3 个
  const t1 = S.classifySums({ W: 10, L: 10, M: 10, C: 14, G: 10 });
  if (t1.species !== '树懒') bad.push('三并列应为树懒，实得 ' + t1.species);
  if (!t1.tieCandidates || t1.tieCandidates.length !== 3) bad.push('三并列 tieCandidates 应为 3 个，实得 ' + JSON.stringify(t1.tieCandidates));
  // ② 树懒 + 炸毛猫 并列（L = C）→ 树懒
  const t2 = S.classifySums({ W: 4, L: 4, M: 10, C: 4, G: 13 });
  if (t2.species !== '树懒') bad.push('树懒+炸毛猫并列应为树懒，实得 ' + t2.species);
  if (!/树懒\+炸毛猫/.test(t2.tieRule || '')) bad.push('tieRule 未记录树懒+炸毛猫并列：' + t2.tieRule);
  // ③ 狐狸 + 企鹅 并列且 (W+G) == (L+M) → 狐狸
  const t3 = S.classifyIndices({ W: 100, L: 100, M: 0, C: 100, G: 0 });
  if (t3.species !== '狐狸') bad.push('狐狸+企鹅等分应为狐狸，实得 ' + t3.species);
  // ④ 五维全 0：树懒/炸毛猫并列且 L=C，且绝不能判水豚
  const t4 = S.classifySums({ W: 4, L: 4, M: 4, C: 4, G: 4 });
  if (t4.species !== '树懒') bad.push('全 0 应为树懒，实得 ' + t4.species);
  if (t4.level !== '需要回血') bad.push('全 0 状态应为需要回血，实得 ' + t4.level);
  ck('E3', '物种并列：三并列→树懒 / 树懒+炸毛猫→树懒 / 狐狸+企鹅等分→狐狸 / 全 0→树懒且非水豚', !bad.length, bad.join('；'));
})();

// ============================================================
// E4 整体状态与阈值边界（精确命中，不落错档）
// ============================================================
(function E4() {
  const cases = [
    ['A=40 精确命中', { W: 8, L: 9, M: 9, C: 9, G: 9 }, null, '勉强维持'],
    ['A=50 且 R=25 精确命中', { W: 13, L: 10, M: 13, C: 10, G: 13 }, '水豚', '基本在线'],
    ['A=60 精确命中', { W: 11, L: 11, M: 11, C: 11, G: 12 }, null, '基本在线'],
    ['A=75 精确命中', { W: 13, L: 13, M: 13, C: 13, G: 13 }, null, '状态不错'],
    ['R=33.3 不判水豚', { W: 14, L: 10, M: 14, C: 10, G: 14 }, null, null],
    ['全 1 分（五维全 0）', { W: 4, L: 4, M: 4, C: 4, G: 4 }, '树懒', '需要回血'],
    ['全 4 分（五维全 100）', { W: 16, L: 16, M: 16, C: 16, G: 16 }, '水豚', '状态不错'],
    ['A=50 但 R>25 不判水豚', { W: 16, L: 4, M: 16, C: 4, G: 10 }, null, null]
  ];
  const bad = [];
  const lines = [];
  for (const [name, sums, sp, lv] of cases) {
    const r = S.classifySums(sums);
    const mo = M.classifySums(sums);
    if (sp && r.species !== sp) bad.push(name + ' 物种应为 ' + sp + '，实得 ' + r.species);
    if (lv && r.level !== lv) bad.push(name + ' 状态应为 ' + lv + '，实得 ' + r.level);
    if (r.species !== mo.species || r.level !== mo.level) bad.push(name + ' 与母版不一致');
    lines.push(name + '→' + r.species + '/' + r.level + '(A=' + r1(r.A) + ',R=' + r1(r.R) + ')');
  }
  // 「A=50 但 R>25」必须不是水豚
  const deep = S.classifySums({ W: 16, L: 4, M: 16, C: 4, G: 10 });
  if (deep.species === '水豚') bad.push('A=50 但 R=100 时被误判为水豚');
  ck('E4', '整体状态四档边界 + 水豚门槛（A≥50 且 R≤25）精确命中', !bad.length, bad.length ? bad.join('；') : lines.join('｜'));
})();

// ============================================================
// E5 副称号：四处边界（p=4/5/8/9）+ 并列规则
// ============================================================
(function E5() {
  const bad = [];
  const band = (p, level) => {
    const t = S.subTitleOf(p, level, DIMS.reduce((a, d) => a + p[d], 0));
    return t.band + '/' + t.dim + '/' + t.title;
  };
  // 低档边界：p = 4 → low；p = 5 → mid（需要回血档取最低分维度）
  if (band({ W: 4, L: 12, M: 12, C: 12, G: 12 }, '需要回血') !== 'low/W/月光守门员') bad.push('p=4 应落低档，实得 ' + band({ W: 4, L: 12, M: 12, C: 12, G: 12 }, '需要回血'));
  if (band({ W: 5, L: 12, M: 12, C: 12, G: 12 }, '需要回血') !== 'mid/W/精打细算选手') bad.push('p=5 应落中档，实得 ' + band({ W: 5, L: 12, M: 12, C: 12, G: 12 }, '需要回血'));
  // 高档边界：p = 8 → mid；p = 9 → high（状态不错档取最高分维度）
  if (band({ W: 8, L: 0, M: 0, C: 0, G: 0 }, '状态不错') !== 'mid/W/精打细算选手') bad.push('p=8 应落中档，实得 ' + band({ W: 8, L: 0, M: 0, C: 0, G: 0 }, '状态不错'));
  if (band({ W: 9, L: 0, M: 0, C: 0, G: 0 }, '状态不错') !== 'high/W/存款小管家') bad.push('p=9 应落高档，实得 ' + band({ W: 9, L: 0, M: 0, C: 0, G: 0 }, '状态不错'));

  // 需要回血：取最低分维度，并列取 W
  const s1 = S.classifyIndices({ W: 0, L: 0, M: 0, C: 0, G: 0 });
  if (s1.subTitleDim !== 'W' || s1.subTitle !== '月光守门员') bad.push('全 0 副称号应为 W/月光守门员，实得 ' + s1.subTitleDim + '/' + s1.subTitle);
  // 状态不错：取最高分维度，并列取 W
  const s2 = S.classifyIndices({ W: 100, L: 100, M: 100, C: 100, G: 100 });
  if (s2.subTitleDim !== 'W' || s2.subTitle !== '存款小管家') bad.push('全 100 副称号应为 W/存款小管家，实得 ' + s2.subTitleDim + '/' + s2.subTitle);
  // 中间档：绝对偏离最大；M 与 G 偏离并列 → M（回归用例第 10 条）
  const s3 = S.classifyIndices({ W: 100, L: 100, M: 0, C: 100, G: 0 });
  if (s3.subTitle !== '脑内弹幕发射器') bad.push('M/G 偏离并列应取 M（脑内弹幕发射器），实得 ' + s3.subTitle);
  // 反向验证：若误写成「平均分 − 维度分」（不加绝对值），低分维度会永远胜出 → 用一例专门打死这个写法
  const sums4 = { W: 16, L: 15, M: 14, C: 5, G: 13 };
  const scores4 = expand(sums4.W).concat(expand(sums4.L), expand(sums4.M), expand(sums4.C), expand(sums4.G));
  const s4 = S.classifyAnswers(scores4, dimMap);
  const p4 = S.classifySums(sums4).p;
  const sumP4 = DIMS.reduce((a, x) => a + p4[x], 0);
  const absMax = Math.max.apply(null, DIMS.map(d => Math.abs(5 * p4[d] - sumP4)));
  const naiveMax = Math.max.apply(null, DIMS.map(d => 5 * p4[d] - sumP4));   // 错误写法：不带绝对值
  const expectDim = DIMS.filter(d => Math.abs(5 * p4[d] - sumP4) === absMax)[0];
  const naiveDim = DIMS.filter(d => 5 * p4[d] - sumP4 === naiveMax)[0];
  if (s4.subTitleDim !== expectDim) bad.push('绝对偏离最大维度应为 ' + expectDim + '，实得 ' + s4.subTitleDim);
  if (naiveDim === expectDim) bad.push('这一例无法区分「绝对偏离」与「平均分−维度分」，测试用例无效');

  ck('E5', '副称号：p=4/5/8/9 档位边界 + 最低/最高/绝对偏离规则 + 并列取 W→L→M→C→G', !bad.length, bad.join('；'));
})();

// ============================================================
// E6 选项乱序后计分不变（按 option_id 取分，2,000 轮）
// ============================================================
(function E6() {
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const rnd = mulberry32(20261106);
  let bad = 0, firstBad = '';
  for (let round = 0; round < 2000; round++) {
    const answers = {}, scoresFixed = [];
    for (const q of bank.questions) {
      const disp = q.options.slice();
      for (let i = disp.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); const t = disp[i]; disp[i] = disp[k]; disp[k] = t; }
      const pick = disp[Math.floor(rnd() * disp.length)];   // 打乱后随便点一个
      answers[q.id] = pick.option_id;                       // 提交的是 option_id
      scoresFixed.push(pick.score);                         // 独立算出分值用于对账
    }
    const web = S.scoreBank(bank, answers);
    const mother = M.classifyAnswers(scoresFixed, dimMap);
    if (JSON.stringify(web) !== JSON.stringify(mother)) { bad++; if (!firstBad) firstBad = '第 ' + round + ' 轮不一致'; }
    // 把选项顺序再打乱一次、同样这 20 个 option_id，结果必须一模一样
    const again = S.scoreBank(bank, answers);
    if (JSON.stringify(web) !== JSON.stringify(again)) { bad++; if (!firstBad) firstBad = '第 ' + round + ' 轮重算不一致'; }
  }
  ck('E6', '选项乱序 2,000 轮：按 option_id 取分，结果与母版一致且重算不变', bad === 0, bad ? firstBad + '（共 ' + bad + ' 次）' : '2,000 轮 0 异常');
})();

// ============================================================
// E7 缺答案 / 非法输入必须拒绝出结果
// ============================================================
(function E7() {
  const bad = [];
  const expect = (fn, code, name) => {
    try { fn(); bad.push(name + ' 未抛错（应抛 ' + code + '）'); }
    catch (e) { if (e.code !== code) bad.push(name + ' 抛错码为 ' + e.code + '，应为 ' + code); }
  };
  const full = answersFromScores(bank, bank['端到端用例'][0].作答);

  // 缺 1 题
  const short = { ...full };
  delete short['Q07'];
  try { S.scoreBank(bank, short); bad.push('缺 1 题仍生成了结果'); }
  catch (e) {
    if (e.code !== 'INCOMPLETE') bad.push('缺 1 题错误码应为 INCOMPLETE，实得 ' + e.code);
    if (e.remaining !== 1) bad.push('缺 1 题时 remaining 应为 1，实得 ' + e.remaining);
    if (!/还有 1 题没答/.test(e.message)) bad.push('缺 1 题提示文案不对：' + e.message);
  }
  // 缺 5 题
  const short5 = { ...full };
  ['Q01', 'Q05', 'Q09', 'Q13', 'Q17'].forEach(k => delete short5[k]);
  try { S.scoreBank(bank, short5); bad.push('缺 5 题仍生成了结果'); }
  catch (e) { if (e.remaining !== 5) bad.push('缺 5 题时 remaining 应为 5，实得 ' + e.remaining); }
  // 空作答
  expect(() => S.scoreBank(bank, {}), 'INCOMPLETE', '空对象');
  expect(() => S.scoreBank(bank, null), 'INCOMPLETE', 'null');
  // 不存在的 option_id
  expect(() => S.scoreBank(bank, { ...full, Q03: 'Q03-O9' }), 'BAD_ANSWER', '非法 option_id');
  expect(() => S.scoreBank(bank, { ...full, Q03: 'C' }), 'BAD_ANSWER', '提交字母 C');
  // 分值非法
  expect(() => M.classifyAnswers([5, ...bank['端到端用例'][0].作答.slice(1)], dimMap), 'BAD_ANSWER', '分值 5');
  expect(() => M.classifyAnswers([2.5, ...bank['端到端用例'][0].作答.slice(1)], dimMap), 'BAD_ANSWER', '分值 2.5');
  expect(() => M.classifyAnswers([0, ...bank['端到端用例'][0].作答.slice(1)], dimMap), 'BAD_ANSWER', '分值 0');
  // 只答 19 题走底层函数
  expect(() => M.classifyAnswers(bank['端到端用例'][0].作答.slice(0, 19), dimMap), 'INCOMPLETE', '底层只给 19 题');
  // 指数越界 / 不在 13 档格点
  expect(() => M.classifyIndices({ W: 101, L: 50, M: 50, C: 50, G: 50 }), 'BAD_INPUT', '指数 101');
  expect(() => M.classifyIndices({ W: 37.2, L: 50, M: 50, C: 50, G: 50 }), 'NOT_GRID', '指数 37.2 非格点');
  expect(() => S.classifyIndices({ W: 37.2, L: 50, M: 50, C: 50, G: 50 }), 'NOT_GRID', '网页版指数 37.2 非格点');
  // 维度总分越界
  expect(() => S.classifySums({ W: 17, L: 4, M: 4, C: 4, G: 4 }), 'BAD_INPUT', '维度总分 17');
  // 题库结构异常
  expect(() => S.scoreBank({ questions: [] }, full), 'BAD_INPUT', '题库只有 0 题');

  ck('E7', '缺答案 / 非法 option_id / 非法分值 / 非格点指数 一律拒绝出结果，错误码正确', !bad.length, bad.join('；'));
})();

// ============================================================
// E8 相同答案重复计算 200 次完全一致（无随机、无时间、无网络）
// ============================================================
(function E8() {
  const answers = answersFromScores(bank, bank['端到端用例'][1].作答);
  const first = JSON.stringify(S.scoreBank(bank, answers));
  let diff = 0;
  for (let i = 0; i < 200; i++) if (JSON.stringify(S.scoreBank(bank, answers)) !== first) diff++;
  ck('E8', '同一组 option_id 重复 200 次，结果对象逐字节一致', diff === 0, diff ? diff + ' 次不一致' : '200 次全部一致');
})();

// ============================================================
// E9 真浏览器（Edge 无头 / Chromium）与母版逐组一致
// ============================================================
(function E9() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  const exe = candidates.filter(p => fs.existsSync(p))[0];
  const page = path.join(WEB_ROOT, 'tests', '浏览器一致性.html');
  if (!exe) {
    ck('E9', '真浏览器与母版一致', false, '【跳过】本机未找到 Edge/Chrome，无法真浏览器验证（不计为通过）');
    return;
  }
  let dom = '';
  const prof = path.join(os.tmpdir(), 'wb_scoring_' + Date.now());
  try {
    dom = execFileSync(exe, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + prof, '--virtual-time-budget=30000', '--dump-dom',
      'file:///' + page.replace(/\\/g, '/')
    ], { encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    ck('E9', '真浏览器与母版一致', false, '浏览器启动失败：' + (e.message || '').slice(0, 120));
    return;
  } finally {
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (_) { }
  }
  const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
  if (!m) { ck('E9', '真浏览器与母版一致', false, '页面未输出结果（可能脚本报错）'); return; }
  let got;
  try { got = JSON.parse(m[1]); } catch (e) { ck('E9', '真浏览器与母版一致', false, '输出不是合法 JSON'); return; }
  if (!got.loaded) { ck('E9', '真浏览器与母版一致', false, 'UMD 未挂到 window：' + (got.error || '')); return; }

  // Node 侧用母版跑同样 371,293 组，算同样的两个哈希
  let h1 = 0x811c9dc5, h2 = 5381, sumA = 0, n = 0;
  const mix = (s) => { for (let i = 0; i < s.length; i++) { h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 0x01000193) >>> 0; h2 = (Math.imul(h2, 33) + s.charCodeAt(i)) >>> 0; } };
  for (let a = 4; a <= 16; a++) for (let b = 4; b <= 16; b++) for (let c = 4; c <= 16; c++) for (let d = 4; d <= 16; d++) for (let e = 4; e <= 16; e++) {
    const scores = expand(a).concat(expand(b), expand(c), expand(d), expand(e));
    const r = M.classifyAnswers(scores, dimMap);
    mix(r.species + '|' + r.overallLevel + '|' + r.subTitleDim + '|' + r.subTitleBand + '|' + r.A + '|' + r.R + '|' + r.dimSums.W);
    sumA += r.A; n++;
  }
  const bad = [];
  if (got.cases !== n) bad.push('浏览器组数 ' + got.cases + ' ≠ Node ' + n);
  if (got.fnv !== (h1 >>> 0)) bad.push('FNV 哈希不一致：浏览器 ' + got.fnv + ' / Node ' + (h1 >>> 0));
  if (got.djb2 !== (h2 >>> 0)) bad.push('djb2 哈希不一致：浏览器 ' + got.djb2 + ' / Node ' + (h2 >>> 0));
  if (Math.abs(got.sumA - Math.round(sumA * 1000) / 1000) > 1e-6) bad.push('A 值总和不同：浏览器 ' + got.sumA + ' / Node ' + (Math.round(sumA * 1000) / 1000));
  ck('E9', '真浏览器（' + (got.userAgent.match(/Edg\/[\d.]+|Chrome\/[\d.]+/) || [''])[0] + '）加载 scoring.js，371,293 组与母版逐组一致', !bad.length,
    bad.length ? bad.join('；') : '哈希 FNV ' + got.fnv + ' / djb2 ' + got.djb2 + ' / A 总和 ' + got.sumA + ' 两侧完全相同');
})();

// ============================================================
// E10 文案 → 计分的接口自检：20 组合都能在结果文案.json 里查到判词
// ============================================================
(function E10() {
  const bad = [];
  for (const row of contentJson.判词建议) {
    if (!contentJson.索引.按组合键[row.物种 + '|' + row.整体状态]) bad.push('索引缺 ' + row.id);
  }
  for (const s of S.SPECIES_ALL) {
    if (!contentJson.物种[s]) bad.push('文案缺物种 ' + s);
    if (!contentJson.索引.按物种[s]) bad.push('索引缺物种 ' + s);
  }
  for (const d of DIMS) for (const b of ['low', 'mid', 'high']) {
    const zh = { low: '低', mid: '中', high: '高' }[b];
    if (!contentJson.索引.按副称号键[d + '|' + zh]) bad.push('索引缺副称号 ' + d + '|' + zh);
    if (!contentJson.副称号名[d][zh]) bad.push('缺副称号名 ' + d + '|' + zh);
  }
  ck('E10', '计分输出能直接查到文案：20 组合 / 5 物种 / 15 副称号索引齐全', !bad.length, bad.slice(0, 5).join('；'));
})();

// ============================================================
// E11 错误对象与对外接口：改造后仍与母版同构（母版已有 API 一个不少）
// ============================================================
(function E11() {
  const bad = [];
  const grab = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  const e1 = grab(() => M.classifyAnswers([5], dimMap));
  const e2 = grab(() => S.classifyAnswers([5], dimMap));
  if (!e1 || !e2) bad.push('没有抛错');
  else {
    if (e1.code !== e2.code) bad.push('code 不同：' + e1.code + ' / ' + e2.code);
    if (e1.message !== e2.message) bad.push('message 不同：' + e1.message + ' / ' + e2.message);
    if (!(e2 instanceof Error)) bad.push('网页版错误对象不是 Error 实例');
    if (e2.name !== 'ScoreError') bad.push('网页版错误 name 应为 ScoreError，实得 ' + e2.name);
    if (typeof e2.stack !== 'string' || !e2.stack) bad.push('网页版错误缺 stack');
  }
  const missing = Object.keys(M).filter(k => !(k in S));
  if (missing.length) bad.push('网页版缺少母版导出：' + missing.join(','));
  const added = Object.keys(S).filter(k => !(k in M));
  ck('E11', '错误对象与母版同构（code/message/name/instanceof Error）；母版导出一个不少', !bad.length,
    bad.length ? bad.join('；') : '新增导出（适配层）：' + added.join(', '));
})();

// ============================================================
// 输出
// ============================================================
const fail = results.filter(r => !r.pass);
console.log('==== 计分验收（' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '）====');
console.log('网页版 ' + path.join(WEB_ROOT, 'js', 'scoring.js'));
console.log('母版   ' + MOTHER_PATH);
console.log('');
for (const r of results) {
  console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.id + ' ' + r.name + (r.detail ? '\n        ' + r.detail : ''));
}
console.log('');
if (fail.length) {
  console.log('---- ' + (results.length - fail.length) + '/' + results.length + ' 通过，失败 ' + fail.length + ' 项 ----');
  process.exit(1);
}
console.log('---- ' + results.length + ' 项全部通过 ----');
