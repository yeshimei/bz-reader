/**
 * 运行日志：把关键动作写到库根目录的 `bz-reader-debug.md`。
 *
 * 为什么写进库而不是 console：真机上没法连调试器，用户截图只能看到屏幕。
 * 落到库里的文件会跟着同步回来，一次复现就能拿到带时间戳的完整序列
 * （点按判成哪个区、翻页前后在哪一页、分页器有没有吸附、哪次导航超时）。
 *
 * 只记录与「翻页/手势/导航」有关的离散事件，正文内容一概不写。
 */
import type { App } from 'obsidian';

const FILE = 'bz-reader-debug.md';
/** 超过这个体积就从头写，避免无限长 */
const MAX_BYTES = 300_000;
const FLUSH_DELAY = 1200;

let app: App | null = null;
let buf: string[] = [];
let timer: number | null = null;
let flushing = false;
let chain: Promise<void> = Promise.resolve();
/** 已注册的 window 监听（禁用插件时要摘掉，否则重启用一次就多一层） */
let detach: (() => void) | null = null;

function stamp(): string {
  const t = new Date();
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}.${p(t.getMilliseconds(), 3)}`;
}

export function dlog(event: string, data?: Record<string, unknown>): void {
  let payload = '';
  if (data) {
    try {
      payload = ' ' + JSON.stringify(data);
    } catch {
      payload = ' [unserializable]';
    }
  }
  buf.push(`${stamp()} ${event}${payload}`);
  if (buf.length > 300) buf = buf.slice(-300);
  if (timer === null) {
    timer = window.setTimeout(() => {
      timer = null;
      chain = chain.then(flush);
    }, FLUSH_DELAY);
  }
}

async function flush(): Promise<void> {
  if (!app || flushing || !buf.length) return;
  const chunk = buf.join('\n') + '\n';
  buf = [];
  flushing = true;
  try {
    const adapter = app.vault.adapter;
    if (await adapter.exists(FILE)) {
      const old = await adapter.read(FILE);
      if (old.length + chunk.length > MAX_BYTES) await adapter.write(FILE, chunk);
      else await adapter.append(FILE, chunk);
    } else {
      await adapter.write(FILE, `# bz 阅读 · 运行日志\n${chunk}`);
    }
  } catch {
    /* 写日志失败不能影响阅读 */
  }
  flushing = false;
  if (buf.length) chain = chain.then(flush);
}

/** 插件 onload 时调一次（幂等：重复调用只换 app，不重复挂监听） */
export function initDebugLog(a: App): void {
  app = a;
  /* 供 vendor 里的分页器调用（它不方便 import 插件模块） */
  (globalThis as unknown as { __bzrLog?: typeof dlog }).__bzrLog = dlog;
  if (!detach) {
    const onError = (ev: ErrorEvent): void => {
      const msg = String(ev.message || '');
      /* ResizeObserver 的这条是良性的，而且一次重排能刷几十条，会把有用的行冲掉 */
      if (msg.includes('ResizeObserver loop')) return;
      dlog('window.error', { msg: msg.slice(0, 200), src: String(ev.filename || '').slice(-40) });
    };
    const onRejection = (ev: PromiseRejectionEvent): void => {
      const reason = ev.reason as { stack?: string; message?: string } | undefined;
      dlog('unhandledrejection', { why: String(reason?.stack || reason?.message || ev.reason).slice(0, 300) });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    detach = () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }
  dlog('boot', {
    tag: typeof __BZ_BUILD_TAG__ === 'string' ? __BZ_BUILD_TAG__ : '',
    mobile: document.body.classList.contains('is-mobile'),
    ua: navigator.userAgent.slice(0, 90),
  });
}

/**
 * 插件卸载时调：摘监听 + 把缓冲区里最后几行写出去。
 * 以前没有这一步，禁用→再启用会叠一层监听，旧闭包继续往库里写。
 */
export function shutdownDebugLog(): void {
  detach?.();
  detach = null;
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (buf.length) {
    chain = chain.then(flush);
  }
  app = null;
}
