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
 */
const blobs = ((globalThis as unknown as { __bzrBlobs?: Map<string, Blob> }).__bzrBlobs ??=
  new Map<string, Blob>());
/** 上限：一本图多的书会造几百个 URL，全留着会顶内存 */
const MAX_BLOBS = 96;
/** 单张图片内联上限：再大就别塞 data: 了，宁可这张图不显示 */
const MAX_INLINE_IMAGE = 3 * 1024 * 1024;

function isBlobUrl(url: string): boolean {
  return String(url || '').trim().toLowerCase().startsWith('blob:');
}

function keepBlob(url: string, blob: Blob): void {
  if (blobs.size >= MAX_BLOBS) {
    const oldest = blobs.keys().next().value;
    if (typeof oldest === 'string') blobs.delete(oldest);
  }
  blobs.set(url, blob);
}

async function readText(url: string): Promise<string> {
  const blob = blobs.get(url);
  if (blob) return blob.text();
  const res = await fetch(url);
  return res.text();
}

async function readDataUrl(url: string, limit = MAX_INLINE_IMAGE): Promise<string> {
  const blob = blobs.get(url) ?? (await (await fetch(url)).blob());
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
 *   · 删 `script/iframe/object/embed` —— 没有 sandbox 兜底，别让书里的脚本跑到应用源里；
 *   · 删书自带的 `Content-Security-Policy` / `refresh` meta —— 它会挡住我们内联的 data:；
 *   · 删 `on*` 属性与 `javascript:` 地址。
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

  for (const img of Array.from(doc.querySelectorAll('img[src]'))) {
    const src = img.getAttribute('src') || '';
    if (!isBlobUrl(src)) continue;
    const data = await readDataUrl(src).catch(() => '');
    if (data) img.setAttribute('src', data);
    else img.removeAttribute('src');
  }

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
      keepBlob(url, blob);
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
    /* 故意不删 blobs：URL 句柄已经废了，但 Blob 对象还要用来读原文 */
  };
}

/** 2) 拦 iframe.src：blob 地址 → 读原文 → 内联 → srcdoc */
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
 * 拿回某个 blob URL 背后的 Blob（即使它已经被 revoke）。
 *
 * 宿主 CSP 只放行 `data:` 图片，所以封面这类要显示在**应用页面**（不是书页
 * iframe）里的图，得转成 data URL 才出得来。
 */
export function blobForUrl(url: string): Blob | null {
  return blobs.get(String(url || '').trim()) ?? null;
}
