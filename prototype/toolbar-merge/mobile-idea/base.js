/* 手机端「想法怎么展示」四版的共同底座。
   工具条固定是手机 B（想法 / 书摘 / AI + ⋯）；书摘 / AI / 写想法是带遮罩的居中弹窗。
   变的只有「已有一条想法时，它出现在哪」——那部分由 body[data-mode] 决定。 */
(function () {
'use strict';

var MODE = document.body.dataset.mode || 'A';
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

var app = $('#app'), page = $('#page'), prose = $('#prose');
var stack = $('#stack'), dialog = $('#dialog'), scrim = $('#scrim'), card = $('#ideacard');

var COLORS = [
  { v: 'amber', c: '#e8b53a', n: '琥珀' },
  { v: 'vermilion', c: '#e2571c', n: '朱红' },
  { v: 'green', c: '#4f9a63', n: '松绿' },
  { v: 'blue', c: '#4a83d0', n: '黛蓝' },
];

var MARKS = {
  m1: { id: 'm1', color: '#e8b53a', text: '它慢慢教会你用另一种速度过日子',
        idea: '「另一种速度」这个说法很准。我缺的就是这种速度：一页可以读十分钟，而不是十分钟翻十页。' },
  m2: { id: 'm2', color: '#4a83d0', text: '读完不写，也是一种读法', idea: '' },
  m3: { id: 'm3', color: '#4f9a63', text: '不读也行', idea: '这句要留。' },
  m4: { id: 'm4', color: '#e2571c', text: '那些说不出来的部分，会自己找地方待着',
        idea: '这段话我在别处读到过类似的意思，但都没有这句说得准。\n\n「自己找地方待着」——不急着消化，也不急着用。我一直以为读书要立刻变成点什么，写点笔记、说点什么，否则就是白读了。可真正留下来的，往往是当时说不出所以然的那几句。\n\n等哪天碰到一件具体的事，它自己会冒出来，比你去翻笔记快得多。' },
};

var PARAS = [
  '<p>夜里读书，最怕忽然安静下来。外头的车声退到很远的地方，只剩纸页翻动的窸窣，像有人在隔壁翻一件旧衣裳。这时候读到一句好话，往往要停下来，抬头看看窗，仿佛那句话是从窗子外面递进来的。</p>',
  '<p>我一直觉得，读书的好处，不在于把多少别人的意思搬进自己的脑子里，而在于<mark class="hl" data-mark="m1">它慢慢教会你用另一种速度过日子</mark>——那种速度里，一句话可以停很久，一个念头也不必急着说出口。</p>',
  '<p>所以我不太爱「读完一本，就要写一千字」的说法。<mark class="hl" data-mark="m2">读完不写，也是一种读法</mark>；那些说不出来的部分，会自己找地方待着，等哪天你用得上，它先你一步认出了眼前的事。</p>',
  '<p>窗外有人骑车经过，铃铛响了两声。我把书合上，夹进一片干了的银杏叶，明天再读——不读也行。第二天早上翻开，叶子已经脆了，书页上留下一小片淡黄，像谁在上面按了一下。</p>',
  '<p>有些句子是要过一阵子才认得出好的。当时只觉得平平，等到某天在别处撞见同样的意思，才想起原来早就读过。<mark class="hl" data-mark="m3">不读也行</mark>，说的是这个意思。</p>',
  '<p>我渐渐明白，读书这件事最奢侈的地方，是它允许你浪费。浪费时间读一段没用的话，浪费耐心等一个说不清的念头成形。<mark class="hl" data-mark="m4">那些说不出来的部分，会自己找地方待着</mark>，等你哪天用得上，它先你一步认出了眼前的事。</p>',
  '<p>灯灭之前，我把书签挪到下一页开头。明天不一定还读，但书在那里，椅子在那里，窗外的声音也还在。这样想的时候，日子好像也没有那么赶。</p>',
  '<p>写到这儿，忽然想起小时候在旧书里翻到过一行铅笔字，写的是「今日读到此处，困了」。没有署名，没有日期。我盯着看了很久，觉得那个人和我隔着许多年，坐在同一盏灯下。</p>',
];

var state = { mode: 'none', markId: null, panel: null, more: false, anchor: null };
var AVOID = null;          /* 想法卡片占住的盒子，工具条要让开 */

/* ── 正文 ── */
prose.innerHTML = '<h2>灯 下</h2>' + PARAS.join('');
$$('mark.hl', prose).forEach(function (mk) {
  var m = MARKS[mk.dataset.mark];
  if (m) mk.style.setProperty('--c', m.color);
});

var esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
};
var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(v, hi)); };
var currentMark = function () { return state.markId ? MARKS[state.markId] : null; };

function appBox() { return app.getBoundingClientRect(); }
function anchorFromEl(el) {
  var a = appBox(), r = el.getBoundingClientRect();
  return { left: r.left - a.left, top: r.top - a.top, right: r.right - a.left, bottom: r.bottom - a.top,
           width: r.width, height: r.height, cx: (r.left + r.width / 2) - a.left };
}
function rectOf(el) {
  var a = appBox(), r = el.getBoundingClientRect();
  return { left: r.left - a.left, top: r.top - a.top, right: r.right - a.left, bottom: r.bottom - a.top, width: r.width, height: r.height };
}
function pageBox() {
  var a = appBox(), p = page.getBoundingClientRect();
  return { top: p.top - a.top, bottom: p.bottom - a.top, height: p.height };
}
function footH() { var f = $('.rfoot'); return f ? f.offsetHeight : 0; }

/* ── 工具条 ── */
function toolbarHtml() {
  var mark = currentMark();
  var dots = COLORS.map(function (c) {
    var on = mark && mark.color === c.c ? ' on' : '';
    return '<button type="button" class="dot' + on + '" data-act="dot" data-css="' + c.c + '" data-name="' + c.n +
      '" style="--c:' + c.c + '" title="' + c.n + '" aria-label="' + c.n + '"></button>';
  }).join('');
  var hasIdea = !!(mark && mark.idea);
  var badge = (MODE === 'C' && hasIdea) ? '<i class="dotmark"></i>' : '';
  var acts = ['idea', 'quote', 'ai'].map(function (k) {
    var label = k === 'idea' ? '想法' : k === 'quote' ? '书摘' : 'AI';
    var cls = 'act' + (k === 'idea' ? ' pri' : '') + (state.panel === k ? ' on' : '');
    return '<button type="button" class="' + cls + '" data-act="' + k + '">' + label + badge + '</button>';
  }).join('');
  var menu = state.more
    ? '<div class="moremenu" role="menu">' +
        '<button type="button" class="mi" data-act="bilink">双链</button>' +
        '<button type="button" class="mi" data-act="copy">复制原文</button>' +
        '<button type="button" class="mi danger" data-act="del">删除这条划线</button>' +
      '</div>'
    : '';
  return '<div class="toolbar">' + dots + '<span class="sep"></span>' + acts +
    '<button type="button" class="act more' + (state.more ? ' on' : '') + '" data-act="more" title="更多">⋯</button>' + menu + '</div>';
}

/* ── 面板（书摘 / AI / 写想法 / 删除确认） ── */
function panelHtml() {
  var mark = currentMark();
  var text = (mark && mark.text) || '';
  if (state.panel === 'idea') {
    return '<div class="float idea"><div class="row">' +
      '<textarea rows="1" cols="1" maxlength="2000" placeholder="写点什么…" aria-label="写想法">' + esc(mark ? mark.idea : '') + '</textarea>' +
      '<button type="button" class="send" data-act="ideasave" title="保存想法"><svg viewBox="0 0 24 24"><path d="M4 12l16-7-7 16-2-7z"/></svg></button>' +
      '</div></div>';
  }
  if (state.panel === 'quote') {
    return '<div class="float quote"><div class="q">「' + esc(text) + '」</div>' +
      '<div class="meta">夜读札记 · 第 7 章 · 灯下</div>' +
      '<div class="acts"><button type="button" class="pri" data-act="copytxt">复制引用</button>' +
      '<button type="button" data-act="savenote">存笔记</button></div></div>';
  }
  if (state.panel === 'ai') {
    return '<div class="float ai"><div class="q">「' + esc(text) + '」</div>' +
      '<div class="body">这句话把「读书」换成了一种节奏问题：不是多知道多少，而是同一句话能停多久。后半句的「不必急着说出口」，说的正是那种不产出也没关系的时间。</div>' +
      '<div class="src">只发送选中的这一段 · 本段 18 字</div></div>';
  }
  if (state.panel === 'del') {
    return '<div class="float confirm"><span class="tx">删除这条划线？想法会一起删掉。</span><span class="sp"></span>' +
      '<button type="button" data-act="delcancel">取消</button>' +
      '<button type="button" class="danger" data-act="deldo">删除</button></div>';
  }
  return '';
}

/* ── 想法卡片内容 ── */
function ideaInner(mark) {
  return '<span class="seal">想</span><p>' + esc(mark.idea) + '</p>';
}

/* ── 摆位 ── */
function placeToolbar() {
  var W = app.clientWidth, H = app.clientHeight, a = state.anchor;
  var tw = stack.offsetWidth, th = stack.offsetHeight;
  var left = clamp(a.cx - tw / 2, 8, Math.max(8, W - tw - 8));
  var top = a.bottom + 10;                       /* 手机：贴选区下方 */
  if (top + th > H - footH() - 8) top = a.top - 10 - th;
  top = clamp(top, 8, Math.max(8, H - th - 8));
  stack.style.left = Math.round(left) + 'px';
  stack.style.top = Math.round(top) + 'px';
  var tb = $('.toolbar', stack);
  if (tb) tb.classList.toggle('menu-up', top + th + 150 > H - footH());
}

/* 工具条别压在想法卡片上：优先翻到锚点上方，其次贴着卡片外沿 */
function resolveAvoid() {
  if (!AVOID) return;
  var H = app.clientHeight;
  var th = stack.offsetHeight, tw = stack.offsetWidth;
  var t = { left: parseFloat(stack.style.left) || 0, top: parseFloat(stack.style.top) || 0 };
  var overlaps = t.left < AVOID.right && t.left + tw > AVOID.left &&
                 t.top < AVOID.bottom && t.top + th > AVOID.top;
  if (!overlaps) return;

  var a = state.anchor;
  var cands = [a.top - 10 - th, AVOID.top - 8 - th, AVOID.bottom + 8];
  for (var i = 0; i < cands.length; i++) {
    var top = cands[i];
    if (top < 8 || top + th > H - 8) continue;
    if (top + th > AVOID.top - 4 && top < AVOID.bottom + 4) continue;  /* 还是压着卡片 */
    stack.style.top = Math.round(top) + 'px';
    return;
  }
}

function placeDialog() {
  if (dialog.hidden) return;
  var W = app.clientWidth, H = app.clientHeight, p = pageBox();
  var dw = dialog.offsetWidth, dh = dialog.offsetHeight;
  var centerY = p.top + p.height * 0.40;         /* 中间偏上：中心落在 40%（自底部算 60%） */
  var left = Math.round((W - dw) / 2);
  var top = Math.round(centerY - dh / 2);
  top = clamp(top, 8, Math.max(8, H - dh - 42 - 8));
  dialog.style.left = left + 'px';
  dialog.style.top = top + 'px';
}

/* ── 四版各自的「想法出现在哪」 ── */
function hideIdea() {
  card.hidden = true;
  card.className = 'ideacard';
  card.style.cssText = '';
  AVOID = null;
}

function showIdea() {
  var mark = currentMark();
  if (state.mode !== 'mark' || !mark || !mark.idea || state.panel) return;
  if (MODE === 'A') showBottomCard(mark);
  else if (MODE === 'B') showGrouped(mark);
  else if (MODE === 'C') { /* 不画卡片，只在工具条上点一颗小点 */ }
  else if (MODE === 'D') showDockStrip(mark);
}

/* A：整条贴底，永远不跟文字抢地方；划线在底部时，把正文往上让一点 */
function showBottomCard(mark) {
  var W = app.clientWidth, H = app.clientHeight, fh = footH();
  card.className = 'ideacard bottom';
  card.innerHTML = ideaInner(mark);
  card.hidden = false;
  card.style.width = (W - 16) + 'px';
  card.style.left = '8px';
  card.style.maxHeight = Math.round(H * 0.36) + 'px';
  card.style.top = Math.round(H - fh - 12 - card.offsetHeight) + 'px';

  /* 划线的下沿被卡片压住 → 把正文往上滚，让这句话落在卡片上方 */
  var cardTop = parseFloat(card.style.top);
  if (state.anchor && state.anchor.bottom > cardTop - 12) {
    page.scrollTop += state.anchor.bottom - (cardTop - 12) + 12;
    var mk = prose.querySelector('mark[data-mark="' + mark.id + '"]');
    if (mk) {
      state.anchor = anchorFromEl(mk);
      placeToolbar();
    }
  }

  /* 已经滚到底还压着（书就读到页面末尾了）→ 把卡片压矮到划线下方 */
  cardTop = parseFloat(card.style.top);
  var over = state.anchor.bottom + 10 - cardTop;
  if (over > 0) {
    var maxH = Math.max(88, card.offsetHeight - over);
    card.style.maxHeight = maxH + 'px';
    card.style.top = Math.round(H - fh - 12 - card.offsetHeight) + 'px';
  }
  AVOID = rectOf(card);
}

/* B：工具条 + 想法叠成一组，整组往空间大的那一侧放 */
function showGrouped(mark) {
  var W = app.clientWidth, H = app.clientHeight, fh = footH(), p = pageBox();
  var a = state.anchor;
  card.className = 'ideacard bubble';
  card.innerHTML = ideaInner(mark);
  card.hidden = false;
  card.style.width = Math.min(340, W - 24) + 'px';
  card.style.maxHeight = Math.round(p.height * 0.42) + 'px';

  var th = stack.offsetHeight;
  var ih = card.offsetHeight;
  var gap = 8;
  var roomBelow = (H - fh) - a.bottom - 10;
  var roomAbove = a.top - 10;
  var need = th + gap + ih;
  var below = roomBelow >= need;
  var above = roomAbove >= need;

  var stackTop, cardTop;
  if (below || (!above && roomBelow >= roomAbove)) {
    stackTop = a.bottom + 10;
    cardTop = stackTop + th + gap;
    var avail = (H - fh) - 8 - cardTop;
    if (avail < ih) { card.style.maxHeight = Math.max(52, avail) + 'px'; }
  } else {
    /* 上方：工具条仍贴着文字，想法在更外侧 */
    var space = a.top - 10 - 8;
    var cap = space - th - gap;
    if (cap < ih) { card.style.maxHeight = Math.max(52, cap) + 'px'; ih = card.offsetHeight; }
    stackTop = a.top - 10 - th;
    cardTop = stackTop - gap - ih;
    if (cardTop < 8) { cardTop = 8; stackTop = cardTop + ih + gap; }
  }

  var tw = stack.offsetWidth, cw = card.offsetWidth;
  stack.style.left = Math.round(clamp(a.cx - tw / 2, 8, Math.max(8, W - tw - 8))) + 'px';
  stack.style.top = Math.round(stackTop) + 'px';
  card.style.left = Math.round(clamp(a.cx - cw / 2, 8, Math.max(8, W - cw - 8))) + 'px';
  card.style.top = Math.round(cardTop) + 'px';
  AVOID = null;                                   /* 这一组自己算过位置 */
}

/* D：吸附条——默认贴顶，划线就被它盖住时翻到贴底 */
function showDockStrip(mark) {
  var W = app.clientWidth, H = app.clientHeight, fh = footH(), p = pageBox();
  var a = state.anchor;
  card.className = 'ideacard strip';
  card.innerHTML = ideaInner(mark);
  card.hidden = false;
  card.style.width = (W - 16) + 'px';
  card.style.left = '8px';
  var h = card.offsetHeight;
  var topTop = p.top + 8;
  var bottomTop = H - fh - 10 - h;
  /* 划线在上缘、会被条子压住 → 翻到下面 */
  var useBottom = a.top < topTop + h + 12;
  card.style.top = Math.round(useBottom ? bottomTop : topTop) + 'px';
  AVOID = rectOf(card);
}

/* ── 画 ── */
function build() {
  stack.hidden = state.mode === 'none';
  if (stack.hidden) {
    stack.innerHTML = '';
  } else {
    stack.innerHTML = toolbarHtml();
  }
  var ph = panelHtml();
  dialog.innerHTML = ph;
  dialog.hidden = !ph;
  /* 遮罩只跟「书摘 / AI / 写想法」，删除确认不要 */
  scrim.hidden = !(ph && state.panel !== 'del');
  document.body.dataset.idea = currentMark() && currentMark().idea ? '1' : '0';
  hideIdea();
}

function render() {
  build();
  if (state.mode === 'none') { renderBar(); return; }
  placeToolbar();
  showIdea();
  resolveAvoid();
  placeDialog();
  var ta = $('.float.idea textarea', dialog);
  if (ta) {
    grow(ta);
    placeDialog();
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  renderBar();
}

function renderBar() {
  var mark = currentMark();
  var where = card && !card.hidden ? (MODE === 'A' ? '贴底' : MODE === 'B' ? '跟着工具条' : MODE === 'D' ? '吸附条' : '') : '';
  var el = $('#state');
  el.textContent = (state.mode === 'none' ? '收起' : '点划线 · ' + (mark ? mark.id : '')) +
    (mark && mark.idea ? ' · 有想法' : ' · 没想法') +
    (state.panel ? ' · 面板：' + ({ idea: '想法', quote: '书摘', ai: 'AI', del: '删除' }[state.panel] || state.panel) : '') +
    (where ? ' · 卡片：' + where : '');
}

/* ── 动作 ── */
function toast(msg) {
  var old = $('.toast', app);
  if (old) old.parentNode.removeChild(old);
  var t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  app.appendChild(t);
  setTimeout(function () { t.parentNode && t.parentNode.removeChild(t); }, 1700);
}

function grow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(180, Math.max(46, ta.scrollHeight)) + 'px';
}

function openMark(id) {
  var mk = prose.querySelector('mark[data-mark="' + id + '"]');
  if (!mk) return;
  state.mode = 'mark';
  state.markId = id;
  state.panel = null;
  state.more = false;
  state.anchor = anchorFromEl(mk);
  render();
}

function closeAll() {
  state.mode = 'none';
  state.markId = null;
  state.panel = null;
  state.more = false;
  state.anchor = null;
  render();
}

function act(name, ds) {
  var mark = currentMark();
  if (name === 'more') { state.more = !state.more; render(); return; }
  if (name === 'dot') {
    if (!mark) return;
    mark.color = ds.css;
    var mk = prose.querySelector('mark[data-mark="' + mark.id + '"]');
    if (mk) mk.style.setProperty('--c', ds.css);
    state.more = false;
    render();
    return;
  }
  if (name === 'idea' || name === 'quote' || name === 'ai') {
    if (state.panel === name) { state.panel = null; render(); return; }
    state.panel = name;
    state.more = false;
    render();
    return;
  }
  if (name === 'bilink') { state.more = false; toast('（原型）已复制原文双链'); render(); return; }
  if (name === 'copy') { state.more = false; toast('（原型）已复制原文'); render(); return; }
  if (name === 'copytxt') { toast('（原型）已复制引用'); return; }
  if (name === 'savenote') { toast('（原型）存进书摘目录'); return; }
  if (name === 'del') { state.panel = 'del'; state.more = false; render(); return; }
  if (name === 'delcancel') { state.panel = null; render(); return; }
  if (name === 'deldo') { closeAll(); toast('已删除这条划线'); return; }
  if (name === 'ideasave') {
    var ta = $('.float.idea textarea', dialog);
    var v = (ta && ta.value || '').trim();
    if (!v) { toast('想法还是空的'); return; }
    if (mark) mark.idea = v;
    state.panel = null;
    render();
    toast('想法已保存');
    return;
  }
}

/* ── 事件 ── */
app.addEventListener('click', function (ev) {
  if (ev.target.closest('#stack') || ev.target.closest('#dialog')) {
    var btn = ev.target.closest('[data-act]');
    if (btn) { ev.preventDefault(); act(btn.dataset.act, btn.dataset); }
    return;
  }
  if (ev.target.closest('.rhead') || ev.target.closest('.rfoot')) { closeAll(); return; }
  if (ev.target.closest('#scrim') || ev.target.closest('#ideacard')) {
    var cardEl = ev.target.closest('#ideacard');
    if (cardEl && MODE !== 'C') {
      /* 点想法卡片 = 打开完整的想法（可编辑） */
      state.panel = 'idea';
      render();
      return;
    }
    closeAll();
    return;
  }
  var mk = ev.target.closest('mark.hl');
  if (!mk) { if (state.mode !== 'none') closeAll(); return; }
  openMark(mk.dataset.mark);
});

document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape') closeAll();
});

app.addEventListener('transitionend', function () { render(); });
window.addEventListener('resize', function () { render(); });
page.addEventListener('scroll', function () {
  if (state.mode === 'none') return;
  var mark = currentMark();
  if (mark) {
    var mk = prose.querySelector('mark[data-mark="' + mark.id + '"]');
    if (mk) { state.anchor = anchorFromEl(mk); render(); }
  }
});

$$('[data-theme-set]').forEach(function (b) {
  b.addEventListener('click', function () {
    document.documentElement.dataset.theme = b.dataset.themeSet;
    $$('[data-theme-set]').forEach(function (x) { x.classList.toggle('on', x === b); });
    render();
  });
});

/* ── 场景预设（原型专用） ── */
function scene(id, pos) {
  closeAll();
  var mk = prose.querySelector('mark[data-mark="' + id + '"]');
  var p = page.getBoundingClientRect();
  var r = mk.getBoundingClientRect();
  var d = 0;
  if (pos === 'top') d = r.top - (p.top + 10);
  else if (pos === 'bottom') d = r.bottom - (p.bottom - 16);
  else d = (r.top + r.height / 2) - (p.top + p.height / 2);
  page.scrollTop += d;
  requestAnimationFrame(function () { openMark(id); });
}

var SCENES = [
  ['顶部', 'm1', 'top'],
  ['中部', 'm1', 'center'],
  ['底部', 'm3', 'bottom'],
  ['长想法', 'm4', 'center'],
  ['窄标记', 'm3', 'center'],
  ['没有想法', 'm2', 'center'],
];
var bar = $('#scenes');
SCENES.forEach(function (s) {
  var b = document.createElement('button');
  b.textContent = s[0];
  b.addEventListener('click', function () {
    $$('#scenes button').forEach(function (x) { x.classList.toggle('on', x === b); });
    scene(s[1], s[2]);
  });
  bar.appendChild(b);
});

window.PROTO = {
  state: state, scene: scene, openMark: openMark, closeAll: closeAll, render: render,
  show: function (id, pos) { scene(id, pos); },
};

render();
})();
