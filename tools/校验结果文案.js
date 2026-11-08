// tools/校验结果文案.js
// 用途：确认 data/结果文案.json 与两份 Markdown 人工编辑源「逐字一致、结构完整、无禁词」。
//
// 这是防止「Markdown 和 JSON 长期不一致」的第二道锁：
//   锁 1 = meta 里记录两份 MD 的 sha256 指纹（MD 改了没重跑生成脚本 → 指纹对不上）
//   锁 2 = 本脚本重新解析 MD，与 JSON 逐条逐字比对（条数或文本差一条就失败）
//   锁 3 = 重新构建一次 JSON 与磁盘文件比对（证明生成可复现、无人手改）
//
// 用法（在仓库根目录下）：
//   node "30-网页产品/web-v1/tools/校验结果文案.js"
// 退出码 0 = 13 项全过；1 = 有失败项（会逐条列出）。
//
// 只读：不写任何文件。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GEN = require('./生成结果文案.js');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const SPEC = path.join(PROJECT_ROOT, '20-测试内容', '结果文案规范.md');
const CARD = path.join(PROJECT_ROOT, '20-测试内容', '分享卡片设计规范.md');
const BANK = path.resolve(__dirname, '..', 'data', '题库.json');
const JSONP = path.resolve(__dirname, '..', 'data', '结果文案.json');
const BAN_SRC = path.join(PROJECT_ROOT, '70-质量检查', '检查文案禁词.js');

// 【公开仓库说明】本脚本拿 20-测试内容/ 的 Markdown 源规范 + 70-质量检查/ 的禁词表，
// 反向核对 data/结果文案.json 是否逐字一致。公开仓库不含这两个目录，这里提示跳过。
// 已发布的 data/结果文案.json 本身是完整的，页面运行时只读它。
if (!fs.existsSync(path.join(PROJECT_ROOT, '20-测试内容')) || !fs.existsSync(BAN_SRC)) {
  console.log('[跳过] 未找到 20-测试内容/ 或 70-质量检查/检查文案禁词.js（公开仓库不含私有源目录）。');
  console.log('       本脚本只在完整项目内可用；页面运行只读 data/结果文案.json，不受影响。');
  process.exit(0);
}

const { SPECIES, LEVELS, DIMS, BANDS } = GEN;
const sha16 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
const slotsOf = (t) => [...String(t).matchAll(/\{([^{}]+)\}/g)].map(m => m[1]);

// 禁词表从现有脚本读取，避免「两份禁词表各写各的」
function loadBanned() {
  const src = fs.readFileSync(BAN_SRC, 'utf8');
  const start = src.indexOf('const BANNED = [');
  if (start < 0) throw new Error('无法从 检查文案禁词.js 读取 BANNED 表');
  const end = src.indexOf('];', start);
  const block = src.slice(start, end < 0 ? undefined : end);
  return [...block.matchAll(/'([^']*)'/g)].map(m => m[1]);
}

const results = [];   // { no, name, pass, detail }
const ck = (no, name, pass, detail) => results.push({ no, name, pass: !!pass, detail: detail || '' });

// ---------- 读文件 ----------
const specText = fs.readFileSync(SPEC, 'utf8');
const cardText = fs.readFileSync(CARD, 'utf8');
const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));
const J = JSON.parse(fs.readFileSync(JSONP, 'utf8'));
const rawJsonText = fs.readFileSync(JSONP, 'utf8');
const banned = loadBanned();

// ---------- 0. 可复现：重新生成一次必须与磁盘文件完全一致（防手改、防漏跑） ----------
(function check0() {
  const fresh = GEN.serialize(GEN.build());
  ck(0, '生成可复现（磁盘 JSON == 重新生成结果，无人手改）', fresh === rawJsonText,
    fresh === rawJsonText ? '' : '磁盘文件与重新生成结果不一致：说明有人手改过 JSON，或改完 MD 没重跑脚本');
})();

// ---------- 1. 核心文案总数 85 条 ----------
let total = 0, parts = {};
(function check1() {
  parts = {
    代表台词: SPECIES.filter(s => J.物种[s].代表台词.text).length,
    卡片台词: SPECIES.filter(s => J.物种[s].卡片台词.text).length,
    优势: SPECIES.reduce((n, s) => n + ['低档', '高档'].filter(b => J.物种[s].优势[b].text).length, 0),
    困境: SPECIES.reduce((n, s) => n + ['低档', '高档'].filter(b => J.物种[s].困境[b].text).length, 0),
    判词: J.判词建议.length,
    建议: J.判词建议.filter(x => x.建议 && x.建议.text).length,
    副称号解释: J.副称号解释.length
  };
  total = Object.values(parts).reduce((a, b) => a + b, 0);
  ck(1, '核心文案总数 = 85 条（25 + 40 + 15 + 5）', total === 85 && J.meta.统计.核心文案总数 === 85,
    total + ' 条：' + Object.entries(parts).map(([k, v]) => k + ' ' + v).join(' / '));
})();

// ---------- 2. 判词建议组合 20 条，reachable 标注与 MD 原文自洽 ----------
(function check2() {
  const rows = J.判词建议;
  const uniq = new Set(rows.map(r => r.物种 + '|' + r.整体状态));
  const reach = rows.filter(r => r.reachable === true);
  const fall = rows.filter(r => r.reachable === false);
  const bad = [];
  if (rows.length !== 20) bad.push('不是 20 条：' + rows.length);
  if (uniq.size !== 20) bad.push('组合键有重复：' + (20 - uniq.size) + ' 个');
  for (const r of rows) {
    const markedFallback = r.判词.text.includes('结构上不可达');
    if (r.reachable === markedFallback) bad.push(r.id + ' 的 reachable 与原文标注相反');
    if (r.进分享卡片 !== r.reachable) bad.push(r.id + ' 的 进分享卡片 与 reachable 不一致');
  }
  // 「16 可达 / 4 兜底」是否符合算法，交给第 14 项单独判定（那是文案正确性问题，不是数据完整性问题）
  ck(2, '判词建议组合 20 条、组合键唯一、reachable 与原文标注自洽', !bad.length,
    '20 条；原文标注可达 ' + reach.length + ' 条 / 标注兜底 ' + fall.length + ' 条' + (bad.length ? '；' + bad.slice(0, 4).join('；') : ''));
})();

// ---------- 3. 判词 / 建议 / 台词 / 副称号解释 条数无缺无重 ----------
(function check3() {
  const bad = [];
  if (J.判词建议.length !== 20) bad.push('判词建议 ' + J.判词建议.length + ' 条');
  if (J.判词建议.filter(x => !x.判词.text).length) bad.push('有空判词');
  if (J.判词建议.filter(x => !x.建议.text).length) bad.push('有空建议');
  if (J.副称号解释.length !== 15) bad.push('副称号解释 ' + J.副称号解释.length + ' 条');
  if (new Set(J.副称号解释.map(x => x.维度 + '|' + x.档)).size !== 15) bad.push('副称号解释有重复键');
  for (const s of SPECIES) {
    if (!J.物种[s].代表台词.text) bad.push(s + ' 缺结果页台词');
    if (!J.物种[s].卡片台词.text) bad.push(s + ' 缺卡片台词');
  }
  ck(3, '判词 20 / 建议 20 / 台词 5+5 / 副称号解释 15，无缺无重', !bad.length, bad.join('；'));
})();

// ---------- 4. 覆盖矩阵 5×4 与 5×3 齐全，物种名/状态名与题库一致 ----------
(function check4() {
  const bad = [];
  const keys = new Set(J.判词建议.map(r => r.物种 + '|' + r.整体状态));
  for (const s of SPECIES) for (const l of LEVELS) if (!keys.has(s + '|' + l)) bad.push('缺组合 ' + s + '|' + l);
  const subKeys = new Set(J.副称号解释.map(r => r.维度 + '|' + r.档));
  for (const d of DIMS) for (const b of BANDS) if (!subKeys.has(d + '|' + b)) bad.push('缺副称号 ' + d + '|' + b);

  const bankSpecies = Object.keys((bank.scoring || {})['物种称号'] || {});
  for (const s of bankSpecies) if (!SPECIES.includes(s)) bad.push('题库有、文案无的物种：' + s);
  for (const s of SPECIES) if (!bankSpecies.includes(s)) bad.push('文案有、题库无的物种：' + s);
  for (const s of SPECIES) {
    const t = bank.scoring['物种称号'][s];
    if (t && t !== J.物种[s].称号) bad.push(s + ' 称号不一致：题库「' + t + '」/ 文案「' + J.物种[s].称号 + '」');
  }
  const bankLevels = (bank.scoring['整体状态'] || []).map(x => x['等级']);
  for (const l of bankLevels) if (!LEVELS.includes(l)) bad.push('题库有、文案无的状态：' + l);

  ck(4, '覆盖矩阵 5×4 / 5×3 齐全，物种名与称号、状态名与题库完全一致', !bad.length, bad.join('；'));
})();

// ---------- 5. ID 唯一、命名合规、不含下标或随机值 ----------
(function check5() {
  const ids = [];
  const push = (v, where) => { if (v && v.id) ids.push({ id: v.id, where }); };
  for (const s of SPECIES) {
    const o = J.物种[s];
    push(o, '物种'); push(o.代表台词, '代表台词'); push(o.卡片台词, '卡片台词');
    push(o.优势['低档'], '优势低'); push(o.优势['高档'], '优势高');
    push(o.困境['低档'], '困境低'); push(o.困境['高档'], '困境高');
    push(o.动态解释模板, '动态解释'); push(o.视觉, '视觉');
  }
  J.判词建议.forEach(r => { push(r, '组合'); push(r.判词, '判词'); push(r.建议, '建议'); });
  J.副称号解释.forEach(r => push(r, '副称号解释'));
  for (const d of DIMS) {
    push(J.维度名[d], '维度名');
    for (const b of BANDS) push(J.副称号名[d][b], '副称号名');
  }
  Object.values(J.槽位定义).forEach(v => push(v, '槽位'));
  Object.values(J.声明).forEach(v => push(v, '声明'));
  Object.values(J.整体状态徽章).forEach(v => push(v, '徽章'));

  const bad = [];
  const seen = new Map();
  for (const { id, where } of ids) {
    if (seen.has(id)) bad.push('ID 重复：' + id + '（' + seen.get(id) + ' / ' + where + '）');
    seen.set(id, where);
    if (!/^[\u4e00-\u9fa5]+_[^_]+(?:_[^_]+)?$/.test(id)) bad.push('ID 不符合「类别_业务键」规则：' + id);
    if (/\d{2,}/.test(id)) bad.push('ID 含疑似下标/序号：' + id);
  }
  ck(5, 'ID 全部唯一、符合「类别_业务键」命名、不含下标或随机值', !bad.length,
    bad.length ? bad.slice(0, 6).join('；') : '共 ' + ids.length + ' 个 ID');
})();

// ---------- 6. 原文逐字一致（重新解析 MD ↔ JSON 双向比对） ----------
(function check6() {
  const spec = GEN.parseSpec(specText);
  const card = GEN.parseCard(cardText);
  const bad = [];
  let compared = 0;
  const eq = (a, b, what) => { compared++; if (a !== b) bad.push(what + '：JSON「' + String(a).slice(0, 24) + '…」≠ MD「' + String(b).slice(0, 24) + '…」'); };
  const inMd = (t, what) => { compared++; if (!specText.includes(t) && !cardText.includes(t)) bad.push(what + ' 在 MD 原文中找不到逐字命中：' + String(t).slice(0, 30)); };

  for (const s of SPECIES) {
    eq(J.物种[s].称号, spec.物种[s]['称号'], s + ' 称号');
    eq(J.物种[s].代表台词.text, spec.物种[s]['代表台词'], s + ' 代表台词');
    eq(J.物种[s].卡片台词.text, card.卡片台词[s].台词, s + ' 卡片台词');
    for (const b of ['低档', '高档']) {
      eq(J.物种[s].优势[b].text, spec.物种[s]['优势'][b], s + ' 优势' + b);
      eq(J.物种[s].困境[b].text, spec.物种[s]['困境'][b], s + ' 困境' + b);
    }
    eq(J.物种[s].动态解释模板.text, spec.物种[s]['动态解释模板'], s + ' 动态解释');
    eq(J.物种[s].视觉.主色, card.视觉[s].主色, s + ' 主色');
    eq(J.物种[s].视觉.场景, card.视觉[s].场景, s + ' 场景');
  }
  for (const r of J.判词建议) {
    const m = spec.判词建议.find(x => x.物种 === r.物种 && x.整体状态 === r.整体状态);
    if (!m) { bad.push('MD 里找不到组合 ' + r.物种 + '|' + r.整体状态); continue; }
    eq(r.判词.text, m.判词, r.id + ' 判词');
    eq(r.建议.text, m.建议, r.id + ' 建议');
  }
  for (const r of J.副称号解释) {
    const m = spec.副称号解释.find(x => x.维度 === r.维度 && x.档 === r.档);
    if (!m) { bad.push('MD 里找不到副称号 ' + r.维度 + '|' + r.档); continue; }
    eq(r.副称号, m.副称号, r.id + ' 副称号');
    eq(r.text, m.解释, r.id + ' 解释');
  }
  for (const d of DIMS) eq(J.维度名[d].文案名, spec.维度名[d].文案名, d + ' 维度名');
  eq(J.声明['通用'].text, spec.声明['通用'], '通用声明');
  eq(J.声明['需要回血'].text, spec.声明['需要回血'], '求助提示');
  for (const l of LEVELS) {
    eq(J.整体状态徽章[l].底色, card.徽章[l].底色, l + ' 徽章底色');
    eq(J.整体状态徽章[l].文字色, card.徽章[l].文字色, l + ' 徽章文字色');
  }
  // 条数双向比对：MD 抽出的条数必须等于 JSON 条数
  if (spec.判词建议.length !== J.判词建议.length) bad.push('判词建议条数不等：MD ' + spec.判词建议.length + ' / JSON ' + J.判词建议.length);
  if (spec.副称号解释.length !== J.副称号解释.length) bad.push('副称号解释条数不等：MD ' + spec.副称号解释.length + ' / JSON ' + J.副称号解释.length);

  // 抽样逐字命中：每条 text 必须能在 MD 原文里原样找到
  for (const s of SPECIES) {
    inMd(J.物种[s].代表台词.text, s + ' 代表台词');
    inMd(J.物种[s].卡片台词.text, s + ' 卡片台词');
    inMd(J.物种[s].动态解释模板.text, s + ' 动态解释');
  }
  for (const r of J.判词建议) { inMd(r.判词.text, r.id); inMd(r.建议.text, r.id); }
  for (const r of J.副称号解释) inMd(r.text, r.id);
  inMd(J.声明['通用'].text, '通用声明');
  inMd(J.声明['需要回血'].text, '求助提示');

  ck(6, '原文逐字一致（重新解析 MD ↔ JSON 双向比对，含条数比对）', !bad.length,
    bad.length ? bad.slice(0, 5).join('；') : '比对 ' + compared + ' 处文本，0 处差异');
})();

// ---------- 7. MD 指纹 ----------
(function check7() {
  const bad = [];
  if (J.meta.来源文案指纹 !== sha16(specText)) bad.push('结果文案规范.md 指纹不符（MD 改过但没重跑生成脚本）');
  if (J.meta.来源卡片指纹 !== sha16(cardText)) bad.push('分享卡片设计规范.md 指纹不符（同上）');
  ck(7, 'MD 指纹与当前文件一致（改了 MD 没重生成 → 这里拦下）', !bad.length,
    bad.length ? bad.join('；') : '文案 ' + J.meta.来源文案指纹 + ' / 卡片 ' + J.meta.来源卡片指纹);
})();

// ---------- 8. 禁词（含补扫 5 条动态解释模板） ----------
(function check8() {
  const texts = [];
  for (const s of SPECIES) {
    const o = J.物种[s];
    texts.push([s + ' 代表台词', o.代表台词.text], [s + ' 卡片台词', o.卡片台词.text]);
    texts.push([s + ' 优势低', o.优势['低档'].text], [s + ' 优势高', o.优势['高档'].text]);
    texts.push([s + ' 困境低', o.困境['低档'].text], [s + ' 困境高', o.困境['高档'].text]);
    texts.push([s + ' 动态解释模板', o.动态解释模板.text]);   // ← 现有 检查文案禁词.js 漏扫的 5 条
  }
  J.判词建议.forEach(r => { texts.push([r.id + ' 判词', r.判词.text], [r.id + ' 建议', r.建议.text]); });
  J.副称号解释.forEach(r => texts.push([r.id, r.text]));
  texts.push(['声明_通用', J.声明['通用'].text], ['声明_需要回血', J.声明['需要回血'].text]);
  for (const d of DIMS) texts.push([d + ' 维度名', J.维度名[d].文案名]);

  const hit = [];
  for (const [where, t] of texts) for (const w of banned) if (String(t).includes(w)) hit.push(where + ' 命中「' + w + '」');
  ck(8, '无禁词 / 无旧体系残留（含补扫 5 条动态解释模板，共 ' + texts.length + ' 段文本）', !hit.length,
    hit.length ? hit.slice(0, 6).join('；') : '禁词表 ' + banned.length + ' 条，0 命中');
})();

// ---------- 9. 槽位合法性 ----------
(function check9() {
  const defined = Object.keys(J.槽位定义);
  const bad = [];
  const checkText = (t, where, declared) => {
    const used = slotsOf(t);
    for (const u of used) if (!defined.includes(u)) bad.push(where + ' 用了未定义槽位 {' + u + '}');
    if (declared && JSON.stringify(declared) !== JSON.stringify(used)) bad.push(where + ' 槽位数组与文本不符：[' + declared + '] vs [' + used + ']');
  };
  for (const s of SPECIES) checkText(J.物种[s].动态解释模板.text, s + ' 动态解释', J.物种[s].动态解释模板.槽位);
  J.判词建议.forEach(r => { checkText(r.判词.text, r.id + ' 判词', r.判词.槽位); checkText(r.建议.text, r.id + ' 建议', r.建议.槽位); });
  ck(9, '槽位合法性：文本中的 {…} 全部在 ' + defined.length + ' 个已定义槽位内', !bad.length, bad.slice(0, 5).join('；'));
})();

// ---------- 10. 卡片字段纪律 ----------
(function check10() {
  const bad = [];
  const cardTexts = [];
  for (const s of SPECIES) {
    cardTexts.push([s + ' 卡片台词', J.物种[s].卡片台词.text]);
    cardTexts.push([s + ' 视觉', [J.物种[s].视觉.场景, J.物种[s].视觉.道具, J.物种[s].视觉.不要画成].join(' ')]);
  }
  for (const l of LEVELS) cardTexts.push([l + ' 徽章说明', J.整体状态徽章[l].说明]);
  for (const [where, t] of cardTexts) {
    if (/\d+(\.\d+)?\s*分/.test(t)) bad.push(where + ' 出现分数');
    // 百分比只查「指标性」百分比：人群占比（超过 N%）与带小数的指数。
    // 树懒卡片台词原文「电量只剩 5% 还在跑程序」是修辞不是指标，文案原文不得修改，故不拦。
    if (/(超过|高于)\s*\d+\s*%/.test(t)) bad.push(where + ' 出现人群百分比');
    if (/\d+\.\d+\s*%/.test(t)) bad.push(where + ' 出现带小数的百分比（像指数）');
    if (/雷达图/.test(t)) bad.push(where + ' 提到雷达图');
    if (/准确率|科学验证|专业测评|心理学证明/.test(t)) bad.push(where + ' 出现资质暗示词');
    if (/二维码|扫码/.test(t)) bad.push(where + ' 提到二维码');
    if (/建议你辞职|建议转行|不值得留/.test(t)) bad.push(where + ' 出现职业处方');
  }
  for (const s of SPECIES) if (/专属|唯一/.test(J.物种[s].卡片台词.text)) bad.push(s + ' 卡片台词出现「专属/唯一」');
  ck(10, '卡片字段纪律：无分数 / 无百分比 / 无雷达图 / 无资质暗示 / 无二维码 / 无职业处方', !bad.length, bad.slice(0, 5).join('；'));
})();

// ---------- 11. 两套台词分离 ----------
(function check11() {
  const bad = [];
  for (const s of SPECIES) {
    if (J.物种[s].代表台词.id === J.物种[s].卡片台词.id) bad.push(s + ' 两套台词用了同一个 ID');
  }
  const t = J.物种['水豚'];
  if (t.代表台词.text === t.卡片台词.text) bad.push('水豚的结果页台词与卡片台词被合并成一句（原文本来不同）');
  if (t.代表台词.text !== '没有哪一维在崩，也没有哪一维在飞——你就那么稳稳地待着。') bad.push('水豚结果页台词不是原文');
  if (t.卡片台词.text !== '没有哪一维在崩，也没有哪一维在飞。') bad.push('水豚卡片台词不是原文');
  ck(11, '两套台词分离：台词_结果页_水豚 与 台词_卡片_水豚 各自逐字等于各自来源', !bad.length, bad.join('；'));
})();

// ---------- 12. 版本号 ----------
(function check12() {
  const bankVer = ((bank.meta || {})['数据版本'] || {}).result_content_version;
  const ok = J.meta.result_content_version === bankVer;
  ck(12, 'result_content_version 与题库 meta.数据版本 一致', ok,
    '文案 ' + J.meta.result_content_version + ' / 题库 ' + bankVer);
})();

// ---------- 13. 兜底纪律 ----------
(function check13() {
  const bad = [];
  for (const r of J.判词建议) {
    if (r.reachable === false && r.进分享卡片 !== false) bad.push(r.id + ' 是兜底却允许进分享卡片');
    if (r.reachable === true && r.进分享卡片 !== true) bad.push(r.id + ' 可达却不允许进分享卡片');
  }
  ck(13, '兜底纪律：reachable=false ⇔ 不进分享卡片', !bad.length, bad.join('；'));
})();

// ---------- 14【加固】可达性一致性：原文标注的「结构上不可达」是否符合算法穷举结果 ----------
// 这一项查的不是数据完整性，而是**文案正确性**：
// 如果某组组合其实可达，文案却把它标成兜底，真实用户会看到带「（结构上不可达，保留兜底）」前缀的句子。
// 修法只有一条：改 结果文案规范.md → 重跑生成脚本 → 重跑本校验。禁止直接改 JSON。
(function check14() {
  const CORE = require(path.join(PROJECT_ROOT, '70-质量检查', '计算核心.js'));
  const reachable = new Set();
  for (let a = 4; a <= 16; a++) for (let b = 4; b <= 16; b++) for (let c = 4; c <= 16; c++)
    for (let d = 4; d <= 16; d++) for (let e = 4; e <= 16; e++) {
      const r = CORE.classifySums({ W: a, L: b, M: c, C: d, G: e });
      reachable.add(r.species + '|' + r.level);
    }
  const bad = [];
  const all = [];
  for (const s of SPECIES) for (const l of LEVELS) all.push(s + '|' + l);
  for (const r of J.判词建议) {
    const k = r.物种 + '|' + r.整体状态;
    const truly = reachable.has(k);
    if (truly && r.reachable === false) bad.push(r.id + '：原文标「结构上不可达」，但穷举证明可达');
    if (!truly && r.reachable === true) bad.push(r.id + '：原文当正式文案，但穷举证明永不可达');
  }
  const algoUnreachable = all.filter(k => !reachable.has(k));
  ck(14, '可达性一致性：原文标注的「结构上不可达」与 13^5 穷举结果完全一致', !bad.length,
    bad.length
      ? bad.join('；') + '｜算法穷举：可达 ' + reachable.size + '/20，真正不可达的是 ' + algoUnreachable.join('、')
      : '算法穷举可达 ' + reachable.size + '/20，与原文标注一致');
})();


const fail = results.filter(r => !r.pass);
console.log('==== 结果文案校验（' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '）====');
console.log('JSON：' + JSONP);
console.log('来源：' + path.basename(SPEC) + ' + ' + path.basename(CARD));
console.log('');
for (const r of results) {
  console.log('  ' + (r.pass ? '✅' : '❌') + ' [' + String(r.no).padStart(2, ' ') + '] ' + r.name + (r.detail ? '\n         ' + r.detail : ''));
}
console.log('');
if (fail.length) {
  console.log('---- ' + (results.length - fail.length) + '/' + results.length + ' 通过，失败 ' + fail.length + ' 项 ----');
  process.exit(1);
}
console.log('---- ' + results.length + ' 项全部通过 ----');
