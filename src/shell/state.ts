/* ============================================================
 * bz-reader · 壳层状态（shell/state.ts）
 *
 * 原型是「一个全局 S 对象 + 全量重绘」，天然同步；插件是多 leaf
 * 并存（书架 / 阅读 / 侧栏 / 弹层各活一份），所以这里补两件事：
 *   1. 壳层自己的 UI 状态（当前页、筛选、主题、浮层）集中一份
 *   2. 变更广播：任何写入都 notify()，各视图订阅后各自重绘
 *
 * 与 ReaderStore 的分工：
 *   ReaderStore  = 业务数据（书、进度、标注），落盘 JSON
 *   ShellState   = 界面状态（你正看哪一页），落盘 localStorage
 *     —— 界面状态丢了不算数据丢失，不值得占用业务 JSON 的写盘预算
 * ============================================================ */

/* 壳层没有「皮肤」这个状态了：底色、文字、边框全部读宿主的 CSS 变量，
   强调色存在 ReaderPrefs.accent 里（那是阅读偏好，跟着书走）。 */

/** 书架四页。设置也在这里，不用 Obsidian 原生设置页。 */
export type StudyPage = 'library' | 'notes' | 'stats' | 'settings';

/** 左侧栏四页签：书的坐标（书架是中心 tab，不在这里） */
export type SideTab = 'toc' | 'bookmarks' | 'highlights' | 'ai';

export type LibView = 'grid' | 'list';
export type LibFilter = 'all' | 'reading' | 'done' | 'new' | 'fav';
export type LibSort = 'recent' | 'title' | 'progress';

/** 浮层：同一时刻只开一个 */
export type OverlayKind =
  | 'search' | 'import' | 'typography' | 'export' | 'bookmap'
  | 'quote' | 'idea' | 'hlcard' | 'hltools' | 'ai' | 'dict' | 'translate' | 'poster'
  | 'setgoal' | 'reset' | 'detail' | 'unlock' | 'movedata' | 'finish' | 'footnote'
  | 'rename' | 'removebook';

/**
 * 哪些弹层算「浮层」：无遮罩、点外面关闭、贴在文字旁。
 *
 * 阅读视图也读这一份：浮层开着时点正文 = 关浮层，不翻页。
 * 以前这个判断写在 overlay.ts 里（还漏掉了新加的工具条），
 * 导致点正文时浮层不关、页面先翻走了。
 */
const FLOAT_KINDS: readonly OverlayKind[] = ['typography', 'hlcard', 'hltools', 'footnote', 'idea'];

export function isFloatOverlay(kind?: OverlayKind | null): boolean {
  return !!kind && FLOAT_KINDS.includes(kind);
}

export interface OverlayState {
  kind: OverlayKind;
  bookId?: string;
  markId?: string;
  text?: string;
  /** 引文出处用的章节名（真实数据里章节是字符串，不是页码） */
  chapterTitle?: string;
  word?: string;
  mode?: string;
  /** 浮层锚点：文字工具框 / 想法编辑器贴着它弹，坐标是宿主视口坐标 */
  anchor?: { left: number; top: number; width?: number; height?: number };
  /** 书内链接（脚注浮窗的「跳到原文」用） */
  href?: string;
}

export interface ShellState {
  /* 承载 */
  studyPage: StudyPage;
  /* 书库 */
  libView: LibView;
  libFilter: LibFilter;
  libSort: LibSort;
  libShelf: string;
  libKw: string;
  /* 笔记 */
  noteFilter: string;
  noteKw: string;
  reviewIdx: number;
  /** 年度目标（本）。真实数据里没有「目标」，它只影响统计页那圈铜线 */
  goal: number;
  /* 阅读上下文 */
  sideTab: SideTab;
  bookId: string | null;
  /** 默认笔色（划词时第一个动作、想法编辑器用） */
  pen: string;
  /* 浮层 */
  overlay: OverlayState | null;
  /* 真实数据里没有、但书库需要 */
  favIds: string[];
  shelves: Record<string, string>;
}

const LS_KEY = 'bzs-shell-v1';

export const DEFAULT_SHELL_STATE: ShellState = {
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
  sideTab: 'toc',
  bookId: null,
  pen: 'amber',
  overlay: null,
  favIds: [],
  shelves: {},
};

let state: ShellState = { ...DEFAULT_SHELL_STATE };
const listeners = new Set<() => void>();

/** 读盘。坏值一律忽略，只合并认识的字段，避免旧版本残留把界面拖死。 */
export function loadShellState(): ShellState {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<ShellState>;
      if (d.studyPage && ['library', 'notes', 'stats', 'settings'].includes(d.studyPage)) state.studyPage = d.studyPage;
      if (d.libView === 'grid' || d.libView === 'list') state.libView = d.libView;
      if (d.libFilter) state.libFilter = d.libFilter;
      if (d.libSort) state.libSort = d.libSort;
      if (typeof d.libShelf === 'string') state.libShelf = d.libShelf;
      if (d.sideTab && ['toc', 'bookmarks', 'highlights', 'ai'].includes(d.sideTab)) state.sideTab = d.sideTab;
      if (typeof d.goal === 'number' && d.goal > 0) state.goal = Math.min(200, Math.round(d.goal));
      if (typeof d.pen === 'string') state.pen = d.pen;
      if (typeof d.bookId === 'string' || d.bookId === null) state.bookId = d.bookId ?? null;
      if (Array.isArray(d.favIds)) state.favIds = d.favIds.filter((x) => typeof x === 'string');
      if (d.shelves && typeof d.shelves === 'object') state.shelves = d.shelves;
    }
  } catch {
    /* 读失败就用默认值，不打扰用户 */
  }
  return state;
}

export function getState(): ShellState {
  return state;
}

/** 就地改状态并广播。改完不广播 = 界面不动，这里统一收口。 */
export function setState(patch: Partial<ShellState>): void {
  Object.assign(state, patch);
  persist();
  notify();
}

/** 读当前状态 → 改 → 写回。适合「先读旧值再改」的场景（筛选切换、收藏） */
export function mutateState(fn: (s: ShellState) => void): void {
  fn(state);
  persist();
  notify();
}

function persist(): void {
  try {
    const { overlay, libKw, noteKw, ...rest } = state;
    // 浮层与输入框内容不落盘：下次打开还停在上次的弹窗上很怪
    window.localStorage.setItem(LS_KEY, JSON.stringify(rest));
  } catch {
    /* 存不下就算了，界面状态不值得报错 */
  }
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 广播：壳层状态变了、或业务数据变了，都从这里走 */
export function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      console.warn('[bz-reader] 视图重绘失败：', e);
    }
  }
}

/* ── 浮层 ── */
export function openOverlay(o: OverlayState): void {
  mutateState((s) => {
    s.overlay = o;
  });
}

export function closeOverlay(): void {
  mutateState((s) => {
    s.overlay = null;
  });
}

/* ── 收藏（真实数据里没有这个字段，存在壳层） ── */
export function isFav(id: string): boolean {
  return state.favIds.includes(id);
}

export function toggleFav(id: string): boolean {
  const on = !isFav(id);
  mutateState((s) => {
    s.favIds = on ? [...s.favIds, id] : s.favIds.filter((x) => x !== id);
  });
  return on;
}
