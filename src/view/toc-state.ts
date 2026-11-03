/* ============================================================
 * bz-reader · 目录的共享状态（view/toc-state.ts）
 *
 * 目录从「阅读弹窗里的抽屉」搬进了 Obsidian 原生左侧栏，于是它变成了
 * 两个视图之间的事：阅读视图是唯一的写入方，目录视图是唯一的读取方。
 * 这个模块就是那条线——一个快照 + 一组订阅，没有事件总线那么重。
 *
 * 为什么不互相拿对方的实例：
 *   - 阅读视图可以被关掉，目录视图可以开着（这时它该显示空态而不是崩）；
 *   - 反过来目录视图没开过时，阅读视图也不该为了更新高亮去 new 一个；
 *   - 两者都活在 workspace 里，谁先 onOpen 说不准，订阅式才不会被顺序咬住。
 * ============================================================ */
import type { FoliateTOCItem } from '../types/foliate';

export interface TocSnapshot {
  bookId: string;
  bookTitle: string;
  items: FoliateTOCItem[];
  /** 当前章节标题（显示用；高亮别只靠它，同名章节会一起亮） */
  activeLabel: string;
  /** 当前章节 href：目录里 label 会重复，高亮以它为准 */
  activeHref: string;
  /** 点章节时怎么跳——由阅读视图注入，目录视图不需要认识引擎 */
  jump: (href: string) => void;
}

let snapshot: TocSnapshot | null = null;
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

export function setToc(next: TocSnapshot): void {
  snapshot = next;
  notify();
}

/** 只改一部分（翻页时只更新 activeLabel，不重建整棵树） */
export function patchToc(patch: Partial<Omit<TocSnapshot, 'bookId'>>): void {
  if (!snapshot) return;
  snapshot = { ...snapshot, ...patch };
  notify();
}

export function clearToc(): void {
  if (!snapshot) return;
  snapshot = null;
  notify();
}

export function getToc(): TocSnapshot | null {
  return snapshot;
}

export function subscribeToc(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/** 目录视图点章节时调；书已经关了就是空操作 */
export function jumpTo(href: string): void {
  snapshot?.jump(href);
}
