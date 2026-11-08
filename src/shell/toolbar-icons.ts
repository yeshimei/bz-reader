/* ============================================================
 * bz-reader · 工具条图标补画（shell/toolbar-icons.ts）
 *
 * `toolbarHtml` 是纯字符串，画不出宿主图标（那要 `setIcon` 和 DOM）。
 * 所以模板里只留一个空壳 `<span class="bzs-tbi" data-icon="lightbulb">`，
 * 渲染进页面之后再统一补画——图形、描边、主题跟随全部交给 Obsidian，
 * 本插件不自绘近似图形，也就不会出现「和旁边原生图标不是一个东西」。
 *
 * 两个调用点：阅读视图的划词条（`showSelbar`）与浮层重画（`paint`）。
 * 找不到图标名或宿主里没有这枚图标时，按钮会空着——所以要保证
 * `TOOLBAR_ITEMS` 里的图标名都是 lucide 的常用项（测试会检查名字齐不齐）。
 * ============================================================ */
import { setIcon } from 'obsidian';

export function hydrateToolbarIcons(root: ParentNode | null | undefined): void {
  if (!root) return;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.bzs-tbi[data-icon]'))) {
    const name = el.dataset.icon || '';
    if (!name) continue;
    setIcon(el, name);
  }
}
