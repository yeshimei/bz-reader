/* ============================================================
 * bz-reader · 画像的内存缓存（shell/portrait-cache.ts）
 *
 * 画像文件是按书存的，读一次要过 vault adapter（手机上是几百 KB 的
 * JSON）。弹层、详情页、书籍鸟瞰都要问「这本建了没」，每次都读一遍
 * 会让打开详情卡半秒。
 *
 * 缓存的是**这份文件的快照**，不是真相：写完之后调 `setPortrait` /
 * `forgetPortrait` 就地更新，不指望它自己过期。
 * ============================================================ */
import type { App } from 'obsidian';
import { readPortrait, type PortraitFile } from '../data/portrait';

const cache = new Map<string, PortraitFile | null>();
const pending = new Set<string>();

/** undefined = 还没读过（界面据此决定要不要先显示「未建」） */
export function cachedPortrait(bookId: string): PortraitFile | null | undefined {
  return cache.get(bookId);
}

export function setPortrait(bookId: string, p: PortraitFile | null): void {
  cache.set(bookId, p);
}

export function forgetPortrait(bookId?: string): void {
  if (bookId) cache.delete(bookId);
  else cache.clear();
}

/**
 * 读一次并缓存。同一个 id 在读的时候再调不会重复读——详情页每次重画
 * 都会问一次，不挡住就会并排发好几个读盘请求。
 */
export async function ensurePortrait(
  app: App | null | undefined,
  bookId: string,
  onReady?: (p: PortraitFile | null) => void,
): Promise<PortraitFile | null> {
  const hit = cache.get(bookId);
  if (hit !== undefined) return hit;
  if (pending.has(bookId)) return null;
  pending.add(bookId);
  try {
    const p = await readPortrait(app, bookId);
    cache.set(bookId, p);
    onReady?.(p);
    return p;
  } finally {
    pending.delete(bookId);
  }
}
