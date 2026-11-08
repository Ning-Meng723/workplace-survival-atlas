// 计算核心 v1.0 —— 规则说明书 V1.0 的参考实现（唯一推荐实现）
//
// 核心思想：整个算法可以完全用整数算，不用浮点、不需要容差。
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

const DIMS = ['W', 'L', 'M', 'C', 'G'];
const PRIORITY = ['树懒', '炸毛猫', '狐狸', '企鹅'];
const SPECIES_ALL = ['树懒', '炸毛猫', '水豚', '狐狸', '企鹅'];

// 【v1.2 版本号同步（决策 D030）】只改号，不改算法：
//   母版实现的是「一维 4 题全答」这一支（n=4），与 v1.2 的通用公式在 n=4 上逐字节等价，
//   已被 tests/计分验收.js 的 371,293 组穷举证明。缺失答案分支只在网页版 js/scoring.js 里，
//   母版**故意不加**——它要当那个不被改动的对照标准（oracle）。
const VERSIONS = {
  product_id: 'workplace-survival-atlas',
  question_version: 'v1.0',
  scoring_version: 'v1.2',
  algorithm_version: 'v1.1',
  result_content_version: 'v1.1'
};

class ScoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---------- 基础量 ----------
function dimIndex(sum) { return (sum - 4) * 100 / 12; }

function levelOfSumP(sumP) {
  if (sumP < 24) return '需要回血';
  if (sumP < 36) return '勉强维持';
  if (sumP < 45) return '基本在线';
  return '状态不错';
}

function matchScores(p) {
  return {
    树懒: 12 * (12 - p.L) + 8 * (12 - p.M),
    炸毛猫: 12 * (12 - p.C) + 8 * (12 - p.M),
    狐狸: 11 * p.W + 9 * p.G,
    企鹅: 11 * p.L + 9 * p.M
  };
}

// ---------- 主判定 ----------
function classifySums(dimSums) {
  const p = {};
  for (const d of DIMS) {
    const v = dimSums[d];
    if (!Number.isInteger(v) || v < 4 || v > 16) {
      throw new ScoreError('BAD_INPUT', '维度原始总分必须是 4–16 的整数，问题在 ' + d + '：' + v);
    }
    p[d] = v - 4;
  }
  const sumP = DIMS.reduce((a, d) => a + p[d], 0);
  const maxP = Math.max(...DIMS.map(d => p[d]));
  const minP = Math.min(...DIMS.map(d => p[d]));
  const A = sumP * 5 / 3;          // = (Σp/5)×100/12，精确
  const R = (maxP - minP) * 100 / 12;
  const level = levelOfSumP(sumP);

  // 第一步：水豚优先（整数判据，等价于 A ≥ 50 且 R ≤ 25）
  if (sumP >= 30 && maxP - minP <= 3) {
    return { species: '水豚', level, A, R, sumP, p, matches: null, tieCandidates: null, tieRule: '水豚优先判定命中' };
  }

  // 第二步：匹配分取最高（整数精确比较）
  const m = matchScores(p);
  const max = Math.max(m['树懒'], m['炸毛猫'], m['狐狸'], m['企鹅']);
  let cand = PRIORITY.filter(n => m[n] === max);
  let tieRule = null;

  // 第三步：并列处理
  if (cand.length === 2 && cand.includes('树懒') && cand.includes('炸毛猫')) {
    // 定理：两式相等 ⇔ L = C，比 L 与 C 永远相等 → 直接树懒
    tieRule = '树懒+炸毛猫并列（两式相等必然 L=C，按固定优先级取树懒）';
    cand = ['树懒'];
  } else if (cand.length === 2 && cand.includes('狐狸') && cand.includes('企鹅')) {
    const wg = p.W + p.G, lm = p.L + p.M;
    tieRule = '狐狸+企鹅并列，比较 W+G 与 L+M：' + wg + ' vs ' + lm;
    cand = [wg >= lm ? '狐狸' : '企鹅'];
  } else if (cand.length > 1) {
    tieRule = cand.length + ' 个物种并列，直接按固定优先级';
  }
  const species = PRIORITY.find(n => cand.includes(n));
  return { species, level, A, R, sumP, p, matches: m, tieCandidates: cand.length > 1 ? cand : null, tieRule };
}

// ---------- 副称号 ----------
const SUB_TABLE = {
  W: { low: '月光守门员', mid: '精打细算选手', high: '存款小管家' },
  L: { low: '周末失踪人口', mid: '时间管理选手', high: '准点下班选手' },
  M: { low: '脑内弹幕发射器', mid: '情绪缓冲选手', high: '情绪稳定器' },
  C: { low: '办公室天气预报员', mid: '团队观察选手', high: '人间职场润滑剂' },
  G: { low: '原地刷怪选手', mid: '经验积累选手', high: '技能解锁玩家' }
};

function subTitleOf(p, level, sumP) {
  let dim;
  if (level === '需要回血') {
    const min = Math.min(...DIMS.map(d => p[d]));
    dim = DIMS.find(d => p[d] === min);
  } else if (level === '状态不错') {
    const max = Math.max(...DIMS.map(d => p[d]));
    dim = DIMS.find(d => p[d] === max);
  } else {
    const dev = Math.max(...DIMS.map(d => Math.abs(5 * p[d] - sumP)));
    dim = DIMS.find(d => Math.abs(5 * p[d] - sumP) === dev);
  }
  const v = p[dim];
  const band = v <= 4 ? 'low' : (v >= 9 ? 'high' : 'mid');
  return { dim, band, title: SUB_TABLE[dim][band], dimIndex: dimIndex(v + 4) };
}

// ---------- 对外：用 0–100 五维指数调用（前端/调试常用）----------
function classifyIndices(indices) {
  const sums = {};
  for (const d of DIMS) {
    const v = indices[d];
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new ScoreError('BAD_INPUT', '维度指数必须在 0–100，问题在 ' + d + '：' + v);
    const sum = Math.round(v / 100 * 12) + 4;
    if (Math.abs(dimIndex(sum) - v) > 1e-9) throw new ScoreError('NOT_GRID', d + '=' + v + ' 不是合法的 13 档取值（只能是 0 / 8.3 / 16.7 … / 100）');
    sums[d] = sum;
  }
  return finish(sums);
}

// ---------- 对外：用 20 题作答调用（答题场景）----------
function classifyAnswers(answers, questionSumsMap) {
  if (!Array.isArray(answers) || answers.length !== 20) {
    throw new ScoreError('INCOMPLETE', '必须答完 20 题才能出结果，当前 ' + (Array.isArray(answers) ? answers.length : 0) + ' 题');
  }
  const sums = { W: 0, L: 0, M: 0, C: 0, G: 0 };
  for (let i = 0; i < 20; i++) {
    const s = answers[i];
    if (!Number.isInteger(s) || s < 1 || s > 4) throw new ScoreError('BAD_ANSWER', '第 ' + (i + 1) + ' 题分值非法：' + s);
    sums[questionSumsMap[i]] += s;
  }
  return finish(sums);
}

function finish(dimSums) {
  const r = classifySums(dimSums);
  const sub = subTitleOf(r.p, r.level, r.sumP);
  const dims = {};
  for (const d of DIMS) dims[d] = dimIndex(dimSums[d]);
  return {
    dimSums: { ...dimSums },
    dims,
    A: r.A,
    A_display: Math.round(r.A * 10) / 10,
    R: r.R,
    R_display: Math.round(r.R * 10) / 10,
    species: r.species,
    overallLevel: r.level,
    subTitleDim: sub.dim,
    subTitleBand: sub.band,
    subTitle: sub.title,
    speciesMatches: r.matches,
    tieCandidates: r.tieCandidates,
    tieRule: r.tieRule,
    versions: { ...VERSIONS }
  };
}

module.exports = {
  DIMS, PRIORITY, SPECIES_ALL, VERSIONS, SUB_TABLE,
  ScoreError, dimIndex, levelOfSumP, matchScores, classifySums, subTitleOf, classifyIndices, classifyAnswers
};

// ---------- 直接运行：自检 ----------
if (require.main === module) {
  const cases = [
    [{ W: 4, L: 4, M: 4, C: 4, G: 4 }, '树懒', '需要回血'],
    [{ W: 10, L: 10, M: 10, C: 10, G: 10 }, '水豚', '勉强维持'],
    [{ W: 16, L: 16, M: 16, C: 16, G: 16 }, '水豚', '状态不错']
  ];
  for (const [s, sp, lv] of cases) {
    const r = classifySums(s);
    console.log((r.species === sp && r.level === lv ? '✅' : '❌') + ' ' + JSON.stringify(s) + ' → ' + r.species + ' / ' + r.level + ' (A=' + r.A + ', R=' + r.R + ')');
  }
  // 边界：p 之和 = 24 / 36 / 45（即 A = 40 / 60 / 75，全部精确命中）
  const b1 = classifySums({ W: 8, L: 9, M: 9, C: 9, G: 9 });   // p 和 24 → A=40
  const b2 = classifySums({ W: 11, L: 11, M: 11, C: 11, G: 12 }); // p 和 36 → A=60
  const b3 = classifySums({ W: 13, L: 13, M: 13, C: 13, G: 13 }); // p 和 45 → A=75
  console.log('A=40 → ' + b1.level + '（期望 勉强维持），A=' + b1.A);
  console.log('A=60 → ' + b2.level + '（期望 基本在线），A=' + b2.A);
  console.log('A=75 → ' + b3.level + '（期望 状态不错），A=' + b3.A);
}
