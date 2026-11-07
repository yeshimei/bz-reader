/* ============================================================
 * bz-reader · 壳层状态（shell/state.ts）
 *
 * 原型是「一个全局 S 对象 + 全量重绘」，天然同步；插件是多 leaf
 * 并存（书架 / 阅读 / 侧栏 / 弹层各活一份），所以这里补两件事：
 *   1. 壳层自己的 UI 状态（当前页、筛选、主题、浮层）集中一份
 *   2. 变更广播：任何写入都 notify()，各视图订阅后各自重绘
 *
 * 与 ReaderStore 的分工：
 *   ReaderStore  = 业务数据（书、进度、标注、收藏、分组、目标），落盘 JSON
 *   ShellState   = 界面状态（你正看哪一页、筛了哪个架），落盘 localStorage
 *     —— 界面状态丢了不算数据丢失，不值得占用业务 JSON 的写盘预算
 * ============================================================ */

import { getShellSource } from './source';
import { RT } from './runtime';

/* 壳层没有「皮肤」这个状态了：底色、文字、边框全部读宿主的 CSS 变量，
   强调色存在 ReaderPrefs.accent 里（那是阅读偏好，跟着书走）。 */

/**
 * 书架的各页。
 *
 * 只有 library / notes 占页签位置；stats / settings / search / import
 * 是「子页」，从右上四颗图标进去，头栏换成「← 返回 + 标题」。
 * 分成两类是因为页签栏一长就变成一排小字，扫不动。
 */
export type StudyPage = 'library' | 'notes' | 'stats' | 'settings' | 'search' | 'import';

/** 占页签的两页 */
export type StudyTab = 'library' | 'notes';

/** 子页：进来前的页记在 studyBack，返回键回到那儿 */
export const STUDY_SUB_PAGES = ['stats', 'settings', 'search', 'import'] as const;

export function isStudyTab(page: StudyPage): page is StudyTab {
  return page === 'library' || page === 'notes';
}

/** 左侧栏四页签：书的坐标（书架是中心 tab，不在这里） */
export type SideTab = 'toc' | 'bookmarks' | 'highlights' | 'ai';

export type LibView = 'grid' | 'list';
export type LibFilter = 'all' | 'reading' | 'done' | 'new' | 'fav';
export type LibSort = 'recent' | 'title' | 'progress';

/** 浮层：同一时刻只开一个 */
export type OverlayKind =
  | 'search' | 'typography' | 'export' | 'bookmap'
  | 'quote' | 'idea' | 'hltools' | 'ai' | 'dict' | 'poster'
  | 'setgoal' | 'reset' | 'detail' | 'unlock' | 'movedir' | 'finish' | 'footnote'
  | 'rename' | 'removebook' | 'confirmdel' | 'notedrop' | 'missing' | 'ack' | 'ptclean'
  | 'rebuildidx';

/**
 * 哪些弹层算「浮层」：无遮罩、贴在文字旁。
 *
 * 阅读视图也读这一份：浮层开着时点正文 = 关浮层，不翻页。
 * 以前这个判断写在 overlay.ts 里（还漏掉了新加的工具条），
 * 导致点正文时浮层不关、页面先翻走了。
 */
const FLOAT_KINDS: readonly OverlayKind[] = [
  'typography',
  'hltools',
  'footnote',
  'idea',
  /* 书摘与 AI 是 S10 加的两张无遮罩浮卡。漏进这张表的后果是双向的：
     桌面点空白关不掉，手机点正文不关、还先翻了一页（阅读视图的
     tapHandler 也读这份判断）。 */
  'quote',
  'ai',
  /* 删除确认：桌面从工具条点出来是一条贴字的小条（点正文要能关掉它，
     不然卡片还在、正文先翻走了）。手机那边仍是遮罩弹窗，遮罩自己会吃掉
     点击，这里为真不影响它。 */
  'confirmdel',
];

export function isFloatOverlay(kind?: OverlayKind | null): boolean {
  return !!kind && FLOAT_KINDS.includes(kind);
}

/** 三张「文字面板」：想法 / 书摘 / AI。打开它们时正文不该还挂着选区。 */
const TEXT_PANEL_KINDS: readonly OverlayKind[] = ['idea', 'quote', 'ai'];

export function isTextPanel(kind?: OverlayKind | null): boolean {
  return !!kind && TEXT_PANEL_KINDS.includes(kind);
}

/**
 * 这一次状态变化是不是「刚打开一张文字面板」。
 *
 * 手机上的选区会一直挂着两端手柄和「复制 / 全选」菜单，面板正好开在它们
 * 下面：手柄压在卡片角上，菜单直接盖住引文。所以面板一开就清一次选区。
 *
 * 只在「打开」那一下清：面板之间互切（想法 → 书摘）时选区早没了，
 * 再清一次是空转；清得太勤也会把用户在面板里选中的字一起抹掉。
 */
export function opensTextPanel(prev?: OverlayKind | null, next?: OverlayKind | null): boolean {
  return isTextPanel(next) && !isTextPanel(prev);
}

/**
 * 点一下「别处」，算不算一次关闭请求。
 *
 * 写想法也算：输入框空着就直接关，有字就由 closeOverlay 先亮确认条。
 * 以前这里把 idea 排除掉，结果不是「保护输入」而是「根本关不掉」——
 * 关闭请求压根发不出去，ESC 之外没有任何出口，手机还变成点一下就翻页。
 */
export function dismissesOnTap(kind?: OverlayKind | null): boolean {
  return isFloatOverlay(kind);
}

/**
 * 开始一段新划词，算不算一次关闭请求。
 *
 * 写想法仍然例外：选一段正文粘进想法是常用操作，一选就收等于把正在
 * 写的字丢了。这里的「别处」不是一次点击，用户没有表达要离开。
 */
export function dismissesOnSelect(kind?: OverlayKind | null): boolean {
  return isFloatOverlay(kind) && kind !== 'idea';
}

export interface OverlayState {
  kind: OverlayKind;
  bookId?: string;
  markId?: string;
  /** 删除确认卡：删的是书签时用它（删划线走 markId） */
  bookmarkId?: string;
  text?: string;
  /** 引文出处用的章节名（真实数据里章节是字符串，不是页码） */
  chapterTitle?: string;
  word?: string;
  mode?: string;
  /** 浮层锚点：文字工具框 / 想法编辑器贴着它弹，坐标是宿主视口坐标 */
  anchor?: { left: number; top: number; width?: number; height?: number };
  /** 书内链接（脚注浮窗的「跳到原文」用） */
  href?: string;
  /**
   * 内容版本号。
   *
   * 同一个 kind、同样内容，但底层状态变了需要强制重画时 +1（P2-08）：
   * 激活成功后 `can()` 变 true，而 `kind` / `mode` 都没变，弹层本来不会刷新，
   * 用户只看到一条 toast，界面上还是「未激活」。
   */
  rev?: number;
}

/**
 * 弹层内容键。
 *
 * 只比 `kind` 是不够的：脚注浮窗换一条（text/href 变了）、划线卡换一条
 * （markId 变了）、排版面板换了书，都是同 kind 不同内容。调用方靠这个键
 * 判断「要不要重画」，否则第二次点开还是上一条的内容。
 */
export function overlayKey(o?: OverlayState | null): string {
  if (!o) return '';
  return [
    o.kind,
    o.bookId ?? '',
    o.markId ?? '',
    o.bookmarkId ?? '',
    o.mode ?? '',
    o.text ?? '',
    o.href ?? '',
    o.word ?? '',
    o.chapterTitle ?? '',
    o.anchor ? `${o.anchor.left},${o.anchor.top}` : '',
    String(o.rev ?? 0),
  ].join('|');
}

/**
 * 浮层「要不要重画」的键。
 *
 * 比 overlayKey 多一笔**同一弹层内部的可见状态**：写想法的确认条。
 * 它不是换一种弹层，只是同一张卡片下面多一行字——只比 overlayKey 的话
 * 订阅方认为「内容没变」直接跳过，确认条就永远不出现；而状态里其实已经
 * 置了「已确认」，下一下点击就把用户写了一半的字丢掉。
 */
export function overlayRenderKey(s: { overlay: OverlayState | null; ideaConfirm: boolean }): string {
  const base = overlayKey(s.overlay);
  if (!base) return '';
  return s.overlay?.kind === 'idea' && s.ideaConfirm ? `${base}|confirm` : base;
}

export interface ShellState {
  /* 承载 */
  studyPage: StudyPage;
  /** 子页的返回目标：进搜索/导入/统计/设置之前停在哪一页 */
  studyBack: StudyTab;
  /* 书库 */
  libView: LibView;
  libFilter: LibFilter;
  libSort: LibSort;
  libShelf: string;
  libKw: string;
  /** 窄屏书库：搜索框展开成整行（桌面恒展开，不看这个） */
  libSearchOpen: boolean;
  /* 搜索（书架整页与阅读页浮层共用一份，切页不丢词） */
  searchKw: string;
  searchScope: 'book' | 'all' | 'text';
  /* 笔记 */
  noteFilter: string;
  noteKw: string;
  reviewIdx: number;
  /** 笔记页是否处于批量选择模式 */
  noteSelect: boolean;
  /** 已选中的标注 id（不落盘：退出插件后不该还留着上次的选择） */
  noteSel: string[];
  /** 年度目标（本）。真实数据里没有「目标」，它只影响统计页那圈铜线 */
  goal: number;
  /* 阅读上下文 */
  sideTab: SideTab;
  bookId: string | null;
  /**
   * 最近激活的阅读视图（用 bookId 标识）。
   *
   * 焦点落在目录侧栏时，键盘该归哪本书（P1-12）。以前 `ownsKeyboard()` 只要
   * 看到活动 leaf 是目录就返回 true，于是两个阅读 tab 各翻各的——一次方向键
   * 两本书一起走，进度和阅读时长都被写脏。
   */
  activeReaderId: string | null;
  /** 默认笔色（划词时第一个动作、想法编辑器用） */
  pen: string;
  /* 浮层 */
  overlay: OverlayState | null;
  /** 写想法里「有未保存内容」：关闭前要二次确认 */
  ideaDirty: boolean;
  /** 二次确认那一条正在显示（再按一次关闭才真的关） */
  ideaConfirm: boolean;
  /**
   * 正在写、还没保存的想法正文（null = 没动过输入框，显示书里存的那条）。
   *
   * 必须存一份：亮确认条 / 点「继续写」都会重绘浮层，输入框是重建的，
   * 只从已保存的标注里取值的话，用户打了一半的字会在这一刻被抹掉。
   */
  ideaDraft: string | null;
  /**
   * 授权组是否处于「重新激活」替换态：已激活的人要换码时临时打开输入框。
   * 不落盘——重开插件就回到只读，避免一直挂着可编辑的授权框。
   */
  relicense: boolean;
  /* 真实数据里没有、但书库需要 */
  favIds: string[];
  shelves: Record<string, string>;
}

const LS_KEY = 'bzs-shell-v1';

export const DEFAULT_SHELL_STATE: ShellState = {
  studyPage: 'library',
  studyBack: 'library',
  libView: 'grid',
  libFilter: 'all',
  libSort: 'recent',
  libShelf: '全部',
  libKw: '',
  libSearchOpen: false,
  searchKw: '',
  searchScope: 'book',
  noteFilter: 'all',
  noteKw: '',
  reviewIdx: 0,
  noteSelect: false,
  noteSel: [],
  goal: 20,
  sideTab: 'toc',
  bookId: null,
  activeReaderId: null,
  pen: 'amber',
  overlay: null,
  ideaDirty: false,
  ideaConfirm: false,
  ideaDraft: null,
  relicense: false,
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
      /* 只恢复页签两页：子页是「进来干一件事」的，重开 Obsidian 还停在
         导入页会让人以为插件坏了。 */
      if (d.studyPage === 'library' || d.studyPage === 'notes') state.studyPage = d.studyPage;
      if (d.libView === 'grid' || d.libView === 'list') state.libView = d.libView;
      if (d.libFilter) state.libFilter = d.libFilter;
      if (d.libSort) state.libSort = d.libSort;
      if (typeof d.libShelf === 'string') state.libShelf = d.libShelf;
      if (d.sideTab && ['toc', 'bookmarks', 'highlights', 'ai'].includes(d.sideTab)) state.sideTab = d.sideTab;
      if (typeof d.goal === 'number' && d.goal > 0) state.goal = Math.min(200, Math.round(d.goal));
      if (typeof d.pen === 'string') state.pen = d.pen;
      if (typeof d.bookId === 'string' || d.bookId === null) state.bookId = d.bookId ?? null;
      if (typeof d.activeReaderId === 'string' || d.activeReaderId === null) {
        state.activeReaderId = d.activeReaderId ?? null;
      }
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

/**
 * 写状态但不广播。
 *
 * 只给「用户正在打字」这类场景用：搜索框每敲一个字都整页重绘的话，
 * 输入框会被换掉、光标丢、中文输入法还会被打断。值本身是真的写进
 * 状态的，下一个真正的广播（切页、点按钮）会带着它一起生效。
 */
export function setStateQuiet(patch: Partial<ShellState>): void {
  Object.assign(state, patch);
}

/**
 * 只落盘、不广播（A-24）。
 *
 * `setStateQuiet` 写的输入（搜索词）不会自己触发 persist；关闭浮层时用它补
 * 一次正常持久化，避免「关掉浮层再重开插件，搜索词丢了」，又不额外重绘一次。
 */
export function persistShellState(): void {
  persist();
}

/** 读当前状态 → 改 → 写回。适合「先读旧值再改」的场景（筛选切换、收藏） */
export function mutateState(fn: (s: ShellState) => void): void {
  fn(state);
  persist();
  notify();
}

function persist(): void {
  try {
    const { overlay, libKw, noteKw, noteSelect, noteSel, searchKw, ideaDraft, ...rest } = state;
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
    s.ideaDirty = false;
    s.ideaConfirm = false;
    s.ideaDraft = null;
  });
}

/**
 * 强制重画当前浮层（A-09）。
 *
 * `overlayKey` 已经包含 `rev`，所以内容没变、但底层数据变了（正文搜索刚
 * 返回命中）时，把 rev +1 就能让订阅方认为「弹层内容变了」并调 `sync()`。
 * 直接在 dispatchAction 里 `setState({ overlay: {...} })` 同效，但那一刻
 * 可能没有弹层，这里统一判空。
 */
export function bumpOverlayRev(): void {
  const o = state.overlay;
  if (!o) return;
  setState({ overlay: { ...o, rev: (o.rev ?? 0) + 1 } });
}

/**
 * 关浮层。
 *
 * 写想法要先问一句：里可能有没保存的字。第一次关闭只把确认条亮出来，
 * 再关一次才真的丢。用「已经确认过」当判据而不是再弹一个模态——输入
 * 内容全程都在，看得见。
 *
 * `force` 给「保存」用：用户点了发送键，意思就是要这条，不该再问。
 */
export function closeOverlay(opts?: { force?: boolean }): void {
  const o = state.overlay;
  if (!opts?.force && o?.kind === 'idea' && state.ideaDirty && !state.ideaConfirm) {
    mutateState((s) => {
      s.ideaConfirm = true;
    });
    return;
  }
  /* 关掉 AI 浮卡 = 不要这个答案了。请求是流式的、按 token 计费；
     只清界面不掐请求，它会在后台跑完——用户以为取消了，钱照扣。 */
  if (o?.kind === 'ai') {
    RT.aiAbort?.abort();
    RT.aiAbort = null;
  }
  mutateState((s) => {
    s.overlay = null;
    s.ideaDirty = false;
    s.ideaConfirm = false;
    s.ideaDraft = null;
  });
}

/** 想法里的字变了：只有真的打了字才算「未保存」 */
export function markIdeaDirty(dirty: boolean): void {
  if (state.ideaDirty === dirty) return;
  state.ideaDirty = dirty;
}

/**
 * 记下正在打的字，不广播。
 *
 * 用 setStateQuiet：每敲一个字都重绘的话输入框会被换掉、光标丢、
 * 中文输入法还会被打断。真正需要它的是之后那次重绘（亮确认条）。
 */
export function setIdeaDraft(value: string): void {
  state.ideaDraft = value;
}

/** 「继续写」：收掉确认条，输入框原样留着 */
export function cancelIdeaClose(): void {
  mutateState((s) => {
    s.ideaConfirm = false;
  });
}

/* ── 收藏 / 分组 / 目标 ──
 * 2026-11-04 起这三样的**真相在业务数据**（book.favorite / book.shelf /
 * data.goal），ShellState 里这几个字段退化成界面缓存：
 *   - 启动 / 重扫后用 hydrateLibrary() 从书里灌回来；
 *   - 用户操作时先改缓存（界面立刻响应），再写业务数据（换设备才跟得走）。
 *
 * 为什么不能只留一份：只放 localStorage → 换设备全丢（P2-01）；
 * 只放 store → 每次渲染都要扫一遍 books 建索引，而渲染在翻页路径上。
 */
export function isFav(id: string): boolean {
  return state.favIds.includes(id);
}

export function toggleFav(id: string): boolean {
  const on = !isFav(id);
  mutateState((s) => {
    s.favIds = on ? [...s.favIds, id] : s.favIds.filter((x) => x !== id);
  });
  getShellSource()?.setFavorite(id, on);
  return on;
}

/**
 * 改年度目标。
 *
 * `silent`（P1-09）：拖动目标滑块时只写值、不广播。广播会让统计页整块重绘，
 * 手指还按在 `<input type=range>` 上就被换掉了，拖动中断。
 */
export function setGoal(books: number, opts: { silent?: boolean } = {}): void {
  const n = Math.min(200, Math.max(1, Math.round(books)));
  if (opts.silent) {
    state.goal = n;
    getShellSource()?.setGoal(n);
    return;
  }
  mutateState((s) => {
    s.goal = n;
  });
  getShellSource()?.setGoal(n);
}

/**
 * 从业务数据把收藏 / 分组 / 目标灌回界面缓存。
 *
 * 调用点：onload、syncVault 之后、迁移数据目录之后、一键恢复之后。
 * 不调用的话，同步进来的 `favorite: true` 在界面上永远不显示星标。
 */
export function hydrateLibrary(
  books: ReadonlyArray<{ id: string; favorite?: boolean; shelf?: string }>,
  goal?: number,
): void {
  state.favIds = books.filter((b) => b.favorite === true).map((b) => b.id);
  const shelves: Record<string, string> = {};
  for (const b of books) if (typeof b.shelf === 'string' && b.shelf) shelves[b.id] = b.shelf;
  state.shelves = shelves;
  if (typeof goal === 'number' && goal > 0) state.goal = Math.min(200, Math.round(goal));
  persist();
  notify();
}
