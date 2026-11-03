/**
 * 划词条上的按钮（纯函数，node 里可直接测）。
 *
 * 顺序：想法 → 书摘 →（AI 解释）→ 双链 → 复制。
 * 双链放在复制前面：双链是「带着出处的引用」，复制只是纯文本，
 * 常写笔记的人先要前者。AI 只在可用时出现，不占位成灰按钮。
 */

export interface SelbarAction {
  label: string;
  act: string;
}

export function selbarActions(opts: { ai: boolean }): SelbarAction[] {
  return [
    { label: '想法', act: 'selidea' },
    { label: '书摘', act: 'selquote' },
    ...(opts.ai ? [{ label: 'AI 解释', act: 'selai' }] : []),
    { label: '双链', act: 'selbilink' },
    { label: '复制', act: 'selcopy' },
  ];
}