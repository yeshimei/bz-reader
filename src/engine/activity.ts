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

/**
 * 一次会话里的中断次数（2026-11-18）。
 *
 * 口径：距上次活动 >= idle 视为「离开」，连续离开只算一次中断（从活跃转离开
 * 的那一刻记一次，回来再离开才算第二次）。用状态机避免整段离开每拍都累加。
 */
export function nextInterruptState(input: {
  lastActive: number;
  now: number;
  wasIdle: boolean;
  idleMs?: number;
}): { idle: boolean; countDelta: number } {
  const idle = input.idleMs ?? IDLE_MS;
  const isIdle = input.now - input.lastActive >= idle;
  return { idle: isIdle, countDelta: isIdle && !input.wasIdle ? 1 : 0 };
}

export interface SessionResult {
  start: number;
  end: number;
  durationSeconds: number;
  /** 会话内中断次数（离开再回来）；0 = 一口气读完。老调用方可省略 */
  interruptions?: number;
  /** 会话内有效交互次数（翻页 / 滚动 / 点按，去连击） */
  turns?: number;
  /** 会话内听书秒数（durationSeconds 的子集） */
  ttsSeconds?: number;
}

/**
 * 两次交互算两次的最小间隔。
 *
 * 滚动阅读时 scroll 事件一秒能来几十个，全记的话「交互次数」就退化成
 * 「滚了多少像素」，跟阅读投入没关系。1.5 秒内的连击只算一次。
 */
const TURN_GAP_MS = 1_500;

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
  if (typeof session.interruptions === 'number') out.interruptions = session.interruptions;
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
  /** 会话中断次数（离开再回来累加） */
  private interruptions = 0;
  private wasIdle = false;
  /** 会话内有效交互次数（去连击） */
  private turns = 0;
  private lastTurnAt = 0;
  /** 会话内听书累计（毫秒）与本次播放起点（0 = 没在放） */
  private ttsAccum = 0;
  private ttsSince = 0;
  /** 按章计时（普通 EPUB）：当前章 key 与未结账秒数 */
  private chapterKey = '';
  private chapterAcc = 0;
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
    /* 中断只在会话真的开始积累过之后才记：刚打开还没读就走开不算中断 */
    if (this.accumulated > 0) {
      const st = nextInterruptState({ lastActive: this.lastActive, now, wasIdle: this.wasIdle });
      this.interruptions += st.countDelta;
      this.wasIdle = st.idle;
    }
    if (gained > 0) {
      this.sink?.(gained / 1000);
      if (this.chapterKey) this.chapterAcc += gained / 1000;
    }
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
    this.interruptions = 0;
    this.wasIdle = false;
    this.turns = 0;
    this.lastTurnAt = 0;
    this.ttsAccum = 0;
    this.ttsSince = 0;
    this.running = true;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    return previous;
  }

  /** 用户有动作（翻页 / 滚动 / 点击）。只在会话进行中有效。 */
  touch(percent?: number): void {
    if (!this.running) return;
    const now = Date.now();
    this.lastActive = now;
    if (!this.lastTurnAt || now - this.lastTurnAt >= TURN_GAP_MS) {
      this.turns += 1;
      this.lastTurnAt = now;
    }
    if (typeof percent === 'number') this.lastPercent = percent;
  }

  /**
   * 听书开始 / 继续（在线播放器进入 playing、系统语音开念）。
   *
   * 与阅读计时**并行**：边听边看时两边都算，`ttsSeconds` 只是「其中有多少
   * 时间在听」，不是另一份时长账。
   */
  ttsPlay(now = Date.now()): void {
    if (!this.running || this.ttsSince) return;
    this.ttsSince = now;
  }

  /** 听书暂停 / 停止。重复调用无害。 */
  ttsPause(now = Date.now()): void {
    if (!this.ttsSince) return;
    this.ttsAccum += Math.max(0, now - this.ttsSince);
    this.ttsSince = 0;
  }

  /** 当前会话已听秒数（含正在播放的这一段） */
  get ttsSeconds(): number {
    const live = this.ttsSince ? Math.max(0, Date.now() - this.ttsSince) : 0;
    return Math.round((this.ttsAccum + live) / 1000);
  }

  /**
   * 按章计时（普通 EPUB 用；剪藏本走自己的 sink，不走这一套）。
   *
   * 与会话计时同源：每一拍的有效秒数顺手加到当前章上。切章前调用方必须先
   * takeChapter() 结账，否则上一章最后一段会算到下一章。
   */
  setChapterKey(key: string): void {
    this.chapterKey = String(key || '');
  }

  takeChapter(): { key: string; seconds: number } | null {
    if (!this.chapterKey) return null;
    const seconds = Math.round(this.chapterAcc);
    this.chapterAcc = 0;
    if (seconds <= 0) return null;
    return { key: this.chapterKey, seconds };
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
    this.ttsPause(now);
    if (this.accumulated < MIN_SESSION_MS) return null;
    const out: SessionResult = {
      start: this.sessionStart,
      end: now,
      durationSeconds: Math.round(this.accumulated / 1000),
      interruptions: this.interruptions,
    };
    /* 老会话没有这两个字段：只在真的有值时写，别给数据里添一堆 0 */
    if (this.turns > 0) out.turns = this.turns;
    const tts = Math.round(this.ttsAccum / 1000);
    if (tts > 0) out.ttsSeconds = tts;
    return out;
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
