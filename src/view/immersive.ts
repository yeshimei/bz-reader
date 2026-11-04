/* ============================================================
 * bz-reader · 沉浸模式的持有者计数（view/immersive.ts）
 *
 * 沉浸 = 给 `<body>` 加一个 class，藏掉宿主的上下两条栏。class 是**全局**
 * 的，可阅读视图是**多实例**的：两个 tab 各开一本书，关掉 A 时以前无条件
 * `classList.remove('bzr-immersive')`，B 的沉浸跟着没了；反过来 A 退出时
 * 也可能把 B 刚点开的沉浸摘掉。
 *
 * 规则：每个视图是独立持有者，class 只在「还有人持有」时保留。
 * 纯 Set 操作，不碰 DOM——DOM 由调用方按返回值 toggle。
 * ============================================================ */

/** 返回更新后是否仍应处于沉浸态（holders 非空） */
export function updateImmersiveHolders<T>(holders: Set<T>, holder: T, on: boolean): boolean {
  if (on) holders.add(holder);
  else holders.delete(holder);
  return holders.size > 0;
}
