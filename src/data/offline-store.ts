/* ============================================================
 * bz-reader · 离线包读写（data/offline-store.ts）
 *
 * 只做一件事：把一个 `OfflineBook` 落到库目录里，或者从库目录里读回来。
 * 文件系统用注入的 `PackFS`，所以整条「写一章 → 读清单 → 扫包 → 删包」
 * 能在 node 里用内存假文件系统跑完，不需要真 Obsidian。
 *
 * 目录布局：
 *   bz-reader/offline/围城/manifest.json
 *   bz-reader/offline/围城/第一章.mp3
 *
 * 为什么不塞进插件自己的数据目录：这个目录要能被用户直接拷到手机上。
 * 放在 `bz-reader/` 下面，等于「跟书库一起走、但跟正文分开」。
 * ============================================================ */

import {
  OFFLINE_MANIFEST,
  OFFLINE_ROOT,
  packagePath,
  parseOfflineBook,
  serializeOfflineBook,
  type OfflineBook,
  type OfflineChapter,
} from '../core/offline-pack';

/** 只用到文件系统的这几个动作；Obsidian 的 adapter 能直接适配 */
export interface PackFS {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  readText(path: string): Promise<string>;
  list(path: string): Promise<{ folders: string[]; files: string[] }>;
  remove(path: string): Promise<void>;
  /** 删目录。`recursive` 必须为真才能删非空目录——`remove` 对目录不管用 */
  rmdir(path: string, recursive?: boolean): Promise<void>;
}

export interface PackRef {
  /** 目录名（也是书名） */
  title: string;
  /** 清单绝对路径 */
  path: string;
}

export function manifestPath(title: string): string {
  return `${packagePath(title)}/${OFFLINE_MANIFEST}`;
}

export function chapterPath(title: string, file: string): string {
  return `${packagePath(title)}/${file}`;
}

/**
 * 逐级建目录。
 *
 * Obsidian 的 `createFolder` 不会替我们建父目录，`bz-reader/offline/围城`
 * 直接建会失败；而用户第一次导出时这两级都不存在。
 */
export async function ensureDir(fs: PackFS, path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  let at = '';
  for (const part of parts) {
    at = at ? `${at}/${part}` : part;
    if (!(await fs.exists(at))) await fs.mkdir(at);
  }
}

/** 读一本的清单。没有 / 坏了都给 null，不抛。 */
export async function readManifest(fs: PackFS, title: string): Promise<OfflineBook | null> {
  const path = manifestPath(title);
  try {
    if (!(await fs.exists(path))) return null;
    return parseOfflineBook(await fs.readText(path));
  } catch {
    return null;
  }
}

/**
 * 写清单。**先建目录再写**——`createBinary` 不会替我们建父目录。
 *
 * 写完立刻读回校验：磁盘满、权限问题、同步冲突都可能让文件只写了一半，
 * 而用户看到的是「明明导了却没有」。读回解析失败就直接抛，让上层提示。
 */
export async function writeManifest(fs: PackFS, book: OfflineBook): Promise<void> {
  await ensureDir(fs, packagePath(book.title));
  const text = serializeOfflineBook(book);
  await fs.writeBinary(manifestPath(book.title), new TextEncoder().encode(text).buffer);
  const back = await readManifest(fs, book.title);
  if (!back) throw new Error('manifest write failed');
}

/** 写一章的音频文件，返回它的库内路径 */
export async function writeChapter(
  fs: PackFS,
  title: string,
  chapter: OfflineChapter,
  data: ArrayBuffer,
): Promise<string> {
  await ensureDir(fs, packagePath(title));
  const path = chapterPath(title, chapter.file);
  await fs.writeBinary(path, data);
  return path;
}

/** 读一章的音频。文件不在给 null（用户可能只拷了清单）。 */
export async function readChapter(fs: PackFS, title: string, chapter: OfflineChapter): Promise<ArrayBuffer | null> {
  const path = chapterPath(title, chapter.file);
  try {
    if (!(await fs.exists(path))) return null;
    const data = await fs.readBinary(path);
    return data.byteLength ? data : null;
  } catch {
    return null;
  }
}

/**
 * 扫出所有包。
 *
 * 只看一层子目录、只认能解析的 manifest：用户会在 `offline/` 里放截图、
 * 放说明、放拷了一半的目录，这些都不该让扫描报错。
 */
export async function scanPacks(fs: PackFS): Promise<Array<{ ref: PackRef; book: OfflineBook }>> {
  const out: Array<{ ref: PackRef; book: OfflineBook }> = [];
  try {
    if (!(await fs.exists(OFFLINE_ROOT))) return out;
    const { folders } = await fs.list(OFFLINE_ROOT);
    for (const dir of folders) {
      const title = dir.split('/').pop() ?? '';
      if (!title) continue;
      try {
        const raw = await fs.readText(`${dir}/${OFFLINE_MANIFEST}`);
        const book = parseOfflineBook(raw);
        if (book) out.push({ ref: { title, path: dir }, book });
      } catch {
        /* 这个目录没有清单 / 读不了：跳过，不影响别的包 */
      }
    }
  } catch {
    /* 扫不动就当没有离线包 */
  }
  return out;
}

/**
 * 找「这本书」的包。
 *
 * 先按书名对——目录名就是书名，最直观；对不上再按 bookId 兜底（用户
 * 改过书名时还能认出来）。两条都不中就是没有。
 */
export async function findPack(
  fs: PackFS,
  meta: { title: string; bookId?: string },
): Promise<{ ref: PackRef; book: OfflineBook } | null> {
  const all = await scanPacks(fs);
  const byTitle = all.find((p) => p.book.title === meta.title || p.ref.title === meta.title);
  if (byTitle) return byTitle;
  if (meta.bookId) {
    const byId = all.find((p) => p.book.bookId && p.book.bookId === meta.bookId);
    if (byId) return byId;
  }
  return null;
}

/**
 * 删掉整本书的包（音频 + 清单）。
 *
 * 用 `rmdir(recursive)` 而不是 `remove`：Obsidian 的 `adapter.remove` 只删
 * 单个文件，对目录无效——真机上表现为「点了清理、弹了提示、文件还在」。
 */
export async function deletePack(fs: PackFS, title: string): Promise<void> {
  const dir = packagePath(title);
  try {
    if (!(await fs.exists(dir))) return;
    await fs.rmdir(dir, true);
  } catch {
    /* 删不掉只能下次再删，不该让界面报错 */
  }
}

/** 整包体积：清单里记的字节数之和，不去遍历目录 */
export function packBytes(book: OfflineBook): number {
  return book.chapters.reduce((n, c) => n + Math.max(0, c.bytes), 0);
}
