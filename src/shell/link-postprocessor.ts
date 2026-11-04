/* ============================================================
 * bz-reader · 双链点击接管（shell/link-postprocessor.ts）
 *
 * 笔记里 `[[书.epub#bzr-cfi=…|划线文字]]` 渲染出来是个普通 internal-link。
 * Obsidian 不认识 `#bzr-cfi=…` 这段子路径，点它只会打开书、落到上次的位置。
 * 这里把点击抢下来，交给阅读视图的三级降级（CFI → 原文片段 → 百分比）。
 *
 * **为什么是全局捕获，不是 markdown post-processor**：
 *   post-processor 只在阅读视图跑。Live Preview（编辑模式）里的链接是编辑器
 *   装饰器，不经过它——点下去走 Obsidian 默认处理，把 .epub 打开、替换掉当前
 *   笔记，用户回都回不来。全局捕获在 document 的捕获阶段先手，两边都能拦。
 *
 * 只认自家子路径：普通笔记链接、别的插件写的锚点、obsidian:// 老链接一律放行。
 * ============================================================ */
import type { LinkTarget } from '../data/deeplink';
import { parseWikilinkHref } from '../data/wikilink';

/**
 * 这个链接该不该接管？该的话返回要跳的定位，否则 null。
 *
 * 纯函数：不碰 DOM，不调 Obsidian。三种情况都返回 null——
 * 不是自家子路径、书不在库里、定位字段全空——让宿主按默认行为处理。
 */
export function planWikilinkClick(
  href: string,
  bookByPath: (path: string) => { id: string } | undefined,
): LinkTarget | null {
  const parsed = parseWikilinkHref(href);
  if (!parsed) return null;
  const book = bookByPath(parsed.vaultPath);
  if (!book) return null;
  return { ...parsed.target, bookId: book.id };
}

/**
 * 从链接元素里取候选地址。
 *
 * 优先 `data-href`：那是 Obsidian 存下来的原始 linktext，桌面与移动端都是它。
 * `href` 在移动端会被改写成 `app://obsidian.md/…`，所以只当备胎。
 */
export function hrefCandidates(el: Element): string[] {
  const out: string[] = [];
  for (const attr of ['data-href', 'href']) {
    const v = el.getAttribute(attr);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** 从候选地址里挑出第一个能接管的定位 */
export function resolveClickTarget(
  hrefs: string[],
  bookByPath: (path: string) => { id: string } | undefined,
): LinkTarget | null {
  for (const href of hrefs) {
    const target = planWikilinkClick(href, bookByPath);
    if (target) return target;
  }
  return null;
}

/**
 * 全局点击捕获用：从点击目标往上找到链接元素，判断要不要接管。
 *
 * 选择器要同时认 `a[href]` 与 `[data-href]`：Live Preview 里的链接不保证是
 * `<a>`（CM6 装饰器），但一定带着 `data-href`。
 */
export function interceptableClick(
  target: Element | null,
  bookByPath: (path: string) => { id: string } | undefined,
): LinkTarget | null {
  const link = target?.closest?.('a[data-href], a[href], [data-href]') ?? null;
  if (!link) return null;
  return resolveClickTarget(hrefCandidates(link), bookByPath);
}
