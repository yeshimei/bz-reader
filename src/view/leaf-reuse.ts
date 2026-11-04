/* ============================================================
 * bz-reader · leaf 复用判定（view/leaf-reuse.ts）
 *
 * 工作区恢复出来的 leaf 可能是 **DeferredView**：Obsidian 还没实例化它，
 * 只留一个占位对象，唯一可靠的接口就是 `getViewType()`。它当然不是
 * `StudyView` / `SideView` 的实例——以前那种 `instanceof` 一次不过就
 * `leaf.detach()`，等于把用户上次打开的书架/目录 tab 静默关掉。
 *
 * 判定拆成两层，视图类型字符串只在这里读一次：
 *   · 实例已经在（instanceof）→ 直接复用；
 *   · 不是实例但类型对得上 → 用 `setViewState` 让它就地实例化，同样复用。
 * ============================================================ */

/** 视图类型；对象没有可调用的 `getViewType` 时返回空串 */
export function viewTypeOf(view: unknown): string {
  const fn = (view as { getViewType?: unknown } | null | undefined)?.getViewType;
  if (typeof fn !== 'function') return '';
  try {
    return String(fn.call(view));
  } catch {
    /* 热重载后残骸的 getViewType 可能抛错：当作认不出，走 detach 重建 */
    return '';
  }
}

/** 这个对象是不是某种类型的延迟加载视图（不是该类的实例） */
export function isDeferredViewOf(view: unknown, type: string): boolean {
  return !!type && viewTypeOf(view) === type;
}
