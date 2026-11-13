/* ============================================================
 * bz-reader · 阅读会话计时（engine/activity.ts）
 *
 * 一句话：**只记「人真的在看」的时间**。
 *
 * 为什么不能简单用「打开到关闭」的墙钟：用户开着书去接电话、去吃饭、
 * 睡前打开看两行就睡着——墙钟会把 8 小时记进统计，读书报告立刻失真，
 * 而报告一旦不可信，整个「数据统计」这个付费点就废了。
 *
 * 口径：
 *  - 每次翻页 / 滚动 / 点击都算一次活动，刷新 lastActive；
 *  - 每 TICK 结算一拍，距上次活动 < IDLE 才把这拍计入；
 *  - 连续 IDLE 没有活动 → 不再累计，会话照常挂着（回来接着记）。
 *
 * 落盘形状对齐 bz：`{ start, end, durationSeconds }`，且 start 必须是
 * 可解析的毫秒戳（缺失会被 bz 整条丢弃，见 data/schema.ts 的说明）。
 * ============================================================ */

import type { ReadingSession } from '../data/schema';

const TICK_MS = 15_000;
const IDLE_MS = 60_000;
/** 短于这个时长的会话不记（误触/闪进闪出会把分布打散） */
const MIN_SESSION_MS = 30_000;
/** 两次 tick 之间最多认多少：定时器被系统挂起后回来，不能把整段都算成阅读 */
const MAX_SPAN_MS = TICK_MS * 2;

/**
 * 这一拍该记多少（纯函数）。
 *
 * 以前写的是 `accumulated += min(TICK, now - lastActive)`——记的是「距上次活动
 * 有多久」，不是这一拍的长度。翻页频繁时（每 2-5 秒一次）每个 15 秒 tick 只加
 * 2-5 秒，一小时真实阅读能少记成十几分钟。正确口径是「这一拍内用户是活跃的
 * （距上次活动 < IDLE），就记这一拍的时长」。
 */
export function accrueTick(input: {
  now: number;
  lastTickAt: number;
  lastActive: number;
  idleMs?: number;
  tickMs?: number;
}): number {
  const idle = input.idleMs ?? IDLE_MS;
  const cap = input.tickMs ?? TICK_MS;
  const span = input.now - input.lastTickAt;
  if (!Number.isFinite(span) || span <= 0) return 0;
  if (input.now - input.lastActive >= idle) return 0;
  return Math.min(span, cap, MAX_SPAN_MS);
}

export interface SessionResult {
  start: number;
  end: number;
  durationSeconds: number;
}

/**
 * 给结算好的会话补上「结束时在哪一章」。
 *
 * 会话本身只记时间；章节要由调用方在结算那一刻从 position 取快照。
 * 现在没有消费方（bz 的阅读报告不用），但按章分析是迟早的事——
 * 会话一旦落盘就改不了，缺了就永远缺。
 */
export function attachChapter(
  session: SessionResult,
  where: { chapterIndex?: number; chapterTitle?: string },
): ReadingSession {
  const out: ReadingSession = { ...session };
  if (typeof where.chapterIndex === 'number') out.chapterIndex = where.chapterIndex;
  const title = where.chapterTitle?.trim();
  if (title) out.chapterTitle = title;
  return out;
}

export class ActivityTracker {
  private sessionStart = 0;
  private lastActive = 0;
  private lastTickAt = 0;
  private accumulated = 0;
  private timer: number | null = null;
  private lastPercent = 0;
  private running = false;
  /**
   * 每一拍「有效阅读秒数」的去处（剪藏本按章计时用）。
   *
   * tracker 本身只管全书会话；章节归属是另一维度，不能混进 SessionResult
   * （一次会话可能跨好几章）。阅读视图在这里接一个 ChapterClock。
   */
  private sink: ((seconds: number) => void) | null = null;

  setSink(fn: ((seconds: number) => void) | null): void {
    this.sink = fn;
  }

  /** 把这一拍的增量同时交给会话累计与章节计时 */
  private accrue(now: number): number {
    const gained = accrueTick({ now, lastTickAt: this.lastTickAt, lastActive: this.lastActive });
    this.lastTickAt = now;
    this.accumulated += gained;
    if (gained > 0) this.sink?.(gained / 1000);
    return gained;
  }

  /**
   * 开始一次阅读会话（打开书时调）。
   *
   * 如果上一段还没结算，这里会先把它收掉并**返回**（P3-22）：
   * 以前 `this.end()` 的返回值被直接丢掉，重试挂载 / 重新 begin 时
   * 上一段阅读时长就这么没了，统计里凭空少一截。
   */
  begin(percent = 0): SessionResult | null {
    const previous = this.running ? this.end() : null;
    this.sessionStart = Date.now();
    this.lastActive = this.sessionStart;
    this.lastTickAt = this.sessionStart;
    this.accumulated = 0;
    this.lastPercent = percent;
    this.running = true;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    return previous;
  }

  /** 用户有动作（翻页 / 滚动 / 点击）。只在会话进行中有效。 */
  touch(percent?: number): void {
    if (!this.running) return;
    this.lastActive = Date.now();
    if (typeof percent === 'number') this.lastPercent = percent;
  }

  private tick(): void {
    if (!this.running) return;
    this.accrue(Date.now());
  }

  /**
   * 立刻结算「上次整拍到现在」这一段。
   *
   * 切章时用：只 take 已经结算的整拍会丢掉最后一截——停 20 秒切走只记 15 秒，
   * 停 5 秒切走记 0 秒（真机：连续 3 章各停 5 秒，只有前一章记到 15 秒）。
   * 会话累计与章节计时同时受益。
   */
  settle(now = Date.now()): number {
    if (!this.running) return 0;
    return this.accrue(now);
  }

  /** 结算一次会话。太短或没读到时长 → null（不产生垃圾数据）。 */
  end(): SessionResult | null {
    if (!this.running) return null;
    this.running = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    const now = Date.now();
    // 收尾补最后一段：距上次活动仍在 IDLE 内就把「上次 tick 到现在」算上
    this.accrue(now);
    if (this.accumulated < MIN_SESSION_MS) return null;
    return {
      start: this.sessionStart,
      end: now,
      durationSeconds: Math.round(this.accumulated / 1000),
    };
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentPercent(): number {
    return this.lastPercent;
  }

  /** 已累计秒数（面板上「本次已读」用） */
  get elapsedSeconds(): number {
    return Math.round(this.accumulated / 1000);
  }
}
