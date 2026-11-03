/* ============================================================
 * bz-reader · 环境自检（core/diagnose.ts）
 *
 * 存在的理由只有一个：手机上「点了书但一片白」是没法猜的。
 *
 * foliate 用 blob URL 给 iframe 喂每一章的 HTML，而分页器只监听 iframe
 * 的 `load`、不监听 `error`。一旦宿主环境不允许这个 iframe 加载 blob
 * （frame-src 拦截、WebView 的 blob 策略、或者页面 origin 不透明），
 * `view.open()` 就既不会 resolve 也不会 reject —— 白屏，且没有一条报错。
 *
 * 这一层把四条路都实测一遍并排贴出来，真机上截一张图就能定位：
 *   blob 地址进 iframe / 带 sandbox 的 blob / srcdoc / fetch(blob)
 * 哪条通、哪条不通，直接决定该换哪种装载方式。
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
  const { url, opaque } = blobUrl();
  if (!url) {
    probeResult = Promise.resolve('createObjectURL 抛错');
    return probeResult;
  }
  probeResult = Promise.all([
    probeIframe({ src: url }),
    probeIframe({ src: url, sandbox: true }),
    probeIframe({ srcdoc: '<!doctype html><b>ok</b>' }),
    probeFetch(url),
  ])
    .then(
      ([plain, boxed, srcdoc, fetched]) =>
        `blob ${plain}｜blob+沙箱 ${boxed}｜srcdoc ${srcdoc}｜fetch ${fetched}` +
        (opaque ? '（透明源）' : ''),
    )
    .finally(() => {
      /* 诊断用的 blob 也要释放：真机上反复试开书会累积常驻内存 */
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* 已释放 */
      }
    });
  return probeResult;
}

/** 插一个 8px 的 iframe，等 load / error / 无响应 */
function probeIframe(opts: { src?: string; srcdoc?: string; sandbox?: boolean }): Promise<string> {
  return new Promise<string>((resolve) => {
    const frame = document.createElement('iframe');
    if (opts.sandbox) frame.setAttribute('sandbox', 'allow-same-origin allow-scripts');
    frame.setAttribute('scrolling', 'no');
    frame.style.cssText = 'position:absolute;left:-9999px;width:8px;height:8px;border:0;opacity:0';
    let settled = false;
    const finish = (why: string): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      frame.remove();
      resolve(why);
    };
    frame.addEventListener('load', () => finish('✓'));
    frame.addEventListener('error', () => finish('✗'));
    if (opts.src) frame.src = opts.src;
    else frame.srcdoc = opts.srcdoc ?? '';
    document.body.appendChild(frame);
    const timer = window.setTimeout(() => finish('4s 无响应'), 4000);
  });
}

/** 同一个 blob 地址 fetch 得下来吗（srcdoc 回退要靠它取原文） */
function probeFetch(url: string): Promise<string> {
  return new Promise<string>((resolve) => {
    let settled = false;
    const done = (why: string): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(why);
    };
    const timer = window.setTimeout(() => done('超时'), 4000);
    fetch(url)
      .then((r) => r.text())
      .then((t) => done(t ? `✓ ${t.length} 字` : '空'))
      .catch((e) => done(`✗ ${(e as Error)?.name || 'error'}`));
  });
}

/** 引擎打的事件轨迹（vendor/paginator.js 往 globalThis.__bzrTrace 里记） */
export function traceText(): string {
  const t = (globalThis as unknown as { __bzrTrace?: string[] }).__bzrTrace;
  return Array.isArray(t) && t.length ? t.slice(-8).join(' → ') : '';
}

/** 同步能给的那部分：开书失败时立刻显示，不等异步探测 */
export function envSummary(phase: string): string[] {
  const { url, opaque } = blobUrl();
  if (url) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* 已释放 */
    }
  }
  const ua = navigator.userAgent;
  const chromium = /Chrome\/(\d+)/.exec(ua)?.[1] ?? '?';
  const named: Record<string, string> = {
    idle: '空闲（没开始）',
    read: '读文件',
    parse: '解包 / 解析',
    render: '建渲染器',
    locate: '分页（画第一页）',
    ready: '已经出字',
  };
  return [
    `卡在：${named[phase] ?? phase}（${phase}）`,
    `页面源：${location.origin || '(空)'}${opaque ? '（透明源，blob 不可用）' : ''}`,
    `内核：Chromium ${chromium}`,
  ];
}
