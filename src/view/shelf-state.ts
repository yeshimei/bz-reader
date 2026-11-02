/* ============================================================
 * bz-reader · 书库的共享状态（view/shelf-state.ts）
 *
 * 书库原来是弹窗（ui/shelf.ts），现在桌面端搬进了 Obsidian 左侧栏，
 * 和目录/书签/划线住在同一个 leaf 里。侧栏视图不 import 插件类、
 * 不 import 引擎——插件在 onload 时把「书库要什么数据、有哪些动作」
 * 注入到这里，侧栏只消费注入的快照，谁先开都不崩。
 *
 * 高级版动作（统计 / 全文搜索）走单独的 patch：这两个模块是 pro 专属，
 * plugin 只能在 if (__BZ_READER_PRO__) 里注入回调，base 构建时整块摇掉
 * （不能让 side-view 直接 import pro 面板——那是历史坑 #3 的复刻路线）。
 * ============================================================ */
import type { App } from 'obsidian';
import type { BookRepo } from '../data/book-repo';
import type { ReaderStore } from '../data/store';
import type { ReaderBook } from '../data/schema';

export interface ShelfSource {
  app: App;
  repo: BookRepo;
  store: ReaderStore;
  /** 点一本书：进阅读（带 cfi 时落到那一页） */
  openBook: (book: ReaderBook, cfi?: string) => void;
  /** 打开导入面板（弹窗）；导入完成后调用方自己负责 notify */
  openImport: () => void;
  /** 从笔记库重新扫一遍书（打开书库页签时做一次） */
  syncVault: () => void;
}

/** 高级版专属动作；基础版永远是 null，侧栏据此不渲染那两个钮 */
export interface ShelfProActions {
  openStats: () => void;
  openCrossSearch: () => void;
}

let source: ShelfSource | null = null;
let pro: ShelfProActions | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const cb of [...subscribers]) {
    try {
      cb();
    } catch {
      /* 单个订阅者出错不该连累其余 */
    }
  }
}

export function setShelfSource(next: ShelfSource): void {
  source = next;
  notify();
}

export function setShelfProActions(next: ShelfProActions): void {
  pro = next;
}

export function getShelfSource(): ShelfSource | null {
  return source;
}

export function getShelfPro(): ShelfProActions | null {
  return pro;
}

/** 书变了（导入完成 / 扫库完成 / 进度结算）之后由写入方调用，侧栏跟着刷 */
export function notifyShelf(): void {
  notify();
}

export function subscribeShelf(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
