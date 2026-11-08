/* ============================================================
 * bz-reader · blob iframe → srcdoc（移动端唯一的活路）
 *
 * 现象：安卓上打开书一片白，日志里什么都没有。
 * 原因：Obsidian 移动端（Capacitor 壳）给页面下的 CSP 是
 *       `default-src 'self' data: …`。`frame-src` / `connect-src` 都回落到
 *       `default-src`，而 `blob:` 不属于 `'self'` —— foliate 分页器把章节写成
 *       `blob:` 地址塞进 iframe，这个 iframe 既不 load 也不 error，永远等下去。
 *       真机实测：blob 帧 4s 无响应（带不带 sandbox 都一样），srcdoc ✓、fetch ✓。
 *
 * 解法（与同目录 weave 阅读器同一套，真机验证过）：
 *   1. 拦 `URL.createObjectURL/revokeObjectURL`，把 Blob 对象留下来
 *      —— foliate 换章时会 revoke，之后还要读原文；
 *   2. 拦 `HTMLIFrameElement.prototype.src`：遇到 `part="filter"` 的 foliate
 *      章节 iframe 且地址是 blob:，就把原文读出来、把 CSS/图片内联成 `data:`
 *      （CSP 放行 data:）、删掉书自带的 CSP/脚本，再写 `srcdoc`。
 *
 * 为什么必须在 iframe 这一层拦：foliate 的章节地址是在 vendor 里拼的，
 * 换格式（epub/fb2/txt/mobi）各有各的拼法；拦 iframe 只有一处，全覆盖。
 * ============================================================ */

import { keepBlob as keepEntry, type KeptBlob } from './blob-registry';

type GlobalWithPatches = typeof window & {
  /**
   * 「我们这一层包装**之前**的现状」与「我们装的那层包装」。
   *
   * 不能只记首次的原生函数（A-32）：同一个页面里别的插件也会包
   * `URL.createObjectURL` / `iframe.src`。卸载时只有当前这层仍是我们装的，
   * 才还原到「安装前的现状」；否则保持现状，别把别人的包装抹掉。
   */
  __bzrPrevCreateObjectURL__?: typeof URL.createObjectURL;
  __bzrPrevRevokeObjectURL__?: typeof URL.revokeObjectURL;
  __bzrOurCreateObjectURL__?: typeof URL.createObjectURL;
  __bzrOurRevokeObjectURL__?: typeof URL.revokeObjectURL;
  __bzrPrevIframeSrcSet__?: (this: HTMLIFrameElement, value: string) => void;
  __bzrPrevIframeSrcGet__?: (this: HTMLIFrameElement) => string;
  __bzrOurIframeSrcSet__?: (this: HTMLIFrameElement, value: string) => void;
};

/**
 * blob URL → Blob。foliate revoke 之后仍然可读——这正是这套补丁的前提。
 *
 * 必须挂在 globalThis 上：插件停用/启用会在同一个页面里重新执行 main.js，
 * 而 URL.createObjectURL 的补丁只装一次（老闭包还在用老的 Map）。Map 放在
 * 模块作用域里，新实例就永远读不到旧闭包写进去的 Blob。
 *
 * 淘汰规则见 `blob-registry.ts`：按字节（64MB），先扔已 revoke 的最旧条目。
 * 旧版按条数（96 条）会在漫画上钉住上百 MB，也会被别的插件的 URL 挤掉书里的。
 */
const blobs = ((window as unknown as { __bzrBlobs?: Map<string, KeptBlob> }).__bzrBlobs ??=
  new Map<string, KeptBlob>());
/** 单张图片内联上限：再大就别塞 data: 了，宁可这张图不显示 */
const MAX_INLINE_IMAGE = 3 * 1024 * 1024;
/**
 * 整章内联总量预算（P2-18 / B6）：**CSS 里的 blob 与正文图片共用这一个池子**。
 *
 * 以前只有单张上限：一章 20 张 1MB 的图会变成约 27MB 的字符串挂在一个
 * `srcdoc` 属性上，手机上换章明显停顿甚至 OOM。超预算的图保留原 blob 地址
 * （能显示就显示，显示不了也不拖垮整章）。
 *
 * 2026-11-08 起 CSS 背景图也从这里扣：分开算的时候，一份背景图很重的书能
 * 一边用掉图片的 8MB、一边再往里塞一堆 CSS 图，两条预算各挡各的、谁也拦不住总量。
 */
const MAX_INLINE_TOTAL = 8 * 1024 * 1024;

/**
 * srcdoc 总长硬上限（B6）。
 *
 * 单张上限 + 整章预算挡的是「资源太多」，挡不住「一章正文本身就很大」
 * （排版很碎的书，一章 HTML 十几 MB 不稀奇）。srcdoc 是一个属性值，
 * 十几 MB 的字符串在移动端 WebView 里解析就能把页面卡死。
 * 真超了只砍 data: 资源（图退回占位），正文一个字不动——先能读，再看图。
 */
const MAX_SRCDOC_LEN = 12 * 1024 * 1024;

/** 超上限时反复剥 data: 资源，直到进线或没得剥 */
function capSrcdoc(html: string): string {
  if (html.length <= MAX_SRCDOC_LEN) return html;
  let out = html;
  for (let i = 0; i < 4 && out.length > MAX_SRCDOC_LEN; i += 1) {
    out = out
      .replace(/srcset="[^"]*data:[^"]*"/gi, 'srcset=""')
      .replace(/(src|href)="data:[^"]*"/gi, '$1=""')
      .replace(/url\((['"]?)data:[^'")]*\1\)/gi, 'none');
  }
  return out;
}

function isBlobUrl(url: string): boolean {
  return String(url || '').trim().toLowerCase().startsWith('blob:');
}

function blobOf(url: string): Blob | null {
  return blobs.get(String(url || '').trim())?.blob ?? null;
}

async function readText(url: string): Promise<string> {
  const blob = blobOf(url);
  if (blob) return blob.text();
  /* blob: 地址只能交给浏览器读，requestUrl 只发 HTTP 请求。 */
  const res = await window.fetch(url);
  return res.text();
}

/** 拿 blob：注册表里有就直接用（foliate 已经 revoke 也还在），没有才走 fetch */
async function resolveBlob(url: string): Promise<Blob | null> {
  const kept = blobOf(url);
  if (kept) return kept;
  try {
    return (await (await window.fetch(url)).blob());
  } catch {
    return null;
  }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  });
}

async function readDataUrl(url: string, ctx: InlineCtx): Promise<string> {
  const hit = ctx.cache.get(url);
  if (hit) return hit;
  const job = (async () => {
    const blob = await resolveBlob(url);
    if (!blob || blob.size === 0) return '';
    if (blob.size > MAX_INLINE_IMAGE || blob.size > ctx.budget.left) return '';
    ctx.budget.left -= blob.size;
    const data = await toDataUrl(blob);
    /* 读失败把预算还回去：一张坏图不该把后面几张图的额度吃掉 */
    if (!data) ctx.budget.left += blob.size;
    return data;
  })().catch(() => '');
  ctx.cache.set(url, job);
  return job;
}

/**
 * 内联的共享上下文：**整章一份**。
 *
 * 以前 CSS 里的 blob 与正文图片各算各的预算，一份背景图很重的书能一边吃掉
 * 8MB 图片、一边再塞进去一堆 CSS 图，最后拼成一个几十 MB 的 srcdoc。
 * 现在两者共用一个 8MB 池子，同一个地址也只读一次。
 */
interface InlineCtx {
  /** 还能内联多少**原始字节** */
  budget: { left: number };
  /** url → data URL 的 Promise：同一地址在一次内联里只读一次 */
  cache: Map<string, Promise<string>>;
}

function newCtx(): InlineCtx {
  return { budget: { left: MAX_INLINE_TOTAL }, cache: new Map() };
}

/** @import 的展开深度上限：链式互相 import 的样式表不该把主线程卡死 */
const MAX_CSS_DEPTH = 8;

/** CSS 里的 url(blob:…) 换成 data:；@import blob: 直接展开 */
async function inlineCss(
  css: string,
  ctx: InlineCtx,
  depth = 0,
  visited: Set<string> = new Set(),
): Promise<string> {
  let out = String(css || '');
  if (depth >= MAX_CSS_DEPTH) {
    /* 到顶了就别再往下走：把还没展开的 @import blob: 整条删掉。
       留着等于把一个 CSP 挡住的地址交给渲染器——样式没生效，还多一次失败请求。 */
    return out.replace(/@import\s+(?:url\()?['"]?blob:[^'")]+['"]?\)?\s*;/gi, '');
  }
  for (const match of Array.from(out.matchAll(/@import\s+(?:url\()?['"]?([^'")]+)['"]?\)?\s*;/gi))) {
    const href = (match[1] || '').trim();
    if (!isBlobUrl(href)) continue;
    /* 循环 import（A→B→A）会无限递归到栈溢出，这不是理论问题：
       有的 EPUB 把 reset.css 互相 import 了一遍。见过就删这条，别再看第二眼。 */
    if (visited.has(href)) {
      out = out.replace(match[0], '');
      continue;
    }
    visited.add(href);
    const imported = await readText(href).catch(() => '');
    out = out.replace(match[0], imported ? await inlineCss(imported, ctx, depth + 1, visited) : '');
  }
  for (const match of Array.from(out.matchAll(/url\(\s*(['"]?)(blob:[^'")]+)\1\s*\)/gi))) {
    const href = (match[2] || '').trim();
    const data = await readDataUrl(href, ctx);
    if (data) out = out.replace(match[0], `url("${data}")`);
  }
  return out;
}

/** srcset 的一个候选项：URL + 描述符（`2x` / `640w`，可为空） */
export interface SrcsetCandidate {
  url: string;
  descriptor: string;
}

/**
 * 拆 srcset（A-35）。
 *
 * 不能简单 `split(',')`：data: URL 本身带逗号。按 HTML 规范的思路扫：
 * 跳过空白/逗号 → 读到空白前的整段算 URL → 再读到逗号算描述符。
 */
export function parseSrcset(value: string): SrcsetCandidate[] {
  const s = String(value || '');
  const out: SrcsetCandidate[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i += 1;
    if (i >= s.length) break;
    const start = i;
    while (i < s.length && !/\s/.test(s[i])) i += 1;
    let url = s.slice(start, i);
    /* 规范允许 URL 后面紧跟逗号（`a.png,b.png 2x`）：尾部逗号是分隔符 */
    while (url.endsWith(',')) url = url.slice(0, -1);
    while (i < s.length && /\s/.test(s[i])) i += 1;
    let descriptor = '';
    if (i < s.length && s[i] !== ',') {
      const dStart = i;
      while (i < s.length && s[i] !== ',') i += 1;
      descriptor = s.slice(dStart, i).trim();
    }
    if (i < s.length && s[i] === ',') i += 1;
    if (url) out.push({ url, descriptor });
  }
  return out;
}

export function formatSrcset(items: SrcsetCandidate[]): string {
  return items.map((it) => (it.descriptor ? `${it.url} ${it.descriptor}` : it.url)).join(', ');
}

/** 一次内联的落点：URL 换成 data: 之后写回哪个属性 */
interface InlineTarget {
  url: string;
  apply: (data: string) => void;
}

/**
 * 批量内联 blob URL（A-07 / A-35）。
 *
 * 预算按 **blob.size** 扣，不按 base64 字符串长度（后者虚高约 33%，会让
 * 整章预算提前见底）。同一个 URL 只读一次、只扣一次预算——src 与 srcset
 * 共用一张图很常见。任何一步失败都**什么都不写**，调用方保留原 blob 地址。
 */
async function inlineTargets(targets: InlineTarget[], ctx: InlineCtx): Promise<void> {
  const resolved = new Map<string, string>();
  for (const target of targets) {
    if (resolved.has(target.url)) continue;
    resolved.set(target.url, await readDataUrl(target.url, ctx));
  }
  for (const target of targets) {
    const data = resolved.get(target.url);
    if (data) target.apply(data);
  }
}

/** SVG 的 xlink:href 解析后是 XLink 命名空间属性，改它必须走 setAttributeNS */
function setSvgHref(el: Element, attr: string, data: string): void {
  if (attr === 'xlink:href' && typeof el.setAttributeNS === 'function') {
    el.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', data);
    return;
  }
  el.setAttribute(attr, data);
}

/**
 * 把一章 HTML 变成可以直接 srcdoc 的字符串。
 *
 * 除内联资源外还要做三件事：
 *   · 删 `script/iframe/object/embed` —— 黑名单是第一道；
 *   · 删书自带的 `Content-Security-Policy` / `refresh` meta —— 它会挡住我们内联的 data:；
 *   · 删 `on*` 属性与 `javascript:` 地址。
 *
 * **黑名单不是安全边界**（P1-01）：`DOMParser 解析 → outerHTML 序列化 →
 * 浏览器再解析` 这条路本身能造出解析树里不存在的标签（mXSS，`<style>` /
 * `<noscript>` 里藏标签那类），而黑名单是在解析后的树上跑的，看不见序列化
 * 之后才出现的东西。真正的边界是 iframe 上的 `sandbox`（见 installIframeSrcPatch）。
 */
export async function inlineMarkup(raw: string): Promise<string> {
  const doc = new DOMParser().parseFromString(String(raw || ''), 'text/html');
  /* 整章一份上下文：CSS 图与正文图片共用一个字节池，同一地址只读一次 */
  const ctx = newCtx();

  for (const el of Array.from(doc.querySelectorAll('script, iframe, object, embed'))) el.remove();

  for (const meta of Array.from(doc.querySelectorAll('meta[http-equiv]'))) {
    const kind = (meta.getAttribute('http-equiv') || '').trim().toLowerCase();
    if (kind === 'refresh' || kind === 'content-security-policy') meta.remove();
  }

  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      else if (
        /^(href|src|formaction|xlink:href)$/i.test(attr.name) &&
        /^\s*(?:javascript|vbscript)\s*:/i.test(attr.value)
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }

  for (const style of Array.from(doc.querySelectorAll('style'))) {
    if (style.textContent && style.textContent.includes('blob:')) {
      style.textContent = await inlineCss(style.textContent, ctx);
    }
  }

  /* <link rel=stylesheet href=blob:> → 内联 <style>（CSP 下 blob 样式表加载不了） */
  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const href = link.getAttribute('href') || '';
    if (/^https?:|^\/\//i.test(href)) {
      link.remove();
      continue;
    }
    if (!isBlobUrl(href)) continue;
    const css = await readText(href).catch(() => '');
    if (!css) {
      link.remove();
      continue;
    }
    /* 样式元素走 createEl（Obsidian 全局助手），随后随 link.replaceWith
       一起被 adopt 进本章的 iframe 文档。 */
    const style = createEl('style');
    style.textContent = await inlineCss(css, ctx);
    link.replaceWith(style);
  }

  /* 图片/封面内联：整章有总量预算（P2-18 / A-07 / A-35）。
     超过单张上限或预算耗尽时**保留原 blob 地址**——以前直接删 src，图片
     变成一个空壳，用户连「图裂了」都看不到；现在至少能显示就显示，
     显示不了也不拖垮整章。 */
  const targets: InlineTarget[] = [];

  for (const img of Array.from(doc.querySelectorAll('img[src]'))) {
    const src = img.getAttribute('src') || '';
    if (isBlobUrl(src)) targets.push({ url: src, apply: (data) => img.setAttribute('src', data) });
  }

  /* `<svg><image href>` 是 EPUB 封面的常见写法；xlink:href 是老写法，两个都认 */
  for (const image of Array.from(doc.querySelectorAll('image'))) {
    for (const attr of ['href', 'xlink:href']) {
      const url = image.getAttribute(attr) || '';
      if (isBlobUrl(url)) targets.push({ url, apply: (data) => setSvgHref(image, attr, data) });
    }
  }

  /* srcset：img 与 source（<picture>）都要拆开逐条转，描述符原样保留 */
  for (const el of Array.from(doc.querySelectorAll('[srcset]'))) {
    const items = parseSrcset(el.getAttribute('srcset') || '');
    if (!items.some((it) => isBlobUrl(it.url))) continue;
    for (const item of items) {
      if (!isBlobUrl(item.url)) continue;
      targets.push({
        url: item.url,
        apply: (data) => {
          item.url = data;
          el.setAttribute('srcset', formatSrcset(items));
        },
      });
    }
  }

  await inlineTargets(targets, ctx);

  for (const el of Array.from(doc.querySelectorAll('[style]'))) {
    const style = el.getAttribute('style') || '';
    if (style.includes('blob:')) el.setAttribute('style', await inlineCss(style, ctx));
  }

  return capSrcdoc(`<!doctype html>${doc.documentElement.outerHTML}`);
}

/** 1) 留住 Blob：foliate 换章会 revokeObjectURL，之后还得读原文 */
function installUrlRegistry(): void {
  const g = window as GlobalWithPatches;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- 取当前实现做链式基线，不调用
  const currentCreate = URL.createObjectURL;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- 同上
  const currentRevoke = URL.revokeObjectURL;

  /* 基线 = 安装前一刻的现状（A-32）。只有当前这层仍是我们上次装的包装，
     才沿用更早存下的「前一层」；否则说明中间有别的插件包过一层，
     以它为新基线——卸载时还原到它，绝不能越过它写回最早的原生函数。 */
  if (currentCreate !== g.__bzrOurCreateObjectURL__) {
    g.__bzrPrevCreateObjectURL__ = currentCreate;
  }
  if (currentRevoke !== g.__bzrOurRevokeObjectURL__) {
    g.__bzrPrevRevokeObjectURL__ = currentRevoke;
  }
  const baseCreate = g.__bzrPrevCreateObjectURL__ ?? currentCreate;
  const baseRevoke = g.__bzrPrevRevokeObjectURL__ ?? currentRevoke;

  const create = (blob: Blob): string => {
    const url = baseCreate.call(URL, blob);
    try {
      keepEntry(blobs, url, blob);
    } catch {
      /* 留不住也不影响主流程 */
    }
    return url;
  };
  const revoke = (url: string): void => {
    try {
      baseRevoke.call(URL, url);
    } catch {
      /* 回收失败无所谓 */
    }
    /* **标记而不是删除**：句柄已经废了，但 foliate 换章后我们还要读原文。
       标记之后淘汰顺序会优先扔它，等于「用完了但先留着」。 */
    const kept = blobs.get(url);
    if (kept) kept.revoked = true;
  };

  g.__bzrOurCreateObjectURL__ = create;
  g.__bzrOurRevokeObjectURL__ = revoke;
  URL.createObjectURL = create;
  URL.revokeObjectURL = revoke;
}

/**
 * 2) 拦 iframe.src：blob 地址 → 读原文 → 内联 → srcdoc
 *
 * 顺手给章节 iframe 挂 `sandbox="allow-same-origin"`（P1-01）。
 *
 * 为什么是这两个词的组合：
 *   · `allow-same-origin` 必须留——foliate 的父页面要读 `contentDocument`
 *     来分页、取选区、画高亮；去掉它，翻页和划词全废。
 *   · `allow-scripts` 坚决不给——书里的 `<script>` 已经被黑名单删了，但 mXSS
 *     能在序列化之后造出新的；只有浏览器级的「不执行脚本」能兜住这一层。
 *
 * 副作用：sandbox 里没有 `allow-popups` / `allow-forms` / `allow-top-navigation`，
 * 书里的外链点了不会跳转（本来也不该跳）。真机要回归：翻页、脚注、划词。
 */
function installIframeSrcPatch(): void {
  if (typeof HTMLIFrameElement === 'undefined') return;
  const g = window as GlobalWithPatches;
  const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
  if (!desc?.set) return;
  /* 同 URL 补丁：基线是「安装前的当前 setter」，不是首次的原生 setter */
  if (desc.set !== g.__bzrOurIframeSrcSet__) {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- 存原生 setter 供还原
    g.__bzrPrevIframeSrcSet__ = desc.set;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- 存原生 getter 供还原
    g.__bzrPrevIframeSrcGet__ = desc.get ?? undefined;
  }
  // eslint-disable-next-line @typescript-eslint/unbound-method -- 存的是原生 setter，调用时显式 .call(this)
  const originalSet = g.__bzrPrevIframeSrcSet__ ?? desc.set;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- 同上
  const originalGet = g.__bzrPrevIframeSrcGet__ ?? desc.get ?? undefined;
  const tokens = new WeakMap<HTMLIFrameElement, number>();

  const getSrc = function (this: HTMLIFrameElement): string {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- 原生 getter 的返回值就是 string，类型描述符丢了
    return originalGet ? originalGet.call(this) : this.getAttribute('src') || '';
  };
  const setSrc = function (this: HTMLIFrameElement, value: string): void {
    const url = String(value ?? '');
    /* 只接管 foliate 的章节 iframe：paginator 与 fixed-layout 都挂了 part="filter"。
       别的插件 / 宿主自己的 blob iframe 一概不碰。 */
    const part = (this.getAttribute('part') || '').toLowerCase();
    if (!isBlobUrl(url) || !part.includes('filter')) {
      originalSet.call(this, url);
      return;
    }
    /* 脚本执行交给浏览器，不指望黑名单。写在 srcdoc 之前，避免那一瞬间
       iframe 已经按无 sandbox 的状态加载过一次。 */
    try {
      this.setAttribute('sandbox', 'allow-same-origin');
    } catch {
      /* 老 WebView 不支持就退回只靠黑名单，别让开书失败 */
    }
    const token = (tokens.get(this) || 0) + 1;
    tokens.set(this, token);
    void (async () => {
      try {
        const html = await readText(url);
        if (tokens.get(this) !== token) return;
        const inlined = await inlineMarkup(html);
        if (tokens.get(this) !== token) return;
        this.srcdoc = inlined;
      } catch {
        /* 读不出来就退回原地址：至少和打补丁前一个行为 */
        if (tokens.get(this) !== token) return;
        originalSet.call(this, url);
      }
    })();
  };

  g.__bzrOurIframeSrcSet__ = setSrc;
  Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
    configurable: true,
    enumerable: desc.enumerable ?? true,
    get: getSrc,
    set: setSrc,
  });
}

/** 插件 onload 时调一次（幂等） */
export function installBlobSrcdocPatches(): void {
  installUrlRegistry();
  installIframeSrcPatch();
}

/**
 * 插件 onunload 时调（P2-13 / A-32）。
 *
 * 不还原的话，禁用/卸载插件后页面里仍留着 bz 的包装：`URL.createObjectURL`
 * 继续把**别的插件**造的 Blob 收进我们的表（最多 64MB），`iframe.src` 的
 * setter 也还是我们的。
 *
 * 但还原必须**只还原自己那层**：当前函数仍是 `__bzrOur*__` 才写回
 * `__bzrPrev*__`；如果中间有别的插件又包了一层（当前值不是我们的），
 * 保持现状——抹掉别人的补丁比多留一层更糟。
 */
export function uninstallBlobSrcdocPatches(): void {
  const g = window as GlobalWithPatches;
  try {
    if (g.__bzrOurCreateObjectURL__ && URL.createObjectURL === g.__bzrOurCreateObjectURL__) {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- 备份链里读当前函数
      URL.createObjectURL = g.__bzrPrevCreateObjectURL__ ?? URL.createObjectURL;
    }
  } catch {
    /* 还原失败不影响卸载流程 */
  }
  try {
    if (g.__bzrOurRevokeObjectURL__ && URL.revokeObjectURL === g.__bzrOurRevokeObjectURL__) {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- 同上
      URL.revokeObjectURL = g.__bzrPrevRevokeObjectURL__ ?? URL.revokeObjectURL;
    }
  } catch {
    /* 同上 */
  }
  try {
    if (typeof HTMLIFrameElement !== 'undefined' && g.__bzrOurIframeSrcSet__) {
      const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
      if (desc?.set === g.__bzrOurIframeSrcSet__) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
          configurable: true,
          enumerable: desc.enumerable ?? true,
          get: g.__bzrPrevIframeSrcGet__,
          set: g.__bzrPrevIframeSrcSet__,
        });
      }
    }
  } catch {
    /* 同上 */
  }
  blobs.clear();
}

/**
 * 拿回某个 blob URL 背后的 Blob（即使它已经被 revoke）。
 *
 * 宿主 CSP 只放行 `data:` 图片，所以封面这类要显示在**应用页面**（不是书页
 * iframe）里的图，得转成 data URL 才出得来。
 */
export function blobForUrl(url: string): Blob | null {
  return blobOf(url);
}
