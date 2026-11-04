/**
 * 划词条上的按钮（纯函数，node 里可直接测）。
 *
 * 顺序：想法 → 书摘 → AI 解释 → 双链 → 复制。
 *
 * 入口平权：**任何版本都显示全部按钮**。没解锁的人点 AI / 双链时由
 * actions 里的 requireCap 弹出高级版对照页——看得见、点得到，才知道
 * 自己买的是什么。以前按 can() 把 AI 藏掉，用户根本不知道有这项。
 */

export interface SelbarAction {
  label: string;
  act: string;
}

export function selbarActions(): SelbarAction[] {
  return [
    { label: '想法', act: 'selidea' },
    { label: '书摘', act: 'selquote' },
    { label: 'AI 解释', act: 'selai' },
    { label: '双链', act: 'selbilink' },
    { label: '复制', act: 'selcopy' },
  ];
}
