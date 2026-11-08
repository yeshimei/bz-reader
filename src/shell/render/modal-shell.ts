/* ============================================================
 * bz-reader · 弹层外壳（shell/render/modal-shell.ts）
 *
 * 只回答一件事：弹层的遮罩该挂哪些类。
 *
 * 手机上的弹窗默认就是底部抽屉；带输入框的例外——`has-input` 会把它
 * 改成居中偏上，躲开软键盘。`is-drawer` 是「仍然贴底，但键盘弹起时
 * 自己抬到键盘上沿」的那一档（分类管理先用）。
 *
 * 这类必须**同时**落在遮罩与卡片上：贴底/抬升要改的是遮罩的对齐方式，
 * 而 CSS 没法从子元素反选父元素。两个类名各算一次、少写一处就整段失效，
 * 所以抽成纯函数，让测试盯住。
 * ============================================================ */

/** `is-drawer` 是否在调用点传来的卡片类里 */
export function isDrawerClass(cls: string): boolean {
  return cls.split(/\s+/).includes('is-drawer');
}

/**
 * 遮罩的 class 串：`bzs-scrim` + 调用点自己的遮罩类（如 `bzs-text-scrim`）
 * + 有输入框才加 `has-input` + 抽屉才加 `is-drawer`。
 * 空项被滤掉，不会留下连续空格（测试盯着这一点）。
 */
export function scrimClasses(mask: string, withInput: boolean, drawer: boolean): string {
  return ['bzs-scrim', mask, withInput ? 'has-input' : '', drawer ? 'is-drawer' : '']
    .filter(Boolean)
    .join(' ');
}
