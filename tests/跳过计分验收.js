// tests/跳过计分验收.js
// 目的：验收「允许跳过题目」这一版计分规则（v1.2 / algorithm v1.1），对应任务书第六节 10 条。
//
// 用法（仓库根目录）：
//   node "30-网页产品/web-v1/tests/跳过计分验收.js"
// 退出码 0 = 全绿；1 = 有失败项。只读，不写任何项目文件。
//
// 为什么要单独一份：
//   13^5 = 371,293 组穷举只覆盖「一维 4 题全答」，没法代表「n=2/n=3/混合」这些新分支，
//   所以这里补的是：全答等价性（新代码 vs 老代码）+ 公式逐组核对 + 组合与边界扫描。
//   公式口径（任务书原文）：index_d = ((S_d - n_d) / (3 × n_d)) × 100
//     S_d = 该维度已回答题目的分数之和，n_d = 该维度有效回答题数；跳过的题不进 S_d、也不进 n_d。
const fs = require('fs');
const path = require('path');

const WEB_ROOT = path.resolve(__dirname, '..');
const S = require(path.join(WEB_ROOT, 'js', 'scoring.js'));
const bank = JSON.parse(fs.readFileSync(path.join(WEB_ROOT, 'data', '题库.json'), 'utf8'));

const DIMS = ['W', 'L', 'M', 'C', 'G'];
const V = S.versionsFromBank(bank);
const results = [];
const ck = (id, name, pass, detail) => results.push({ id, name, pass: !!pass, detail: detail || '' });
const r1 = (x) => Math.round(x * 10) / 10;
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ---------- 题目 ↔ 维度内位置 ----------
const dimMap = bank.questions.map(q => q.dim);
const posInDim = {};                 // qid → 0..3
{
  const c = { W: 0, L: 0, M: 0, C: 0, G: 0 };
  bank.questions.forEach(q => { posInDim[q.id] = c[q.dim]++; });
}
const EXPECT_INDEX = (sum, n) => ((sum - n) / (3 * n)) * 100;
// 把「每维 4 个位置的分值（数字 / null 跳过）」摊成 20 位 marks（按题库顺序）
function marksOf(spec) {
  return bank.questions.map(q => {
    const arr = spec[q.dim];
    const v = arr ? arr[posInDim[q.id]] : 4;
    return (v === null || v === undefined) ? null : v;
  });
}
// 分值 → option_id（每题 1/2/3/4 各一次，唯一解）
function answersOf(marks) {
  const out = {}, skip = {};
  bank.questions.forEach((q, i) => {
    const v = marks[i];
    if (v === null) { skip[q.id] = true; return; }
    const hit = q.options.filter(o => o.score === v);
    if (hit.length !== 1) throw new Error(q.id + ' 分值 ' + v + ' 无法唯一反查');
    out[q.id] = hit[0].option_id;
  });
  return { answers: out, skipped: skip };
}
const fullSpec = (v) => ({ W: [v, v, v, v], L: [v, v, v, v], M: [v, v, v, v], C: [v, v, v, v], G: [v, v, v, v] });
const CORE = ['dims', 'A', 'A_display', 'R', 'R_display', 'species', 'overallLevel', 'subTitleDim', 'subTitleBand', 'subTitle'];

// ============================================================
// S1  20 题全部回答时，结果与原版完全一致（新代码路径 vs 老代码路径，13^5 全穷举）
// ============================================================
(function S1() {
  const t0 = Date.now();
  let n = 0, diff = 0, sample = '';
  const pack = (x) => JSON.stringify(CORE.map(k => x[k]));
  for (let a = 4; a <= 16; a++) for (let b = 4; b <= 16; b++) for (let c = 4; c <= 16; c++) for (let d = 4; d <= 16; d++) for (let e = 4; e <= 16; e++) {
    const sums = [a, b, c, d, e];
    const marks = [];
    sums.forEach(s => {
      const o = [1, 1, 1, 1]; let rest = s - 4, j = 0;
      while (rest > 0) { if (o[j] < 4) { o[j]++; rest--; } j = (j + 1) % 4; }
      marks.push.apply(marks, o);
    });
    const viaFull = S.classifyAnswers(marks, dimMap, V);       // 老路径：必须 20 题全答
    const viaMark = S.classifyMarks(marks, dimMap, V);         // 新路径：20 个位置无 null
    n++;
    if (pack(viaFull) !== pack(viaMark)) { diff++; if (!sample) sample = '[' + sums.join(',') + ']'; }
  }
  ck('S1', '20 题全答：新代码（20 个位置无跳过）与老代码结果逐字段一致，13^5 = 371,293 组',
    n === 371293 && diff === 0,
    n.toLocaleString() + ' 组，不一致 ' + diff + ' 组（' + (Date.now() - t0) + ' ms）' + (sample ? '｜首例 ' + sample : ''));
})();

// ============================================================
// S2  每个维度分别跳过 1 题（4 个位置各试一次）：n=3、S 只算已回答，其它维不受影响
// ============================================================
(function S2() {
  const bad = [], lines = [];
  const base = { W: [4, 3, 2, 1], L: [3, 3, 4, 2], M: [2, 4, 1, 3], C: [4, 4, 4, 1], G: [1, 3, 4, 4] };
  const fullRes = S.classifyMarks(marksOf(base), dimMap, V);
  for (const d of DIMS) {
    for (let p = 0; p < 4; p++) {
      const spec = { W: base.W.slice(), L: base.L.slice(), M: base.M.slice(), C: base.C.slice(), G: base.G.slice() };
      const arr = spec[d].slice();
      const expectS = arr.filter((_, i) => i !== p).reduce((x, y) => x + y, 0);
      arr[p] = null;
      spec[d] = arr;
      const r = S.classifyMarks(marksOf(spec), dimMap, V);
      const want = EXPECT_INDEX(expectS, 3);
      if (!near(r.dims[d], want)) bad.push(d + ' 跳过第 ' + (p + 1) + ' 题：指数 ' + r.dims[d] + '，应为 ' + want.toFixed(4));
      if (r.answerCount[d] !== 3) bad.push(d + ' 跳过 1 题后 answerCount 应为 3，实得 ' + r.answerCount[d]);
      if (r.totalSkipped !== 1) bad.push('totalSkipped 应为 1，实得 ' + r.totalSkipped);
      for (const o of DIMS) {
        if (o === d) continue;
        if (!near(r.dims[o], fullRes.dims[o])) bad.push('跳过 ' + d + ' 的题却影响了 ' + o + ' 维：' + r.dims[o] + ' vs ' + fullRes.dims[o]);
      }
      if (p === 0) lines.push(d + ' 跳第 1 题 → ' + r1(r.dims[d]) + '（S=' + expectS + '，n=3）');
    }
  }
  ck('S2', '每个维度分别跳过 1 题（5×4=20 种）：n=3、指数按已回答重算、其它维不受影响', !bad.length,
    bad.length ? bad.slice(0, 4).join('；') : '20 种全部正确｜' + lines.join(' / '));
})();

// ============================================================
// S3  每个维度分别只回答 2 题：n=2、公式命中、标记为「数据较少」
// ============================================================
(function S3() {
  const bad = [], lines = [];
  const pairs = [[1, 1], [1, 4], [2, 2], [2, 3], [3, 4], [4, 4]];
  for (const d of DIMS) {
    for (const pr of pairs) {
      const spec = fullSpec(4);
      spec[d] = [pr[0], pr[1], null, null];
      const r = S.classifyMarks(marksOf(spec), dimMap, V);
      const want = EXPECT_INDEX(pr[0] + pr[1], 2);
      if (!near(r.dims[d], want)) bad.push(d + ' 答 ' + pr.join('/') + '：指数 ' + r.dims[d] + '，应为 ' + want.toFixed(4));
      if (r.answerCount[d] !== 2) bad.push(d + ' answerCount 应为 2，实得 ' + r.answerCount[d]);
      if (r.thinDims.indexOf(d) < 0) bad.push(d + ' 只答 2 题却没进 thinDims（少数据标记）');
      if (pr[0] === 1 && pr[1] === 1) lines.push(d + ' 只答 2 题各 1 分 → 0（S=2）');
      if (pr[0] === 4 && pr[1] === 4) lines.push(d + ' 只答 2 题各 4 分 → 100（S=8）');
    }
  }
  ck('S3', '每个维度分别只回答 2 题（5×6=30 种）：指数 =(S-2)/(3×2)×100，且被标为数据较少', !bad.length,
    bad.length ? bad.slice(0, 4).join('；') : '30 种全部正确｜' + lines.join(' / '));
})();

// ============================================================
// S4  各维度回答数量不同（2/3/4 混搭）：五维、A、R 全部按新口径
// ============================================================
(function S4() {
  const bad = [], lines = [];
  const patterns = [
    { W: [4, 4, null, null], L: [3, 2, 4, null], M: [2, 2, 2, 2], C: [1, null, null, null /* 见下方替换 */], G: [4, 1, 3, 2] },
    { W: [1, 2, 3, null], L: [4, 4, null, null], M: [3, 3, 3, 3], C: [2, 3, 4, null], G: [4, 4, 4, 4] },
    { W: [2, null, 4, null], L: [1, 1, 1, 1], M: [4, null, 4, null], C: [3, 3, null, 3], G: [2, 2, 4, null] }
  ];
  patterns.forEach((spec, idx) => {
    if (idx === 0) spec.C = [1, 3, null, 4];       // 该维仍保留 3 题，避免与 S6/S7 的拦截混在一起
    const marks = marksOf(spec);
    const r = S.classifyMarks(marks, dimMap, V);
    const idxs = {};
    let sumIdx = 0, mx = -Infinity, mn = Infinity;
    for (const d of DIMS) {
      const arr = spec[d];
      const answered = arr.filter(x => x !== null);
      const want = EXPECT_INDEX(answered.reduce((x, y) => x + y, 0), answered.length);
      idxs[d] = want;
      sumIdx += want; mx = Math.max(mx, want); mn = Math.min(mn, want);
      if (!near(r.dims[d], want)) bad.push('组合' + (idx + 1) + ' ' + d + '：' + r.dims[d] + ' 应为 ' + want.toFixed(4));
      if (r.answerCount[d] !== answered.length) bad.push('组合' + (idx + 1) + ' ' + d + ' answerCount 应为 ' + answered.length);
    }
    if (!near(r.A, sumIdx / 5)) bad.push('组合' + (idx + 1) + ' A=' + r.A + ' 应为 ' + (sumIdx / 5).toFixed(4));
    if (!near(r.R, mx - mn)) bad.push('组合' + (idx + 1) + ' R=' + r.R + ' 应为 ' + (mx - mn).toFixed(4));
    if (S.SPECIES_ALL.indexOf(r.species) < 0) bad.push('组合' + (idx + 1) + ' 物种越界：' + r.species);
    lines.push('组合' + (idx + 1) + ' n=' + DIMS.map(d => r.answerCount[d]).join('/') + ' → ' + r.species + '/' + r.overallLevel + '（A=' + r1(r.A) + ' R=' + r1(r.R) + '）');
  });
  ck('S4', '各维度回答数量不同（2/3/4 混搭）：五维指数 + A + R 全部与公式吻合', !bad.length,
    bad.length ? bad.slice(0, 4).join('；') : lines.join('｜'));
})();

// ============================================================
// S5  跳过题目不产生任何计分：既不记 0 分，也不补中间分
// ============================================================
(function S5() {
  const bad = [];
  const spec = fullSpec(4);
  spec.W = [2, null, null, null];
  // n 必须 ≥2 才允许出结果，所以基线用 2 题
  spec.W = [2, 2, null, null];
  const base = S.classifyMarks(marksOf(spec), dimMap, V);
  if (base.dimSums.W !== 4) bad.push('跳过题的分数进了 dimSums：W 应为 4（2+2），实得 ' + base.dimSums.W);
  if (base.answerCount.W !== 2) bad.push('answerCount.W 应为 2，实得 ' + base.answerCount.W);
  // 把「跳过」换成 1/2/3/4 分，指数必须严格按公式变化（而不是被当成 0 或 1 分补进去）
  const seq = [1, 2, 3, 4];
  for (const v of seq) {
    const sp = { W: [2, 2, v, null], L: spec.L.slice(), M: spec.M.slice(), C: spec.C.slice(), G: spec.G.slice() };
    const r = S.classifyMarks(marksOf(sp), dimMap, V);
    const want = EXPECT_INDEX(4 + v, 3);
    if (!near(r.dims.W, want)) bad.push('把跳过改成 ' + v + ' 分：指数 ' + r.dims.W + ' 应为 ' + want.toFixed(4));
  }
  // 关键反证：若「跳过」被当成 0 分，n=4 时指数会是 (4-4)/12=0；实际必须是 0（两题全 2 分）
  // 换一组更能区分的：两题都 4 分 → 100；若被当成 0 分补满，会变成 (8-4)/12 = 33.3
  const sp2 = fullSpec(4); sp2.W = [4, 4, null, null];
  const r2 = S.classifyMarks(marksOf(sp2), dimMap, V);
  if (!near(r2.dims.W, 100)) bad.push('两题各 4 分、另两题跳过，W 应为 100（不是被 0 分拉低后的 33.3），实得 ' + r2.dims.W);
  // 与「同样两题 + 另两题 2 分」必须不同，证明跳过 ≠ 中间分
  const sp3 = fullSpec(4); sp3.W = [4, 4, 2, 2];
  const r3 = S.classifyMarks(marksOf(sp3), dimMap, V);
  if (near(r2.dims.W, r3.dims.W)) bad.push('跳过与「补 2 分」算出了同一个结果，说明跳过被当成了中间分');
  ck('S5', '跳过不产生任何计分：不加 0 分、不补中间分；dimSums / answerCount 只统计已回答', !bad.length,
    bad.length ? bad.join('；') : 'W=[4,4,跳过,跳过] → ' + r1(r2.dims.W) + '，而 W=[4,4,2,2] → ' + r1(r3.dims.W) + '（两者不同）');
})();

// ============================================================
// S6 / S7  1 题有效 / 0 题有效 → 拒绝生成完整结果
// ============================================================
(function S6() {
  const bad = [];
  for (const d of DIMS) {
    const spec = fullSpec(4); spec[d] = [3, null, null, null];
    let err = null;
    try { S.classifyMarks(marksOf(spec), dimMap, V); } catch (e) { err = e; }
    if (!err) { bad.push(d + ' 只答 1 题仍出了结果'); continue; }
    if (err.code !== 'INSUFFICIENT') bad.push(d + ' 错误码应为 INSUFFICIENT，实得 ' + err.code);
    if (!err.dims || err.dims.length !== 1 || err.dims[0].dim !== d || err.dims[0].need !== 1) bad.push(d + ' 错误信息里的缺口不对：' + JSON.stringify(err.dims));
    if (!/只有 1 题有效回答，还需要 1 题/.test(err.message)) bad.push(d + ' 提示文案不对：' + err.message);
  }
  ck('S6', '一维只有 1 题有效回答（5 种）：拒绝出结果，并说明「还需要 1 题」', !bad.length, bad.length ? bad.slice(0, 3).join('；') : '5 种维度全部拦下');
})();

(function S7() {
  const bad = [];
  for (const d of DIMS) {
    const spec = fullSpec(4); spec[d] = [null, null, null, null];
    let err = null;
    try { S.classifyMarks(marksOf(spec), dimMap, V); } catch (e) { err = e; }
    if (!err) { bad.push(d + ' 一题都没答仍出了结果'); continue; }
    if (err.code !== 'INSUFFICIENT') bad.push(d + ' 错误码应为 INSUFFICIENT，实得 ' + err.code);
    if (!err.dims || err.dims[0].n !== 0 || err.dims[0].need !== 2) bad.push(d + ' 缺口信息不对：' + JSON.stringify(err.dims));
    if (!/没有任何有效回答/.test(err.message)) bad.push(d + ' 提示文案不对：' + err.message);
  }
  // 多维同时不足：错误里要一次列全
  const spec = fullSpec(4); spec.W = [null, null, null, null]; spec.C = [2, null, null, null];
  let err = null;
  try { S.classifyMarks(marksOf(spec), dimMap, V); } catch (e) { err = e; }
  if (!err || !err.dims || err.dims.length !== 2) bad.push('两个维度都不足时，错误对象应一次列全 2 个：' + JSON.stringify(err && err.dims));
  ck('S7', '一维 0 题有效回答（5 种）+ 多维同时不足：拒绝出结果，缺口一次列全', !bad.length, bad.length ? bad.slice(0, 3).join('；') : '5 种 + 双维不足全部拦下');
})();

// ============================================================
// S8  数据结构：已回答（question_id + option_id）/ 已跳过（question_id + status=skipped）严格区分
// ============================================================
(function S8() {
  const bad = [];
  const spec = fullSpec(3); spec.L = [4, null, null, null]; spec.L = [4, 4, null, null];
  const marks = marksOf(spec);
  const { answers, skipped } = answersOf(marks);

  // ① 只给 answers（跳过没传）→ 必须报「没答」，不得把缺失当跳过
  let err = null;
  try { S.scoreBank(bank, answers); } catch (e) { err = e; }
  if (!err || err.code !== 'INCOMPLETE') bad.push('跳过信息没传时应当 INCOMPLETE，实得 ' + (err && err.code));
  else if (err.remaining !== 2) bad.push('应报 2 题没答，实得 ' + err.remaining);

  // ② answers + skipped 一起给 → 出结果，且跳过题不出现在 answers 里
  const r = S.scoreBank(bank, answers, skipped);
  if (!r.partial) bad.push('有跳过时结果对象应带 partial=true');
  if (r.totalSkipped !== 2) bad.push('totalSkipped 应为 2，实得 ' + r.totalSkipped);
  if (r.answerCount.L !== 2) bad.push('answerCount.L 应为 2，实得 ' + r.answerCount.L);
  for (const qid of Object.keys(skipped)) {
    if (answers[qid]) bad.push('跳过的题 ' + qid + ' 同时出现在 answers 里（两种状态必须互斥）');
  }
  // ③ 跳过的题不占 option_id：结果里不该出现任何来自 skipped 题的分值
  const expectL = EXPECT_INDEX(4 + 4, 2);
  if (!near(r.dims.L, expectL)) bad.push('L 维指数 ' + r.dims.L + ' 应为 ' + expectL.toFixed(4));
  // ④ 全答时结果对象不带 partial 字段（保证与 v1.1 逐字节一致）
  const all = answersOf(marksOf(fullSpec(3)));
  const rf = S.scoreBank(bank, all.answers, all.skipped);
  if ('partial' in rf) bad.push('全答时结果对象不该出现 partial 字段');
  if ('answerCount' in rf) bad.push('全答时结果对象不该出现 answerCount 字段');
  ck('S8', '两种状态严格区分：跳过必须显式传；缺失仍报 INCOMPLETE；全答时不追加新字段', !bad.length,
    bad.length ? bad.join('；') : 'INCOMPLETE(2 题) → 带 skipped 后出结果 L=' + r1(r.dims.L) + '（n=2,S=8）');
})();

// ============================================================
// S9  用户修改已跳过题目的状态后，计分正确（跳过→作答 / 作答→跳过 / 反复切换）
// ============================================================
(function S9() {
  const bad = [];
  const spec = fullSpec(3); spec.M = [2, 2, null, null];
  const skippedRes = S.classifyMarks(marksOf(spec), dimMap, V);

  // 跳过 → 作答（补 1 题 4 分）：n=3，指数按 S=8 重算
  const sp2 = fullSpec(3); sp2.M = [2, 2, 4, null];
  const answeredRes = S.classifyMarks(marksOf(sp2), dimMap, V);
  const want = EXPECT_INDEX(8, 3);
  if (!near(answeredRes.dims.M, want)) bad.push('补答后 M 指数 ' + answeredRes.dims.M + ' 应为 ' + want.toFixed(4));
  if (answeredRes.answerCount.M !== 3) bad.push('补答后 answerCount.M 应为 3');

  // 再改回跳过：必须回到与原跳过完全一样的结果（幂等）
  const backRes = S.classifyMarks(marksOf(spec), dimMap, V);
  if (JSON.stringify(backRes) !== JSON.stringify(skippedRes)) bad.push('改回跳过后结果与原来不一致（不幂等）');

  // 作答 → 跳过：原本 4 题全答，改成跳过后必须少一题、且指数重算
  const sp4 = fullSpec(3); sp4.G = [4, 4, 4, 2];
  const fullG = S.classifyMarks(marksOf(sp4), dimMap, V);
  const sp5 = fullSpec(3); sp5.G = [4, 4, 4, null];
  const skipG = S.classifyMarks(marksOf(sp5), dimMap, V);
  if (skipG.answerCount.G !== 3) bad.push('作答改跳过后 answerCount.G 应为 3，实得 ' + skipG.answerCount.G);
  if (!near(skipG.dims.G, EXPECT_INDEX(12, 3))) bad.push('作答改跳过后 G 指数 ' + skipG.dims.G + ' 应为 ' + EXPECT_INDEX(12, 3).toFixed(4));
  if (fullG.dims.G === skipG.dims.G && near(fullG.dims.G, 100)) bad.push('G 全 4 分与跳过后结果相同，可疑');
  ck('S9', '改状态后计分正确：跳过→作答、作答→跳过、改回原状（幂等）', !bad.length,
    bad.length ? bad.join('；') : 'M 跳过(n=2,S=4)=' + r1(skippedRes.dims.M) + ' → 补 4 分(n=3,S=8)=' + r1(answeredRes.dims.M) + ' → 改回=' + r1(backRes.dims.M));
})();

// ============================================================
// S10 组合与边界扫描：n 的 3^5 种分布 × 每维 5 个关键分位（含极值）
//     13^5 覆盖不到「n=2/3」，这里逐组核对公式、A/R、物种合法性、确定性
// ============================================================
(function S10() {
  const t0 = Date.now();
  const bad = [], NS = [4, 3, 2];
  let n = 0, bad0 = 0;
  for (const nW of NS) for (const nL of NS) for (const nM of NS) for (const nC of NS) for (const nG of NS) {
    const ns = { W: nW, L: nL, M: nM, C: nC, G: nG };
    // 每维 5 个关键分位：全最低、最低+1、中间、最高-1、全最高
    for (const mode of [0, 1, 2, 3, 4]) {
      const marks = [];
      for (const q of bank.questions) {
        const k = ns[q.dim];
        marks.push(pickScore(k, mode, posInDim[q.id]));
      }
      n++;
      let r;
      try { r = S.classifyMarks(marks, dimMap, V); }
      catch (e) { if (bad.length < 4) bad.push('抛错：' + e.code + ' ' + e.message); continue; }
      let sumIdx = 0, mx = -Infinity, mn = Infinity;
      for (const d of DIMS) {
        const arr = [];
        for (const q of bank.questions) if (q.dim === d) arr.push(pickScore(ns[d], mode, posInDim[q.id]));
        const want = EXPECT_INDEX(arr.reduce((x, y) => x + y, 0), ns[d]);
        sumIdx += want; mx = Math.max(mx, want); mn = Math.min(mn, want);
        if (Math.abs(r.dims[d] - want) > 1e-9) { bad0++; if (bad.length < 4) bad.push('n=' + JSON.stringify(ns) + ' mode' + mode + ' ' + d + ' 指数 ' + r.dims[d] + ' 应 ' + want); }
      }
      if (Math.abs(r.A - sumIdx / 5) > 1e-9) { bad0++; if (bad.length < 4) bad.push('A 不符 ' + r.A + ' vs ' + (sumIdx / 5)); }
      if (Math.abs(r.R - (mx - mn)) > 1e-9) { bad0++; if (bad.length < 4) bad.push('R 不符 ' + r.R + ' vs ' + (mx - mn)); }
      if (S.SPECIES_ALL.indexOf(r.species) < 0) { bad0++; if (bad.length < 4) bad.push('物种越界 ' + r.species); }
      if (!(r.dims.W >= 0 && r.dims.W <= 100 && r.dims.L >= 0 && r.dims.L <= 100 && r.dims.M >= 0 && r.dims.M <= 100 && r.dims.C >= 0 && r.dims.C <= 100 && r.dims.G >= 0 && r.dims.G <= 100)) {
        bad0++; if (bad.length < 4) bad.push('指数越界：' + JSON.stringify(r.dims));
      }
    }
  }
  function pickScore(k, mode, pos) {
    if (pos >= k) return null;                  // 超出有效回答数的位置一律跳过
    if (mode === 0) return 1;
    if (mode === 1) return pos === 0 ? 2 : 1;
    if (mode === 2) return 2;
    if (mode === 3) return pos === 0 ? 3 : 4;
    return 4;
  }
  ck('S10', '组合扫描：n 的 3^5=243 种分布 × 5 个关键分位 = 1,215 组，公式 / A / R / 物种 / 值域全部吻合',
    bad0 === 0 && n === 1215,
    n + ' 组，异常 ' + bad0 + ' 处（' + (Date.now() - t0) + ' ms）' + (bad.length ? '｜' + bad.join('；') : ''));
})();

// ============================================================
// S11 与「老口径」对照：n=4 时指数必须落在 13 档格点上；n<4 时允许非格点（不四舍五入成格点）
// ============================================================
(function S11() {
  const bad = [];
  const full = S.classifyMarks(marksOf({ W: [1, 1, 1, 2], L: [4, 4, 4, 4], M: [2, 2, 2, 2], C: [3, 3, 3, 4], G: [1, 2, 3, 4] }), dimMap, V);
  for (const d of DIMS) {
    const v = full.dims[d], g = Math.round(v / 100 * 12) * 100 / 12;
    if (Math.abs(g - v) > 1e-9) bad.push('全答时 ' + d + '=' + v + ' 不在 13 档格点上');
  }
  // n=2 的取值恰好都落在格点上（步长 16.67 = 2 格），真正会出现非格点的是 n=3：
  //   W=[1,3,3,跳过] → S=7、n=3 → (7-3)/9×100 = 44.444，不属于 13 档
  const part = S.classifyMarks(marksOf({ W: [1, 3, 3, null], L: [4, 4, 4, 4], M: [2, 2, 2, 2], C: [3, 3, 3, 4], G: [1, 2, 3, 4] }), dimMap, V);
  const w = part.dims.W;
  if (!near(w, 400 / 9)) bad.push('W=(7-3)/(3×3)×100 计算异常：' + w);
  if (Math.abs(Math.round(w / 100 * 12) * 100 / 12 - w) < 1e-9) bad.push('部分作答的指数被强行四舍五入成 13 档格点：' + w);
  // n=2 的例子单独核对（应当正好是格点上的 83.3）
  const two = S.classifyMarks(marksOf({ W: [4, 3, null, null], L: [4, 4, 4, 4], M: [2, 2, 2, 2], C: [3, 3, 3, 4], G: [1, 2, 3, 4] }), dimMap, V);
  if (!near(two.dims.W, 500 / 6)) bad.push('W=[4,3,跳过,跳过] 应为 83.3333，实得 ' + two.dims.W);
  ck('S11', '精度纪律：全答仍落在 13 档格点；部分作答保留精确值（n=3 时会出现 44.4 这种非格点值）', !bad.length,
    bad.length ? bad.join('；') : '全答五维全部在格点；W=[1,3,3,跳过] → ' + w.toFixed(4) + '（非格点，符合预期）；W=[4,3,跳过,跳过] → ' + two.dims.W.toFixed(4));
})();

// ============================================================
// S12 确定性：同一组部分作答重复 200 次，结果对象逐字节一致
// ============================================================
(function S12() {
  const marks = marksOf({ W: [4, 3, null, null], L: [3, null, 4, 2], M: [2, 2, null, null], C: [4, 1, 3, null], G: [2, null, 4, 4] });
  const first = JSON.stringify(S.classifyMarks(marks, dimMap, V));
  let diff = 0;
  for (let i = 0; i < 200; i++) if (JSON.stringify(S.classifyMarks(marks, dimMap, V)) !== first) diff++;
  ck('S12', '同一组部分作答重复 200 次，结果对象逐字节一致（无随机、无时间）', diff === 0, diff ? diff + ' 次不一致' : '200 次全部一致');
})();

// ============================================================
// 输出
// ============================================================
const fail = results.filter(r => !r.pass);
console.log('==== 跳过计分验收（' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '）====');
console.log('模块 ' + path.join(WEB_ROOT, 'js', 'scoring.js'));
console.log('版本 ' + JSON.stringify(V));
console.log('');
results.forEach(r => {
  console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.id + ' ' + r.name);
  if (r.detail) console.log('        ' + r.detail);
});
console.log('');
console.log('---- ' + (results.length - fail.length) + ' 通过 / ' + fail.length + ' 失败 ----');
process.exit(fail.length ? 1 : 0);
