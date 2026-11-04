/* ============================================================
 * bz-reader · 封面（data/cover.ts）
 *
 * 书架要显示真封面，而不是「书名哈希出来的色块」。取封面的正路只有一条：
 * 把 EPUB 当 zip 打开，读 OPF 里属性为 cover-image 的那张图。foliate 的
 * book 对象上已经有 `getCover()`（返回 Blob），所以这里不自己解压——
 * 少一份 zip 解析就少一处和规范细节（大小写、相对路径、SVG 封面）打架。
 *
 * 三层缓存，按代价从低到高：
 *   1. 内存  Map<bookId, objectURL>  —— 同一次会话里翻来翻去不重读
 *   2. 磁盘  <插件目录>/storage/covers/<key>  —— 下次启动直接可用
 *   3. 解析  makeBook → getCover()   —— 只在没有缓存时发生
 *
 * 为什么必须落盘：解一次要用 zip.js 把整本书解到内存，一本 3MB 的书
 * 解 50 本就够卡住书架首屏。落盘之后第 2 次起只是读一个几十 KB 的小图。
 *
 * key = `<bookId>-<size>`：书换了（同名不同版本）size 会变，自然换新图；
 * 不做清理也没关系——读不到就是重新生成一次。
 * ============================================================ */
import type { App } from 'obsidian';
import type { ReaderBook } from './schema';
import { makeBook } from '../engine/foliate';
import type { FoliateBook } from '../types/foliate';
import { storageDirOf } from '../core/plugin-path';
import { coverFileName, normalizeCoverIndex, type CoverIndex } from './cover-name';

const MEM = new Map<string, string>();
/** bookId → 最近一次命中的缓存文件（vault 相对路径），供回填 meta.coverPath */
const MEM_PATH = new Map<string, string>();
const PENDING = new Map<string, Promise<string | null>>();
let index: CoverIndex | null = null;
let indexLoading: Promise<CoverIndex> | null = null;

/** 同时最多解两本：'EPUB' 的 zip 解压是纯 CPU，解多了就是整屏掉帧 */
const MAX_PARALLEL = 2;
let active = 0;
const waiting: Array<() => void> = [];

function limit<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = (): void => {
      active += 1;
      fn()
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          const next = waiting.shift();
          if (next) next();
        });
    };
    if (active < MAX_PARALLEL) run();
    else waiting.push(run);
  });
}

function coversDir(app: App): string {
  return `${storageDirOf(app)}/covers`;
}

function indexPath(app: App): string {
  return `${coversDir(app)}/index.json`;
}

function keyOf(book: ReaderBook): string {
  return `${book.id}-${book.fileRef.size ?? 0}`;
}

function blobUrl(buf: ArrayBuffer, mime: string): string {
  return URL.createObjectURL(new Blob([buf], { type: mime }));
}

async function loadIndex(app: App): Promise<CoverIndex> {
  if (index) return index;
  if (indexLoading) return indexLoading;
  indexLoading = (async () => {
    try {
      const path = indexPath(app);
      if (await app.vault.adapter.exists(path)) {
        index = normalizeCoverIndex(JSON.parse(await app.vault.adapter.read(path)));
      } else {
        index = {};
      }
    } catch {
      index = {};
    }
    return index;
  })();
  return indexLoading;
}

async function readCache(app: App, book: ReaderBook): Promise<string | null> {
  const idx = await loadIndex(app);
  const key = keyOf(book);
  const entry = idx[key];
  if (!entry) return null;
  const path = `${coversDir(app)}/${entry.file}`;
  try {
    if (!(await app.vault.adapter.exists(path))) return null;
    const buf = await app.vault.adapter.readBinary(path);
    const url = blobUrl(buf, entry.mime);
    if (entry.file === key) {
      /* 旧缓存（无扩展名，`file` 就是 key）：顺手升级成带扩展名的。
         否则 meta.coverPath 会是一条 app:// 推不出 MIME 的路径，
         外部（bz 书库）拿它当图片用就是一片空白。 */
      await writeCache(app, book, buf, entry.mime);
    } else {
      MEM_PATH.set(book.id, path);
    }
    return url;
  } catch {
    return null;
  }
}

async function writeCache(app: App, book: ReaderBook, buf: ArrayBuffer, mime: string): Promise<void> {
  const key = keyOf(book);
  try {
    const dir = coversDir(app);
    if (!(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir);
    /* 带扩展名落盘：外部（bz 书库）要拿 meta.coverPath 直接当 vault 图片路径，
       没有扩展名时 app:// 推不出 MIME，<img> 是一片空白。 */
    const file = coverFileName(key, mime);
    await app.vault.adapter.writeBinary(`${dir}/${file}`, buf);
    const idx = await loadIndex(app);
    idx[key] = { mime, file };
    MEM_PATH.set(book.id, `${dir}/${file}`);
    await app.vault.adapter.write(indexPath(app), JSON.stringify(idx, null, 0));
  } catch {
    /* 落盘失败只影响下次启动要重解一次，不该让书架报错 */
  }
}

/**
 * 超过这个大小就不提封面（P3-11）。
 *
 * foliate 的 `makeBook()` 要一个完整 File，没法只读 zip 里那一张图。
 * 一本 100MB 的漫画，只为了书架上那张 200px 的图把整本读进内存，
 * 手机上就是一次可感知的卡顿甚至 OOM。书架会退回哈希色块兜底。
 */
const MAX_COVER_SOURCE = 40 * 1024 * 1024;

/** 打开书 → 取封面 Blob。TXT 没有封面，直接返回 null。 */
async function extract(app: App, book: ReaderBook): Promise<{ buf: ArrayBuffer; mime: string } | null> {
  if (book.fileRef.format === 'txt') return null;
  const size = book.fileRef.size ?? 0;
  if (size > MAX_COVER_SOURCE) return null;
  const data = await app.vault.adapter.readBinary(book.fileRef.vaultPath);
  const name = book.fileRef.vaultPath.split('/').pop() || 'book.epub';
  const file = new File([data], name);
  const fb = (await makeBook(file)) as FoliateBook & { getCover?: () => Promise<Blob | null> };
  try {
    const blob = await fb.getCover?.();
    if (!blob || !blob.size) return null;
    return { buf: await blob.arrayBuffer(), mime: blob.type || 'image/jpeg' };
  } finally {
    try {
      fb.destroy?.();
    } catch {
      /* 已销毁的书再 destroy 会抛，忽略 */
    }
  }
}

/**
 * 打开书时顺手落封面：复用引擎**已经解出来的** book 对象（`getCover()`），
 * 不再 makeBook 解第二遍。写完缓存后由调用方回填 `meta.coverPath`。
 *
 * 为什么不能只靠书架：用户可能只读书、从不打开书架，那时封面缓存永远不会生成，
 * 数据文件里的 `coverPath` 就一直是空的——外部（bz 书库）只能看到色块。
 */
export async function ensureCoverFromFoliate(
  app: App,
  book: ReaderBook,
  foliate: { getCover?: () => Promise<Blob | null> },
): Promise<string | null> {
  if (book.fileRef.format === 'txt') return null;
  const cached = MEM.get(book.id);
  if (cached) return cached;

  const fromDisk = await readCache(app, book);
  if (fromDisk) {
    MEM.set(book.id, fromDisk);
    return fromDisk;
  }

  try {
    const blob = await foliate.getCover?.();
    if (!blob || !blob.size) return null;
    const buf = await blob.arrayBuffer();
    const mime = blob.type || 'image/jpeg';
    const url = blobUrl(buf, mime);
    MEM.set(book.id, url);
    await writeCache(app, book, buf, mime);
    return url;
  } catch {
    return null;
  }
}

/**
 * 取封面 URL（objectURL）。拿不到就返回 null，调用方继续用哈希色块兜底——
 * 封面是锦上添花，不能因为一本破书让整面书架停下来。
 */
export async function coverUrl(app: App, book: ReaderBook): Promise<string | null> {
  if (book.fileRef.format === 'txt') return null;
  const cached = MEM.get(book.id);
  if (cached) return cached;

  const inflight = PENDING.get(book.id);
  if (inflight) return inflight;

  const task = limit(async () => {
    const fromDisk = await readCache(app, book);
    if (fromDisk) {
      MEM.set(book.id, fromDisk);
      return fromDisk;
    }
    const got = await extract(app, book);
    if (!got) return null;
    const url = blobUrl(got.buf, got.mime);
    MEM.set(book.id, url);
    await writeCache(app, book, got.buf, got.mime);
    return url;
  })
    .catch(() => null)
    .finally(() => {
      PENDING.delete(book.id);
    });

  PENDING.set(book.id, task);
  return task;
}

/** 这本书最近一次命中的封面缓存路径（vault 相对）；没解出来过就是 null。
 *  调用方（shell/covers.ts）拿它回填 `meta.coverPath`，外部读数据文件时
 *  才有图可用——这个字段以前声明了却从来没有写入点。 */
export function coverPathOf(bookId: string): string | null {
  return MEM_PATH.get(bookId) || null;
}

/** 插件卸载时释放 objectURL（不释放也不崩，但会一直占着内存里的图） */
export function releaseCovers(): void {
  for (const url of MEM.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* 已经释放过 */
    }
  }
  MEM.clear();
  MEM_PATH.clear();
}
