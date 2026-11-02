/* ============================================================
 * bz-reader · 阅读统计聚合（data/stats.ts）
 *
 * 只做一件事：把所有书的 `reading.sessions[]` 折叠成统计页要的四样——
 * 总时长、今日、连续天数、按天的秒数表（热力图数据源）。
 *
 * 口径统一走 sessions 汇总，不混用 stats.totalReadTime：totalReadTime
 * 是「含未结算会话的累计」，sessions 是「已落盘的明细」。统计页如果
 * 一半用前者一半用后者，热力图加起来会对不上总数，看起来就是 bug。
 *
 * 天的 key 用本地时区（不是 UTC）：用户半夜读书，按 UTC 会记到第二天。
 * ============================================================ */
import type { ReaderBook } from './schema';

const MS_DAY = 86_400_000;

/** 时间戳 → 本地时区 YYYY-MM-DD */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export interface StatsBookRow {
  id: string;
  title: string;
  author?: string;
  /** 0..1 */
  percent: number;
  /** 该书已落盘会话的秒数汇总 */
  seconds: number;
  lastRead: number;
}

export interface StatsSummary {
  /** 全部已落盘会话的秒数汇总 */
  totalSeconds: number;
  /** 今天（本地时区）读的秒数 */
  todaySeconds: number;
  /** 连续阅读天数（今天没读不算断，从昨天接着数） */
  streakDays: number;
  /** 有阅读记录的天数 */
  activeDays: number;
  /** 当日秒数表，key 是本地时区 YYYY-MM-DD */
  days: Record<string, number>;
  books: StatsBookRow[];
}

export function collectStats(books: ReaderBook[], now = Date.now()): StatsSummary {
  const days: Record<string, number> = {};
  let totalSeconds = 0;
  for (const b of books) {
    for (const s of b.reading.sessions) {
      // start 缺失或 ≤0 是废数据（schema.ts 的约定：bz 侧同样整条丢弃）
      if (!s.start || s.start <= 0) continue;
      const sec = Math.max(0, Math.round(s.durationSeconds || 0));
      if (!sec) continue;
      totalSeconds += sec;
      const k = dayKey(s.start);
      days[k] = (days[k] || 0) + sec;
    }
  }

  const today = dayKey(now);
  // 连续天数：锚点固定在中午再走天步进，避免午夜边界把「昨晚」误判成「今天没读」
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  let cursor = noon.getTime();
  if (!(days[dayKey(cursor)] > 0)) cursor -= MS_DAY; // 今天还没读，连续从昨天起算
  let streakDays = 0;
  while (days[dayKey(cursor)] > 0) {
    streakDays += 1;
    cursor -= MS_DAY;
  }

  const bookRows: StatsBookRow[] = books
    .map((b) => {
      let seconds = 0;
      for (const s of b.reading.sessions) {
        if (!s.start || s.start <= 0) continue;
        seconds += Math.max(0, Math.round(s.durationSeconds || 0));
      }
      return {
        id: b.id,
        title: b.meta.title,
        author: b.meta.author,
        percent: b.reading.position.percent || 0,
        seconds,
        lastRead: b.reading.stats.lastReadTime || 0,
      };
    })
    .filter((r) => r.seconds > 0 || r.percent > 0)
    .sort((a, b) => b.lastRead - a.lastRead || b.seconds - a.seconds);

  return {
    totalSeconds,
    todaySeconds: days[today] || 0,
    streakDays,
    activeDays: Object.keys(days).length,
    days,
    books: bookRows,
  };
}
