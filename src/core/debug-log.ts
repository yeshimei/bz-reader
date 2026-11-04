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
/** 开关：只认精确的 '1'（避免 'true' / 'yes' 这类"看着像开"的旧值） */
const FLAG = 'bz-reader:debug-log';

let app: App | null = null;
let enabled = false;
let buf: string[] = [];
let timer: number | null = null;
let flushing = false;
let chain: Promise<void> = Promise.resolve();
/** 已注册的 window 监听（禁用插件时要摘掉，否则重启用一次就多一层） */
let detach: (() => void) | null = null;

/** 诊断日志是否启用（默认关闭：真机出问题时才手动打开） */
export function isDebugLogEnabled(): boolean {
  return enabled;
}

function readFlag(): boolean {
  try {
    return window.localStorage?.getItem(FLAG) === '1';
  } catch {
    /* 隐私模式 / 无 window：按关闭处理 */
    return false;
  }
}

function stamp(): string {
  const t = new Date();
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}.${p(t.getMilliseconds(), 3)}`;
}

export function dlog(event: string, data?: Record<string, unknown>): void {
  /* 默认关闭（A-11）：没开开关时连缓冲都不做，绝不产生 IO / 定时器。
     排查时在控制台执行 localStorage['bz-reader:debug-log']='1' 再重开插件。 */
  if (!enabled) return;
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
      chain = chain.then(() => flush());
    }, FLUSH_DELAY);
  }
}

/**
 * 写一批。`target` 显式传是为了卸载时还能写（P3-01）：
 * 以前 `shutdownDebugLog()` 排完 `chain.then(flush)` 就把模块级 `app` 置空，
 * 等 flush 真正跑到时 `app` 已经是 null，最后一批日志永远写不出去——
 * 恰好是「崩溃/卡死之后重启看日志」最需要的那几条。
 */
async function flush(target: App | null = app): Promise<void> {
  if (!target || flushing || !buf.length) return;
  const chunk = buf.join('\n') + '\n';
  buf = [];
  flushing = true;
  try {
    const adapter = target.vault.adapter;
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
  if (buf.length) chain = chain.then(() => flush());
}

/** 插件 onload 时调一次（幂等：重复调用只换 app，不重复挂监听） */
export function initDebugLog(a: App): void {
  /* 默认关闭（A-11）：诊断日志会往库里写文件、挂全局 error 监听，
     普通用户不需要。只有显式打开开关才进入下面这套初始化。 */
  enabled = readFlag();
  (window as unknown as { __bzrLog?: typeof dlog }).__bzrLog = dlog;
  if (!enabled) {
    /* 上一次会话开着、这次关掉：监听也要摘，否则关掉开关后仍在收全局错误 */
    detach?.();
    detach = null;
    app = null;
    return;
  }
  app = a;
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
    ua: String((window as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? '').slice(0, 90),
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
  /* 先把 app 抓在闭包里再置空（P3-01）：顺序反了的话，排进 chain 的 flush
     真正执行时 app 已经是 null，最后一批日志静默丢掉。 */
  const last = app;
  if (buf.length && last) {
    chain = chain.then(() => flush(last));
  }
  app = null;
  enabled = false;
}
