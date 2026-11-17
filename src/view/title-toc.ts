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

/** 本模块塞进去的视觉隐藏文本节点，摘标记时一并清掉（幂等的前提） */
const SR_CLASS = 'bzs-sr-only bzr-title-toc-sr';

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
  if (isTitleToc(el)) return;
  el.classList.add(TITLE_TOC_CLASS);
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  /* Obsidian 把 aria-label / title 变成悬停气泡；可读名字改用视觉隐藏文本。
     label 与 title 取其一——两者都塞读屏会连读两遍。 */
  const span = createSpan();
  SR_CLASS.split(' ').forEach((c) => span.classList.add(c));
  span.textContent = label || title;
  el.appendChild(span);
  el.setAttribute(TITLE_TOC_ATTR, '1');
}

/**
 * 摘掉整套标记，把元素还给宿主（含本模块塞进去的隐藏文本，幂等）。
 * `restoreTitle` 保留参数以兼容调用方：宿主书名本来就是可见文本，无需再补隐藏节点。
 */
export function clearTitleToc(el: HTMLElement, _restoreTitle = ''): void {
  el.classList.remove(TITLE_TOC_CLASS);
  el.removeAttribute('role');
  el.removeAttribute('tabindex');
  el.removeAttribute('aria-label');
  el.removeAttribute('title');
  el.removeAttribute(TITLE_TOC_ATTR);
  /* 直接遍历子节点：桩环境里 querySelectorAll 返回空，真机上也能摘干净。 */
  [...el.children].filter((n) => (n as HTMLElement).classList?.contains('bzr-title-toc-sr')).forEach((n) => n.remove());
}
