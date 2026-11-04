/* ============================================================
 * bz-reader · 书摘卡渲染（shell/render/quote-card.ts）
 *
 * 纯函数：给「引文 + 出处 + 模板」，返回卡片 HTML。不放 DOM 操作，
 * 这样多模板的版式分支可以直接测（class 有没有带上、文字有没有转义）。
 * ============================================================ */
import { CARD_TEMPLATES, normalizeCardTemplate } from '../card-template';
import { esc } from './html';

export interface QuoteCardInput {
  text: string;
  bookTitle: string;
  author: string;
  chapter: string;
  /** 模板 id；不传/认不出都按经典渲染 */
  template?: string;
}

/** 一张书摘卡。经典版不加后缀，其余走 `tpl-*` 由 CSS 改版式 */
export function quoteCardHtml(input: QuoteCardInput): string {
  const tpl = normalizeCardTemplate(input.template);
  const cls = tpl === 'classic' ? 'bzs-qcard' : `bzs-qcard tpl-${tpl}`;
  return `<div class="${cls}">
      <div class="q">${esc(input.text)}</div>
      <div class="loc">${esc(input.bookTitle)} · ${esc(input.author)} · ${esc(input.chapter)}</div>
      <div class="stamp">bz 阅读</div>
    </div>`;
}

/** 版式切换按钮：当前选中的那颗高亮 */
export function cardTemplateChipsHtml(current?: string): string {
  const now = normalizeCardTemplate(current);
  return `<div class="bzs-tpls">${CARD_TEMPLATES.map(
    (t) =>
      `<button class="bzs-chip${t.id === now ? ' on' : ''}" data-act="cardtpl" data-v="${t.id}" title="${esc(t.hint)}">${t.label}</button>`,
  ).join('')}</div>`;
}
