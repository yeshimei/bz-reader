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
import { isIosEnv, isMobileEnv, isMobileShell } from '../core/mobile';
import { t } from '../i18n';
import { planGroupLabel, planLabel, type PlanKey } from '../i18n/plan';
import { AI_TUTORIAL_URL, CLIP_TUTORIAL_URL } from '../core/links';
import { anchoredBelowRight, anchoredPlacement } from './anchored-style';
import { drawerLiftFor, keyboardHeightFromCss, sheetLift } from './keyboard-inset';
import { ideaSheetBodyHtml, ideaValue } from './idea-sheet';
import { fitIdeaInput } from './idea-grow';
import { MARK_ACTS, SELECTION_ACTS, planToolbarHit, toggleMoreMenu, toolbarHtml } from './text-toolbar';
import { aiCardHtml, bookmarkDeleteHtml, footnoteCardHtml, ideaConfirmHtml, ideaFullHtml, markBubbleHtml, markDeleteBarHtml } from './reader-cards';
import { HIGHLIGHT_COLORS } from '../data/notes';
import { aiAsk, type AiTask } from '../data/ai';
import type { ReaderBook } from '../data/schema';
import { collectStats } from '../data/stats';
import { cn, esc, coverHtml, ico } from './render/html';
import { setHtml } from '../ui/dom';
import { bmksOf, allMarks, fmtMinutes, fmtWhen, marksOf, shelfOf } from './domain';
import { ALL_SHELF, NO_SHELF, orderShelves } from '../data/shelves';
import { noteCardHtml } from './render/notes';
import { shelfActionsHtml, shelfFocusRole } from './render/shelf-row';
import { centeredModal, isCenterClass, isDrawerClass, scrimClasses } from './render/modal-shell';
import { cardTemplateChipsHtml, quoteCardHtml, quoteRefMarkdown } from './render/quote-card';
import { searchFormHtml, searchResultsHtml } from './render/search';
import { kickBodySearch, searchQueryKey, stopBodySearch } from './search-run';
import { noteSemanticInput } from './search-semantic';
import {
  bumpOverlayRev,
  closeOverlay,
  dismissesOnTap,
  getState,
  markIdeaDirty,
  overlayRenderKey,
  persistShellState,
  setStateQuiet,
  setIdeaDraft,
} from './state';
import { getShellSource, liveBooks, shellPrefs, shellSettings } from './source';
import { aiReady } from '../data/settings';
import { renderAiMarkdown } from './ai-md';
import { bzEmbedder, bzEntryReady } from '../data/bz-bridge';
import { kbLinkOf } from '../data/kb-link';
import { hydrateToolbarIcons } from './toolbar-icons';
import { aiCardBegin, aiCardDone, aiCardDrop, aiCardFail, aiCardGet, aiCardKey, aiCardReset, aiModeOf } from './ai-card';
import { glyphOf } from './adapt';
import { hydrateCovers } from './covers';
import { bindRangeTouch } from './range-touch';
import { PLAN_GROUPS, PLAN_TABLE, can, entitlement, planTotals, type Cap, type PlanCell } from '../data/entitlement';
import { buildNotesBody } from '../data/export';
import { dataDirOf } from '../core/plugin-path';
import { clampDailyGoal } from '../data/goal';
import { shelfLabel } from './shelf-label';
import { segHtml } from './render/seg';
import { TTS_RATE_RANGE } from '../data/prefs';
import { TTS_VOICE_IDS } from '../core/tts-api';
import { bindMaskDismiss } from '../core/mask-dismiss';
import { escManager } from '../core/esc-manager';
import { trapFocus } from '../core/ui/focus-trap';
import { RT } from './runtime';
import { rangeFill } from './range-fill';
import { getToc } from '../view/toc-state';
import { dispatchInput } from './actions';
import { groupButtonHtml } from './group';
import { chapterDigests } from '../data/portrait';
import { cachedPortrait, ensurePortrait } from './portrait-cache';
import { portraitStatusLine } from './render/portrait';

/* ─────────── 小工具 ─────────── */

function modal(title: string, sub: string, body: string, foot = '', cls = '', mask = ''): string {
  /* 带输入框的弹窗在移动端要居中偏上：底部抽屉会被软键盘顶出屏幕。
     按内容自动判定，省得每个调用点都要记得传类。
     页脚也要看：激活码框就在 foot 里，只看 body 会把它漏掉。 */
  const withInput = /<(input|textarea)\b/i.test(body) || /<(input|textarea)\b/i.test(foot);
  /* 两档例外：
     · `is-drawer`：仍然贴底（现在没有弹层用它，判据留着给键盘让位采样用）；
     · `is-center`：垂直居中、位置照书摘卡（分类管理 / 想法全文）。
     2026-11-09 分类管理从抽屉挪到居中：iOS 上系统先把窗口缩到键盘上方，
     抽屉再按键盘高抬一次等于把同一块让位扣两遍，卡片被压成一条缝。
     类必须同时落在遮罩与卡片上，见 modal-shell.ts。 */
  const drawer = isDrawerClass(cls);
  const center = isCenterClass(cls);
  const scrim = scrimClasses(mask, withInput, drawer, center);
  /* role / aria-modal（C6）：读屏要能听出「这是一张弹窗、焦点该留在这里」，
     宿主自己的 Modal 有这套，壳层弹窗以前是裸 div。焦点圈闭在 paint() 里挂。 */
  return `<div class="${scrim}" data-role="scrim"><div class="bzs-modal ${cls}" role="dialog" aria-modal="true" aria-label="${esc(
    title,
  )}">
    ${
      /* 抽屉把手：一条小横杠，暗示这卡片从底部升起。桌面上不显示（CSS）。 */
      drawer ? '<span class="bzs-sheet-grip" aria-hidden="true"></span>' : ''
    }
    <div class="bzs-mhead"><b>${esc(title)}</b><span class="n">${sub}</span><span class="sp"></span>
      <button class="x" data-act="close" title="${t('common.close')}">${ico('x')}</button></div>
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

function bookmarkById(id?: string | null, bookId?: string | null) {
  const books = liveBooks();
  for (const b of books) {
    if (bookId && b.id !== bookId) continue;
    const k = (b.notes?.bookmarks ?? []).find((x) => x.id === id);
    if (k) return { book: b, bookmark: k };
  }
  return null;
}

/* ─────────── 各弹层 ─────────── */

/**
 * 搜索命中列表（只这一段随输入替换）。
 *
 * 以前 input 里只写 RT.searchKw 就 return，而 `[data-role="hitlist"]` 从没被
 * 渲染过——用户打字时屏幕毫无变化，必须再点一下「本书 / 全库」才出结果。
 * 这里把「命中计算」交给纯函数 search-hits，顺便避免整块重绘打断中文输入法。
 */
function overlaySearch(): string {
  const { searchKw, searchScope } = getState();
  return modal(
    '搜索',
    '本书 / 全库',
    `${searchFormHtml('book')}<div data-role="hitlist">${searchResultsHtml(searchKw, searchScope, 'book')}</div>`,
    '',
    'wide tall',
  );
}

/**
 * 排版表单本体。
 *
 * 它现在有两个出口：阅读页右上角的浮层（主路径，边调边看）与
 * 命令面板兜底弹层。**同一个函数**，避免两处控件长歪。
 *
 * @param mobile 手机上不出现「栏数」：引擎的竖屏规则写死单栏，
 *   给了选择也是白给（缺省 `isMobileShell()`，桌面 force-mobile 验收时
 *   看到的也是手机上那一套；测试直接传两端）
 */
export function typographyFormHtml(mobile = isMobileShell()): string {
  const p = shellPrefs();

  const seg = (name: string, opts: Array<[string, string]>, cur: string): string =>
    segHtml(
      opts.map(([v, k]) => ({ v, k })),
      cur,
      { name },
    );

  const rng = (k: string, label: string, val: number, min: number, max: number, step: number, unit: string): string => {
    /* `.bzs-range`：移动端手势层，同设置页（见 shell/range-touch.ts） */
    return `<div class="bzs-setrow"><label>${label}</label>
      <span class="bzs-range"><input type="range" data-role="pref" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}" style="--fill:${rangeFill(min, max, val)}"></span>
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
    ${
      mobile
        ? ''
        : `<div class="bzs-setrow"><label>栏数</label>${seg(
            'columns',
            [
              ['1', '单栏'],
              ['2', '双栏'],
            ],
            String(p.columns),
          )}</div>`
    }
    <div class="bzs-setrow"><label>翻页</label>${seg(
      'flow',
      [
        ['paged', '分页'],
        ['scroll', '滚动'],
      ],
      p.flow,
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

/**
 * 朗读表单本体（2026-11-14）。
 *
 * 和排版面板同一副样子：改一项立刻生效（语速改的是播放中的 `<audio>`），
 * 不遮正文。音色只有两把嗓子，所以只给一个「音色」行——不再按旁白/对白分。
 */
export function ttsFormHtml(): string {
  const p = shellPrefs();
  const s = shellSettings();
  const seg = (name: string, opts: Array<[string, string]>, cur: string): string =>
    segHtml(
      opts.map(([v, k]) => ({ v, k })),
      cur,
      { name },
    );
  const voices: Array<[string, string]> = TTS_VOICE_IDS.map((id) => [
    id,
    t(id === 'stella' ? 'settings.ttsVoice.stella' : 'settings.ttsVoice.tide'),
  ]);
  /* 手机不列系统语音与本地服务：前者在 WebView 里时好时坏，后者要连电脑上
     那个 127.0.0.1，手机上没有。 */
  const mobile = isMobileShell();
  const engineOpts: Array<[string, string]> = mobile
    ? [['deepseek', t('settings.ttsEngine.deepseek')]]
    : [
        ['deepseek', t('settings.ttsEngine.deepseek')],
        ['local', t('settings.ttsEngine.local')],
        ['system', t('settings.ttsEngine.system')],
      ];
  const engine = mobile && p.ttsEngine === 'system' ? 'deepseek' : p.ttsEngine;
  const isLocal = engine === 'local';
  const isDeepseek = engine === 'deepseek';
  const bookBusy = getShellSource()?.isPrefetchingBook?.() ?? false;
  /* 这本书有没有离线音频：拷进来的包认到没有，靠这一行说清楚 */
  const offline = getShellSource()?.offlineAudioInfo?.() ?? null;
  return `<div class="bzs-setgrp flat bzs-typo">
    <div class="bzs-setrow"><label>${t('settings.ttsEngine')}</label>${seg('ttsEngine', engineOpts, engine)}</div>
    ${
      isDeepseek
        ? `<div class="bzs-setrow"><label>${t('settings.ttsVoice')}</label>${seg('ttsVoice', voices, p.ttsVoice)}</div>`
        : ''
    }
    ${
      isLocal
        ? `<div class="bzs-setrow"><label>${t('settings.ttsVoice.local')}</label>
      <input data-role="preftext" data-k="ttsVoiceLocal" placeholder="${t('settings.ttsVoice.local')}" value="${esc(p.ttsVoiceLocal)}" style="flex:1"></div>`
        : ''
    }
    <div class="bzs-setrow"><label>${t('settings.ttsRate')}</label>
      <span class="bzs-range"><input type="range" data-role="pref" data-k="ttsRate" min="${TTS_RATE_RANGE.min}" max="${TTS_RATE_RANGE.max}" step="${TTS_RATE_RANGE.step}" value="${p.ttsRate}" style="--fill:${rangeFill(TTS_RATE_RANGE.min, TTS_RATE_RANGE.max, p.ttsRate)}"></span>
      <span class="val">${p.ttsRate.toFixed(1)}×</span></div>
    <div class="bzs-setrow"><label>${t('settings.ttsFollow')}</label>${seg(
      'ttsFollow',
      [
        ['1', t('settings.ttsFollow.on')],
        ['0', t('settings.ttsFollow.off')],
      ],
      p.ttsFollow ? '1' : '0',
    )}</div>
    ${
      isLocal
        ? `<div class="bzs-setrow"><label>${t('settings.ttsPackFirst')}</label>${seg(
            'ttsPackFirst',
            [
              ['1', t('settings.ttsPackFirst.on')],
              ['0', t('settings.ttsPackFirst.off')],
            ],
            p.ttsPackFirst ? '1' : '0',
          )}</div>`
        : ''
    }
    <div class="bzs-setrow"><label>${t('settings.ttsTest')}</label>
      <button class="bzs-btn sm pri" data-act="ttstest">${t('settings.ttsTest')}</button>
      <span class="bzs-mini" data-role="ttstest-out"></span>
    </div>
    <div class="bzs-setrow">
      <button class="bzs-btn sm" data-act="ttsexportchapter">${t('tts.tune.exportChapter')}</button>
      ${isLocal ? `<button class="bzs-btn sm${bookBusy ? ' pri' : ''}" data-act="ttsprefetchbook">${t(bookBusy ? 'tts.tune.prefetchStop' : 'tts.tune.prefetchBook')}</button>` : ''}
    </div>
    <div class="bzs-setrow">
      <label>${t('tts.offline.title')}</label>
      <span class="bzs-mini" data-role="offline-state">${
        offline ? t('tts.offline.state', { chapters: String(offline.chapters), mb: String(offline.mb) }) : t('tts.offline.none')
      }</span>
      <button class="bzs-btn sm" data-act="ttsofflinereload">${t('tts.offline.reload')}</button>
      ${offline ? `<button class="bzs-btn sm" data-act="ttsofflinedel">${t('tts.offline.del')}</button>` : ''}
    </div>
  </div>`;
}

function overlayTts(): string {
  return `<div class="bzs-float is-corner no-head" data-role="float">
    <div class="bzs-mbody">${ttsFormHtml()}</div>
  </div>`;
}

function overlayTtsClear(info: string): string {
  const [count, mb, free] = info.split('|');
  return modal(
    t('tts.cacheClear.title'),
    '',
    `<div style="font-size:13px;line-height:2;color:var(--t2)">
      ${esc(
        t(free === '1' ? 'tts.cacheClear.bodyFree' : 'tts.cacheClear.body', {
          count: count ?? '0',
          mb: mb ?? '0',
        }),
      )}
    </div>`,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">${t('common.cancel')}</button>
     <button class="bzs-btn pri" data-act="ttscachecleardo">${t('tts.cacheClear.ok')}</button>`,
  );
}

/**
 * 清理离线音频（2026-11-14）：和清缓存同一副弹窗。
 *
 * 说的不是「缓存」而是「库里的文件」：离线包是可以被拷进 U 盘、跟着同步
 * 走的东西，删掉之前得让人明白删的是哪一层。
 */
function overlayOfflineClear(info: string): string {
  const [books, mb] = info.split('|');
  return modal(
    t('tts.offlineClear.title'),
    '',
    `<div style="font-size:13px;line-height:2;color:var(--t2)">
      ${esc(t('tts.offlineClear.body', { books: books ?? '0', mb: mb ?? '0' }))}
    </div>`,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">${t('common.cancel')}</button>
     <button class="bzs-btn pri" data-act="ttsofflinecleardo">${t('tts.offlineClear.ok')}</button>`,
  );
}

/**
 * 删掉**这一本**的离线音频（2026-11-14）。
 *
 * 和「清理离线音频」分开：那个是整库一把清，这个是「这本书我不要了」。
 * 只删 `bz-reader/offline/<书名>/`，正文和进度一根毫毛都不动。
 */
function overlayOfflineDel(info: string): string {
  const [title, chapters, mb] = info.split('|');
  return modal(
    t('tts.offlineDel.title'),
    esc(title || ''),
    `<div style="font-size:13px;line-height:2;color:var(--t2)">
      ${esc(t('tts.offlineDel.body', { chapters: chapters || '0', mb: mb || '0' }))}
    </div>`,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">${t('common.cancel')}</button>
     <button class="bzs-btn pri" data-act="ttsofflinedeldo">${t('tts.offlineDel.ok')}</button>`,
  );
}

function overlayExport(bookId?: string): string {
  const book = bookById(bookId);
  const md = buildPreview(book);
  return modal(
    '导出摘录',
    book ? esc(book.meta.title) : '全部书籍',
    `<div class="bzs-md">${esc(md)}</div>
     <div class="bzs-mini" style="margin-top:10px;line-height:1.9">每条引文都带章节与定位；导出到「${esc(
       shellSettings().exportDir,
     )}」目录，不覆盖你手写的同名笔记。</div>`,
    `<button class="bzs-btn" data-act="copytext" data-text="${esc(md)}">复制 Markdown</button>${closeBtn()}`,
    'wide',
  );
}

/**
 * 弹层里的预览：直接用落盘那份正文生成器。
 *
 * 以前这里手写了一套（`# 书名 · 摘录` + `**想法**：` + `[在原文中查看](obsidian://…)`），
 * 和真正导出的文件不是一回事——预览里看到的排版，存下来就变了。现在预览
 * 就是存下来的东西，一个字都不差（只少 frontmatter）。
 */
function buildPreview(book?: ReaderBook): string {
  const books = book ? [book] : liveBooks().filter((b) => (b.notes?.highlights ?? []).length);
  if (!books.length) return t('export.noNotes');
  const settings = shellSettings();
  return books.map((b) => buildNotesBody(b, settings)).join('\n\n---\n\n');
}

/* ─────────── 本章导读（2026-11-11） ─────────── */

/**
 * 导读弹层。
 *
 * 三种状态都画在这一张里：正在生成 / 失败（带重试）/ 有内容。
 * 不另开一张「生成中」的弹层——用户点完命令后眼睛还在同一个位置，
 * 换一张等于让他在两个窗口之间找。
 */
function overlayGuide(): string {
  const o = getState().overlay;
  const chapter = String(o?.chapterTitle ?? '').trim();
  const text = String(o?.text ?? '').trim();
  const busy = o?.busy === true;
  const error = o?.error === true;

  const body = busy
    ? `<div class="bzs-guide is-busy">${esc(t('guide.busy'))}</div>`
    : error
      ? `<div class="bzs-guide is-bad">${esc(text || t('guide.fail'))}</div>`
      : text
        ? `<div class="bzs-guide" data-ai-md>${esc(text)}</div>`
        : `<div class="bzs-guide is-empty">${esc(t('guide.empty'))}</div>`;
  const foot = busy
    ? closeBtn()
    : `<button class="bzs-btn" data-act="guidetry">${esc(t('guide.retry'))}</button>${closeBtn()}`;
  return modal(t('guide.title'), chapter || t('guide.noChapter'), body, foot);
}

function overlayBookmap(): string {
  const book = bookById(getState().bookId) ?? liveBooks()[0];
  if (!book) return modal('全书鸟瞰', '全书一屏鸟瞰', '<div class="bzs-empty">还没有打开的书。</div>', closeBtn(), 'wide');
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
  /* 鸟瞰的章节名来自标注，不是目录项：两者可能差一个「第一章」编号。
     先用完整名字精确找，再用包含关系兜底；找不到 href 时动作层还有名称回查。 */
  /* 有压缩画像时，每章补一句话摘要：鸟瞰不该只是「这章划了几条」 */
  const portrait = cachedPortrait(book.id) ?? null;
  if (cachedPortrait(book.id) === undefined) {
    void ensurePortrait(getShellSource()?.app, book.id, () => bumpOverlayRev());
  }
  const digestRows = portrait ? chapterDigests(portrait) : [];
  const digestOf = (title: string): string => {
    const name = title.trim();
    if (!name) return '';
    const exact = digestRows.find((d) => d.chapter.trim() === name);
    if (exact) return exact.line;
    const loose = digestRows.find((d) => {
      const l = d.chapter.trim();
      return !!l && (l.includes(name) || name.includes(l));
    });
    return loose?.line ?? '';
  };
  const toc = getToc()?.items ?? [];
  const hrefOf = (title: string): string => {
    const t = title.trim();
    if (!t) return '';
    const exact = toc.find((it) => (it.label || '').trim() === t);
    if (exact?.href) return exact.href;
    const loose = toc.find((it) => {
      const l = (it.label || '').trim();
      return !!l && (l.includes(t) || t.includes(l));
    });
    return loose?.href ?? '';
  };
  const rows = [...chapters.entries()]
    .map(
      /* 行要真的能点（S-05）：样式里早就有 cursor:pointer 和 hover 铜底，
         但 DOM 上没有 data-act——看着能点、点下去整块是死的。
         同时补 data-href：review 明确要求带 href，靠章节名回查 TOC 在
         编号不一致时多半找不到（TOC 的 label 常带「第一章」）。 */
      ([title, g], i) => `<div class="row" data-act="jumpch" data-label="${esc(title)}"${
        hrefOf(title) ? ` data-href="${esc(hrefOf(title))}"` : ''
      } role="button" tabindex="0">
        <span class="no">${cn(i + 1)}</span><span class="nm">${esc(title)}${
          digestOf(title) ? `<em class="dg">${esc(digestOf(title))}</em>` : ''
        }</span>
        <div class="strip">${Array.from({ length: Math.min(12, g.marks) }, () => '<u style="background:var(--copper)"></u>').join('')}</div>
        <span class="bzs-mini">${g.marks} 划 · ${g.bks} 签</span></div>`,
    )
    .join('');
  const body = `<div class="bzs-mini" style="margin-bottom:12px">${esc(book.meta.title || '未命名')} · ${
    chapters.size
  } 个有标注的章节 · ${bks.length} 枚书签 · ${marks.length} 条划线。点一行跳到那一章。</div>
    <div class="bzs-bmap">${rows || '<div class="bzs-empty">这本书还没有书签或划线。</div>'}</div>`;
  return modal('全书鸟瞰', '全书一屏鸟瞰', body, closeBtn(), 'wide tall');
}

function overlayQuote(
  text?: string,
  bookId?: string,
  chapterTitle?: string,
  template?: string,
  markId?: string,
): string {
  const book = bookById(bookId ?? getState().bookId);
  const t = text || RT.sel?.text || '';
  const ch = chapterTitle || RT.sel?.chapterTitle || '未命名章节';
  /* 没用过模板就用 RT.cardTpl 记着的那一版：换过一次版式之后，
     下次从别的划线打开还是同一版，不用每次都重选。 */
  const tpl = template || RT.cardTpl;
  const quoteMd = quoteRefMarkdown({
    text: t,
    title: book?.meta.title,
    author: book?.meta.author,
    chapter: ch,
  });
  const body = `${cardTemplateChipsHtml(tpl)}
    ${quoteCardHtml({
      text: t,
      bookTitle: book?.meta.title ?? '未命名',
      author: book?.meta.author ?? '佚名',
      chapter: ch,
      template: tpl,
    })}
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="bzs-btn pri" data-act="copytext" data-text="${esc(quoteMd)}">复制引用</button>
      <button class="bzs-btn" data-act="quotesave">存笔记</button>
      <button class="bzs-btn" data-act="quotecopyimg">复制图片</button>
    </div>`;
  /* 从划线打开时带 markId：工具条走 hl*，删除/复制都有据可依；
     从刚划的选区打开时没有 markId，退回 sel*（此时删除本来也不该出现）。 */
  const mark = markId ? markById(markId, bookId)?.mark : undefined;
  return textPanel(body, 'bzs-quote-panel', {
    active: 'quote',
    marked: !!markId,
    markId,
    bookId: markId ? (book?.id ?? bookId) : undefined,
    color: mark?.color,
  });
}

/**
 * 写想法：贴着划线的输入条（S10 定稿）。
 *
 * 只有一个输入区和一颗发送键；不重复原文、不放章节与说明。
 * 已有想法会预填，所以再点一次「写想法」就是修改。
 * 无遮罩：想法常常要对照正文写，遮住半页反而写不出来。
 * 有未保存内容时点外面 / 按 Esc，先出二次确认（state.ideaDirty）。
 */
function overlayIdea(markId?: string, bookId?: string): string {
  const found = markById(markId, bookId);
  if (!found) {
    const empty = '<div class="bzs-empty">这条标注已不存在。</div>';
    return isMobileEnv() ? textDialog(`<div class="bzs-float is-dialog bzs-idea-panel">${empty}</div>`) : bareFloat(empty, 'bzs-idea-panel');
  }
  const payload = {
    value: ideaValue(getState().ideaDraft, found.mark.comment),
    markId: found.mark.id,
    bookId: found.book.id,
  };
  const confirm = getState().ideaConfirm ? ideaConfirmHtml() : '';
  return textPanel(`${ideaSheetBodyHtml(payload)}${confirm}`, 'bzs-idea-panel', {
    active: 'idea',
    markId: found.mark.id,
    bookId: found.book.id,
    color: found.mark.color,
  });
}

/**
 * 点中已有划线：一列「想法 + 工具条」，两端的顺序相反。
 *
 * 桌面：想法在上、工具条在下——整块贴在划线**上方**，工具条离鼠标最近。
 * 手机：工具条在上、想法在下——工具条贴着选区，气泡从它下面展开，
 *   压的是划线**以下**的正文，不压住划线本身（真机反馈：反过来的话
 *   气泡把划线以上半屏都盖住了）。
 *
 * 手机以前只摆工具条：理由是「那一带没有空位放一段可能很长的想法」。
 * 2026-11-09 改掉——点划线的人第一件事就是看自己写过什么；想法在气泡里
 * 限高、可滚，超长的再点「展开全文」进只读弹窗，不会把工具条顶出屏幕。
 */
function overlayHltools(markId?: string, bookId?: string): string {
  const found = markById(markId, bookId);
  if (!found) return '';
  const { book, mark } = found;
  const toolbar = toolbarHtml({
    marked: true,
    compact: isMobileEnv(),
    kb: can('ai') && bzEntryReady(getShellSource()?.app),
    narrow: window.innerWidth < 520,
    color: mark.color ?? 'amber',
    colors: HIGHLIGHT_COLORS,
    acts: MARK_ACTS,
    attrs: `data-id="${esc(mark.id)}" data-book="${esc(book.id)}"`,
    kbDone: { term: !!kbLinkOf(mark.kb, 'term'), passage: !!kbLinkOf(mark.kb, 'passage') },
    icon: shellPrefs().toolbarStyle === 'icon',
  });
  /* 想法为空、但有知识盒链接时气泡也要出：点划线的人可能就是来点那枚链接的 */
  const bubble = mark.comment || mark.kb?.length ? markBubbleHtml(mark.comment ?? '', mark.kb, { markId: mark.id, bookId: book.id }) : '';
  const mobile = isMobileEnv();
  const stack = mobile ? `${toolbar}${bubble}` : `${bubble}${toolbar}`;
  return bareFloat(
    `<div class="bzs-tb-stack${mobile ? ' is-mobile' : ''}">${stack}</div>`,
    'bzs-hltools-panel has-stack',
  );
}

/**
 * 想法全文：一张只读的遮罩弹窗（长想法从气泡底部的「展开全文」进来）。
 *
 * 气泡里的高度是有限的，读一整篇（500 / 1000 字）得有一块能滚的完整卡。
 * 它不进工具条那一列——全文是「读」，不是「贴着这条划线操作」。
 *
 * 2026-11-09：手机上改走居中档，位置与书摘卡一致（下方留 22vh）。
 * 以前从屏幕底端升起，长文一大半在工具条与安全区之间，读完还要往上看
 * 才知道标题说的是哪本书。
 */
function overlayIdeaAll(markId?: string, bookId?: string): string {
  const found = markById(markId, bookId);
  if (!found) {
    /* 文案复用「找不到这条标注」那条通知：同一种处境说同一句话，
       也免得为一个空状态再开一条语言包条目 */
    return modal(
      t('tool.idea'),
      '',
      `<div class="bzs-empty">${esc(t('notice.mark.gone'))}</div>`,
      closeBtn(),
      centeredModal('ideaall') ? 'is-center' : '',
    );
  }
  const { book, mark } = found;
  const sub = [book.meta.title, mark.chapterTitle].filter((s) => !!s && s.trim()).join(' · ');
  return modal(
    t('tool.idea'),
    esc(sub),
    ideaFullHtml(mark.comment ?? ''),
    closeBtn(),
    centeredModal('ideaall') ? 'is-center' : '',
  );
}

/**
 * 删除确认：侧栏行的 × 点下去先问一句。
 *
 * 两种东西共用这套确认：划线（markId）与书签（bookmarkId）。
 * 以前都是「再点一次才删」（toast 提示），但在侧栏里连点两下和
 * 「一次没点准又补一下」几乎分不出来。删除不可撤销，所以不给「不再提示」。
 *
 * 划线有两条路：桌面上从文字工具框点「删除」时带锚点，出一张贴字的小条；
 * 从侧栏的 × 点进来没有锚点，仍走带标题的确认弹窗。
 */
function overlayConfirmDel(
  markId?: string,
  bookId?: string,
  bookmarkId?: string,
  anchor?: { left: number; top: number; width?: number; height?: number },
): string {
  /* 手机上删除确认与书摘 / AI 同一张遮罩弹窗：都从工具条上点出来，
     不该一个从底部抽屉来、另一个从中间来。桌面维持原来的浮卡。 */
  const mask = isMobileEnv() ? 'bzs-text-scrim' : '';
  if (bookmarkId) {
    const found = bookmarkById(bookmarkId, bookId);
    if (!found)
      return modal('删除书签', '', '<div class="bzs-empty">这枚书签已经不在了。</div>', closeBtn(), '', mask);
    const { book, bookmark } = found;
    const { body, foot } = bookmarkDeleteHtml({
      id: bookmark.id,
      bookId: book.id,
      label: bookmark.label || bookmark.chapterTitle || '书签',
      chapter: bookmark.chapterTitle,
      bookTitle: book.meta.title,
    });
    return modal('删除这枚书签？', esc(bookmark.chapterTitle ?? ''), body, foot, '', mask);
  }
  const found = markById(markId, bookId);
  if (!found) return modal('删除划线', '', '<div class="bzs-empty">这条标注已经不在了。</div>', closeBtn(), '', mask);
  const { book, mark } = found;
  /* 桌面工具条：和想法 / 书摘同一列——确认条在上、工具条在下，整块贴着
     划线。不再压遮罩、不再弹带标题的大卡；工具条位置不动，点完不用重找。 */
  if (!isMobileEnv() && anchor) {
    return textPanel(
      markDeleteBarHtml({ id: mark.id, bookId: book.id, hasIdea: !!mark.comment?.trim() }),
      'bzs-del-panel',
      { active: 'del', markId: mark.id, bookId: book.id, color: mark.color },
    );
  }
  const body = `<div class="bzs-qcard"><div class="q">${esc(mark.text)}</div>
      <div class="loc">${esc(book.meta.title || '')} · ${esc(mark.chapterTitle ?? '')}</div></div>
    <div class="bzs-mini" style="margin-top:12px;line-height:1.9">这条划线与它的想法会一起删掉，不能撤销。</div>`;
  return modal(
    '删除这条划线？',
    esc(mark.chapterTitle ?? ''),
    body,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn danger" data-act="delmarkdo" data-id="${mark.id}" data-book="${book.id}">删除</button>`,
    '',
    mask,
  );
}

/**
 * 批量删除确认（标注多选）。
 *
 * 一次删很多条，比单条更需要「删的是哪批」的实感：列前三条 + 总数，
 * 而不是只弹一句「确定删除 37 条吗」。删除不可撤销，所以不提供「不再提示」。
 */
function overlayConfirmDrop(): string {
  const ids = new Set(getState().noteSel);
  const rows = allMarks(liveBooks()).filter((m) => ids.has(m.id));
  if (!rows.length) return modal('删除标注', '', '<div class="bzs-empty">没有选中任何标注。</div>', closeBtn());
  const preview = rows
    .slice(0, 3)
    .map(
      (m) => `<div class="bzs-qcard"><div class="q">${esc(m.text)}</div>
      <div class="loc">${esc(m.bookTitle)} · ${esc(m.chapterTitle)}</div></div>`,
    )
    .join('');
  const more = rows.length > 3 ? `<div class="bzs-mini">还有 ${rows.length - 3} 条…</div>` : '';
  return modal(
    `删除选中的 ${rows.length} 条划线？`,
    '不能撤销',
    `${preview}${more}<div class="bzs-mini" style="margin-top:12px;line-height:1.9">这些划线下的想法会一起删掉。</div>`,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn danger" data-act="notedropdo">删除 ${rows.length} 条</button>`,
  );
}

/**
 * 浮层外壳：**没有遮罩**，也不吃正文上的点击。
 *
 * 排版面板、划线卡、脚注与想法都得「一边看正文一边操作」：遮罩一压，
 * 正文糊掉，用户只能调完再关掉看效果，等于还是弹窗。所以浮层直接挂在
 * fixed 容器里，正文照旧可点可滚。
 *
 * 定位不写 inline style：由 paint() 量完实际尺寸后按锚点摆放；
 * 没有锚点的（从侧栏打开）退回 CSS 里的居中/贴底。
 */

/**
 * 无头浮层：只有内容，没有标题与关闭按钮。
 * 关掉靠点外面（OverlayLayer 的文档级收口），不再多一枚 ✕。
 */
function bareFloat(body: string, cls: string): string {
  return `<div class="bzs-float ${cls} is-anchored" data-role="float">${body}</div>`;
}

/**
 * 手机上的文字面板：一张独立的遮罩弹窗，位置由 CSS 定（居中偏上），
 * 不跟工具条走——手机上工具条与面板一次只出现一样东西。
 */
function textDialog(inner: string): string {
  /* 手机上的文字面板也是「压住正文、焦点该留在里面」的弹窗（C6）。
     aria-label 不能省：只写 role="dialog" 时读屏只会念「对话框」，
     听不出打开的是想法、书摘还是 AI。 */
  return `<div class="bzs-scrim bzs-text-scrim" data-role="scrim" role="dialog" aria-modal="true" aria-label="${esc(
    t('common.dialog'),
  )}">${inner}</div>`;
}

/**
 * 文字面板的两种形态（S11 定稿）。
 *
 * **桌面**：正文在上、同一枚工具条在下，竖着叠一列。工具条永远在同一个
 * 高度上——打开想法 / 书摘 / AI 时它不会跳走，用户不用重新找按钮。
 * 整块再由 `placeAnchored()` 贴到划线之上。
 *
 * **手机**：正文单独进遮罩弹窗，工具条不参与。屏幕窄，一块地方只放得下
 * 一样；而且弹窗要能滚、要能被键盘顶起来，贴着字反而两头不讨好。
 *
 * `acts` 跟着「有没有具体这条划线」走：有 markId 就是 hl*（删除、复制都有
 * 对象），没有就退回 sel*（刚划完的选区，此时不该出现删除）。
 */
function textPanel(
  body: string,
  cls: string,
  opts: {
    active?: string;
    marked?: boolean;
    markId?: string;
    bookId?: string;
    color?: string;
  } = {},
): string {
  if (isMobileEnv()) {
    return textDialog(`<div class="bzs-float is-dialog ${cls}" data-role="float">${body}</div>`);
  }
  const attrs = opts.markId ? `data-id="${esc(opts.markId)}" data-book="${esc(opts.bookId ?? '')}"` : '';
  const marked = opts.markId ? markById(opts.markId, opts.bookId)?.mark : undefined;
  const toolbar = toolbarHtml({
    marked: opts.marked ?? true,
    color: opts.color,
    colors: HIGHLIGHT_COLORS,
    kb: can('ai') && bzEntryReady(getShellSource()?.app),
    narrow: window.innerWidth < 520,
    acts: opts.markId ? MARK_ACTS : SELECTION_ACTS,
    active: opts.active,
    attrs,
    kbDone: { term: !!kbLinkOf(marked?.kb, 'term'), passage: !!kbLinkOf(marked?.kb, 'passage') },
    icon: shellPrefs().toolbarStyle === 'icon',
  });
  /* 外壳透明，底板交给 `${cls}-body`：工具条要露在卡片外面，
     不能跟卡片共用一个底——两层白底叠起来像套了个相框。 */
  return bareFloat(
    `<div class="bzs-tb-stack"><div class="bzs-panel-body ${cls}-body">${body}</div>${toolbar}</div>`,
    /* `cls` 同时挂在浮层上：样式要按「里面装的是哪张卡」分支
       （AI 卡要内部滚动），用类名比 `:has()` 便宜得多。 */
    `${cls} has-stack`,
  );
}

/**
 * 脚注浮窗（S10 定稿）：左侧一枚「注」小印，其余全是注文。
 *
 * 不写标题「脚注」、也不摆「跳到原文 / 关闭」：注是正文的一句旁白，
 * 抬头与按钮会把它变成一份需要处理的文件。点外面就收。
 * 跨章脚注的回头路在正文里的链接上，不在这张卡里。
 */
function overlayFootnote(text?: string): string {
  return bareFloat(footnoteCardHtml(text ?? ''), 'bzs-fn-panel');
}

/**
 * AI 卡（S10 定稿）：只有结果与三个动作。
 *
 * 没有模式切换（解释 / 翻译 / 摘要已经各自是入口，卡里再摆一排等于让用户
 * 先选一次再等一次），没有模型名标签、没有免责说明。
 * 失败时把原因留在 body 里，「重试」就在下面——不要一句话把弹层关掉。
 */
function overlayAi(markId?: string, bookId?: string): string {
  /* 整段包在 if 里而不是提前 return：esbuild 会连模板一起删掉，
     base 包里就不会留下「AI 助手」的界面文案。 */
  let html = '';
  if (__BZ_READER_PRO__) {
    const s = shellSettings();
    const ready = aiReady(s);
    const o = getState().overlay;
    const text = o?.text || RT.sel?.text || '';
    const mode = aiModeOf(o?.mode);
    const entry = ready ? aiCardGet(aiCardKey('ai', mode, text)) : undefined;
    html = textPanel(
      aiCardHtml({
        ready,
        mode,
        quote: text,
        text: entry?.text,
        /* 没有记账 = 请求正要发出去：先画占位，别让卡片空着 */
        busy: entry ? entry.status === 'busy' : true,
        /* 追问轮次跟着账本走：重画之后还画得出问过的那几轮 */
        turns: entry?.turns,
        /* 有划线才给「存成想法」：纯选区没有可挂的地方，按钮点了也没处放 */
        canMark: !!markId,
      }),
      'bzs-ai-panel',
      {
        active: 'ai',
        marked: !!markId,
        markId,
        bookId,
        color: markId ? markById(markId, bookId)?.mark.color : undefined,
      },
    );
  }
  return html;
}

function overlayDict(word?: string): string {
  const w = word || RT.dictWord || '';
  const body = `<div class="bzs-dict"><div class="w">${esc(w)}</div>
      <div class="py">选中的词</div>
      <div class="df">插件本身不带离线词典。要查这个词，用下面的 AI 解释——它会结合你正在读的这段来解释，比通用词典更贴近上下文。</div></div>
    <div class="bzs-ai-src">词条来源：AI（需在设置里配置接口地址、模型与密钥）</div>`;
  return modal(
    '查词',
    '结合上下文解释',
    body,
    `<button class="bzs-btn pri" data-act="selai">用 AI 解释</button>${closeBtn()}`,
  );
}

function overlayPoster(): string {
  const books = liveBooks();
  const st = collectStats(books);
  /* 读完只认 completedTime（P2-06）：percent 不再是「读完」的判据，
     否则取消读完之后 percent 还停在 1，卡片和海报一直算它读完。 */
  const done = books.filter((b) => !!b.reading.stats.completedTime).length;
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
  const done = liveBooks().filter((b) => !!b.reading.stats.completedTime).length;
  /* 统计页一比一之后，每日目标档位从卡片上撤了，收进这里：
     年度目标与每日目标在同一处调，统计页不额外摆控件。 */
  const rawDaily = getShellSource()?.store.get().dailyGoalMinutes;
  const daily = clampDailyGoal(rawDaily);
  const chips = [10, 15, 20, 30, 45, 60].map((n) =>
    `<button class="bzs-chip${n === daily ? ' on' : ''}" data-act="setdailygoal" data-v="${n}">${t('stats.minutes', { n })}</button>`,
  ).join('');
  const body = `<div class="bzs-setgrp flat">
      <div class="bzs-setrow"><label>今年读</label>
        <span class="bzs-range"><input type="range" data-role="goal" min="5" max="100" step="1" value="${st.goal}" style="--fill:${rangeFill(5, 100, st.goal)}"></span>
        <span class="val" id="bzs-goalval">${t('stats.goal.value', { n: st.goal })}</span></div>
      <div class="bzs-setrow"><label>${t('stats.checkin.goal')}</label>
        <span style="display:inline-flex;flex-wrap:wrap;gap:6px">${chips}</span></div>
      <div class="bzs-mini" style="margin-top:12px;line-height:1.9">已完成 ${done} 本。目标只影响仪表盘上的那圈铜线。</div>
    </div>`;
  return modal('年度目标', '按自己的节奏来', body, closeBtn());
}

/**
 * 重置界面状态：把「会重置」与「不会动」分成两行对照。
 *
 * 最后一句必须点出**真正的数据位置**（可配置，见设置页的「数据目录」）：
 * 否则用户会以为「重置」等于清空数据，或者反过来以为数据没了。
 * 「纸色」那一档已经撤掉（底色跟宿主），文案里不能再提。
 */
function overlayReset(): string {
  const dir = dataDirOf();
  return modal(
    '重置界面状态',
    '只清书架的界面设置，不动你的书与笔记',
    `<div class="bzs-reset">
      <div><b class="k">会重置</b>：书库视图与筛选、年度目标、默认笔色。</div>
      <div><b class="k2">不会动</b>：书、阅读进度、划线、书签、AI 配置。</div>
      <div class="bzs-mini">阅读数据在 ${esc(dir)}/bz-reader.json 里，要清它请直接删那个文件。</div>
    </div>`,
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
  const missing = b.fileRef.fileMissing === true;
  if (cachedPortrait(b.id) === undefined) {
    void ensurePortrait(getShellSource()?.app, b.id, () => bumpOverlayRev());
  }
  const body = `<div class="bzs-detail">${coverHtml({
    coverUrl: null, // 真封面异步回填（paint 末尾 hydrateCovers），这里只出占位色块
    /* 1.0.0：占位色块以前写死棕色渐变 + 米色字，换主题（尤其浅色）时像贴了
       一张深色方片。改成跟宿主走的两级底色 + 次要文字色，glyph 仍用铜色
       （由 .bzs-cover 自己的样式给）。 */
    bg: 'linear-gradient(150deg, var(--background-secondary), var(--background-primary))',
    fg: 'var(--text-muted)',
    glyph: glyphOf(b.meta.title || '无题'),
    title: b.meta.title || '',
    id: b.id,
  })}<div>
      <h2>${esc(b.meta.title || '未命名')}</h2>
      <div class="au">${esc(b.meta.author || '佚名')}</div>
      <div class="desc">${esc(b.meta.description || '这本书还没有简介。')}</div>
      <div class="acts">
        ${
          missing
            ? `<button class="bzs-btn pri" data-act="missing" data-id="${b.id}">重新定位文件…</button>`
            : `<button class="bzs-btn pri" data-act="openbook" data-id="${b.id}">开始阅读 ›</button>`
        }
        <button class="bzs-btn" data-act="fav" data-id="${b.id}">${ico('star')} ${
          getState().favIds.includes(b.id) ? '已收藏' : '收藏'
        }</button>
        <button class="bzs-btn" data-act="done" data-id="${b.id}">${
          b.reading.stats.completedTime ? '标为在读' : '标为读完'
        }</button>
        ${
          can('ai')
            ? `<button class="bzs-btn" data-act="ptopen" data-id="${b.id}">${esc(t('detail.portrait.open'))}</button>`
            : ''
        }
      </div>
      <div class="bzs-kv"><b>阅读进度</b><span>${percent}%</span></div>
      <div class="bzs-kv"><b>累计时长</b><span>${fmtMinutes(b.reading.stats.totalReadTime || 0)}</span></div>
      <div class="bzs-kv"><b>划线 / 书签</b><span>${marks.length} 条 / ${bks.length} 枚</span></div>
      <div class="bzs-kv"><b>上次打开</b><span>${fmtWhen(b.reading.stats.lastReadTime)}</span></div>
      <div class="bzs-kv"><b>${esc(t('detail.portrait'))}</b><span>${esc(
        portraitStatusLine(cachedPortrait(b.id) ?? null, bzEmbedder(getShellSource()?.app).model),
      )}</span></div>
      <div class="bzs-kv"><b>文件</b><span style="max-width:280px;overflow:hidden;text-overflow:ellipsis${
        missing ? ';color:var(--vermilion)' : ''
      }">${esc(b.fileRef.vaultPath)}${missing ? '（失联）' : ''}</span></div>
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
 *
 * 2026-11-11 版式照商店详情那张对照长图（`docs/images/plan-compare.png`）：
 * 表头两行（列名 + 副标）、高级版整列淡底色、勾分色、底部合计。
 * 图与弹层是同一套行名、同一套勾叉，所以「图上看到的」就是「弹层里的」。
 */
function planCell(kind: 'free' | 'pro', v: PlanCell): string {
  /* `kind` 决定这一格属于哪一列：高级版那列要带 `pro`，样式才铺得上底色、
   * 勾才用铜金。以前这个参数没人用，两列长得一模一样。 */
  const cls = kind === 'pro' ? 'c pro' : 'c';
  if (v === 'yes') return `<i class="${cls} y">${ico('check')}</i>`;
  if (v === 'part') return `<i class="${cls} p">${t('unlock.part')}</i>`;
  /* 空勾位以前写「—」字符：靠 text-align 居中，和 SVG 勾不是一套对齐，
     72px 列里偏左 29px。现在留空格子，横线交给 CSS 的 ::before 画，
     三种格子都从同一条中心线起。 */
  return `<i class="${cls} n"></i>`;
}

/**
 * 对照表里带教程视频的那几行（2026-11-14）：键与行的 key 同名。
 *
 * 视频是这个功能怎么用的唯一说明，挂在行尾比另开一屏靠谱——用户正看着
 * 「AI 知识盒」「剪藏成书」两行，顺手就能看那两期。
 */
const PLAN_VIDEO: Partial<Record<PlanKey, string>> = {
  kb: AI_TUTORIAL_URL,
  clipEpub: CLIP_TUTORIAL_URL,
};

/* 导出给测试：这一屏是免费用户最常看到的，按钮与群号值得单独钉住 */
export function overlayUnlock(mode?: string): string {  const v = entitlement();
  /* 不传 mode = 只是「查看功能对照」（设置页那颗按钮），不高亮任何一行。
     以前这里兜底成 export，结果从设置页进来看全表，视线总被拽到导出那行。 */
  const cap = mode ? (mode as Cap) : undefined;
  const paid = v.tier === 'paid';

  /* 不再在表头上写「你点的是朗读 / 基础版此项需高级版」：
     那两行字占掉了整屏最贵的空间，信息量却等于「看下面那张表」。
     做法改成：直接在表里把这一项标亮，并滚到可见范围。

     2026-11-09 加分组的理由反过来：19 行一长串，用户滚一遍只记得「很多」。
     组标题让他知道自己正在看哪一类。分组只决定**插在哪**，行还是 PLAN_TABLE
     里那 19 行，所以高亮与滚动位置不受影响。 */
  const byKey = new Map(PLAN_TABLE.map((r) => [r.key, r]));
  const rows = PLAN_GROUPS.map((g) => {
    /* 组行也带两个空格子：高级版那一列的淡底色是**逐格**铺出来的，
       组行缺格就会把整列切断成几截。格子是空的，不带勾叉。 */
    const group = `<div class="bzs-plan-row is-group"><span>${esc(planGroupLabel(g.key))}</span><i class="c"></i><i class="c pro"></i></div>`;
    const body = g.rows
      .map((key) => {
        const r = byKey.get(key);
        if (!r) return '';
        const hot = !paid && !!cap && r.cap === cap;
        const video = PLAN_VIDEO[r.key];
        const videoLink = video
          ? ` <a class="bzs-plan-video" data-act="openvid" data-url="${esc(video)}">${esc(t('unlock.watchVideo'))}</a>`
          : '';
        return `<div class="bzs-plan-row${hot ? ' is-cap' : ''}">
        <span>${esc(planLabel(r.key))}${r.note ? `<em>${esc(r.note)}</em>` : ''}${videoLink}</span>
        ${planCell('free', r.free)}${planCell('pro', r.pro)}
      </div>`;
      })
      .join('');
    return group + body;
  }).join('');

  /* 表头是常驻的（样式里 sticky，见 overlay.css）：37 行要滚两屏，
     滚到「探索中」那一段还得知道哪一列是哪版。副标跟商店页同一口径——
     「免费不限时」和「一次买断永久」正是商品详情里写的那两句。 */
  const planHead = `<div class="bzs-plan-head">
      <span>${t('unlock.col.feature')}</span>
      <i class="c">${t('unlock.col.base')}<small>${t('unlock.col.base.sub')}</small></i>
      <i class="c pro">${t('unlock.col.pro')}<small>${t('unlock.col.pro.sub')}</small></i>
    </div>`;

  /* 合计与表同源：加一行就跟着变，不另写一份数字（图上的 8 / 29 也是这么来的）。 */
  const totals = planTotals();
  const total = `<div class="bzs-plan-row is-total">
      <span>${t('unlock.total')}</span>
      <i class="c"><b>${totals.free}</b><em>${t('unlock.unit')}</em></i>
      <i class="c pro"><b>${totals.pro}</b><em>${t('unlock.unit')}</em></i>
    </div>`;

  const body = `<div class="bzs-unlock">
      ${planHead}
      <div class="bzs-plan">
        ${rows}
        ${total}
      </div>
    </div>`;

  /* 购买区固定在页脚：正文的对照表再长、滚多远，它也钉在底部。以前购买条
     在正文里，表一长就被推出可视区。

     2026-11-12 删掉页脚的激活码框与「购买后拿到激活码，填在下面即可」那句
     提示：填码只有书架设置页的授权组一条正路，在这张「刚被拦下」的弹层里
     再放一枚输入框，只是让用户多找一次入口。手机上「收起 / 展开」两态也
     跟着一起消失——页脚不再有第二行。

     已激活的人看这张表只有一个出口：交流群。再摆一颗「去购买」，等于向
     已经付过钱的人推销一次。 */
  const foot = paid
    ? `<span class="sp"></span>${groupButtonHtml()}`
    : `<div class="bzs-unlock-foot">
        <div class="bzs-unlock-buy">
          <button class="bzs-btn pri" data-act="buy">${t('unlock.buy')}</button>
          ${groupButtonHtml()}
        </div>
      </div>`;

  /* 遮罩带 `bzs-unlock-scrim`：页脚没有输入框之后，手机上的中上落位不再
     由 `has-input` 捎带，得有一枚自己的类（见 mobile.css）。 */
  return modal(t('unlock.title'), paid ? t('unlock.activated') : '', body, foot, 'wide tall unlock', 'bzs-unlock-scrim');
}

function overlayPtClean(): string {
  const list = RT.ptOrphans;
  const body = `<div class="bzs-ack"><p>${esc(t('pt.clean.confirm'))}</p>
      <ul class="bzs-pt-orphans">${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  return modal(
    t('pt.clean'),
    '',
    body,
    `<button class="bzs-btn" data-act="close">${esc(t('pt.close'))}</button>
     <button class="bzs-btn pri danger" data-act="ptcleanyes">${esc(t('pt.clean'))}</button>`,
  );
}

/**
 * 重建索引的二次确认。
 *
 * 「重建」在这个插件里等于把这本书的索引整份删掉再重算：删掉的块、花掉的
 * 请求都收不回来，重算期间也没法一边读一边问。所以先摊开写清楚，再让他点。
 * 确认之后不自动开跑——回到「还没建索引」的空态重新选建法（2026-11-07 定稿）。
 */
function overlayRebuildIndex(): string {
  const body = `<div class="bzs-ack"><p>${esc(t('side.ai.rebuild.confirm'))}</p></div>`;
  return modal(
    t('side.ai.index.rebuild'),
    '',
    body,
    `<button class="bzs-btn" data-act="close">${esc(t('common.cancel'))}</button>
     <button class="bzs-btn pri danger" data-act="aiidxrebuildyes">${esc(t('side.ai.index.rebuild'))}</button>`,
  );
}

/**
 * 第一次用「问这本书」时把话说清楚：会把什么发出去、发到哪儿。
 *
 * 只弹一次（`settings.aiAck`），记在这台机器上：换台电脑再讲一遍是应该的。
 * 依据已经不是档位了（每次都是全书 + 共享打开时的笔记），所以这里只剩一种口径。
 */
function overlayAck(): string {
  const body = `<div class="bzs-ack"><p>${esc(t('ack.body.book'))}</p></div>`;
  return modal(t('ack.title'), '', body, `<button class="bzs-btn pri" data-act="ackok">${esc(t('ack.ok'))}</button>`);
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
 * 分类管理（2026-11-08）。
 *
 * 一份弹层，四种形态（`mode`）：
 *   ''        名单：上面一行新建框，下面每一类一行
 *   'new'     从书卡菜单「新建分类…」进来：光标直接落在新建框，建好把这本书放进去
 *   'rename'  某一格原地变成输入框，别的行还在（改完接着看得到全局）
 *   'del'     删除确认：先把「几本书会回到未分类」写清楚
 *
 * 为什么空分类也要画：名单存在业务数据里，跟书无关。以前分类条是从书上
 * 反推的，刚建好的空分类下一次重绘就没了，用户以为没建成。
 */
function overlayShelves(mode: string, name: string, bookId?: string): string {
  const used = liveBooks().map((b) => shelfOf(b));
  const names = orderShelves(getState().shelfList, used).filter((n) => n !== ALL_SHELF);
  /* 「未分类」是收尾那一格，不是用户建的分类：它没有可改的名字，也删不掉 */
  const real = names.filter((n) => n !== NO_SHELF);
  const countOf = (n: string): number => used.filter((x) => x === n).length;

  if (mode === 'del') {
    const n = countOf(name);
    return modal(
      t('shelves.del.title', { name }),
      '',
      `<div class="bzs-mini" style="line-height:1.9">${t('shelves.del.body', { n })}</div>`,
      `<span class="sp"></span><button class="bzs-btn" data-act="shelves">${t('common.cancel')}</button>
       <button class="bzs-btn danger" data-act="shelfdeldo" data-name="${esc(name)}">${t('shelves.del.do')}</button>`,
    );
  }

  const rows = names
    .map((n) => {
      if (n === NO_SHELF) {
        /* 收尾那格只报个数，不给动作：没有名字可改，也不该被删。
           显示名走语言包（数据值仍是 NO_SHELF，删/改都按它比对）。 */
        return `<div class="bzs-shelfrow is-none"><b class="nm">${esc(shelfLabel(n))}</b><span class="ct">${t('shelf.count', {
          n: countOf(n),
        })}</span></div>`;
      }
      if (mode === 'rename' && n === name) {
        return `<div class="bzs-shelfrow is-edit">
          <input type="text" data-role="shelfrename" value="${esc(n)}" maxlength="20" spellcheck="false">
          <button class="bzs-btn pri" data-act="shelfrenamesave" data-name="${esc(n)}">${t('shelves.save')}</button>
          <button class="bzs-btn" data-act="shelves">${t('common.cancel')}</button>
        </div>`;
      }
      return `<div class="bzs-shelfrow">
        <b class="nm">${esc(n)}</b><span class="ct">${t('shelf.count', { n: countOf(n) })}</span>
        ${shelfActionsHtml(n, {
          up: t('shelves.up'),
          down: t('shelves.down'),
          rename: t('shelves.rename'),
          del: t('shelves.del'),
        })}
      </div>`;
    })
    .join('');

  const newRow = `<div class="bzs-shelfnew">
      <input type="text" data-role="shelfnew" maxlength="20" spellcheck="false" placeholder="${t('shelves.new.ph')}">
      <button class="bzs-btn pri" data-act="shelfcreate"${bookId ? ` data-id="${esc(bookId)}"` : ''}>${t(
        bookId ? 'shelves.new.add' : 'shelves.new',
      )}</button>
    </div>`;

  const body = `${newRow}${real.length ? `<div class="bzs-shelflist">${rows}</div>` : ''}
    ${
      /* 一句说明只在这两处出现：名单空着（不知道这页是干什么的）、
         或者从书卡进来（要说明建完会顺手把书放进去） */
      real.length ? '' : `<div class="bzs-empty">${t('shelves.empty')}</div>`
    }`;

  return modal(
    t('shelves.title'),
    t('shelves.sub', { n: real.length }),
    body,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">${t('common.close')}</button>`,
    /* 居中档（2026-11-09）：不再贴底、也不再让卡片跟着键盘抬高。
       iOS 上系统会先把窗口缩到键盘上方，抽屉再按宿主报的键盘高抬一次，
       等于把同一块让位扣了两遍——卡片高度被扣到只剩一条缝，用户看到
       的就是「打不开」。居中之后卡片高度只由屏幕和内容决定，键盘只
       收缩遮罩的可用区（见 mobile.css 的 is-center）。 */
    centeredModal('shelves') ? 'is-center' : '',
  );
}

/**
 * 移出书架：归档，不删任何数据，也不删文件。
 *
 * 2026-11-06 改：以前这个确认框写的是「进度、划线、书签与想法一起删掉」，
 * 点一下真的删。现在只打归档标记——重新导入同一份文件就复活，
 * 所以按钮也不再是危险色。
 */
function overlayRemoveBook(bookId?: string): string {
  const b = bookById(bookId);
  if (!b) return modal('移出书架', '', '<div class="bzs-empty">这本书已不在书库。</div>', closeBtn());
  const marks = marksOf(b).length;
  const body = `<div style="font-size:13px;line-height:2;color:var(--t2)">
      《${esc(b.meta.title || '未命名')}》会从书架移走，但<b>数据都保留</b>：阅读进度、${marks} 条划线、书签与想法。<br>
      笔记库里的原文件 <code>${esc(b.fileRef.vaultPath)}</code> <b>不会</b>被删除。<br>
      以后重新导入同一份文件，会自动接上原来的进度和划线。
    </div>`;
  return modal(
    '移出书架',
    esc(b.meta.title || '未命名'),
    body,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn pri" data-act="removebookdo" data-id="${b.id}">移出书架</button>`,
  );
}

/**
 * 文件失联：书还在书架上，记录与数据都在，只是文件不在登记的路径上。
 *
 * 三个出口：在库里按指纹找、手动选一个文件、移出书架（归档）。
 * 不在这里「删记录」——数据一条都不该丢。
 */
function overlayMissing(bookId?: string): string {
  const b = bookById(bookId);
  if (!b) return modal('文件失联', '', '<div class="bzs-empty">这本书已不在书库。</div>', closeBtn());
  const name = b.meta.title || '未命名';
  const marks = marksOf(b).length;
  const body = `<div style="font-size:13px;line-height:2;color:var(--t2)">
      《${esc(name)}》的文件不在原来的位置了：<br>
      <code>${esc(b.fileRef.vaultPath)}</code><br>
      阅读进度、${marks} 条划线、书签与想法都还在，找到文件就能接上。<br>
      <span style="color:var(--t3);font-size:12px">如果只是改过名，点「在库里找一找」多半能自动认出来。</span>
    </div>`;
  return modal(
    '文件失联',
    esc(name),
    body,
    `<button class="bzs-btn pri" data-act="relocateauto" data-id="${b.id}">在库里找一找</button>
     <button class="bzs-btn" data-act="relocatepick" data-id="${b.id}">选择文件…</button>
     <span class="sp"></span>
     <button class="bzs-btn" data-act="archivebook" data-id="${b.id}">移出书架</button>`,
  );
}

/**
 * 从备份恢复（C12）：把「会发生什么」摊开写清楚，再让他点。
 *
 * 恢复的语义是**整份替换**——备份里有多少本，恢复后就是多少本，当前这台
 * 机器上的书、进度、划线一条都不留。这跟「导入」不是一回事，也和以前的
 * 「合并恢复」不是一回事，所以文案必须自己说出这一点，不能靠用户猜。
 */
function overlayRestore(): string {
  return modal(
    t('restore.title'),
    t('restore.sub'),
    `<div class="bzs-ack">
      <p>${esc(t('restore.body'))}</p>
      <p class="bzs-mini">${esc(t('restore.hint'))}</p>
    </div>`,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">${esc(t('common.cancel'))}</button>
     <button class="bzs-btn danger" data-act="restoredo">${esc(t('restore.do'))}</button>`,
  );
}

const MOVE_COPY: Record<'export' | 'import' | 'data', { title: string; bullets: string[] }> = {
  export: {
    title: '迁移导出目录',
    bullets: [
      '已经导出的书摘笔记会搬到新目录',
      '文件移动时 Obsidian 会同步改写库内所有指向它的链接，不会搬断',
      '中途失败会把已经搬走的文件挪回原处',
    ],
  },
  import: {
    title: '迁移书籍位置',
    bullets: [
      '书库里登记的书文件会搬到新目录',
      '库内指向这些书的链接由 Obsidian 一起改写',
      '书架上每本书的文件路径会跟着更新',
    ],
  },
  data: {
    title: '迁移数据目录',
    bullets: [
      '书架、划线、书签、阅读进度与封面会整体复制到新目录',
      '复制并校验通过后才删除旧目录；中途失败会原样保留',
      '已经粘进笔记的摘录链接不受影响，仍能跳回原文',
    ],
  },
};

function overlayMoveDir(mode: string, raw: string): string {
  const kind = mode === 'export' || mode === 'import' ? mode : 'data';
  let from = '';
  let to = '';
  try {
    const p = JSON.parse(raw || '{}') as { from?: string; to?: string };
    from = p.from || '';
    to = p.to || '';
  } catch {
    /* 坏数据按空处理，下面给重新选择的出口 */
  }
  const copy = MOVE_COPY[kind];
  if (!from || !to) {
    return modal(
      copy.title,
      '',
      '<div class="bzs-empty">目录信息不完整，请关掉重新选择。</div>',
      `<span class="sp"></span><button class="bzs-btn" data-act="close">关闭</button>`,
    );
  }
  const body = `<div class="bzs-move">
      <div class="bzs-move-row"><b>当前目录</b><code>${esc(from)}/</code></div>
      <div class="bzs-move-row to"><b>迁移到</b><code>${esc(to)}/</code></div>
      <ul class="bzs-unlock-list">
        ${copy.bullets.map((t) => `<li>${esc(t)}</li>`).join('')}
      </ul>
      <div class="bzs-mini">迁移要写一批文件，开始后请等提示完成再继续操作。</div>
    </div>`;
  return modal(
    copy.title,
    `${esc(from)} → ${esc(to)}`,
    body,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn pri" data-act="dodirmove">确认迁移</button>`,
  );
}

export function overlayHtml(): string {
  const o = getState().overlay;
  if (!o) return '';
  switch (o.kind) {
    case 'search':
      return overlaySearch();
    case 'typography':
      return overlayTypography();
    case 'tts':
      return overlayTts();
    case 'ttsclear':
      return overlayTtsClear(o.text ?? '0|0');
    case 'ttsofflineclear':
      return overlayOfflineClear(o.text ?? '0|0');
    case 'ttsofflinedel':
      return overlayOfflineDel(o.text ?? '||');
    case 'export':
      return overlayExport(o.bookId);
    case 'bookmap':
      return overlayBookmap();
    case 'guide':
      return overlayGuide();
    case 'quote':
      return overlayQuote(o.text, o.bookId, o.chapterTitle, o.mode, o.markId);
    case 'idea':
      return overlayIdea(o.markId, o.bookId);
    case 'ideaall':
      return overlayIdeaAll(o.markId, o.bookId);
    case 'hltools':
      return overlayHltools(o.markId, o.bookId);
    case 'confirmdel':
      return overlayConfirmDel(o.markId, o.bookId, o.bookmarkId, o.anchor);
    case 'notedrop':
      return overlayConfirmDrop();
    case 'footnote':
      return overlayFootnote(o.text);
    case 'ai':
      return overlayAi(o.markId, o.bookId);
    case 'dict':
      return overlayDict(o.word);
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
    case 'movedir':
      return overlayMoveDir(o.mode || 'data', o.text || '');
    case 'rename':
      return overlayRename(o.bookId);
    case 'shelves':
      return overlayShelves(o.mode || '', o.text || '', o.bookId);
    case 'removebook':
      return overlayRemoveBook(o.bookId);
    case 'missing':
      return overlayMissing(o.bookId);
    case 'ack':
      return overlayAck();
    case 'ptclean':
      return overlayPtClean();
    case 'rebuildidx':
      return overlayRebuildIndex();
    case 'restore':
      return overlayRestore();
    default:
      return '';
  }
}

/**
 * 上一次真正发出 AI 请求的键（`kind|task|text`）。
 *
 * 以前 `paint()` 里无条件调 `runAiForOverlay()`，而**点击弹层里任何按钮
 * 都会 `paint()`**：想点「存为笔记」，正文立刻变回「正在请求…」，刚看到的
 * 答案被抹掉并重新发一次（花的是用户的钱）；点一次模式切换会在同一 tick
 * 发两条，一条写进已经被替换掉的旧节点，纯浪费（P1-08）。
 *
 * 现在这份记号由 `shell/ai-card` 的账本承担：**在路上的不算重发、已经有
 * 结果的直接画回去**。同一条规则顺带治好了「答案只写在 DOM 上、重画就丢」
 * ——那个症状是卡片永远停在「正在请求…」。
 */

/** 只往「当前这张卡」里写：换档之后旧请求回来，不该污染新卡 */
function currentAiKey(): string {
  const o = getState().overlay;
  if (!o || o.kind !== 'ai') return '';
  const text = o.text || RT.sel?.text || '';
  return aiCardKey(o.kind, aiModeOf(o.mode), text);
}

/**
 * 把册子里的这一条画到**当前**的 DOM 上。
 *
 * 不缓存节点：请求要跑几十秒，中间任何一次重画都会把节点换掉，抓着旧节点
 * 写进去等于写在空气里（用户看到的就是「一直正在请求」）。
 */
function writeAiBody(key: string): void {
  if (!key || currentAiKey() !== key) return;
  const entry = aiCardGet(key);
  /* 还在路上（正文是空的）：占位文案由渲染那一侧画，这里不要写一个空串进去 */
  if (!entry || !entry.text) return;
  const node = document.querySelector<HTMLElement>('[data-role="aibody"]');
  if (!node) return;
  node.textContent = entry.text;
  /* 换了新文本：清掉「已渲染」标记，否则会被当成渲染过而停在纯文本 */
  delete node.dataset.aiRendered;
  renderAiMarkdown(node);
}

/** 正在跑的请求：`RT.aiAbort` 给「取消请求」用，这里额外记着它是哪一档 */
let aiInFlight: { key: string; ctrl: AbortController } | null = null;

/** AI 请求：弹层打开后自己发一次，结果记进册子并回填到 [data-role="aibody"] */
export async function runAiForOverlay(): Promise<void> {
  const o = getState().overlay;
  if (!o || o.kind !== 'ai') return;
  /* 到期 / 未解锁不再发请求：弹层可能是在有码时打开的，跑完再点重试也得拦 */
  if (!can('ai')) return;
  const s = shellSettings();
  if (!aiReady(s)) return;
  const text = o.text || RT.sel?.text || '';
  const task: AiTask = aiModeOf(o.mode);
  const key = aiCardKey(o.kind, task, text);

  /* 同一条还在路上：把占位画回去就够，绝不重复发（花的是用户的钱） */
  if (aiInFlight?.key === key) {
    writeAiBody(key);
    return;
  }
  const entry = aiCardGet(key);
  /* 已经问过：结果 / 失败原因都还在册子上，画回去即可。失败不自动重发，
     重发是「重试」那颗按钮的事——自动重发等于用户每点一下都扣一次费 */
  if (entry && entry.status !== 'busy') {
    writeAiBody(key);
    return;
  }
  /* 换档 / 换一段：把旧请求掐掉，它的机会已经过去了 */
  if (aiInFlight) {
    const old = aiInFlight;
    aiInFlight = null;
    if (RT.aiAbort === old.ctrl) RT.aiAbort = null;
    old.ctrl.abort();
    aiCardDrop(old.key);
  }
  aiCardBegin(key);
  const ctrl = new AbortController();
  aiInFlight = { key, ctrl };
  RT.aiAbort = ctrl;
  try {
    const res = await aiAsk(s, { task, text }, { signal: ctrl.signal });
    if (aiInFlight?.ctrl === ctrl) {
      aiInFlight = null;
      RT.aiAbort = null;
    }
    /* 只进卡片的册子，**不**写侧栏的问答记录：工具栏这条路是「问一小段」，
       侧栏那条是「问整本书」，两边的上下文、花费、追问方式都不一样。
       以前把自己的结果也 push 进侧栏日志，用户会看到侧栏凭空多出一条
       没有提问的答案，捡起来接着问还会发现它根本没有书的依据。 */
    aiCardDone(key, res.text);
  } catch (e) {
    if (aiInFlight?.ctrl === ctrl) {
      aiInFlight = null;
      RT.aiAbort = null;
    }
    /* 被掐掉的请求不留「已取消」这种假结果：取消按钮自己会写一条给人看的，
       换档则连这条都不需要——旧档切回来应该重新问 */
    if (!ctrl.signal.aborted) aiCardFail(key, (e as Error).message);
    else aiCardDrop(key);
  }
  /* 卡已经关了 / 换了另一档：这份结果没人看，别留在册子上冒充「问过了」 */
  if (currentAiKey() !== key) aiCardDrop(key);
  writeAiBody(key);
}

/* ─────────── 容器 ─────────── */

/**
 * 全屏弹层容器。挂 body，用 fixed 定位；内部带 .bzs-shell 拿设计令牌，
 * 但背景透明，所以只是「一层可以放弹窗的空气」，不会给宿主窗口染色。
 */
export class OverlayLayer {
  readonly root: HTMLElement;
  /** 卸载时要撤掉的监听（键盘补偿等） */
  private disposers: Array<() => void> = [];
  private accent = '';
  /** 上一次画的是哪种弹层：同种重画不算「打开」，不抢输入焦点 */
  private lastKind = '';
  /** 当前弹窗的焦点圈闭解绑：每次重画换新节点，旧的跟着旧节点作废 */
  private untrap: (() => void) | null = null;
  /** 正文命中到达时只换命中列表；搜索浮层关闭 / 重画时摘掉 */
  private hitlistCb: (() => void) | null = null;
  /** 上一次算出的键盘抬升：数值不变就不碰 CSS 变量，省掉无谓的重排 */
  private kbLift = -1;
  /** 键盘采样令牌：新一次聚焦会让上一轮 rAF 循环作废 */
  private kbSample = 0;
  /** 最近一次 keyboardWillHide 的时刻：宿主变量可能滞后，一小段时间内不信它 */
  private kbHiddenAt = 0;
  /** 键盘弹起前的完整窗口高：用来识别 iOS 是否已经把 WebView 缩到键盘上方 */
  private baseInnerHeight = 0;
  /**
   * 搜索浮层被隐藏时的整棵 DOM（含遮罩）。
   *
   * 用户点一条结果跳走、再打开搜索，期望的是「刚才那一屏还在」：同样的词、
   * 同样的结果、同样的滚动位置。真的关闭（清空 DOM）就得从零开始，所以
   * 关闭只是把节点收进这里，再次打开原样挂回，不重渲染。
   */
  private searchStash: HTMLElement | null = null;
  /** 缓存的搜索屏属于哪一轮（词 + 范围）；跟当前状态不一致就不再复用 */
  private searchStashKey = '';
  /** 隐藏那一刻的滚动位置：节点脱离文档后 scrollTop 不保证还保留 */
  private searchScroll = 0;

  /**
   * 浮层（排版 / 工具条 / 脚注 / 书摘 / AI / 想法）没有遮罩，所以「点空白处
   * 关闭」得自己在文档级收：用捕获阶段的 pointerdown，且**不阻断**事件——
   * 点正文照样能选字、翻页。
   *
   * 写想法也走这条路：空着直接关，有字先亮确认条（判断在 closeOverlay 里）。
   * 唯一的例外是点浮层自己——那一下是用户在操作这张卡。
   */
  private onDocPointer = (e: PointerEvent): void => {
    if (!dismissesOnTap(getState().overlay?.kind)) return;
    const t = e.target as Node | null;
    if (t && this.root.contains(t)) return;
    closeOverlay();
  };

  /**
   * ESC 交给 `core/esc-manager` 统一收口（C6）。
   *
   * 以前这里自己挂 document 级 keydown，谁后注册谁先跑，和宿主自带的
   * 弹窗（`ui/modal` 已经走 escManager）完全是两套顺序：叠在一起时先关
   * 哪一层取决于模块加载顺序。注册成一层之后，ESC 从最上面那一层开始关。
   */
  private esc: { unregister: () => void } | null = null;

  constructor(private onAction: (act: string, el: HTMLElement) => void) {
    this.root = createDiv();
    /* `is-mobile` 让移动端的滑杆手势层生效（见 shell/range-touch.ts 与
       styles.css 的 `.bzs-range`）；桌面端不加，原生手感不变。 */
    this.root.className = `bzs-shell bzs-overlay-root${isMobileShell() ? ' is-mobile' : ''}`;
    this.disposers.push(bindRangeTouch(this.root));
    /* 视口一变（手机键盘弹起 / 桌面改窗口大小）就重新摆位：
       锚点浮层贴着文字，贴底卡抬到键盘之上。 */
    const sync = (): void => this.syncPosition();
    const vv = window.visualViewport;
    if (vv && isMobileShell()) {
      vv.addEventListener('resize', sync);
      vv.addEventListener('scroll', sync);
      this.disposers.push(() => {
        vv.removeEventListener('resize', sync);
        vv.removeEventListener('scroll', sync);
      });
    }
    window.addEventListener('resize', sync);
    this.disposers.push(() => window.removeEventListener('resize', sync));
    /* 宿主在键盘显隐时派发 Capacitor 的同名事件（Obsidian 自己也听）：
       --keyboard-height 随后才更新，抽屉要在这之后重新量一次。
       hide 时先直接归位，不等变量更新——视觉上跟手，变量晚到也不会回弹。 */
    const onKbShow = (): void => {
      this.kbHiddenAt = 0;
      this.sampleKeyboard(600);
    };
    const onKbHide = (): void => {
      this.kbHiddenAt = performance.now();
      this.kbLift = 0;
      this.root.setCssProps({ '--bzr-kb': '0px' });
      this.root.classList.remove('is-kb');
    };
    window.addEventListener('keyboardWillShow', onKbShow);
    window.addEventListener('keyboardWillHide', onKbHide);
    this.disposers.push(() => {
      window.removeEventListener('keyboardWillShow', onKbShow);
      window.removeEventListener('keyboardWillHide', onKbHide);
    });
    document.body.appendChild(this.root);
    document.addEventListener('pointerdown', this.onDocPointer, true);
    /* 输入框里的 Esc 是「放弃这次输入」，不该顺手把整个弹层关掉（P3-14）：
       写想法写到一半按 Esc，以前是连内容一起没了。 */
    this.esc = escManager.register('bzr-shell-overlay', {
      isVisible: () => !!getState().overlay,
      close: () => {
        const t = document.activeElement as HTMLElement | null;
        if (t && this.root.contains(t) && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
          t.blur();
          return;
        }
        /* 走关闭动作而不是直接 closeOverlay：弹层关闭要带副作用
           （建画像时暂停 + 退回「当前这一屏」）。直接关会绕过它们。 */
        this.onAction('close', this.root);
      },
    });
    this.disposers.push(() => this.esc?.unregister());

    this.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      /* 遮罩关闭交给 bindMaskDismiss（挂在 paint 里那层 scrim 上）：
         以前这里判 `target.dataset.role === 'scrim'`，在弹窗里选字、鼠标滑到
         遮罩上松手时 click 的 target 就是遮罩，面板被误关。 */
      const hit = target.closest<HTMLElement>('[data-act]');
      if (!hit) return;
      e.preventDefault();
      const plan = planToolbarHit(hit.dataset.act);
      if (plan.kind === 'ignore') return;
      /* 「⋯」只开合自己的菜单：就地切一个类，不派发、**不重画**。
         以前这里没有分支，点下去被当成一次普通动作发出去，紧接着
         paint() 把刚画出来的菜单连同 DOM 一起换掉——手机上看到的就是
         「闪一下，打不开」。 */
      if (plan.kind === 'more') {
        const bar = hit.closest<HTMLElement>('.bzs-tb');
        const open = toggleMoreMenu(bar, window.innerHeight);
        hit.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      const before = overlayRenderKey(getState());
      this.onAction(plan.act, hit);
      /* 动作改完状态后重画一次（遮罩内没有视图订阅）。
         rate 例外：它只改星星的 class，紧接着重画会按「还没保存的 rating」
         重建 DOM，星星立刻熄灭、保存下来是 0 星。

         去重（C7）：状态变了的话，`repaint()` 的广播已经走到 sync()→paint()
         画过一遍了；这里再画一次就是整棵 DOM 重建两遍（外加一次封面回填）。
         只有「状态变了但内容键没体现」的变化（换笔色、勾选）才需要补一次。 */
      if (!getState().overlay || plan.act === 'rate') return;
      if (overlayRenderKey(getState()) === before) this.paint();
    });

    /* 追问输入框的回车（2026-11-10）：卡里的输入框是渲染出来的 HTML，
       没法在节点上挂事件——在根节点委托一层。输入法组字中的回车不算，
       否则选词那一下会把半句话发出去。 */
    this.root.addEventListener('keydown', (e) => {
      const el = e.target as HTMLElement | null;
      /* 按意思搜只在回车时发请求：输入法组字中的回车不算，否则选词那一下
         就把半句话拿去检索了。 */
      if (el?.dataset?.role === 'searchkw') {
        if (e.key !== 'Enter' || e.isComposing) return;
        if (getState().searchMode !== 'semantic') return;
        e.preventDefault();
        this.onAction('semrun', el);
        return;
      }
      /* 语义结果行是 div + role=button：键盘 Enter / Space 与点击同效 */
      if ((e.key === 'Enter' || e.key === ' ') && el && !/^(INPUT|TEXTAREA)$/.test(el.tagName)) {
        const row = el.closest<HTMLElement>('[data-act="semhittotext"]');
        if (row) {
          e.preventDefault();
          this.onAction('semhittotext', row);
          return;
        }
      }
      if (el?.dataset?.role !== 'aifollow') return;
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      this.onAction('aifollow', el);
    });

    this.root.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const role = t?.dataset?.role;
      if (!role) return;
      /* 想法：记下正在打的字（重绘时要放回去），并判断有没有改动。
         「有改动」比「非空」准确：打开一条已有想法、什么都不改就点别处，
         不该被问一遍；把旧想法整条删掉反而是改动，必须问。 */
      if (role === 'idea') {
        const o = getState().overlay;
        const found = o ? markById(o.markId, o.bookId) : null;
        setIdeaDraft(t.value);
        markIdeaDirty(t.value.trim() !== (found?.mark.comment ?? '').trim());
        /* 打字 / 回车换行时按内容撑高，长到上限就停在样式表给的 max-height。
           高度真变了才重新贴字：每敲一个字符都重排浮层会抖。 */
        if (fitIdeaInput(t as HTMLTextAreaElement)) this.placeAnchored();
        return;
      }
      // 搜索框就地更新命中列表：重绘会把输入框换掉，手指还在打就被打断
      if (role === 'searchkw') {
        /* 输入过程不整页重绘，也不落盘（A-24）：`setState` 每敲一个字都会
           广播 + 同步写一次 localStorage，中文输入法还会被打断。与书架搜索页
           （shelf-panel.ts）用同一条 setStateQuiet；关闭浮层时由 closeOverlay
           走一次正常持久化。 */
        setStateQuiet({ searchKw: t.value });
        /* 按意思搜不边打边搜：一次嵌入要钱，只清旧结果、等回车 */
        if (getState().searchMode === 'semantic') {
          noteSemanticInput(t.value);
          return;
        }
        const list = this.root.querySelector<HTMLElement>('[data-role="hitlist"]');
        if (list) setHtml(list, searchResultsHtml(t.value, getState().searchScope, 'book'));
        kickBodySearch(t.value, getState().searchScope);
        return;
      }
      // 排版滑块（pref）、年度目标（goal）、设置项（setting）走与书架同一条链路。
      // 之前这里只认 searchkw，三个排版滑块拖了没有任何反应。
      dispatchInput(t, e);
    });
    /* 松手 / 输入法上屏之后收口一次：input 期间走的是静默写入，不重绘（P1-09）。
       以前只有 input 一个监听，重绘就发生在拖动途中。 */
    const settle = (e: Event): void => {
      const t = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (t?.dataset?.role) dispatchInput(t, e);
    };
    this.root.addEventListener('change', settle);
    this.root.addEventListener('compositionend', settle);
    /* 贴底抽屉里的新建框：上次可能把名单滚到了中间，聚焦时先回顶部，
       免得输入框看着「不在开头」。改名框不滚——它就在名单里的某一行。 */
    this.root.addEventListener('focusin', (e) => {
      /* 键盘动画可能只报一次中途高度，聚焦后补采样到动画停稳 */
      this.sampleKeyboard();
      const el = e.target as HTMLElement | null;
      if (el?.dataset?.role !== 'shelfnew') return;
      const body = el.closest('.bzs-mbody');
      if (body instanceof HTMLElement) body.scrollTop = 0;
    });
    /* 键盘收起同样是动画，变量要跟着落回 0 */
    this.root.addEventListener('focusout', () => this.sampleKeyboard());
  }

  /** 强调色换档：弹层拿的是同一套令牌，改档不必重画内容 */
  setAccent(accent: string): void {
    if (this.accent === accent) return;
    this.accent = accent;
    this.root.dataset.bzaccent = accent;
  }

  /**
   * 跟着壳层状态重画。
   *
   * 调用方（`plugin.registerShellSync`）已经按 `overlayKey` 判过「内容变了」，
   * 这里直接画就行（P3-02）。以前这里还维护一个 `lastKind`，两个分支都
   * `paint()`——注释里「同一种弹层只重画一次」根本不成立，等于每次 sync
   * 都全量重建一次弹层 DOM。
   */
  sync(): void {
    const o = getState().overlay;
    const kind = o?.kind ?? '';
    /* 同一种弹层重画不算「打开」：亮确认条、点「继续写」都会走到这里，
       重新聚焦会把手机键盘再顶起来一次，而用户的手刚离开输入框。 */
    const prev = this.lastKind;
    const opening = kind !== prev;
    this.lastKind = kind;
    /* 搜索词在输入期间是 setStateQuiet 写的（不广播、不落盘）。离开搜索浮层
       时补一次正常持久化（A-24）——不广播，避免这次关闭再触发一轮重绘。
       同时把整棵搜索 DOM 收起来：再次打开要原样还回去，不重渲染。 */
    if (prev === 'search' && kind !== 'search') {
      this.stashSearch();
      persistShellState();
      /* 按意思搜的请求不掐：它已经花过钱了，回来还能在下次打开时直接看到；
         字面搜索的逐本扫描则是纯本地开销，关掉就该停。 */
      if (getState().searchMode !== 'semantic') stopBodySearch();
    }
    /* 打开搜索浮层：缓存的词还跟当前状态对得上就直接复用旧屏；
       对不上（书架搜索页可能已经改过词）就丢掉重开，免得输入框和结果各说各话。 */
    if (opening && kind === 'search') {
      if (this.searchStash && !this.stashMatches()) this.searchStash = null;
      if (!this.searchStash && getState().searchMode === 'literal') {
        kickBodySearch(getState().searchKw, getState().searchScope);
      }
    }
    this.paint(opening);
  }

  /**
   * 把浮层摆到文字旁边。
   *
   * 量的是渲染后的真实尺寸（想法框会因为内容变高），再交给纯函数算：
   * 移动端贴文字下方、桌面端贴上方，放不下才翻边。
   * 尺寸拿不到（还没布局）时保留 CSS 兜底位置，不会闪到屏幕角上。
   */
  private placeAnchored(): void {
    const o = getState().overlay;
    const anchor = o?.anchor;
    if (!anchor) return;
    /* 排版浮层不是「贴文字」：它贴的是头栏那颗按钮，右缘对齐、按钮下方 8px。
       按同一条 anchor 传进来，但落点规则不同（见 anchoredBelowRight）。 */
    if (o?.kind === 'typography') {
      this.placeCorner(anchor);
      return;
    }
    const el = this.root.querySelector<HTMLElement>('.bzs-float.is-anchored');
    if (!el) return;
    const view = this.viewBox();
    const pos = anchoredPlacement(
      anchor,
      { width: el.offsetWidth, height: el.offsetHeight },
      view,
      /* 上下只看真实承载：桌面验收时开 force-mobile 不该把「工具条在文字下方」
         也一起模拟过去——用户在桌面上要的就是鼠标习惯（贴上方）。 */
      isMobileEnv() ? 'below' : 'above',
    );
    el.setCssProps({ left: `${pos.left}px`, top: `${pos.top}px`, transform: 'none' });
    /* 工具条永远贴着划线那一侧：整块落在下方时工具条在上，落在上方时工具条在下。
       两端的 HTML 默认顺序不同（桌面气泡在前、手机工具条在前），
       所以标记落点、由 CSS 按 is-mobile 分开反转，别互相误伤。 */
    if (el.classList.contains('bzs-hltools-panel')) {
      const stack = el.querySelector<HTMLElement>('.bzs-tb-stack');
      if (stack) {
        stack.classList.toggle('is-up', pos.side === 'above');
        stack.classList.toggle('is-down', pos.side === 'below');
      }
    }
  }

  /** 可视区尺寸：手机上按视觉视口（键盘弹起时缩小），桌面用窗口 */
  private viewBox(): { width: number; height: number; top: number } {
    const vv = window.visualViewport;
    return isMobileShell() && vv
      ? { width: vv.width, height: vv.height, top: vv.offsetTop }
      : { width: window.innerWidth, height: window.innerHeight, top: 0 };
  }

  /**
   * 排版浮层贴着头栏「排版」按钮。
   *
   * 没有按钮坐标（命令面板 / 快捷键 t / 手机 ⋮ 菜单）时不写内联样式，
   * 交回 CSS 的兜底位置（桌面右上角、手机贴底整条）——硬算一个旧坐标
   * 比不贴更糟。
   */
  private placeCorner(anchor: { left: number; top: number; width?: number; height?: number }): void {
    const el = this.root.querySelector<HTMLElement>('.bzs-float.is-corner');
    if (!el) return;
    const pos = anchoredBelowRight(anchor, { width: el.offsetWidth, height: el.offsetHeight }, this.viewBox());
    /* right / bottom 要写掉：窄窗时容器查询会把 is-corner 改成贴底整条，
       只写 top/left 会让卡片同时被 top 与 bottom 拉长。 */
    el.setCssProps({
      left: `${pos.left}px`,
      top: `${pos.top}px`,
      right: 'auto',
      bottom: 'auto',
      transform: 'none',
    });
  }

  /** 视口变化后的统一收口：锚点浮层重新贴字，贴底小卡与抽屉避让键盘 */
  private syncPosition(): void {
    this.placeAnchored();
    this.syncKeyboardVar();
    const vv = window.visualViewport;
    if (!isMobileShell() || !vv) return;
    const lift = sheetLift({ innerHeight: window.innerHeight, visualHeight: vv.height });
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('.bzs-float.is-sheet'))) {
      el.setCssProps({ bottom: `calc(${10 + lift}px + env(safe-area-inset-bottom, 0px))` });
    }
  }

  /**
   * 贴底弹窗（.bzs-scrim.is-drawer）靠 --bzr-kb 抬到键盘上沿：
   * 底边抬起、最大高度同步扣掉，输入框就不会被键盘盖住。
   * is-kb 只在键盘弹起时挂上——抬起有过渡，落回时直接归位不拖。
   * 数值没变就不碰样式，免得 resize 连发时一直触发重排。
   */
  private syncKeyboardVar(): void {
    if (!isMobileShell()) return;
    const vv = window.visualViewport;
    if (!vv) return;
    /* 优先用宿主自己维护的 --keyboard-height（移动工具栏也靠它定位）：
       部分安卓 WebView 的 visualViewport 只报一半键盘高，拿它抬抽屉会停在半路。
       宿主变量读不到（桌面验收、老版本）时才退回视觉视口差值。 */
    const host = this.hostKeyboardHeight();
    const m = { innerHeight: window.innerHeight, visualHeight: vv.height };
    /* 没有键盘时记下完整窗口高：横竖屏切换、从其他页面切进来都会在这里跟上。
       iOS 上系统会把 WebView 缩到键盘上方，这个基准用来识别「已经让位了」。 */
    if (!host && vv.height >= window.innerHeight - 80) this.baseInnerHeight = window.innerHeight;
    /* 键盘刚收起的一小段时间里宿主变量可能还是旧值，先别信它，否则刚归位又被抬起来 */
    const recentlyHidden = this.kbHiddenAt > 0 && performance.now() - this.kbHiddenAt < 600;
    const lift = drawerLiftFor({
      ...m,
      hostHeight: recentlyHidden ? 0 : host,
      baseInnerHeight: this.baseInnerHeight,
      /* iOS 与安卓要分开判：iOS 缩窗后「窗口 == 视觉视口」= 键盘已被系统
         让掉；安卓 adjustPan 下同样的等高位形照旧要自己抬。 */
      ios: isIosEnv(),
    });
    if (lift !== this.kbLift) {
      this.kbLift = lift;
      this.root.setCssProps({ '--bzr-kb': `${lift}px` });
      this.root.classList.toggle('is-kb', lift > 0);
    }
  }

  /** 宿主写在 documentElement 上的键盘高（读不到就是 0） */
  private hostKeyboardHeight(): number {
    try {
      return keyboardHeightFromCss(
        getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height'),
      );
    } catch {
      return 0;
    }
  }

  /**
   * 键盘动画结束后再补几次采样（真机 2026-11-09）。
   *
   * 安卓 WebView 常在键盘弹出动画中途只发一次 visualViewport.resize：
   * 那一刻量到的是半截高度，之后不再有事件，抽屉就只抬起一点点、下半截
   * 还压在键盘后面。聚焦 / 失焦后连采 700ms，取动画真正停下时的值。
   * 每次只写一次样式（值不变就跳过），开销可以忽略。
   */
  private sampleKeyboard(maxMs = 1200): void {
    const token = ++this.kbSample;
    const started = performance.now();
    let last = -1;
    let stable = 0;
    const tick = (): void => {
      if (token !== this.kbSample) return;
      this.syncKeyboardVar();
      /* 以「算出来的抬升量」为准：宿主变量可能比视觉视口晚一步更新，
         只盯 vv 会在半截高度上提前收手。 */
      const h = this.kbLift;
      /* 连续 8 帧（约 130ms）不变就算停稳，不必等满 1.2s */
      if (h === last) stable++;
      else {
        stable = 0;
        last = h;
      }
      if (stable < 8 && performance.now() - started < maxMs) window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  }

  /** 焦点还在弹层里的哪个输入框（重画后放回去用） */
  private activeInput(): { role: string; start: number | null; end: number | null } | null {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el || !this.root.contains(el)) return null;
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return null;
    const role = el.dataset?.role;
    if (!role) return null;
    return { role, start: el.selectionStart ?? null, end: el.selectionEnd ?? null };
  }

  private restoreInput(keep: { role: string; start: number | null; end: number | null }): void {
    const el = this.root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-role="${keep.role}"]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (keep.start !== null && keep.end !== null) {
      try {
        el.setSelectionRange(keep.start, keep.end);
      } catch {
        /* 数字 / 颜色一类输入框不支持选区，忽略即可 */
      }
    }
  }

  private paint(refocus = true): void {
    /* 搜索浮层「隐藏不销毁」：缓存还在、且属于当前这一轮搜索，就原样挂回——
       不 setHtml、不重建，输入框内容、结果列表与滚动位置都保持隐藏前那一刻。 */
    if (getState().overlay?.kind === 'search' && this.stashMatches()) {
      this.restoreSearchStash(refocus);
      return;
    }
    /* 整棵 DOM 换掉 = 滚动位置与光标一起归零（C7）：弹层翻到一半点一下
       按钮，列表跳回顶部；在输入框里打字时点别的控件，键盘会收起。
       这两样都是「用户刚放好的位置」，记下来还回去。 */
    const keepScroll = this.root.querySelector<HTMLElement>('.bzs-mbody')?.scrollTop ?? 0;
    const keepInput = this.activeInput();
    this.untrap?.();
    this.untrap = null;
    this.setAccent(shellPrefs().accent);
    setHtml(this.root, overlayHtml());
    /* AI 正文按 Markdown 渲染（2026-11-11）：模板里只打 data-ai-md 标记，
       注入完在这里统一换成渲染结果。渲染是异步的，不阻塞这一帧。 */
    renderAiMarkdown(this.root);
    if (keepScroll) {
      const body = this.root.querySelector<HTMLElement>('.bzs-mbody');
      if (body) body.scrollTop = keepScroll;
    }
    /* 弹窗的焦点圈闭（C6）：Tab / Shift+Tab 不出这张卡。浮层（排版、工具条）
       没有遮罩，圈住反而挡住正文，只给 aria-modal 的弹窗挂。 */
    const dialog = this.root.querySelector<HTMLElement>('[aria-modal="true"]');
    if (dialog) this.untrap = trapFocus(dialog);
    /* 点遮罩空白关闭：判据交给 bindMaskDismiss（起点在遮罩 + 位移不超容差），
       在弹窗里选字拖到遮罩上松手不会再误关。每次重画都是新的遮罩元素。
       手机上「想法 / 书摘 / AI / 删除」多了一层 .bzs-text-scrim，所以这里
       要逐个绑——只绑第一个的话，第二层遮罩点了不会关。 */
    for (const scrim of Array.from(this.root.querySelectorAll<HTMLElement>('[data-role="scrim"]'))) {
      bindMaskDismiss(scrim, () => closeOverlay());
    }
    /* 工具条图标：模板只留 data-icon 空壳，这里交给宿主 setIcon 画 */
    hydrateToolbarIcons(this.root);
    const o = getState().overlay;
    /* 想法输入框按内容定高（预填的多行想法不该只露三行里的两行），
       必须赶在 placeAnchored 之前：浮层高度正是它量出来的。 */
    const ideaBox = this.root.querySelector<HTMLTextAreaElement>('[data-role="idea"]');
    if (ideaBox) fitIdeaInput(ideaBox);
    /* 先摆位再聚焦：聚焦可能让键盘立刻弹起，位置要在那之前是对的 */
    this.placeAnchored();
    /* 把焦点还给刚才那个输入框；下面几段「一打开就聚焦」的再覆盖它 */
    if (keepInput) this.restoreInput(keepInput);
    if (o?.kind === 'search') {
      const input = this.root.querySelector<HTMLInputElement>('[data-role="searchkw"]');
      input?.focus();
      const len = input?.value.length ?? 0;
      input?.setSelectionRange(len, len);
    }
    if (o?.kind === 'ai') {
      void runAiForOverlay();
    } else {
      // 离开 AI 卡就把册子清掉：下次划同一段，应该重新问一次
      aiCardReset();
    }
    /* 想法浮窗：打开就把光标放进输入框，少一次点击。
       之后的重画（亮确认条）不再抢焦点——手刚离开输入框。 */
    if (o?.kind === 'idea' && refocus) this.root.querySelector<HTMLTextAreaElement>('[data-role="idea"]')?.focus();
    if (o?.kind === 'rename') {
      const input = this.root.querySelector<HTMLInputElement>('[data-role="rename"]');
      input?.focus();
      input?.select();
    }
    /* 分类：打开这一页就把光标放进输入框，少点一下（2026-11-09）。
       名单形态落在新建框；改名落在那一行并选中原名（多半整段换掉）。
       重绘（排序 / 删除 / 保存之后）不再抢焦点——那时用户的手刚离开键盘，
       再弹一次只会挡视线。删除确认没有输入框。 */
    if (o?.kind === 'shelves') {
      const role = shelfFocusRole(o.mode);
      if (role && (refocus || role === 'shelfrename')) {
        const input = this.root.querySelector<HTMLInputElement>(`[data-role="${role}"]`);
        if (input) {
          /* 先逼一次布局再聚焦：这张卡是刚 setHtml 进来的，节点还没有
             渲染盒。iOS 只对「已经渲染出来的可编辑元素」开键盘，直接
             focus() 只给光标。开键盘的时机只有一个——touchend 的同步栈
             （见 shelf-tap.ts），所以布局也必须在这一栈里同步算完，
             不能丢给 requestAnimationFrame。 */
          void input.offsetHeight;
          input.focus();
          if (role === 'shelfrename') input.select();
        }
      }
    }
    // 解锁表：被拦下的那一行可能在一长串功能下面，把它滚到可见范围里
    if (o?.kind === 'unlock') {
      this.root.querySelector<HTMLElement>('.bzs-plan-row.is-cap')?.scrollIntoView({ block: 'center' });
    }
    // 书籍详情的封面：占位色块先出，真封面到了就地换图
    hydrateCovers(getShellSource()?.app, liveBooks(), this.root);

    /* 正文搜索是异步的：命中到达时只换命中列表，不整页重绘（否则输入框
       和光标会被换掉）。 */
    this.unbindHitlist();
    if (o?.kind === 'search') this.bindHitlist();
    /* 抽屉的键盘抬升：带着键盘切进来时，变量要在这一帧就是对的 */
    this.syncKeyboardVar();
  }

  /** 正文命中到达时只替换命中列表，不碰表单与滚动 */
  private bindHitlist(): void {
    this.unbindHitlist();
    this.hitlistCb = () => {
      const list = this.root.querySelector<HTMLElement>('[data-role="hitlist"]');
      if (list) setHtml(list, searchResultsHtml(getState().searchKw, getState().searchScope, 'book'));
    };
    RT.body.listeners.add(this.hitlistCb);
    RT.semantic.listeners.add(this.hitlistCb);
  }

  private unbindHitlist(): void {
    if (this.hitlistCb) {
      RT.body.listeners.delete(this.hitlistCb);
      RT.semantic.listeners.delete(this.hitlistCb);
    }
    this.hitlistCb = null;
  }

  /**
   * 关闭搜索浮层：只把整棵 DOM 收起来，不销毁。
   *
   * 点结果跳走后再次打开，要看到同样的词、同样的结果、同样的滚动位置。
   * 收起来时顺手停掉还在跑的正文扫描：隐藏的列表不该再被后台写入。
   */
  private stashSearch(): void {
    const scrim = this.root.firstElementChild as HTMLElement | null;
    if (!scrim) return;
    this.searchScroll = this.root.querySelector<HTMLElement>('.bzs-mbody')?.scrollTop ?? 0;
    this.searchStashKey = searchQueryKey(
      getState().searchKw,
      getState().searchScope,
      getState().searchMode,
    );
    this.unbindHitlist();
    const holder = createDiv();
    holder.appendChild(scrim);
    this.searchStash = holder;
  }

  /** 缓存的那一屏是不是当前这一轮搜索（词 + 范围都对得上才复用） */
  private stashMatches(): boolean {
    return (
      !!this.searchStash &&
      this.searchStashKey ===
        searchQueryKey(getState().searchKw, getState().searchScope, getState().searchMode)
    );
  }

  /** 再次打开搜索：把收起来的节点原样挂回，不重渲染 */
  private restoreSearchStash(refocus: boolean): void {
    const holder = this.searchStash;
    if (!holder) return;
    this.searchStash = null;
    this.untrap?.();
    this.untrap = null;
    this.setAccent(shellPrefs().accent);
    this.root.replaceChildren(...Array.from(holder.childNodes));
    const body = this.root.querySelector<HTMLElement>('.bzs-mbody');
    if (body) {
      body.scrollTop = this.searchScroll;
      /* 刚挂回文档时布局还没算完，scrollTop 会被夹到 0；下一帧再补一次 */
      if (this.searchScroll > 0) {
        const top = this.searchScroll;
        window.requestAnimationFrame(() => {
          const b = this.root.querySelector<HTMLElement>('.bzs-mbody');
          if (b) b.scrollTop = top;
        });
      }
    }
    const dialog = this.root.querySelector<HTMLElement>('[aria-modal="true"]');
    if (dialog) this.untrap = trapFocus(dialog);
    this.bindHitlist();
    /* 按意思搜的结果可能是在浮层关着的时候回来的：把挂回的这一屏按现场
       重画一次，不然用户看到的还是关闭那一刻的「正在检索…」。 */
    if (getState().searchMode === 'semantic') {
      const list = this.root.querySelector<HTMLElement>('[data-role="hitlist"]');
      if (list) setHtml(list, searchResultsHtml(getState().searchKw, getState().searchScope, 'book'));
    }
    if (refocus) {
      const input = this.root.querySelector<HTMLInputElement>('[data-role="searchkw"]');
      input?.focus();
      const len = input?.value.length ?? 0;
      input?.setSelectionRange(len, len);
    }
  }

  destroy(): void {
    document.removeEventListener('pointerdown', this.onDocPointer, true);
    for (const off of this.disposers) off();
    this.disposers = [];
    this.unbindHitlist();
    this.searchStash = null;
    this.esc = null;
    this.untrap?.();
    this.untrap = null;
    this.root.remove();
  }
}
