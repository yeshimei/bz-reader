/* ============================================================
 * bz-reader · 本书 / 全库的正文搜索调度（shell/search-run.ts）
 *
 * 搜索框现在同时出两类结果：
 *   · 快结果：书名 / 作者 / 章节名 / 标注 / 想法——同步算，立刻画；
 *   · 正文命中：要逐本解包（当前打开的书走现成引擎，其余书临时开引擎），
 *     异步到达，边到边追加。
 *
 * 为什么需要这一层而不是直接在渲染里 await：
 *   1. 每敲一个字都扫全书会卡死，必须防抖；
 *   2. 换了词 / 切了范围 / 点了停止，旧一轮的结果不能再画上来（seq 判）；
 *   3. 结果只替换命中列表，不整页重绘——重绘会把输入框和光标换掉。
 * ============================================================ */
import { can } from '../data/entitlement';
import { hitChapterLabel } from '../data/pdf-link';
import { getState } from './state';
import { getShellSource, liveBooks } from './source';
import { RT } from './runtime';
import { mergeBodyHits, planBodyBooks, runBodySearch } from './search-body';

/** 打字停下多久才开始扫正文：太短会边打边解包，太长像卡住 */
const DEBOUNCE_MS = 320;

/**
 * 一轮搜索的身份：词（去首尾空白）+ 范围。
 *
 * 搜索浮层「关闭只收起、再开还回去」的缓存靠它判断能不能复用：书架搜索页
 * 可能已经把词换掉了，还按旧 DOM 还原就会出现输入框与状态各说各话。
 */
export function searchQueryKey(
  kw: string,
  scope: 'book' | 'all',
  mode: 'literal' | 'semantic' = 'literal',
): string {
  return `${kw.trim()}\u0001${scope}\u0001${mode}`;
}

let timer: number | null = null;

function clearTimer(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

/** 只通知宿主换命中列表；宿主自己的查询失败不该连累搜索 */
function notify(): void {
  for (const fn of [...RT.body.listeners]) {
    try {
      fn();
    } catch {
      /* 单个宿主重绘出错忽略 */
    }
  }
}

/** 点「显示更多」之后让宿主只重画命中列表（搜索框与光标不动） */
export function refreshBodyHits(): void {
  notify();
}

/** 进/离开搜索页、清空关键词：把现场收干净 */
export function resetBodySearch(): void {
  clearTimer();
  RT.body.seq += 1;
  RT.body.running = false;
  RT.body.stopped = false;
  RT.body.kw = '';
  RT.body.hits = [];
  RT.body.done = 0;
  RT.body.total = 0;
  RT.body.noBook = false;
  RT.body.more = {};
  RT.body.failed = [];
  notify();
}

/** 用户点「停止」/ 关掉搜索：作废这一轮，不再开下一本 */
export function stopBodySearch(): void {
  clearTimer();
  RT.body.seq += 1;
  if (!RT.body.running) return;
  RT.body.running = false;
  RT.body.stopped = true;
  notify();
}

/**
 * 关键词变了（或范围变了）：重开一轮正文搜索。
 *
 * @param kw    输入框里这一刻的值
 * @param scope 'book' | 'all'
 */
export function kickBodySearch(kw: string, scope: 'book' | 'all'): void {
  const q = kw.trim();
  clearTimer();
  RT.body.seq += 1;
  const seq = RT.body.seq;
  RT.body.running = false;
  RT.body.stopped = false;
  RT.body.kw = q;
  RT.body.hits = [];
  RT.body.done = 0;
  RT.body.total = 0;
  RT.body.noBook = false;
  RT.body.more = {};
  RT.body.failed = [];

  if (!q) {
    notify();
    return;
  }
  const state = getState();
  const src = getShellSource();
  if (!src) {
    notify();
    return;
  }
  /* 本书：没有当前书就明说，别让用户对着「没有找到」猜 */
  if (scope === 'book' && !state.bookId) {
    RT.body.noBook = true;
    notify();
    return;
  }
  /* 全库属于高级版能力；切范围那一下已经拦过，这里兜住状态残留 */
  if (scope === 'all' && !can('crossSearch')) {
    notify();
    return;
  }

  const targets = planBodyBooks(liveBooks(), scope, state.bookId);
  if (!targets.length) {
    notify();
    return;
  }

  /* 防抖期就标成「正在搜」：界面先给出反馈，别闪一下「没有找到」再变 */
  RT.body.running = true;
  RT.body.total = targets.length;
  notify();

  const books = targets.map((b) => ({ id: b.id, title: b.meta.title }));
  timer = window.setTimeout(() => {
    timer = null;
    void run(seq, q, books);
  }, DEBOUNCE_MS);
}

async function run(seq: number, q: string, books: Array<{ id: string; title: string }>): Promise<void> {
  const src = getShellSource();
  if (!src || seq !== RT.body.seq) return;

  /* 搜不成的书：失联、文件没了、格式坏了。都要在结果里单列一行——
     静默跳过会让用户以为「这本书里没有」。同一本只记一次。 */
  const fail = (book: { id: string; title: string }): void => {
    if (seq !== RT.body.seq) return;
    if (RT.body.failed.some((f) => f.id === book.id)) return;
    RT.body.failed.push({ id: book.id, title: book.title });
    notify();
  };

  const finished = await runBodySearch({
    kw: q,
    books,
    shouldStop: () => seq !== RT.body.seq,
    searchOne: async (book, shouldStop) => {
      const full = liveBooks().find((b) => b.id === book.id);
      if (!full) {
        fail(book);
        return [];
      }
      /* 当前打开的书直接用阅读视图里的引擎：不必为了搜一本书把文件重新解一遍 */
      if (book.id === src.openBookId() && src.hasOpenReader()) {
        const hits = await src.searchText(q);
        return hits.map((h) => ({
          cfi: h.cfi,
          excerpt: h.excerpt,
          /* PDF 没有章节名，靠定位串补「第 N 页」；否则本书结果全是「正文」 */
          chapterLabel: hitChapterLabel(h),
        }));
      }
      const hits = await src.searchBookBody(full, q, shouldStop);
      return hits.map((h) => ({ cfi: h.cfi, excerpt: h.excerpt, chapterLabel: hitChapterLabel(h) }));
    },
    onHits: (_book, hits) => {
      if (seq !== RT.body.seq) return;
      RT.body.hits = mergeBodyHits(RT.body.hits, hits);
      notify();
    },
    onFail: fail,
    onProgress: (done, total) => {
      if (seq !== RT.body.seq) return;
      RT.body.done = done;
      RT.body.total = total;
      notify();
    },
  });

  if (seq !== RT.body.seq) return;
  settleBodySearch(finished);
}

/**
 * 一轮搜完的收口：`finished` 是 runBodySearch 的返回值（true=完整跑完）。
 *
 * 单独抽出来是为了能被测试钉住：这里曾经写成 `stopped = !finished` 再
 * `RT.body.stopped = !stopped`，连反两次——跑完反而显示「已停止」，真机上
 * 一眼就能看到。用 `stopped = !finished` 只留一次取反。
 */
export function settleBodySearch(finished: boolean): void {
  RT.body.running = false;
  RT.body.stopped = !finished;
  notify();
}
