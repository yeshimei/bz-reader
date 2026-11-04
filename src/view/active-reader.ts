/* ============================================================
 * bz-reader · 当前该对哪本书下手（view/active-reader.ts）
 *
 * 命令面板、AI 问答、排版面板都要「当前这本书」。以前是：
 *   activeLeaf 是阅读视图 → 用它；否则取第一个阅读 leaf 强转。
 *
 * 两个坑：
 *   1. 焦点在目录侧栏时 `activeLeaf` 是目录视图，于是永远落到「第一个」；
 *      两个阅读 tab 时命令总是打在第一本上（P1-12 的同类问题）。
 *   2. `getLeavesOfType` 返回的可能是还没实例化的 DeferredView，强转成
 *      ReaderView 后读字段不报错、但行为全是 undefined（P3-07 那类静默错）。
 *
 * 选择顺序：活动视图 → activeReaderId 对应的书 → 第一个真视图。
 * 最后一道必须是 `instanceof ReaderView`（由调用方传谓词），不接受「长得像」。
 * ============================================================ */
import type { WorkspaceLeaf } from 'obsidian';

export interface ReaderLike {
  /** 阅读视图对外暴露的当前书 id；阅读视图之外的对象没有这个字段 */
  currentBookId?: string;
}

/**
 * @param activeView    `ws.getActiveViewOfType(ReaderView)` 的结果
 * @param leaves        `ws.getLeavesOfType(VIEW_TYPE_READER)` 的结果
 * @param activeReaderId 壳层记的「最近激活的阅读视图」
 * @param isReader      运行时类型谓词（插件传 `instanceof ReaderView`）
 * @param bookIdOf      从视图取当前书 id
 */
export function pickActiveReader<T extends ReaderLike>(
  activeView: unknown,
  leaves: ReadonlyArray<Pick<WorkspaceLeaf, 'view'>>,
  activeReaderId: string | null,
  isReader: (v: unknown) => v is T,
  bookIdOf: (v: T) => string | undefined = (v) => v.currentBookId,
): T | null {
  if (isReader(activeView)) return activeView;
  const readers: T[] = [];
  for (const leaf of leaves) {
    if (isReader(leaf.view)) readers.push(leaf.view);
  }
  if (!readers.length) return null;
  if (activeReaderId) {
    const match = readers.find((v) => bookIdOf(v) === activeReaderId);
    if (match) return match;
  }
  return readers[0] ?? null;
}
