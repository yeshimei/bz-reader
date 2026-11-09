/* ============================================================
 * bz-reader · 调试日志（data/debug-log.ts）
 *
 * 排查「划词时页面跳到固定位置」这类只在真机复现的问题用的。设置页开关
 * 打开后，把触摸、选区、翻页、跳转、锚点按时间顺序写进数据目录下一份
 * 单独的 `debug.json`；关掉就删文件。**默认关，关着时一个字节都不写。**
 *
 * 三条纪律：
 *   1. 只记「谁动了页面」，不记正文：字符串一律截断到 80 字。
 *   2. 写盘要节流：事件先进内存环形缓冲（最多 400 条），1 秒落一次，
 *      不能每摸一下屏幕就写一次盘。
 *   3. 写盘失败只吞掉——调试设施绝不能把阅读搞崩。
 *
 * 文件形状见 DebugDump：`events[].t` 是相对开启时刻的毫秒数，
 * 一眼能看出「第 1200 毫秒那一下是谁把页面弄走的」。
 * ============================================================ */

/** 一条事件里允许出现的值。对象/数组一律不收，避免日志里出现无底洞 */
export type DebugDatum = string | number | boolean | null | undefined;

export interface DebugEvent {
  /** 相对开启时刻的毫秒数 */
  t: number;
  /** 短类别：touch / tap / turn / sel / relocate / anchor / snap / … */
  k: string;
  d?: Record<string, DebugDatum>;
}

export interface DebugMeta {
  /** 例：`bz-reader 0.3.3` */
  app: string;
  /** 例：`android` / `desktop` */
  platform: string;
  /** 这本书的 id 与书名，切书后重新开一轮最好认 */
  book?: string;
}

export interface DebugDump extends DebugMeta {
  version: 1;
  /** 绝对时间（毫秒），用来对上真机录屏的时间轴 */
  startedAt: number;
  /** 到这次落盘为止跑了多久 */
  tookMs: number;
  events: DebugEvent[];
}

/** 最多留这么多条；真机上「划一下」大概 3~8 条，400 条够看几百次操作 */
/* 2026-11-08 精细到「每一次 selectionchange / scroll」之后，400 条一次拖选就满，
   提到 800。文件仍然只有几十 KB，真机发回来没负担。 */
const MAX_EVENTS = 800;

/** 单条字符串最长这么多字：够认出「哪一段」，又不至于把正文搬进日志 */
const MAX_TEXT = 80;

let enabled = false;
let startedAt = 0;
let meta: DebugMeta = { app: '', platform: '' };
let events: DebugEvent[] = [];
let sink: ((text: string) => void) | null = null;
/** `window.setTimeout` 的返回值；弹窗窗口下也拿得到正确的计时器 */
let timer: number | null = null;

export function debugEnabled(): boolean {
  return enabled;
}

/**
 * 开始记录。`write` 收到的是整份 JSON（带缩进，人能直接看）。
 * 立刻写一次空快照：文件先出现，才说明开关真的生效了。
 */
export function startDebugLog(write: (text: string) => void, m: DebugMeta): void {
  enabled = true;
  startedAt = Date.now();
  meta = { ...m };
  events = [];
  sink = write;
  flushDebugLog();
}

/** 停止记录并清空缓冲。文件由调用方决定删不删（插件里是删掉）。 */
export function stopDebugLog(): void {
  enabled = false;
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  events = [];
  sink = null;
  startedAt = 0;
}

/** 切书/换章时更新 meta，不打断当前这一轮 */
export function setDebugMeta(m: Partial<DebugMeta>): void {
  if (!enabled) return;
  meta = { ...meta, ...m };
}

/**
 * 记一条。没开、或传了空类别时什么也不做——调用方可以放心在热路径里埋点，
 * 开不开都由这里挡。
 */
export function debugEvent(k: string, d?: Record<string, DebugDatum>): void {
  if (!enabled || !k) return;
  const clean: Record<string, DebugDatum> = {};
  if (d) {
    for (const [key, raw] of Object.entries(d)) {
      if (raw === undefined) continue;
      clean[key] = typeof raw === 'string' && raw.length > MAX_TEXT ? `${raw.slice(0, MAX_TEXT)}…` : raw;
    }
  }
  const ev: DebugEvent = { t: Date.now() - startedAt, k };
  if (Object.keys(clean).length) ev.d = clean;
  events.push(ev);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  scheduleFlush();
}

/** 当前快照（测试与「复制调试数据」按钮用；不会改内部缓冲） */
export function debugSnapshot(): DebugDump {
  return {
    version: 1,
    ...meta,
    startedAt,
    tookMs: startedAt ? Date.now() - startedAt : 0,
    events: events.slice(),
  };
}

/** 立刻落一次盘（节流计时器一并取消） */
export function flushDebugLog(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (!enabled || !sink) return;
  try {
    sink(JSON.stringify(debugSnapshot(), null, 2));
  } catch {
    /* 写盘失败只吞掉：调试设施不该让阅读崩 */
  }
}

/**
 * 给 vendor 代码用的全局入口。
 *
 * foliate 的 paginator 在宿主文档里，但它不该 import 业务模块——只认
 * `window.__bzrDbg?.(k, d)`。这里常驻装一次，未开启时 debugEvent 自己
 * 就是空操作，不用反复挂/摘。
 */
export function installDebugHook(): void {
  (window as unknown as { __bzrDbg?: typeof debugEvent }).__bzrDbg = debugEvent;
}

function scheduleFlush(): void {
  if (timer !== null) return;
  timer = window.setTimeout(() => {
    timer = null;
    flushDebugLog();
  }, 1000);
}
