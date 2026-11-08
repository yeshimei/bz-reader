/* ============================================================
 * bz-reader · 封面（data/cover.ts）
 *
 * 书架要显示真封面，而不是「书名哈希出来的色块」。取封面的正路只有一条：
 * 把 EPUB 当 zip 打开，读 OPF 里属性为 cover-image 的那张图。foliate 的
 * book 对象上已经有 `getCover()`（返回 Blob），所以这里不自己解压——
 * 少一份 zip 解析就少一处和规范细节（大小写、相对路径、SVG 封面）打架。
 *
 * 三层缓存，按代价从低到高：
 *   1. 内存  LRU<key, objectURL>     —— 同一次会话里翻来翻去不重读，上限 60 条
 *              key 与磁盘缓存同口径（`id-size`）：书换了版本 size 就变，
 *              否则内存里那张旧图会一直顶着新书显示到下次重启。
 *   2. 磁盘  <数据目录>/covers/<key>  —— 下次启动直接可用
 *   3. 解析  makeBook → getCover()   —— 只在没有缓存时发生
 *
 * 取不到封面时记一条失败负缓存（size/mtime 为签名）：坏书、无封面的书
 * 不会因为书架每次重绘就整本 readBinary + 解一次 zip。只有源文件真的
 * 被换掉（size 或 mtime 变了）才重试。
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
import { CoverFailureCache, CoverMemory } from './cover-cache';
import { coverFileName, normalizeCoverIndex, type CoverIndex } from './cover-name';

const MEM = new CoverMemory();
/** bookId → 最近一次命中的缓存文件（vault 相对路径），供回填 meta.coverPath */
const MEM_PATH = new Map<string, string>();
const PENDING = new Map<string, Promise<string | null>>();
/** bookId-size → 取封面失败时的源文件 size/mtime，用来判断值不值得重试 */
const FAILED = new CoverFailureCache();
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

/**
 * 缓存 key。**必须只含安全字符**：它会直接变成 `covers/<key>.<ext>` 的文件名。
 *
 * `book.id` 在 store 的 sanitize 里已经限成 `^[\w-]{1,64}$`，这里再洗一次是
 * 最后一道——`keyOf` 也接受刚 `makeBook` 出来的内存对象，以及从别处传进来的
 * 记录；一个 `/` 或 `../` 就能让封面写到数据目录外面。
 */
function keyOf(book: ReaderBook): string {
  const id = String(book.id ?? '').replace(/[^\w-]/g, '_').slice(0, 64) || 'book';
  const size = Number(book.fileRef?.size);
  return `${id}-${Number.isFinite(size) ? size : 0}`;
}

function blobUrl(buf: ArrayBuffer, mime: string): string {
  return URL.createObjectURL(new Blob([buf], { type: mime }));
}

/** 源文件的当前 size/mtime；拿不到就退回书记录里的 size（mtime 记 0） */
async function sourceSig(app: App, book: ReaderBook): Promise<{ size: number; mtime: number }> {
  const st = await app.vault.adapter.stat(book.fileRef.vaultPath).catch(() => null);
  return {
    size: st?.size ?? book.fileRef.size ?? 0,
    mtime: st?.mtime ?? 0,
  };
}

/** 负缓存命中就不必再解一遍。size 或 mtime 变了才值得重试 */
async function stillFailing(app: App, book: ReaderBook): Promise<boolean> {
  const key = keyOf(book);
  const mark = FAILED.markOf(key);
  if (!mark) return false;
  const sig = await sourceSig(app, book);
  if (mark.size === sig.size && mark.mtime === sig.mtime) return true;
  FAILED.forget(key);
  return false;
}

async function rememberFailure(app: App, book: ReaderBook): Promise<void> {
  const sig = await sourceSig(app, book);
  FAILED.remember(keyOf(book), sig.size, sig.mtime);
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
  const cached = MEM.get(keyOf(book));
  if (cached) return cached;

  const fromDisk = await readCache(app, book);
  if (fromDisk) {
    MEM.set(keyOf(book), fromDisk);
    FAILED.forget(keyOf(book));
    return fromDisk;
  }

  try {
    const blob = await foliate.getCover?.();
    if (!blob || !blob.size) return null;
    const buf = await blob.arrayBuffer();
    const mime = blob.type || 'image/jpeg';
    const url = blobUrl(buf, mime);
    MEM.set(keyOf(book), url);
    FAILED.forget(keyOf(book));
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
  const cached = MEM.get(keyOf(book));
  if (cached) return cached;

  const inflight = PENDING.get(book.id);
  if (inflight) return inflight;

  const task = limit(async () => {
    try {
      /* 先看磁盘缓存：一次失败记录之后，用户可能已经从打开书那里拿到了封面
         （ensureCoverFromFoliate 会落盘）。读一个小图 + 内存索引，代价远小于
         重解整本；负缓存只该拦「连磁盘缓存也没有」的重试。 */
      const fromDisk = await readCache(app, book);
      if (fromDisk) {
        MEM.set(keyOf(book), fromDisk);
        return fromDisk;
      }
      /* 上次就取不到、且源文件没变：直接返回 null，别再整本读 + 解 zip。
         一本书在书架上重绘几次，代价就从「每次都解一遍」降成「一次 stat」。 */
      if (await stillFailing(app, book)) return null;

      const got = await extract(app, book);
      if (!got) {
        await rememberFailure(app, book);
        return null;
      }
      const url = blobUrl(got.buf, got.mime);
      MEM.set(keyOf(book), url);
      await writeCache(app, book, got.buf, got.mime);
      return url;
    } catch {
      /* 读二进制 / 解 zip 抛错也算「这本取不出封面」，同样负缓存 */
      await rememberFailure(app, book);
      return null;
    }
  }).finally(() => {
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
  MEM.clear();
  MEM_PATH.clear();
  FAILED.clear();
  PENDING.clear();
  /* 索引也是「按当前库」的缓存：换库/重载后不能拿旧索引指到别的目录 */
  index = null;
  indexLoading = null;
}
