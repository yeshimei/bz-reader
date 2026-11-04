/* ============================================================
 * bz-reader · 书摘卡模板（shell/card-template.ts）
 *
 * 划线卡片以前只有一种版式。它是全插件最容易被截图分享的东西，
 * 却让所有人在朋友圈发同一张图。这里定义可选版式，纯数据，渲染在
 * `render/quote-card.ts`。
 *
 * 模板是**展示层**的枚举：存进弹层时用它的 id，认不出来的一律退回
 * 「经典」——旧版本弹层状态、手改的 mode 都不该让卡片白屏。
 * ============================================================ */

export type CardTemplate = 'classic' | 'letter' | 'night' | 'film';

export interface CardTemplateDef {
  id: CardTemplate;
  label: string;
  hint: string;
}

export const CARD_TEMPLATES: readonly CardTemplateDef[] = [
  { id: 'classic', label: '经典', hint: '墨与铜，像从书里撕下来的一页' },
  { id: 'letter', label: '信笺', hint: '横线纸，适合抄长句' },
  { id: 'night', label: '夜读', hint: '深色底，夜里发不刺眼' },
  { id: 'film', label: '胶片', hint: '大留白 + 竖排片名，像一张票根' },
];

/** 任意输入 → 认识的模板 id；不认识的退回经典 */
export function normalizeCardTemplate(v: unknown): CardTemplate {
  return CARD_TEMPLATES.find((t) => t.id === v)?.id ?? 'classic';
}
