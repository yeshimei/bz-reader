/**
 * 进度保存时的重绘节流（纯函数）。
 *
 * `saveRelocate` 每翻一页都会跑，而 `notifyShell()` 会让侧栏、书架、弹层各自
 * 全量重绘一次（书架是整面封面墙）。翻页是最热的交互，每次都重建两棵 DOM
 * 在手机上就是掉帧。策略：换章立刻广播；同章内按百分比变化 + 1.2 秒节流。
 */
export const RELOCATE_NOTIFY_MS = 1200;
/** 进度长时间不动也要刷一次（统计页的「今日分钟」不该停住） */
const HEARTBEAT_MS = 5000;

export function shouldNotifyRelocate(input: {
  now: number;
  lastAt: number;
  lastPct: number;
  pct: number;
  chapterChanged: boolean;
}): boolean {
  if (input.chapterChanged) return true;
  const elapsed = input.now - input.lastAt;
  if (!Number.isFinite(elapsed) || elapsed < 0) return true;
  if (elapsed >= HEARTBEAT_MS) return true;
  if (elapsed < RELOCATE_NOTIFY_MS) return false;
  return Math.round(input.pct * 100) !== Math.round(input.lastPct * 100);
}
