/* ============================================================
 * bz-reader · 画像读取缓存（data/portrait-cache.ts）
 *
 * 一次提问要读这本书的画像。向量画像里存着全书原文，一本 30 万字的书
 * 是 600KB–1MB 的 JSON；每次提问都重新读盘 + parse，大书上光这一步就是
 * 几百毫秒的白等。
 *
 * 缓存键是 `bookId`，判据是 `mtime + size`（同一秒内重建两次时 mtime 可能
 * 一样，size 才不会）。重建走 `writePortrait` 的 rename，mtime 必变，
 * 所以缓存不会把旧向量当成新向量。
 *
 * 不用 `loadPortraits` 的全库缓存：那个会把**所有**书的画像都读一遍，
 * 只为问一本时反而更慢。这里只碰需要的那一份。
 * ============================================================ */
import type { App } from 'obsidian';
import { portraitPath, readPortrait, type PortraitFile } from './portrait';

const cache = new Map<string, { mtime: number; size: number; portrait: PortraitFile | null }>();

/** 读一份画像；文件没变就直接用内存里的那份 */
export async function readPortraitCached(
  app: App | null | undefined,
  bookId: string,
): Promise<PortraitFile | null> {
  const adapter = app?.vault?.adapter;
  if (!adapter) return null;
  const id = String(bookId ?? '');
  if (!id) return null;
  const path = portraitPath(id);

  let mtime = 0;
  let size = 0;
  try {
    const st = await adapter.stat(path);
    mtime = Number(st?.mtime) || 0;
    size = Number(st?.size) || 0;
  } catch {
    /* stat 不可用（平台差异）或文件不在：交给 readPortrait 给准确结果。
       缓存里那份可能已经对应一个被删掉的文件，先丢掉。 */
    cache.delete(id);
    return readPortrait(app, id);
  }

  const hit = cache.get(id);
  if (hit && hit.mtime === mtime && hit.size === size) return hit.portrait;

  const portrait = await readPortrait(app, id);
  cache.set(id, { mtime, size, portrait });
  return portrait;
}

/** 测试与「清理无主画像」用：丢掉一本（或全部）缓存 */
export function forgetPortraitCache(bookId?: string): void {
  if (bookId) cache.delete(String(bookId));
  else cache.clear();
}
