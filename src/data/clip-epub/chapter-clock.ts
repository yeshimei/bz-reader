/**
 * 剪藏本：按章计时（纯逻辑，node 可测）。
 *
 * 全书会话计时在 engine/activity.ts（Idle 不记、只记活跃时间）；这里只把
 * 那套「每一拍的有效秒数」分到当前章上。切章前调用方必须先 take() 结账，
 * 否则上一章最后一段会算到下一章。
 */
export interface ChapterTick {
  key: string;
  seconds: number;
}

export class ChapterClock {
  private key = '';
  private acc = 0;

  /** 切到新章。不清零：调用方应先 take() 再 setKey()（见类注释）。 */
  setKey(key: string): void {
    this.key = String(key || '');
  }

  /** 会计入当前章；没有当前章或秒数非正时忽略 */
  add(seconds: number): void {
    const s = Number(seconds);
    if (!this.key || !Number.isFinite(s) || s <= 0) return;
    this.acc += s;
  }

  /** 取走当前章的累计秒数（取整；不足 1 秒返回 null） */
  take(): ChapterTick | null {
    if (!this.key) return null;
    const seconds = Math.round(this.acc);
    this.acc = 0;
    if (seconds <= 0) return null;
    return { key: this.key, seconds };
  }

  current(): string {
    return this.key;
  }

  /** 调试/测试用：当前章已累计（未取走）的秒数 */
  get pending(): number {
    return this.acc;
  }
}
