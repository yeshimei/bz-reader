/* ============================================================
 * bz-reader · 壳层动作分发（shell/actions.ts）
 *
 * 全壳层只有这一处写业务数据。视图只负责画，元素上挂 data-act 与
 * data-* 参数；这里按 act 分发，改完调用对应视图的重绘。
 *
 * 三条纪律：
 *   1. 标注、书签的增删改**一律走 data/notes.ts 的纯函数**——它同时维护
 *      highlights 与 excerpts 两份镜像，绕过去就会出现「侧栏有、导出没有」。
 *   2. 任何写数据之后都 commit()（store.touch），否则关掉 Obsidian 就丢。
 *   3. 失败要说人话（notify），不要静默——用户点一下没反应比报错更难受。
 * ============================================================ */
import { Menu } from 'obsidian';
import type { App } from 'obsidian';
import type { ReaderBook } from '../data/schema';
import { aiAsk, type AiTask } from '../data/ai';
import {
  DEFAULT_HIGHLIGHT_COLOR,
  addHighlight,
  colorCss,
  ensureHighlight,
  findHighlight,
  isHighlightColor,
  removeBookmark,
  removeHighlight,
  removeHighlights,
  setHighlightColor,
  setHighlightComment,
  setHighlightKb,
  toggleBookmark,
} from '../data/notes';
import { allMarks, filterMarks, shelfOf } from './domain';
import { toggleAll, togglePick } from './note-select';
import { notify } from '../core/notice';
import {
  ALL_SHELF,
  NO_SHELF,
  cleanShelfList,
  cleanShelfName,
  dropShelf,
  moveShelf,
  orderShelves,
  renameShelf,
  shelfNameError,
  shelfOfName,
} from '../data/shelves';
import { hostLanguageCode, isLocale, resolveLocale, setLocale, t, type LanguagePref, type MsgKey } from '../i18n';
import { bookMenuItems } from './book-menu';
import { scanVault } from '../data/book-repo';
import { readFingerprint } from '../data/book-scan';
import { MAX_FINGERPRINT_BYTES, fingerprintOf } from '../data/fingerprint';
import { importFolderOf, uniquePath } from '../data/importer';
import type { ShellSource } from './source';
import { flipSetting } from './settings-toggle';
import { rangeFill } from './range-fill';
import { openHotkeySettings } from '../core/hotkeys';
import { pickFolder } from '../core/folder-pick';
import { PURCHASE_URL, REPO_URL, can, capLabel, type Cap } from '../data/entitlement';
import { HEADER_ACTION_IDS, isMobileHiddenAction, type HeaderActionId } from '../view/header-actions';
import { moveHeaderAction } from './header-order';
import type { ReaderPrefs } from '../data/prefs';
import { wikilinkOf, wikilinkOfMark } from '../data/wikilink';
import { buildNotesBody, exportBookNotes, safeName } from '../data/export';
import { jumpTo, getToc } from '../view/toc-state';
import { LIB_FILTERS, LIB_SORTS } from './render/study';
import { copyQuoteCardImage } from './card-image';
import { quoteRefMarkdown } from './render/quote-card';
import { setHtml } from '../ui/dom';
import type { OverlayKind, StudyPage } from './state';
import {
  bumpOverlayRev,
  cancelIdeaClose,
  closeOverlay,
  getState,
  hydrateLibrary,
  mutateState,
  nextStudyPage,
  openOverlay,
  setGoal,
  setState,
  setStateQuiet,
  toggleFav,
} from './state';
import { RT, emitNotesChanged, pushAi, resetAi } from './runtime';
import { HITS_PAGE } from './search-hits';
import { kickBodySearch, refreshBodyHits, resetBodySearch, stopBodySearch } from './search-run';
import { currentSearchSurface, kickSemanticSearch, resetSemanticSearch } from './search-semantic';
import { bzEmbedder, bzNotesReady, openBzPreview, probeBz, openBzEntry, type BzEntryKind } from '../data/bz-bridge';
import { isMobileEnv, isMobileShell } from '../core/mobile';
import { SHELF_TAP_ATTR, SHELF_TAP_BOOK_ATTR, bindShelfTap } from './shelf-tap';
import { AI_TUTORIAL_URL, VIDEO_TUTORIAL_URL } from '../core/links';
import { portraitBlock, type PortraitBlockReason } from '../data/portrait-gate';
import { portraitBuilder, type PortraitBuildDeps } from '../data/portrait-build';
import { forgetPortrait, setPortrait } from './portrait-cache';
import {
  AI_CONTEXT_LIMIT,
  AI_SOURCES_MAX,
  hitsToContext,
  mergeEvidence,
  sourcesOfBlocks,
  sourcesOfHits,
  type AiEvidence,
} from '../data/ai-evidence';
import {
  PORTRAIT_TOP_K,
  firstSentence,
  listPortraits,
  orphanPortraits,
  removePortrait,
  writePortrait,
  blocksEvidence,
  chapterDigests,
  compressEvidence,
  portraitState,
  readPortrait,
  topBlocksByVector,
  type PortraitPlan,
} from '../data/portrait';
import { chapterDigestOf, guideOf, withGuide } from '../data/chapter-guide';
import { enrichDoneKind, enrichNeeds, enrichSample, mergeMetaPatch, parseEnrichReply } from '../data/book-enrich';
import { kbSource } from '../data/kb-entry';
import { kbLinkOf } from '../data/kb-link';
import { endsSelection } from './selection-end';
import { autoMarks } from './auto-mark';
import { fromSidebarHit, shouldCollapseSidebar } from './sidebar-jump';
import { shelfLabel } from './shelf-label';
import { getShellSource, allBooks, liveBooks, shellPrefs, shellSettings } from './source';
import { openSupportDialog } from './support-dialog';
import { debugSnapshot } from '../data/debug-log';
import { TAP_MENU_PRESSURE_MS } from '../core/tap';
import { aiCardDrop, aiCardFollowBegin, aiCardFollowDone, aiCardFollowFail, aiCardGet, aiCardKey, aiModeOf, followHistory } from './ai-card';
import { runAiForOverlay } from './overlay';
import { aiTurnsHtml } from './reader-cards';
import { renderAiMarkdown } from './ai-md';
import { aiAnswerBlock, aiConversationMarkdown, appendAiIdea, type AiSaveTask } from '../data/ai-save';
import { DEFAULT_SETTINGS, aiReady } from '../data/settings';
import { copyGroupId } from './group';
import { collectStats, dayKey } from '../data/stats';
import { statsModelOf, statsReportOf, type StatsView } from './render/stats';
import { downloadStatsPoster } from './stats-poster';
import { getStatsUi, setStatsUi } from './stats-ui';
import { withSignal } from '../core/with-signal';

/** 当前上下文里的书：优先状态里记住的那本，否则取书库第一本 */
function currentBook(): ReaderBook | undefined {
  const id = getState().bookId;
  const books = liveBooks();
  return (id ? books.find((b) => b.id === id) : undefined) ?? books[0];
}

function openBookById(id: string, cfi?: string): void {
  const src = getShellSource();
  const book = liveBooks().find((b) => b.id === id);
  if (!src || !book) return;
  /* 文件不在登记的路径上：不当成「打开失败」，直接进「重新定位」弹层。
     顺手把失联标记写上——书架下一次重绘就压暗封面，用户也能看见。 */
  if (book.fileRef.fileMissing || !src.app.vault.getAbstractFileByPath(book.fileRef.vaultPath)) {
    book.fileRef.fileMissing = true;
    src.store.touch();
    openOverlay({ kind: 'missing', bookId: id });
    return;
  }
  setState({ bookId: id });
  src.openBook(book, cfi);
}

/**
 * 失联书的手动重连：选一个库外文件 → 算指纹 → 与记录比对 → 一致才写进库并重连。
 *
 * 有指纹的记录对不上就拒绝：宁可多一步提示，也不能把进度接错书。
 * 老记录没有指纹时按用户的选择接受，并把指纹补上（这一次之后就能自动找）。
 */
async function pickAndRelocate(src: ShellSource, book: ReaderBook): Promise<void> {
  const picked = await new Promise<File | null>((resolve) => {
    const input = createEl('input');
    input.type = 'file';
    input.accept = `.${book.fileRef.format}`;
    input.setCssProps({ display: 'none' });
    document.body.appendChild(input);
    const done = (f: File | null): void => {
      input.remove();
      resolve(f);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    /* 点取消时 change 不触发：窗口重新聚焦兜底（与 pickAndImport 同一套路） */
    window.addEventListener(
      'focus',
      () => {
        window.setTimeout(() => {
          if (input.isConnected) done(null);
        }, 500);
      },
      { once: true },
    );
    input.click();
  });
  if (!picked) return;

  const buf = await picked.arrayBuffer();
  const fp = buf.byteLength > MAX_FINGERPRINT_BYTES ? null : fingerprintOf(new Uint8Array(buf));
  const known = book.fileRef.fingerprint;
  if (!fp) {
    notify(t('notice.missing.tooBig'));
    return;
  }
  if (known && known !== fp) {
    notify(t('notice.missing.wrong'));
    return;
  }

  const folder = importFolderOf(shellSettings().importDir);
  if (folder && !(await src.app.vault.adapter.exists(folder).catch(() => false))) {
    await src.app.vault.adapter.mkdir(folder).catch(() => undefined);
  }
  const target = await uniquePath(src.app, folder, picked.name);
  await src.app.vault.adapter.writeBinary(target, buf);
  book.fileRef.fingerprint = fp;
  src.repo.relocate(book, target);
  src.store.touch();
  closeOverlay();
  repaint();
  notify(t('notice.missing.picked', { path: target }));
}

/** 统一的重绘出口：所有视图都订阅 state，改完自然会重画 */
function repaint(): void {
  mutateState(() => undefined);
}

function overlay(kind: OverlayKind, extra: Record<string, unknown> = {}): void {
  openOverlay({ kind, ...extra });
}

/* ─────────── 分类（2026-11-08） ───────────
 *
 * 「分类」以前只是书上的一个字符串：没有名单，于是不能改名、不能排序，
 * 空分类建完就消失。现在名单存在业务数据里（`data.shelves`），壳层
 * `state.shelfList` 是它的一份缓存。所有写操作都必须**两份一起改**：
 * 只改缓存 → 换设备就丢；只改数据 → 界面要等下次启动才认。
 */

/** 查重用的名字池：名单 + 书自带的分类（「全部」「未分类」是保留名，不算） */
function shelfNamePool(): string[] {
  return orderShelves(
    getState().shelfList,
    liveBooks().map((b) => shelfOf(b)),
  ).filter((n) => n !== ALL_SHELF && n !== NO_SHELF);
}

/** 改名单：缓存立刻生效，随后写业务数据 */
function saveShelfList(list: readonly string[]): void {
  const clean = cleanShelfList(list);
  setState({ shelfList: clean });
  getShellSource()?.setShelfList(clean);
}

/** 把书的归属从「某一类」换成「另一类」：缓存里那份映射跟着改 */
function reshapeShelfCache(from: string, to: string): void {
  mutateState((s) => {
    for (const [id, n] of Object.entries(s.shelves)) {
      if (n !== from) continue;
      s.shelves[id] = to;
    }
  });
}

/**
 * 把一批书归到某个分类。`name` 是分类条上显示的那一格（含「未分类」）。
 *
 * 回执只报结果，不带按钮：归类是低频动作，提示条上再挂一个白底「撤销」
 * 在手机通知里太抢眼，改错分类直接再点另一格就行。
 */
function assignShelf(ids: string[], name: string): void {
  const src = getShellSource();
  if (!src || !ids.length) return;
  const want = shelfOfName(name);
  const hit: string[] = [];
  for (const id of ids) {
    const b = liveBooks().find((x) => x.id === id);
    if (!b) continue;
    hit.push(id);
    src.setShelf(id, want);
  }
  if (!hit.length) return;
  mutateState((s) => {
    /* 空串照写：归类到「未分类」是一次明确的表态，不是「忘了设」 */
    for (const id of hit) s.shelves[id] = want;
  });
  notify(want ? t('shelves.assigned', { name: want }) : t('shelves.assigned.none'));
}

/** 名字不合法时给哪一句人话 */
const SHELF_ERR_KEY: Record<string, MsgKey> = {
  empty: 'shelves.err.empty',
  dup: 'shelves.err.dup',
  reserved: 'shelves.err.reserved',
};

/**
 * 菜单项标题：给「分类管理 / 新建分类…」挂一个触摸标记。
 *
 * 宿主画菜单项时只让我们改标题，标记只好藏在标题的 span 上；手指点在
 * 图标那一侧时，shelf-tap.ts 会回到同一个 `.menu-item` 里找它。
 * span 不带样式，视觉与原来看不出差别。
 */
function shelfTapTitle(text: string, kind: 'manage' | 'new', bookId?: string): DocumentFragment {
  /* 走 Obsidian 的全局助手（createFragment / createSpan）：上架 lint 要求，
     弹窗窗口里也能建出正确的节点，不依赖宿主 document。 */
  const frag = createFragment();
  const span = createSpan();
  span.setAttribute(SHELF_TAP_ATTR, kind);
  if (bookId) span.setAttribute(SHELF_TAP_BOOK_ATTR, bookId);
  span.textContent = text;
  frag.append(span);
  return frag;
}

/** 上一张分类菜单挂的触摸解绑：菜单关掉或下一次打开时先撤掉 */
let unbindShelfTap: (() => void) | null = null;
/** 手机上 touchend 刚开过弹层的时刻：宿主那次 click 若仍被派发，用它挡住重复打开 */
let shelfOpenedAt = 0;

/**
 * 书卡菜单「归入分类…」的下一层。
 *
 * 原生 `Menu` 没有二级菜单的 API（公开类型里没有 submenu），所以点这一条时
 * 在**同一处**再弹一张菜单：第一张收起、第二张在原地出现，读起来就是
 * 「进了下一层」，桌面上鼠标位置不变，手机上还是同一张底部面板。
 *
 * 手机上「分类管理 / 新建分类…」这一下由我们接管（2026-11-09，见 shelf-tap.ts）：
 * 宿主的 click 在 iOS 上既不算「用户亲手操作」（键盘不给），又会被我们提前
 * 叫起的键盘顶偏（click 落到别处、菜单项的 onClick 根本没跑）。所以改成在
 * touchend 里 preventDefault，自己关菜单、自己开弹层——同一手势栈里聚焦
 * 输入框，键盘才会跟上来。桌面的 onClick 原样保留。
 */
function openShelfMenu(bookIds: string[], pos: { x: number; y: number }): void {
  const books = liveBooks();
  const used = books.map((b) => shelfOf(b));
  const names = orderShelves(getState().shelfList, used).filter((n) => n !== ALL_SHELF);
  const only = bookIds.length === 1 ? books.find((b) => b.id === bookIds[0]) : undefined;
  const current = only ? shelfOf(only) : '';
  /* 从书卡「新建分类…」进来时把这本书带上：建完顺手归进去 */
  const newBookId = only?.id ?? bookIds[0];

  /* 手机上 touchend 已经开过一次：万一 preventDefault 没拦住宿主那次
     click，这里别再开第二遍（重画不算「打开」，但会抢一次焦点）。 */
  const openShelves = (extra: Record<string, unknown> = {}): void => {
    if (Date.now() < shelfOpenedAt) return;
    overlay('shelves', extra);
  };

  const menu = new Menu();
  for (const n of names) {
    const count = used.filter((x) => x === n).length;
    menu.addItem((i) => {
      /* 名字后面跟本数：挑分类时最想知道的是「这一类现在有几本」。
         系统格子（全部 / 未分类）走语言包，用户起的名字原样显示。 */
      const title = createFragment();
      title.append(shelfLabel(n));
      const num = createSpan();
      num.className = 'bzs-menu-count';
      num.textContent = String(count);
      title.append(num);
      i.setTitle(title);
      if (current === n) {
        /* 当前那一格打勾且点不动：再点一次没有任何变化，留着只会让人误以为能取消 */
        i.setChecked(true).setDisabled(true);
      } else {
        i.onClick(() => assignShelf(bookIds, n));
      }
    });
  }
  menu.addSeparator();
  menu.addItem((i) =>
    i
      .setTitle(shelfTapTitle(t('shelves.assign.new'), 'new', newBookId))
      .setIcon('folder')
      .onClick(() => openShelves({ mode: 'new', bookId: newBookId })),
  );
  /* 分类管理（改名 / 排序 / 删除）不再占头栏一颗图标：从这层菜单进，
     和「新建分类…」挨着，都属于「整理分类名册」。 */
  menu.addItem((i) =>
    i
      .setTitle(shelfTapTitle(t('shelves.manage'), 'manage'))
      .setIcon('settings')
      .onClick(() => openShelves()),
  );
  menu.showAtPosition(pos);
  /* 只有真移动端才有触摸；桌面（含触屏 Windows）没有 touchend，照旧走
     onClick。手机上这一下由 touchend 接管：先收菜单再开弹层——菜单的
     z-index 比弹层高，留着会盖住卡片。 */
  unbindShelfTap?.();
  unbindShelfTap = isMobileEnv()
    ? bindShelfTap(document, (tap) => {
        menu.hide();
        shelfOpenedAt = Date.now() + TAP_MENU_PRESSURE_MS;
        if (tap.mode === 'new') overlay('shelves', { mode: 'new', bookId: tap.bookId });
        else overlay('shelves');
      })
    : null;
  menu.onHide(() => {
    unbindShelfTap?.();
    unbindShelfTap = null;
  });
}

/** 统计页动作要用的一份视图：和书架页同数据源，报告 / 周报才不会和页面对不上 */
function currentStatsView(): StatsView {
  const src = getShellSource();
  const all = src?.repo.all() ?? liveBooks();
  return {
    stats: collectStats(all),
    books: all,
    goal: getState().goal,
    checkins: src?.store.get().checkins,
    dailyGoalMinutes: src?.store.get().dailyGoalMinutes,
  };
}

/**
 * 导出文件名清洗（C1）。
 *
 * 规则全部来自 `data/export.ts` 的 `safeName`（A4 导出的共享函数）：书名是
 * 用户可改的自由文本——`CON` 在 Windows 上根本打不开，`../../x` 会把笔记
 * 写到导出目录外面去。两处必须同一套规则，否则同一本书从「导出」和
 * 「存笔记」两个入口会落成两个文件名，用户看到两份笔记。
 * 唯一的差别是兜底名走界面语言（那份函数默认写死中文）。
 */
function safeExportName(raw: string): string {
  return safeName(raw, t('common.untitled'));
}

/** 导出目录同样收一遍：设置里可能是 `a/../b`，也可能整条是 `..` */
function safeExportDir(raw: string, fallback: string): string {
  const parts = (raw || '')
    .replace(/\\/g, '/')
    .split('/')
    /* `..` / `.` 直接丢掉，其余段按文件名同一套规则洗（目录也可能叫 CON） */
    .map((seg) => (seg === '.' || seg === '..' ? '' : safeName(seg, '')))
    .filter((seg) => !!seg);
  return parts.join('/') || fallback;
}

/** 最终路径是否老老实实落在导出目录里 */
function insideExportDir(path: string, dir: string): boolean {
  return path.startsWith(`${dir}/`) && !path.split('/').includes('..');
}

/**
 * 追加一段进某个目录里这本书的笔记。
 *
 * 不覆盖已有内容：同一本书可以连着存好几段。抽出来是因为「书摘/存为笔记」
 * 与「AI 对话存档」只有目录不同，其余规则（清洗、防越界、原子性靠追加）
 * 一字不差——两处各写一份迟早会有一边忘了防越界。
 */
async function appendBlock(app: App, dir: string, name: string, block: string, done: string): Promise<void> {
  const path = `${dir}/${name}.md`;
  try {
    /* 清洗之后理论上不会越界；这条是给以后改清洗规则的人留的门闩——
       写错一个文件比报一句错糟得多。 */
    if (!insideExportDir(path, dir)) throw new Error(`bad export path: ${path}`);
    if (!(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir);
    const head = (await app.vault.adapter.exists(path)) ? await app.vault.adapter.read(path) : `# ${name}\n`;
    await app.vault.adapter.write(path, `${head.trimEnd()}\n\n${block}\n`);
    notify(done);
  } catch (e) {
    notify(t('notice.note.saveFailed', { why: (e as Error).message }));
  }
}

/**
 * 追加一段进导出目录里这本书的笔记（书摘「存笔记」与 AI「存为笔记」共用）。
 *
 * 路径与导出功能一致（设置里的导出目录 + 书名），用户之后手动整理也在同一处。
 */
async function appendToExport(app: App, book: ReaderBook | undefined, block: string): Promise<void> {
  const fallback = DEFAULT_SETTINGS.exportDir;
  const dir = safeExportDir(shellSettings().exportDir || fallback, fallback);
  const name = safeExportName(book?.meta.title || t('export.loose'));
  await appendBlock(app, dir, name, block, t('notice.note.saved', { path: `${dir}/${name}.md` }));
}

/** AI 对话存档：落导出目录下的「AI 对话」，与书摘笔记分开放 */
async function appendAiLog(app: App, book: ReaderBook | undefined, block: string): Promise<void> {
  const fallback = DEFAULT_SETTINGS.exportDir;
  const base = safeExportDir(shellSettings().exportDir || fallback, fallback);
  const dir = `${base}/${safeExportName(t('ai.log.dir'))}`;
  const name = safeExportName(book?.meta.title || t('export.loose'));
  await appendBlock(app, dir, name, block, t('notice.ai.logSaved', { path: `${dir}/${name}.md` }));
}

/* ─────────── 书签 / 标注 ─────────── */

function newBookmarkHere(book: ReaderBook): void {
  const src = getShellSource();
  if (!src) return;
  const percent = book.reading.position.percent || 0;
  const cfi = book.reading.position.cfi || '';
  if (!cfi) {
    notify(t('notice.bookmark.noCfi'), 'info');
    return;
  }
  const existing = (book.notes?.bookmarks ?? []).find((k) => k.cfi === cfi);
  if (existing) {
    notify(t('notice.bookmark.exists'), 'info');
    return;
  }
  toggleBookmark(book, {
    cfi,
    percent,
    chapterTitle: book.reading.position.chapterTitle,
    label: book.reading.position.chapterTitle,
  });
  src.store.touch();
  setState({ sideTab: 'bookmarks' });
  notify(t('notice.bookmark.added'));
}

/** 划词产生的一条标注（划词浮层与书摘卡共用） */
export function createMark(color: string, opts: { silent?: boolean } = {}): string | null {
  const sel = RT.sel;
  if (!sel) return null;
  const book = liveBooks().find((b) => b.id === sel.bookId);
  if (!book) return null;
  const safeColor = isHighlightColor(color) ? color : DEFAULT_HIGHLIGHT_COLOR;
  const h = addHighlight(book, {
    text: sel.text,
    cfiRange: sel.cfiRange,
    chapterTitle: sel.chapterTitle,
    color: safeColor,
  });
  getShellSource()?.store.touch();
  repaint();
  emitNotesChanged();
  // 选中即划这条路每选一次就弹一条提示会盖住正文，交给调用方决定
  if (!opts.silent) {
    notify(t('notice.mark.created', { color: isHighlightColor(color) ? colorLabel(color) : t('common.default') }));
  }
  return h.id;
}

/**
 * 给当前选区落一条线（同位置已有就复用），返回这条线的 id。
 *
 * 2026-11-10 起和「想法」共用同一条路：想法以前直接 createMark，同一段字
 * 先点过双链再点想法就会长出两条一模一样的线。
 */
function markSelection(): string | null {
  const sel = RT.sel;
  const book = sel ? liveBooks().find((b) => b.id === sel.bookId) : undefined;
  if (!sel || !book) return null;
  /* PDF 框选只有一块矩形、没有字：落了线侧栏也是一条空标注，不落 */
  if (!sel.text.trim()) return null;
  const pen = getState().pen;
  const { highlight, created } = ensureHighlight(book, {
    text: sel.text,
    cfiRange: sel.cfiRange,
    chapterTitle: sel.chapterTitle,
    color: isHighlightColor(pen) ? pen : DEFAULT_HIGHLIGHT_COLOR,
  });
  if (created) {
    getShellSource()?.store.touch();
    repaint();
    emitNotesChanged();
  }
  return highlight.id;
}

/**
 * 点完先给这段文字落一条线（双链 / 存为名词 / 存为段落共用）。
 *
 * 2026-11-10 起与「想法」同款：点下去就留痕，用户回原文找得到。这三颗以前
 * 都把结果放在别处——双链进剪贴板、知识盒等 bz 保存成功才补一条线——关上
 * 弹窗就什么也看不见。
 *
 * 三条边界：
 *   · 同位置已有线就复用（见 data/notes.ts 的 ensureHighlight），不叠第二条；
 *   · 复用不改色，也不重复播「已划线」——用户点的是双链 / 存名词；
 *   · 只认这三颗动作：复制不该留痕。
 */
function autoMarkSelection(act: string): string | null {
  return autoMarks(act) ? markSelection() : null;
}

/** 改一条已有标注的颜色（划词条上点色点，改的是刚落下的那条） */
function recolorMark(id: string, color: string): boolean {
  const sel = RT.sel;
  const book = liveBooks().find((b) => b.id === sel?.bookId) ?? currentBook();
  if (!book || !isHighlightColor(color)) return false;
  const ok = setHighlightColor(book, id, color);
  if (!ok) return false;
  getShellSource()?.store.touch();
  repaint();
  emitNotesChanged();
  notify(t('notice.mark.recolored', { color: colorLabel(color) }), 'info');
  return true;
}

function colorLabel(v: string): string {
  const map: Record<string, string> = { amber: '琥珀', vermilion: '朱红', green: '松绿', blue: '黛蓝' };
  return map[v] || '默认';
}

/**
 * 划词条 / 划线工具条上的「存为名词 / 存为段落」。
 *
 * 三条界线：
 *   · **先问 bz 在不在**（probeBz + openBzEntry），缺哪一半都只说一句人话；
 *   · **划线由动作层先落**（2026-11-10 反转）：划词条点「存为名词 / 段落」时
 *     actions 先调 autoMarkSelection 把线落下、把 markId 递进来，这里只负责
 *     把回写的链接挂到那条线上。bz 里取消也不撤线——用户点它就是要留着这段。
 *     不带 markId 的老路径仍按「写入成功再落线」兜底；
 *   · **输入框里那一段原文归 bz 管**，我们不复制一份到自己的数据里，
 *     只有回写的链接是这本书的。
 *
 * 2026-11-08 起：链接写进 `Highlight.kb`，**不再塞进想法**；同一个按钮
 * 在这一格已经有链接时改做「打开那篇笔记」（动作名不变，见 tool.termView）。
 */
function knowledgeEntry(kind: BzEntryKind, markId?: string, bookId?: string): void {
  const src = getShellSource();
  if (!src) return;
  const app: App = src.app;
  if (!requireCap('kb')) return;
  /* 自动识别（2026-11-07 起没有开关）：bz 缺失由下面的 openBzEntry 回一句
     「还没装 / 没启用 / 版本旧」，比这里再写一句笼统的话更指导下一步。
     工具条上的两颗按钮本身也按 bzEntryReady 出现，所以正常走不到失败分支。 */

  let book: ReaderBook | undefined;
  let text = '';
  let cfi = '';
  let chapter = '';
  let existing: ReturnType<typeof kbLinkOf> = undefined;
  if (markId) {
    book = findBookOfMark(markId, bookId);
    const h = book?.notes?.highlights.find((x) => x.id === markId);
    if (!book || !h) {
      notify(t('notice.mark.notFound'), 'error');
      return;
    }
    text = h.text || '';
    cfi = h.cfiRange || '';
    chapter = h.chapterTitle || '';
    existing = kbLinkOf(h.kb, kind);
  } else {
    const sel = RT.sel;
    book = sel ? liveBooks().find((b) => b.id === sel.bookId) : undefined;
    if (!sel || !book) {
      notify(t('notice.sel.empty'), 'error');
      return;
    }
    text = sel.text;
    cfi = sel.cfiRange;
    chapter = sel.chapterTitle || '';
    /* 划词路径上刚落笔的那条线也算：手机上选中即已划，按钮同样该变「看」 */
    const live = RT.selMarkId ? kbLinkOf(book.notes?.highlights.find((x) => x.id === RT.selMarkId)?.kb, kind) : undefined;
    existing = live;
  }

  /* 这一格已经有链接：按钮的字是「看名词 / 看段落」，点它是打开，不是再存一次 */
  if (existing) {
    openKbNote(existing.path);
    return;
  }

  const target = book;
  const shell = src;
  /* 第六个参数是 app：老版本 bz 的门面首参要 app，新门面用不上（见 bz-bridge 的 wantsApp） */
  const res = openBzEntry(probeBz(app), kind, text, kbSource(target.id, target.meta.title, { text, cfiRange: cfi, chapterTitle: chapter }), (notePath) => {
    /* bz 的写入成功回调：此刻笔记已经落盘，才轮到书里多一条划线 + 一格链接 */
    let id = markId ?? '';
    if (!id) {
      const h = addHighlight(target, {
        text,
        cfiRange: cfi,
        chapterTitle: chapter,
        color: DEFAULT_HIGHLIGHT_COLOR,
      });
      id = h.id;
    }
    if (setHighlightKb(target, id, { kind, path: notePath, at: Date.now() })) {
      shell.store.touch();
      repaint();
      emitNotesChanged();
    }
    notify(t(kind === 'term' ? 'notice.kb.term' : 'notice.kb.passage'));
  }, app);

  if (!res.ok) notify(res.message || t('notice.kb.failed', { message: '' }), 'error');
  else if (res.message) notify(res.message, 'info');
}

/**
 * 打开一枚知识盒链接：优先让 bz 开文献预览弹窗，老版本 bz 退回打开那篇笔记。
 *
 * 两条路都以「用户能看见那篇笔记」收尾——链接点下去没反应是最差的结局。
 */
function openKbNote(path: string): void {
  const src = getShellSource();
  const app = src?.app;
  const target = String(path ?? '').trim();
  if (!app || !target) return;
  if (openBzPreview(app, target)) return;
  void app.workspace
    .openLinkText(target, '', false, { active: true })
    .catch(() => notify(t('notice.kb.missing', { path: target }), 'error'));
}

/** 动作点完把正文里的选区收掉（见 shell/selection-end.ts 的判据） */
function finishSelection(act: string): void {  if (!endsSelection(act)) return;
  getShellSource()?.clearSelection?.();
}

/**
 * 本章导读（2026-11-11）。
 *
 * 有缓存直接显示；没有才发请求——用户点了命令才走到这里，符合
 * 「不自动调用 AI」的边界。生成成功写回画像的 `guides[章名]`，
 * 同一章下次不再花钱；写不回去（没有画像）时至少这一次能看到。
 */
async function openGuide(force = false): Promise<void> {
  const src = getShellSource();
  const book = currentBook();
  if (!src || !book) {
    notify(t('notice.needBook'), 'info');
    return;
  }
  /* 正在写就别再发一次（2026-11-11 上架 review）：连点「重新生成」会
     同时挂好几个请求，先回来的那份还会被后到的覆盖，白花几次调用。 */
  const cur = getState().overlay;
  if (cur?.kind === 'guide' && cur.busy) return;
  const chapter = String(book.reading.position.chapterTitle ?? '').trim();
  if (!chapter) {
    notify(t('notice.guide.noChapter'), 'info');
    return;
  }
  const app = src.app;
  const bookId = book.id;
  /* 同一个画面只认这一章：换章 / 关卡之后回来的结果一律丢掉 */
  const same = (): boolean =>
    getState().overlay?.kind === 'guide' && getState().overlay?.chapterTitle === chapter;

  setState({ overlay: { kind: 'guide', bookId, chapterTitle: chapter, text: '', busy: true } });
  const portrait = await readPortrait(app, bookId);
  if (!same()) return;

  const cached = guideOf(portrait, chapter);
  if (cached && !force) {
    setState({ overlay: { kind: 'guide', bookId, chapterTitle: chapter, text: cached } });
    return;
  }

  const settings = shellSettings();
  if (!aiReady(settings)) {
    notify(t('notice.ai.needSetup'), 'info');
    setState({ overlay: null });
    return;
  }

  try {
    const res = await aiAsk(settings, {
      task: 'guide',
      text: '',
      title: book.meta.title,
      chapter,
      context: chapterDigestOf(portrait, chapter),
    });
    if (!same()) return;
    if (portrait) {
      const next = withGuide(portrait, chapter, res.text);
      if (next !== portrait) await writePortrait(app, next);
    }
    setState({ overlay: { kind: 'guide', bookId, chapterTitle: chapter, text: res.text.trim() } });
  } catch (e) {
    if (!same()) return;
    setState({
      overlay: {
        kind: 'guide',
        bookId,
        chapterTitle: chapter,
        text: (e as Error)?.message || t('guide.fail'),
        error: true,
      },
    });
  }
}

/** 正在补的书（一本书一次）：连点不该发第二个请求，一次请求要跑十几秒 */
const enrichRunning = new Set<string>();

/**
 * 补全书籍信息（2026-11-11）。
 *
 * 用户点菜单才发请求：书名 + 作者 + 画像里的样本 → 简介 / 分类 / 语言。
 * 只写空白字段——用户改过的简介、已有的分类一律不动；模型没按约定格式
 * 回答时什么都不写，宁可这次白问，也不往详情页塞一段散文。
 *
 * 2026-11-11 真机反馈补三条：
 *   · 缺什么先算一遍，两项都齐就一个请求都不发（以前齐了也问，标签每次换
 *     个说法又能凑出「新增」，于是每点一次都弹成功）；
 *   · 点了立刻说一句「正在补全…」，模型要跑十几秒，中间不该是一片空白；
 *   · 同一本书在途时忽略后续点击。
 */
export async function enrichBookMeta(bookId: string): Promise<void> {
  const src = getShellSource();
  const book = src ? liveBooks().find((b) => b.id === bookId) : undefined;
  if (!src || !book) return;
  const settings = shellSettings();
  if (!aiReady(settings)) {
    notify(t('notice.ai.needSetup'), 'info');
    return;
  }
  const need = enrichNeeds(book.meta);
  if (!need.description && !need.subjects) {
    notify(t('notice.enrich.none'), 'info');
    return;
  }
  if (enrichRunning.has(bookId)) return;
  enrichRunning.add(bookId);
  notify(t('notice.enrich.busy', { title: book.meta.title }), 'info');
  try {
    const portrait = await readPortrait(src.app, book.id);
    const res = await aiAsk(settings, {
      task: 'enrich',
      text: '',
      title: book.meta.title,
      author: book.meta.author,
      context: enrichSample(portrait),
    });
    const next = mergeMetaPatch(book.meta, parseEnrichReply(res.text));
    /* 「有没有写出东西」看 next 本身，不看文案的种类：模型偶尔只回了语言那一行，
       那也是模型给的信息，该落盘。kind 只决定说哪句话。 */
    if (!Object.keys(next).length) {
      notify(t('notice.enrich.none'), 'info');
      return;
    }
    const kind = enrichDoneKind(next);
    Object.assign(book.meta, next);
    book.updatedAt = Date.now();
    src.store.touch();
    repaint();
    notify(
      kind === 'desc'
        ? t('notice.enrich.doneDesc')
        : kind === 'tags'
          ? t('notice.enrich.doneTags')
          /* 两样都补了，或只补到语言那一行：都是「补上了一些信息」 */
          : t('notice.enrich.done'),
    );
  } catch {
    notify(t('notice.enrich.fail'), 'error');
  } finally {
    enrichRunning.delete(bookId);
  }
}

/**
 * 手机上从侧栏跳转完，把抽屉收起来。
 *
 * 桌面侧栏常驻是正常形态；这本书没打开 / 这一跳没有落点时不收——
 * 用户还在原地找，收起来等于多按一次。
 */
function collapseSidebarAfterJump(el: HTMLElement, jumped: boolean): void {
  if (!shouldCollapseSidebar({ mobile: isMobileShell(), fromSidebar: fromSidebarHit(el), jumped })) return;
  getShellSource()?.closeSidebar?.();
}

/* ─────────── 全书画像 ─────────── */

/**
 * 建画像需要的全部外部能力。
 *
 * 每次都现装配、现 rebind：设置里的 Key、bz 的嵌入模型都可能在两次打开
 * 之间换掉，把 deps 焊死在单例里就会拿着旧模型去算新向量。
 */
function portraitDeps(bookId: string): PortraitBuildDeps | null {
  const src = getShellSource();
  if (!src) return null;
  const settings = shellSettings();
  return {
    load: (bookId) => readPortrait(src.app, bookId),
    save: async (p) => {
      const ok = await writePortrait(src.app, p);
      if (ok) setPortrait(p.bookId, p);
      return ok;
    },
    extract: (onProgress, shouldStop) => src.exportChapters({ onProgress, shouldStop, bookId }),
    /* 向量由第二大脑算（2026-11-07 决策回摆）：模型名、维度都在 bz 那边，
       这里只把正文递过去。取不到门面就直说缺什么，不退回自建嵌入——
       两套模型算出来的向量不在一个空间，混用等于静默给错结果。 */
    embed: (texts, signal) => {
      const embedder = bzEmbedder(src.app);
      if (!embedder.ai) return Promise.reject(new Error(embedder.problem || t('side.ai.embedNotReady')));
      return embedder.ai.embedDocuments(texts, signal);
    },
    summarise: async (text, signal) => {
      const res = await aiAsk(settings, { task: 'summarize', text }, { signal });
      return { digest: firstSentence(res.text), summary: res.text.trim() };
    },
    overview: async (evidence, signal) => (await aiAsk(settings, { task: 'summarize', text: evidence }, { signal })).text.trim(),
    embedModel: () => bzEmbedder(src.app).model,
    chatModel: () => settings.ai.model || '',
  };
}

/**
 * 建索引被拦下时该高亮哪一行。
 *
 * 2026-11-09 起两种建法都高亮「AI 全书问答」：对照表不再单列「书籍本地化
 * 向量检索」，整本索引是全书问答的前置步骤；压缩方案本来就是拿要点去问
 * 整本书。`can()` 不按 cap 细分，这里只是选一行给用户看。
 */
function indexCap(): Cap {
  return 'ai';
}

/** 拦截原因 → 一句人话（书没开 / 手机端 / 没配嵌入或对话模型） */
function portraitBlockMessage(reason: PortraitBlockReason): string {
  if (reason === 'mobile') return t('pt.mobile');
  if (reason === 'noEmbed') return t('side.ai.embedNotReady');
  if (reason === 'noAi') return t('side.ai.notReady');
  return t('pt.needOpen');
}

/** 展开侧栏 AI 页签里的「选建法」，并把人送到那儿（建索引入口只有这一处） */
function revealIndexPanel(): void {
  RT.aiIndexOpen = true;
  getShellSource()?.openSidebar('ai');
  repaint();
}

/**
 * 开始建索引。返回「真的跑起来了没有」——侧栏据此决定要不要收起选建法那一块：
 * 被拦下时（书没开 / 手机端 / 服务没配 / 另一本正在建）已经把原因说给用户了，
 * 此时把选项收掉等于让他重新点一遍。
 *
 * 只从**空态**开跑（重建走「确认 → 删掉 → 回空态」那一圈，见 aiidxrebuildyes），
 * 所以这里不再带「清旧块重来」的开关。
 */
async function startPortrait(book: ReaderBook, plan: PortraitPlan): Promise<boolean> {
  const src = getShellSource();
  /* 能不能建，四条一起判（portrait-gate.ts）。其中「开的是另一本书」这条
     最隐蔽：画像的正文来自阅读视图，取错了会算出一整本错向量，界面却正常。 */
  const settings = shellSettings();
  const reason = portraitBlock({
    plan,
    mobile: isMobileEnv(),
    bookId: book.id,
    openBookId: src?.openBookId() ?? '',
    /* 向量方案要的是「bz 的嵌入能力」，不是本插件设置里的某个字段 */
    embedReady: !!bzEmbedder(src?.app).ai,
    aiReady: aiReady(settings),
  });
  if (reason) {
    notify(portraitBlockMessage(reason), 'info');
    return false;
  }
  const deps = portraitDeps(book.id);
  if (!deps) return false;
  RT.portraitPlan = plan;
  const b = portraitBuilder(deps);
  return b.start({ id: book.id, title: book.meta.title || t('common.untitled') }, plan, { rebuild: false });
}

/** 无主画像：先读清单，再问一句 */
async function cleanPortraits(): Promise<void> {
  const src = getShellSource();
  if (!src) return;
  const files = await listPortraits(src.app);
  const orphans = orphanPortraits(files, liveBooks());
  if (!orphans.length) {
    notify(t('pt.clean.empty'), 'info');
    return;
  }
  RT.ptOrphans = orphans;
  openOverlay({ kind: 'ptclean' });
}

/* ─────────── 导出 ─────────── */

/**
 * 能力不够就弹解锁层，够就放行。
 *
 * 不做成「一排灰按钮」：锁标点下去要能看见「你已经攒了多少、解锁能拿到
 * 什么」，只给一句「请购买」是把人推走。
 */
export function requireCap(cap: Cap): boolean {
  if (can(cap)) return true;
  openOverlay({ kind: 'unlock', mode: cap, text: capLabel(cap) });
  return false;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify(t('notice.copy.ok'));
  } catch {
    notify(t('notice.copy.failed'), 'error');
  }
}

/**
 * 复制到剪贴板的 Markdown：与落盘版共用一份正文生成器。
 *
 * 以前这里另写了一套（标题变成「书名 · 摘录」、想法用 `**想法**：`、
 * 末尾再挂一条 `— [在原文中查看]`），同一本书导出的文件和复制的文字
 * 长得不一样，用户改哪份都别扭。
 */
function exportMarkdown(bookId?: string): string {
  const src = getShellSource();
  if (!src) return t('export.noData');
  const settings = shellSettings();
  const books = bookId ? liveBooks().filter((b) => b.id === bookId) : liveBooks();
  const parts = books
    .filter((b) => (b.notes?.highlights ?? []).length)
    .map((b) => buildNotesBody(b, settings));
  return parts.join('\n\n---\n\n') || t('export.noNotes');
}

/**
 * 导出一本书到「书摘/书名.md」。
 *
 * 两个入口共用：笔记页每本书头部的「导出这本」，和书卡右键的「导出这本书」。
 * 不弹预览、不复制剪贴板——一次点击就是落一份笔记。
 */
function exportBookFile(bookId: string): void {
  const book = liveBooks().find((b) => b.id === bookId);
  if (!book) {
    notify(t('notice.export.needBook'));
    return;
  }
  void (async () => {
    const src = getShellSource();
    if (!src) return;
    try {
      const res = await exportBookNotes(src.app, book, shellSettings());
      if (!res) {
        notify(t('notice.export.empty'));
        return;
      }
      closeOverlay();
      notify(t('notice.export.done', { n: res.highlights, path: res.path }));
    } catch (e) {
      notify(t('notice.export.failed', { why: (e as Error)?.message || t('common.unknownError') }), 'error');
    }
  })();
}

/* ─────────── 详情弹层需要的数据 ─────────── */

export function detailOf(id: string): ReaderBook | undefined {
  return liveBooks().find((b) => b.id === id);
}

/* ─────────── 主分发 ─────────── */

export interface ActionEnv {
  /** 某视图自己的重绘（弹层变化时用得上） */
  repaint?: () => void;
}

export function dispatchAction(act: string, el: HTMLElement, _env: ActionEnv = {}): void {
  const d = el.dataset;
  /**
   * 重绘出口（P2-07）。
   *
   * 所有视图（书架、侧栏、弹层）都订阅了壳层状态，`repaint()` 一次广播就够了。
   * 以前这里还叠一个 `env.repaint?.()`：点一次卡片，`repaint()` 广播一次、
   * `env.repaint()` 又直接 `render()` 一次——同一帧里整页 `innerHTML` 重建
   * 两遍（还带 `toRows + allMarks + 封面回填`）。
   *
   * `env.repaint` 参数保留在类型里，只给「不订阅广播的局部重画」用；
   * 目前没有这种调用方。
   */
  const rerender = (): void => repaint();

  switch (act) {
    /* ── 承载 ── */
    case 'study': {
      /* 进页的统一规则（返回目标、搜索范围）在 plugin.openStudy 里，
         这里只把页码递过去——四个入口（页签、图标、命令、协议）共用一套。
         2026-11-08：头栏只有一个形态，四颗图标也当页签用——点已亮的那颗
         回进来之前的页签页（nextStudyPage），所以不再有 studyback。 */
      const clicked = (d.p as StudyPage) || 'library';
      const st = getState();
      getShellSource()?.openStudy(nextStudyPage(st.studyPage, clicked, st.studyBack));
      break;
    }
    case 'gostudy':
      getShellSource()?.openStudy();
      break;
    case 'closestudy':
      /* 手机上书架是全屏弹窗，需要一个明确的「关」。桌面没有这颗按钮 */
      getShellSource()?.closeStudy();
      break;
    case 'hotkey': {
      /* 点设置页的那一行：跳到宿主的快捷键设置并搜这条命令。
         名字从宿主里取，改过一次命令名也不会指错。 */
      const app = getShellSource()?.app;
      const id = d.k || '';
      const reg = (app as unknown as { commands?: { commands?: Record<string, { name?: string }> } } | undefined)
        ?.commands?.commands;
      openHotkeySettings(app, reg?.[id]?.name || id);
      break;
    }
    case 'sbtab':
      /* 入口平权：AI 与引用页签基础版也看得见，点了弹高级版对照页，不切过去。
         以前整枚页签都不渲染，用户连「有 AI」都不知道。
         引用页签有自己的能力位（2026-11-12）：它列的是笔记里的反链，与
         「划线存成双链」是两件事，被拦时弹层要点亮用户刚点的那一行。 */
      if (d.tab === 'ai' && !requireCap('ai')) break;
      if (d.tab === 'cites' && !requireCap('cites')) break;
      if (d.tab) setState({ sideTab: d.tab as never });
      break;
    case 'swap':
      getShellSource()?.openStudy('library');
      break;

    /* ── 弹层开关 ── */
    case 'close':
      closeOverlay();
      break;
    case 'search':
      overlay('search');
      break;
    case 'import':
      getShellSource()?.openImport();
      break;
    case 'typography':
      overlay('typography');
      break;
    case 'bookmap':
      if (!requireCap('bookmap')) break;
      overlay('bookmap');
      break;
    /* 本章导读（2026-11-11）：命令与「重新生成」都走同一个函数 */
    case 'guide':
      if (!requireCap('aiChat')) break;
      void openGuide();
      break;
    case 'guidetry':
      if (!requireCap('aiChat')) break;
      void openGuide(true);
      break;
    case 'poster':
      /* 周报和书摘图片以前共用 card；书摘下放基础版后，周报自己立一道门禁 */
      if (!requireCap('poster')) break;
      overlay('poster');
      break;
    case 'setgoal':
      overlay('setgoal');
      break;
    case 'setdailygoal': {
      if (!requireCap('stats')) break;
      const n = Number(d.v);
      if (Number.isFinite(n)) {
        getShellSource()?.setDailyGoal(n);
        /* setDailyGoal 只写盘 + toast，不广播；统计页的 chips 和数字
           要等下一次重绘才会变。这里补一次，点完立刻看到高亮。 */
        repaint();
      }
      break;
    }
    /* ── 统计页：范围 / 口径 / 重算预演 / 报告出口 ──
       重算只在 stats-ui 的内存里生效，checkins 一行都不写回 store。 */
    case 'statsrange':
      setStatsUi({ range: d.v === 'today' ? 'today' : 'all', preview: false });
      rerender();
      break;
    case 'statsaudit':
      setStatsUi({ audit: d.v === 'wall' ? 'wall' : 'checkin', preview: false });
      rerender();
      break;
    case 'statsrecalc':
      setStatsUi({ preview: true });
      rerender();
      break;
    case 'statscancel':
      setStatsUi({ preview: false });
      rerender();
      break;
    case 'statsapply':
      setStatsUi({ recalced: true, preview: false });
      rerender();
      break;
    case 'statsrestore':
      setStatsUi({ recalced: false, preview: false });
      rerender();
      break;
    case 'statscopy': {
      if (!requireCap('stats')) break;
      void copyText(statsReportOf(currentStatsView(), getStatsUi()));
      const label = el.textContent;
      el.textContent = t('notice.copy.ok');
      window.setTimeout(() => { el.textContent = label; }, 1500);
      break;
    }
    case 'statsposter':
      if (!requireCap('stats')) break;
      downloadStatsPoster(statsModelOf(currentStatsView(), getStatsUi()));
      break;

    /* 设置页「调试日志」那一行：开关只负责抓，抓到的这份 JSON 从这里
       复制走（真机没法翻数据目录，只能靠粘贴板带出来）。 */
    case 'debugcopy': {
      const snap = debugSnapshot();
      void copyText(JSON.stringify(snap, null, 2));
      break;
    }

    case 'reset':
      overlay('reset');
      break;
    case 'export':
      if (!requireCap('export')) break;
      overlay('export', d.id ? { bookId: d.id } : {});
      break;

    /* ── 书库 ── */
    case 'detail':
      if (d.id) overlay('detail', { bookId: d.id });
      break;

    /* ── 关于条 ──
       五个出口都是「离开设置页去别处」：不写数据、不改偏好，所以这里
       一不 commit()、二不重绘，只把用户送到目的地。 */
    case 'aboutgithub':
      window.open(REPO_URL, '_blank', 'noopener,noreferrer');
      break;
    case 'aboutvideo':
      /* 关于条看推荐向那期，侧栏 AI 页签看 AI 知识库那期：两条各指各的，
         别为了少一个常量又合并回去（tests/about-actions.test.ts 守着）。 */
      window.open(VIDEO_TUTORIAL_URL, '_blank', 'noopener,noreferrer');
      break;
    case 'copygroup':
      void copyGroupId();
      break;
    /* 支持作者（2026-11-10）：上排第五个出口。打赏与激活码是两条线——
       基础版用户也能在这里支持作者，所以这里不设 requireCap 门禁。 */
    case 'support':
      openSupportDialog();
      break;
    /* 关于条里的「更新日志」：回看任意一版，不动「已看过」记录。
       自动弹只有升级后那一次，没有常驻入口就再也找不回来。 */
    case 'changelog':
      getShellSource()?.openChangelog();
      break;

    /* ── 书卡右键菜单 ──
       书卡上原来钉着「阅读 / 收藏 / 标为读完」三颗按钮，每张卡都被
       这三颗占掉一行，封面墙反而看不清书。改成右键（手机长按）菜单，
       顺带把「改名」「移除书库」这两个真正需要入口的动作放进去。 */
    case 'bookmenu': {
      const id = d.id || '';
      const book = liveBooks().find((b) => b.id === id);
      if (!book) break;
      const done = !!book.reading.stats.completedTime || (book.reading.position.percent || 0) >= 0.99;
      const items = bookMenuItems({
        done,
        fav: getState().favIds.includes(id),
        missing: book.fileRef.fileMissing === true,
      });
      const menu = new Menu();
      for (const it of items) {
        if (it.sepBefore) menu.addSeparator();
        menu.addItem((i) => {
          i.setTitle(it.title).setIcon(it.icon);
          /* 文件丢了就禁用「阅读」，其余照旧：书还在，用户要知道点不动的原因 */
          if (it.disabled) i.setDisabled(true);
          if (it.act === 'open') i.onClick(() => openBookById(id));
          if (it.act === 'relocate') i.onClick(() => overlay('missing', { bookId: id }));
          if (it.act === 'detail') i.onClick(() => overlay('detail', { bookId: id }));
          /* 补全信息（2026-11-11）：用户点了才发请求，只填空白字段 */
          if (it.act === 'enrich')
            i.onClick(() => {
              if (requireCap('aiChat')) void enrichBookMeta(id);
            });
          /* 导出没解锁就弹对照表，不悄悄降级成「复制一段纯文本」 */
          if (it.act === 'export')
            i.onClick(() => {
              if (requireCap('export')) exportBookFile(id);
            });
          if (it.act === 'fav')
            i.onClick(() => {
              const on = toggleFav(id);
              notify(on ? t('notice.fav.on') : t('notice.fav.off'));
              rerender();
            });
          if (it.act === 'done') i.onClick(() => toggleDone(id));
          if (it.act === 'rename') i.onClick(() => overlay('rename', { bookId: id }));
          /* 归入分类：点它开下一层菜单，位置沿用这次右键的坐标 */
          if (it.act === 'shelf')
            i.onClick(() =>
              openShelfMenu([id], { x: Number(d.x) || 0, y: Number(d.y) || 0 }),
            );
          if (it.act === 'remove') i.onClick(() => overlay('removebook', { bookId: id }));
        });
      }
      menu.showAtPosition({ x: Number(d.x) || 0, y: Number(d.y) || 0 });
      /* 原生 Menu 不给「染红一个条目」的 API：弹出之后按顺序把危险项
         标出来。菜单是宿主 DOM（不在 .bzs-shell 里），样式见 common.css
         的 .bzs-menu-danger。`dom` 没进类型声明，运行时才有。 */
      const menuDom = (menu as unknown as { dom?: HTMLElement }).dom;
      const rows = menuDom?.querySelectorAll<HTMLElement>('.menu-item');
      if (rows?.length) {
        const dangerIdx = items.map((i) => !!i.danger);
        rows.forEach((row: HTMLElement, i: number) => {
          if (dangerIdx[i]) row.classList.add('bzs-menu-danger');
        });
      }
      break;
    }
    case 'rename':
      if (d.id) overlay('rename', { bookId: d.id });
      break;
    case 'renamesave': {
      const book = liveBooks().find((b) => b.id === (d.id || ''));
      const input = document.querySelector<HTMLInputElement>('[data-role="rename"]');
      const next = (input?.value ?? '').trim();
      if (!book) break;
      if (!next) {
        notify(t('notice.rename.empty'), 'error');
        break;
      }
      book.meta.title = next;
      /* 打过这个标记，打开书时引擎不再用文件里的书名覆盖（data/book-meta.ts） */
      book.meta.titleEdited = true;
      book.updatedAt = Date.now();
      getShellSource()?.store.touch();
      closeOverlay();
      rerender();
      notify(t('notice.rename.done'));
      break;
    }
    case 'removebook':
      if (d.id) overlay('removebook', { bookId: d.id });
      break;
    case 'removebookdo': {
      const id = d.id || '';
      const src = getShellSource();
      const book = liveBooks().find((b) => b.id === id);
      if (!src || !book) break;
      /* 移出书架 = 归档：记录与数据一条不删，重新导入同一份文件会复活。
         真删（连数据一起）只留给设置页的清理入口。 */
      src.repo.archive(book);
      src.store.touch();
      if (getState().bookId === id) setState({ bookId: null });
      closeOverlay();
      rerender();
      notify(t('notice.book.archived', { title: book.meta.title || t('common.untitled') }));
      break;
    }
    case 'archivebook': {
      /* 失联弹层里的「移出书架」：与上面的 removebookdo 走同一条归档 */
      const id = d.id || '';
      const src = getShellSource();
      const book = liveBooks().find((b) => b.id === id);
      if (!src || !book) break;
      src.repo.archive(book);
      src.store.touch();
      closeOverlay();
      rerender();
      notify(t('notice.book.archived', { title: book.meta.title || t('common.untitled') }));
      break;
    }
    case 'relocateauto': {
      /* 失联书：在库里按内容指纹找同一份文件，找到就把记录挪过去 */
      const id = d.id || '';
      const src = getShellSource();
      const book = liveBooks().find((b) => b.id === id);
      if (!src || !book) break;
      void (async () => {
        const fp = book.fileRef.fingerprint;
        if (!fp) {
          notify(t('notice.missing.noFingerprint'));
          return;
        }
        const files = scanVault(src.app, [book.fileRef.format]);
        for (const f of files) {
          const owner = src.repo.byPath(f.path);
          if (owner && owner.id !== book.id) continue; // 已属于另一条记录，别抢
          const cand = await readFingerprint(src.app, f.path, f.size);
          if (cand !== fp) continue;
          src.repo.relocate(book, f.path);
          src.store.touch();
          closeOverlay();
          rerender();
          notify(t('notice.missing.found', { path: f.path }));
          return;
        }
        notify(t('notice.missing.notFound'));
      })();
      break;
    }
    case 'relocatepick': {
      /* 失联书：用户从库外选文件。先算指纹校验，对得上才写进库里再重连 */
      const id = d.id || '';
      const src = getShellSource();
      const book = liveBooks().find((b) => b.id === id);
      if (!src || !book) break;
      void pickAndRelocate(src, book);
      break;
    }
    case 'openbook':
      // 书籍详情是个弹层：点了「开始阅读」就该把它收掉，
      // 否则书在底下打开、详情盖在上面，看着像没反应
      closeOverlay();
      if (d.id) openBookById(d.id);
      break;
    case 'missing':
      /* 详情页里失联书的主按钮：直接进「重新定位」 */
      if (d.id) overlay('missing', { bookId: d.id });
      break;
    case 'fav':
      if (d.id) {
        const on = toggleFav(d.id);
        notify(on ? t('notice.fav.on') : t('notice.fav.off'));
      }
      break;
    case 'done':
      toggleDone(d.id);
      break;
    case 'libfilter':
      if (d.v) setState({ libFilter: d.v as never });
      break;
    /* 桌面端排序是三颗平铺的 chip（窄屏走 libsortmenu） */
    case 'libsort':
      if (d.v) setState({ libSort: d.v as never });
      break;
    case 'libview':
      if (d.v) setState({ libView: d.v as never });
      break;
    /* 窄屏书库：搜索框按需展开。展开后把光标放进输入井——
       点这一下的全部目的就是打字，还要再点一次输入框就白做了。 */
    case 'libsearchtoggle': {
      const open = !getState().libSearchOpen;
      setState({ libSearchOpen: open });
      if (open) {
        window.setTimeout(() => {
          document.querySelector<HTMLInputElement>('[data-role="libkw"]')?.focus();
        }, 0);
      }
      break;
    }
    case 'libfiltermenu': {
      const box = el.getBoundingClientRect();
      const menu = new Menu();
      for (const [value, key] of LIB_FILTERS) {
        menu.addItem((item) =>
          item
            .setTitle(t(key))
            .setChecked(getState().libFilter === value)
            .onClick(() => setState({ libFilter: value })),
        );
      }
      menu.showAtPosition({ x: box.left, y: box.bottom + 4 });
      break;
    }
    case 'libsortmenu': {
      /* 窄屏排序：一颗 chip + 宿主自己的菜单——跟主题走，手机上还是原生的
         底部动作面板。桌面已经平铺成三颗 chip，不走这里。 */
      const box = el.getBoundingClientRect();
      const menu = new Menu();
      for (const [value, key] of LIB_SORTS) {
        menu.addItem((item) =>
          item
            .setTitle(t(key))
            .setChecked(getState().libSort === value)
            .onClick(() => setState({ libSort: value })),
        );
      }
      menu.showAtPosition({ x: box.left, y: box.bottom + 4 });
      break;
    }
    case 'shelf':
      if (d.v) setState({ libShelf: d.v });
      break;

    /* ── 分类管理 ──
       入口在书卡菜单「归入分类…」的下一层（新建 / 管理两条）。所有动作改的
       都是那份名单，与「书归哪一类」是两件事：改名会把这一类的书一起改过去，
       删除则把书退回「未分类」（书、进度、划线一条不动）。 */
    /* 改名 / 删除确认里的「取消」：三态共用一层弹层，回名单就是重开一次 */
    case 'shelves':
      overlay('shelves');
      break;
    case 'shelfcreate': {
      const input = document.querySelector<HTMLInputElement>('[data-role="shelfnew"]');
      const raw = input?.value ?? '';
      const err = shelfNameError(raw, shelfNamePool());
      if (err) {
        notify(t(SHELF_ERR_KEY[err]), 'error');
        break;
      }
      const name = cleanShelfName(raw);
      saveShelfList([...getState().shelfList, name]);
      const bookId = d.id || '';
      if (bookId) {
        /* 从书卡「新建分类…」进来的：建好顺手把这本书放进去，少绕一圈 */
        closeOverlay();
        assignShelf([bookId], name);
      } else {
        bumpOverlayRev();
      }
      break;
    }
    case 'shelfrename':
      if (d.name) overlay('shelves', { mode: 'rename', text: d.name });
      break;
    case 'shelfrenamesave': {
      const from = d.name || '';
      const input = document.querySelector<HTMLInputElement>('[data-role="shelfrename"]');
      const err = shelfNameError(input?.value ?? '', shelfNamePool().filter((x) => x !== from));
      if (err) {
        notify(t(SHELF_ERR_KEY[err]), 'error');
        break;
      }
      const src = getShellSource();
      if (!src) break;
      const to = cleanShelfName(input?.value ?? '');
      /* 书自带分类的书（归属字段是空的）也要跟着走：改名之后它们才第一次
         真正「有归属」，否则会退回 EPUB 里的旧分类名，看起来像没改成。
         遍历全量书（含已移出书架的）：归档书的归属字段留着旧名字，
         下次启动重建索引时那一格又会冒回分类条。 */
      for (const b of allBooks()) if (shelfOf(b) === from) src.setShelf(b.id, to);
      reshapeShelfCache(from, to);
      saveShelfList(renameShelf(getState().shelfList, from, to));
      /* 正筛着这一类时改名：筛选值还指着旧名字，画面会立刻空掉 */
      if (getState().libShelf === from) setState({ libShelf: to });
      overlay('shelves');
      notify(t('shelves.renamed', { name: to }));
      break;
    }
    case 'shelfdel':
      if (d.name) overlay('shelves', { mode: 'del', text: d.name });
      break;
    case 'shelfdeldo': {
      const name = d.name || '';
      const src = getShellSource();
      if (!src || !name) break;
      /* 删除 = 书退回「未分类」，不是连书一起删。归属字段清空，
         下次打开会退回 EPUB 自带的分类名——那句「回到未分类」说的就是这个。
         同样遍历全量书：跳过归档书的话，旧分类名会随下次重建索引复活。 */
      for (const b of allBooks()) if (shelfOf(b) === name) src.setShelf(b.id, '');
      reshapeShelfCache(name, '');
      saveShelfList(dropShelf(getState().shelfList, name));
      if (getState().libShelf === name) setState({ libShelf: ALL_SHELF });
      overlay('shelves');
      notify(t('shelves.deleted', { name }));
      break;
    }
    case 'shelfmove': {
      const dir = d.v === 'down' ? 'down' : 'up';
      saveShelfList(moveShelf(getState().shelfList, d.name || '', dir));
      bumpOverlayRev();
      break;
    }

    /* ── 笔记 ── */
    case 'notefilter':
      if (d.v) setState({ noteFilter: d.v });
      break;
    case 'reviewnext':
      mutateState((s) => {
        s.reviewIdx += 1;
      });
      break;
    case 'jumpmark':
      jumpMark(d.id, d.book);
      break;
    /* ── 标注多选 / 批量操作 ── */
    case 'notesel':
      mutateState((s) => {
        s.noteSelect = !s.noteSelect;
        s.noteSel = [];
      });
      break;
    case 'notepick':
      if (d.id) {
        mutateState((s) => {
          s.noteSel = togglePick(s.noteSel, d.id as string);
        });
      }
      break;
    case 'noteall': {
      const st = getState();
      const shown = filterMarks(allMarks(liveBooks()), st.noteFilter, st.noteKw).map((m) => m.id);
      mutateState((s) => {
        s.noteSel = toggleAll(s.noteSel, shown);
      });
      break;
    }
    case 'notedrop':
      if (!getState().noteSel.length) {
        notify(t('notice.select.pick'), 'info');
        break;
      }
      overlay('notedrop');
      break;
    case 'notedropdo':
      dropSelectedMarks();
      break;
    /* ── 读完仪式 ──
       星星只改 class 不重绘：重绘会把用户刚输入的一句话清掉 */
    case 'rate': {
      const v = Number(d.v) || 0;
      const box = el.closest('.bzs-stars');
      if (!box) break;
      [...box.querySelectorAll('.bzs-star')].forEach((st, i) => st.classList.toggle('on', i < v));
      break;
    }
    case 'finishsave': {
      const id = d.id || getState().bookId;
      const book = id ? liveBooks().find((b) => b.id === id) : undefined;
      const box = el.closest('.bzs-modal');
      closeOverlay();
      if (!book) break;
      const stars = box ? box.querySelectorAll('.bzs-star.on').length : 0;
      const ta = box?.querySelector('textarea');
      book.reading.stats.rating = stars || undefined;
      book.reading.stats.review = (ta as HTMLTextAreaElement | null)?.value.trim() || undefined;
      book.updatedAt = Date.now();
      getShellSource()?.store.touch();
      notify(stars ? t('notice.rating.stars', { stars }) : t('notice.rating.done'));
      break;
    }
    case 'finishskip':
      closeOverlay();
      break;

    case 'copymd':
      if (!requireCap('export')) break;
      void copyText(exportMarkdown(d.book || undefined));
      break;
    /**
     * 一次点击导出：直接写到「书摘/书名.md」，不弹预览。
     *
     * 弹层留给「想换个格式 / 先看一眼」的场景；最常见的动作是
     * 「把这本的划线收进笔记库」，中间隔一个预览就是多一次点击。
     */
    case 'exportfile': {
      if (!requireCap('export')) break;
      const id = d.id || d.book || getState().bookId;
      if (id) exportBookFile(id);
      else notify(t('notice.export.needBook'));
      break;
    }
    case 'copytext':
      if (d.text) void copyText(d.text);
      break;

    /* 位置链接：单条复制免费——一次只能拿一条不构成「搬家」，
       但每粘进笔记一次，都是一次广告。 */
    case 'copylink': {
      // 双向链接是高级能力：基础版点它给对照表，不悄悄降级成另一段文字
      if (!requireCap('bilink')) break;
      const b = liveBooks().find((x) => x.id === (d.book || getState().bookId));
      const h = b?.notes?.highlights?.find((x) => x.id === d.id);
      if (!b || !h) {
        notify(t('notice.mark.notFound'), 'error');
        break;
      }
      void copyText(wikilinkOfMark(b, h));
      /* 与「复制」同一条规矩：拿到东西就把浮层收掉 */
      closeOverlay();
      break;
    }

    /* ── 授权 ── */
    case 'unlock':
      overlay('unlock', { mode: d.mode || '' });
      break;
    case 'buy':
      window.open(PURCHASE_URL, '_blank');
      break;
    case 'relicense':
      /* 已激活的人换码（试用 → 正式版）：直接放开输入框，原码留着方便替换 */
      setState({ relicense: true });
      rerender();
      window.setTimeout(() => {
        const box = document.querySelector<HTMLInputElement>('[data-role="license"]');
        box?.focus();
        box?.select();
      }, 0);
      break;
    case 'activate': {
      /* 取当前弹层里的那个输入框：设置页也有一枚 data-role="license"，
         全局 querySelector 会先命中它，于是从解锁层粘贴的码永远读不到。 */
      const inLayer = el.closest<HTMLElement>('.bzs-modal, .bzs-float');
      const box =
        inLayer?.querySelector<HTMLInputElement>('[data-role="license"]') ??
        document.querySelector<HTMLInputElement>('[data-role="license"]');
      const code = (box?.value || '').trim();
      const src = getShellSource();
      void (async () => {
        if (!src) return;
        const res = await src.activate(code);
        if (!res.ok) {
          // 不重绘：重绘会把用户刚粘进去的那一长串码清掉，重来一遍很烦
          notify(res.message, 'error');
          return;
        }
        notify(res.message);
        /* 换码成功：退出「重新激活」态，授权组回到只读凭证 */
        setState({ relicense: false });
        /* 激活成功后强制重画一次弹层（P2-08）：`kind` / `mode` 都没变，
           `overlayKey` 不变，弹层本来完全不动——用户只看到一条 toast，
           界面上还是「未激活」。rev +1 让 key 变化，触发 sync()。 */
        const o = getState().overlay;
        if (o) setState({ overlay: { ...o, rev: (o.rev ?? 0) + 1 } });
        else rerender();
      })();
      break;
    }

    /* ── 数据目录 ── */
    case 'pickimportdir': {
      /* 只挑不输；选到不同目录才问「要不要把已有文件搬过去」 */
      const src = getShellSource();
      if (!src) break;
      const cur = shellSettings().importDir || DEFAULT_SETTINGS.importDir;
      void pickFolder(src.app, cur).then((picked) => {
        if (picked === null || picked === cur) return;
        overlay('movedir', { mode: 'import', text: JSON.stringify({ from: cur, to: picked }) });
      });
      break;
    }
    case 'pickexportdir': {
      /* 导出目录同理：手打路径错了不报错，笔记会写进别处 */
      const src = getShellSource();
      if (!src) break;
      const cur = shellSettings().exportDir || DEFAULT_SETTINGS.exportDir;
      void pickFolder(src.app, cur).then((picked) => {
        if (picked === null || picked === cur) return;
        if (picked === '/') {
          notify(t('notice.dir.exportRoot'), 'error');
          return;
        }
        overlay('movedir', { mode: 'export', text: JSON.stringify({ from: cur, to: picked }) });
      });
      break;
    }
    case 'pickdatadir': {
      const src = getShellSource();
      if (!src) break;
      const cur = src.dataDir();
      void pickFolder(src.app, cur).then((picked) => {
        if (picked === null || picked === cur) return;
        if (picked === '/') {
          notify(t('notice.dir.dataRoot'), 'error');
          return;
        }
        overlay('movedir', { mode: 'data', text: JSON.stringify({ from: cur, to: picked }) });
      });
      break;
    }
    case 'dodirmove': {
      /* 二次确认后的唯一执行点：三种目录都从这里搬 */
      const src = getShellSource();
      if (!src) break;
      const o = getState().overlay;
      const kind = o?.mode === 'export' || o?.mode === 'import' || o?.mode === 'data' ? o.mode : null;
      if (!kind) break;
      /* 一次只能搬一种目录（C2）：迁移按秒算，动作还可能被命令 / 脚本派发。
         再点一次不该把同一批文件搬第二遍。 */
      if (RT.migrating) {
        notify(t('notice.migrate.busy'), 'info');
        break;
      }
      let from = '';
      let to = '';
      try {
        const p = JSON.parse(o?.text || '{}') as { from?: string; to?: string };
        from = p.from || '';
        to = p.to || '';
      } catch {
        break;
      }
      if (!to) break;
      RT.migrating = kind;
      /* 先把弹层收掉：迁移一旦开跑按钮就不该还在可点状态 */
      closeOverlay();
      notify(t('notice.migrate.running'));
      void (async () => {
        try {
          const res = await src.migrateDir(kind, from, to);
          notify(res.message, res.ok ? 'info' : 'error');
          if (res.ok && kind === 'data') RT.dataDirDraft = '';
        } catch (e) {
          /* 迁移自己会兜底回滚，但异常不能被吞成「一直在迁移」 */
          notify(t('notice.migrate.failed', { why: (e as Error)?.message || t('common.unknownError') }), 'error');
        } finally {
          RT.migrating = '';
          rerender();
        }
      })();
      break;
    }
    /* ── 备份 / 恢复（新功能） ── */
    case 'backup': {
      /* 成功/失败的提示都由插件层发（它知道具体路径），这里不再重复一条 */
      const src = getShellSource();
      if (!src) break;
      void src.backup();
      break;
    }
    case 'restore': {
      /* 恢复是**整份替换**（C12）：点一下就把当前数据换掉，没有回头路。
         所以这里只开一张确认层，真正执行在 restoredo。 */
      overlay('restore');
      break;
    }
    case 'restoredo': {
      const src = getShellSource();
      if (!src) break;
      /* 先收层再读文件：文件选择器是阻塞式的一步，弹层留在后面会挡住宿主窗口 */
      closeOverlay();
      void src.restore();
      break;
    }

    /* ── 统计 ── */
    case 'goal': {
      const v = Number(d.v);
      if (Number.isFinite(v) && v > 0) setGoal(Math.round(v));
      break;
    }

    /* ── 设置 ── */
    case 'setpref':
      setPref(d.k, d.v);
      break;
    case 'setpen':
      if (d.v) setState({ pen: d.v });
      break;
    /**
     * 界面语言：写进 settings 并立刻切换。
     *
     * 命令名切不了——Obsidian 的 addCommand 只在插件加载时求值一次，
     * 所以设置页那行说明写了「命令名需重启」。界面本身不该等重启：
     * 一个点了没反应的开关比没有这个开关更糟。
     */
    case 'setlang': {
      const src = getShellSource();
      if (!src) break;
      /* 八种语言一个都不能丢：data-v 是 DOM 上的字符串，只放行 zh/en 会把
         日德法西葡葡全部打回 auto，用户选了等于没选。 */
      const next: LanguagePref = isLocale(d.v) ? d.v : 'auto';
      src.setSettings({ language: next });
      const changed = setLocale(resolveLocale(next, hostLanguageCode()));
      /* 重绘放在通知之前：选中态要跟着动，哪怕语言本身没变
         （auto → en，而宿主本来就是英文时 setLocale 返回 false）。 */
      repaint();
      if (changed) notify(t('notice.language.changed'));
      break;
    }
    case 'headertoggle': {
      /* 图标显隐：隐藏的进 ⋮（不是彻底消失） */
      const src = getShellSource();
      if (!src) break;
      const id = d.k || '';
      if (!id) break;
      const p = shellPrefs();
      const hidden = p.headerHidden.includes(id);
      src.setPrefs({
        headerHidden: hidden ? p.headerHidden.filter((x) => x !== id) : [...p.headerHidden, id],
        headerOrder: p.headerOrder.length ? p.headerOrder : HEADER_ACTION_IDS.slice(),
      });
      rerender();
      break;
    }
    case 'headermove': {
      /* 图标排序：跟这台设备上**看得见**的相邻一位交换。顺序一旦动过就整份落盘，
         不再回退默认。

         跳过看不见的（2026-11-11）：手机上并排 / 对照书籍 / 朗读不列在设置页里，
         但顺序偏好仍留着它们的位置，切回电脑要原位复现。按完整顺序换相邻一位的话，
         用户点「下移」可能换掉的是屏幕里根本不存在的项——画面毫无变化，看起来像
         按钮坏了。判据与设置页那三处共用同一份「手机形态 + 不提供的动作」。 */
      const src = getShellSource();
      if (!src) break;
      const id = d.k || '';
      const dir = Number(d.v) || 0;
      if (dir !== 1 && dir !== -1) break;
      const p = shellPrefs();
      const base: string[] = p.headerOrder.length ? p.headerOrder : HEADER_ACTION_IDS.slice();
      const mobile = isMobileShell();
      const next = moveHeaderAction(base, id, dir, (x) => !(mobile && isMobileHiddenAction(x as HeaderActionId)));
      if (!next) break;
      src.setPrefs({ headerOrder: next });
      rerender();
      break;
    }
    case 'toggle': {
      const src = getShellSource();
      if (!src) break;
      const patch = flipSetting(shellSettings(), d.k ?? '');
      if (!patch) break;
      src.setSettings(patch);
      /* 必须自己重绘：setSettings 只落盘 + notifyShell，设置页那块的 DOM
         不会因为状态变了就重建，开关会停在旧位置（用户报的「点了不实时显示」）。 */
      repaint();
      break;
    }

    case 'preftoggle': {
      /* 阅读偏好（prefs）上的开关：章节名、桌面点击翻页。按按钮当前状态翻转：
         拿 el 的 class 比读一遍 prefs 更省事，也不会和还没落盘的值打架。 */
      const src = getShellSource();
      if (!src) break;
      if (d.k === 'chapterLabel') src.setPrefs({ chapterLabel: !el.classList.contains('on') });
      /* 桌面点正文翻页（2026-11-12）：默认关，要用的人自己打开 */
      if (d.k === 'desktopTapTurn') src.setPrefs({ desktopTapTurn: !el.classList.contains('on') });
      repaint();
      break;
    }

    /* ── 侧栏：目录 / 书签 / 划线 ── */
    case 'jumpch': {
      if (d.href) {
        closeOverlay();
        collapseSidebarAfterJump(el, jumpTo(d.href));
        break;
      }
      /* 全书鸟瞰只拿得到章节名（S-05）：在目录快照里按名字找一条 href。
         以前那一行有手型光标和 hover 铜底，点下去整块是死的。 */
      const label = (d.label || '').trim();
      const hit = label
        ? getToc()?.items?.find(
            (it) => (it.label || '').trim() === label || (it.label || '').includes(label),
          )
        : undefined;
      if (hit?.href) {
        closeOverlay();
        collapseSidebarAfterJump(el, jumpTo(hit.href));
      } else {
        notify(t('notice.toc.missingChapter'), 'info');
      }
      break;
    }
    case 'toctoggle': {
      /* 目录折叠：只记 href（label 会重名），点一下切换，重绘由 state 广播带走 */
      const href = d.href;
      if (!href) break;
      if (RT.tocCollapsed.has(href)) RT.tocCollapsed.delete(href);
      else RT.tocCollapsed.add(href);
      repaint();
      break;
    }
    case 'jumpbmk': {
      const book = currentBook();
      const k = (book?.notes?.bookmarks ?? []).find((x) => x.id === d.id);
      if (book && k) {
        closeOverlay();
        getShellSource()?.openBook(book, k.cfi || undefined);
        collapseSidebarAfterJump(el, true);
      }
      break;
    }
    case 'delbmk':
      /* 和删除划线同一套：先出一张确认卡。
         原来走「再点一次」——侧栏里连点两下和「一次没点准又补一下」
         几乎分不出来，而删除不可撤销。 */
      if (!d.id) break;
      overlay('confirmdel', { bookmarkId: d.id, bookId: d.book || getState().bookId || '' });
      break;
    case 'delbmkdo': {
      /* 按 `data-book` 找（C8）：弹层是从某本书的侧栏打开的，那时用户可能已经
         切到另一本；拿 currentBook() 去删会删错书。 */
      const book = bookOfBookmark(d.id, d.book);
      if (!book || !d.id || !removeBookmark(book, d.id)) {
        notify(t('notice.bookmark.gone'), 'info');
        break;
      }
      getShellSource()?.store.touch();
      repaint();
      closeOverlay();
      break;
    }
    case 'delmark': {
      /* 删除不可撤销：先开一张确认卡，把要删的那段摊开写清楚。
         以前是「再点一次才删」（toast 提示），侧栏里连点两下和「一次没点准
         又补一下」几乎分不出来。 */
      if (!d.id) break;
      overlay('confirmdel', { markId: d.id, bookId: d.book || getState().bookId || '' });
      break;
    }
    case 'delmarkdo':
      /* 删成功才收层（C8）：失败时卡片留着，用户还能再点一次或先去看一眼 */
      if (deleteMark(d.id, d.book)) closeOverlay();
      break;

    /* ── 标注弹层内的动作 ── */
    case 'hlcolor':
      changeMarkColor(d.id, d.v, d.book);
      break;
    case 'hljump':
      collapseSidebarAfterJump(el, jumpToMark(d.id, d.book));
      break;
    case 'hlidea':
      // 浮窗要贴着原来那条划线展开，锚点沿用标注卡的位置
      overlay('idea', { markId: d.id, bookId: d.book || getState().bookId || '', anchor: getState().overlay?.anchor });
      break;
    case 'ideaexpand':
      /* 气泡里只露一截，整篇进一张只读弹窗。不带锚点：全文居中读，
         不再贴着那条划线——关掉后回到阅读页，位置由用户自己找回来。 */
      if (d.id) overlay('ideaall', { markId: d.id, bookId: d.book || getState().bookId || '' });
      break;
    case 'hlquote':
      quoteFromMark(d.id, d.book);
      break;
    case 'hlai': {
      /* 点划线也能直接问 AI：以前这条工具条上根本没有 AI 这一颗，
         想解释划线原文只能先划一遍再点。与 selai 同一个面板，只是带上了 markId。 */
      if (!requireCap('aiSel')) break;
      const book = findBookOfMark(d.id, d.book);
      const h = book?.notes?.highlights.find((x) => x.id === d.id);
      if (!book || !h) {
        notify(t('notice.mark.notFound'), 'error');
        break;
      }
      overlay('ai', {
        text: h.text,
        markId: h.id,
        bookId: book.id,
        mode: 'explain',
        /* 锚点沿用工具条正贴着的那条划线，AI 卡才不会掉到屏幕角 */
        anchor: getState().overlay?.anchor,
      });
      break;
    }
    case 'hlcopy': {
      /* 复制划线原文：文字已经存在数据里，不重复塞进 DOM 的 data-text */
      const book = findBookOfMark(d.id, d.book);
      const h = book?.notes?.highlights.find((x) => x.id === d.id);
      if (!book || !h) {
        notify(t('notice.mark.notFound'), 'error');
        break;
      }
      void copyText(h.text);
      /* 复制完把浮层收掉：用户要的是这段字，不是继续停在这条线上。
         不 force：想法里可能还有没保存的字，那是另一码事（会先问一句）。 */
      closeOverlay();
      break;
    }
    case 'hldel':
      /* 正文工具条的「删除」以前直接删（连想法一起），无确认无撤销；
         侧栏删同一条却要先过确认卡（P2-09）。统一走确认。
         带上工具条正贴着的锚点：桌面据此把确认条摆到工具条上方，
         而不是再压一张遮罩弹窗。 */
      if (d.id)
        overlay('confirmdel', {
          markId: d.id,
          bookId: d.book || getState().bookId || '',
          anchor: getState().overlay?.anchor,
        });
      break;
    case 'ideasave':
      saveIdea(d.id, d.book);
      break;
    /* ── 划词浮层 ── */
    case 'selpen': {
      /* 选过的色就是下次的默认色（2026-11-10）：state.pen 落 localStorage，
         重开 Obsidian 还是这个色。以前只有设置页的「默认笔色」能改它，
         在划词条上点色点只影响这一条，下次又回到琥珀。 */
      const color = d.v && isHighlightColor(d.v) ? d.v : getState().pen;
      if (color !== getState().pen) setState({ pen: color });
      // 手机上选中即已划上一条，色点只改它的颜色；桌面上是「选色才落笔」
      const reuse = RT.selMarkId;
      if (reuse && recolorMark(reuse, color)) break;
      const id = createMark(color);
      if (id) RT.selMarkId = id;
      /* 落笔即结束：选区收掉，手机上的系统手柄与菜单一起退场 */
      finishSelection('selpen');
      break;
    }
    case 'selidea': {
      /* 和这三颗走同一条落线路（markSelection）：同位置已有线就复用，
         不叠第二条；手机上刚点色点落的那条（RT.selMarkId）直接接手。 */
      const id = RT.selMarkId || markSelection();
      if (id) {
        RT.selMarkId = id;
        overlay('idea', { markId: id, bookId: RT.sel?.bookId || '', anchor: RT.sel?.anchor });
      }
      break;
    }
    case 'selquote':
      // 字段名必须是 chapterTitle：OverlayState 上没有 chapter，
      // 传过去会被丢掉，书摘卡就只能退回 RT.sel，某些路径下章节名是空的
      if (RT.sel)
        overlay('quote', {
          text: RT.sel.text,
          bookId: RT.sel.bookId,
          chapterTitle: RT.sel.chapterTitle,
          /* 书摘是贴选区的浮卡（不是居中弹窗），锚点必须带上 */
          anchor: RT.sel.anchor,
        });
      break;
    case 'cardtpl': {
      /* 书摘卡换版式：写进 overlay.mode，overlayKey 已经把它算进去了，
         所以下一次 sync 会重画；内容（text/bookId/chapterTitle）原样带过去。
         同时记进 RT.cardTpl，关掉弹层再打开还是这一版。 */
      const o = getState().overlay;
      if (!o || o.kind !== 'quote' || !d.v) break;
      RT.cardTpl = d.v;
      openOverlay({ ...o, mode: d.v });
      break;
    }
    case 'seldict':
      if (RT.sel) overlay('dict', { word: RT.sel.text.slice(0, 8) });
      break;
    case 'selai':
      if (RT.sel && requireCap('aiSel'))
        overlay('ai', { text: RT.sel.text, mode: 'explain', anchor: RT.sel.anchor });
      break;
    /* 两颗知识库按钮和 AI 问答同一道门：按钮在授权掉了之后不再渲染，
       但动作本身也该拦——data-act 是 DOM 属性，不是权限。
       用 kb 这个 cap：解锁弹层才能滚到「连接至 BZ AI 知识库」那一行。 */
    case 'selterm': {
      if (!requireCap('kb')) break;
      /* 先落线：用户点它 = 这段我要留着。bz 里取消也不撤，回原文找得到。 */
      const id = autoMarkSelection('selterm');
      knowledgeEntry('term', id ?? undefined);
      /* 录入界面已经打开 / 已有链接已转交出去：这段字用完了，收选区 */
      finishSelection('selterm');
      break;
    }
    case 'selpassage': {
      if (!requireCap('kb')) break;
      const id = autoMarkSelection('selpassage');
      knowledgeEntry('passage', id ?? undefined);
      finishSelection('selpassage');
      break;
    }
    case 'hlterm':
      if (!requireCap('kb')) break;
      knowledgeEntry('term', d.id, d.book);
      break;
    case 'hlpassage':
      if (!requireCap('kb')) break;
      knowledgeEntry('passage', d.id, d.book);
      break;
    case 'selbilink': {
      /* 还没落下标注，只能拿选区 + 当前章名拼双向链接；
         与笔记页的「双向链接」按钮同源（data/wikilink.ts 的 wikilinkOf）。
         复制之前先把这段字标出来（autoMarkSelection）：链接只进剪贴板，
         书里不留痕的话，用户回头找不到这段是在哪儿。 */
      if (!requireCap('bilink')) break;
      const sel = RT.sel;
      const book = sel ? liveBooks().find((b) => b.id === sel.bookId) : undefined;
      if (!sel || !book) {
        notify(t('notice.sel.empty'), 'error');
        break;
      }
      autoMarkSelection('selbilink');
      void copyText(
        wikilinkOf(book, {
          text: sel.text,
          cfiRange: sel.cfiRange,
          chapterTitle: sel.chapterTitle,
          pdfSelection: sel.pdfSelection,
          pdfRect: sel.pdfRect,
        }),
      );
      finishSelection('selbilink');
      break;
    }
    case 'selcopy':
      if (RT.sel) void copyText(RT.sel.text);
      finishSelection('selcopy');
      break;
    /* 知识盒标签（气泡 / 侧栏 / 笔记卡上的那枚可点链接）：打开对应笔记 */
    case 'kbopen':
      if (d.path) openKbNote(d.path);
      break;

    /* ── AI ── */
    case 'aiask':
      if (!requireCap('ai')) break;
      void askAi(el);
      break;
    case 'opensrc': {
      const src = getShellSource();
      const path = d.path || '';
      if (!src || !path) break;
      const file = src.app.vault.getFileByPath(path);
      if (!file) {
        notify(t('notice.note.missing', { path }), 'error');
        break;
      }
      void src.app.workspace.getLeaf(false).openFile(file);
      break;
    }
    case 'citejump': {
      /* 侧栏「引用」：点一行跳回书里那一处。书没开着就一并打开。
         PDF 带 `pdf/页码` 直接落页；EPUB 带 cfi + 原文 + 章节走三级降级
         （CFI 失效还能按原文搜、按百分比落），只传 cfi 会「点了没反应」。 */
      const book = currentBook();
      if (!book) break;
      const page = Number(d.page) || 0;
      const cfi = String(d.cfi ?? '').trim();
      const text = String(d.text ?? '').trim();
      if (page < 1 && !cfi && !text) break;
      closeOverlay();
      if (page >= 1) {
        getShellSource()?.openBook(book, `pdf/${page}`);
      } else {
        const pct = Number(d.pct);
        getShellSource()?.openTarget?.({
          bookId: book.id,
          cfi: cfi || undefined,
          text: text || undefined,
          chapter: d.chapter || undefined,
          pct: Number.isFinite(pct) ? pct : undefined,
        });
      }
      collapseSidebarAfterJump(el, true);
      break;
    }
    case 'citeonly': {
      /* 「只看本页」：反链按页分组，厚书翻到中间时要滚很久才看见眼前这页。
         打开后按当前页过滤，页内没有引用就明说「本页还没被引用」，
         不退回全书——不然开关看起来毫无作用。 */
      RT.citesOnlyPage = !RT.citesOnlyPage;
      rerender();
      break;
    }
    case 'citeopen': {
      const src = getShellSource();
      const path = d.path || '';
      if (!src || !path) break;
      const file = src.app.vault.getFileByPath(path);
      if (!file) {
        notify(t('notice.note.missing', { path }), 'error');
        break;
      }
      void src.app.workspace.getLeaf(false).openFile(file);
      break;
    }
    case 'opensrcbook': {
      const book = liveBooks().find((b) => b.id === d.book);
      const src = getShellSource();
      if (!book || !src) break;
      const chapter = (d.chapter || '').trim();
      /* 同一本书就直接跳章；另一本只打开——打开视图是异步的，
         刚 openBook 完立刻跳章会跳到一个还没分页的引擎上。 */
      if (chapter && src.openBookId() === book.id) src.goToChapter(chapter);
      else src.openBook(book);
      break;
    }
    case 'ptopen': {
      if (!requireCap(indexCap())) break;
      const book = liveBooks().find((b) => b.id === (d.id || d.book || getState().bookId));
      if (!book) {
        notify(t('notice.needBook'), 'info');
        break;
      }
      /* 2026-11-07 起建索引只在侧栏 AI 页签里做：详情页这颗按钮负责把
         「建立索引」那一块展开，不再弹「全书问答准备」的弹窗。 */
      revealIndexPanel();
      break;
    }

    /* ── 侧栏 AI 页签：建索引就地展开，不弹窗 ── */
    case 'aiidx': {
      if (!requireCap(indexCap())) break;
      revealIndexPanel();
      break;
    }
    case 'aiidxclose':
      RT.aiIndexOpen = false;
      repaint();
      break;
    case 'aiplan':
      if (d.v === 'vector' || d.v === 'compress') {
        RT.portraitPlan = d.v;
        repaint();
      }
      break;
    case 'aistart': {
      if (!requireCap(indexCap())) break;
      const book = currentBook();
      if (!book) {
        notify(t('notice.needBook'), 'info');
        break;
      }
      /* 跑起来了才收起「选建法」：被拦下时保留原样，用户能改选另一种方案。
         读画像失败时 startPortrait 会 reject（它的 deps.load 在 try 之外），
         不接住就是一条未处理拒绝 + 界面永远停在「正在建立」。 */
      void startPortrait(book, RT.portraitPlan)
        .catch(() => false)
        .then((ok) => {
          if (ok) RT.aiIndexOpen = false;
          repaint();
        });
      break;
    }
    case 'aiidxstop':
      portraitBuilder().cancel();
      repaint();
      break;
    case 'aiidxrebuild': {
      /* 重建 = 删掉现有索引再整本重来，中途停不下、也算不回去：
         先弹一句问清楚，别让「看一下这颗是干什么的」直接变成一次重算。 */
      if (!requireCap(indexCap())) break;
      const book = currentBook();
      if (!book) {
        notify(t('notice.needBook'), 'info');
        break;
      }
      openOverlay({ kind: 'rebuildidx', bookId: book.id });
      break;
    }
    case 'aiidxrebuildyes': {
      /* 删索引、清缓存、清问答都是「高级能力」这条线上的动作：按钮不渲染
         不等于动作不存在（C11），入口自己再判一次。 */
      if (!requireCap(indexCap())) break;
      /* 删完回到「还没建索引」的空态：建法是每次现选的，不替用户沿用上一次。
         缓存要一起清——只删文件不清缓存，侧栏还按「建好了」画。 */
      const src = getShellSource();
      const bookId = getState().overlay?.bookId || currentBook()?.id || '';
      if (!src || !bookId) break;
      void (async () => {
        const ok = await removePortrait(src.app, bookId);
        /* 删不掉就说一句并把层留着（C3）：以前无论成败都收层 + 清缓存，
           界面说「可以重建了」，磁盘上的旧索引其实还在。 */
        if (!ok) {
          notify(t('notice.portrait.removeFailed'), 'error');
          return;
        }
        forgetPortrait(bookId);
        /* 索引没了，挂在上面的问答依据也没了：留着那串答案只会让人以为还能追问 */
        resetAi();
        RT.aiIndexOpen = false;
        closeOverlay();
        repaint();
        notify(t('pt.rebuild.cleared'), 'info');
      })();
      break;
    }
    case 'aitutorial':
      /* 没装 bz 的人最需要它：从这儿知道索引是怎么建的。看的是讲索引
         的那期，不是关于条上的推荐向视频。 */
      window.open(AI_TUTORIAL_URL, '_blank', 'noopener,noreferrer');
      break;
    case 'ptpause':
      portraitBuilder().pause();
      break;
    case 'ptresume':
      if (!requireCap(indexCap())) break;
      void portraitBuilder().resume();
      break;
    case 'ptretry':
      if (!requireCap(indexCap())) break;
      void portraitBuilder().retryFailed();
      break;
    case 'ptclean':
      void cleanPortraits();
      break;
    case 'ptcleanyes': {
      const src = getShellSource();
      if (!src) break;
      const ids = RT.ptOrphans;
      RT.ptOrphans = [];
      void (async () => {
        let n = 0;
        for (const id of ids) {
          if (await removePortrait(src.app, id)) {
            forgetPortrait(id);
            n += 1;
          }
        }
        notify(t('pt.clean.done', { n }));
        closeOverlay();
        repaint();
      })();
      break;
    }
    case 'ackok': {
      /* 说明看完了：记住，并把刚才那条提问原样发出去。
         这一步就是「要问 AI」：授权在这期间掉了就开解锁层，别把 ack 记成
         已确认又白跑一次请求（C11）。 */
      if (!requireCap('ai')) break;
      const src = getShellSource();
      src?.setSettings({ aiAck: true });
      const pending = RT.ackPending;
      RT.ackPending = null;
      closeOverlay();
      if (pending) void askAi(null, pending.q);
      break;
    }

    /* ── 搜索 ── */
    case 'searchmode': {
      const next = d.v === 'semantic' ? 'semantic' : 'literal';
      if (next === getState().searchMode) break;
      /* 语义搜索是高级版能力：被拦时弹对照表并高亮「语义搜索」那一行 */
      if (next === 'semantic' && !requireCap('semantic')) break;
      const surface = currentSearchSurface();
      setState({ searchMode: next });
      if (next === 'semantic') {
        /* 切到按意思：字面正文扫描停掉（本地开销），语义结果从干净的一轮开始 */
        stopBodySearch();
        resetSemanticSearch();
        if (getState().searchKw.trim()) kickSemanticSearch(getState().searchKw, surface);
      } else {
        resetSemanticSearch();
        /* 切回字面：词与范围都还在，照原样重开一轮正文搜索 */
        kickBodySearch(getState().searchKw, getState().searchScope);
      }
      break;
    }
    case 'semrun':
      if (getState().searchMode !== 'semantic') break;
      if (!requireCap('semantic')) break;
      kickSemanticSearch(getState().searchKw, currentSearchSurface());
      break;
    case 'semhittotext': {
      /* 语义命中没有 CFI：打开那本书，再用这一段开头在书内搜一次定位。
         这段逻辑在插件侧（jumpIntoBook），这里只负责把书与片段交过去。 */
      const hit = RT.semantic.hits[Number(d.idx)];
      if (!hit) break;
      /* 归档书也能点开：画像还在，结果就不该是一条死行 */
      const book = allBooks().find((b) => b.id === (d.book || hit.bookId));
      if (!book || book.id !== hit.bookId) break;
      closeOverlay();
      getShellSource()?.jumpIntoBook(book, hit.chunk);
      break;
    }
    case 'searchscope': {
      // 本书搜索免费，跨书搜索属于高级版；切换时拦，不要在结果里悄悄少几本
      if (getState().searchMode === 'semantic') break;
      if (d.v === 'all' && !requireCap('crossSearch')) break;
      if (d.v !== 'book' && d.v !== 'all') break;
      /* 书架页没有当前书时，「本书」给一句明确提示，而不是静默空结果 */
      if (d.v === 'book' && !getState().bookId) {
        notify(t('notice.search.needBook'), 'info');
        break;
      }
      setState({ searchScope: d.v });
      kickBodySearch(getState().searchKw, d.v);
      repaint();
      break;
    }
    case 'searchstop':
      stopBodySearch();
      bumpOverlayRev();
      repaint();
      break;
    case 'searchmore': {
      /* 展开一组：只重画命中列表，搜索框与光标不动 */
      const kw = getState().searchKw.trim();
      const bookId = d.book || '';
      if (!kw || !bookId) break;
      const key = `${kw}\u0001${bookId}`;
      RT.body.more[key] = (RT.body.more[key] ?? 0) + HITS_PAGE;
      refreshBodyHits();
      break;
    }
    case 'searchclear':
      setState({ searchKw: '' });
      resetBodySearch();
      if (getState().searchMode === 'semantic') resetSemanticSearch();
      repaint();
      break;
    case 'hittotext': {
      /* 点一条正文命中：跳到那本书的那一页。`openBook` 带 cfi 时会走 `jumpTo`，
         书已经开着就直接定位，没开就开一个新的 tab。
         以前只按当前书找，全库搜索点别的书的结果会没反应。 */
      const cfi = d.cfi || '';
      const book = liveBooks().find((b) => b.id === (d.book || getState().bookId));
      if (!cfi || !book) break;
      closeOverlay();
      /* 带上搜索词：跳过去之后整页字里得能看见自己在找什么 */
      getShellSource()?.openBook(book, cfi, getState().searchKw);
      break;
    }

    /* ── 重置界面状态（不动书与笔记） ── */
    case 'resetui':
      resetUiState();
      closeOverlay();
      notify(t('notice.ui.reset'));
      break;

    /* ── AI 卡上的动作：切档 / 取消 / 复制 / 重试 / 存笔记 ── */
    case 'aimode': {
      const o = getState().overlay;
      const next = d.mode;
      if (!o || o.kind !== 'ai' || !next) break;
      const mode = aiModeOf(next);
      if (o.mode === mode) break;
      /* 换一档 = 换一个问题：旧请求在 runAiForOverlay 里会被掐掉，
         答案按 (kind|task|text) 分开记，切回来还是那一份。
         重画由派发方负责（overlayKey 含 mode，内容键一变就会重画） */
      RT.aiAbort?.abort();
      setState({ overlay: { ...o, mode } });
      break;
    }
    case 'aicopy': {
      const node = document.querySelector<HTMLElement>('[data-role="aibody"]');
      const answer = node?.textContent?.trim() || '';
      if (answer) void copyText(answer);
      break;
    }
    /* 重试：结果回填到卡里，不关卡——失败原因还留在上面 */
    case 'airetry': {
      const o = getState().overlay;
      if (!o) break;
      /* 问的是当前这一档，不是永远 explain：以前在翻译档点重试，回来的是一段解释 */
      const task: AiTask = aiModeOf(o.mode);
      const text = o.text || RT.sel?.text || '';
      /* 先把失败记号丢掉，再让统一的请求入口重新发一次（它会写册子） */
      aiCardDrop(aiCardKey(o.kind, task, text));
      void runAiForOverlay();
      break;
    }
    /* 追问：围绕卡上这段继续问（2026-11-10） */
    case 'aifollow': {
      const card = el.closest('.bzs-ai-card');
      const input = card?.querySelector<HTMLInputElement>('[data-role="aifollow"]');
      void followAi(input?.value ?? '');
      break;
    }
    /* 把答案存成这条划线的想法：只追加，不覆盖用户自己写的字 */
    case 'aitomark': {
      const o = getState().overlay;
      const book = currentBook();
      const node = document.querySelector<HTMLElement>('[data-role="aibody"]');
      const answer = node?.textContent?.trim() || '';
      if (!o?.markId || !book || !answer) {
        if (!o?.markId) notify(t('notice.ai.noMark'), 'info');
        break;
      }
      const h = findHighlight(book, o.markId);
      if (!h) {
        notify(t('notice.mark.gone'), 'info');
        break;
      }
      const next = appendAiIdea(h.comment, answer);
      /* 同一段答案再点一次：什么都不变，连提示都不弹 */
      if (next === (h.comment ?? '')) break;
      if (setHighlightComment(book, h.id, next)) {
        getShellSource()?.store.touch();
        emitNotesChanged();
        repaint();
        notify(t('notice.ai.savedMark'));
      }
      break;
    }
    /* 存为笔记：带任务、日期与出处引用，末尾留标记（2026-11-10 升级） */
    case 'aisave': {
      const node = document.querySelector<HTMLElement>('[data-role="aibody"]');
      const answer = node?.textContent?.trim() || '';
      const app = getShellSource()?.app;
      const book = currentBook();
      if (!answer || !app) break;
      const o = getState().overlay;
      const block = aiAnswerBlock({
        task: aiModeOf(o?.mode) as AiSaveTask,
        quote: o?.text || RT.sel?.text || '',
        answer,
        day: dayKey(Date.now()),
      });
      if (block) void appendToExport(app, book, block);
      break;
    }
    /* 存档这段对话（2026-11-11）：侧栏的多轮问答落成一篇笔记。
       与「存为笔记」不同——那是卡上一条答案，这里是整场对话，关掉侧栏
       之后还能回去看当时问过什么、依据是哪几章。 */
    case 'aisavelog': {
      if (!requireCap('aiChat')) break;
      const app = getShellSource()?.app;
      if (!app) break;
      if (!RT.aiLog.length) {
        notify(t('notice.ai.logEmpty'), 'info');
        break;
      }
      const book = currentBook();
      const block = aiConversationMarkdown({
        bookTitle: book?.meta.title,
        day: dayKey(Date.now()),
        turns: RT.aiLog.map((m) => ({ me: m.me, text: m.text, sources: m.sources })),
      });
      if (!block) break;
      void appendAiLog(app, book, block);
      break;
    }

    /* ── 书摘卡：存笔记 ──
       只存卡上这一条引文（A-10）。以前这里调 exportBookNotes 把整本书的
       划线重写进「书摘/书名.md」——点一次「存笔记」等于一次全量导出，
       用户在别处手改过的内容会被覆盖，也和卡片上看到的「这一条」对不上。 */
    case 'quotesave': {
      if (!requireCap('export')) break;
      const app = getShellSource()?.app;
      const book = currentBook();
      const overlayState = getState().overlay;
      const text = (overlayState?.text || RT.sel?.text || '').trim();
      if (!app || !text) {
        if (!text) notify(t('notice.quote.empty'), 'info');
        break;
      }
      const md = quoteRefMarkdown({
        text,
        title: book?.meta.title,
        author: book?.meta.author,
        chapter: overlayState?.chapterTitle || RT.sel?.chapterTitle,
      });
      void appendToExport(app, book, md);
      break;
    }

    /* 书摘卡转图片：canvas 手绘，直接写剪贴板。
       2026-11-10 下放基础版，不设门禁——两版出的是同一张图，都带
       bz reader 徽章。按钮与动作都不查授权，免得表里两栏打勾却弹付费窗。 */
    case 'quotecopyimg': {
      const text = getState().overlay?.text || RT.sel?.text || '';
      if (!text) break;
      const book = currentBook();
      void copyQuoteCardImage({
        text,
        title: book?.meta.title,
        author: book?.meta.author,
        chapter: getState().overlay?.chapterTitle || RT.sel?.chapterTitle,
        /* 出图跟着展示窗里选的那一版：四个模板预览各不相同，
           图片也必须各自成版，否则「换了模板复制出来还是第一张」。 */
        template: RT.cardTpl,
      })
        .then(() => notify(t('notice.card.copied')))
        .catch((e: Error) => notify(e.message || t('notice.card.copyFailed'), 'error'));
      break;
    }

    /* ── 写想法：关闭前的二次确认 ── */
    case 'ideakeep':
      cancelIdeaClose();
      break;
    case 'ideadiscard':
      closeOverlay();
      break;

    /* ── 其它 ── */
    case 'addbookmark': {
      const book = currentBook();
      if (book) newBookmarkHere(book);
      break;
    }
    case 'noop':
    default:
      break;
  }
}

/* ─────────── 导航与重置 ─────────── */

/**
 * 只清界面状态：书、进度、标注、AI 配置一律不动。
 *
 * 2026-11-04 补（A-23）：收藏 / 分组 / 目标在业务数据里各有一份真相。
 * 以前只把 `favIds` / `shelves` 清空、把 `goal` 写成 20——界面看起来「重置了」，
 * 但书里的 `favorite` / `shelf` 还在，重启 `hydrateLibrary()` 一灌就全回来；
 * 目标也只改了内存，下次启动又从业务数据读回旧值。
 *
 * 现在的顺序：
 *   1. 清掉旧版 localStorage 快照（只在 upgrade 时有用，保留原行为）；
 *   2. 把 20 写进业务数据（setGoal）；
 *   3. 界面状态静默重置，再从业务数据回灌收藏 / 分组 / 目标，
 *      由 hydrateLibrary 统一落盘 + 广播一次。
 */
export function resetUiState(): void {
  const keep = { bookId: getState().bookId };
  try {
    window.localStorage.removeItem('bzs-shell-v1');
  } catch {
    /* 存不下就算了 */
  }
  getShellSource()?.setGoal(20);
  setStateQuiet({
    studyPage: 'library',
    libView: 'grid',
    libFilter: 'all',
    libSort: 'recent',
    libShelf: '全部',
    libKw: '',
    noteFilter: 'all',
    noteKw: '',
    reviewIdx: 0,
    goal: 20,
    pen: DEFAULT_HIGHLIGHT_COLOR,
    sideTab: 'toc',
    bookId: keep.bookId,
  });
  /* favIds / shelves 不在这里清空：hydrateLibrary 会用书里的 favorite / shelf
     重建（书是真相，清界面不该连业务数据一起清）。 */
  hydrateLibrary(liveBooks(), getState().goal);
}

/* ─────────── 具体业务 ─────────── */

function toggleDone(id?: string): void {
  if (!id) return;
  const book = liveBooks().find((b) => b.id === id);
  const src = getShellSource();
  if (!book || !src) return;
  /* 读完与否只看 `completedTime`，**一行 percent 都不碰**（P2-06）。
     以前「标为读完」把 percent 写成 1、「取消读完」写成 0.95：一本只读了
     37% 的书被标读完再取消，打开就从 95% 处开始——用户会以为书被翻乱了。
     读到 99% 自动完成那条路在 reader-view.saveRelocate 里，它会写
     completedTime，所以这里只看它也是自洽的。 */
  if (book.reading.stats.completedTime) {
    book.reading.stats.completedTime = undefined;
    notify(t('notice.status.reading'));
  } else {
    book.reading.stats.completedTime = Date.now();
    notify(t('notice.status.done'));
  }
  book.updatedAt = Date.now();
  src.store.touch();
  repaint();
}

/**
 * 改排版偏好。
 *
 * `silent`（P1-09）：滑块拖动途中只写值、不重绘。以前 `input` 事件里直接
 * 调这个函数，结尾的 `repaint()` 会把整页 `<input type=range>` 重建掉——
 * 拖到一半手指还按着，拖动会话就断了，只能一格一格点。`change` / 松手时
 * 才补一次重绘。
 */
function setPref(k: string | undefined, v: string | undefined, opts: { silent?: boolean } = {}): void {
  const src = getShellSource();
  if (!src || !k || v === undefined) return;
  switch (k) {
    case 'fontSize':
      src.setPrefs({ fontSize: Number(v) });
      break;
    case 'lineHeight':
      src.setPrefs({ lineHeight: Number(v) });
      break;
    case 'margin':
      src.setPrefs({ margin: Number(v) });
      break;
    case 'ttsRate':
      src.setPrefs({ ttsRate: Number(v) });
      break;
    case 'ttsFollow':
      src.setPrefs({ ttsFollow: v !== '0' });
      break;
    case 'flow':
      src.setPrefs({ flow: v === 'scroll' ? 'scroll' : 'paged' });
      break;
    case 'pageLabel':
      /* 阅读页页码三档：关 / 本章 / 全书。窗口外的值回「关」——默认就是关，
         手改过的 data-v 不该把正文上多画一块东西 */
      src.setPrefs({ pageLabel: v === 'chapter' || v === 'book' ? v : 'off' });
      break;
    case 'pdfFlow':
      /* PDF 自己的翻页方式（2026-11-11）：和 EPUB 的 flow 分开，改它不牵动 EPUB */
      src.setPrefs({ pdfFlow: v === 'paged' ? 'paged' : 'scroll' });
      break;
    case 'pdfSpread':
      /* PDF 的单页 / 双页：和 EPUB 的栏数无关 */
      src.setPrefs({ pdfSpread: v === 'spread' });
      break;
    case 'fontFamily':
      src.setPrefs({ fontFamily: v as ReaderPrefs['fontFamily'] });
      break;
    case 'align':
      src.setPrefs({ align: v === 'left' ? 'left' : 'justify' });
      break;
    case 'layout':
      // 竖排是高级能力；但「改回横排」永远放行——不能把人锁在付费排版里
      if (v === 'vertical' && !requireCap('vertical')) break;
      src.setPrefs({ layout: v === 'vertical' ? 'vertical' : 'horizontal' });
      break;
    case 'columns':
      // 分栏已下放基础版（2026-11-05）：单栏/双栏随便选，不再要激活码
      src.setPrefs({ columns: v === '2' ? 2 : 1 });
      break;
    case 'footnote':
      // 浮窗预览已并入基础版（2026-11-03）：两种方式随便选，不再有门槛
      src.setPrefs({ footnote: v === 'jump' ? 'jump' : 'popup' });
      break;
    case 'accent':
      src.setPrefs({ accent: v as ReaderPrefs['accent'] });
      break;
    case 'toolbarStyle':
      /* 工具条文字 / 图标：跟库走的阅读偏好，改完立刻重绘（正开着的浮层也会换） */
      src.setPrefs({ toolbarStyle: v === 'icon' ? 'icon' : 'text' });
      break;
    case 'pdfAutoLink':
      /* PDF 划完词自动复制链接：默认关，用户自己开 */
      src.setPrefs({ pdfAutoLink: v !== '0' });
      break;
    case 'pdfLinkLabel':
      /* 链接别名四档：原文 / 页码 / 书名+页码 / 📖。窗口外的值一律回「原文」，
         别让一个手改过的 data-v 把别名变成空串 */
      src.setPrefs({
        pdfLinkLabel:
          v === 'page' || v === 'titlePage' || v === 'emoji' ? v : 'text',
      });
      break;
    case 'pdfZoom':
      /* 开书缩放四档：窗口外的值回「自动」，与 normalizePrefs 同一口径 */
      src.setPrefs({
        pdfZoom: v === 'width' || v === 'page' || v === 'actual' ? v : 'auto',
      });
      break;
    case 'pdfAnnots':
      /* 两个「画不画」的开关：改完 applyPrefs 会立刻重画已渲染的页 */
      src.setPrefs({ pdfAnnots: v !== '0' });
      break;
    case 'pdfBacklinks':
      src.setPrefs({ pdfBacklinks: v !== '0' });
      break;
    case 'pdfExportScale':
      /* 导出倍率 1~3：手写 data-v 也不该让渲染出一张几十 MB 的图 */
      src.setPrefs({ pdfExportScale: Math.min(3, Math.max(1, Number(v) || 2)) });
      break;
    default:
      break;
  }
  if (!opts.silent) repaint();
}

function findBookOfMark(markId?: string, bookId?: string): ReaderBook | undefined {
  if (!markId) return undefined;
  if (bookId) return liveBooks().find((b) => b.id === bookId);
  return liveBooks().find((b) => (b.notes?.highlights ?? []).some((h) => h.id === markId));
}

/**
 * 书签属于哪本书：优先 `data-book`，没有就按 id 全库找。
 *
 * 不给 bookId 又不全库找的话，侧栏那枚 × 只能删「当前打开的书」——
 * 用户在两个 tab 之间切过之后，删的就是另一本里同名（id 相同）的那枚。
 */
function bookOfBookmark(bookmarkId?: string, bookId?: string): ReaderBook | undefined {
  if (!bookmarkId) return undefined;
  const books = liveBooks();
  if (bookId) {
    const hit = books.find((b) => b.id === bookId);
    return hit?.notes?.bookmarks?.some((k) => k.id === bookmarkId) ? hit : undefined;
  }
  return books.find((b) => (b.notes?.bookmarks ?? []).some((k) => k.id === bookmarkId));
}

/** 删一条划线；成功返回 true（调用方据此决定收不收确认卡） */
function deleteMark(markId?: string, bookId?: string): boolean {
  const book = findBookOfMark(markId, bookId);
  /* 找不到就给一句人话（P3-27）：侧栏里那条标注已经被删掉/被同步覆盖时，
     点「删除」以前是什么都不发生，用户会以为按钮坏了。 */
  if (!book || !markId) {
    notify(t('notice.mark.gone'), 'info');
    return false;
  }
  if (!removeHighlight(book, markId)) {
    notify(t('notice.mark.gone'), 'info');
    return false;
  }
  getShellSource()?.store.touch();
  repaint();
  emitNotesChanged();
  notify(t('notice.mark.deleted'));
  return true;
}

/**
 * 批量删除选中的标注（标注多选）。
 *
 * 按书分组一次删完：逐条调 `removeHighlight` 会在 500 条时做 500 次
 * splice，还要 500 次重绘。删完退出选择模式——用户已经处理完这批了。
 */
function dropSelectedMarks(): void {
  const sel = new Set(getState().noteSel);
  if (!sel.size) {
    closeOverlay();
    return;
  }
  let removed = 0;
  for (const b of liveBooks()) removed += removeHighlights(b, sel);
  if (removed > 0) getShellSource()?.store.touch();
  closeOverlay();
  mutateState((s) => {
    s.noteSelect = false;
    s.noteSel = [];
  });
  emitNotesChanged();
  notify(removed > 0 ? t('notice.mark.deletedN', { n: removed }) : t('notice.mark.goneAll'), 'info');
}

function changeMarkColor(markId?: string, color?: string, bookId?: string): void {
  const book = findBookOfMark(markId, bookId);
  if (!book || !markId || !color || !isHighlightColor(color)) return;
  if (setHighlightColor(book, markId, color)) {
    getShellSource()?.store.touch();
    repaint();
    emitNotesChanged();
    notify(t('notice.mark.recolored', { color: colorLabel(color) }));
  }
}

/** 跳到一条划线；返回是否真的发出去了（侧栏据此决定收不收抽屉） */
function jumpToMark(markId?: string, bookId?: string): boolean {
  const book = findBookOfMark(markId, bookId);
  const h = book?.notes?.highlights.find((x) => x.id === markId);
  if (!book || !h) {
    notify(t('notice.mark.gone'), 'info');
    return false;
  }
  closeOverlay();
  setState({ bookId: book.id });
  getShellSource()?.openBook(book, h.cfiRange);
  return true;
}

/** jumpmark 的 id 是标注 id，不是书签 id */
function jumpMark(markId?: string, bookId?: string): boolean {
  return jumpToMark(markId, bookId);
}

function quoteFromMark(markId?: string, bookId?: string): void {
  const book = findBookOfMark(markId, bookId);
  const h = book?.notes?.highlights.find((x) => x.id === markId);
  if (!book || !h) {
    notify(t('notice.mark.gone'), 'info');
    return;
  }
  overlay('quote', {
    text: h.text,
    bookId: book.id,
    chapterTitle: h.chapterTitle,
    markId: h.id,
    /* 从工具条点进来时工具条正贴着那条划线：锚点沿用，书摘卡才不会掉到屏幕角。
       划词那条路径靠自己传 RT.sel.anchor，两条入口都得带。 */
    anchor: getState().overlay?.anchor,
  });
}

function saveIdea(markId?: string, bookId?: string): void {
  const book = findBookOfMark(markId, bookId);
  if (!book || !markId) return;
  const ta = document.querySelector<HTMLTextAreaElement>('[data-role="idea"]');
  const text = ta?.value.trim() ?? '';
  if (setHighlightComment(book, markId, text)) {
    getShellSource()?.store.touch();
    /* force：用户已经点了发送键，这一条就是他要的结果，不该再问「要丢弃吗」 */
    closeOverlay({ force: true });
    repaint();
    emitNotesChanged();
    notify(text ? t('notice.idea.saved') : t('notice.idea.cleared'));
  }
}

/* ─────────── 侧栏 AI 页签：问这本书 ─────────── */

/**
 * 取证阶段的预算（毫秒）。
 *
 * 建索引 / 算查询向量 / 检索笔记都可能卡在远端：没有上限时，一次提问
 * 可以一直转圈，用户既看不出在等什么，也没有取消的地方。
 */
const EVIDENCE_TIMEOUT_MS = 20_000;

/**
 * 这本书自己的依据：从全书画像里取最相关的几块。
 *
 * 画像的三种状态（没建 / 建到一半 / 换了嵌入模型）在 askAi 里已经拦过，
 * 走到这里还取不到内容只剩一种可能：这本书里确实没有和问题相关的段落。
 */
async function bookEvidenceOf(
  q: string,
  app: App | null | undefined,
  book: ReaderBook,
  signal?: AbortSignal,
): Promise<AiEvidence | null> {
  const portrait = await readPortrait(app, book.id);
  const embedder = bzEmbedder(app);
  if (!portrait || portraitState(portrait, embedder.model) !== 'ready') return null;

  if (portrait.plan === 'vector') {
    /* 问题也要算成向量，而且必须用 bz 的模型算：书的向量就是它算的，
       换个模型算查询向量，距离再近也没有意义。 */
    if (!embedder.ai) throw new Error(embedder.problem || t('side.ai.embedNotReady'));
    const vec = await embedder.ai.embedQuery(q, signal);
    const picks = topBlocksByVector(portrait, vec, PORTRAIT_TOP_K);
    if (!picks.length) return null;
    return {
      context: blocksEvidence(portrait, picks),
      sources: sourcesOfBlocks(
        portrait.bookId,
        picks.map((p) => ({ chapter: p.block.chapter, index: p.index })),
      ),
    };
  }

  /* 压缩方案不用发任何请求：依据就是建画像时存下的要点 */
  const context = compressEvidence(portrait);
  if (!context.trim()) return null;
  return {
    context,
    sources: chapterDigests(portrait)
      .slice(0, 5)
      .map((d) => ({ title: d.chapter, bookId: portrait.bookId, note: d.line })),
  };
}

/**
 * 共享：bz 知识库的笔记（可选的一层补充）。
 *
 * 自动识别（2026-11-07 起没有开关）：bz 不在、索引没建好、检索报错——一律
 * 返回 null，**不拦这次提问**。笔记是补充，书才是本体；因为补充没取到就
 * 不让人问书，是本末倒置。
 */
async function sharedEvidenceOf(
  q: string,
  app: App | null | undefined,
  signal?: AbortSignal,
): Promise<AiEvidence | null> {
  if (!can('ai') || !bzNotesReady(app)) return null;
  const probe = probeBz(app);
  if (!probe.ai) return null;
  try {
    /* 门面没有 signal 参数：用 withSignal 包一层，掐断时不再等它（C5） */
    const hits = await withSignal(probe.ai.searchNotes(q, AI_SOURCES_MAX), signal);
    if (!hits.length) return null;
    const context = hitsToContext(hits, Math.floor(AI_CONTEXT_LIMIT / 2));
    return context ? { context, sources: sourcesOfHits(hits) } : null;
  } catch {
    /* 检索挂了不该把「书也问不了」一起拖下水；用户要的是答案，不是两条报错 */
    return null;
  }
}

/**
 * 问这本书。
 *
 * 与划线的 AI 解释是两条链路：这里带全书检索到的依据、带最近几轮问答，
 * 走 ask 任务。原来复用 explain 的 prompt 且不传依据，问「讲了什么」
 * 会被当成一段要解释的名词。
 *
 * 2026-11-07 改：不再有「当前这一屏 / 知识库 / 全书」三档。每次提问都以
 * 全书为依据（向量检索最相关的几块，或压缩方案的全书要点），共享开关
 * 打开时再把笔记并进来。第一次用之前必须先建画像——没建就先把准备页
 * 弹出来，建完原样重发这一句。
 */
async function askAi(el: HTMLElement | null, preset?: string): Promise<void> {
  const scopeEl = el?.closest('.bzs-aiask, .bzs-aichat') ?? null;
  const input = scopeEl?.querySelector<HTMLInputElement>('[data-role="aiask"]') ?? null;
  const q = (preset ?? input?.value ?? '').trim();
  if (!q) return;
  const src = getShellSource();
  if (!src) return;
  const settings = shellSettings();
  const book = currentBook();
  if (!book) {
    notify(t('notice.needBook'), 'info');
    return;
  }
  /* 这一问归属哪本书（C4）：整条链路要跑好几步，中途完全可能换书 */
  const bookId = book.id;
  RT.aiBookId = bookId;
  const sameBook = (): boolean => RT.aiBookId === bookId;

  /* 第一次用：先说清楚会把什么发出去。确认之后原样重发这条提问 */
  if (!settings.aiAck) {
    RT.ackPending = { q };
    RT.aiDraft = q;
    if (input) input.value = q;
    openOverlay({ kind: 'ack' });
    return;
  }

  /* 依据还没建：把侧栏切到「选建法」那一块，问题留在输入框里。
     这里不弹窗（2026-11-07 定稿）：建索引的位置就是侧栏 AI 页签，
     弹窗只是把同一件事又说一遍。 */
  const portrait = await readPortrait(src.app, book.id);
  if (!sameBook()) return;
  if (portraitState(portrait, bzEmbedder(src.app).model) !== 'ready') {
    /* 草稿要落在 RT 里：下面这次 repaint 会把输入框整个换掉，只写 element
       的 value 等于没写。 */
    RT.aiDraft = q;
    if (input) input.value = q;
    RT.aiIndexOpen = true;
    notify(t('side.ai.book.none'), 'info');
    repaint();
    return;
  }

  /* 先把自己这条提问放进日志（界面立刻有反馈），再取历史时要把它排除——
     buildMessages 会把 text 作为最后一条 user 追加。 */
  const history = RT.aiLog.map((m) => ({ role: m.me ? ('user' as const) : ('assistant' as const), content: m.text }));
  pushAi(true, '我', q);
  RT.aiDraft = '';
  if (input) input.value = '';
  repaint();

  /* 取证阶段自己带预算（C5）：向量检索 / 笔记检索不归 aiAsk 的超时管，
     服务端不吐字时界面会一直转圈。20 秒一到就掐；后面那次对话共用同一个
     signal，换书时由 setState 掐它。 */
  const ctrl = new AbortController();
  let timedOut = false;
  RT.askAbort = ctrl;
  const timer = window.setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, EVIDENCE_TIMEOUT_MS);

  let evidence: AiEvidence | null = null;
  try {
    evidence = mergeEvidence(
      await bookEvidenceOf(q, src.app, book, ctrl.signal),
      await sharedEvidenceOf(q, src.app, ctrl.signal),
    );
  } catch (e) {
    /* 取证就失败了：这一问到此为止，别把 controller 留在 RT 里装成「还在跑」 */
    if (RT.askAbort === ctrl) RT.askAbort = null;
    if (!sameBook()) return;
    const why = timedOut
      ? t('notice.ai.evidenceTimeout')
      : t('notice.kb.failed', { message: (e as Error)?.message || t('common.unknownError') });
    pushAi(false, 'AI', why, []);
    repaint();
    return;
  } finally {
    window.clearTimeout(timer);
  }
  if (!sameBook()) return;
  if (!evidence) {
    if (RT.askAbort === ctrl) RT.askAbort = null;
    pushAi(false, 'AI', t('side.ai.book.noHit'), []);
    repaint();
    return;
  }

  try {
    const res = await aiAsk(
      settings,
      {
        task: 'ask',
        text: q,
        title: book.meta.title,
        chapter: book.reading.position.chapterTitle,
        context: evidence.context,
        history,
      },
      { signal: ctrl.signal },
    );
    /* 答案回来时已经换书：这份答案不属于当前这本，丢掉（C4） */
    if (!sameBook()) return;
    pushAi(false, `AI · ${settings.ai.model || '模型'}`, res.text, evidence.sources);
  } catch (e) {
    if (!sameBook()) return;
    pushAi(false, 'AI', (e as Error).message || '请求失败');
  } finally {
    if (RT.askAbort === ctrl) RT.askAbort = null;
  }
  repaint();
}

/* ─────────── 划词卡的追问（2026-11-10） ─────────── */

/**
 * 一次只跑一条追问。
 *
 * 2026-11-11：原来这里是「正在追问的那句话」，渲染时靠它画占位；现在那一行
 * 已经在账本的轮次里（`pending`），这个变量只负责防重入——连点两下不该扣
 * 两次费。
 */
let aiFollowBusy = false;

/** 追问的轮次区滚到底：新的一行不该出现在可视区之外 */
function scrollAiCardToEnd(): void {
  const box = document.querySelector<HTMLElement>('.bzs-ai-card .ai-scroll');
  if (box) box.scrollTop = box.scrollHeight;
}

/** 从账本把卡上的正文与轮次重画一遍，并补上 Markdown 渲染 */
function refreshAiCard(): void {
  const o = getState().overlay;
  if (!o || o.kind !== 'ai') return;
  const text = o.text || RT.sel?.text || '';
  const key = aiCardKey('ai', aiModeOf(o.mode), text);
  const entry = aiCardGet(key);
  const body = document.querySelector<HTMLElement>('[data-role="aibody"]');
  if (body && entry?.text) {
    body.textContent = entry.text;
    /* 刚写过纯文本：标记清掉，交给 renderAiMarkdown 重新渲染 */
    delete body.dataset.aiRendered;
  }
  const turns = document.querySelector<HTMLElement>('[data-role="aiturns"]');
  if (turns) setHtml(turns, aiTurnsHtml(entry?.turns));
  const card = document.querySelector<HTMLElement>('.bzs-ai-card');
  renderAiMarkdown(card);
  scrollAiCardToEnd();
}

/**
 * 追问：围绕卡上那段原文继续问。
 *
 * 不带全书依据，也不带侧栏的问答记录——这是「问这一小段」的第二问，
 * 与「问整本书」是两条链路（上下文、花费、追问方式都不同）。
 */
async function followAi(question: string): Promise<void> {
  const q = String(question ?? '').trim();
  if (!q) return;
  const o = getState().overlay;
  if (!o || o.kind !== 'ai') return;
  const s = shellSettings();
  if (!aiReady(s)) return;
  const text = o.text || RT.sel?.text || '';
  const key = aiCardKey('ai', aiModeOf(o.mode), text);
  const entry = aiCardGet(key);
  /* 初次还没答完（或者还没发出去）：没有可追问的答案，不发 */
  if (!entry || !entry.text) return;
  /* 一次只跑一条追问：连点两下不该扣两次费 */
  if (aiFollowBusy) return;

  aiFollowBusy = true;
  /* 发出即回声：这一问立刻进轮次（带 pending），卡片上马上出现
     「你：…」和「正在回复…」，不用等模型 */
  aiCardFollowBegin(key, q);
  /* 输入框当场清空：这句已经进轮次了，留在框里会像没发出去 */
  const box = document.querySelector<HTMLInputElement>('[data-role="aifollow"]');
  if (box) box.value = '';
  refreshAiCard();
  const ctrl = new AbortController();
  RT.aiAbort = ctrl;
  try {
    const res = await aiAsk(
      s,
      { task: 'follow', text: q, context: text, history: followHistory(entry.text, entry.turns) },
      { signal: ctrl.signal },
    );
    aiCardFollowDone(key, q, res.text);
  } catch (e) {
    /* 被掐掉（换档 / 关卡）不留假结果；真失败把原因写进这一轮 */
    if (!ctrl.signal.aborted) aiCardFollowFail(key, q, (e as Error)?.message || t('common.unknownError'));
  } finally {
    if (RT.aiAbort === ctrl) RT.aiAbort = null;
    aiFollowBusy = false;
    refreshAiCard();
  }
}

/* ─────────── 输入与快捷键 ─────────── */

export function dispatchInput(
  target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  ev?: Event,
): void {
  /* 中文输入法：拼音还没上屏就把 DOM 重建掉，候选框消失、刚打的字丢了（P1-10）。
     `core/ui/modal.ts` 早就判了 isComposing，壳层这一层一直没判。
     `compositionend` 之后浏览器会再补一次 input，那条会正常走到下面。 */
  if ((ev as InputEvent | undefined)?.isComposing) return;
  const role = target.dataset.role;
  const k = target.dataset.k;
  const value = target.value;
  /**
   * 拖动中（input）只写值、不重绘；松手（change）才收口（P1-09）。
   *
   * 以前拖字号滑块，拖到一半 `<input type=range>` 被整页重建换掉，
   * 拖动会话直接中断，只能一格一格点。
   */
  const dragging = ev?.type === 'input';

  if (role === 'libkw') {
    mutateState((s) => {
      s.libKw = value;
    });
    /* 焦点由 ShelfPanel 的 focusMemo 按 role+k 还回去（含光标位置）；这里再
       调一次 restoreFocus 会把光标推到行尾，在中间插字就跳走。 */
    return;
  }
  if (role === 'notekw') {
    mutateState((s) => {
      s.noteKw = value;
    });
    return;
  }
  if (role === 'libsort') {
    setState({ libSort: value as never });
    return;
  }
  if (role === 'pref' && k) {
    setPref(k, value, { silent: dragging });
    /* 滑块的数值标签就地更新，避免整页重绘时手指还在拖。
       往上找整行再取 `.val`：滑块外面包了一层手势层（shell/range-touch.ts），
       `parentElement` 已经不是放数值的那一格了。 */
    const label = target.closest('.bzs-setrow')?.querySelector('.val');
    if (label) label.textContent = labelFor(k, value);
    // 铜金填充跟着走（纯 CSS 画不出「填充到当前值」）
    const min = Number(target.getAttribute('min') ?? 0);
    const max = Number(target.getAttribute('max') ?? 100);
    const now = Number(value);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min && Number.isFinite(now)) {
      target.style.setProperty('--fill', rangeFill(min, max, now));
    }
    return;
  }
  if (role === 'setting' && k) {
    const src = getShellSource();
    if (!src) return;
    /* 输入期间（input）一个字节都不落盘：以前每敲一个字就 setSettings，
       移动端软键盘会在同步 IO 的间隙收起，表现成「打一个字就失焦」。
       松手（change）或输入法上屏（compositionend）才收口。 */
    if (dragging) return;
    /* 目录类设置已经没有输入框了（只走文件夹选择器），这里只剩 AI 三个字段 */
    if (k === 'ai.baseUrl' || k === 'ai.model' || k === 'ai.apiKey') {
      src.setSettings({ ai: { ...shellSettings().ai, [k.slice(3)]: value } });
    }
    return;
  }
  if (role === 'goal') {
    setGoal(Math.max(1, Number(value) || 1), { silent: dragging });
    const label = document.getElementById('bzs-goalval');
    if (label) label.textContent = t('stats.goal.value', { n: value });
    return;
  }
  if (role === 'searchkw') {
    setState({ searchKw: value });
    return;
  }
  /* 输入框的字只留在内存里：任何一次重绘（进度广播、切页签）都不该
     把用户打了一半的问题抹掉。不广播，省得每次按键都重绘。 */
  if (role === 'aiask') {
    RT.aiDraft = value;
    return;
  }
}

export function labelFor(k: string, v: string): string {
  const n = Number(v);
  switch (k) {
    case 'fontSize':
      return `${n}px`;
    case 'lineHeight':
      return n.toFixed(1);
    case 'margin':
      return `${n}px`;
    case 'ttsRate':
      return `${n.toFixed(1)}×`;
    default:
      return v;
  }
}

/** 弹层里换笔色的默认值：书摘卡上的「四支笔」用得到 */
export function penCssOf(name: string): string {
  return colorCss(name);
}
