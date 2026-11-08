/* ============================================================
 * bz-reader · 动作结束后的选区收尾（shell/selection-end.ts）
 *
 * 划词工具条上这五颗动作，点完这件事就结束了：
 *   划线（selpen）、双链（selbilink）、复制（selcopy）、
 *   存为名词（selterm）、存为段落（selpassage）
 *
 * 结果已经落袋，选区继续亮着只会挡住正文；手机上更糟——系统会把两端手柄和
 * 「复制 / 全选 / 搜索」菜单一直挂着，压在刚弹出来的浮层下面。
 *
 * 想法 / 书摘 / AI **不算**：面板要对照原文写，选区是参照物；桌面本来就
 * 故意留着（见 reader-view 的 noteTextPanel）。
 * ============================================================ */

const ENDS_SELECTION: ReadonlySet<string> = new Set([
  'selpen',
  'selbilink',
  'selcopy',
  'selterm',
  'selpassage',
]);

/** 这个动作点完要不要把正文里的选区收掉 */
export function endsSelection(act: string | null | undefined): boolean {
  return !!act && ENDS_SELECTION.has(act);
}
