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
import { type SearchHit } from './host';
import { createEngine } from './reader-engine';
import { hitChapterLabel } from '../data/pdf-link';

export type CrossBookHit = SearchHit & { chapterLabel: string };

/* 位置小字挪到 data/pdf-link：本书搜索（当前打开的那本）也要用同一套，
   放在引擎里会让壳层反向依赖引擎实现。这里转出去，老引用不用改。 */
export { hitChapterLabel };

/**
 * 整轮共用的离屏舞台。
 *
 * 原来每本书都新建一个再 remove：正常路径能收干净，但搜索途中卸载插件时
 * 正在扫的那一本走不到 finally，body 上就留下一个空节点。现在同一时间只有
 * 一个舞台，卸载时调 `disposeCrossSearchStage()` 一次摘掉。
 */
let sharedStage: HTMLElement | null = null;

export function crossSearchStage(): HTMLElement {
  if (sharedStage) return sharedStage;
  sharedStage = createDiv();
  sharedStage.className = 'bzr-xs-stage';
  document.body.appendChild(sharedStage);
  return sharedStage;
}

/** 插件卸载时调用：把还在的离屏舞台摘掉 */
export function disposeCrossSearchStage(): void {
  sharedStage?.remove();
  sharedStage = null;
}

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
  /**
   * 这本书打不开（文件坏了 / 格式不支持 / 解析抛错）。
   *
   * 1.0.0 修：以前只有 catch 静默跳过，面板照样写「没有找到」——用户不知道
   * 有书被漏掉，还以为插件搜不全。正文搜索那边早就单列一行失败，这里对齐。
   */
  onBookFail?: (book: ReaderBook, err: unknown) => void;
  /** 返回 true 时在下一本书开扫前停下 */
  shouldStop?: () => boolean;
}

export async function searchAcrossBooks(deps: CrossSearchDeps): Promise<void> {
  const stage = crossSearchStage();
  for (const book of deps.books) {
    if (deps.shouldStop?.()) break;
    deps.onBookStart?.(book);
    /* 按书的格式造引擎。原来这里写死 `new EngineHost()`（那是 EPUB/TXT/CBZ
       的 foliate 宿主），PDF 一律打不开、异常被下面的 catch 吞掉——
       表现就是「全库搜索永远搜不到 PDF 里的字」，面板还写「没有找到」。 */
    const host = createEngine(book.fileRef.format, deps.app);
    try {
      await host.mount(stage, book.fileRef.vaultPath, { prefs: deps.prefs });
      // 不调 start()/init()：foliate 的 search 自己逐章 load，不依赖当前渲染
      /* shouldStop 一路传进逐章循环（P2-05）：只判「下一本书之前」的话，
         点了停止当前这本仍会把剩下的章节扫完，界面还要再转好几秒。 */
      const hits = await host.search(deps.query, { shouldStop: deps.shouldStop });
      if (hits.length) {
        deps.onHits(
          book,
          hits.map((h) => ({ ...h, chapterLabel: hitChapterLabel(h as CrossBookHit) })),
        );
      }
    } catch (err) {
      /* 打不开的书跳过——搜索不该被一本坏文件打断，但要让面板说出来 */
      deps.onBookFail?.(book, err);
    } finally {
      await host.destroy().catch(() => undefined);
    }
    deps.onBookDone?.(book);
    if (deps.shouldStop?.()) break;
  }
}
