/**
 * W04 联调验收：题库.json + 结果文案.json + js/scoring.js 三者能否真正配合
 *
 * 目的：前三项检查各自绿，不代表能拼在一起。
 * 本脚本只用「题库 + 计分模块 + 文案 JSON」，模拟页面要做的事：
 *   20 个 option_id → 结果对象 → 按结果查文案 → 填槽位 → 拼出一份可展示的结果页文本
 * 任何一环取不到，就算失败。
 *
 * 运行：node tests/三者联调.js
 * 只读：不写任何文件。
 */
'use strict';

const path = require('path');
const S = require(path.join(__dirname, '..', 'js', 'scoring.js'));
const B = require(path.join(__dirname, '..', 'data', '题库.json'));
const J = require(path.join(__dirname, '..', 'data', '结果文案.json'));

const DIMS = ['W', 'L', 'M', 'C', 'G'];
let pass = 0, fail = 0;
const details = [];

function ck(no, name, ok, detail) {
  if (ok) { pass++; console.log('  ✅ ' + name + (detail ? '\n       ' + detail : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '\n       ' + detail : '')); console.log('  ❌ [' + no + '] FAILED: ' + name + ' — ' + detail); }
  details.push({ no, name, ok, detail });
}

// ------------------------------------------------------------
// 工具：给定期望的五个维度总分，构造一份合法作答（object: 题号 → option_id）
// 每维 4 题、每题分值 1~4，所以维度总分 4~16 之间的整数都可实现
// ------------------------------------------------------------
function answersFromDimSums(bank, sums) {
  const byDim = {};
  bank.questions.forEach(q => { (byDim[q.dim] = byDim[q.dim] || []).push(q); });
  const ans = {};
  for (const d of DIMS) {
    const qs = byDim[d];
    let rest = sums[d];
    for (let i = 0; i < qs.length; i++) {
      const left = qs.length - i - 1;           // 后面还有几题
      // 当前题可选分值 v，需满足 rest-v ∈ [left*1, left*4]
      const lo = Math.max(1, rest - left * 4);
      const hi = Math.min(4, rest - left * 1);
      const v = i === 0 ? hi : Math.min(hi, rest); // 贪心取满足范围的最大值
      const pick = Math.min(Math.max(v, lo), hi);
      rest -= pick;
      const opt = qs[i].options.find(o => o.score === pick);
      if (!opt) throw new Error('构造失败：' + qs[i].id + ' 没有 ' + pick + ' 分选项');
      ans[qs[i].id] = opt.option_id;
    }
    if (rest !== 0) throw new Error('构造失败：' + d + ' 剩余 ' + rest);
  }
  return ans;
}

// ------------------------------------------------------------
// 工具：结果对象 → 完整文案包（模拟结果页要取的全部字段）
// ------------------------------------------------------------
function resolveCopy(result) {
  const out = {};
  const sp = J.物种[result.species];
  out['物种'] = sp ? sp.称号 : undefined;
  out['结果页台词'] = sp && sp.代表台词 ? sp.代表台词.text : undefined;
  out['卡片台词'] = sp && sp.卡片台词 ? sp.卡片台词.text : undefined;
  const aBand = result.A < 60 ? '低档' : '高档';
  out['优势'] = sp && sp.优势 && sp.优势[aBand] ? sp.优势[aBand].text : undefined;
  out['困境'] = sp && sp.困境 && sp.困境[aBand] ? sp.困境[aBand].text : undefined;
  out['动态解释'] = sp && sp.动态解释模板 ? sp.动态解释模板.text : undefined;

  const comboId = J.索引.按组合键[result.species + '|' + result.overallLevel];
  const combo = comboId ? J.判词建议.find(x => x.id === comboId) : null;
  out['判词'] = combo ? combo.判词.text : undefined;
  out['建议'] = combo ? combo.建议.text : undefined;

  const bandName = Object.keys(J.副称号档位映射).find(k => J.副称号档位映射[k] === result.subTitleBand);
  const stName = J.副称号名[result.subTitleDim] && bandName ? J.副称号名[result.subTitleDim][bandName] : null;
  out['副称号'] = stName ? stName.名称 : undefined;
  out['副称号档'] = bandName;
  const expId = J.索引.按副称号键[result.subTitleDim + '|' + bandName];
  const exp = expId ? J.副称号解释.find(x => x.id === expId) : null;
  out['副称号解释'] = exp ? exp.text : undefined;

  out['声明_通用'] = J.声明['通用'] ? J.声明['通用'].text : undefined;
  out['声明_条件'] = result.overallLevel === '需要回血' && J.声明['需要回血'] ? J.声明['需要回血'].text : '（本档无附加声明）';
  const badge = J.整体状态徽章[result.overallLevel];
  out['徽章'] = badge ? badge.底色 + ' / ' + badge.文字色 : undefined;
  return out;
}

// 槽位填充（页面要做的事）
// N12 已修源文件：结果文案规范.md 四节槽位表已把合并行「{最高维} / {最高分}」拆开，
//      并明确 {最高维} / {最低维} 填「维度名称」（取自二节「文案名」），不填分数。
//      维度名称一律从 J.维度名[dim].文案名 取，不自创；分数只由 {最高分}/{最低分} 提供。
//      下方 T4 的病句回归检查保留，防止将来又退回「83.3 有 83.3 分」。
function fillSlots(text, result) {
  const dims = result.dims;
  const minDim = DIMS.reduce((a, d) => (dims[d] < dims[a] ? d : a), 'W');
  const maxDim = DIMS.reduce((a, d) => (dims[d] > dims[a] ? d : a), 'W');
  const fmt = v => (Math.round(v * 10) / 10).toFixed(1);
  return text
    .replace(/\{最低维\}/g, J.维度名[minDim].文案名)
    .replace(/\{最低分\}/g, fmt(dims[minDim]))
    .replace(/\{最高维\}/g, J.维度名[maxDim].文案名)
    .replace(/\{最高分\}/g, fmt(dims[maxDim]))
    .replace(/\{A\}/g, fmt(result.A))
    .replace(/\{R\}/g, fmt(result.R));
}

console.log('==== 三者联调验收（题库 + 文案 JSON + 计分模块）====');
console.log('题库  ' + path.join(__dirname, '..', 'data', '题库.json'));
console.log('文案  ' + path.join(__dirname, '..', 'data', '结果文案.json'));
console.log('计分  ' + path.join(__dirname, '..', 'js', 'scoring.js'));

// ------------------------------------------------------------
// T1 三份数据的版本互认
// ------------------------------------------------------------
(function t1() {
  const bv = B.meta.数据版本;
  const sv = S.versionsFromBank(B);
  const keys = ['product_id', 'question_version', 'scoring_version', 'algorithm_version', 'result_content_version'];
  const diff = keys.filter(k => bv[k] !== sv[k]);
  const sameContent = J.meta.result_content_version === bv.result_content_version;
  ck(1, 'T1 三份数据版本互认（题库 meta = 计分读出的 = 文案 JSON）',
    !diff.length && sameContent,
    '题库 ' + bv.question_version + ' / 计分 ' + bv.scoring_version + ' / 算法 ' + bv.algorithm_version + ' / 文案 ' + J.meta.result_content_version + (diff.length ? '；不一致字段 ' + diff.join(',') : '') + (sameContent ? '' : '；文案版本与题库不一致'));
})();

// ------------------------------------------------------------
// T2 题库 7 条端到端用例：题库作答 → 计分 → 与题库内预期逐项比对
// ------------------------------------------------------------
(function t2() {
  const cases = B.端到端用例 || [];
  const bad = [];
  cases.forEach(c => {
    const ans = {};
    B.questions.forEach((q, i) => {
      const opt = q.options.find(o => o.score === c.作答[i]);
      if (!opt) { bad.push(c.名称 + ' 第 ' + (i + 1) + ' 题无 ' + c.作答[i] + ' 分选项'); return; }
      ans[q.id] = opt.option_id;
    });
    const r = S.scoreBank(B, ans);
    const e = c.预期;
    if (JSON.stringify(DIMS.map(d => r.dimSums[d])) !== JSON.stringify(e.维度总分)) bad.push(c.名称 + ' 维度总分不符');
    if (r.A_display !== e.A || r.R_display !== e.R) bad.push(c.名称 + ' A/R 不符（实得 ' + r.A_display + '/' + r.R_display + '）');
    if (r.species !== e.物种) bad.push(c.名称 + ' 物种不符（' + r.species + ' ≠ ' + e.物种 + '）');
    if (r.overallLevel !== e.整体状态) bad.push(c.名称 + ' 状态不符（' + r.overallLevel + ' ≠ ' + e.整体状态 + '）');
    if (r.subTitle !== e.副称号) bad.push(c.名称 + ' 副称号不符（' + r.subTitle + ' ≠ ' + e.副称号 + '）');
  });
  ck(2, 'T2 题库 7 条端到端用例走完整链路（option_id → 结果）与预期一致', !bad.length && cases.length === 7,
    cases.length + ' 条用例' + (bad.length ? '；' + bad.slice(0, 5).join('；') : '：维度总分 / A / R / 物种 / 状态 / 副称号 全部命中'));
})();

// ------------------------------------------------------------
// T3 结果对象 → 12 个文案字段全部可解析（含 7 条用例 + 3000 组随机）
// ------------------------------------------------------------
(function t3() {
  const FIELDS = ['物种', '结果页台词', '卡片台词', '优势', '困境', '动态解释', '判词', '建议', '副称号', '副称号解释', '声明_通用', '徽章'];
  const bad = [];
  let n = 0;
  const checkOne = (ans, tag) => {
    const r = S.scoreBank(B, ans);
    const c = resolveCopy(r);
    n++;
    FIELDS.forEach(f => {
      if (typeof c[f] !== 'string' || !c[f].length) bad.push(tag + ' 取不到「' + f + '」（' + r.species + '×' + r.overallLevel + '）');
    });
    if (c['副称号'] !== r.subTitle) bad.push(tag + ' 文案副称号「' + c['副称号'] + '」与计算结果「' + r.subTitle + '」不一致');
  };
  (B.端到端用例 || []).forEach((c) => {
    const ans = {};
    B.questions.forEach((q, i) => { const o = q.options.find(x => x.score === c.作答[i]); if (o) ans[q.id] = o.option_id; });
    checkOne(ans, c.名称);
  });
  for (let i = 0; i < 3000; i++) {
    const ans = {};
    B.questions.forEach(q => { ans[q.id] = q.options[Math.floor(Math.random() * 4)].option_id; });
    checkOne(ans, '随机#' + (i + 1));
  }
  ck(3, 'T3 12 个文案字段在 ' + n + ' 组结果上全部可解析、非空、副称号一致', !bad.length,
    FIELDS.length + ' 个字段 × ' + n + ' 组' + (bad.length ? '；' + bad.slice(0, 4).join('；') : '：0 处取不到'));
})();

// ------------------------------------------------------------
// T4 槽位填充：填完不留花括号，且分数与实际计算一致
// ------------------------------------------------------------
(function t4() {
  const bad = [];
  const texts = [];
  J.判词建议.forEach(x => texts.push(['判词', x.判词.text]));
  J.判词建议.forEach(x => texts.push(['建议', x.建议.text]));
  Object.keys(J.物种).forEach(k => texts.push(['动态解释', J.物种[k].动态解释模板.text]));
  for (let i = 0; i < 300; i++) {
    const sums = {};
    DIMS.forEach(d => { sums[d] = 4 + Math.floor(Math.random() * 13); });
    const r = S.scoreBank(B, answersFromDimSums(B, sums));
    texts.forEach(([kind, t]) => {
      const filled = fillSlots(t, r);
      if (/\{[^}]+\}/.test(filled)) bad.push(kind + ' 填充后仍有槽位：' + filled.slice(0, 40));
      if (/\bNaN\b|undefined/.test(filled)) bad.push(kind + ' 填充出现 NaN/undefined');
      // N12 回归（源文案已修）：若把 {最高维}/{最低维} 误填成分数，会得到「83.3 有 83.3 分」这类病句
      if (/\d+\.\d\s*有\s*\d+\.\d\s*分/.test(filled)) bad.push(kind + ' 出现重复分数病句：' + filled.slice(0, 50));
    });
  }
  const slotSet = ['最低维', '最低分', '最高维', '最高分', 'A', 'R'];
  const undeclared = [];
  texts.forEach(([kind, t]) => {
    (t.match(/\{([^}]+)\}/g) || []).forEach(s => { const k = s.slice(1, -1); if (!slotSet.includes(k)) undeclared.push(kind + ':' + k); });
  });
  ck(4, 'T4 槽位全部可填：300 组结果 × 45 段带槽位文本，填完无残留、无 NaN', !bad.length && !undeclared.length,
    '槽位种类 ' + slotSet.length + ' 个' + (undeclared.length ? '；未定义槽位：' + [...new Set(undeclared)].join(',') : '；全部已定义') + (bad.length ? '；' + bad.slice(0, 3).join('；') : ''));
})();

// ------------------------------------------------------------
// T5 兜底文案不外泄：13^5 全枚举，4 组 reachable=false 的组合命中次数必须为 0
// 注意：classifySums 的状态字段叫 level，classifyAnswers/classifyIndices 叫 overallLevel
//      （与母版一致，此处两种都兼容，避免把字段名差异误判成算法问题）
// ------------------------------------------------------------
(function t5() {
  const lvl = r => r.overallLevel || r.level;
  const fallback = J.判词建议.filter(x => x.reachable === false).map(x => x.物种 + '|' + x.整体状态);
  const hit = {};
  const seen = new Set();
  let total = 0;
  for (let a = 4; a <= 16; a++) for (let b = 4; b <= 16; b++) for (let c = 4; c <= 16; c++) for (let d = 4; d <= 16; d++) for (let e = 4; e <= 16; e++) {
    const r = S.classifySums({ W: a, L: b, M: c, C: d, G: e });
    const k = r.species + '|' + lvl(r);
    seen.add(k);
    total++;
    if (fallback.includes(k)) hit[k] = (hit[k] || 0) + 1;
  }
  const leaked = Object.keys(hit);
  ck(5, 'T5 兜底文案不外泄：13^5 = ' + total.toLocaleString() + ' 组全枚举，4 组兜底组合命中 0 次', !leaked.length && seen.size === 16,
    '实际出现 ' + seen.size + '/20 种物种×状态组合' + (leaked.length ? '；兜底却命中：' + leaked.map(k => k + '×' + hit[k]).join('、') : '；兜底组合一次都没出现'));
})();

// ------------------------------------------------------------
// T6 N10 定向验证：企鹅 × 需要回血 真实可达，且取到的判词不带内部说明
// ------------------------------------------------------------
(function t6() {
  let sample = null;
  outer:
  for (let a = 4; a <= 16; a++) for (let b = 4; b <= 16; b++) for (let c = 4; c <= 16; c++) for (let d = 4; d <= 16; d++) for (let e = 4; e <= 16; e++) {
    const r = S.classifySums({ W: a, L: b, M: c, C: d, G: e });
    const l = r.overallLevel || r.level;
    if (r.species === '企鹅' && l === '需要回血') { sample = { sums: { W: a, L: b, M: c, C: d, G: e }, r }; break outer; }
  }
  if (!sample) { ck(6, 'T6 企鹅 × 需要回血 可达且文案可直接展示', false, '穷举里根本没找到该组合'); return; }
  const ans = answersFromDimSums(B, sample.sums);
  const r = S.scoreBank(B, ans);
  const c = resolveCopy(r);
  const clean = c['判词'] === '边界守住了，但整体电量偏低。'
    && !/结构上不可达|保留兜底/.test(c['判词'])
    && c['卡片台词'] !== undefined
    && J.判词建议.find(x => x.id === '组合_企鹅_需要回血').reachable === true;
  ck(6, 'T6 N10 修正生效：企鹅 × 需要回血 可达，判词已无内部说明，且允许进分享卡片', clean,
    '构造作答（维度总分 W' + sample.sums.W + '/L' + sample.sums.L + '/M' + sample.sums.M + '/C' + sample.sums.C + '/G' + sample.sums.G + '）→ ' + r.species + '×' + r.overallLevel + '，A=' + r.A_display + ' → 判词「' + c['判词'] + '」，reachable=' + J.判词建议.find(x => x.id === '组合_企鹅_需要回血').reachable);
})();

// ------------------------------------------------------------
// T7 两套台词分离：同物种结果页台词与卡片台词各自取自对应字段（水豚已知不同）
// ------------------------------------------------------------
(function t7() {
  const diff = [];
  Object.keys(J.物种).forEach(k => {
    const a = J.物种[k].代表台词.text, b = J.物种[k].卡片台词.text;
    if (a !== b) diff.push(k);
  });
  const r = S.classifySums({ W: 10, L: 10, M: 10, C: 10, G: 10 });
  const c = resolveCopy(r);
  const capybaraOk = c['结果页台词'] === J.物种['水豚'].代表台词.text && c['卡片台词'] === J.物种['水豚'].卡片台词.text;
  ck(7, 'T7 结果页台词与卡片台词分字段独立（文案中 ' + diff.length + ' 个物种两套不同）', capybaraOk,
    '水豚两套' + (diff.includes('水豚') ? '不同' : '相同') + '；结果页「' + c['结果页台词'] + '」/ 卡片「' + c['卡片台词'] + '」');
})();

// ------------------------------------------------------------
// T8 确定性：同一份作答重复 100 次，结果对象 + 文案包逐字节一致
// ------------------------------------------------------------
(function t8() {
  const ans = answersFromDimSums(B, { W: 13, L: 9, M: 14, C: 8, G: 15 });
  const first = JSON.stringify(resolveCopy(S.scoreBank(B, ans)));
  let bad = 0;
  for (let i = 0; i < 100; i++) {
    if (JSON.stringify(resolveCopy(S.scoreBank(B, ans))) !== first) bad++;
  }
  ck(8, 'T8 同一份作答重复 100 次，结果 + 文案逐字节一致', bad === 0, bad + ' 次不一致');
})();

// ------------------------------------------------------------
// T9 缺答案：不能生成结果（页面必须拦住）
// ------------------------------------------------------------
(function t9() {
  const full = answersFromDimSums(B, { W: 10, L: 10, M: 10, C: 10, G: 10 });
  const cases = [
    ['一题没答', {}],
    ['缺 1 题', (() => { const a = Object.assign({}, full); delete a.Q07; return a; })()],
    ['缺 5 题', (() => { const a = Object.assign({}, full); ['Q03','Q08','Q12','Q16','Q20'].forEach(k => delete a[k]); return a; })()],
    ['全是空字符串', (() => { const a = {}; B.questions.forEach(q => a[q.id] = ''); return a; })()],
    ['非法 option_id', (() => { const a = Object.assign({}, full); a.Q01 = 'Q01-O9'; return a; })()],
  ];
  const bad = [];
  cases.forEach(([name, a]) => {
    let r = null, err = null;
    try { r = S.scoreBank(B, a); } catch (e) { err = e; }
    if (r) bad.push(name + ' 竟然出了结果');
    else if (name === '非法 option_id' && err.code !== 'BAD_ANSWER') bad.push(name + ' 错误码应为 BAD_ANSWER，实为 ' + err.code);
    else if (name !== '非法 option_id' && err.code !== 'INCOMPLETE') bad.push(name + ' 错误码应为 INCOMPLETE，实为 ' + err.code);
  });
  ck(9, 'T9 缺答案 / 非法选项一律拒绝出结果，错误码正确（5 种异常）', !bad.length, bad.join('；') || '5 种异常全部被拦下');
})();

// ------------------------------------------------------------
// 输出一份真实可展示的结果页文本（人工肉眼复核用）
// ------------------------------------------------------------
(function sample() {
  const ans = answersFromDimSums(B, { W: 9, L: 13, M: 11, C: 7, G: 14 });
  const r = S.scoreBank(B, ans);
  const c = resolveCopy(r);
  console.log('\n---- 结果页拼装样例（真实输出，未手工修改）----');
  console.log('物种       ' + r.species + '（' + c['物种'] + '）｜' + r.overallLevel + '｜副称号「' + c['副称号'] + '」');
  console.log('五维       ' + DIMS.map(d => d + ' ' + r.dims[d].toFixed(1)).join(' / '));
  console.log('A/R        ' + r.A_display + ' / ' + r.R_display);
  console.log('台词       ' + c['结果页台词']);
  console.log('判词       ' + fillSlots(c['判词'], r));
  console.log('建议       ' + fillSlots(c['建议'], r));
  console.log('动态解释   ' + fillSlots(c['动态解释'], r).replace(/\*\*/g, ''));
  console.log('副称号解释 ' + c['副称号解释']);
  console.log('声明       ' + c['声明_通用'] + (r.overallLevel === '需要回血' ? ' / ' + c['声明_条件'] : ''));
  console.log('卡片台词   ' + c['卡片台词']);
  console.log('徽章       ' + c['徽章']);
})();

console.log('\n---- 汇总：' + pass + ' 通过 / ' + fail + ' 失败 ----');
if (fail) { console.log('存在失败项，不能进入 W05。'); process.exit(1); }
