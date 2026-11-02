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

const TICK_MS = 15_000;
const IDLE_MS = 60_000;
/** 短于这个时长的会话不记（误触/闪进闪出会把分布打散） */
const MIN_SESSION_MS = 30_000;

export interface SessionResult {
  start: number;
  end: number;
  durationSeconds: number;
}

export class ActivityTracker {
  private sessionStart = 0;
  private lastActive = 0;
  private accumulated = 0;
  private timer: number | null = null;
  private lastPercent = 0;
  private running = false;

  /** 开始一次阅读会话（打开书时调） */
  begin(percent = 0): void {
    if (this.running) this.end();
    this.sessionStart = Date.now();
    this.lastActive = this.sessionStart;
    this.accumulated = 0;
    this.lastPercent = percent;
    this.running = true;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  /** 用户有动作（翻页 / 滚动 / 点击）。只在会话进行中有效。 */
  touch(percent?: number): void {
    if (!this.running) return;
    this.lastActive = Date.now();
    if (typeof percent === 'number') this.lastPercent = percent;
  }

  private tick(): void {
    if (!this.running) return;
    const now = Date.now();
    if (now - this.lastActive < IDLE_MS) {
      // 这一拍用户还在看（距上次活动不超过 IDLE），计入
      this.accumulated += Math.min(TICK_MS, now - this.lastActive);
    }
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
    // 收尾补最后一段：距上次活动仍在 IDLE 内就把尾巴算上
    if (now - this.lastActive < IDLE_MS) {
      this.accumulated += Math.min(now - this.lastActive, TICK_MS);
    }
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
