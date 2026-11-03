/* ============================================================
 * bz-reader · 弹层与浮层（shell/overlay.ts）
 *
 * 一个 fixed 全屏容器挂在 body 上，内部按 state.overlay 渲染一种弹层。
 * 为什么不挂在各视图里：划词条、书摘卡、AI 卡贴在正文上，正文在
 * 阅读视图、而搜索/导入可能从书架发起——一个容器管全部，就不会出现
 * 「弹窗跟着视图一起被销毁」或者「两个遮罩叠在一起」。
 *
 * 容器本身带 .bzs-shell + data-bzaccent，为的是拿到同一套设计令牌；
 * 它的背景被覆盖成透明，所以不会给整屏染色。
 * ============================================================ */
import { HIGHLIGHT_COLORS } from '../data/notes';
import { aiAsk, type AiTask } from '../data/ai';
import type { ReaderBook } from '../data/schema';
import { collectStats } from '../data/stats';
import { cn, esc, coverHtml, ico, MAG } from './render/html';
import { bmksOf, fmtMinutes, fmtWhen, marksOf, penLabel } from './domain';
import { noteCardHtml } from './render/notes';
import { closeOverlay, getState } from './state';
import { getShellSource, liveBooks, shellPrefs, shellSettings } from './source';
import { glyphOf } from './adapt';
import { hydrateCovers } from './covers';
import { CAP_LABEL, GROUP_URL, PLAN_TABLE, PURCHASE_URL, can, entitlement, tierText, type Cap, type PlanCell } from '../data/entitlement';
import { protocolUrl } from '../data/deeplink';
import { dataDirOf, normalizeDataDir } from '../core/plugin-path';
import { RT, pushAi } from './runtime';
import { dispatchInput } from './actions';

/* ─────────── 小工具 ─────────── */

function modal(title: string, sub: string, body: string, foot = '', cls = ''): string {
  return `<div class="bzs-scrim" data-role="scrim"><div class="bzs-modal ${cls}">
    <div class="bzs-mhead"><b>${title}</b><span class="n">${sub}</span><span class="sp"></span>
      <button class="x" data-act="close" title="关闭">${ico('x')}</button></div>
    <div class="bzs-mbody">${body}</div>
    ${foot ? `<div class="bzs-mfoot">${foot}</div>` : ''}
  </div></div>`;
}

function closeBtn(): string {
  return `<span class="sp"></span><button class="bzs-btn pri" data-act="close">知道了</button>`;
}

function bookById(id?: string | null): ReaderBook | undefined {
  const books = liveBooks();
  return id ? books.find((b) => b.id === id) : undefined;
}

function markById(id?: string | null, bookId?: string | null) {
  const books = liveBooks();
  for (const b of books) {
    if (bookId && b.id !== bookId) continue;
    const h = (b.notes?.highlights ?? []).find((x) => x.id === id);
    if (h) return { book: b, mark: h };
  }
  return null;
}

/* ─────────── 各弹层 ─────────── */

function overlaySearch(): string {
  const kw = RT.searchKw.trim();
  const scope = RT.searchScope;
  const books = scope === 'book' ? liveBooks().filter((b) => b.id === getState().bookId) : liveBooks();
  const lower = kw.toLowerCase();

  const hits: string[] = [];
  let total = 0;
  for (const b of books) {
    if (!kw) break;
    const rows: string[] = [];
    // 书名 / 作者
    if ((b.meta.title + (b.meta.author ?? '')).toLowerCase().includes(lower)) {
      rows.push(`<button class="bzs-hit" data-act="openbook" data-id="${b.id}">
        <span class="loc">书籍</span>${esc(b.meta.title)} · ${esc(b.meta.author ?? '佚名')}</button>`);
    }
    // 标注
    for (const m of marksOf(b)) {
      if (!(m.text + m.comment).toLowerCase().includes(lower)) continue;
      rows.push(`<button class="bzs-hit" data-act="jumpmark" data-id="${m.id}" data-book="${b.id}">
        <span class="loc">${esc(m.chapterTitle)}</span>${esc(m.text.slice(0, 80))}</button>`);
    }
    if (rows.length) {
      total += rows.length;
      hits.push(`<div class="bzs-hitgroup">${esc(b.meta.title)} · ${rows.length} 处</div>${rows.slice(0, 10).join('')}`);
    }
  }

  const body = `<div class="bzs-search-in">${MAG}
      <input data-role="searchkw" placeholder="搜书名、作者、章节名或标注里的字…" value="${esc(RT.searchKw)}"></div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <button class="bzs-chip${scope === 'book' ? ' on' : ''}" data-act="searchscope" data-v="book">本书</button>
      <button class="bzs-chip${scope === 'all' ? ' on' : ''}" data-act="searchscope" data-v="all">全库 · ${liveBooks().length} 本</button>
      <span class="bzs-mini" style="margin-left:auto">搜的是已建索引的内容：书名、作者、标注与想法</span>
    </div>
    ${
      !kw
        ? `<div class="bzs-empty">输入关键词。想搜正文全文，用 Obsidian 自带的全文搜索更快。</div>`
        : total
          ? hits.join('')
          : `<div class="bzs-empty">没有找到「${esc(kw)}」</div>`
    }`;

  return modal('搜索', '本书 / 全库', body, '', 'wide tall');
}

/**
 * 排版表单本体。
 *
 * 它现在有两个出口：阅读页右上角的浮层（主路径，边调边看）与
 * 命令面板兜底弹层。**同一个函数**，避免两处控件长歪。
 */
export function typographyFormHtml(): string {
  const p = shellPrefs();

  const seg = (name: string, opts: Array<[string, string]>, cur: string): string =>
    `<div class="bzs-seg">${opts
      .map(([v, l]) => `<button class="${cur === v ? 'on' : ''}" data-act="setpref" data-k="${name}" data-v="${v}">${l}</button>`)
      .join('')}</div>`;

  const rng = (k: string, label: string, val: number, min: number, max: number, step: number, unit: string): string => {
    return `<div class="bzs-setrow"><label>${label}</label>
      <input type="range" data-role="pref" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}">
      <span class="val">${k === 'lineHeight' ? val.toFixed(1) : val + unit}</span></div>`;
  };

  /* 方向卡只演示方向本身：写「横排 / 竖排」两个大字。
     以前塞的是书名，书名一长（红楼梦（人文社权威定本彩皮版…））卡片就被撑歪，
     而且用户要看的是「字怎么排」，不是「我的书叫什么」。 */
  const dir = (v: 'horizontal' | 'vertical'): string =>
    `<button class="bzs-dircard${p.layout === v ? ' on' : ''}" data-act="setpref" data-k="layout" data-v="${v}">
      <span class="t${v === 'vertical' ? ' is-v' : ''}">${v === 'vertical' ? '竖排' : '横排'}</span>
    </button>`;

  return `<div class="bzs-setgrp flat bzs-typo">
    ${rng('fontSize', '字号', p.fontSize, 14, 30, 1, 'px')}
    ${rng('lineHeight', '行距', p.lineHeight, 1.4, 2.4, 0.1, '')}
    ${rng('margin', '页边距', p.margin, 8, 120, 4, '')}
    <div class="bzs-setrow"><label>字体</label>${seg(
      'fontFamily',
      [
        ['book', '跟随书籍'],
        ['serif', '宋体'],
        ['sans', '黑体'],
      ],
      p.fontFamily,
    )}</div>
    <div class="bzs-setrow"><label>对齐</label>${seg(
      'align',
      [
        ['justify', '两端对齐'],
        ['left', '左对齐'],
      ],
      p.align,
    )}</div>
    <div class="bzs-setrow bzs-setrow-dir"><label>方向</label>
      <div class="bzs-dirpick">${dir('horizontal')}${dir('vertical')}</div>
    </div>
    <div class="bzs-setrow"><label>栏数</label>${seg(
      'columns',
      [
        ['1', '单栏'],
        ['2', '双栏'],
      ],
      String(p.columns),
    )}</div>
  </div>`;
}

/**
 * 排版面板：右上角贴边浮层，改一项正文立刻重排（没有遮罩，边调边看）。
 *
 * 没有标题头：浮层挂在工具栏下面，自己的头部会把上一行的按钮压住；
 * 关闭靠点外面或 Esc（浮层统一走 document 级收口），不需要一枚 ✕。
 */
function overlayTypography(): string {
  return `<div class="bzs-float is-corner no-head" data-role="float">
    <div class="bzs-mbody">${typographyFormHtml()}</div>
  </div>`;
}

function overlayImport(): string {
  const body = `<div class="bzs-drop" data-role="drop"><b>把书拖到这里</b>也可以直接放进笔记库，再回书库刷新<br>
      <span class="bzs-mini">文件留在笔记库里，卸载插件也读得到</span></div>
    <div class="bzs-sect-h"><b>支持的格式</b><span class="ln"></span></div>
    <div class="bzs-kv"><b>EPUB / TXT</b><span>封面、目录、分页与标注</span></div>
    <div class="bzs-kv"><b>MOBI / AZW3 / FB2 / CBZ</b><span>导入后自动转换</span></div>
    <div class="bzs-mini" style="margin-top:12px;line-height:1.9">点下面的按钮会用 Obsidian 原生文件选择器，导入后自动重扫书库。</div>`;
  return modal(
    '导入书籍',
    'epub · txt · mobi · azw3 · fb2',
    body,
    `<button class="bzs-btn pri" data-act="import">选择文件…</button>${closeBtn()}`,
  );
}

function overlayExport(bookId?: string): string {
  const book = bookById(bookId);
  const md = buildPreview(book);
  return modal(
    '导出摘录',
    book ? book.meta.title : '全部书籍',
    `<div class="bzs-md">${esc(md)}</div>
     <div class="bzs-mini" style="margin-top:10px;line-height:1.9">每条引文都带章节与定位；导出到「${esc(
       shellSettings().exportDir,
     )}」目录，不覆盖你手写的同名笔记。</div>`,
    `<button class="bzs-btn" data-act="copytext" data-text="${esc(md)}">复制 Markdown</button>${closeBtn()}`,
    'wide',
  );
}

function buildPreview(book?: ReaderBook): string {
  const books = book ? [book] : liveBooks().filter((b) => (b.notes?.highlights ?? []).length);
  if (!books.length) return '（还没有划线。去阅读页选中一段文字试试。）';
  const withComments = shellSettings().exportComments;
  return books
    .map((b) => {
      const lines = [`# ${b.meta.title || '未命名'} · 摘录`, ''];
      const groups = new Map<string, string[]>();
      for (const h of marksOf(b)) {
        const key = h.chapterTitle || '未命名章节';
        if (!groups.has(key)) groups.set(key, []);
        const block = [`> ${h.text.replace(/\s*\n\s*/g, ' ')}`, ''];
        if (withComments && h.comment) block.push(`**想法**：${h.comment}`, '');
        if (h.cfiRange)
          block.push(
            `— [在原文中查看](${protocolUrl({
              bookId: b.id,
              cfi: h.cfiRange,
              text: h.text.replace(/\s+/g, ' ').slice(0, 20),
              chapter: h.chapterTitle,
            })})`,
            '',
          );
        groups.get(key)!.push(block.join('\n'));
      }
      for (const [chapter, blocks] of groups) lines.push(`## ${chapter}`, '', ...blocks);
      return lines.join('\n');
    })
    .join('\n\n---\n\n');
}

function overlayBookmap(): string {
  const book = bookById(getState().bookId) ?? liveBooks()[0];
  if (!book) return modal('Book Map', '全书一屏鸟瞰', '<div class="bzs-empty">还没有打开的书。</div>', closeBtn(), 'wide');
  const marks = marksOf(book);
  const bks = bmksOf(book);
  const chapters = new Map<string, { marks: number; bks: number }>();
  for (const m of marks) {
    const g = chapters.get(m.chapterTitle) ?? { marks: 0, bks: 0 };
    g.marks += 1;
    chapters.set(m.chapterTitle, g);
  }
  for (const k of bks) {
    const g = chapters.get(k.chapterTitle) ?? { marks: 0, bks: 0 };
    g.bks += 1;
    chapters.set(k.chapterTitle, g);
  }
  const rows = [...chapters.entries()]
    .map(
      ([title, g], i) => `<div class="row">
        <span class="no">${cn(i + 1)}</span><span class="nm">${esc(title)}</span>
        <div class="strip">${Array.from({ length: Math.min(12, g.marks) }, () => '<u style="background:var(--copper)"></u>').join('')}</div>
        <span class="bzs-mini">${g.marks} 划 · ${g.bks} 签</span></div>`,
    )
    .join('');
  const body = `<div class="bzs-mini" style="margin-bottom:12px">${esc(book.meta.title || '未命名')} · ${
    chapters.size
  } 个有标注的章节 · ${bks.length} 枚书签 · ${marks.length} 条划线。点一行跳到那一章。</div>
    <div class="bzs-bmap">${rows || '<div class="bzs-empty">这本书还没有书签或划线。</div>'}</div>`;
  return modal('Book Map', '全书一屏鸟瞰', body, closeBtn(), 'wide tall');
}

function overlayQuote(text?: string, bookId?: string, chapterTitle?: string): string {
  const book = bookById(bookId ?? getState().bookId);
  const t = text || RT.sel?.text || '';
  const ch = chapterTitle || RT.sel?.chapterTitle || '未命名章节';
  const body = `<div class="bzs-qcard">
      <div class="q">${esc(t)}</div>
      <div class="loc">${esc(book?.meta.title ?? '未命名')} · ${esc(book?.meta.author ?? '佚名')} · ${esc(ch)}</div>
      <div class="stamp">bz 阅读</div>
    </div>
    <div class="bzs-mini" style="margin-top:12px;line-height:1.9">复制后粘到任何笔记里，定位串能带你回到同一段。</div>`;
  const quoteMd = `「${t}」\n— ${book?.meta.title ?? ''} · ${book?.meta.author ?? ''} · ${ch}`;
  return modal(
    '书摘卡',
    '引文 · 出处 · 定位',
    body,
    `<button class="bzs-btn" data-act="copytext" data-text="${esc(quoteMd)}">复制为引用</button>${closeBtn()}`,
    'wide',
  );
}

/**
 * 写想法：划线上方的小浮窗。
 *
 * 以前是居中弹窗 + 一排「笔记 / 灵感 / 准备实践 / 反复看 / 疑问」的分类
 * chips。实际数据里想法没有分类字段，那排 chips 存不进去，只是摆着好看，
 * 还把输入框挤小了；现在只留「引文 + 输入框 + 保存」。
 * 无遮罩：想法常常要对照正文写，遮住半页反而写不出来。
 */
function overlayIdea(markId?: string, bookId?: string): string {
  const found = markById(markId, bookId);
  const anchor = anchoredStyle(getState().overlay?.anchor);
  if (!found) {
    return floatPanel('写想法', '', '<div class="bzs-empty">这条标注已不存在。</div>', '<button class="bzs-btn" data-act="close">关闭</button>', 'is-anchored', anchor);
  }
  const { book, mark } = found;
  const body = `<div class="bzs-ai-quote">「${esc(mark.text)}」</div>
    <textarea class="idea" data-role="idea" placeholder="这一句让你想到了什么…">${esc(mark.comment ?? '')}</textarea>
    <div class="bzs-mini" style="margin-top:8px">想法会跟着划线出现在左侧栏、笔记页与导出稿里。</div>`;
  return floatPanel(
    '写想法',
    `${penLabel(mark.color)} · ${esc(mark.chapterTitle ?? '')}`,
    body,
    `<button class="bzs-btn pri" data-act="ideasave" data-id="${mark.id}" data-book="${book.id}">保存想法</button><span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>`,
    'is-anchored',
    anchor,
  );
}

/**
 * 划线卡的面板 HTML（不含弹窗外壳）。
 *
 * 点正文里的划线，打开的是阅读页顶部的浮层——不遮正文、不用关弹窗才能
 * 继续读。命令面板等没有阅读视图在场的场合才退回居中弹层，用同一份内容。
 */
export function hlcardPanelHtml(markId?: string, bookId?: string): string | null {
  const found = markById(markId, bookId);
  if (!found) return null;
  const { book, mark } = found;
  /* 笔色不再用卡片侧边的一条竖线表示（整块 UI 里那排彩条太吵），
     改成出处行前的一颗小色点：同色、同值，但不抢正文。 */
  const pen = HIGHLIGHT_COLORS.find((c) => c.value === mark.color);
  return `<div class="bzs-qcard">
      <div class="q">${esc(mark.text)}</div>
      <div class="loc">${
        pen ? `<span class="dot" style="background:${pen.css}"></span>${esc(pen.label)} · ` : ''
      }${esc(book.meta.title || '')} · ${esc(mark.chapterTitle ?? '')} · ${fmtWhen(mark.createdAt)}</div>
    </div>
    ${
      mark.comment
        ? `<div class="bzs-card" style="margin-top:14px"><div class="bzs-mini" style="letter-spacing:.24em;color:var(--copper)">想 法</div>
           <div style="font-size:13px;line-height:1.9;color:var(--ink-2);margin-top:8px">${esc(mark.comment)}</div></div>`
        : ''
    }
    <div class="bzs-sect-h"><b>换一支笔</b><span class="ln"></span></div>
    <div style="display:flex;gap:9px;flex-wrap:wrap">${HIGHLIGHT_COLORS.map(
      (c) =>
        `<button class="bzs-chip${mark.color === c.value ? ' on' : ''}" data-act="hlcolor" data-id="${mark.id}" data-book="${book.id}" data-v="${c.value}"><span class="dot" style="background:${c.css}"></span>${c.label}</button>`,
    ).join('')}</div>`;
}

/** 划线卡的按钮组：浮层与弹层共用一个写法 */
export function hlcardActsHtml(markId?: string, bookId?: string): string {
  const found = markById(markId, bookId);
  if (!found) return '';
  const { book, mark } = found;
  /* 双向链接是高级版的主打能力：基础版不把按钮藏起来，而是挂一枚「高级」小标。
     藏起来 = 用户不知道有这回事；标出来再点一下看到对照表，才是卖点。 */
  const bilink = can('bilink')
    ? `<button class="bzs-btn" data-act="copylink" data-id="${mark.id}" data-book="${book.id}">双向链接</button>`
    : `<button class="bzs-btn" data-act="copylink" data-id="${mark.id}" data-book="${book.id}">双向链接<i class="pro">高级</i></button>`;
  return `<button class="bzs-btn" data-act="hljump" data-id="${mark.id}" data-book="${book.id}">回到原文</button>
    <button class="bzs-btn" data-act="hlidea" data-id="${mark.id}" data-book="${book.id}">写想法</button>
    <button class="bzs-btn" data-act="hlquote" data-id="${mark.id}" data-book="${book.id}">做成书摘</button>
    ${bilink}
    <span class="sp"></span>
    <button class="bzs-btn danger" data-act="hldel" data-id="${mark.id}" data-book="${book.id}">删除</button>`;
}

/**
 * 浮层外壳：**没有遮罩**，也不吃正文上的点击。
 *
 * 只有两处用它——排版面板与划线卡。这两件事都得「一边看正文一边操作」：
 * 遮罩一压，正文糊掉，用户只能调完再关掉看效果，等于还是弹窗。
 * 所以浮层直接挂在 fixed 容器里，正文照旧可点可滚。
 *
 * @param anchor 给了坐标就贴在划线上方（左/上都是宿主视口坐标）
 */
function floatPanel(title: string, sub: string, body: string, foot = '', cls = '', style = ''): string {
  return `<div class="bzs-float ${cls}" data-role="float"${style ? ` style="${style}"` : ''}>
    <div class="bzs-mhead"><b>${title}</b>${sub ? `<span class="n">${sub}</span>` : ''}<span class="sp"></span>
      <button class="x" data-act="close" title="关闭">${ico('x')}</button></div>
    <div class="bzs-mbody">${body}</div>
    ${foot ? `<div class="bzs-mfoot">${foot}</div>` : ''}
  </div>`;
}

/** 当前弹层是不是「浮层」（无遮罩、点外面关闭） */
function isFloatKind(): boolean {
  const k = getState().overlay?.kind;
  return k === 'typography' || k === 'hlcard' || k === 'footnote' || k === 'idea';
}

/**
 * 划线上方定位。
 *
 * 卡片底边离那行字 14px；上方放不下（贴着屏幕顶）就翻到下方——
 * 比强行顶出视口好，用户至少还看得见。宽度固定、不随文字变：
 * 一条短划线和一条长段落点开应该是同一张卡。
 */
function anchoredStyle(a?: { left: number; top: number }): string {
  const vw = window.innerWidth;
  const w = Math.min(360, vw - 24);
  if (!a || (!a.left && !a.top)) return `left:50%;top:72px;width:${w}px;transform:translateX(-50%)`;
  const left = Math.min(vw - w / 2 - 12, Math.max(w / 2 + 12, a.left));
  const above = a.top > 280;
  return `left:${Math.round(left)}px;top:${Math.round(above ? a.top - 14 : a.top + 26)}px;width:${w}px;transform:translate(-50%,${above ? '-100%' : '0'})`;
}

function overlayHlcard(markId?: string, bookId?: string): string {
  const found = markById(markId, bookId);
  const body = hlcardPanelHtml(markId, bookId) ?? '<div class="bzs-empty">这条标注已不存在。</div>';
  const foot = hlcardActsHtml(markId, bookId);
  const anchor = getState().overlay?.anchor;
  return floatPanel('标注', esc(found?.mark.chapterTitle ?? ''), body, foot, 'is-anchored', anchoredStyle(anchor));
}

/**
 * 脚注浮窗：注释号上方一小块，读完继续读，不用跳到章末再找回来。
 * 想看上下文再点「跳到原文」——那才是真的跳。
 */
function overlayFootnote(text?: string, href?: string): string {
  const body = `<div class="bzs-fntext">${esc(text ?? '')}</div>`;
  const foot = href ? `<button class="bzs-btn" data-act="jumpch" data-href="${esc(href)}">跳到原文</button><span class="sp"></span><button class="bzs-btn" data-act="close">关闭</button>` : '';
  return floatPanel('脚注', '', body, foot, 'is-anchored', anchoredStyle(getState().overlay?.anchor));
}

const AI_MODES: Array<{ key: AiTask; label: string }> = [
  { key: 'explain', label: '解释' },
  { key: 'translate', label: '翻译' },
  { key: 'summarize', label: '摘要' },
];

function overlayAi(text?: string, mode?: string): string {
  /* 整段包在 if 里而不是提前 return：esbuild 会连模板一起删掉，
     base 包里就不会留下「AI 助手」的界面文案。 */
  let html = '';
  if (__BZ_READER_PRO__) {
  const t = text || RT.sel?.text || '';
  const task = (AI_MODES.find((m) => m.key === mode)?.key ?? 'explain') as AiTask;
  const s = shellSettings();
  const ready = !!s.ai.baseUrl && !!s.ai.apiKey && !!s.ai.model;
  const body = `<div class="bzs-ai-tag"><span class="seal">${ico('sparkle')}</span><b>${esc(
    s.ai.model || '未配置模型',
  )} · ${
    AI_MODES.find((m) => m.key === task)?.label
  }</b></div>
    <div class="bzs-ai-quote">「${esc(t)}」</div>
    <div class="bzs-ai-body" data-role="aibody">${ready ? '正在请求…' : '还没有配置 AI 服务。到 书架 · 设置 里填好服务商、模型与密钥。'}</div>
    <div class="bzs-ai-acts">${AI_MODES.map(
      (m) => `<button class="bzs-chip${task === m.key ? ' on' : ''}" data-act="aimode" data-v="${m.key}" data-text="${esc(t)}">${m.label}</button>`,
    ).join('')}</div>`;
  html = modal(
    'AI 助手',
    '只发送选中的这一段',
    body,
    `<button class="bzs-btn" data-act="aisave" data-text="${esc(t)}">存为笔记</button>${closeBtn()}`,
    'wide',
  );
  }
  return html;
}

function overlayDict(word?: string): string {
  const w = word || RT.dictWord || '';
  const body = `<div class="bzs-dict"><div class="w">${esc(w)}</div>
      <div class="py">选中的词</div>
      <div class="df">插件本身不带离线词典。要查这个词，用下面的 AI 解释——它会结合你正在读的这段来解释，比通用词典更贴近上下文。</div></div>
    <div class="bzs-ai-src">词条来源：AI（需在设置里配置服务商与密钥）</div>`;
  return modal(
    '查词',
    '结合上下文解释',
    body,
    `<button class="bzs-btn pri" data-act="selai">用 AI 解释</button>${closeBtn()}`,
  );
}

function overlayTranslate(text?: string): string {
  const t = text || RT.sel?.text || '';
  const s = shellSettings();
  const ready = !!s.ai.baseUrl && !!s.ai.apiKey && !!s.ai.model;
  const body = `<div class="bzs-ai-quote">「${esc(t)}」</div>
    <div class="bzs-ai-body" data-role="aibody">${ready ? '正在翻译…' : '还没有配置 AI 服务，无法翻译。到 书架 · 设置 里配置。'}</div>
    <div class="bzs-ai-src">只发送选中的这一段 · ${esc(s.ai.model || '未配置模型')}</div>`;
  return modal('翻译', '段落 · 译成中文', body, `<button class="bzs-btn" data-act="copytext" data-text="">复制译文</button>${closeBtn()}`, 'wide');
}

function overlayPoster(): string {
  const books = liveBooks();
  const st = collectStats(books);
  const done = books.filter((b) => b.reading.stats.completedTime || b.reading.position.percent >= 0.99).length;
  const top = [...st.books].sort((a, b) => b.seconds - a.seconds)[0];
  const year = new Date().getFullYear();
  const body = `<div class="bzs-poster"><div class="yr">${year} · 阅 读 年 报</div>
      <div class="big">${done}</div><h2>本读完了</h2>
      <div class="sub">连续 ${st.streakDays} 天没有断过 · 累计 ${Math.round(st.totalSeconds / 3600)} 小时<br>
        ${top ? `最长的一本是《${esc(top.title)}》，陪了你 ${Math.round(top.seconds / 60)} 分钟` : '还没有读完的记录'}</div>
      <div style="margin-top:22px;font-family:var(--serif);font-size:12px;letter-spacing:.4em;color:var(--copper)">bz 阅读 · 墨与铜</div>
    </div>`;
  return modal(
    '年度海报',
    '可以存成一张图',
    body,
    `<button class="bzs-btn" data-act="copytext" data-text="${year} 阅读年报 · 读完 ${done} 本 · 连续 ${st.streakDays} 天">复制文字版</button>${closeBtn()}`,
  );
}

function overlayGoal(): string {
  const st = getState();
  const done = liveBooks().filter((b) => b.reading.stats.completedTime || b.reading.position.percent >= 0.99).length;
  const body = `<div class="bzs-setgrp flat">
      <div class="bzs-setrow"><label>今年读</label>
        <input type="range" data-role="goal" min="5" max="100" step="1" value="${st.goal}">
        <span class="val" id="bzs-goalval">${st.goal} 本</span></div>
      <div class="bzs-mini" style="margin-top:12px;line-height:1.9">已完成 ${done} 本。目标只影响仪表盘上的那圈铜线。</div>
    </div>`;
  return modal('年度目标', '按自己的节奏来', body, closeBtn());
}

function overlayReset(): string {
  return modal(
    '重置界面状态',
    '只清书架的界面设置，不动你的书与笔记',
    `<div style="font-size:13px;line-height:2;color:var(--t2)">会重置：书库视图与筛选、纸色、年度目标、默认笔色。<br>
     不会动：书、阅读进度、划线、书签、AI 配置。<br>
     阅读数据在 storage/bz-reader.json 里，要清它请直接删那个文件。</div>`,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn danger" data-act="resetui">确认重置</button>`,
  );
}

/**
 * 读完一本书时弹的一张卡：打分 + 一句话。
 *
 * 为什么值得专门做：读完是用户记忆最深的时刻，也是晒图的高发点。
 * 它把一个统计数字变成一次记录——代价只是一个弹层。
 *
 * 星星不走重绘：点一下改 class 就够了，重绘会把已经输入的一句话清掉。
 * 保存时从 DOM 读被点亮的颗数。
 */
function overlayFinish(bookId?: string): string {
  const b = bookById(bookId);
  if (!b) return modal('读完了', '', '<div class="bzs-empty">这本书已不在书库。</div>', closeBtn());

  const st = b.reading.stats;
  const rated = st.rating ?? 0;
  const minutes = Math.max(1, Math.round((st.totalReadTime || 0) / 60));
  const stars = [1, 2, 3, 4, 5]
    .map(
      (i) =>
        `<button class="bzs-star${rated >= i ? ' on' : ''}" data-act="rate" data-v="${i}" aria-label="${i} 星">${ico(
          'star',
        )}</button>`,
    )
    .join('');

  const body = `<div class="bzs-finish">
      <div class="kick">读 完 了</div>
      <h3>${esc(b.meta.title)}</h3>
      <div class="sub">${esc(b.meta.author || '佚名')} · 累计 ${minutes} 分钟</div>
      <div class="bzs-stars" data-role="stars">${stars}</div>
      <textarea data-role="review" rows="3" placeholder="一句话：这本书给你留下了什么">${esc(st.review ?? '')}</textarea>
      <div class="bzs-mini">保存后会写进这本书的元数据，并在导出时带上。</div>
    </div>`;

  return modal(
    '读完一本书',
    '记一笔',
    body,
    `<button class="bzs-btn" data-act="finishskip">跳过</button>
     <button class="bzs-btn pri" data-act="finishsave" data-id="${b.id}">保存</button>`,
  );
}

function overlayDetail(bookId?: string): string {
  const b = bookById(bookId);
  if (!b) return modal('书籍详情', '', '<div class="bzs-empty">这本书已不在书库。</div>', closeBtn());
  const marks = marksOf(b);
  const bks = bmksOf(b);
  const percent = Math.round((b.reading.position.percent || 0) * 100);
  const body = `<div class="bzs-detail">${coverHtml({
    coverUrl: null, // 真封面异步回填（paint 末尾 hydrateCovers），这里只出占位色块
    bg: 'linear-gradient(150deg,#4a3a28,#2c2115)',
    fg: '#e9dcc3',
    glyph: glyphOf(b.meta.title || '无题'),
    title: b.meta.title || '',
    id: b.id,
  })}<div>
      <h2>${esc(b.meta.title || '未命名')}</h2>
      <div class="au">${esc(b.meta.author || '佚名')}</div>
      <div class="desc">${esc(b.meta.description || '这本书还没有简介。')}</div>
      <div class="acts">
        <button class="bzs-btn pri" data-act="openbook" data-id="${b.id}">开始阅读 ›</button>
        <button class="bzs-btn" data-act="fav" data-id="${b.id}">${ico('star')} ${
          getState().favIds.includes(b.id) ? '已收藏' : '收藏'
        }</button>
        <button class="bzs-btn" data-act="done" data-id="${b.id}">${
          b.reading.stats.completedTime ? '标为在读' : '标为读完'
        }</button>
      </div>
      <div class="bzs-kv"><b>阅读进度</b><span>${percent}%</span></div>
      <div class="bzs-kv"><b>累计时长</b><span>${fmtMinutes(b.reading.stats.totalReadTime || 0)}</span></div>
      <div class="bzs-kv"><b>划线 / 书签</b><span>${marks.length} 条 / ${bks.length} 枚</span></div>
      <div class="bzs-kv"><b>上次打开</b><span>${fmtWhen(b.reading.stats.lastReadTime)}</span></div>
      <div class="bzs-kv"><b>文件</b><span style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${esc(b.fileRef.vaultPath)}</span></div>
      ${
        marks.length
          ? `<div class="bzs-sect-h"><b>这本书的划线</b><span class="ln"></span></div>
             <div class="bzs-ngrid">${marks.slice(0, 3).map((m) => noteCardHtml(m, false)).join('')}</div>`
          : ''
      }
    </div></div>`;
  return modal(
    '书籍详情',
    `${b.fileRef.format.toUpperCase()} · ${esc(b.fileRef.vaultPath)}`,
    body,
    `<button class="bzs-btn" data-act="export" data-id="${b.id}">导出这本书的划线</button>${closeBtn()}`,
    'wide tall',
  );
}

/* ─────────── 渲染入口 ─────────── */

/**
 * 解锁弹层：基础版 / 高级版功能对照表。
 *
 * 出现的时机全是「用户刚想干一件事被拦下」——点导出、点卡片、点跨书搜索。
 * 所以第一句仍是他想做的那件事，第二句直接给一张对照表：差在哪，自己看。
 * 面板里**不写价格**——价格会变、渠道会变，写进插件里就成了每次调价都要发版；
 * 只在商店页标价，这里只负责把人送过去。
 */
function planCell(kind: 'free' | 'pro', v: PlanCell): string {
  if (v === 'yes') return `<i class="y">${ico('check')}</i>`;
  if (v === 'part') return `<i class="p">部分</i>`;
  return `<i class="n">—</i>`;
}

function overlayUnlock(mode?: string): string {
  const v = entitlement();
  const cap = (mode || 'export') as Cap;
  const paid = v.tier === 'paid';

  /* 不再在表头上写「你点的是朗读 / 基础版此项需高级版」：
     那两行字占掉了整屏最贵的空间，信息量却等于「看下面那张表」。
     做法改成：直接在表里把这一项标亮。 */
  const rows = PLAN_TABLE.map((r) => {
    const hot = !paid && r.cap === cap;
    return `<div class="bzs-plan-row${hot ? ' is-cap' : ''}">
        <span>${esc(r.name)}${r.note ? `<em>${esc(r.note)}</em>` : ''}</span>
        ${planCell('free', r.free)}${planCell('pro', r.pro)}
      </div>`;
  }).join('');

  const body = `<div class="bzs-unlock">
      <div class="bzs-plan">
        <div class="bzs-plan-row head"><span>功能</span><b>基础版</b><b>高级版</b></div>
        ${rows}
      </div>
      <div class="bzs-unlock-buy">
        <button class="bzs-btn pri" data-act="buy">去购买</button>
        <button class="bzs-btn" data-act="joingroup">加交流群</button>
        <span class="bzs-mini">购买后拿到激活码，填在下面即可</span>
      </div>
    </div>`;

  // 激活框独占页脚整行：输入框与按钮挨着，眼睛不用在两端来回找
  const foot = `<div class="bzs-unlock-act">
      <label>已有激活码</label>
      <input data-role="license" placeholder="BZR3.…" value="${esc(v.license)}" spellcheck="false">
      <button class="bzs-btn sm pri" data-act="activate">激活</button>
    </div>`;

  return modal('高级版', paid ? '已激活' : '', body, foot, 'wide tall');
}

/**
 * 换数据目录的二次确认。
 *
 * 迁移会搬运整份书库、标注和封面，属于「不可撤销」的操作，所以必须
 * 把「从哪到哪」摊开写清楚，并且说明失败会保留原目录——用户点确认前
 * 得知道最坏结果是什么。
 */
/**
 * 改名：只改书架上显示的名字。
 *
 * 不去重命名笔记库里的文件——那会影响用户自己的 wiki 链接与备份，
 * 而且同一个文件可能在别处被引用。改名只落在 bz 的元数据里。
 */
function overlayRename(bookId?: string): string {
  const b = bookById(bookId);
  if (!b) return modal('改名', '', '<div class="bzs-empty">这本书已不在书库。</div>', closeBtn());
  const body = `<div class="bzs-setgrp flat">
      <div class="bzs-setrow"><label>书名</label>
        <input data-role="rename" value="${esc(b.meta.title || '')}" spellcheck="false" style="flex:1"></div>
      <div class="bzs-mini" style="margin-top:10px;line-height:1.9">只改书架上显示的名字，笔记库里的文件名不动，
        进度、划线、书签也都不会丢。</div>
    </div>`;
  return modal(
    '改名',
    esc(b.fileRef.format.toUpperCase()),
    body,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn pri" data-act="renamesave" data-id="${b.id}">保存</button>`,
  );
}

/**
 * 移除书库：删记录与标注，不删文件。
 *
 * 这两件事的后果差很远——删文件是不可逆的，用户点「移除」多半只是想
 * 让它从书架上消失。所以文案里把边界写死，确认按钮也只做这一件事。
 */
function overlayRemoveBook(bookId?: string): string {
  const b = bookById(bookId);
  if (!b) return modal('移除书库', '', '<div class="bzs-empty">这本书已不在书库。</div>', closeBtn());
  const marks = marksOf(b).length;
  const body = `<div style="font-size:13px;line-height:2;color:var(--t2)">
      会把《${esc(b.meta.title || '未命名')}》从书架移除：阅读进度、${marks} 条划线、书签与想法一起删掉。<br>
      笔记库里的原文件 <code>${esc(b.fileRef.vaultPath)}</code> <b>不会</b>被删除，之后还能重新导入。
    </div>`;
  return modal(
    '移除书库',
    esc(b.meta.title || '未命名'),
    body,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn danger" data-act="removebookdo" data-id="${b.id}">确认移除</button>`,
  );
}

function overlayMoveData(raw: string): string {
  const from = dataDirOf();
  const to = normalizeDataDir(raw);
  const body = `<div class="bzs-move">
      <div class="bzs-move-row"><b>当前目录</b><code>${esc(from)}/</code></div>
      <div class="bzs-move-row to"><b>迁移到</b><code>${esc(to)}/</code></div>
      <ul class="bzs-unlock-list">
        <li>书架、划线、书签、阅读进度与封面会整体复制到新目录</li>
        <li>复制并校验通过后才删除旧目录；中途失败会原样保留</li>
        <li>已经粘进笔记的摘录链接不受影响，仍能跳回原文</li>
      </ul>
      <div class="bzs-mini">如果新目录里已经有一份数据，同名文件会被这次迁移覆盖。</div>
    </div>`;
  return modal(
    '迁移数据目录',
    `${esc(from)} → ${esc(to)}`,
    body,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn pri" data-act="datadomigrate">确认迁移</button>`,
  );
}

export function overlayHtml(): string {
  const o = getState().overlay;
  if (!o) return '';
  switch (o.kind) {
    case 'search':
      return overlaySearch();
    case 'import':
      return overlayImport();
    case 'typography':
      return overlayTypography();
    case 'export':
      return overlayExport(o.bookId);
    case 'bookmap':
      return overlayBookmap();
    case 'quote':
      return overlayQuote(o.text, o.bookId, o.chapterTitle);
    case 'idea':
      return overlayIdea(o.markId, o.bookId);
    case 'hlcard':
      return overlayHlcard(o.markId, o.bookId);
    case 'footnote':
      return overlayFootnote(o.text, o.href);
    case 'ai':
      return overlayAi(o.text, o.mode);
    case 'dict':
      return overlayDict(o.word);
    case 'translate':
      return overlayTranslate(o.text);
    case 'poster':
      return overlayPoster();
    case 'setgoal':
      return overlayGoal();
    case 'reset':
      return overlayReset();
    case 'detail':
      return overlayDetail(o.bookId);
    case 'finish':
      return overlayFinish(o.bookId);
    case 'unlock':
      return overlayUnlock(o.mode);
    case 'movedata':
      return overlayMoveData(o.text || '');
    case 'rename':
      return overlayRename(o.bookId);
    case 'removebook':
      return overlayRemoveBook(o.bookId);
    default:
      return '';
  }
}

/** AI 请求：弹层打开后自己发一次，结果回填到 [data-role="aibody"] */
export async function runAiForOverlay(): Promise<void> {
  const o = getState().overlay;
  if (!o || (o.kind !== 'ai' && o.kind !== 'translate')) return;
  const s = shellSettings();
  if (!s.ai.baseUrl || !s.ai.apiKey || !s.ai.model) return;
  const text = o.text || RT.sel?.text || '';
  const task: AiTask = o.kind === 'translate' ? 'translate' : ((o.mode as AiTask) || 'explain');
  const node = document.querySelector<HTMLElement>('[data-role="aibody"]');
  try {
    const res = await aiAsk(s, task, text);
    if (node) node.textContent = res.text;
    pushAi(false, `AI · ${s.ai.model}`, res.text);
  } catch (e) {
    if (node) node.textContent = (e as Error).message;
  }
}

/* ─────────── 容器 ─────────── */

/**
 * 全屏弹层容器。挂 body，用 fixed 定位；内部带 .bzs-shell 拿设计令牌，
 * 但背景透明，所以只是「一层可以放弹窗的空气」，不会给宿主窗口染色。
 */
export class OverlayLayer {
  readonly root: HTMLElement;
  private accent = '';
  private lastKind = '';

  /**
   * 浮层（排版 / 划线卡）没有遮罩，所以「点空白处关闭」得自己在文档级收：
   * 用捕获阶段的 pointerdown，且**不阻断**事件——点正文照样能选字、翻页。
   */
  private onDocPointer = (e: PointerEvent): void => {
    if (!isFloatKind()) return;
    const t = e.target as Node | null;
    if (t && this.root.contains(t)) return;
    closeOverlay();
  };

  private onDocKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && isFloatKind()) closeOverlay();
  };

  constructor(private onAction: (act: string, el: HTMLElement) => void) {
    this.root = document.createElement('div');
    this.root.className = 'bzs-shell bzs-overlay-root';
    document.body.appendChild(this.root);
    document.addEventListener('pointerdown', this.onDocPointer, true);
    document.addEventListener('keydown', this.onDocKey, true);

    this.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      // 点遮罩空白处关闭；点弹窗内部不关
      if (target.dataset.role === 'scrim') {
        closeOverlay();
        return;
      }
      const hit = target.closest<HTMLElement>('[data-act]');
      if (!hit) return;
      e.preventDefault();
      this.onAction(hit.dataset.act || '', hit);
      // 动作改完状态后重画一次（遮罩内没有视图订阅）
      if (getState().overlay) this.paint();
    });

    this.root.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const role = t?.dataset?.role;
      if (!role) return;
      // 搜索框就地更新命中列表：重绘会把输入框换掉，手指还在打就被打断
      if (role === 'searchkw') {
        RT.searchKw = t.value;
        const list = this.root.querySelector<HTMLElement>('[data-role="hitlist"]');
        if (list) list.innerHTML = '';
        return;
      }
      // 排版滑块（pref）、年度目标（goal）、设置项（setting）走与书架同一条链路。
      // 之前这里只认 searchkw，三个排版滑块拖了没有任何反应。
      dispatchInput(t);
    });
  }

  /** 强调色换档：弹层拿的是同一套令牌，改档不必重画内容 */
  setAccent(accent: string): void {
    if (this.accent === accent) return;
    this.accent = accent;
    this.root.dataset.bzaccent = accent;
  }

  sync(): void {
    const o = getState().overlay;
    const kind = o?.kind ?? '';
    // 同一种弹层只重画一次；关闭时清空
    if (kind === this.lastKind && kind !== '') {
      this.paint();
      return;
    }
    this.lastKind = kind;
    this.paint();
  }

  private paint(): void {
    this.setAccent(shellPrefs().accent);
    this.root.innerHTML = overlayHtml();
    if (!this.root.innerHTML) this.lastKind = '';
    const o = getState().overlay;
    if (o?.kind === 'search') {
      const input = this.root.querySelector<HTMLInputElement>('[data-role="searchkw"]');
      input?.focus();
      const len = input?.value.length ?? 0;
      input?.setSelectionRange(len, len);
    }
    if (o?.kind === 'ai' || o?.kind === 'translate') void runAiForOverlay();
    // 想法浮窗：打开就把光标放进输入框，少一次点击
    if (o?.kind === 'idea') this.root.querySelector<HTMLTextAreaElement>('[data-role="idea"]')?.focus();
    if (o?.kind === 'rename') {
      const input = this.root.querySelector<HTMLInputElement>('[data-role="rename"]');
      input?.focus();
      input?.select();
    }
    // 解锁表：被拦下的那一行可能在一长串功能下面，把它滚到可见范围里
    if (o?.kind === 'unlock') {
      this.root.querySelector<HTMLElement>('.bzs-plan-row.is-cap')?.scrollIntoView({ block: 'center' });
    }
    // 书籍详情的封面：占位色块先出，真封面到了就地换图
    hydrateCovers(getShellSource()?.app, liveBooks(), this.root);
  }

  destroy(): void {
    document.removeEventListener('pointerdown', this.onDocPointer, true);
    document.removeEventListener('keydown', this.onDocKey, true);
    this.root.remove();
  }
}
