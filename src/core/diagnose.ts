/* ============================================================
 * bz-reader · 环境自检（core/diagnose.ts）
 *
 * 存在的理由只有一个：手机上「点了书但一片白」是没法猜的。
 *
 * foliate 用 blob URL 给 iframe 喂每一章的 HTML，而分页器只监听 iframe
 * 的 `load`、不监听 `error`。一旦宿主环境不允许这个 iframe 加载 blob
 * （最常见的情形是页面 origin 不透明，`URL.createObjectURL` 出来的地址
 * 是 `blob:null/…`，iframe 永远不触发 load），`view.open()` 就既不会
 * resolve 也不会 reject —— 表现是白屏，且没有一条报错。
 *
 * 这一层把「能不能造 blob」「iframe 吃不吃得下 blob」「页面 origin 是
 * 什么」测出来，出错时贴到提示里，真机上截个图就能定位，不用再猜。
 * ============================================================ */

/** 造一个 blob URL，看看它是不是挂在透明源上（blob:null/… = 一定加载不了） */
function blobUrl(): { url: string; opaque: boolean } {
  try {
    const url = URL.createObjectURL(new Blob(['<!doctype html><b>ok</b>'], { type: 'text/html' }));
    return { url, opaque: url.startsWith('blob:null') };
  } catch {
    return { url: '', opaque: true };
  }
}

let probeResult: Promise<string> | null = null;

/**
 * 真加载一次 blob iframe，等它自己说话。
 *
 * 只做一次并缓存：这个探测本身要插一个 1px 的 iframe，每次开书都来一遍
 * 没必要，而且结论在同一会话里不会变。
 */
export function probeBlobIframe(): Promise<string> {
  if (probeResult) return probeResult;
  probeResult = new Promise<string>((resolve) => {
    const { url, opaque } = blobUrl();
    if (!url) {
      resolve('createObjectURL 抛错');
      return;
    }
    let settled = false;
    const finish = (why: string): void => {
      if (settled) return;
      settled = true;
      frame.remove();
      URL.revokeObjectURL(url);
      resolve(opaque ? `${why}（URL 是 blob:null，透明源）` : why);
    };
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin allow-scripts');
    frame.setAttribute('scrolling', 'no');
    frame.style.cssText = 'position:absolute;left:-9999px;width:8px;height:8px;border:0;opacity:0';
    frame.addEventListener('load', () => finish('load ✓'));
    frame.addEventListener('error', () => finish('error ✗'));
    frame.src = url;
    document.body.appendChild(frame);
    window.setTimeout(() => finish('无响应（4s 内既没 load 也没 error）'), 4000);
  });
  return probeResult;
}

/** 同步能给的那部分：开书失败时立刻显示，不等异步探测 */
export function envSummary(phase: string): string[] {
  const { opaque } = blobUrl();
  const ua = navigator.userAgent;
  const chromium = /Chrome\/(\d+)/.exec(ua)?.[1] ?? '?';
  return [
    `卡在：${phase}`,
    `页面源：${location.origin || '(空)'}${opaque ? '（透明源，blob 不可用）' : ''}`,
    `内核：Chromium ${chromium}`,
  ];
}
