/* ============================================================
 * bz-reader · 双链点击接管（shell/link-postprocessor.ts）
 *
 * 笔记里 `[[书.epub#bzr-cfi=…|划线文字]]` 渲染出来是个普通 internal-link。
 * Obsidian 不认识 `#bzr-cfi=…` 这段子路径，点它只会打开书、落到上次的位置。
 * 这里把点击抢下来，交给阅读视图的三级降级（CFI → 原文片段 → 百分比）。
 *
 * 只管阅读视图：Live Preview 里的链接是编辑器装饰器，不经过 post-processor。
 * 那条路点开的是书本身（registerExtensions 兜着），精确到句子做不到——
 * 所以 obsidian:// 那条老路必须一直留着。
 * ============================================================ */
import type { LinkTarget } from '../data/deeplink';
import { parseWikilinkHref } from '../data/wikilink';

/** post-processor 需要的最小宿主能力，方便在测试里替换 */
export interface WikilinkHost {
  /** 按 vault 路径找书；找不到说明这本书没导入，不该拦 */
  bookByPath(path: string): { id: string } | undefined;
  /** 落回原文（三级降级在阅读视图里做） */
  openTarget(t: LinkTarget): void;
}

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

/** 元素上记一笔，post-processor 对同一块可能跑不止一次 */
const BOUND_ATTR = 'data-bzr-wikilink-bound';

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
 * 建 post-processor。每次渲染都会对整个块跑一遍，所以：
 *   1. 只认 `a` 元素，别的不管；
 *   2. 绑过的记一个属性，重复渲染不重复绑（否则一次点击跳好几次）。
 */
export function createWikilinkPostProcessor(host: WikilinkHost) {
  return (el: HTMLElement): void => {
    const links = el.querySelectorAll('a');
    links.forEach((link) => {
      const bound = link.getAttribute(BOUND_ATTR);
      const target = resolveClickTarget(hrefCandidates(link), host.bookByPath);
      if (!target) {
        /* 以前是自家链接、现在书没了（删库 / 改路径）：把旧监听撤掉，
           别让一个已经失效的定位继续抢点击 */
        if (bound) link.removeAttribute(BOUND_ATTR);
        return;
      }
      if (bound === target.bookId) return;

      link.setAttribute(BOUND_ATTR, target.bookId);
      link.addEventListener(
        'click',
        (e: MouseEvent) => {
          /* 捕获阶段拦：Obsidian 的默认处理会去开那个文件，
             等冒泡到它就晚了。stopImmediatePropagation 连同一元素上
             别的监听也一起按住，避免打开两个 tab。 */
          e.preventDefault();
          e.stopImmediatePropagation();
          host.openTarget(target);
        },
        true,
      );
    });
  };
}
