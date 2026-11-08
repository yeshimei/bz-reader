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

/**
 * 只改一部分（翻页时只更新 activeLabel，不重建整棵树）。
 *
 * 同值短路：relocate 触发得很密（翻一页、滚动一屏、窗口 resize 之后的
 * 重新定位都会来一次），而值没变时下游（侧栏）拿到的还是一样的高亮。
 * 不短路的话每一拍都要跑一遍订阅回调，等于每次 relocate 都问一遍
 * 「要不要重绘」——短路点放在这里，比让每个订阅者各查一次便宜。
 */
export function patchToc(patch: Partial<Omit<TocSnapshot, 'bookId'>>): void {
  if (!snapshot) return;
  const next = { ...snapshot, ...patch };
  let changed = false;
  for (const key of Object.keys(patch) as Array<keyof TocSnapshot>) {
    if (next[key] !== snapshot[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  snapshot = next;
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

/** 目录变更要重绘到哪一层：整棵重建 / 只切高亮 / 什么都不用动 */
export type TocPaintMode = 'full' | 'row' | 'none';

/**
 * 目录变了该重绘哪一层（B10）。
 *
 * 抽成纯函数是因为这段判断已经被改错过一次（条件写反，见 side-view 的注释），
 * 而且三条分支的代价差得很远：`full` 会重建整个侧栏（目录 + 书签 + 划线 +
 * AI 对话），`row` 只切几个 class，`none` 一行 DOM 都不碰。
 *
 * · 目录树换了（换书 / 重新解析）→ 只能整棵重建；
 * · 高亮没变 → 什么都不用做（同章内翻页就属于这种，最常见）；
 * · 高亮变了但当前不在目录页签 → 也不用画，切回目录时全量 render 会带上。
 */
export function tocPaintMode(input: {
  sameTree: boolean;
  moved: boolean;
  onTocPage: boolean;
}): TocPaintMode {
  if (!input.sameTree) return 'full';
  if (!input.moved) return 'none';
  return input.onTocPage ? 'row' : 'none';
}

/** 目录视图点章节时调；书已经关了就是空操作 */
export function jumpTo(href: string): void {
  snapshot?.jump(href);
}
