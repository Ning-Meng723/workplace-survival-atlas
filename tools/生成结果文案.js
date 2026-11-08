// tools/生成结果文案.js
// 用途：把两份「人工编辑源」Markdown 转成网页运行时数据 data/结果文案.json。
//
// 唯一人工编辑源：
//   20-测试内容/结果文案规范.md      （台词 / 优势 / 困境 / 动态解释 / 判词 / 建议 / 副称号解释 / 声明 / 维度名 / 槽位）
//   20-测试内容/分享卡片设计规范.md  （卡片台词 / 物种视觉 / 整体状态徽章配色）
//
// 纪律：
//   1. 只读 Markdown，不写、不改任何一个字；文本逐字搬运，不做任何润色、补全、去标点。
//   2. 本脚本是 JSON 的唯一生成者。改文案请改 MD，再重跑本脚本；**不要手改 JSON**。
//   3. 解析规则复用 70-质量检查/检查文案禁词.js 第 30–71 行的思路（标签行 + 表格行），
//      并补上该脚本漏掉的第四节「5 条动态解释模板」。
//
// 用法（在仓库根目录下）：
//   node "30-网页产品/web-v1/tools/生成结果文案.js"
// 退出码 0 = 生成成功；1 = 源文案结构变了、关键条目缺失（拒绝生成半成品）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const SPEC = path.join(PROJECT_ROOT, '20-测试内容', '结果文案规范.md');
const CARD = path.join(PROJECT_ROOT, '20-测试内容', '分享卡片设计规范.md');
const BANK = path.resolve(__dirname, '..', 'data', '题库.json');
const OUT = path.resolve(__dirname, '..', 'data', '结果文案.json');

// 【公开仓库说明】本脚本把 20-测试内容/ 的两份 Markdown 规范生成为 data/结果文案.json。
// 公开仓库只发布生成结果，不含源规范目录，这里提示跳过（生成物已在仓库里，无需重建）。
if (require.main === module && !fs.existsSync(SPEC)) {
  console.log('[跳过] 未找到 20-测试内容/结果文案规范.md（公开仓库不含私有源目录）。');
  console.log('       data/结果文案.json 已随仓库提供，页面可直接使用，无需重新生成。');
  process.exit(0);
}

const SPEC_REL = '20-测试内容/结果文案规范.md';
const CARD_REL = '20-测试内容/分享卡片设计规范.md';

const SPECIES = ['树懒', '炸毛猫', '水豚', '狐狸', '企鹅'];
const LEVELS = ['需要回血', '勉强维持', '基本在线', '状态不错'];
const DIMS = ['W', 'L', 'M', 'C', 'G'];
const BANDS = ['低', '中', '高'];
const BAND_KEY = { 低: 'low', 中: 'mid', 高: 'high' };
const sha16 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

// ---------- 表格与标签行解析（与 检查文案禁词.js 同款） ----------
function cells(line) {
  const parts = line.split('|');
  if (parts.length && parts[0].trim() === '') parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
  return parts.map(s => s.trim());
}
const COPY_LABEL = /^- \*\*(代表台词|优势 · 低档|优势 · 高档|困境 · 低档|困境 · 高档)\*\*：(.+)$/;
const slotsOf = (text) => {
  const seen = [];
  for (const m of String(text).matchAll(/\{([^{}]+)\}/g)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
};
const stripBold = (s) => String(s).replace(/\*\*/g, '');

// ---------- 解析 结果文案规范.md ----------
function parseSpec(text) {
  const out = { 维度名: {}, 槽位定义: {}, 物种: {}, 判词建议: [], 副称号解释: [], 声明: {} };
  let section = 0;
  let sp = null;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');

    const h1 = line.match(/^# ([一二三四五六七八九])、/);
    if (h1) { section = '一二三四五六七八九'.indexOf(h1[1]) + 1; sp = null; continue; }
    if (/^# /.test(line)) { section = 0; sp = null; continue; }

    const h2 = line.match(/^## (树懒|炸毛猫|水豚|狐狸|企鹅)型(?:\s*·\s*(.+))?$/);
    if (h2) {
      sp = h2[1];
      if (!out.物种[sp]) out.物种[sp] = {};
      if (h2[2]) out.物种[sp]['称号'] = h2[2].trim();
      continue;
    }
    if (/^## /.test(line)) { sp = null; continue; }

    // 三节：代表台词 / 优势 / 困境
    const lab = line.match(COPY_LABEL);
    if (lab && sp) {
      const key = lab[1];
      const s = lab[2].trim();
      if (key === '代表台词') out.物种[sp]['代表台词'] = s;
      else {
        const [group, band] = key.split(' · ');
        const g = group === '优势' ? '优势' : '困境';
        if (!out.物种[sp][g]) out.物种[sp][g] = {};
        out.物种[sp][g][band] = s;
      }
      continue;
    }

    // 七节：必备声明（不是表格行，必须放在表格过滤之前）
    const decl = line.match(/\*\*「([^」]+)」\*\*/);
    if (decl) {
      if (decl[1].includes('不构成职业建议')) out.声明['通用'] = decl[1];
      else if (decl[1].includes('持续失眠')) out.声明['需要回血'] = decl[1];
      continue;
    }

    if (!line.startsWith('|')) continue;
    const c = cells(line);
    if (c.length < 2) continue;
    const first = stripBold(c[0]);

    // 二节：五维中文名
    if (section === 2 && DIMS.includes(first) && c.length >= 3) {
      out.维度名[first] = { 文案名: c[1], 用户说法: c[2] };
      continue;
    }

    // 四节：槽位表
    if (section === 4 && /^`\{[^}]+\}`/.test(c[0])) {
      const keys = [...c[0].matchAll(/\{([^{}]+)\}/g)].map(m => m[1]);
      for (const k of keys) out.槽位定义[k] = { 内容: c[1] || '', 示例: c[2] || '' };
      continue;
    }

    // 四节：五种物种的解释模板
    if (section === 4 && SPECIES.includes(first) && c.length === 2) {
      if (!out.物种[first]) out.物种[first] = {};
      out.物种[first]['动态解释模板'] = c[1];
      continue;
    }

    // 五节：判词与建议
    if (section === 5 && sp && LEVELS.includes(first) && c.length >= 3) {
      out.判词建议.push({ 物种: sp, 整体状态: first, 判词: c[1], 建议: c[2] });
      continue;
    }

    // 六节：副称号解释
    if (section === 6 && DIMS.includes(first) && c.length >= 4 && BANDS.includes(c[1])) {
      out.副称号解释.push({ 维度: first, 档: c[1], 副称号: c[2], 解释: c[3] });
      continue;
    }
  }
  return out;
}

// ---------- 解析 分享卡片设计规范.md ----------
function parseCard(text) {
  const out = { 卡片台词: {}, 视觉: {}, 徽章: {} };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.startsWith('|')) continue;
    const c = cells(line);
    if (c.length < 3) continue;
    const first = stripBold(c[0]);

    // 四节：五个物种的卡片台词（3 列，第 2 列是「物种型 · 称号」）
    if (c.length === 3 && /型$/.test(first) && c[1].includes(' · ')) {
      const name = first.replace(/型$/, '');
      out.卡片台词[name] = { 台词: c[2], 物种称号行: c[1] };
      continue;
    }

    // 四节：五个物种的视觉（5 列）
    if (c.length === 5 && /型$/.test(first)) {
      const name = first.replace(/型$/, '');
      const hex = (c[1].match(/#[0-9A-Fa-f]{6}/) || [])[0] || '';
      out.视觉[name] = {
        主色: hex,
        色名: stripBold(c[1].replace(/`?#[0-9A-Fa-f]{6}`?/, '')).replace(/[（）()]/g, '').trim() || '',
        场景: c[2],
        道具: c[3],
        不要画成: c[4]
      };
      continue;
    }

    // 四节：整体状态徽章（4 列）
    if (c.length === 4 && LEVELS.includes(first)) {
      const bg = (c[1].match(/#[0-9A-Fa-f]{6}/) || [])[0] || '';
      const fg = (c[2].match(/#[0-9A-Fa-f]{6}/) || [])[0] || '';
      out.徽章[first] = { 底色: bg, 文字色: fg, 说明: c[3] };
    }
  }
  return out;
}

// ---------- 组装 ----------
function build() {
  const specText = fs.readFileSync(SPEC, 'utf8');
  const cardText = fs.readFileSync(CARD, 'utf8');
  const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));

  const spec = parseSpec(specText);
  const card = parseCard(cardText);

  // 生成前断言：源文案结构一变就停下，绝不产出半成品
  const bad = [];
  for (const s of SPECIES) {
    const o = spec.物种[s] || {};
    if (!o['称号']) bad.push(s + ' 缺称号（三节标题「## ' + s + '型 · 称号」）');
    if (!o['代表台词']) bad.push(s + ' 缺代表台词');
    if (!o['优势'] || !o['优势']['低档'] || !o['优势']['高档']) bad.push(s + ' 缺优势 低档/高档');
    if (!o['困境'] || !o['困境']['低档'] || !o['困境']['高档']) bad.push(s + ' 缺困境 低档/高档');
    if (!o['动态解释模板']) bad.push(s + ' 缺动态解释模板（四节表格）');
    if (!card.卡片台词[s]) bad.push(s + ' 缺卡片台词（卡片规范四节）');
    if (!card.视觉[s]) bad.push(s + ' 缺视觉描述（卡片规范四节）');
  }
  for (const d of DIMS) if (!spec.维度名[d]) bad.push('缺维度名：' + d);
  for (const k of ['最低维', '最低分', '最高维', '最高分', 'A', 'R']) if (!spec.槽位定义[k]) bad.push('缺槽位定义：' + k);
  if (spec.判词建议.length !== 20) bad.push('判词建议不是 20 行：' + spec.判词建议.length);
  if (spec.副称号解释.length !== 15) bad.push('副称号解释不是 15 条：' + spec.副称号解释.length);
  if (!spec.声明['通用']) bad.push('缺通用声明');
  if (!spec.声明['需要回血']) bad.push('缺需要回血求助提示');
  for (const l of LEVELS) if (!card.徽章[l]) bad.push('缺整体状态徽章：' + l);
  if (bad.length) {
    console.error('❌ 源文案结构不符合预期，已停止生成：');
    bad.forEach(b => console.error('  - ' + b));
    process.exit(1);
  }

  // ---- 物种 ----
  const 物种 = {};
  for (const s of SPECIES) {
    const o = spec.物种[s];
    const v = card.视觉[s];
    const decl = card.卡片台词[s];
    // 交叉核对：卡片规范里写的「X型 · 称号」必须与正文三节标题一致
    const titleInCard = decl.物种称号行.split(' · ')[1];
    if (titleInCard !== o['称号']) {
      console.error('❌ ' + s + ' 的称号在两份 MD 里不一致：结果文案规范「' + o['称号'] + '」/ 卡片规范「' + titleInCard + '」');
      process.exit(1);
    }
    物种[s] = {
      id: '物种_' + s,
      称号: o['称号'],
      代表台词: { id: '台词_结果页_' + s, text: o['代表台词'] },
      卡片台词: { id: '台词_卡片_' + s, text: decl.台词 },
      优势: {
        低档: { id: '优势_' + s + '_低档', text: o['优势']['低档'], 适用: 'A < 60' },
        高档: { id: '优势_' + s + '_高档', text: o['优势']['高档'], 适用: 'A >= 60' }
      },
      困境: {
        低档: { id: '困境_' + s + '_低档', text: o['困境']['低档'], 适用: 'A < 60' },
        高档: { id: '困境_' + s + '_高档', text: o['困境']['高档'], 适用: 'A >= 60' }
      },
      动态解释模板: { id: '动态解释_' + s, text: o['动态解释模板'], 槽位: slotsOf(o['动态解释模板']) },
      视觉: {
        id: '视觉_物种_' + s,
        主色: v.主色,
        色名: v.色名,
        场景: v.场景,
        道具: v.道具,
        不要画成: v.不要画成
      }
    };
  }

  // ---- 判词建议（20 组，4 组兜底 reachable=false） ----
  const 判词建议 = spec.判词建议.map(r => {
    const unreachable = r.判词.includes('结构上不可达');
    return {
      id: '组合_' + r.物种 + '_' + r.整体状态,
      物种: r.物种,
      整体状态: r.整体状态,
      reachable: !unreachable,
      进分享卡片: !unreachable,
      判词: { id: '判词_' + r.物种 + '_' + r.整体状态, text: r.判词, 槽位: slotsOf(r.判词) },
      建议: { id: '建议_' + r.物种 + '_' + r.整体状态, text: r.建议, 槽位: slotsOf(r.建议) }
    };
  });

  // ---- 副称号解释 ----
  const 副称号解释 = spec.副称号解释.map(r => ({
    id: '副称号解释_' + r.维度 + '_' + r.档,
    维度: r.维度,
    档: r.档,
    档位键: BAND_KEY[r.档],
    副称号: r.副称号,
    text: r.解释
  }));

  // ---- 副称号名（与 题库.json scoring 交叉核对） ----
  const 副称号名 = {};
  for (const d of DIMS) {
    副称号名[d] = {};
    for (const b of BANDS) {
      const row = 副称号解释.find(x => x.维度 === d && x.档 === b);
      副称号名[d][b] = { id: '副称号名_' + d + '_' + b, 名称: row.副称号, 档位键: BAND_KEY[b] };
    }
  }
  const bankTable = (((bank.scoring || {})['副称号'] || {})['第二步_查表']) || {};
  const bankKey = { 低: '低于40', 中: '40-69', 高: '70及以上' };
  for (const d of DIMS) for (const b of BANDS) {
    const expect = (bankTable[d] || {})[bankKey[b]];
    if (expect && expect !== 副称号名[d][b].名称) {
      console.error('❌ 副称号不一致：' + d + '/' + b + ' 文案规范「' + 副称号名[d][b].名称 + '」vs 题库「' + expect + '」');
      process.exit(1);
    }
  }

  // ---- 维度名 ----
  const 维度名 = {};
  for (const d of DIMS) {
    维度名[d] = { id: '维度名_' + d, 文案名: spec.维度名[d].文案名, 用户说法: spec.维度名[d].用户说法 };
  }

  // ---- 槽位定义 ----
  const 槽位定义 = {};
  for (const [k, v] of Object.entries(spec.槽位定义)) {
    槽位定义[k] = { id: '槽位_' + k, 内容: v.内容, 示例: v.示例 };
  }

  // ---- 声明 ----
  const 声明 = {
    通用: { id: '声明_通用', text: spec.声明['通用'] },
    需要回血: { id: '声明_需要回血', text: spec.声明['需要回血'] }
  };

  // ---- 整体状态徽章 ----
  const 整体状态徽章 = {};
  for (const l of LEVELS) {
    整体状态徽章[l] = {
      id: '视觉_徽章_' + l,
      底色: card.徽章[l].底色,
      文字色: card.徽章[l].文字色,
      说明: card.徽章[l].说明
    };
  }

  // ---- 索引 ----
  const 按物种 = {};
  for (const s of SPECIES) {
    按物种[s] = [
      '物种_' + s,
      '台词_结果页_' + s,
      '台词_卡片_' + s,
      '优势_' + s + '_低档', '优势_' + s + '_高档',
      '困境_' + s + '_低档', '困境_' + s + '_高档',
      '动态解释_' + s,
      '视觉_物种_' + s
    ].concat(判词建议.filter(x => x.物种 === s).map(x => x.id));
  }
  const 按组合键 = {};
  判词建议.forEach(x => { 按组合键[x.物种 + '|' + x.整体状态] = x.id; });
  const 按副称号键 = {};
  副称号解释.forEach(x => { 按副称号键[x.维度 + '|' + x.档] = x.id; });

  // ---- 统计（85 条核心文案的构成） ----
  const 统计 = {
    核心文案总数: 25 + spec.判词建议.length * 2 + 副称号解释.length + 5,
    代表台词: 5,
    优势: 10,
    困境: 10,
    判词: 20,
    建议: 20,
    副称号解释: 副称号解释.length,
    卡片台词: 5,
    判词建议组合: 判词建议.length,
    兜底组合: 判词建议.filter(x => x.reachable === false).length
  };

  return {
    meta: {
      _警告: '本文件由脚本生成，禁止手工编辑。改文案请改 Markdown 后重跑 tools/生成结果文案.js',
      来源文案: SPEC_REL,
      来源文案指纹: sha16(specText),
      来源卡片: CARD_REL,
      来源卡片指纹: sha16(cardText),
      生成脚本: '30-网页产品/web-v1/tools/生成结果文案.js',
      result_content_version: ((bank.meta || {})['数据版本'] || {}).result_content_version,
      禁止手工编辑: true,
      说明: '本文件由脚本从 Markdown 生成，任何修改请改 Markdown 后重跑生成脚本；重新生成结果可复现（不含时间戳）',
      统计
    },
    维度名,
    槽位定义,
    副称号档位映射: BAND_KEY,
    物种,
    判词建议,
    副称号解释,
    副称号名,
    声明,
    整体状态徽章,
    索引: { 按物种, 按组合键, 按副称号键 }
  };
}

function serialize(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

if (require.main === module) {
  const data = build();
  fs.writeFileSync(OUT, serialize(data), 'utf8');
  const m = data.meta.统计;
  console.log('✅ 已生成 ' + OUT);
  console.log('   来源文案指纹 ' + data.meta.来源文案指纹 + ' / 来源卡片指纹 ' + data.meta.来源卡片指纹);
  console.log('   核心文案 ' + m.核心文案总数 + ' 条 = 台词 ' + m.代表台词 + ' + 优势 ' + m.优势 + ' + 困境 ' + m.困境
    + ' + 判词 ' + m.判词 + ' + 建议 ' + m.建议 + ' + 副称号解释 ' + m.副称号解释 + ' + 卡片台词 ' + m.卡片台词);
  console.log('   判词建议组合 ' + m.判词建议组合 + ' 条（其中兜底 ' + m.兜底组合 + ' 条 reachable=false）');
  console.log('   result_content_version ' + data.meta.result_content_version);
}

module.exports = { build, serialize, parseSpec, parseCard, slotsOf, cells, SPECIES, LEVELS, DIMS, BANDS };
