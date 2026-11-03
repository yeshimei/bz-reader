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

import { keepBlob as keepEntry, pruneBlobs, type KeptBlob } from './blob-registry';

type GlobalWithPatches = typeof globalThis & {
  __bzrOrigCreateObjectURL__?: typeof URL.createObjectURL;
  __bzrOrigRevokeObjectURL__?: typeof URL.revokeObjectURL;
  __bzrIframeSrcPatched__?: boolean;
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
const blobs = ((globalThis as unknown as { __bzrBlobs?: Map<string, KeptBlob> }).__bzrBlobs ??=
  new Map<string, KeptBlob>());
/** 单张图片内联上限：再大就别塞 data: 了，宁可这张图不显示 */
const MAX_INLINE_IMAGE = 3 * 1024 * 1024;
/**
 * 整章图片内联总量预算（P2-18）。
 *
 * 以前只有单张上限：一章 20 张 1MB 的图会变成约 27MB 的字符串挂在一个
 * `srcdoc` 属性上，手机上换章明显停顿甚至 OOM。超预算的图保留原 blob 地址
 * （能显示就显示，显示不了也不拖垮整章）。
 */
const MAX_INLINE_IMAGES_TOTAL = 8 * 1024 * 1024;

function isBlobUrl(url: string): boolean {
  return String(url || '').trim().toLowerCase().startsWith('blob:');
}

function blobOf(url: string): Blob | null {
  return blobs.get(String(url || '').trim())?.blob ?? null;
}

async function readText(url: string): Promise<string> {
  const blob = blobOf(url);
  if (blob) return blob.text();
  const res = await fetch(url);
  return res.text();
}

async function readDataUrl(url: string, limit = MAX_INLINE_IMAGE): Promise<string> {
  const blob = blobOf(url) ?? (await (await fetch(url)).blob());
  if (!blob || blob.size === 0 || blob.size > limit) return '';
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  });
}

/** CSS 里的 url(blob:…) 换成 data:；@import blob: 直接展开 */
async function inlineCss(css: string): Promise<string> {
  let out = String(css || '');
  for (const match of Array.from(out.matchAll(/@import\s+(?:url\()?['"]?([^'")]+)['"]?\)?\s*;/gi))) {
    const href = (match[1] || '').trim();
    if (!isBlobUrl(href)) continue;
    const imported = await readText(href).catch(() => '');
    out = out.replace(match[0], imported ? await inlineCss(imported) : '');
  }
  for (const match of Array.from(out.matchAll(/url\(\s*(['"]?)(blob:[^'")]+)\1\s*\)/gi))) {
    const href = (match[2] || '').trim();
    const data = await readDataUrl(href).catch(() => '');
    if (data) out = out.replace(match[0], `url("${data}")`);
  }
  return out;
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
async function inlineMarkup(raw: string): Promise<string> {
  const doc = new DOMParser().parseFromString(String(raw || ''), 'text/html');

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
      style.textContent = await inlineCss(style.textContent);
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
    const style = doc.createElement('style');
    style.textContent = await inlineCss(css);
    link.replaceWith(style);
  }

  /* 图片内联：整章有总量预算（P2-18）。并行读，但超预算的图直接放弃内联，
     保留原 blob 地址——比把 27MB 的字符串塞进 srcdoc 然后手机 OOM 好。 */
  const budget = { left: MAX_INLINE_IMAGES_TOTAL };
  const images = Array.from(doc.querySelectorAll('img[src]')).filter((img) =>
    isBlobUrl(img.getAttribute('src') || ''),
  );
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute('src') || '';
      if (budget.left <= 0) {
        img.removeAttribute('src');
        return;
      }
      const data = await readDataUrl(src, Math.min(MAX_INLINE_IMAGE, budget.left)).catch(() => '');
      if (!data) {
        img.removeAttribute('src');
        return;
      }
      budget.left -= data.length;
      if (budget.left < 0) {
        img.removeAttribute('src');
        return;
      }
      img.setAttribute('src', data);
    }),
  );

  for (const el of Array.from(doc.querySelectorAll('[style]'))) {
    const style = el.getAttribute('style') || '';
    if (style.includes('blob:')) el.setAttribute('style', await inlineCss(style));
  }

  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

/** 1) 留住 Blob：foliate 换章会 revokeObjectURL，之后还得读原文 */
function installUrlRegistry(): void {
  const g = globalThis as GlobalWithPatches;
  /* 原始函数只存一次；之后每次插件重载都重新包一层，
     否则页面里留下的是上一个实例的闭包，它写进的是上一份 Map。 */
  if (!g.__bzrOrigCreateObjectURL__) {
    g.__bzrOrigCreateObjectURL__ = URL.createObjectURL.bind(URL);
    g.__bzrOrigRevokeObjectURL__ = URL.revokeObjectURL.bind(URL);
  }
  const create = g.__bzrOrigCreateObjectURL__!;
  const revoke = g.__bzrOrigRevokeObjectURL__!;
  URL.createObjectURL = (blob: Blob): string => {
    const url = create(blob);
    try {
      keepEntry(blobs, url, blob);
    } catch {
      /* 留不住也不影响主流程 */
    }
    return url;
  };
  URL.revokeObjectURL = (url: string): void => {
    try {
      revoke(url);
    } catch {
      /* 回收失败无所谓 */
    }
    /* **标记而不是删除**：句柄已经废了，但 foliate 换章后我们还要读原文。
       标记之后淘汰顺序会优先扔它，等于「用完了但先留着」。 */
    const kept = blobs.get(url);
    if (kept) kept.revoked = true;
  };
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
  const g = globalThis as GlobalWithPatches & {
    __bzrOrigIframeSrcSet__?: (this: HTMLIFrameElement, value: string) => void;
    __bzrOrigIframeSrcGet__?: (this: HTMLIFrameElement) => string;
  };
  const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
  if (!desc?.set) return;
  /* 同样：原始 setter 只存一次，重载时重新包，避免嵌套上一次的包装 */
  g.__bzrOrigIframeSrcSet__ ??= desc.set;
  g.__bzrOrigIframeSrcGet__ ??= desc.get ?? undefined;
  const originalSet = g.__bzrOrigIframeSrcSet__;
  const originalGet = g.__bzrOrigIframeSrcGet__;
  const tokens = new WeakMap<HTMLIFrameElement, number>();

  Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
    configurable: true,
    enumerable: desc.enumerable ?? true,
    get(this: HTMLIFrameElement): string {
      return originalGet ? originalGet.call(this) : this.getAttribute('src') || '';
    },
    set(this: HTMLIFrameElement, value: string): void {
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
    },
  });
}

/** 插件 onload 时调一次（幂等） */
export function installBlobSrcdocPatches(): void {
  installUrlRegistry();
  installIframeSrcPatch();
}

/**
 * 插件 onunload 时调（P2-13）。
 *
 * 不还原的话，禁用/卸载插件后页面里仍留着 bz 的包装：`URL.createObjectURL`
 * 继续把**别的插件**造的 Blob 收进我们的表（最多 64MB），`iframe.src` 的
 * setter 也还是我们的。引用都挂在 `globalThis.__bzrOrig*__` 上，写回去即可。
 */
export function uninstallBlobSrcdocPatches(): void {
  const g = globalThis as GlobalWithPatches & {
    __bzrOrigIframeSrcSet__?: (this: HTMLIFrameElement, value: string) => void;
    __bzrOrigIframeSrcGet__?: (this: HTMLIFrameElement) => string;
  };
  try {
    if (g.__bzrOrigCreateObjectURL__) URL.createObjectURL = g.__bzrOrigCreateObjectURL__;
    if (g.__bzrOrigRevokeObjectURL__) URL.revokeObjectURL = g.__bzrOrigRevokeObjectURL__;
  } catch {
    /* 还原失败不影响卸载流程 */
  }
  try {
    if (typeof HTMLIFrameElement !== 'undefined' && g.__bzrOrigIframeSrcSet__) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
        configurable: true,
        enumerable: true,
        get: g.__bzrOrigIframeSrcGet__,
        set: g.__bzrOrigIframeSrcSet__,
      });
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
