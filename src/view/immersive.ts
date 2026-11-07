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

/**
 * 刚进入沉浸时该弹哪条退出提示（纯函数，node 里可直接测）。
 *
 * 只有「本视图从普通态变成沉浸」才有值：按 ESC 退出、关书时强制关、
 * 已经沉浸又调一次，都不弹。不这么判，用户每次关书都会看到一句
 * 「按 ESC 退出」。
 *
 * 按**真实设备**分：桌面有键盘没触点，说 ESC；手机说两指轻按。桌面验收
 * 用的 force-mobile 只改布局，不该把「双指」讲给一台没有触摸屏的电脑。
 */
export type ImmersiveExitHint = 'desktop' | 'mobile' | null;

export function immersiveExitHint(
  mobile: boolean,
  wasImmersive: boolean,
  immersive: boolean,
): ImmersiveExitHint {
  if (!immersive || wasImmersive) return null;
  return mobile ? 'mobile' : 'desktop';
}
