/* ============================================================
 * bz-reader · 正文搜索的纯逻辑（shell/search-body.ts）
 *
 * 「本书 / 全库」现在也要搜正文（fix/search-body）：
 *   · 范围：本书只扫当前这本；没有当前书就空手（界面提示先打开一本）；
 *   · 执行：逐本顺序扫，命中一本报一本；某本打不开就跳过，不拖垮整轮；
 *   · 停止：每一本开始前检查一次，点了停止不再开下一本。
 * 真正的引擎解包由调用方注入的 searchOne 完成——这样这套顺序、去重、
 * 上限逻辑能在 node 里测，不用造 DOM、不用真书。
 * ============================================================ */

export interface BodyHit {
  bookId: string;
  bookTitle: string;
  cfi: string;
  chapterLabel: string;
  excerpt: string;
}

export interface BodyBook {
  id: string;
  title: string;
}

/** 要扫哪几本：全库=在架全部；本书=当前这一本（没有就空） */
export function planBodyBooks<T extends { id: string }>(
  books: T[],
  scope: 'book' | 'all',
  currentBookId: string | null,
): T[] {
  if (scope === 'all') return books;
  if (!currentBookId) return [];
  return books.filter((b) => b.id === currentBookId);
}

/** 合并正文命中：同一本书的同一个 CFI 只留一条；每本最多 maxPerBook 条 */
export function mergeBodyHits(prev: BodyHit[], next: BodyHit[], maxPerBook = 300): BodyHit[] {
  const out = prev.slice();
  const seen = new Set(out.map((h) => `${h.bookId}\u0001${h.cfi}`));
  const perBook = new Map<string, number>();
  for (const h of out) perBook.set(h.bookId, (perBook.get(h.bookId) ?? 0) + 1);

  for (const h of next) {
    if (!h.cfi) continue;
    const key = `${h.bookId}\u0001${h.cfi}`;
    if (seen.has(key)) continue;
    const n = perBook.get(h.bookId) ?? 0;
    if (n >= maxPerBook) continue;
    seen.add(key);
    perBook.set(h.bookId, n + 1);
    out.push(h);
  }
  return out;
}

export interface BodySearchOne {
  (book: BodyBook, shouldStop: () => boolean): Promise<Array<{ cfi: string; excerpt: string; chapterLabel: string }>>;
}

export interface BodySearchOpts {
  kw: string;
  books: BodyBook[];
  searchOne: BodySearchOne;
  /** 返回 true 时停止：下一本不再开扫 */
  shouldStop: () => boolean;
  onHits: (book: BodyBook, hits: BodyHit[]) => void;
  onProgress: (done: number, total: number) => void;
  /** 这本书没能搜（文件丢了 / 打不开）：界面要单列一行，不能静默当它没命中 */
  onFail?: (book: BodyBook) => void;
}

/**
 * 逐本扫正文。
 *
 * @returns true = 完整跑完；false = 被叫停（界面据此显示「已停止」而不是
 *          「没有找到」——两者对用户是相反的意思）。
 */
export async function runBodySearch(opts: BodySearchOpts): Promise<boolean> {
  const total = opts.books.length;
  if (!opts.kw.trim() || !total) return true;

  let done = 0;
  for (const book of opts.books) {
    if (opts.shouldStop()) return false;
    try {
      const rows = await opts.searchOne(book, opts.shouldStop);
      if (opts.shouldStop()) return false;
      if (rows.length) {
        opts.onHits(
          book,
          rows.map((r) => ({
            bookId: book.id,
            bookTitle: book.title,
            cfi: r.cfi,
            chapterLabel: r.chapterLabel,
            excerpt: r.excerpt,
          })),
        );
      }
    } catch {
      /* 打不开的书跳过：搜索不该被一本坏文件打断。但要说出来——
         静默跳过等于让用户对着「没有找到」猜。 */
      opts.onFail?.(book);
    }
    done += 1;
    opts.onProgress(done, total);
    if (opts.shouldStop()) return false;
  }
  return true;
}
