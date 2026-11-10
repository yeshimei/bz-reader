/* ============================================================
 * bz-reader · 点一下就落线（shell/auto-mark.ts）
 *
 * 划词条上这三颗：双链 / 存为名词 / 存为段落。它们原来都把结果放在别处——
 * 双链进剪贴板、知识盒要等 bz 保存成功才补一条划线——用户回头在书里
 * 找不到这段字。2026-11-10 起和「想法」一个口径：点下去，这段文字就先
 * 在书里标出来，再做原来那件事。
 *
 * 判据单独放这里，和 shell/selection-end.ts 的「点完收不收选区」并列：
 * 一个管「留什么」，一个管「收什么」。
 * ============================================================ */

const AUTO_MARK_ACTS: ReadonlySet<string> = new Set(['selbilink', 'selterm', 'selpassage']);

/** 这个动作点完要不要先把这段文字落成一条划线 */
export function autoMarks(act: string | null | undefined): boolean {
  return !!act && AUTO_MARK_ACTS.has(act);
}
