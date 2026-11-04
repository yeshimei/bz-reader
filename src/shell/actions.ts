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
import type { ReaderBook } from '../data/schema';
import { aiAsk } from '../data/ai';
import {
  DEFAULT_HIGHLIGHT_COLOR,
  addHighlight,
  colorCss,
  isHighlightColor,
  removeBookmark,
  removeHighlight,
  setHighlightColor,
  setHighlightComment,
  toggleBookmark,
} from '../data/notes';
import { notify } from '../core/notice';
import { confirmDelete } from './delete-guard';
import { flipSetting, type ToggleState } from './settings-toggle';
import { rangeFill } from './range-fill';
import { openHotkeySettings } from '../core/hotkeys';
import { folderLabel, pickFolder } from '../core/folder-pick';
import { CAP_LABEL, GROUP_URL, PURCHASE_URL, can, type Cap } from '../data/entitlement';
import { normalizeDataDir } from '../core/plugin-path';
import { linkInline, linkOfMark, linkOfText, linkQuote, rawUrl, targetOfMark } from '../data/deeplink';
import { exportBookNotes } from '../data/export';
import { jumpTo, getToc } from '../view/toc-state';
import type { OverlayKind, StudyPage } from './state';
import { closeOverlay, getState, mutateState, openOverlay, setState, toggleFav } from './state';
import { RT, emitNotesChanged, pushAi } from './runtime';
import { getShellSource, liveBooks, shellPrefs, shellSettings } from './source';

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

export function dispatchAction(act: string, el: HTMLElement, env: ActionEnv = {}): void {
  const d = el.dataset;
  const rerender = (): void => {
    repaint();
    env.repaint?.();
  };

  switch (act) {
    /* ── 承载 ── */
    case 'study': {
      const page = (d.p as StudyPage) || 'library';
      setState({ studyPage: page });
      getShellSource()?.openStudy(page);
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
      const menu = new Menu();
      menu.addItem((i) => i.setTitle('阅读').setIcon('book-open').onClick(() => openBookById(id)));
      menu.addItem((i) => i.setTitle('书籍详情').setIcon('info').onClick(() => overlay('detail', { bookId: id })));
      menu.addItem((i) =>
        i
          .setTitle(getState().favIds.includes(id) ? '取消收藏' : '收藏')
          .setIcon('star')
          .onClick(() => {
            const on = toggleFav(id);
            notify(on ? '已收藏' : '已取消收藏');
            rerender();
          }),
      );
      menu.addItem((i) =>
        i
          .setTitle(done ? '标为在读' : '标为读完')
          .setIcon('check')
          .onClick(() => toggleDone(id)),
      );
      menu.addSeparator();
      menu.addItem((i) => i.setTitle('改名').setIcon('pencil').onClick(() => overlay('rename', { bookId: id })));
      menu.addItem((i) =>
        i.setTitle('移除书库').setIcon('trash').onClick(() => overlay('removebook', { bookId: id })),
      );
      menu.showAtPosition({ x: Number(d.x) || 0, y: Number(d.y) || 0 });
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
    case 'joingroup':
      window.open(GROUP_URL, '_blank');
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
        rerender();
      })();
      break;
    }

    /* ── 数据目录 ── */
    case 'pickimportdir': {
      // 只挑不输：弹出 vault 文件夹清单，选完即生效
      const src = getShellSource();
      if (!src) break;
      const cur = shellSettings().importDir || 'Books';
      void pickFolder(src.app, cur).then((picked) => {
        if (picked === null) return;
        src.setSettings({ importDir: picked });
        notify(`书籍导入位置：${folderLabel(picked)}`);
        rerender();
      });
      break;
    }
    case 'pickexportdir': {
      /* 导出目录也可以从文件夹清单里挑：手打路径错了不会报错，笔记会写进别处 */
      const src = getShellSource();
      if (!src) break;
      const cur = shellSettings().exportDir || '书摘';
      void pickFolder(src.app, cur).then((picked) => {
        if (picked === null) return;
        if (picked === '/') {
          notify('导出目录不能是库根目录，请选一个文件夹', 'error');
          return;
        }
        src.setSettings({ exportDir: picked });
        notify(`导出目录：${folderLabel(picked)}`);
        rerender();
      });
      break;
    }
    case 'pickdatadir': {
      /* 只改草稿：真正搬家要点「迁移」并二次确认 */
      const src = getShellSource();
      if (!src) break;
      const cur = RT.dataDirDraft || src.dataDir();
      void pickFolder(src.app, cur).then((picked) => {
        if (picked === null) return;
        if (picked === '/') {
          notify('数据目录不能是库根目录，请选一个文件夹', 'error');
          return;
        }
        RT.dataDirDraft = picked;
        rerender();
      });
      break;
    }
    case 'datadirmove': {
      const src = getShellSource();
      if (!src) break;
      const cur = src.dataDir();
      const next = normalizeDataDir(RT.dataDirDraft || cur);
      if (next === cur) {
        notify('和当前目录相同，不需要迁移');
        break;
      }
      overlay('movedata', { text: next });
      break;
    }
    case 'datadomigrate': {
      const src = getShellSource();
      if (!src) break;
      const to = normalizeDataDir(getState().overlay?.text || RT.dataDirDraft);
      // 迁移要写几十个文件，先给个即时反馈，否则点完像没反应
      notify('正在迁移数据…');
      void (async () => {
        const res = await src.migrateDataDir(to);
        notify(res.message, res.ok ? 'info' : 'error');
        if (res.ok) {
          RT.dataDirDraft = to;
          closeOverlay();
          env.repaint?.();
        }
      })();
      break;
    }

    /* ── 统计 ── */
    case 'goal': {
      const v = Number(d.v);
      if (Number.isFinite(v) && v > 0) setState({ goal: Math.round(v) });
      break;
    }

    /* ── 设置 ── */
    case 'setpref':
      setPref(d.k, d.v);
      break;
    case 'setpen':
      if (d.v) setState({ pen: d.v });
      break;
    case 'toggle': {
      const src = getShellSource();
      if (!src) break;
      const patch = flipSetting(shellSettings() as unknown as ToggleState, d.k ?? '');
      if (!patch) break;
      src.setSettings(patch as never);
      /* 必须自己重绘：setSettings 只落盘 + notifyShell，设置页那块的 DOM
         不会因为状态变了就重建，开关会停在旧位置（用户报的「点了不实时显示」）。 */
      repaint();
      break;
    }

    /* ── 侧栏：目录 / 书签 / 划线 ── */
    case 'jumpch':
      if (d.href) {
        closeOverlay();
        jumpTo(d.href);
      }
      break;
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
    case 'delbmk': {
      const book = currentBook();
      if (book && d.id) {
        const gate = confirmDelete(RT.deleteArm, d.id, Date.now());
        RT.deleteArm = gate.next;
        if (!gate.remove) {
          notify('再点一次删除这枚书签', 'info');
          break;
        }
        removeBookmark(book, d.id);
        getShellSource()?.store.touch();
        repaint();
        notify('书签已删');
      }
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
      deleteMark(d.id, d.book);
      closeOverlay();
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
      if (RT.sel) overlay('quote', { text: RT.sel.text, bookId: RT.sel.bookId, chapterTitle: RT.sel.chapterTitle });
      break;
    case 'seldict':
      if (RT.sel) overlay('dict', { word: RT.sel.text.slice(0, 8) });
      break;
    case 'seltranslate':
      if (RT.sel && requireCap('ai')) overlay('translate', { text: RT.sel.text });
      break;
    case 'selai':
      if (RT.sel && requireCap('ai')) overlay('ai', { text: RT.sel.text, mode: 'explain' });
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
    case 'aimode': {
      const s = getState();
      if (s.overlay) setState({ overlay: { ...s.overlay, mode: d.v } });
      break;
    }

    /* ── 搜索 ── */
    case 'searchscope':
      // 本书搜索免费，跨书搜索属于高级版；切换时拦，不要在结果里悄悄少几本
      if (d.v === 'all' && !requireCap('crossSearch')) break;
      if (d.v === 'book' || d.v === 'all') {
        RT.searchScope = d.v;
        env.repaint?.();
      }
      break;

    /* ── 重置界面状态（不动书与笔记） ── */
    case 'resetui':
      resetUiState();
      closeOverlay();
      notify('界面状态已重置');
      break;

    /* ── AI 回答存为笔记：直接落到剪贴板，不伪造一条没有出处的标注 ── */
    case 'aisave': {
      const node = document.querySelector<HTMLElement>('[data-role="aibody"]');
      const answer = node?.textContent?.trim() || '';
      if (answer) void copyText(answer);
      break;
    }

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

/** 只清界面状态：书、进度、标注、AI 配置一律不动 */
function resetUiState(): void {
  const keep = { bookId: getState().bookId };
  try {
    window.localStorage.removeItem('bzs-shell-v1');
  } catch {
    /* 存不下就算了 */
  }
  setState({
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
    favIds: [],
    shelves: {},
  });
}

/* ─────────── 具体业务 ─────────── */

function toggleDone(id?: string): void {
  if (!id) return;
  const book = liveBooks().find((b) => b.id === id);
  const src = getShellSource();
  if (!book || !src) return;
  const done = !!book.reading.stats.completedTime || (book.reading.position.percent || 0) >= 0.99;
  if (done) {
    book.reading.stats.completedTime = undefined;
    if ((book.reading.position.percent || 0) >= 0.99) book.reading.position.percent = 0.95;
    notify('已标记为在读');
  } else {
    book.reading.stats.completedTime = Date.now();
    book.reading.position.percent = 1;
    notify('已标记读完');
  }
  book.updatedAt = Date.now();
  src.store.touch();
  repaint();
}

function setPref(k: string | undefined, v: string | undefined): void {
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
      if (v === '2' && !requireCap('vertical')) break;
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
  repaint();
}

function findBookOfMark(markId?: string, bookId?: string): ReaderBook | undefined {
  if (!markId) return undefined;
  if (bookId) return liveBooks().find((b) => b.id === bookId);
  return liveBooks().find((b) => (b.notes?.highlights ?? []).some((h) => h.id === markId));
}

function deleteMark(markId?: string, bookId?: string): void {
  const book = findBookOfMark(markId, bookId);
  if (!book || !markId) return;
  if (removeHighlight(book, markId)) {
    getShellSource()?.store.touch();
    repaint();
    emitNotesChanged();
    notify('划线已删');
  }
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
  if (!book || !h) return;
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
  if (!book || !h) return;
  overlay('quote', { text: h.text, bookId: book.id, chapterTitle: h.chapterTitle, markId: h.id });
}

function saveIdea(markId?: string, bookId?: string): void {
  const book = findBookOfMark(markId, bookId);
  if (!book || !markId) return;
  const ta = document.querySelector<HTMLTextAreaElement>('[data-role="idea"]');
  const text = ta?.value.trim() ?? '';
  if (setHighlightComment(book, markId, text)) {
    getShellSource()?.store.touch();
    closeOverlay();
    repaint();
    emitNotesChanged();
    notify(text ? '想法已保存' : '想法已清空');
  }
}

async function askAi(el: HTMLElement): Promise<void> {
  const scope = el.closest('.bzs-aiask, .bzs-aichat');
  const input = scope?.querySelector<HTMLInputElement>('[data-role="aiask"]');
  const q = input?.value.trim() || '';
  if (!q) return;
  const src = getShellSource();
  if (!src) return;
  const settings = shellSettings();
  pushAi(true, '我', q);
  if (input) input.value = '';
  repaint();
  try {
    const res = await aiAsk(settings, 'explain', q);
    pushAi(false, `AI · ${settings.ai.model || '模型'}`, res.text);
  } catch (e) {
    pushAi(false, 'AI', (e as Error).message || '请求失败');
  }
  repaint();
}

/* ─────────── 输入与快捷键 ─────────── */

export function dispatchInput(target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
  const role = target.dataset.role;
  const k = target.dataset.k;
  const value = target.value;

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
    setPref(k, value);
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
    /* 目录类设置已经没有输入框了（只走文件夹选择器），这里只剩 AI 三个字段 */
    if (k === 'ai.baseUrl' || k === 'ai.model' || k === 'ai.apiKey') {
      src.setSettings({ ai: { ...shellSettings().ai, [k.slice(3)]: value } });
    }
    return;
  }
  if (role === 'goal') {
    setState({ goal: Math.max(1, Number(value) || 1) });
    const label = document.getElementById('bzs-goalval');
    if (label) label.textContent = `${value} 本`;
    return;
  }
  if (role === 'searchkw') {
    RT.searchKw = value;
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
    default:
      return v;
  }
}

/** 弹层里换笔色的默认值：书摘卡上的「四支笔」用得到 */
export function penCssOf(name: string): string {
  return colorCss(name);
}
