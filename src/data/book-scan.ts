/* ============================================================
 * bz-reader · 导入时读取书目（data/book-scan.ts）
 *
 * 为什么需要这一层：书架的「作者」一直来自引擎回填（`applyEngineMeta`），
 * 而引擎只在**第一次打开书**时才解析 EPUB 的 OPF。于是导入完的第一屏
 * 永远是「佚名」，点开一本书再回来才变成真作者——看上去像导入没读到。
 *
 * 这里在「加入书架」那一刻就把书当 zip 打开一次，读 dc:title /
 * dc:creator 等字段写进记录。和 cover.ts 取封面的口径一致：
 *   · TXT 没有内嵌书目，直接跳过；
 *   · 超过 40MB 的书不为了书目把整本读进内存（书架会退回文件名）；
 *   · 任何一本坏书只记一条 warn，绝不挡住整批导入。
 *
 * 解析用的是 foliate 的 `makeBook`（同一套 loader，mobi/azw3 也认），
 * 读完立刻 `destroy()`：zip 解出来的资源不留在内存里等 GC。
 * ============================================================ */
import type { App } from 'obsidian';
import { makeBook } from '../engine/foliate';
import { applyEngineMeta, engineMetaFromBook, type EngineMeta } from './book-meta';
import { formatOf, titleFromPath } from './book-repo';
import type { ReaderBook } from './schema';

/** 与封面同一口径：超过这个大小不整本读进来，书目退回文件名 */
const MAX_META_SOURCE = 40 * 1024 * 1024;
/** 同时解几本：zip 解压是纯 CPU，一次解太多会让导入面板掉帧 */
const PARALLEL = 3;

/**
 * 读一本文件的内嵌书目。TXT（或读不出来）返回 null。
 *
 * 不吞 `readBinary` 的错误——由 `fillBookMeta` 统一收口，调用方要能区分
 * 「没有书目」和「这本书坏了」。
 */
export async function readBookMeta(app: App, path: string, size = 0): Promise<EngineMeta | null> {
  const format = formatOf(path);
  if (!format || format === 'txt') return null;
  if (size > MAX_META_SOURCE) return null;
  const data = await app.vault.adapter.readBinary(path);
  const name = path.split('/').pop() || `book.${format}`;
  const fb = await makeBook(new File([data], name));
  try {
    return engineMetaFromBook(fb, titleFromPath(path));
  } finally {
    try {
      fb.destroy?.();
    } catch {
      /* 已销毁的书再 destroy 会抛，忽略 */
    }
  }
}

/**
 * 文件大小。导入本地文件时 `ensure()` 拿到的是 0（写盘那一刻还没有 stat），
 * 这里补一次；拿不到就当未知，照常解析——宁可多读一本，也别把大书保护
 * 变成「所有导入的书都跳过」。
 */
async function sizeOf(app: App, book: ReaderBook): Promise<number> {
  if (book.fileRef.size) return book.fileRef.size;
  try {
    const st = await app.vault.adapter.stat(book.fileRef.vaultPath);
    return st?.size ?? 0;
  } catch {
    return 0;
  }
}

/** 读一本并回填进书记录。返回是否真的改了什么（调用方据此决定重绘） */
export async function fillBookMeta(app: App, book: ReaderBook): Promise<boolean> {
  try {
    const meta = await readBookMeta(app, book.fileRef.vaultPath, await sizeOf(app, book));
    return meta ? applyEngineMeta(book, meta) : false;
  } catch (e) {
    console.warn('[bz-reader] 读取书目失败：', book.fileRef.vaultPath, (e as Error)?.message || e);
    return false;
  }
}

/** 批量回填（导入一页几十本时用）。返回真的写进去几本 */
export async function fillBookMetas(app: App, books: ReaderBook[], concurrency = PARALLEL): Promise<number> {
  let changed = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= books.length) return;
      const book = books[i];
      if (!book) continue;
      if (await fillBookMeta(app, book)) changed += 1;
    }
  };
  const workers = Math.min(Math.max(1, concurrency), books.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return changed;
}
