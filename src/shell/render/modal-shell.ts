/* ============================================================
 * bz-reader · 弹层外壳（shell/render/modal-shell.ts）
 *
 * 只回答一件事：弹层的遮罩该挂哪些类。
 *
 * 手机上的弹窗默认就是底部抽屉；带输入框的例外——`has-input` 会把它
 * 改成居中偏上，躲开软键盘。`is-center` 是「真正居中、不跟键盘走」的
 * 那一档，位置照书摘卡（分类管理 / 想法全文）。
 *
 * `is-drawer`（贴底 + 键盘抬到上沿）仍然留着：键盘让位的采样与判据
 * 还在给居中档用（只收缩可用区，不再移动卡片）。
 *
 * 这类必须**同时**落在遮罩与卡片上：贴底/居中要改的是遮罩的对齐方式，
 * 而 CSS 没法从子元素反选父元素。两个类名各算一次、少写一处就整段失效，
 * 所以抽成纯函数，让测试盯住。
 * ============================================================ */

/** `is-drawer` 是否在调用点传来的卡片类里 */
export function isDrawerClass(cls: string): boolean {
  return cls.split(/\s+/).includes('is-drawer');
}

/** `is-center` 是否在卡片类里：手机上也不贴底，垂直居中 */
export function isCenterClass(cls: string): boolean {
  return cls.split(/\s+/).includes('is-center');
}

/**
 * 手机上也走居中档的弹层。
 *
 * 唯一出处：调用点用它决定传不传 `is-center`，测试顺着这张表盯住
 * 「哪几个弹层在屏幕中间」。目前只有两个——
 *   · `shelves`：分类管理。贴底 + 键盘抬升在 iOS 上把卡片压成一条缝
 *     （系统先把窗口缩到键盘上方，再抬一次等于扣两遍），改成居中后
 *     高度只由屏幕和内容决定。
 *   · `ideaall`：想法「展开全文」。和书摘卡同一个落点，读长文时不用
 *     从屏幕底端找那张卡。
 */
export function centeredModal(kind: string): boolean {
  return kind === 'shelves' || kind === 'ideaall';
}

/**
 * 遮罩的 class 串：`bzs-scrim` + 调用点自己的遮罩类（如 `bzs-text-scrim`）
 * + 有输入框才加 `has-input` + 抽屉才加 `is-drawer` + 居中才加 `is-center`。
 * 抽屉与居中互斥：同时来的话按居中算（居中不会动卡片，最坏只是少抬一次）。
 * 空项被滤掉，不会留下连续空格（测试盯着这一点）。
 */
export function scrimClasses(mask: string, withInput: boolean, drawer: boolean, center = false): string {
  const useCenter = center;
  return [
    'bzs-scrim',
    mask,
    withInput ? 'has-input' : '',
    drawer && !useCenter ? 'is-drawer' : '',
    useCenter ? 'is-center' : '',
  ]
    .filter(Boolean)
    .join(' ');
}
