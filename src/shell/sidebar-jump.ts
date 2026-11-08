/* ============================================================
 * bz-reader · 侧栏跳转后收抽屉（shell/sidebar-jump.ts）
 *
 * 手机上从左侧栏点目录 / 划线 / 书签，跳完就该看见正文——不用再点一下边框
 * 把抽屉推回去。桌面侧栏常驻是正常形态，不动。
 *
 * 判据拆成三个条件，每个都是踩过会疼的地方：
 *   · mobile       —— 只收真机抽屉；桌面侧栏收起来反而多一次点开；
 *   · fromSidebar  —— 全书鸟瞰弹层里有同款章节行，点它不能把侧栏收掉；
 *   · jumped       —— 没找到章节 / 标注已被删时只弹一句提示，抽屉不该跟着动。
 * ============================================================ */

export interface SidebarJumpInput {
  /** 真机移动端（含桌面 force-mobile 验收） */
  mobile: boolean;
  /** 这一下确实点在侧栏里 */
  fromSidebar: boolean;
  /** 跳转真的发出去了 */
  jumped: boolean;
}

export function shouldCollapseSidebar(input: SidebarJumpInput): boolean {
  return input.mobile && input.fromSidebar && input.jumped;
}

/** 这一下是不是从侧栏派发的（侧栏根节点带 `.is-side`） */
export function fromSidebarHit(el: HTMLElement | null | undefined): boolean {
  return !!el?.closest?.('.bzs-shell.is-side');
}
