/* ============================================================
 * bz-reader · 复习卡搬家（data/review-migrate.ts）
 *
 * 用户在设置里改了「复习卡目录」之后，旧卡片还留在原处。以前只提示一句
 * 「已有卡片不搬」，因为搬文件要同时改两处：划线上的路径（我们自己的）和
 * bz 复习排期表里的路径（别人的）。只改一处就得到一批打不开的排期。
 *
 * 这里只做**规划**：哪些卡片该搬、从哪到哪。真正动文件、改数据、更新排期
 * 由调用方按顺序做，失败可逐条计数。纯函数，不碰盘。
 * ============================================================ */
import type { ReaderBook } from './schema';

export interface CardMove {
  bookId: string;
  highlightId: string;
  /** 现在的位置（vault 相对路径，含 .md） */
  from: string;
  /** 目标位置（同目录名，换目录） */
  to: string;
}

/** 目录归一：`/` 与空串都是库根，其余去首尾斜杠 */
export function normalizeMoveDir(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s || s === '/') return '';
  return s.replace(/^\/+|\/+$/g, '');
}

/** 这个路径在不在给定目录下（库根 = 任何不带目录的路径都算） */
export function pathUnder(path: string, dir: string): boolean {
  const p = String(path ?? '').trim();
  if (!p) return false;
  const d = normalizeMoveDir(dir);
  if (!d) return !p.includes('/');
  return p.startsWith(`${d}/`);
}

/**
 * 规划要搬的卡片。
 *
 * 三条边界：
 *   · 只搬**划线上记着路径**的：路径丢了就找不到文件，硬猜会搬错别人的笔记。
 *   · 同一个目标名已经被人占了就算冲突，交给调用方改名——这里不替它决定。
 *   · 已经在新目录下的不搬（用户改回去再改回来时不该重复搬）。
 */
export function planCardMoves(books: readonly ReaderBook[], oldDir: string, newDir: string): CardMove[] {
  const from = normalizeMoveDir(oldDir);
  const to = normalizeMoveDir(newDir);
  if (from === to) return [];
  const out: CardMove[] = [];
  for (const book of books) {
    for (const h of book?.notes?.highlights ?? []) {
      const path = String(h.review?.path ?? '').trim();
      if (!path || !pathUnder(path, from)) continue;
      if (pathUnder(path, to) && to) continue;
      const name = path.split('/').pop() ?? '';
      if (!name) continue;
      out.push({ bookId: book.id, highlightId: h.id, from: path, to: to ? `${to}/${name}` : name });
    }
  }
  return out;
}
