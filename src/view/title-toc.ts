/* ============================================================
 * bz-reader · 头栏书名「可点」标记（view/title-toc.ts）
 *
 * 书名可点开目录，但 `.view-header-title` 是**宿主**的元素：同一个 leaf
 * 切到别的视图时它会被复用。标记（role / tabindex / class / aria-label）
 * 如果只加不摘，别的视图里那块仍像按钮、读屏还念「打开目录」，点了却
 * 不动（2026-11-09 发版复核）。
 *
 * 所以加与摘成对写在纯函数里：reader-view 负责绑事件，这里只负责属性，
 * 测试也只需要一个假元素。
 * ============================================================ */

/** 挂在头栏元素上的标记 class */
export const TITLE_TOC_CLASS = 'bzr-title-toc';

/** 标记属性：元素上有没有这套语义，看它 */
export const TITLE_TOC_ATTR = 'data-bzr-toc';

/** 这个头栏元素是不是已经绑过（换书不重复叠监听） */
export function isTitleToc(el: HTMLElement): boolean {
  return el.getAttribute(TITLE_TOC_ATTR) === '1';
}

/**
 * 打上「可点书名」的标记。幂等：重复调用不叠属性。
 * @param label 读屏念的那句（「打开目录」）
 * @param title 鼠标悬停的完整文案（书名 · 打开目录）
 */
export function markTitleToc(el: HTMLElement, label: string, title: string): void {
  el.classList.add(TITLE_TOC_CLASS);
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', label);
  el.setAttribute('title', title);
  el.setAttribute(TITLE_TOC_ATTR, '1');
}

/**
 * 摘掉整套标记，把元素还给宿主。
 *
 * `restoreTitle` 是还原后的悬停文案（书架那边的书名），传空串就删掉 title。
 */
export function clearTitleToc(el: HTMLElement, restoreTitle = ''): void {
  el.classList.remove(TITLE_TOC_CLASS);
  el.removeAttribute('role');
  el.removeAttribute('tabindex');
  el.removeAttribute('aria-label');
  el.removeAttribute(TITLE_TOC_ATTR);
  if (restoreTitle) el.setAttribute('title', restoreTitle);
  else el.removeAttribute('title');
}
