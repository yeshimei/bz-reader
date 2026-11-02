/* ============================================================
 * bz-reader · 跨书全文搜索（engine/cross-search.ts）
 *
 * 对书架里每本书开一个临时引擎扫全文，扫完即拆（destroy），不建持久索引——
 * 读书人搜全文是低频动作，为了它维护一份索引不值得：索引会过期、要更新、
 * 还占磁盘。代价是每次搜索都要把书重新解一遍（每本秒级），所以逐本顺序跑、
 * 边扫边报，而不是让用户盯着一个总数干等。
 *
 * 引擎挂在一个离屏容器上：foliate 布局要真实尺寸（getBoundingClientRect），
 * 0×0 会渲染成空；挪出视口但不缩小。
 * ============================================================ */
import type { App } from 'obsidian';
import type { ReaderBook } from '../data/schema';
import type { ReaderPrefs } from '../data/prefs';
import { EngineHost, type SearchHit } from './host';

export type CrossBookHit = SearchHit & { chapterLabel: string };

export interface CrossSearchDeps {
  app: App;
  /** 要扫的书（调用方负责剔掉文件缺失的） */
  books: ReaderBook[];
  prefs: ReaderPrefs;
  query: string;
  /** 每本书开始扫 / 命中 / 扫完都实时报，界面边扫边长 */
  onBookStart?: (book: ReaderBook) => void;
  onHits: (book: ReaderBook, hits: CrossBookHit[]) => void;
  onBookDone?: (book: ReaderBook) => void;
  /** 返回 true 时在下一本书开扫前停下 */
  shouldStop?: () => boolean;
}

export async function searchAcrossBooks(deps: CrossSearchDeps): Promise<void> {
  const stage = document.createElement('div');
  stage.style.cssText =
    'position:fixed;left:-10000px;top:0;width:800px;height:600px;visibility:hidden;pointer-events:none;';
  document.body.appendChild(stage);
  try {
    for (const book of deps.books) {
      if (deps.shouldStop?.()) break;
      deps.onBookStart?.(book);
      const host = new EngineHost(deps.app);
      try {
        await host.mount(stage, book.fileRef.vaultPath, { prefs: deps.prefs });
        // 不调 start()/init()：foliate 的 search 自己逐章 load，不依赖当前渲染
        const hits = await host.search(deps.query, {});
        if (hits.length) deps.onHits(book, hits);
      } catch {
        /* 打不开的书跳过——搜索不该被一本坏文件打断 */
      } finally {
        await host.destroy().catch(() => undefined);
      }
      deps.onBookDone?.(book);
    }
  } finally {
    stage.remove();
  }
}
