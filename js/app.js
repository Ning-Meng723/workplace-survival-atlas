/* ============================================================
   《你的职场生存状态图鉴》V1.0 — 入口页 + 答题页 + 结果页（UX02）
   UX01 的三处交互（自动切题 / 删完成页 / 分享卡弹窗）保持不变；
   UX02 新增「主动跳过」：
     1) 每题四个选项下方多一个「跳过本题，暂不回答」，点了也自动进入下一题。
     2) 跳过只记 question_id + status=skipped，**不产生任何分值**（不记 0 分、不补中间分）。
     3) 一维有效回答 < 2 题时不允许出结果，给可点的「去补答」入口，绝不替用户选答案。
     4) 左右滑动同样绕不过：当前题没选也没跳过，就停在原地。
   数据纪律（一字未松）：
     - 题目 / 选项 / option_id / score 只从 data/题库.json 读，页面代码里没有一道题的原文。
     - 文案只从 data/结果文案.json 读，页面代码里没有一句正式文案。
     - 答案按 question_id → option_id 存；A/B/C/D 只是显示标签，不参与任何取分。
     - 分数/物种/状态/副称号只由 js/scoring.js 算一次，结果页只读那一份对象，不重算。
   写法：ES5 为主，兼容旧版安卓 WebView；不用 module / import / Promise / fetch。
   ============================================================ */
(function () {
  'use strict';

  var STAGE = 'UX02';
  var BANK_PATH = 'data/题库.json';
  var COPY_PATH = 'data/结果文案.json';
  var STORE_KEY = 'atlas.quiz.v1';
  var STORE_VERSION = 2;        // v2：新增 skipped（跳过记录），与 v1 存档结构不同
  var NAV_THROTTLE_MS = 120;    // 防手抖双击连跳两题
  var AUTO_ADVANCE_MS = 360;    // 选中后停顿：先让用户看见选中反馈，再走
  var TAP_GUARD_MS = 180;       // 自动切题后短暂忽略选项点击，防连点误选下一题
  var SWIPE_MIN_X = 46;         // 横向位移达到这个值才算切题
  var SWIPE_DECIDE = 14;        // 先超过这个位移，才判定横/竖

  var SCREENS = {
    entry: { el: 'screen-entry', ready: true },
    quiz: { el: 'screen-quiz', ready: true },
    result: { el: 'screen-result', ready: true }
  };

  var state = {
    bank: null,
    copy: null,             // data/结果文案.json（脚本生成的运行时文案）
    result: null,           // scoring.js 算出的那一份结果对象（结果页唯一数据源）
    model: null,            // result.js 构建的渲染模型
    card: null,             // 最近一次生成的分享卡信息
    bankKey: '',
    questions: [],          // 严格按题库.json 的顺序
    answers: {},            // question_id → option_id（已回答）
    skipped: {},            // question_id → true（已主动跳过，不计分；与 answers 互斥）
    order: {},              // question_id → [4 个 option_id]，显示顺序，持久化后不再变
    index: 0,
    phase: 'answering',     // 'answering' | 'result'
    ready: false,
    loading: false,
    copyLoading: false,
    error: '',
    resumed: false,
    versionsChanged: false
  };

  var hintTimer = null;
  var defaultHint = '约 3 分钟 · 不用登录 · 不收集个人信息';
  var quizDefaultHint = '选一个选项，或点「跳过本题」继续';
  var navLocked = false;
  var submitting = false;
  var autoTimer = null;         // 自动切题的定时器（同一时刻只允许一个）
  var tapGuard = false;         // 自动切题后的短暂点击保护
  var cardModalOpen = false;
  var blockState = null;        // { lack: [...], target: index } 某一维回答不足时记下的补答位置
  var restartConfirm = { armed: false, timer: null, btn: null, label: '' };

  function $(id) { return document.getElementById(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // ---------------- 轻提示 ----------------
  function setHint(text, isAlert) {
    var hint = $('btn-hint');
    if (!hint) return;
    hint.textContent = text;
    hint.className = isAlert ? 'btn-hint is-alert' : 'btn-hint';
  }
  function flashHint(text, ms) {
    setHint(text, true);
    if (hintTimer) { clearTimeout(hintTimer); }
    hintTimer = setTimeout(function () { setHint(defaultHint, false); hintTimer = null; }, ms || 3200);
  }
  function setQuizHint(text, isAlert) {
    var h = $('quiz-hint');
    if (!h) return;
    h.textContent = text;
    h.className = isAlert ? 'quiz-nav-tip is-alert' : 'quiz-nav-tip';
  }
  function flashQuizHint(text, ms) {
    setQuizHint(text, true);
    setTimeout(function () { setQuizHint(quizDefaultHint, false); }, ms || 3200);
  }

  // ---------------- localStorage（异常数据一律不当真） ----------------
  function storageGet() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object' || o.v !== STORE_VERSION) return null;
      return o;
    } catch (e) { return null; }
  }
  function storageSet(o) {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch (e) { /* 隐私模式/配额满：不影响答题 */ }
  }
  function storageClear() {
    try { window.localStorage.removeItem(STORE_KEY); } catch (e) { /* 同上 */ }
  }
  function save() {
    storageSet({
      v: STORE_VERSION,
      bankKey: state.bankKey,
      answers: state.answers,
      skipped: state.skipped,
      order: state.order,
      index: state.index
    });
  }

  // ---------------- 题库 ----------------
  function validateBank(b) {
    if (!b || !b.questions || Object.prototype.toString.call(b.questions) !== '[object Array]') {
      return '题库里没有 questions 数组';
    }
    var qs = b.questions;
    if (qs.length !== 20) return '题库不是 20 题（实际 ' + qs.length + ' 题）';
    var seen = {};
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      if (!q || !q.id || typeof q.text !== 'string' || !q.text) return '第 ' + (i + 1) + ' 题缺 id 或题干';
      if (seen[q.id]) return 'question_id 重复：' + q.id;
      seen[q.id] = true;
      if (!q.options || q.options.length !== 4) return q.id + ' 不是 4 个选项';
      var s = [];
      for (var j = 0; j < 4; j++) {
        var o = q.options[j];
        if (!o || !o.option_id || typeof o.text !== 'string') return q.id + ' 有选项缺 option_id / 文字';
        if (seen[o.option_id]) return 'option_id 重复：' + o.option_id;
        seen[o.option_id] = true;
        s.push(o.score);
      }
      if (s.slice().sort().join('') !== '1234') return q.id + ' 的分值不是 1/2/3/4 各一次';
    }
    return '';
  }

  function loadBank(done) {
    var xhr = new XMLHttpRequest();
    var failed = function (status) {
      if (location.protocol === 'file:') {
        state.error = '现在是用 file:// 双击打开的，浏览器不允许读本地 JSON。请用「本地预览」打开（README 有命令）。';
      } else {
        state.error = '题库读取失败（HTTP ' + status + '）：' + BANK_PATH;
      }
      done(false);
    };
    try { xhr.open('GET', BANK_PATH, true); } catch (e) { state.error = String(e.message || e); done(false); return; }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var txt = xhr.responseText || '';
      if (!txt || (xhr.status !== 200 && xhr.status !== 0)) { failed(xhr.status); return; }
      var json;
      try { json = JSON.parse(txt); } catch (e) { state.error = '题库 JSON 解析失败：' + e.message; done(false); return; }
      var err = validateBank(json);
      if (err) { state.error = err; done(false); return; }
      state.bank = json;
      done(true);
    };
    xhr.onerror = function () { failed('network'); };
    try { xhr.send(); } catch (e) { state.error = String(e.message || e); done(false); }
  }

  // ---------------- 结果文案 JSON（由 Markdown 脚本生成，禁止手工编辑） ----------------
  function validateCopy(c) {
    if (!c || !c.物种 || !c.判词建议 || !c.副称号解释 || !c.声明 || !c.维度名) {
      return '文案 JSON 结构不完整（缺 物种 / 判词建议 / 副称号解释 / 声明 / 维度名）';
    }
    var sp = ['树懒', '炸毛猫', '水豚', '狐狸', '企鹅'], i;
    for (i = 0; i < sp.length; i++) {
      if (!c.物种[sp[i]] || !c.物种[sp[i]].代表台词 || !c.物种[sp[i]].卡片台词) {
        return '文案 JSON 缺物种台词：' + sp[i];
      }
    }
    if (c.判词建议.length !== 20) return '文案 JSON 的判词建议不是 20 组';
    if (c.副称号解释.length !== 15) return '文案 JSON 的副称号解释不是 15 条';
    return '';
  }

  function loadCopy(done) {
    if (state.copy) { done(true); return; }
    var xhr = new XMLHttpRequest();
    var fail = function (status) {
      state.error = (location.protocol === 'file:')
        ? 'file:// 下读不到本地 JSON，请用「本地预览」打开（README 有命令）。'
        : ('结果文案读取失败（HTTP ' + status + '）：' + COPY_PATH);
      done(false);
    };
    try { xhr.open('GET', COPY_PATH, true); } catch (e) { state.error = String(e.message || e); done(false); return; }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var t = xhr.responseText || '';
      if (!t || (xhr.status !== 200 && xhr.status !== 0)) { fail(xhr.status); return; }
      var json;
      try { json = JSON.parse(t); } catch (e) { state.error = '结果文案 JSON 解析失败：' + e.message; done(false); return; }
      var err = validateCopy(json);
      if (err) { state.error = err; done(false); return; }
      state.copy = json;
      done(true);
    };
    xhr.onerror = function () { fail('network'); };
    try { xhr.send(); } catch (e) { state.error = String(e.message || e); done(false); }
  }

  function bankKeyOf(b) {
    var v = (b.meta || {})['数据版本'] || {};
    // 任一版本号变化都视为「题库换了」，旧答案不再沿用
    return [v.product_id, v.question_version, v.scoring_version,
            v.algorithm_version, v.result_content_version].join('|');
  }

  function findOpt(q, oid) {
    for (var i = 0; i < q.options.length; i++) if (q.options[i].option_id === oid) return q.options[i];
    return null;
  }
  function optOwnedBy(q, oid) { return !!findOpt(q, oid); }
  function scoreOf(oid) {
    for (var i = 0; i < state.questions.length; i++) {
      var o = findOpt(state.questions[i], oid);
      if (o) return o.score;
    }
    return null;
  }
  function shuffledIds(q) {
    var a = [], i;
    for (i = 0; i < q.options.length; i++) a.push(q.options[i].option_id);
    for (i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function isOrderValid(q, arr) {
    if (!arr || Object.prototype.toString.call(arr) !== '[object Array]' || arr.length !== q.options.length) return false;
    var seen = {};
    for (var i = 0; i < arr.length; i++) {
      if (!optOwnedBy(q, arr[i]) || seen[arr[i]]) return false;
      seen[arr[i]] = true;
    }
    return true;
  }

  // ---------------- 恢复 / 重置 ----------------
  function restore() {
    var raw = storageGet();
    state.resumed = false;
    state.versionsChanged = false;
    state.answers = {};
    state.skipped = {};
    state.order = {};
    state.index = 0;
    if (!raw) { buildMissingOrder(); return; }
    if (raw.bankKey !== state.bankKey) { storageClear(); state.versionsChanged = true; buildMissingOrder(); return; }

    var qs = state.questions, i, q, any = false;
    for (i = 0; i < qs.length; i++) {
      q = qs[i];
      var oid = raw.answers ? raw.answers[q.id] : null;
      if (typeof oid === 'string' && optOwnedBy(q, oid)) { state.answers[q.id] = oid; any = true; }
      else if (raw.skipped && raw.skipped[q.id]) { state.skipped[q.id] = true; any = true; }   // 已回答优先于已跳过
      var ord = raw.order ? raw.order[q.id] : null;
      if (isOrderValid(q, ord)) state.order[q.id] = ord.slice();
    }
    var idx = parseInt(raw.index, 10);
    if (!(idx >= 0) || idx > qs.length - 1) idx = 0;
    state.index = idx;
    state.resumed = any;
    buildMissingOrder();
  }
  function buildMissingOrder() {
    for (var i = 0; i < state.questions.length; i++) {
      var q = state.questions[i];
      if (!isOrderValid(q, state.order[q.id])) state.order[q.id] = shuffledIds(q);
    }
  }
  function restart() {
    cancelAdvance();
    storageClear();
    state.answers = {};
    state.skipped = {};
    state.order = {};
    state.index = 0;
    state.phase = 'answering';
    state.resumed = false;
    hideBlock();
    clearResult();                  // 旧结果/旧分享卡一并清掉，不残留
    buildMissingOrder();
    save();
    render();
    flashQuizHint('已清空，从第 1 题重新开始。', 2600);
  }

  // ---------------- 状态计算 ----------------
  function countAnswers() { return Object.keys(state.answers).length; }
  function countSkipped() { return Object.keys(state.skipped).length; }
  /** 已处理 = 已回答 + 已跳过。进度条与「还差几题」都按这个口径 */
  function countTreated() { return countAnswers() + countSkipped(); }
  function isTreated(qid) { return !!(state.answers[qid] || state.skipped[qid]); }
  /** 既没选也没跳过 → 才算「还没处理」 */
  function missingIds() {
    var m = [], i;
    for (i = 0; i < state.questions.length; i++) {
      if (!isTreated(state.questions[i].id)) m.push(state.questions[i].id);
    }
    return m;
  }

  // ---------------- 渲染 ----------------
  function renderQuestion() {
    var q = state.questions[state.index];
    var total = state.questions.length;
    $('quiz-count').textContent = pad2(state.index + 1) + ' / ' + pad2(total);
    $('quiz-qid').textContent = q.id;
    var full = ((state.bank.meta || {})['维度'] || {})[q.dim] || q.dim;
    $('quiz-dim-name').textContent = String(full).split('（')[0];   // 「钱包回血指数（…）」→「钱包回血指数」
    $('quiz-stem').textContent = q.text;

    var box = $('quiz-options');
    box.innerHTML = '';
    var ids = state.order[q.id];
    for (var i = 0; i < ids.length; i++) {
      var opt = findOpt(q, ids[i]);
      if (!opt) continue;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opt';
      btn.setAttribute('data-question-id', q.id);
      btn.setAttribute('data-option-id', opt.option_id);
      btn.setAttribute('aria-pressed', 'false');
      // A/B/C/D 纯粹是显示序号：它由「当前显示位置」决定，不是选项的身份
      var tag = document.createElement('span');
      tag.className = 'opt-tag';
      tag.setAttribute('aria-hidden', 'true');
      tag.textContent = 'ABCD'.charAt(i);
      var txt = document.createElement('span');
      txt.className = 'opt-text';
      txt.textContent = opt.text;
      btn.appendChild(tag);
      btn.appendChild(txt);
      box.appendChild(btn);
    }
  }

  function renderState() {
    if (state.phase !== 'answering') return;
    var done = countTreated(), sk = countSkipped(), total = state.questions.length;
    $('quiz-progress-fill').style.width = (Math.round(done / total * 100)) + '%';
    $('quiz-progress').setAttribute('aria-valuenow', String(done));
    $('quiz-progress-label').textContent = '已完成 ' + done + ' / ' + total + (sk ? '（跳过 ' + sk + '）' : '');

    var q = state.questions[state.index];
    var sel = state.answers[q.id] || '';
    var isSkip = !!state.skipped[q.id];
    var opts = $('quiz-options').querySelectorAll('.opt');
    for (var i = 0; i < opts.length; i++) {
      var on = opts[i].getAttribute('data-option-id') === sel;
      opts[i].className = on ? 'opt is-selected' : 'opt';
      opts[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    // 跳过按钮：已跳过时变成「已跳过」状态（再点一次不会重复记录）
    var skipBtn = $('btn-skip');
    if (skipBtn) {
      skipBtn.textContent = isSkip ? '本题已跳过 · 点这里取消跳过' : '跳过本题，暂不回答';
      skipBtn.className = isSkip ? 'skip-btn is-skipped' : 'skip-btn';
      skipBtn.setAttribute('aria-pressed', isSkip ? 'true' : 'false');
    }
    var st = $('skip-state');
    if (st) { if (isSkip) st.removeAttribute('hidden'); else st.setAttribute('hidden', ''); }

    var prevBtn = $('btn-prev');
    if (prevBtn) prevBtn.disabled = (state.index === 0);
    if (isSkip) setQuizHint('本题已跳过（不计分）· 选一个选项即可改答', false);
    else if (sel) setQuizHint('已完成 ' + done + ' / ' + total + ' · 可改选', false);
    else setQuizHint(quizDefaultHint, false);
  }

  function render() {
    if (state.phase !== 'answering') return;
    renderQuestion();
    renderState();
  }

  // ---------------- 交互 ----------------
  // 短时间内的第二次导航直接忽略；用定时器解锁而不是墙钟时间，
  // 这样在真实浏览器和无头浏览器的虚拟时间下行为一致。
  function navAllowed() {
    if (navLocked) return false;
    navLocked = true;
    setTimeout(function () { navLocked = false; }, NAV_THROTTLE_MS);
    return true;
  }

  /** 自动切题后的短暂点击保护：防止连点在下一题上误选 */
  function guardTaps(ms) {
    tapGuard = true;
    setTimeout(function () { tapGuard = false; }, ms || TAP_GUARD_MS);
  }

  function cancelAdvance() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  }

  /**
   * 记录答案。auto === true 时才安排自动切题；
   * 程序化调用（验收脚本）默认不切题，避免打乱逐题检查。
   */
  function selectOption(oid, auto) {
    if (state.phase !== 'answering' || !state.ready) return false;
    var q = state.questions[state.index];
    if (!optOwnedBy(q, oid)) return false;
    delete state.skipped[q.id];         // 选选项 = 改回「已回答」，跳过标记必须摘掉
    state.answers[q.id] = oid;          // ← 只存 option_id，先落盘再谈切题
    save();
    hideBlock();                        // 补上了一题，旧的拦截提示不该再挂着
    renderState();                      // 只更新状态，不重建按钮，避免连点丢焦点
    if (auto) {
      cancelAdvance();                  // 连点时后一次覆盖前一次，不会排队跳两题
      autoTimer = setTimeout(function () {
        autoTimer = null;
        advance();
      }, AUTO_ADVANCE_MS);
    }
    return true;
  }

  /**
   * 主动跳过：只记 question_id + status=skipped。
   * 不写 option_id、不写 score、不当 0 分，scoring 层也拿不到任何分值。
   * 已跳过的题再点一次 = 取消跳过（回到「还没处理」，可重新选）。
   */
  function skipCurrent(auto) {
    if (state.phase !== 'answering' || !state.ready) return false;
    var q = state.questions[state.index];
    if (state.skipped[q.id]) {
      delete state.skipped[q.id];
      save();
      renderState();
      flashQuizHint('已取消跳过，这道题还需要选一个选项。', 2600);
      return false;
    }
    delete state.answers[q.id];         // 改答→跳过时，旧 option_id 必须清掉，不留半条记录
    state.skipped[q.id] = true;
    save();
    hideBlock();
    renderState();
    if (auto !== false) {
      cancelAdvance();
      autoTimer = setTimeout(function () {
        autoTimer = null;
        advance();
      }, AUTO_ADVANCE_MS);
    }
    return true;
  }

  /** 自动切题：不经过节流阀，避免恰好被滑动锁吞掉；但必须确认当前题已处理（答或跳过） */
  function advance() {
    if (state.phase !== 'answering' || !state.ready || cardModalOpen) return false;
    var q = state.questions[state.index];
    if (!isTreated(q.id)) return false;          // 没答也没跳过，就绝不动
    if (state.index >= state.questions.length - 1) return finishToResult();
    state.index++;
    save();
    render();
    guardTaps(TAP_GUARD_MS);
    return true;
  }

  function next() {
    if (state.phase !== 'answering' || !state.ready) return false;
    if (!navAllowed()) return false;
    var q = state.questions[state.index];
    if (!isTreated(q.id)) {
      flashQuizHint('先选一个选项，或点「跳过本题」，才能进入下一题。', 2600);
      return false;
    }
    cancelAdvance();
    if (state.index >= state.questions.length - 1) return finishToResult();
    state.index++;
    save();
    render();
    return true;
  }

  function prev() {
    if (state.phase !== 'answering' || !state.ready) return false;
    if (!navAllowed()) return false;
    cancelAdvance();                   // 用户主动退回，取消待执行的自动前进
    if (state.index === 0) return false;
    state.index--;
    save();
    render();                          // 回到上一题时按 option_id 复原选中态
    return true;
  }

  function goTo(i, keepBlock) {
    if (!state.ready || state.phase !== 'answering') return false;
    if (!(i >= 0) || i > state.questions.length - 1) return false;
    cancelAdvance();
    if (!keepBlock) hideBlock();
    state.index = i;
    save();
    render();
    return true;
  }

  /** 第 20 题之后的出口：20 个位置都处理过（答或跳过）→ 每维有效回答 ≥ 2 → 算分 → 结果页 */
  function finishToResult() {
    var miss = missingIds();
    if (miss.length) {
      flashQuizHint('还差 ' + miss.length + ' 题没处理：' + miss.join('、'), 3600);
      return { ok: false, missing: miss };
    }
    var chk = null;
    if (window.WorkplaceScoring && window.WorkplaceScoring.countByDim) {
      chk = window.WorkplaceScoring.countByDim(state.bank, state.answers, state.skipped);
      if (!chk.ok) { showBlock(chk); return { ok: false, lack: chk.lack }; }   // 一维 < 2 题：拦下，给补答入口
    }
    if (submitting) return { ok: false, missing: [], busy: true };
    submitting = true;
    setQuizHint('20 题处理完了，正在生成结果…', false);
    var started = enterResult();
    submitting = false;
    return { ok: !!started, missing: [] };
  }

  // ---------------- 「有效回答不够」的拦截面板（UX02） ----------------
  function dimNameOf(d) {
    return String(((state.bank.meta || {})['维度'] || {})[d] || d).split('（')[0];
  }

  function hideBlock() {
    blockState = null;
    var el = $('quiz-block');
    if (el) el.setAttribute('hidden', '');
  }

  /** 只提示 + 给一个跳到对应题的入口，绝不自动替用户选答案 */
  function showBlock(chk) {
    var first = chk.lack[0], i, target = -1;
    for (i = 0; i < state.questions.length; i++) {
      if (state.questions[i].dim === first.dim && !state.answers[state.questions[i].id]) { target = i; break; }
    }
    if (target < 0) {
      for (i = 0; i < state.questions.length; i++) if (state.questions[i].dim === first.dim) { target = i; break; }
    }
    blockState = { lack: chk.lack, target: target };

    var need = (window.WorkplaceScoring && window.WorkplaceScoring.MIN_ANSWER) || 2;
    var parts = [];
    for (i = 0; i < chk.lack.length; i++) {
      var x = chk.lack[i];
      parts.push(dimNameOf(x.dim) + (x.n === 0 ? ' 一题都没答' : ' 只有 ' + x.n + ' 题有效回答') + '，至少需要 ' + need + ' 题');
    }
    var title = $('quiz-block-title');
    var body = $('quiz-block-body');
    var btn = $('btn-block-goto');
    var el = $('quiz-block');
    if (title) title.textContent = '还不能生成结果';
    if (body) {
      body.textContent = parts.join('；') + '。跳过的题可以点回去重新选，跳过本身不计分。';
    }
    if (btn) btn.textContent = target >= 0 ? ('去补答第 ' + pad2(target + 1) + ' 题 →') : '去补答 →';
    if (el) el.removeAttribute('hidden');
    flashQuizHint('有效回答不够，先把这一维补到 ' + need + ' 题。', 3600);
  }

  function gotoBlockTarget() {
    if (!blockState || blockState.target < 0) return false;
    goTo(blockState.target, true);      // 保留拦截面板：用户看得见「为什么要来这一题」
    return true;
  }

  function onRestartClick(btn) {
    if (!restartConfirm.armed) {
      restartConfirm.armed = true;
      restartConfirm.btn = btn;
      restartConfirm.label = btn.textContent;
      btn.textContent = '再点一次清空';
      flashQuizHint('重新开始会清空全部 20 题答案，确定吗？', 3200);
      if (restartConfirm.timer) clearTimeout(restartConfirm.timer);
      restartConfirm.timer = setTimeout(function () {
        if (restartConfirm.btn) restartConfirm.btn.textContent = restartConfirm.label;
        restartConfirm.armed = false;
        restartConfirm.timer = null;
        restartConfirm.btn = null;
      }, 3200);
      return false;
    }
    if (restartConfirm.timer) clearTimeout(restartConfirm.timer);
    if (restartConfirm.btn) restartConfirm.btn.textContent = restartConfirm.label;
    restartConfirm.armed = false;
    restartConfirm.timer = null;
    restartConfirm.btn = null;
    restart();
    return true;
  }

  // ---------------- 结果页：计分只发生一次，渲染层只读那一份对象 ----------------
  function clearResult() {
    state.result = null;
    state.model = null;
    state.card = null;
    closeCardModal(true);
    var img = $('card-img');
    if (img) img.removeAttribute('src');
    var a = $('card-download');
    if (a) { a.setAttribute('href', '#'); a.setAttribute('download', '职场生存状态图鉴.png'); }
    var note = $('card-note');
    if (note) {
      note.textContent = '卡片只有物种、状态和一句台词，不放分数。';
      note.className = 'card-note';
    }
    var b = $('btn-make-card');
    if (b) b.disabled = false;
  }

  function computeResult() {
    if (!state.ready || !state.bank || !state.copy) return { ok: false, error: '题库或文案还没读完' };
    var miss = missingIds();
    if (miss.length) return { ok: false, missing: miss };
    if (!window.WorkplaceScoring || !window.WorkplaceResult) return { ok: false, error: '计分 / 渲染模块没加载' };
    var r;
    try {
      r = window.WorkplaceScoring.scoreBank(state.bank, state.answers, state.skipped);
    } catch (e) {
      if (e && e.code === 'INSUFFICIENT' && e.dims) {
        return { ok: false, insufficient: e.dims, error: e.message };
      }
      return { ok: false, error: '计分失败：' + (e.message || e) };
    }
    var m = window.WorkplaceResult.buildModel(r, state.copy);
    if (!m.ok) return { ok: false, error: m.problems.join('；') };
    state.result = r;
    state.model = m;
    state.card = null;
    return { ok: true, result: r, model: m };
  }

  function renderResult() {
    if (!state.model) return false;
    var ok = window.WorkplaceResult.render(state.model, document);
    closeCardModal(true);
    var img = $('card-img');
    if (img) img.removeAttribute('src');
    var a = $('card-download');
    if (a) a.setAttribute('href', '#');
    var b = $('btn-make-card');
    if (b) b.disabled = false;
    var note = $('card-note');
    if (note) {
      note.textContent = '卡片只有物种、状态和一句台词，不放分数。';
      note.className = 'card-note';
    }
    return ok;
  }

  function enterResult() {
    if (!state.ready || !state.bank) return false;
    if (state.copyLoading) return false;
    var go = function () {
      cancelAdvance();
      var c = computeResult();
      if (!c.ok) {
        if (c.insufficient) { showBlock({ lack: c.insufficient }); return; }
        flashQuizHint(c.missing
          ? ('还差 ' + c.missing.length + ' 题没处理：' + c.missing.join('、'))
          : ('结果没生成：' + c.error), 5000);
        return;
      }
      hideBlock();
      renderResult();
      state.phase = 'result';
      showScreen('result');
    };
    if (state.copy) { go(); return true; }
    state.copyLoading = true;
    setQuizHint('正在读取结果文案…', false);
    loadCopy(function (ok) {
      state.copyLoading = false;
      if (!ok) { flashQuizHint('结果文案没读到：' + state.error, 5000); return; }
      go();
    });
    return true;
  }

  // ---------------- 分享卡弹窗 ----------------
  function openCardModal() {
    var m = $('card-modal');
    if (!m || !state.card) return false;
    m.removeAttribute('hidden');
    if (document.body.classList) document.body.classList.add('is-locked');
    if (document.documentElement.classList) document.documentElement.classList.add('is-locked');
    cardModalOpen = true;
    var sc = $('card-modal-scroll');
    if (sc && sc.scrollTop != null) sc.scrollTop = 0;
    // 焦点落到弹窗容器本身（不放关闭按钮，避免触屏一点就出现焦点圈）；键盘仍可 Tab 到按钮、Esc 关闭
    var box = $('card-modal-box');
    if (box && box.focus) { try { box.focus(); } catch (e) {} }
    return true;
  }

  function closeCardModal(silent) {
    var m = $('card-modal');
    if (!m) return false;
    var wasOpen = cardModalOpen || !m.hasAttribute('hidden');
    m.setAttribute('hidden', '');
    if (document.body.classList) document.body.classList.remove('is-locked');
    if (document.documentElement.classList) document.documentElement.classList.remove('is-locked');
    cardModalOpen = false;
    if (wasOpen && !silent) {
      var b = $('btn-make-card');
      if (b && b.focus) { try { b.focus(); } catch (e) {} }
    }
    return wasOpen;
  }

  function makeCard() {
    if (!state.model || !window.WorkplaceResult) return false;
    var btn = $('btn-make-card');
    if (btn.disabled) return false;      // 防重复点击：出图期间按钮锁住
    btn.disabled = true;
    var note = $('card-note');
    if (note) { note.textContent = '正在生成…'; note.className = 'card-note'; }
    var canvas = document.createElement('canvas');
    window.WorkplaceResult.drawCard(state.model, { canvas: canvas, svgBase: '' }, function (info) {
      btn.disabled = false;
      if (!info.ok) {
        // 生成失败：明确告知，且绝不开空弹窗假装成功
        if (note) {
          note.textContent = '没生成成功：这张图没做出来（浏览器不允许导出画布）。可以再点一次，结果页内容不受影响。';
          note.className = 'card-note is-alert';
        }
        closeCardModal(true);
        return;
      }
      state.card = info;
      var img = $('card-img');
      if (img) img.src = info.dataUrl;
      var a = $('card-download');
      if (a) {
        a.setAttribute('href', info.dataUrl);
        a.setAttribute('download', '职场生存状态图鉴_' + state.model.species + '型.png');
      }
      if (note) {
        note.textContent = '已生成 1080×1440 PNG（约 ' + Math.round(info.bytes / 1024) + ' KB），可在弹窗里下载或长按保存。';
        note.className = 'card-note';
      }
      openCardModal();
    });
    return true;
  }

  // 验收专用：直接喂一份结果对象渲染（不经过答题），用于覆盖 16 组 + 4 组兜底
  function renderWith(resultObj) {
    if (!state.copy) return false;
    var m = window.WorkplaceResult.buildModel(resultObj, state.copy);
    if (!m.ok) return false;
    state.result = resultObj;
    state.model = m;
    renderResult();
    showScreen('result');
    return true;
  }

  // ---------------- 屏幕切换 ----------------
  function showScreen(name) {
    var cfg = SCREENS[name];
    if (!cfg) { console.warn('[atlas] 未知屏幕：' + name); return false; }
    if (!cfg.ready) {
      flashHint('这一屏还没做（' + (cfg.stage || name) + '）。', 3600);
      return false;
    }
    if (name !== 'result') closeCardModal(true);
    var keys = Object.keys(SCREENS), i;
    for (i = 0; i < keys.length; i++) {
      var el = $(SCREENS[keys[i]].el);
      if (!el) continue;
      if (keys[i] === name) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
    }
    document.body.setAttribute('data-screen', name);
    $('actionbar-entry').hidden = (name !== 'entry');
    $('actionbar-quiz').hidden = (name !== 'quiz');
    try { window.scrollTo(0, 0); } catch (e) {}
    return true;
  }

  function initQuizState() {
    state.questions = state.bank.questions.slice();     // 顺序 = 题库顺序，不排序、不重排
    state.bankKey = bankKeyOf(state.bank);
    state.phase = 'answering';
    restore();
    state.ready = true;
  }

  function enterQuiz() {
    if (state.ready) {
      state.phase = 'answering';
      showScreen('quiz');
      render();
      if (state.resumed) flashQuizHint('已恢复上次作答（第 ' + (state.index + 1) + ' 题）。', 3200);
      return;
    }
    if (state.loading) return;
    state.loading = true;
    showScreen('quiz');
    $('quiz-load').hidden = false;
    $('quiz-load-msg').textContent = '正在读取题库…';
    $('quiz-body').hidden = true;
    $('actionbar-quiz').hidden = true;

    loadBank(function (ok) {
      state.loading = false;
      if (!ok) {
        $('quiz-load-msg').textContent = '题库没读到：' + state.error;
        return;
      }
      initQuizState();
      $('quiz-load').hidden = true;
      $('quiz-body').hidden = false;
      showScreen('quiz');
      render();
      if (state.versionsChanged) flashQuizHint('题库版本变了，旧答案已清空，从第 1 题重新开始。', 4000);
      else if (state.resumed) flashQuizHint('已恢复上次作答（第 ' + (state.index + 1) + ' 题）。', 3200);
    });
  }

  // ---------------- 滑动切题（只有明确横向手势才吃事件，不影响上下滚动） ----------------
  function bindSwipe() {
    var el = $('screen-quiz');
    if (!el || !el.addEventListener) return;
    var sx = 0, sy = 0, mode = '', tracking = false;

    var start = function (e) {
      if (cardModalOpen || state.phase !== 'answering' || !state.ready) { tracking = false; return; }
      var t = e.touches && e.touches[0];
      if (!t) { tracking = false; return; }
      tracking = true; mode = ''; sx = t.clientX; sy = t.clientY;
    };
    var move = function (e) {
      if (!tracking) return;
      var t = e.touches && e.touches[0];
      if (!t) return;
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (!mode) {
        if (Math.abs(dx) < SWIPE_DECIDE && Math.abs(dy) < SWIPE_DECIDE) return;
        // 明显竖着走就放手，交给页面滚动，绝不拦
        mode = (Math.abs(dx) > Math.abs(dy) * 1.4) ? 'x' : 'y';
      }
      if (mode === 'x' && e.cancelable) {
        try { e.preventDefault(); } catch (err) {}   // 横向手势期间锁住竖向滚动
      }
    };
    var end = function (e) {
      if (!tracking) return;
      var wasX = (mode === 'x');
      var t = (e.changedTouches && e.changedTouches[0]) || null;
      var dx = t ? (t.clientX - sx) : 0;
      tracking = false; mode = '';
      if (!wasX || Math.abs(dx) < SWIPE_MIN_X) return;
      if (dx < 0) next(); else prev();
    };
    var cancel = function () { tracking = false; mode = ''; };

    try {
      el.addEventListener('touchstart', start, { passive: true });
      el.addEventListener('touchmove', move, { passive: false });
      el.addEventListener('touchend', end, { passive: true });
      el.addEventListener('touchcancel', cancel, { passive: true });
    } catch (e) {
      // 极老浏览器不支持 options 对象：退化成布尔参数，功能仍在，只是不能拦滚动
      el.addEventListener('touchstart', start, false);
      el.addEventListener('touchmove', move, false);
      el.addEventListener('touchend', end, false);
      el.addEventListener('touchcancel', cancel, false);
    }
  }

  function bindModal() {
    var m = $('card-modal');
    if (!m) return;
    m.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== m) {
        if (t.getAttribute && t.getAttribute('data-close')) { closeCardModal(); return; }
        t = t.parentNode;
      }
    });
    document.addEventListener('keydown', function (e) {
      var k = e.key || e.keyCode;
      if (!cardModalOpen) return;
      if (k === 'Escape' || k === 'Esc' || k === 27) {
        if (e.preventDefault) e.preventDefault();
        closeCardModal();
      }
    });
  }

  // ---------------- 资源自检（沿用 W05） ----------------
  function checkAssets() {
    var imgs = document.querySelectorAll('.sp-card img');
    var ok = 0, bad = [], i;
    for (i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      if (im.complete && im.naturalWidth > 0) ok++;
      else bad.push(im.getAttribute('src'));
    }
    var st = (bad.length === 0 && imgs.length === 5) ? 'ok' : ('fail:' + bad.join(','));
    document.body.setAttribute('data-assets', st);
    document.body.setAttribute('data-asset-count', String(ok) + '/' + imgs.length);
    if (bad.length) console.error('[atlas] 占位图加载失败：' + bad.join('、'));
    return st;
  }

  // ---------------- 调试 / 验收出口（不参与产品逻辑） ----------------
  function snapshot() {
    return {
      stage: STAGE,
      ready: state.ready,
      loading: state.loading,
      error: state.error,
      phase: state.phase,
      index: state.index,
      total: state.questions.length,
      bankKey: state.bankKey,
      resumed: state.resumed,
      versionsChanged: state.versionsChanged,
      count: countTreated(),
      answered: countAnswers(),
      skipped: countSkipped(),
      missing: missingIds(),
      autoPending: !!autoTimer,
      modalOpen: cardModalOpen,
      blockVisible: !!(blockState && blockState.lack && blockState.lack.length),
      blockLack: blockState ? JSON.parse(JSON.stringify(blockState.lack)) : null,
      answers: JSON.parse(JSON.stringify(state.answers)),
      skippedMap: JSON.parse(JSON.stringify(state.skipped)),
      order: JSON.parse(JSON.stringify(state.order))
    };
  }

  // ---------------- 初始化 ----------------
  function boot() {
    document.body.setAttribute('data-stage', STAGE);
    document.body.setAttribute('data-screen', 'entry');

    // 入口页只读一次存档：有答案就把按钮改成「继续上次作答」，不加载题库、不算分
    var raw = storageGet();
    if (raw) {
      var na = (raw.answers && Object.keys(raw.answers).length) || 0;
      var ns = (raw.skipped && Object.keys(raw.skipped).length) || 0;
      var n = na + ns;
      if (n) {
        $('btn-start').innerHTML = '继续上次作答 <span class="arrow" aria-hidden="true">→</span>';
        defaultHint = '上次答到 ' + n + '/20 题' + (ns ? '（跳过 ' + ns + '）' : '') + ' · 答案只存在这台设备';
        setHint(defaultHint, false);
      }
    }

    $('btn-start').addEventListener('click', enterQuiz);
    $('btn-prev').addEventListener('click', prev);
    $('btn-restart').addEventListener('click', function () { onRestartClick(this); });
    $('btn-back-entry').addEventListener('click', function () { showScreen('entry'); });
    $('btn-result-back').addEventListener('click', function () {
      closeCardModal(true);
      showScreen('entry');
    });
    // 改答案：回到第 20 题，答案全部保留（替代被删掉的完成页里的「回去改答案」）
    $('btn-result-edit').addEventListener('click', function () {
      if (!state.ready) return;
      state.phase = 'answering';
      state.index = state.questions.length - 1;
      save();
      showScreen('quiz');
      render();
    });
    $('btn-result-restart').addEventListener('click', function () {
      restart();
      showScreen('quiz');               // 清空旧答案与旧结果，从第 1 题重来
    });
    $('btn-make-card').addEventListener('click', makeCard);
    $('card-close').addEventListener('click', function () { closeCardModal(); });

    // UX02：跳过本题（已跳过时再点是取消跳过）
    $('btn-skip').addEventListener('click', function () {
      if (tapGuard) return;             // 刚自动切题：这一下不算，避免连点误跳下一题
      skipCurrent(true);
    });
    $('btn-block-goto').addEventListener('click', gotoBlockTarget);

    // 事件委托：无论点到按钮本身还是里面的文字，都按 option_id 记录
    $('quiz-options').addEventListener('click', function (e) {
      if (tapGuard) return;             // 刚自动切题：忽略这一下，避免误选下一题
      var t = e.target;
      while (t && t !== this) {
        if (t.getAttribute && t.getAttribute('data-option-id')) {
          selectOption(t.getAttribute('data-option-id'), true);
          return;
        }
        t = t.parentNode;
      }
    });

    bindSwipe();
    bindModal();
    checkAssets();

    window.__ATLAS_QUIZ__ = {
      version: STAGE,
      isReady: function () { return state.ready; },
      state: snapshot,
      snapshot: snapshot,
      bank: function () { return state.bank; },
      enter: enterQuiz,
      goTo: goTo,
      next: next,
      prev: prev,
      select: function (oid) { return selectOption(oid, false); },   // 程序化：不自动切题
      pick: function (oid) { return selectOption(oid, true); },      // 模拟真实点击：会安排自动切题
      skip: function (auto) { return skipCurrent(auto === undefined ? false : !!auto); },  // 跳过当前题
      advance: function () { return advance(); },
      treated: isTreated,
      counts: function () {
        if (!window.WorkplaceScoring || !state.bank) return null;
        return window.WorkplaceScoring.countByDim(state.bank, state.answers, state.skipped);
      },
      gotoBlockTarget: gotoBlockTarget,
      hideBlock: hideBlock,
      setTimeoutMode: function (ms) { AUTO_ADVANCE_MS = ms; return AUTO_ADVANCE_MS; },
      setOrder: function (qid, ids) {
        var q = null, i;
        for (i = 0; i < state.questions.length; i++) if (state.questions[i].id === qid) q = state.questions[i];
        if (!q || !isOrderValid(q, ids)) return false;
        state.order[qid] = ids.slice();
        save(); renderQuestion(); renderState();
        return true;
      },
      orderOf: function (qid) { return (state.order[qid] || []).slice(); },
      scoreOf: scoreOf,
      removeAnswer: function (qid) {
        if (!state.answers[qid]) return false;
        delete state.answers[qid];
        save(); renderState();
        return true;
      },
      reset: restart,
      tryComplete: finishToResult,
      missing: missingIds,
      count: countTreated,
      answerCount: countAnswers,
      skipCount: countSkipped,
      clearStorage: storageClear,
      closeModal: function () { return closeCardModal(); },
      showScreen: showScreen
    };

    // 结果页验收出口：可构造任意结果对象渲染（覆盖 16 组可及 + 4 组兜底）
    window.__ATLAS_RESULT__ = {
      stage: STAGE,
      copy: function () { return state.copy; },
      loadCopy: loadCopy,
      result: function () { return state.result; },
      model: function () { return state.model; },
      card: function () { return state.card; },
      compute: computeResult,
      render: renderResult,
      renderWith: renderWith,
      enter: enterResult,
      makeCard: makeCard,
      modalOpen: function () { return cardModalOpen; },
      openModal: openCardModal,
      closeModal: function () { return closeCardModal(); },
      snapshot: function () {
        return {
          stage: STAGE,
          copyLoaded: !!state.copy,
          resultPresent: !!state.result,
          modelPresent: !!state.model,
          cardPresent: !!state.card,
          modalOpen: cardModalOpen,
          phase: state.phase,
          screen: document.body.getAttribute('data-screen')
        };
      }
    };

    window.__ATLAS__ = {
      stage: STAGE,
      screens: SCREENS,
      showScreen: showScreen,
      checkAssets: checkAssets,
      quiz: window.__ATLAS_QUIZ__,
      result: window.__ATLAS_RESULT__
    };

    console.log('[atlas] 就绪 · 阶段 ' + STAGE + ' · 屏幕 ' + Object.keys(SCREENS).join('/'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
