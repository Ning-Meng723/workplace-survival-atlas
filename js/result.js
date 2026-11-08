// 结果页渲染模块 v1.0（W07 结果页 + W08 分享卡片）
//
// 数据纪律：
//   1. 只吃「计分模块算好的那一份结果对象」(WorkplaceScoring.scoreBank 的返回值)，
//      本文件不重算任何分数、不重新判定物种/状态/副称号。
//   2. 文案只吃 data/结果文案.json（由 结果文案规范.md 生成），页面代码里没有一句正式文案。
//   3. 槽位只认文案规范四节定义的 6 个：最低维 / 最低分 / 最高维 / 最高分 / A / R；
//      维度槽填「维度名称」不填数字（N12 已修正源文件）。
//   4. 结果页按 产品规则说明书 九节 7 模块固定顺序渲染；分享卡按 分享卡片设计规范 五层信息绘制。
//   5. ES5 为主，Node 与浏览器双导出；浏览器 <script> 后挂 window.WorkplaceResult。
(function (factory) {
  var API = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = API;
  else if (typeof window !== 'undefined') window.WorkplaceResult = API;
})(function () {
  'use strict';

  var DIMS = ['W', 'L', 'M', 'C', 'G'];       // 并列时的固定优先级，也是雷达图的轴顺序
  var SLOT_KEYS = ['最低维', '最低分', '最高维', '最高分', 'A', 'R'];
  var MODULE_ORDER = [1, 2, 3, 4, 5, 6, 7];
  var VERSION_KEYS = ['product_id', 'question_version', 'scoring_version',
                      'algorithm_version', 'result_content_version'];
  var CARD_W = 1080, CARD_H = 1440;
  var CARD_SAFE_X = 72;                       // 左右安全区
  var CARD_SAFE_BOTTOM = 200;                 // 底部 200px 内不放关键信息
  var CARD_FONT = '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif';
  var SVG_FONT = "'PingFang SC','Microsoft YaHei',sans-serif";   // SVG 属性里不能出现双引号
  var SPECIES_FILE = { '树懒': '树懒', '炸毛猫': '炸毛猫', '水豚': '水豚', '狐狸': '狐狸', '企鹅': '企鹅' };

  function keys(o) { return Object.prototype.toString.call(o) === '[object Object]' ? Object.keys(o) : []; }
  function arr(o) { return Object.prototype.toString.call(o) === '[object Array]' ? o : []; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function f1(v) { return num(v).toFixed(1); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /** 极简加粗：只处理 `**…**`，其余一律转义后原样输出 */
  function rich(s) {
    var parts = String(s == null ? '' : s).split('**'), out = '', i;
    for (i = 0; i < parts.length; i++) {
      out += (i % 2 === 1) ? '<strong>' + esc(parts[i]) + '</strong>' : esc(parts[i]);
    }
    return out;
  }
  /** 只认 6 个已定义槽位；未知/缺失槽位原样保留，并回报给验收脚本 */
  function fillSlots(text, slots, report) {
    return String(text == null ? '' : text).replace(/\{([^{}]+)\}/g, function (all, k) {
      if (SLOT_KEYS.indexOf(k) < 0) { if (report) report.unknown.push(k); return all; }
      if (!Object.prototype.hasOwnProperty.call(slots, k)) { if (report) report.missing.push(k); return all; }
      if (report && report.used.indexOf(k) < 0) report.used.push(k);
      return String(slots[k]);
    });
  }
  /** 剥掉兜底文案里的内部说明（不是正式文案，不进分享卡片） */
  function stripInternal(s) {
    return String(s == null ? '' : s).replace(/^（结构上不可达，保留兜底）\s*/, '');
  }
  function findBy(list, pred) {
    var a = arr(list);
    for (var i = 0; i < a.length; i++) if (pred(a[i])) return a[i];
    return null;
  }

  // ------------------------------------------------------------------
  // 1) 构建结果页数据模型（纯数据，不碰 DOM、不算分）
  // ------------------------------------------------------------------
  function buildModel(result, copy) {
    var problems = [];
    if (!result || !copy) return { ok: false, problems: ['缺结果对象或文案 JSON'] };

    var species = result.species;
    var level = result.overallLevel;
    var sp = (copy.物种 || {})[species] || null;
    var combo = findBy(copy.判词建议, function (x) {
      return x.物种 === species && x.整体状态 === level;
    });
    if (!sp) problems.push('文案 JSON 里没有物种：' + species);
    if (!combo) problems.push('文案 JSON 里没有组合：' + species + ' × ' + level);

    // 维度数据：value 用计分模块的精确值；display 统一 1 位小数（格式化，不是重算）
    var dims = [], i, d, v;
    for (i = 0; i < DIMS.length; i++) {
      d = DIMS[i];
      v = num((result.dims || {})[d]);
      dims.push({
        dim: d,
        name: ((copy.维度名 || {})[d] || {}).文案名 || d,
        value: v,
        display: f1(v),
        color: ((copy.物种 || {})[species] || {}).视觉
      });
    }
    // 并列：严格按 W→L→M→C→G 取第一个（与副称号规则一致）
    var low = dims[0], high = dims[0];
    for (i = 1; i < dims.length; i++) {
      if (dims[i].value < low.value) low = dims[i];
      if (dims[i].value > high.value) high = dims[i];
    }
    var dimName = function (x) { return x.name + '指数'; };  // N12：填维度名称，不是数字

    var slots = {
      '最低维': dimName(low),
      '最低分': low.display,
      '最高维': dimName(high),
      '最高分': high.display,
      'A': f1(result.A_display != null ? result.A_display : result.A),
      'R': f1(result.R_display != null ? result.R_display : result.R)
    };
    var report = { used: [], unknown: [], missing: [] };

    var band = result.subTitleBand || 'mid';
    var subExplain = findBy(copy.副称号解释, function (x) {
      return x.维度 === result.subTitleDim && x.档位键 === band;
    });
    var bandKey = num(result.A) < 60 ? '低档' : '高档';   // 优势/困境按平均分分两版
    var badge = (copy.整体状态徽章 || {})[level] || { 底色: '#E6E2D6', 文字色: '#6B6355' };
    var decl = arr([(copy.声明 || {}).通用]).concat(level === '需要回血' ? arr([(copy.声明 || {}).需要回血]) : []);

    var versions = VERSION_KEYS.map(function (k) {
      return { key: k, value: (result.versions || {})[k] || '' };
    });

    var model = {
      ok: problems.length === 0,
      problems: problems,
      slots: slots,
      slotReport: report,
      modules: MODULE_ORDER.slice(),
      species: species,
      speciesTitle: sp ? sp.称号 : '',
      speciesColor: (sp && sp.视觉 && sp.视觉.主色) || '#7A8B7A',
      speciesSvg: 'assets/species/' + (SPECIES_FILE[species] || species) + '.svg',
      subTitle: result.subTitle || '',
      subTitleDim: result.subTitleDim || '',
      subTitleBand: band,
      subTitleExplain: subExplain ? subExplain.text : '',
      quote: sp && sp.代表台词 ? sp.代表台词.text : '',
      cardQuote: sp && sp.卡片台词 ? sp.卡片台词.text : '',
      dims: dims,
      lowDim: low.dim,
      highDim: high.dim,
      answerCount: result.answerCount || null,   // UX02：有跳过时才有，各维有效回答数
      totalSkipped: num(result.totalSkipped),    // UX02：跳过题数，0 表示全答
      partial: !!result.partial,
      A: f1(result.A_display != null ? result.A_display : result.A),
      R: f1(result.R_display != null ? result.R_display : result.R),
      level: level,
      badge: badge,
      verdict: combo ? fillSlots(stripInternal(combo.判词.text), slots, report) : '',
      verdictId: combo ? combo.判词.id : '',
      reachable: combo ? !!combo.reachable : false,
      inCard: combo ? !!combo.进分享卡片 : false,
      advantage: sp && sp.优势 && sp.优势[bandKey] ? rich(sp.优势[bandKey].text) : '',
      difficulty: sp && sp.困境 && sp.困境[bandKey] ? rich(sp.困境[bandKey].text) : '',
      advice: combo ? rich(combo.建议.text) : '',
      adviceId: combo ? combo.建议.id : '',
      dynamic: sp && sp.动态解释模板 ? rich(fillSlots(sp.动态解释模板.text, slots, report)) : '',
      declarations: decl.filter(Boolean).map(function (x) { return { id: x.id, text: x.text }; }),
      versions: versions,
      resultRaw: result
    };
    return model;
  }

  // ------------------------------------------------------------------
  // 2) 内联 SVG 雷达图：顶点坐标与分数区数字同源（data-value）
  // ------------------------------------------------------------------
  function radarSvg(model) {
    var cx = 180, cy = 155, R = 88;
    var angle = function (i) { return -Math.PI / 2 + i * 2 * Math.PI / 5; };
    var pt = function (i, r) {
      var a = angle(i);
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    var fmt = function (n) { return (Math.round(n * 10) / 10).toFixed(1); };
    var poly = function (r) {
      var out = [], i, p;
      for (i = 0; i < 5; i++) { p = pt(i, r); out.push(fmt(p[0]) + ',' + fmt(p[1])); }
      return out.join(' ');
    };
    // 内联 SVG 不写 xmlns：HTML 解析器会补上，且不产生任何字符串形式的外部 URL
    var s = '<svg class="radar" viewBox="0 0 360 320" role="img" ' +
            'aria-label="五维状态雷达图，数值与下方分数条一致">';
    // 网格环 25 / 50 / 75 / 100
    for (var ring = 1; ring <= 4; ring++) {
      s += '<polygon points="' + poly(R * ring / 4) + '" fill="' + (ring === 4 ? '#FFFFFF' : 'none') +
           '" stroke="rgba(42,39,36,' + (ring === 4 ? '0.22' : '0.10') + ')" stroke-width="1"/>';
    }
    // 轴线
    for (var i = 0; i < 5; i++) {
      var p = pt(i, R);
      s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + fmt(p[0]) + '" y2="' + fmt(p[1]) +
           '" stroke="rgba(42,39,36,0.10)" stroke-width="1"/>';
    }
    // 数据多边形：半径严格由 dims[i].value 换算
    var dataPts = [], dp;
    for (var j = 0; j < 5; j++) {
      dp = pt(j, R * Math.max(0, Math.min(100, model.dims[j].value)) / 100);
      dataPts.push(fmt(dp[0]) + ',' + fmt(dp[1]));
    }
    s += '<polygon points="' + dataPts.join(' ') + '" fill="' + model.speciesColor + '" fill-opacity="0.28" ' +
         'stroke="' + model.speciesColor + '" stroke-width="2.5" stroke-linejoin="round"/>';
    // 顶点 + 维度名标签（data-value 与分数区同源）
    for (var k = 0; k < 5; k++) {
      var q = pt(k, R * Math.max(0, Math.min(100, model.dims[k].value)) / 100);
      s += '<circle class="radar-dot" data-dim="' + model.dims[k].dim + '" data-value="' +
           model.dims[k].display + '" cx="' + fmt(q[0]) + '" cy="' + fmt(q[1]) +
           '" r="4.5" fill="' + model.speciesColor + '" stroke="#FFFFFF" stroke-width="2"/>';
      var lp = pt(k, R + 17), anchor = 'middle', dx = 0;
      if (lp[0] > cx + 12) { anchor = 'start'; dx = 2; }
      else if (lp[0] < cx - 12) { anchor = 'end'; dx = -2; }
      s += '<text x="' + fmt(lp[0] + dx) + '" y="' + fmt(lp[1] + 4) + '" text-anchor="' + anchor +
           '" font-size="11" fill="#6B6355" font-family="' + SVG_FONT + '">' +
           esc(model.dims[k].name) + '</text>';
    }
    s += '</svg>';
    return s;
  }

  // ------------------------------------------------------------------
  // 3) 渲染到已存在的结果页骨架（只填内容，不重建 7 模块 DOM）
  // ------------------------------------------------------------------
  function render(model, root) {
    // root 既可能是 document（nodeType 9），也可能是某个元素；两者的 ownerDocument 取值不同
    var isDoc = !!(root && root.nodeType === 9);
    var doc = isDoc ? root
            : ((root && root.ownerDocument) || (typeof document !== 'undefined' ? document : null));
    if (!doc) return false;
    var scope = (root && root.querySelector) ? root : doc;
    var $ = function (id) { return scope.querySelector('#' + id) || doc.getElementById(id); };
    var set = function (id, html) { var el = $(id); if (el) el.innerHTML = html; };
    var txt = function (id, v) { var el = $(id); if (el) el.textContent = String(v == null ? '' : v); };

    // 模块 1
    var hero = $('result-hero-img');
    if (hero) { hero.setAttribute('src', model.speciesSvg); hero.setAttribute('alt', model.species + '型 占位图'); }
    txt('result-species', model.species + '型');
    txt('result-species-title', model.speciesTitle);
    txt('result-subtitle', model.subTitle);
    txt('result-subtitle-explain', model.subTitleExplain);

    // 模块 2
    txt('result-quote', model.quote);

    // 模块 3：雷达图 + 五维分数 + 动态解释
    set('radar-wrap', radarSvg(model));
    var li = '', i, d, w;
    for (i = 0; i < model.dims.length; i++) {
      d = model.dims[i];
      w = Math.max(0, Math.min(100, d.value));
      var c = model.answerCount ? num(model.answerCount[d.dim]) : 0;
      li += '<li class="dim-row" data-dim="' + d.dim + '" data-value="' + d.display + '"' +
              (model.answerCount ? ' data-count="' + c + '"' : '') + '>' +
              '<span class="dim-name">' + esc(d.name) + '指数</span>' +
              '<span class="dim-bar"><i style="width:' + f1(w) + '%"></i></span>' +
              '<b class="dim-num">' + d.display + '</b>' +
              (model.answerCount
                ? '<span class="dim-count' + (c < 4 ? ' is-less' : '') + '" title="该维度有效回答 ' + c + ' 题">' + c + '/4 题</span>'
                : '') +
            '</li>';
    }
    set('result-dims', li);
    var dimList = $('result-dims');
    if (dimList) dimList.className = model.answerCount ? 'dim-list has-count' : 'dim-list';

    // UX02：跳过说明（没有跳过就整段不出现）
    var note = $('result-skip-note');
    var noteN = $('result-skip-count');
    if (note) {
      if (model.totalSkipped > 0) {
        if (noteN) noteN.textContent = String(model.totalSkipped);
        note.removeAttribute('hidden');
      } else {
        note.setAttribute('hidden', '');
        if (noteN) noteN.textContent = '0';
      }
    }
    set('result-dynamic', model.dynamic);

    // 模块 4
    var badge = $('result-badge');
    if (badge) {
      badge.textContent = '整体状态 · ' + model.level;
      badge.style.background = model.badge.底色;
      badge.style.color = model.badge.文字色;
      badge.setAttribute('data-level', model.level);
    }

    // 模块 5
    set('result-verdict', rich(model.verdict));
    var v5 = $('mod-5');
    if (v5) v5.setAttribute('data-reachable', model.reachable ? 'true' : 'false');

    // 模块 6
    set('result-advantage', model.advantage);
    set('result-difficulty', model.difficulty);

    // 模块 7
    set('result-advice', model.advice);

    // 固定可见声明 / 版本号 / 隐私说明
    var dh = '';
    for (i = 0; i < model.declarations.length; i++) {
      dh += '<p data-declare-id="' + esc(model.declarations[i].id) + '">' + esc(model.declarations[i].text) + '</p>';
    }
    set('result-declare', dh);
    var vh = '';
    for (i = 0; i < model.versions.length; i++) {
      vh += '<span data-version-key="' + esc(model.versions[i].key) + '">' +
            esc(model.versions[i].key) + '=' + esc(model.versions[i].value) + '</span>';
    }
    set('result-versions', vh);

    var wrapEl = $('screen-result') || (root && root.parentNode) || null;
    if (wrapEl && wrapEl.setAttribute) {
      wrapEl.setAttribute('data-species', model.species);
      wrapEl.setAttribute('data-level', model.level);
      if (wrapEl.style && wrapEl.style.setProperty) wrapEl.style.setProperty('--sp-color', model.speciesColor);
    }
    return true;
  }

  // ------------------------------------------------------------------
  // 4) 分享卡片：1080×1440 Canvas，5 层信息，无码 / 无五维数字 / 无雷达
  // ------------------------------------------------------------------
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function font(ctx, size, weight) { ctx.font = (weight || 400) + ' ' + size + 'px ' + CARD_FONT; }
  /** 按像素宽度折行，最多 maxLines 行；超长在末行加省略号 */
  function wrapText(ctx, text, maxWidth, maxLines) {
    var s = String(text || ''), lines = [], cur = '', i, ch, test, truncated = false;
    // 5 条官方卡片台词都带逗号：优先在逗号后断成两行，避免把「程序」这类双字词拆开
    if (maxLines >= 2) {
      for (i = 0; i < s.length; i++) {
        if (s.charAt(i) !== '，') continue;
        var a = s.slice(0, i + 1), b = s.slice(i + 1);
        if (b && ctx.measureText(a).width <= maxWidth && ctx.measureText(b).width <= maxWidth) {
          return [a, b];
        }
      }
    }
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      test = cur + ch;
      if (ctx.measureText(test).width > maxWidth && cur) {
        lines.push(cur);
        if (lines.length >= maxLines) { truncated = true; break; }
        cur = ch;
      } else cur = test;
    }
    if (!truncated && cur) lines.push(cur);       // 正常结束：最后一行仍在 cur 里
    if (truncated && lines.length) {
      var last = lines[lines.length - 1];
      while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
      lines[lines.length - 1] = last + '…';
    }
    return lines;
  }
  /** 卡片上出现的全部文字（供验收：无五维数字 / 无百分比 / 无二维码） */
  function cardTextOf(model, lines) {
    return ['你的职场生存状态图鉴', model.species + '型', model.speciesTitle,
            '偏：' + model.subTitle, lines.join(''),
            '整体状态 · ' + model.level, '来测你自己的 →'].join('\n');
  }
  function drawCard(model, opts, done) {
    opts = opts || {};
    done = done || function () {};
    var canvas = opts.canvas;
    if (!canvas || !canvas.getContext) { done({ ok: false, error: '没有 canvas' }); return; }
    canvas.width = CARD_W; canvas.height = CARD_H;
    var ctx = canvas.getContext('2d');
    var color = model.speciesColor;

    // 台词先排版，拿到行数后再画（保证 ≤2 行不断字）
    font(ctx, 46, 400);
    var lines = wrapText(ctx, '「' + model.cardQuote + '」', CARD_W - CARD_SAFE_X * 2 - 48, 2);

    function paint(illustration, illustOk) {
      // 底：纸白 + 极淡点阵（纯绘制，不加载图片）
      ctx.fillStyle = '#FBF7F1'; ctx.fillRect(0, 0, CARD_W, CARD_H);
      ctx.fillStyle = 'rgba(42,39,36,0.035)';
      for (var gy = 24; gy < CARD_H; gy += 32) {
        for (var gx = 24; gx < CARD_W; gx += 32) { ctx.beginPath(); ctx.arc(gx, gy, 1.6, 0, 6.2832); ctx.fill(); }
      }
      // ① 主视觉：同源 SVG 占位图（失败时退化为纯色圆角块，不白屏）
      if (illustOk && illustration) {
        try { ctx.drawImage(illustration, 260, 200, 560, 560); } catch (e) { illustOk = false; }
      }
      if (!illustOk) {
        ctx.fillStyle = color; ctx.globalAlpha = 0.18;
        roundRect(ctx, 260, 200, 560, 560, 80); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = color; ctx.globalAlpha = 0.55;
        ctx.beginPath(); ctx.arc(540, 480, 150, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1;
      }
      // ⑤ 产品名（顶部角落，次要）
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      font(ctx, 32, 600); ctx.fillStyle = '#9A9184';
      ctx.fillText('你的职场生存状态图鉴', CARD_SAFE_X + 24, 132);

      // ② 物种名 + 称号
      font(ctx, 108, 800); ctx.fillStyle = '#2A2724';
      ctx.fillText(model.species + '型', CARD_SAFE_X + 24, 872);
      font(ctx, 42, 500); ctx.fillStyle = color;
      ctx.fillText(model.speciesTitle, CARD_SAFE_X + 24, 938);

      // 附：副称号小角标（≤30px，不写「专属/唯一」）
      font(ctx, 28, 400); ctx.fillStyle = '#9A9184';
      ctx.fillText('偏：' + model.subTitle, CARD_SAFE_X + 24, 990);

      // ③ 一句台词（卡片用，取 台词_卡片_*，最多 2 行）
      font(ctx, 46, 500); ctx.fillStyle = '#2A2724';
      for (var i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], CARD_SAFE_X + 24, 1042 + i * 62);
      }

      // ④ 整体状态徽章：文字色/底色取自文案 JSON，与结果页一致
      var by = 1160, bh = 72;
      font(ctx, 38, 700);
      var bw = ctx.measureText('整体状态 · ' + model.level).width + 56;
      ctx.fillStyle = model.badge.底色;
      roundRect(ctx, CARD_SAFE_X + 24, by, bw, bh, 36); ctx.fill();
      ctx.fillStyle = model.badge.文字色;
      ctx.fillText('整体状态 · ' + model.level, CARD_SAFE_X + 52, by + 50);

      // ⑤ 底部只放「来测你自己的 →」；底部 200px 内不出现物种名/台词/徽章
      font(ctx, 32, 500); ctx.fillStyle = '#6B6355';
      ctx.fillText('来测你自己的 →', CARD_SAFE_X + 24, 1352);

      var dataUrl = '';
      try { dataUrl = canvas.toDataURL('image/png'); } catch (e) { /* 污染画布：交由调用方提示 */ }
      done({
        ok: !!dataUrl,
        dataUrl: dataUrl,
        canvas: canvas,                    // 供验收脚本生成 200px 缩略图，不进页面 DOM
        width: CARD_W, height: CARD_H,
        bytes: Math.floor(dataUrl.length * 3 / 4),
        lines: lines,
        lineCount: lines.length,
        illustrationOk: illustOk,
        criticalMaxY: by + bh,                 // 最后一个关键信息的下边界
        safeBottomY: CARD_H - CARD_SAFE_BOTTOM,
        text: cardTextOf(model, lines),
        subtitlePx: 28, speciesPx: 108, quotePx: 46, badgePx: 38
      });
    }

    // 同源 SVG：不引入外部网络资源
    if (typeof Image === 'undefined') { paint(null, false); return; }
    var img = new Image();
    var settled = false;
    var finish = function (ok) { if (settled) return; settled = true; paint(img, ok); };
    img.onload = function () { finish(true); };
    img.onerror = function () { finish(false); };
    try { img.src = (opts.svgBase || '') + model.speciesSvg; } catch (e) { finish(false); }
  }

  return {
    DIMS: DIMS, SLOT_KEYS: SLOT_KEYS, MODULE_ORDER: MODULE_ORDER,
    VERSION_KEYS: VERSION_KEYS,
    CARD_W: CARD_W, CARD_H: CARD_H, CARD_SAFE_X: CARD_SAFE_X, CARD_SAFE_BOTTOM: CARD_SAFE_BOTTOM,
    buildModel: buildModel,
    radarSvg: radarSvg,
    render: render,
    drawCard: drawCard,
    fillSlots: fillSlots,
    cardTextOf: cardTextOf,
    stripInternal: stripInternal
  };
});
