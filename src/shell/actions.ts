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
import { aiAsk } from '../data/ai';
import {
  DEFAULT_HIGHLIGHT_COLOR,
  addHighlight,
  colorCss,
  isHighlightColor,
  removeBookmark,
  removeHighlight,
  removeHighlights,
  setHighlightColor,
  setHighlightComment,
  toggleBookmark,
} from '../data/notes';
import { allMarks, filterMarks } from './domain';
import { toggleAll, togglePick } from './note-select';
import { notify } from '../core/notice';
import { bookMenuItems } from './book-menu';
import { flipSetting, type ToggleState } from './settings-toggle';
import { rangeFill } from './range-fill';
import { openHotkeySettings } from '../core/hotkeys';
import { folderLabel, pickFolder } from '../core/folder-pick';
import { CAP_LABEL, PURCHASE_URL, can, type Cap } from '../data/entitlement';
import { HEADER_ACTION_IDS } from '../view/header-actions';
import { normalizeDataDir } from '../core/plugin-path';
import { linkInline, linkOfMark, linkOfText, linkQuote, rawUrl, targetOfMark } from '../data/deeplink';
import { exportBookNotes } from '../data/export';
import { jumpTo, getToc } from '../view/toc-state';
import { LIB_FILTERS } from './render/study';
import { copyQuoteCardImage } from './card-image';
import { quoteRefMarkdown } from './render/quote-card';
import type { OverlayKind, StudyPage } from './state';
import {
  bumpOverlayRev,
  cancelIdeaClose,
  closeOverlay,
  getState,
  hydrateLibrary,
  mutateState,
  openOverlay,
  setGoal,
  setState,
  setStateQuiet,
  toggleFav,
} from './state';
import { RT, emitNotesChanged, pushAi } from './runtime';
import { getShellSource, liveBooks, shellPrefs, shellSettings } from './source';
import { DEFAULT_SETTINGS } from '../data/settings';
import { copyGroupIdForTrial } from './group';

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
  setState({ bookId: id });
  src.openBook(book, cfi);
}

/** 统一的重绘出口：所有视图都订阅 state，改完自然会重画 */
function repaint(): void {
  mutateState(() => undefined);
}

function overlay(kind: OverlayKind, extra: Record<string, unknown> = {}): void {
  openOverlay({ kind, ...extra });
}

/**
 * 追加一段进导出目录里这本书的笔记（书摘「存笔记」与 AI「存为笔记」共用）。
 *
 * 不覆盖已有内容：同一本书可以连着存好几段，路径与导出功能一致
 * （设置里的导出目录 + 书名），用户之后手动整理也在同一处。
 */
async function appendToExport(app: App, book: ReaderBook | undefined, block: string): Promise<void> {
  const fallback = DEFAULT_SETTINGS.exportDir;
  const dir = (shellSettings().exportDir || fallback).replace(/^\/+|\/+$/g, '') || fallback;
  const name = book?.meta.title || '零散片段';
  const path = `${dir}/${name}.md`;
  try {
    if (!(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir);
    const head = (await app.vault.adapter.exists(path)) ? await app.vault.adapter.read(path) : `# ${name}\n`;
    await app.vault.adapter.write(path, `${head.trimEnd()}\n\n${block}\n`);
    notify(`已存进 ${path}`);
  } catch (e) {
    notify(`存笔记失败：${(e as Error).message}`);
  }
}

/* ─────────── 书签 / 标注 ─────────── */

function newBookmarkHere(book: ReaderBook): void {
  const src = getShellSource();
  if (!src) return;
  const percent = book.reading.position.percent || 0;
  const cfi = book.reading.position.cfi || '';
  if (!cfi) {
    notify('这一页还没有定位信息，翻一页再试', 'info');
    return;
  }
  const existing = (book.notes?.bookmarks ?? []).find((k) => k.cfi === cfi);
  if (existing) {
    notify('这一页已经有一枚书签了', 'info');
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
  notify('已记一枚书签');
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
  if (!opts.silent) notify(`已用${isHighlightColor(color) ? colorLabel(color) : '默认'}色划线`);
  return h.id;
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
  notify(`换成${colorLabel(color)}`,'info');
  return true;
}

function colorLabel(v: string): string {
  const map: Record<string, string> = { amber: '琥珀', vermilion: '朱红', green: '松绿', blue: '黛蓝' };
  return map[v] || '默认';
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
  openOverlay({ kind: 'unlock', mode: cap, text: CAP_LABEL[cap] });
  return false;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify('已复制到剪贴板');
  } catch {
    notify('复制失败，请用系统快捷键', 'error');
  }
}

function exportMarkdown(bookId?: string): string {
  const src = getShellSource();
  if (!src) return '（还没有可导出的数据）';
  const settings = shellSettings();
  const books = bookId ? liveBooks().filter((b) => b.id === bookId) : liveBooks();
  const parts = books
    .filter((b) => (b.notes?.highlights ?? []).length)
    .map((b) => buildMdFor(b, settings.exportComments));
  return parts.join('\n\n---\n\n') || '（还没有划线。去阅读页选中一段文字试试。）';
}

/** 轻量预览版：与 data/export.ts 的落盘版同一结构，但不写文件 */
function buildMdFor(book: ReaderBook, withComments: boolean): string {
  const lines: string[] = [`# ${book.meta.title || '未命名'} · 摘录`, ''];
  if (book.meta.author) lines.push(`> ${book.meta.author}`, '');
  const groups = new Map<string, typeof book.notes.highlights>();
  for (const h of [...book.notes.highlights].sort((a, b) => (a.chapterIndex ?? 0) - (b.chapterIndex ?? 0))) {
    const key = h.chapterTitle?.trim() || '未命名章节';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(h);
  }
  for (const [chapter, items] of groups) {
    lines.push(`## ${chapter}`, '');
    for (const h of items) {
      lines.push(`> ${h.text.replace(/\s*\n\s*/g, ' ')}`, '');
      if (withComments && h.comment?.trim()) lines.push(`**想法**：${h.comment.trim()}`, '');
      if (h.cfiRange) lines.push(`— [在原文中查看](${rawUrl(book, h)})`, '');
    }
  }
  return lines.join('\n');
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
         这里只把页码递过去——四个入口（页签、图标、命令、协议）共用一套。 */
      const page = (d.p as StudyPage) || 'library';
      getShellSource()?.openStudy(page);
      break;
    }
    case 'studyback':
      getShellSource()?.openStudy(getState().studyBack);
      break;
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
      /* AI 页签入口平权：基础版也看得见，点了弹高级版对照页，不切过去。
         以前整枚页签都不渲染，用户连「有 AI」都不知道。 */
      if (d.tab === 'ai' && !requireCap('ai')) break;
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
    case 'poster':
      if (!requireCap('card')) break;
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
        missing: !!(book.fileRef as { fileMissing?: boolean }).fileMissing,
      });
      const menu = new Menu();
      for (const it of items) {
        if (it.sepBefore) menu.addSeparator();
        menu.addItem((i) => {
          i.setTitle(it.title).setIcon(it.icon);
          /* 文件丢了就禁用「阅读」，其余照旧：书还在，用户要知道点不动的原因 */
          if (it.disabled) i.setDisabled(true);
          if (it.act === 'open') i.onClick(() => openBookById(id));
          if (it.act === 'detail') i.onClick(() => overlay('detail', { bookId: id }));
          if (it.act === 'fav')
            i.onClick(() => {
              const on = toggleFav(id);
              notify(on ? '已收藏' : '已取消收藏');
              rerender();
            });
          if (it.act === 'done') i.onClick(() => toggleDone(id));
          if (it.act === 'rename') i.onClick(() => overlay('rename', { bookId: id }));
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
        notify('书名不能为空', 'error');
        break;
      }
      book.meta.title = next;
      /* 打过这个标记，打开书时引擎不再用文件里的书名覆盖（data/book-meta.ts） */
      book.meta.titleEdited = true;
      book.updatedAt = Date.now();
      getShellSource()?.store.touch();
      closeOverlay();
      rerender();
      notify('书名已改');
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
      src.repo.remove(id);
      src.store.touch();
      if (getState().bookId === id) setState({ bookId: null });
      closeOverlay();
      rerender();
      notify(`已从书架移除《${book.meta.title || '未命名'}》`);
      break;
    }
    case 'openbook':
      // 书籍详情是个弹层：点了「开始阅读」就该把它收掉，
      // 否则书在底下打开、详情盖在上面，看着像没反应
      closeOverlay();
      if (d.id) openBookById(d.id);
      break;
    case 'fav':
      if (d.id) {
        const on = toggleFav(d.id);
        notify(on ? '已收藏' : '已取消收藏');
      }
      break;
    case 'done':
      toggleDone(d.id);
      break;
    case 'libfilter':
      if (d.v) setState({ libFilter: d.v as never });
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
      for (const [value, label] of LIB_FILTERS) {
        menu.addItem((item) =>
          item
            .setTitle(label)
            .setChecked(getState().libFilter === value)
            .onClick(() => setState({ libFilter: value })),
        );
      }
      menu.showAtPosition({ x: box.left, y: box.bottom + 4 });
      break;
    }
    case 'libsortmenu': {
      /* 排序原来是一个原生 <select>：展开是系统的白底蓝条，和旁边的纸色
         chip 完全两套长相。改成一颗 chip + 宿主自己的菜单——跟主题走，
         手机上还是原生的底部动作面板。 */
      const box = el.getBoundingClientRect();
      const menu = new Menu();
      const opts = [
        ['recent', '最近阅读'],
        ['title', '书名'],
        ['progress', '进度'],
      ] as const;
      for (const [value, label] of opts) {
        menu.addItem((item) =>
          item
            .setTitle(label)
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
    case 'detailjump': {
      const bookId = d.id;
      if (bookId) {
        closeOverlay();
        setState({ bookId });
        getShellSource()?.openBook(liveBooks().find((b) => b.id === bookId) as ReaderBook);
      }
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
        notify('先选几条要删的', 'info');
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
      notify(stars ? `已记下 ${stars} 星` : '已记下');
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
      const book = id ? liveBooks().find((b) => b.id === id) : undefined;
      if (!book) {
        notify('先打开一本书，或在笔记页对某本书点导出');
        break;
      }
      void (async () => {
        const src = getShellSource();
        if (!src) return;
        try {
          const res = await exportBookNotes(src.app, book, shellSettings());
          if (!res) {
            notify('这本书还没有划线或书签，导不出东西');
            return;
          }
          closeOverlay();
          notify(`已导出 ${res.highlights} 条划线到 ${res.path}`);
        } catch (e) {
          notify(`导出失败：${(e as Error)?.message || '写文件出错'}`, 'error');
        }
      })();
      break;
    }
    case 'copytext':
      if (d.text) void copyText(d.text);
      break;

    /* 位置链接：单条复制免费——一次只能拿一条不构成「搬家」，
       但每粘进笔记一次，都是一次广告。 */
    case 'copylink': {
      // 原文链接是高级能力：基础版点它给对照表，不悄悄降级成另一段文字
      if (!requireCap('bilink')) break;
      const b = liveBooks().find((x) => x.id === (d.book || getState().bookId));
      const h = b?.notes?.highlights?.find((x) => x.id === d.id);
      if (!b || !h) {
        notify('没找到这条划线', 'error');
        break;
      }
      void copyText(linkOfMark(b, h));
      break;
    }
    case 'copylinkurl': {
      const b = liveBooks().find((x) => x.id === (d.book || getState().bookId));
      const h = b?.notes?.highlights?.find((x) => x.id === d.id);
      if (!b || !h) {
        notify('没找到这条划线', 'error');
        break;
      }
      void copyText(linkInline(b, targetOfMark(b, h)));
      break;
    }

    /* ── 授权 ── */
    case 'unlock':
      overlay('unlock', { mode: d.mode || '' });
      break;
    case 'buy':
      window.open(PURCHASE_URL, '_blank');
      break;
    case 'jointrial':
      /* 灰测：只复制群号，7 天试用码由群管理员人工发 */
      void copyGroupIdForTrial();
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
          notify('导出目录不能是库根目录，请选一个文件夹', 'error');
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
          notify('数据目录不能是库根目录，请选一个文件夹', 'error');
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
      notify('正在迁移…');
      void (async () => {
        const res = await src.migrateDir(kind, from, to);
        notify(res.message, res.ok ? 'info' : 'error');
        if (res.ok) {
          if (kind === 'data') RT.dataDirDraft = '';
          closeOverlay();
        }
        rerender();
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
      const src = getShellSource();
      if (!src) break;
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
      /* 图标排序：跟相邻一位交换。顺序一旦动过就整份落盘，不再回退默认 */
      const src = getShellSource();
      if (!src) break;
      const id = d.k || '';
      const dir = Number(d.v) || 0;
      const p = shellPrefs();
      const base: string[] = p.headerOrder.length ? p.headerOrder : HEADER_ACTION_IDS.slice();
      const i = base.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= base.length) break;
      const next = base.slice();
      [next[i], next[j]] = [next[j], next[i]];
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

    /* ── 侧栏：目录 / 书签 / 划线 ── */
    case 'jumpch': {
      if (d.href) {
        closeOverlay();
        jumpTo(d.href);
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
        jumpTo(hit.href);
      } else {
        notify('这一章在目录里找不到，可能书换了版本', 'info');
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
      const book = currentBook();
      if (book && d.id) {
        removeBookmark(book, d.id);
        getShellSource()?.store.touch();
        repaint();
      }
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
      deleteMark(d.id, d.book);
      closeOverlay();
      break;

    /* ── 标注弹层内的动作 ── */
    case 'hlcolor':
      changeMarkColor(d.id, d.v, d.book);
      break;
    case 'hljump':
      jumpToMark(d.id, d.book);
      break;
    case 'hlidea':
      // 浮窗要贴着原来那条划线展开，锚点沿用标注卡的位置
      overlay('idea', { markId: d.id, bookId: d.book || getState().bookId || '', anchor: getState().overlay?.anchor });
      break;
    case 'hlquote':
      quoteFromMark(d.id, d.book);
      break;
    case 'hlcopy': {
      /* 复制划线原文：文字已经存在数据里，不重复塞进 DOM 的 data-text */
      const book = findBookOfMark(d.id, d.book);
      const h = book?.notes?.highlights.find((x) => x.id === d.id);
      if (!book || !h) {
        notify('没找到这条划线', 'error');
        break;
      }
      void copyText(h.text);
      break;
    }
    case 'hldel':
      /* 正文工具条的「删除」以前直接删（连想法一起），无确认无撤销；
         侧栏删同一条却要先过确认卡（P2-09）。统一走确认。 */
      if (d.id) overlay('confirmdel', { markId: d.id, bookId: d.book || getState().bookId || '' });
      break;
    case 'ideasave':
      saveIdea(d.id, d.book);
      break;
    /* ── 划词浮层 ── */
    case 'selpen': {
      // 手机上选中即已划上一条，色点只改它的颜色；桌面上是「选色才落笔」
      const reuse = RT.selMarkId;
      if (reuse && recolorMark(reuse, d.v || getState().pen)) break;
      const id = createMark(d.v || getState().pen);
      if (id) RT.selMarkId = id;
      break;
    }
    case 'selidea': {
      const id = RT.selMarkId || createMark(d.v || getState().pen, { silent: true });
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
    case 'seltranslate':
      if (RT.sel && requireCap('ai')) overlay('translate', { text: RT.sel.text });
      break;
    case 'selai':
      if (RT.sel && requireCap('ai'))
        overlay('ai', { text: RT.sel.text, mode: 'explain', anchor: RT.sel.anchor });
      break;
    case 'selbilink': {
      /* 还没落下标注，只能拿选区 + 当前章名拼原文链接；
         与笔记页的「原文链接」按钮同源（data/deeplink.ts 的 linkOfText）。 */
      if (!requireCap('bilink')) break;
      const sel = RT.sel;
      const book = sel ? liveBooks().find((b) => b.id === sel.bookId) : undefined;
      if (!sel || !book) {
        notify('没有可复制的选区', 'error');
        break;
      }
      void copyText(linkOfText(book, { text: sel.text, cfiRange: sel.cfiRange, chapterTitle: sel.chapterTitle }));
      break;
    }
    case 'selcopy':
      if (RT.sel) void copyText(RT.sel.text);
      break;

    /* ── AI ── */
    case 'aiask':
      if (!requireCap('ai')) break;
      void askAi(el);
      break;

    /* ── 搜索 ── */
    case 'searchscope':
      // 本书搜索免费，跨书搜索属于高级版；切换时拦，不要在结果里悄悄少几本
      if (d.v === 'all' && !requireCap('crossSearch')) break;
      if (d.v === 'book' || d.v === 'all' || d.v === 'text') {
        setState({ searchScope: d.v });
        RT.textHits = [];
        repaint();
      }
      break;
    case 'searchtext': {
      /* 正文搜索（新功能）：搜当前这一本的正文，点结果跳过去。
         以前 `host.search()` 只在深链兜底里用，界面上根本没有入口。 */
      const src = getShellSource();
      const kw = getState().searchKw.trim();
      if (!src || !kw) {
        notify('先输入要搜的字', 'info');
        break;
      }
      if (!src.hasOpenReader()) {
        notify('先打开一本书，再来搜正文', 'info');
        break;
      }
      setState({ searchScope: 'text' });
      RT.textSearching = true;
      RT.textHits = [];
      repaint();
      void (async () => {
        try {
          const hits = await src.searchText(kw);
          RT.textHits = hits;
        } catch (e) {
          notify(`正文搜索失败：${(e as Error)?.message || '未知错误'}`, 'error');
        } finally {
          RT.textSearching = false;
          /* 命中列表在弹层里，`repaint()` 广播后订阅方还要过 `overlayKey` 判重：
             内容键没变就跳过 sync()，结果永远停在「搜索中」。rev +1 强制它重画。 */
          bumpOverlayRev();
          repaint();
        }
      })();
      break;
    }
    case 'hittotext': {
      /* 点一条命中：跳到那一页。`openBook` 带 cfi 时会走 `jumpTo`，
         书已经开着就直接定位，没开就开一个新的 tab。 */
      const cfi = d.cfi || '';
      const book = liveBooks().find((b) => b.id === getState().bookId);
      if (!cfi || !book) break;
      closeOverlay();
      getShellSource()?.openBook(book, cfi);
      break;
    }

    /* ── 重置界面状态（不动书与笔记） ── */
    case 'resetui':
      resetUiState();
      closeOverlay();
      notify('界面状态已重置');
      break;

    /* ── AI 卡上的动作：取消 / 复制 / 重试 / 存笔记 ── */
    case 'aicancel': {
      /* 只取消正在跑的那一个：RT.aiAbort 由 runAiForOverlay 持有，
         取消后按钮点「再来一次」会新建 controller。 */
      const ctrl = RT.aiAbort;
      if (ctrl) {
        RT.aiAbort = null;
        ctrl.abort();
      }
      const node = document.querySelector<HTMLElement>('[data-role="aibody"]');
      if (node) node.textContent = '已取消';
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
      const node = document.querySelector<HTMLElement>('[data-role="aibody"]');
      const text = getState().overlay?.text || RT.sel?.text || '';
      if (node) node.textContent = '正在请求…';
      void aiAsk(shellSettings(), { task: 'explain', text })
        .then((res) => {
          if (node) node.textContent = res.text;
        })
        .catch((e: Error) => {
          if (node) node.textContent = e.message;
        });
      break;
    }
    /* 存为笔记：落进导出目录，不伪造一条没有出处的标注 */
    case 'aisave': {
      const node = document.querySelector<HTMLElement>('[data-role="aibody"]');
      const answer = node?.textContent?.trim() || '';
      const app = getShellSource()?.app;
      const book = currentBook();
      if (!answer || !app) break;
      void appendToExport(app, book, `## AI 回答\n\n${answer}\n`);
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
        if (!text) notify('没有可存的引文', 'info');
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
       这是高级版能力位 cap:'card'，按钮本身由 overlayQuote 按权限决定出不出现；
       这里再判一次是因为动作入口也能被脚本触发。 */
    case 'quotecopyimg': {
      if (!requireCap('card')) break;
      const text = getState().overlay?.text || RT.sel?.text || '';
      if (!text) break;
      const book = currentBook();
      void copyQuoteCardImage({
        text,
        title: book?.meta.title,
        author: book?.meta.author,
        chapter: getState().overlay?.chapterTitle || RT.sel?.chapterTitle,
      })
        .then(() => notify('书摘卡已复制为图片'))
        .catch((e: Error) => notify(e.message || '复制图片失败', 'error'));
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
    notify('已标记为在读');
  } else {
    book.reading.stats.completedTime = Date.now();
    notify('已标记读完');
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
  const p = shellPrefs();
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
    case 'fontFamily':
      src.setPrefs({ fontFamily: v as typeof p.fontFamily });
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
      src.setPrefs({ accent: v as typeof p.accent });
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

function deleteMark(markId?: string, bookId?: string): void {
  const book = findBookOfMark(markId, bookId);
  /* 找不到就给一句人话（P3-27）：侧栏里那条标注已经被删掉/被同步覆盖时，
     点「删除」以前是什么都不发生，用户会以为按钮坏了。 */
  if (!book || !markId) {
    notify('找不到这条标注，可能已经被删掉了', 'info');
    return;
  }
  if (removeHighlight(book, markId)) {
    getShellSource()?.store.touch();
    repaint();
    emitNotesChanged();
    notify('划线已删');
  }
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
  notify(removed > 0 ? `已删除 ${removed} 条划线` : '这些标注已经不在了', 'info');
}

function changeMarkColor(markId?: string, color?: string, bookId?: string): void {
  const book = findBookOfMark(markId, bookId);
  if (!book || !markId || !color || !isHighlightColor(color)) return;
  if (setHighlightColor(book, markId, color)) {
    getShellSource()?.store.touch();
    repaint();
    emitNotesChanged();
    notify(`换成${colorLabel(color)}`);
  }
}

function jumpToMark(markId?: string, bookId?: string): void {
  const book = findBookOfMark(markId, bookId);
  const h = book?.notes?.highlights.find((x) => x.id === markId);
  if (!book || !h) {
    notify('找不到这条标注，可能已经被删掉了', 'info');
    return;
  }
  closeOverlay();
  setState({ bookId: book.id });
  getShellSource()?.openBook(book, h.cfiRange);
}

/** jumpmark 的 id 是标注 id，不是书签 id */
function jumpMark(markId?: string, bookId?: string): void {
  jumpToMark(markId, bookId);
}

function quoteFromMark(markId?: string, bookId?: string): void {
  const book = findBookOfMark(markId, bookId);
  const h = book?.notes?.highlights.find((x) => x.id === markId);
  if (!book || !h) {
    notify('找不到这条标注，可能已经被删掉了', 'info');
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
    notify(text ? '想法已保存' : '想法已清空');
  }
}

/**
 * 侧栏 AI 页签的「问这本书」。
 *
 * 与划线的 AI 解释是两条链路：这里带当前这一屏的正文、带最近几轮问答，
 * 走 ask 任务。原来复用 explain 的 prompt 且不传正文，问「讲了什么」
 * 会被当成一段要解释的名词。
 */
async function askAi(el: HTMLElement): Promise<void> {
  const scope = el.closest('.bzs-aiask, .bzs-aichat');
  const input = scope?.querySelector<HTMLInputElement>('[data-role="aiask"]');
  const q = input?.value.trim() || '';
  if (!q) return;
  const src = getShellSource();
  if (!src) return;
  const settings = shellSettings();
  const book = currentBook();
  /* 先把自己这条提问放进日志（界面立刻有反馈），再取历史时要把它排除——
     buildMessages 会把 text 作为最后一条 user 追加。 */
  const history = RT.aiLog.map((m) => ({ role: m.me ? ('user' as const) : ('assistant' as const), content: m.text }));
  pushAi(true, '我', q);
  if (input) input.value = '';
  repaint();
  try {
    const res = await aiAsk(settings, {
      task: 'ask',
      text: q,
      title: book?.meta.title,
      chapter: book?.reading.position.chapterTitle,
      context: src.currentText(),
      history,
    });
    pushAi(false, `AI · ${settings.ai.model || '模型'}`, res.text);
  } catch (e) {
    pushAi(false, 'AI', (e as Error).message || '请求失败');
  }
  repaint();
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
    // 滑块的数值标签就地更新，避免整页重绘时手指还在拖
    const label = target.parentElement?.querySelector('.val');
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
    if (label) label.textContent = `${value} 本`;
    return;
  }
  if (role === 'searchkw') {
    setState({ searchKw: value });
    return;
  }
  if (role === 'aiask') return;
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
