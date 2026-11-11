/* ============================================================
 * bz-reader · 空壳图标补画（shell/toolbar-icons.ts）
 *
 * `toolbarHtml` 与设置页的图标表都是纯字符串，画不出宿主图标
 * （那要 `setIcon` 和 DOM）。所以模板里只留一个空壳
 * `<span class="bzs-tbi" data-icon="lightbulb">`，渲染进页面之后再统一补画——
 * 图形、描边、主题跟随全部交给 Obsidian，本插件不自绘近似图形，
 * 也就不会出现「和旁边原生图标不是一个东西」。
 *
 * 两个空壳类：
 *   · `.bzs-tbi` —— 划词条按钮（阅读视图的 `showSelbar` 与浮层的 `paint` 调）；
 *   · `.bzs-hicon` —— 设置页「阅读页图标」每行标题前的那枚（书架面板 `render` 调）。
 *
 * 找不到图标名或宿主里没有这枚图标时，位置会空着——所以要保证
 * `TOOLBAR_ITEMS` 与 `header-actions` 里的图标名都是 lucide 的常用项
 * （测试会检查名字齐不齐）。
 * ============================================================ */
import { setIcon } from 'obsidian';

/** 所有「空壳图标」：两套模板共用一个补画入口，省得各写一遍遍历 */
const SLOT = '.bzs-tbi[data-icon], .bzs-hicon[data-icon]';

export function hydrateIcons(root: ParentNode | null | undefined): void {
  if (!root) return;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(SLOT))) {
    const name = el.dataset.icon || '';
    if (!name) continue;
    setIcon(el, name);
  }
}

export function hydrateToolbarIcons(root: ParentNode | null | undefined): void {
  hydrateIcons(root);
}
