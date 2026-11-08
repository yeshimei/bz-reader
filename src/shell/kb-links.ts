/* ============================================================
 * bz-reader · 知识盒链接的小标签（shell/kb-links.ts）
 *
 * 存过名词 / 段落之后，这条划线就多了一枚可点的链接。以前它是想法正文里的
 * 一串 `[[…]]`——看得见、点不动，用户一改想法还可能顺手删掉。
 *
 * 现在它是一枚按钮：类型（名词 / 段落）+ 笔记名，点一下交给动作表的 `kbopen`。
 * 三处共用这一份（点划线的气泡、侧栏划线列表、笔记页的标注卡），
 * 样式与点击行为不会各长各的。
 * ============================================================ */
import { t } from '../i18n';
import { kbLinkLabel } from '../data/kb-link';
import type { KbLink } from '../data/schema';
import { esc } from './render/html';

/** 一格一颗按钮；没有链接就返回空串（调用方不用自己判） */
export function kbLinksHtml(list?: KbLink[]): string {
  if (!list?.length) return '';
  const items = list.map((k) => {
    const name = kbLinkLabel(k.path) || k.path;
    const kind = t(k.kind === 'term' ? 'kb.kind.term' : 'kb.kind.passage');
    return `<button type="button" class="bzs-kblink${k.kind === 'passage' ? ' is-passage' : ''}" data-act="kbopen" data-path="${esc(
      k.path,
    )}" title="${esc(name)}"><span class="k">${esc(kind)}</span>${esc(name)}</button>`;
  });
  return `<div class="bzs-kblinks">${items.join('')}</div>`;
}
