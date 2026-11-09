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
  /* 不放「bz 阅读」印章：这是用户的摘抄，右下角留白比一枚自家小印好看，
     也免得截图分享时像广告。出处那一行已经有「书名 · 作者 · 章节」。 */
  return `<div class="${cls}">
      <div class="q">${esc(input.text)}</div>
      <div class="loc">${esc(input.bookTitle)} · ${esc(input.author)} · ${esc(input.chapter)}</div>
    </div>`;
}

export interface QuoteRefInput {
  text: string;
  title?: string;
  author?: string;
  chapter?: string;
}

/**
 * 「复制引用」与书摘卡「存笔记」共用的纯文本形态。
 *
 * 以前两处各拼一份：浮层里的复制按钮写 `「引文」\n— 书名 · 作者 · 章节`，
 * 存笔记直接导出整本书。现在只拼**这一条**，两处引用同一份格式，
 * 用户从剪贴板粘的与落进笔记的不会长得不一样。
 */
export function quoteRefMarkdown(input: QuoteRefInput): string {
  const text = String(input.text ?? '').trim();
  const title = String(input.title ?? '').trim();
  const author = String(input.author ?? '').trim();
  const chapter = String(input.chapter ?? '').trim() || '未命名章节';
  const from = [title, author, chapter].filter(Boolean).join(' · ');
  return `「${text}」\n— ${from}`;
}

/** 版式切换按钮：当前选中的那颗高亮 */
export function cardTemplateChipsHtml(current?: string): string {
  const now = normalizeCardTemplate(current);
  return `<div class="bzs-tpls">${CARD_TEMPLATES.map(
    (t) =>
      `<button class="bzs-chip${t.id === now ? ' on' : ''}" data-act="cardtpl" data-v="${t.id}" title="${esc(t.hint)}">${t.label}</button>`,
  ).join('')}</div>`;
}
