// 计分模块 v1.2（网页运行时）—— 母版：70-质量检查/计算核心.js（v1.0，全题作答口径）
//
// ============================================================
// 与母版的差异只有两处，都是「非算法性」改造，函数体逐行照搬：
//   ① VERSIONS：从写死常量改为「由调用方传入 / 从 题库.json → meta.数据版本 读」，
//      未传时退回母版同值兜底（DEFAULT_VERSIONS），行为与母版完全一致。
//   ② 导出方式：module.exports 改为 UMD，浏览器 <script> 直接引入即可挂在 window.WorkplaceScoring。
// 新增（不属于算法改造）：versionsFromBank / buildScoreInput / scoreBank 三个「适配层」函数，
//   负责「20 个 option_id → scores[20] + dimMap[20]」这一步，母版里没有这一步。
// 任何公式、阈值、优先级、并列规则、副称号绝对值判据都没有改过。
// 逐行差异见 tests/W03_与母版差异.md；行为等价性由 tests/计分验收.js 的 371,293 组逐组比对证明。
//
// 【v1.2 新增：跳过题目 / 缺失答案（决策 D030）】
//   原来一维 4 题必须全答，维度指数 = (S - 4) / 12 × 100（S 为 4 题总分）。
//   现在允许用户主动跳过，一维有效回答数 n ∈ {2,3,4}（n < 2 拒绝出结果），公式推广为：
//       维度指数 = ((S_d - n_d) / (3 × n_d)) × 100
//   n = 4 时 ((S-4)/(3×4))×100 = (S-4)/12×100，与 v1.1 **逐字节相同**（已由 371,293 组穷举证明）。
//   实现上没有引入浮点：把 p_d 放大 12 倍记为 P_d = 48 × (S_d - n_d) / n_d（恒为整数，
//   因为 n ∈ {2,3,4} 都能整除 48），原有全部判据改用 P 的整数比较，等价关系见下方注释。
//   跳过的题**不产生任何分值**：既不记 0 分，也不补中间分，只是不进 S_d 和 n_d。
// ============================================================
//
// 母版核心思想（原注释照抄）：整个算法可以完全用整数算，不用浮点、不需要容差。
// 令 p = 维度原始总分 − 4（p ∈ 0..12，整数），则：
//   维度指数 = p × 100 / 12
//   A ≥ 50      ⇔  p 之和 ≥ 30
//   A < 40/60/75 ⇔  p 之和 < 24 / 36 / 45
//   R ≤ 25      ⇔  p 的极差 ≤ 3
//   匹配分（统一放大到 240 分制，全部为整数）：
//     树懒   = 12×(12−L) + 8×(12−M)
//     炸毛猫 = 12×(12−C) + 8×(12−M)
//     狐狸   = 11×W + 9×G
//     企鹅   = 11×L + 9×M
//   副称号偏离比较 ⇔ |5p − Σp|（整数）
// 于是"同分"是精确相等，不存在浮点误差导致的误判或漏判。
//
// v1.2 的等价改写（P = 12p，即放大 12 倍，全部仍为整数）：
//   A ≥ 50      ⇔  ΣP ≥ 360            A < 40/60/75 ⇔ ΣP < 288 / 432 / 540
//   R ≤ 25      ⇔  P 极差 ≤ 36
//   匹配分        整体 ×12（比较大小不变）：树懒 = 12×(144−P_L) + 8×(144−P_M) 等
//   副称号偏离    |5P − ΣP|（整体 ×12，比较大小不变）
//   档位          低 P ≤ 48 / 高 P ≥ 108（对应 p ≤ 4 / p ≥ 9）
//   指数          P × 100 / 144（n=4 时 12p × 100 / 144 = p × 100 / 12，同一有理数、同一舍入）

(function (factory) {
  var API = factory();
  if (typeof module === 'object' && module && module.exports) {
    // Node / 打包环境
    module.exports = API;
  } else if (typeof window !== 'undefined') {
    // 浏览器：<script src="js/scoring.js"> 后通过 window.WorkplaceScoring 访问
    window.WorkplaceScoring = API;
  }
})(function () {
  'use strict';

  var DIMS = ['W', 'L', 'M', 'C', 'G'];
  var PRIORITY = ['树懒', '炸毛猫', '狐狸', '企鹅'];
  var SPECIES_ALL = ['树懒', '炸毛猫', '水豚', '狐狸', '企鹅'];

  var SCALE = 12;        // p 的放大系数：P = 12p，p ∈ 0..12 → P ∈ 0..144
  var P_MAX = 12 * SCALE;   // 144，p 的理论上限
  var MIN_ANSWER = 2;    // 每个维度至少 2 题有效回答，才允许生成结果（决策 D030）

  // 改造 ①：与母版同值的兜底版本号。传入 versions 或调用 versionsFromBank 时以传入值为准。
  var DEFAULT_VERSIONS = {
    product_id: 'workplace-survival-atlas',
    question_version: 'v1.0',
    scoring_version: 'v1.2',
    algorithm_version: 'v1.1',
    result_content_version: 'v1.1'
  };
  var VERSION_KEYS = ['product_id', 'question_version', 'scoring_version', 'algorithm_version', 'result_content_version'];

  // 母版保留此常量名（Node 侧若有代码引用 VERSIONS，仍能取到兜底值）
  var VERSIONS = DEFAULT_VERSIONS;

  function ScoreError(code, message) {
    this.name = 'ScoreError';
    this.code = code;
    this.message = message;
    this.stack = (new Error(message)).stack;
  }
  ScoreError.prototype = Object.create(Error.prototype);
  ScoreError.prototype.constructor = ScoreError;

  // ---------- 基础量 ----------
  function dimIndex(sum) { return (sum - 4) * 100 / 12; }               // 4–16 原始总分口径（母版同名函数）
  function indexOfScaled(Pd) { return Pd * 100 / 144; }                 // 放大量 → 维度指数
  function round1(v) { return Math.round(v * 10) / 10; }

  // 档位阈值：整数判据（ΣP 与 24/36/45 × 12）
  function levelOfScaled(sumPScaled) {
    if (sumPScaled < 24 * SCALE) return '需要回血';
    if (sumPScaled < 36 * SCALE) return '勉强维持';
    if (sumPScaled < 45 * SCALE) return '基本在线';
    return '状态不错';
  }
  function levelOfSumP(sumP) { return levelOfScaled(Math.round(sumP * SCALE)); }

  // 匹配分放大 12 倍（比较大小与原式一致；n=4 时正好是原值的 12 倍）
  function matchScaled(P) {
    return {
      树懒: 12 * (P_MAX - P.L) + 8 * (P_MAX - P.M),
      炸毛猫: 12 * (P_MAX - P.C) + 8 * (P_MAX - P.M),
      狐狸: 11 * P.W + 9 * P.G,
      企鹅: 11 * P.L + 9 * P.M
    };
  }
  function matchScores(p) {
    var P = {}, i;
    for (i = 0; i < DIMS.length; i++) P[DIMS[i]] = p[DIMS[i]] * SCALE;
    var m = matchScaled(P);
    return { 树懒: m.树懒 / SCALE, 炸毛猫: m.炸毛猫 / SCALE, 狐狸: m.狐狸 / SCALE, 企鹅: m.企鹅 / SCALE };
  }

  // ---------- 主判定（唯一实现：吃放大后的整数 P）----------
  function classifyScaled(P) {
    var i, d, sumPScaled = 0, maxP = -Infinity, minP = Infinity, p = {};
    for (i = 0; i < DIMS.length; i++) {
      d = DIMS[i];
      if (!Number.isInteger(P[d])) throw new ScoreError('BAD_INPUT', '内部错误：放大量必须是整数，问题在 ' + d + '：' + P[d]);
      sumPScaled += P[d];
      if (P[d] > maxP) maxP = P[d];
      if (P[d] < minP) minP = P[d];
      p[d] = P[d] / SCALE;
    }
    var A = sumPScaled * 5 / 36;                    // = (Σp/5) × 100/12，与母版同一有理数
    var R = (maxP - minP) * 100 / (SCALE * SCALE);  // = (maxP−minP)/12 × 100/12
    var level = levelOfScaled(sumPScaled);

    // 第一步：水豚优先（A ≥ 50 且 R ≤ 25 ⇔ ΣP ≥ 360 且 P 极差 ≤ 36）
    if (sumPScaled >= 30 * SCALE && maxP - minP <= 3 * SCALE) {
      return { species: '水豚', level: level, A: A, R: R, sumP: sumPScaled / SCALE, p: p, matches: null, tieCandidates: null, tieRule: '水豚优先判定命中' };
    }

    // 第二步：匹配分取最高（整数精确比较）
    var m = matchScaled(P);
    var max = Math.max(m['树懒'], m['炸毛猫'], m['狐狸'], m['企鹅']);
    var cand = PRIORITY.filter(function (n) { return m[n] === max; });
    var tieRule = null;

    // 第三步：并列处理
    if (cand.length === 2 && cand.indexOf('树懒') >= 0 && cand.indexOf('炸毛猫') >= 0) {
      // 定理：两式相等 ⇔ L = C，比 L 与 C 永远相等 → 直接树懒（与 p 是否整数无关，仍是同一个等式）
      tieRule = '树懒+炸毛猫并列（两式相等必然 L=C，按固定优先级取树懒）';
      cand = ['树懒'];
    } else if (cand.length === 2 && cand.indexOf('狐狸') >= 0 && cand.indexOf('企鹅') >= 0) {
      var wg = p.W + p.G, lm = p.L + p.M;   // 用未放大的 p 写进说明，与母版文字逐字一致
      tieRule = '狐狸+企鹅并列，比较 W+G 与 L+M：' + wg + ' vs ' + lm;
      cand = [wg >= lm ? '狐狸' : '企鹅'];
    } else if (cand.length > 1) {
      tieRule = cand.length + ' 个物种并列，直接按固定优先级';
    }
    var species = PRIORITY.filter(function (n) { return cand.indexOf(n) >= 0; })[0];
    var plain = { 树懒: m.树懒 / SCALE, 炸毛猫: m.炸毛猫 / SCALE, 狐狸: m.狐狸 / SCALE, 企鹅: m.企鹅 / SCALE };
    return { species: species, level: level, A: A, R: R, sumP: sumPScaled / SCALE, p: p, matches: plain, tieCandidates: cand.length > 1 ? cand : null, tieRule: tieRule };
  }

  /** 母版同名 API：吃 4–16 的整数维度总分（等价于「一维 4 题全答」） */
  function classifySums(dimSums) {
    var P = {}, i, d, v;
    for (i = 0; i < DIMS.length; i++) {
      d = DIMS[i];
      v = dimSums[d];
      if (!Number.isInteger(v) || v < 4 || v > 16) {
        throw new ScoreError('BAD_INPUT', '维度原始总分必须是 4–16 的整数，问题在 ' + d + '：' + v);
      }
      P[d] = (v - 4) * SCALE;
    }
    return classifyScaled(P);
  }

  // ---------- 副称号 ----------
  var SUB_TABLE = {
    W: { low: '月光守门员', mid: '精打细算选手', high: '存款小管家' },
    L: { low: '周末失踪人口', mid: '时间管理选手', high: '准点下班选手' },
    M: { low: '脑内弹幕发射器', mid: '情绪缓冲选手', high: '情绪稳定器' },
    C: { low: '办公室天气预报员', mid: '团队观察选手', high: '人间职场润滑剂' },
    G: { low: '原地刷怪选手', mid: '经验积累选手', high: '技能解锁玩家' }
  };

  function subTitleScaled(P, level, sumPScaled) {
    var i, d, dim;
    if (level === '需要回血') {
      var min = Infinity;
      for (i = 0; i < DIMS.length; i++) if (P[DIMS[i]] < min) min = P[DIMS[i]];
      dim = DIMS.filter(function (x) { return P[x] === min; })[0];
    } else if (level === '状态不错') {
      var max = -Infinity;
      for (i = 0; i < DIMS.length; i++) if (P[DIMS[i]] > max) max = P[DIMS[i]];
      dim = DIMS.filter(function (x) { return P[x] === max; })[0];
    } else {
      var dev = -1;
      for (i = 0; i < DIMS.length; i++) {
        d = DIMS[i];
        var cur = Math.abs(5 * P[d] - sumPScaled);
        if (cur > dev) dev = cur;
      }
      dim = DIMS.filter(function (x) { return Math.abs(5 * P[x] - sumPScaled) === dev; })[0];
    }
    var Pd = P[dim];
    var band = Pd <= 4 * SCALE ? 'low' : (Pd >= 9 * SCALE ? 'high' : 'mid');
    return { dim: dim, band: band, title: SUB_TABLE[dim][band], dimIndex: indexOfScaled(Pd) };
  }

  /** 母版同名 API：吃 p（未放大的偏离量） */
  function subTitleOf(p, level, sumP) {
    var P = {}, i, total = 0;
    for (i = 0; i < DIMS.length; i++) { P[DIMS[i]] = Math.round(p[DIMS[i]] * SCALE); total += P[DIMS[i]]; }
    return subTitleScaled(P, level, total);
  }

  // ---------- 版本号 ----------
  // 改造 ①：从 题库.json → meta.数据版本 读取 5 个版本号（上线清单 1.13 要求「从题库读，不写死」）
  function versionsFromBank(bank) {
    var v = bank && bank.meta && bank.meta['数据版本'];
    if (!v) throw new ScoreError('BAD_INPUT', '题库缺少 meta.数据版本，无法读取版本号');
    var out = {};
    for (var i = 0; i < VERSION_KEYS.length; i++) {
      var k = VERSION_KEYS[i];
      if (typeof v[k] !== 'string' || !v[k].trim()) {
        throw new ScoreError('BAD_INPUT', '题库 meta.数据版本 缺字段：' + k);
      }
      out[k] = v[k];
    }
    return out;
  }

  function resolveVersions(versionsOrBank) {
    if (!versionsOrBank) return { product_id: DEFAULT_VERSIONS.product_id, question_version: DEFAULT_VERSIONS.question_version, scoring_version: DEFAULT_VERSIONS.scoring_version, algorithm_version: DEFAULT_VERSIONS.algorithm_version, result_content_version: DEFAULT_VERSIONS.result_content_version };
    if (versionsOrBank.meta) return versionsFromBank(versionsOrBank);
    var out = {}, bad = [];
    for (var i = 0; i < VERSION_KEYS.length; i++) {
      var k = VERSION_KEYS[i];
      if (typeof versionsOrBank[k] !== 'string' || !versionsOrBank[k].trim()) bad.push(k);
      else out[k] = versionsOrBank[k];
    }
    if (bad.length) throw new ScoreError('BAD_INPUT', '版本号不完整：' + bad.join(', '));
    return out;
  }

  // ---------- 对外：用 0–100 五维指数调用（前端/调试常用）----------
  function classifyIndices(indices, versions) {
    var sums = {};
    for (var i = 0; i < DIMS.length; i++) {
      var d = DIMS[i];
      var v = indices[d];
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new ScoreError('BAD_INPUT', '维度指数必须在 0–100，问题在 ' + d + '：' + v);
      var sum = Math.round(v / 100 * 12) + 4;
      if (Math.abs(dimIndex(sum) - v) > 1e-9) throw new ScoreError('NOT_GRID', d + '=' + v + ' 不是合法的 13 档取值（只能是 0 / 8.3 / 16.7 … / 100）');
      sums[d] = sum;
    }
    return finish(sums, versions);
  }

  // ---------- 对外：用 20 题作答调用（答题场景，必须 20 题全答）----------
  // answers 是 20 个 1–4 分值，questionSumsMap 是 20 个维度代号；第三个参数可传版本号或整份题库
  function classifyAnswers(answers, questionSumsMap, versions) {
    if (!Array.isArray(answers) || answers.length !== 20) {
      throw new ScoreError('INCOMPLETE', '必须答完 20 题才能出结果，当前 ' + (Array.isArray(answers) ? answers.length : 0) + ' 题');
    }
    var sums = { W: 0, L: 0, M: 0, C: 0, G: 0 };
    for (var i = 0; i < 20; i++) {
      var s = answers[i];
      if (!Number.isInteger(s) || s < 1 || s > 4) throw new ScoreError('BAD_ANSWER', '第 ' + (i + 1) + ' 题分值非法：' + s);
      sums[questionSumsMap[i]] += s;
    }
    return finish(sums, versions);
  }

  // ---------- 最低回答校验（v1.2）----------
  function minimumCheck(counts) {
    var lack = [];
    for (var i = 0; i < DIMS.length; i++) {
      var d = DIMS[i];
      if (counts[d] < MIN_ANSWER) lack.push({ dim: d, n: counts[d], need: MIN_ANSWER - counts[d] });
    }
    return lack;
  }
  function minimumMessage(lack) {
    var parts = lack.map(function (x) {
      return x.dim + ' 维度' + (x.n === 0 ? '没有任何有效回答（至少需要 ' + MIN_ANSWER + ' 题）' : '只有 ' + x.n + ' 题有效回答，还需要 ' + x.need + ' 题');
    });
    return '还不能出结果：' + parts.join('；');
  }

  // ---------- 对外：20 个位置，已答=1–4，跳过=null（v1.2）----------
  function classifyMarks(marks, questionSumsMap, versions) {
    if (!Array.isArray(marks) || marks.length !== 20) {
      throw new ScoreError('INCOMPLETE', '必须有 20 个位置（已答=分值，跳过=null），当前 ' + (Array.isArray(marks) ? marks.length : 0) + ' 个');
    }
    if (!Array.isArray(questionSumsMap) || questionSumsMap.length !== 20) {
      throw new ScoreError('BAD_INPUT', '维度映射必须是 20 个维度代号');
    }
    var sum = { W: 0, L: 0, M: 0, C: 0, G: 0 };
    var n = { W: 0, L: 0, M: 0, C: 0, G: 0 };
    var skippedQuestions = [], i, d, s;
    for (i = 0; i < 20; i++) {
      d = questionSumsMap[i];
      if (!Object.prototype.hasOwnProperty.call(n, d)) throw new ScoreError('BAD_INPUT', '未知维度代号：' + d);
      s = marks[i];
      if (s === null) { skippedQuestions.push(i + 1); continue; }   // 明确跳过：不加分、不计数、不补中间值
      if (!Number.isInteger(s) || s < 1 || s > 4) throw new ScoreError('BAD_ANSWER', '第 ' + (i + 1) + ' 题分值非法：' + s);
      sum[d] += s;
      n[d]++;
    }
    var lack = minimumCheck(n);
    if (lack.length) {
      var err = new ScoreError('INSUFFICIENT', minimumMessage(lack));
      err.dims = lack;
      err.skippedQuestions = skippedQuestions;
      throw err;
    }
    var P = {}, sumPScaled = 0;
    for (i = 0; i < DIMS.length; i++) {
      d = DIMS[i];
      P[d] = 48 * (sum[d] - n[d]) / n[d];      // = 12 × p_d，n ∈ {2,3,4} 时恒为整数
      sumPScaled += P[d];
    }
    var r = classifyScaled(P);
    var sub = subTitleScaled(P, r.level, sumPScaled);
    var dims = {};
    for (i = 0; i < DIMS.length; i++) dims[DIMS[i]] = indexOfScaled(P[DIMS[i]]);
    var thin = DIMS.filter(function (x) { return n[x] === MIN_ANSWER; });
    return {
      dimSums: { W: sum.W, L: sum.L, M: sum.M, C: sum.C, G: sum.G },   // 注意：部分作答时是「已回答题目的分数之和」，不是 4–16 口径
      dims: dims,
      A: r.A,
      A_display: round1(r.A),
      R: r.R,
      R_display: round1(r.R),
      species: r.species,
      overallLevel: r.level,
      subTitleDim: sub.dim,
      subTitleBand: sub.band,
      subTitle: sub.title,
      speciesMatches: r.matches,
      tieCandidates: r.tieCandidates,
      tieRule: r.tieRule,
      versions: resolveVersions(versions),
      // ---- v1.2 追加字段（全题作答时不出现，保证与 v1.1 结果对象逐字节一致）----
      partial: true,
      answerCount: { W: n.W, L: n.L, M: n.M, C: n.C, G: n.G },
      totalAnswered: n.W + n.L + n.M + n.C + n.G,
      totalSkipped: skippedQuestions.length,
      skippedQuestions: skippedQuestions,
      minAnswer: MIN_ANSWER,
      thinDims: thin
    };
  }

  function finish(dimSums, versions) {
    var r = classifySums(dimSums);
    var sub = subTitleOf(r.p, r.level, r.sumP);
    var dims = {};
    for (var i = 0; i < DIMS.length; i++) dims[DIMS[i]] = dimIndex(dimSums[DIMS[i]]);
    return {
      dimSums: { W: dimSums.W, L: dimSums.L, M: dimSums.M, C: dimSums.C, G: dimSums.G },
      dims: dims,
      A: r.A,
      A_display: round1(r.A),
      R: r.R,
      R_display: round1(r.R),
      species: r.species,
      overallLevel: r.level,
      subTitleDim: sub.dim,
      subTitleBand: sub.band,
      subTitle: sub.title,
      speciesMatches: r.matches,
      tieCandidates: r.tieCandidates,
      tieRule: r.tieRule,
      versions: resolveVersions(versions)
    };
  }

  // ============================================================
  // 适配层：20 个 option_id → scores[20] + dimMap[20]（母版没有这一步）
  // 红线：只按 option_id 查表取分。不看 A/B/C/D、不看数组下标、不看选项文字。
  // v1.2：第三个参数 skippedMap 是 { question_id: true }，表示「用户主动跳过」。
  //       既没答也没跳过 → 仍然报 INCOMPLETE（不得用默认值补齐）。
  // ============================================================
  function buildScoreInput(bank, answers, skippedMap) {
    if (!bank || !Array.isArray(bank.questions) || bank.questions.length !== 20) {
      throw new ScoreError('BAD_INPUT', '题库结构异常：questions 必须是 20 题');
    }
    if (!answers || typeof answers !== 'object') {
      throw new ScoreError('INCOMPLETE', '还没有作答记录，请从第 1 题开始');
    }
    var skip = (skippedMap && typeof skippedMap === 'object') ? skippedMap : {};
    var scores = [], dimMap = [], marks = [], missing = [], skippedCount = 0, i, j;
    for (i = 0; i < bank.questions.length; i++) {
      var q = bank.questions[i];
      var oid = answers[q.id];
      if (oid !== null && oid !== undefined && oid !== '') {
        var hit = null;
        for (j = 0; j < (q.options || []).length; j++) {
          if (q.options[j].option_id === oid) { hit = q.options[j]; break; }
        }
        if (!hit) throw new ScoreError('BAD_ANSWER', q.id + ' 的作答 option_id 不存在：' + oid);
        scores.push(hit.score);
        dimMap.push(q.dim);
        marks.push(hit.score);
      } else if (skip[q.id]) {
        skippedCount++;                    // 主动跳过：不产生分值、不占 scores 位置
        marks.push(null);
      } else {
        missing.push(q.id);
        marks.push(undefined);
      }
    }
    if (missing.length) {
      var err = new ScoreError('INCOMPLETE', '还有 ' + missing.length + ' 题没答（当前 ' + scores.length + '/20）：' + missing.join('、'));
      err.remaining = missing.length;
      err.missing = missing;
      throw err;
    }
    return { scores: scores, dimMap: dimMap, marks: marks, skippedCount: skippedCount, answeredCount: scores.length };
  }

  // 一站式：题库 + 20 个 option_id → 结果对象（版本号自动从题库读）
  // 全部作答时走的还是 classifyAnswers（与 v1.1 逐字节一致）；有跳过才走 classifyMarks。
  function scoreBank(bank, answers, skippedMap) {
    var input = buildScoreInput(bank, answers, skippedMap);
    var versions = versionsFromBank(bank);
    if (!input.skippedCount) return classifyAnswers(input.scores, input.dimMap, versions);
    // 有跳过时必须用「20 个位置」的维度映射（marks 与题库顺序一一对应）
    return classifyMarks(input.marks, bank.questions.map(function (q) { return q.dim; }), versions);
  }

  // ---------- 给界面用：各维度有效回答数 / 哪些维度还没达标（v1.2）----------
  function countByDim(bank, answers, skippedMap) {
    var counts = { W: 0, L: 0, M: 0, C: 0, G: 0 };
    var skipped = [], unanswered = [];
    if (!bank || !Array.isArray(bank.questions)) return { counts: counts, lack: minimumCheck(counts), totalSkipped: 0, skipped: skipped, unanswered: unanswered, ok: false };
    var skip = (skippedMap && typeof skippedMap === 'object') ? skippedMap : {};
    for (var i = 0; i < bank.questions.length; i++) {
      var q = bank.questions[i];
      var oid = answers ? answers[q.id] : null;
      if (oid) counts[q.dim]++;
      else if (skip[q.id]) skipped.push(q.id);
      else unanswered.push(q.id);
    }
    var lack = minimumCheck(counts);
    return { counts: counts, lack: lack, totalSkipped: skipped.length, skipped: skipped, unanswered: unanswered, ok: lack.length === 0 };
  }

  return {
    DIMS: DIMS, PRIORITY: PRIORITY, SPECIES_ALL: SPECIES_ALL,
    VERSIONS: VERSIONS, DEFAULT_VERSIONS: DEFAULT_VERSIONS, VERSION_KEYS: VERSION_KEYS,
    SUB_TABLE: SUB_TABLE, ScoreError: ScoreError,
    SCALE: SCALE, MIN_ANSWER: MIN_ANSWER,
    dimIndex: dimIndex, indexOfScaled: indexOfScaled, levelOfSumP: levelOfSumP,
    matchScores: matchScores,
    classifySums: classifySums, subTitleOf: subTitleOf,
    classifyIndices: classifyIndices, classifyAnswers: classifyAnswers, classifyMarks: classifyMarks,
    versionsFromBank: versionsFromBank, buildScoreInput: buildScoreInput, scoreBank: scoreBank,
    countByDim: countByDim, minimumCheck: minimumCheck
  };
});

// ---------- 直接运行：自检（与母版同一组用例，浏览器环境自动跳过） ----------
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var C = module.exports;
  var cases = [
    [{ W: 4, L: 4, M: 4, C: 4, G: 4 }, '树懒', '需要回血'],
    [{ W: 10, L: 10, M: 10, C: 10, G: 10 }, '水豚', '勉强维持'],
    [{ W: 16, L: 16, M: 16, C: 16, G: 16 }, '水豚', '状态不错']
  ];
  cases.forEach(function (c) {
    var r = C.classifySums(c[0]);
    console.log((r.species === c[1] && r.level === c[2] ? '✅' : '❌') + ' ' + JSON.stringify(c[0]) + ' → ' + r.species + ' / ' + r.level + ' (A=' + r.A + ', R=' + r.R + ')');
  });
  var b1 = C.classifySums({ W: 8, L: 9, M: 9, C: 9, G: 9 });     // p 和 24 → A=40
  var b2 = C.classifySums({ W: 11, L: 11, M: 11, C: 11, G: 12 }); // p 和 36 → A=60
  var b3 = C.classifySums({ W: 13, L: 13, M: 13, C: 13, G: 13 }); // p 和 45 → A=75
  console.log('A=40 → ' + b1.level + '（期望 勉强维持），A=' + b1.A);
  console.log('A=60 → ' + b2.level + '（期望 基本在线），A=' + b2.A);
  console.log('A=75 → ' + b3.level + '（期望 状态不错），A=' + b3.A);

  // v1.2 跳过自检：一维 2 题、其余全答
  var marks = [4, 4, null, null, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
  var dimMap = ['W', 'W', 'W', 'W', 'L', 'L', 'L', 'L', 'M', 'M', 'M', 'M', 'C', 'C', 'C', 'C', 'G', 'G', 'G', 'G'];
  var pr = C.classifyMarks(marks, dimMap);
  console.log('跳过自检：W 只答 2 题（各 4 分）→ W 指数 ' + pr.dims.W + '（期望 100），跳过 ' + pr.totalSkipped + ' 题');
}
