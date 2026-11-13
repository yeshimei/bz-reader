/* ============================================================
 * bz-reader · 书架仓储（data/book-repo.ts）
 *
 * 只做「数据的增删查整理」，不碰渲染、不碰 DOM。
 * 书从哪来：扫 vault 里认得的扩展名。不做「导入」动作里的复制搬移——
 * 用户把书放哪就留在哪，插件只记路径。这样 vault 里不会多出一堆副本，
 * 也符合 Obsidian 的「文件即数据」直觉。
 * ============================================================ */
import type { App } from 'obsidian';
import { emptyNotes, emptyReading, type BookFormat, type ReaderBook } from './schema';
/* 改名（relocate）后清掉 PDF 反链索引缓存：否则旧路径的缓存一直留着、
   新路径又查不到，引用页签不刷新。pdf-backlink 不反向依赖本模块，单向 import 无循环。 */
import { invalidatePdfBacklinks } from './pdf-backlink';
import { isClipBookRecord } from './clip-book-entry';

/** 基础版认得的格式。高级版放开全部，由调用方传 allowed 覆盖。 */
export const BASE_FORMATS: BookFormat[] = ['epub', 'txt'];
export const PRO_FORMATS: BookFormat[] = ['epub', 'txt', 'mobi', 'azw3', 'fb2', 'cbz', 'pdf'];

/** 给文案用的格式枚举：「EPUB / TXT」 */
export function BOOK_FORMATS_LABEL(formats: BookFormat[]): string {
  return formats.map((f) => f.toUpperCase()).join(' / ');
}

const EXT_TO_FORMAT: Record<string, BookFormat> = {
  epub: 'epub',
  txt: 'txt',
  mobi: 'mobi',
  azw3: 'azw3',
  azw3x: 'azw3',
  fb2: 'fb2',
  cbz: 'cbz',
  pdf: 'pdf',
};

export function formatOf(path: string): BookFormat | null {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return EXT_TO_FORMAT[ext] ?? null;
}

/** 稳定 id：djb2 哈希（碰撞概率对「一个 vault 的书」足够低，且不依赖路径长度） */
export function hashId(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return `b${(h >>> 0).toString(36)}`;
}

/** vault 里所有认得的书（只读文件列表，不读内容——扫描要快） */
export function scanVault(app: App, allowed: BookFormat[] = BASE_FORMATS): Array<{ path: string; format: BookFormat; size: number }> {
  const out: Array<{ path: string; format: BookFormat; size: number }> = [];
  for (const f of app.vault.getFiles()) {
    const fmt = formatOf(f.path);
    if (!fmt || !allowed.includes(fmt)) continue;
    out.push({ path: f.path, format: fmt, size: f.stat?.size ?? 0 });
  }
  out.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
  return out;
}

/** 从文件名推书名（去掉扩展名与常见赘余） */
export function titleFromPath(path: string): string {
  const name = path.split('/').pop() || path;
  return name.replace(/\.[^.]+$/, '').trim() || name;
}

/** 新建一条书记录（元数据随后由引擎填充） */
export function makeBook(path: string, format: BookFormat, size = 0, fingerprint?: string): ReaderBook {
  const now = Date.now();
  return {
    id: hashId(path),
    meta: { title: titleFromPath(path) },
    fileRef: { vaultPath: path, format, size, ...(fingerprint ? { fingerprint } : {}) },
    reading: emptyReading(),
    notes: emptyNotes(),
    addedAt: now,
    updatedAt: now,
  };
}

export interface EnsureResult {
  book: ReaderBook;
  created: boolean;
  /**
   * 指纹命中的是**另一条路径**上的记录：调用方确认旧路径已经不可用之后，
   * 调 `relocate()` 把记录挪到新路径。仓库层不碰文件系统，判断不了。
   */
  pathChanged?: boolean;
  /** 命中的是一条归档记录：已经清掉归档标记，进度与划线原样接上 */
  revived?: boolean;
}

export class BookRepo {
  constructor(private books: ReaderBook[]) {}

  all(): ReaderBook[] {
    return this.books;
  }

  byId(id: string): ReaderBook | undefined {
    return this.books.find((b) => b.id === id);
  }

  byPath(path: string): ReaderBook | undefined {
    return this.books.find((b) => b.fileRef.vaultPath === path);
  }

  /** 按内容指纹查书：同一份文件在书架上最多一条记录 */
  byFingerprint(fingerprint: string): ReaderBook | undefined {
    return this.books.find((b) => b.fileRef.fingerprint === fingerprint);
  }

  /**
   * 登记一本书：有则复用（优先按路径，其次按内容指纹），无则新建。
   *
   * 指纹是「同一份文件只进书架一次」的唯一依据：同一个文件改名、换目录、
   * 复制一份再导入，都只更新路径，不产生第二条记录、不产生第二份进度。
   * 没传指纹（大文件/老数据）时退回按路径匹配，行为与以前一致。
   */
  ensure(path: string, format: BookFormat, size = 0, fingerprint?: string): EnsureResult {
    const exist = this.byPath(path);
    if (exist) {
      exist.fileRef.size = size || exist.fileRef.size;
      /* 同一路径换了内容（用户换了一个版本的文件）：指纹跟着路径走 */
      if (fingerprint && exist.fileRef.fingerprint !== fingerprint) exist.fileRef.fingerprint = fingerprint;
      /* 归档过的书又被导回来：清掉归档标记，进度划线原样接上 */
      const revived = this.revive(exist);
      return { book: exist, created: false, ...(revived ? { revived: true } : {}) };
    }
    if (fingerprint) {
      const same = this.byFingerprint(fingerprint);
      if (same) {
        same.fileRef.size = size || same.fileRef.size;
        const revived = this.revive(same);
        return {
          book: same,
          created: false,
          pathChanged: same.fileRef.vaultPath !== path,
          ...(revived ? { revived: true } : {}),
        };
      }
    }
    const book = makeBook(path, format, size, fingerprint);
    /* djb2 只有 32 位，理论上会撞（P3-09）。撞了就让后来者加后缀——
       两本书共用一个 id，进度、划线、深链会全串到一起，比 id 不好看严重得多。 */
    if (this.byId(book.id)) {
      const base = book.id;
      let n = 2;
      while (this.byId(book.id)) book.id = `${base}-${n++}`;
    }
    this.books.push(book);
    return { book, created: true };
  }

  /** 归档过的书被重新登记时清掉归档标记；返回是否真的复活了 */
  private revive(book: ReaderBook): boolean {
    if (typeof book.archivedAt !== 'number') return false;
    delete book.archivedAt;
    book.updatedAt = Date.now();
    return true;
  }

  /**
   * 移出书架（软删除）：只打一个归档时间，记录与数据全留。
   *
   * 重新导入同一份文件时 `ensure` 会调 `revive` 清掉它，进度/划线/书签/
   * 想法原样接上。真删仍然走 `remove()`（设置页清理或内部用）。
   */
  archive(book: ReaderBook): void {
    book.archivedAt = Date.now();
    book.updatedAt = book.archivedAt;
  }

  /** 清掉指向已不存在文件的记录（不删用户数据，只是标记 fileMissing） */
  markMissing(existingPaths: Set<string>): void {    for (const b of this.books) {
      /* 剪藏本是虚拟书（没有文件）：不能因为路径是空串就标成失联 */
      if (isClipBookRecord(b)) {
        b.fileRef.fileMissing = false;
        continue;
      }
      b.fileRef.fileMissing = !existingPaths.has(b.fileRef.vaultPath);
    }
  }

  /** 书在磁盘上换了位置：只改路径，id / 进度 / 划线全部保留 */
  relocate(book: ReaderBook, to: string): void {
    book.fileRef.vaultPath = to;
    book.fileRef.fileMissing = false;
    book.updatedAt = Date.now();
    /* 路径变了，按旧路径缓存的 PDF 反链索引已经失效，清掉让下次开书重扫 */
    invalidatePdfBacklinks();
  }

  remove(id: string): boolean {
    const i = this.books.findIndex((b) => b.id === id);
    if (i < 0) return false;
    this.books.splice(i, 1);
    return true;
  }

  /** 最近在读（按 lastReadTime 倒序，未读过的排后面按加入时间）；归档书不参与 */
  recent(limit = 0): ReaderBook[] {
    const sorted = this.books.filter((b) => !b.archivedAt).sort((a, b) => {
      const la = a.reading.stats.lastReadTime || 0;
      const lb = b.reading.stats.lastReadTime || 0;
      if (la !== lb) return lb - la;
      return b.addedAt - a.addedAt;
    });
    return limit > 0 ? sorted.slice(0, limit) : sorted;
  }
}

/**
 * 点开这本书时，该不该先送去「重新定位」而不是直接读。
 *
 * 剪藏本是虚拟书（`vaultPath` 空串、磁盘上没有对应文件）：任何「文件在不在」
 * 的检查对它都恒为否。不单独让路的话，书架点它必弹「文件失联」——2026-11-13
 * 录屏库真机复现。真书的判定一字不动：标记失联的、或文件确实不见了的，照旧拦。
 */
export function bookNeedsRelocate(book: ReaderBook, fileExists: (path: string) => boolean): boolean {
  if (isClipBookRecord(book)) return false;
  return book.fileRef.fileMissing === true || !fileExists(book.fileRef.vaultPath);
}

export interface ScannedFile {
  path: string;
  format: BookFormat;
  size: number;
}

export interface Relocation {
  book: ReaderBook;
  to: string;
}

/**
 * 认出「书被改名/移动」：文件还在，只是路径变了。
 *
 * 判据是「同格式 + 同字节数 + 旧路径已经不在扫描结果里」，**书名相同优先**
 * （P3-10）。不做这一步的话，改个文件名就等于换了一本书：新记录从零开始，
 * 旧记录被 markMissing 标成幽灵，划线与进度还挂在旧 id 上（深链一起失效）。
 *
 * 以前这里只比「同格式 + 同大小」：一个 vault 里几本同大小的书（同一套排版
 * 的系列书很常见）会互相认领错。`BookFileRef.fingerprint` 曾经想做这件事，
 * 但从来没有一个地方算过它——留着只会让人以为已经做了内容比对。
 *
 * 保守起见，`size` 为 0（未知）不参与匹配；同一批里一本书只能认领一次。
 */
export function planRelocations(books: ReaderBook[], files: ScannedFile[]): Relocation[] {
  const nowPaths = new Set(files.map((f) => f.path));
  const candidates = books.filter((b) => !nowPaths.has(b.fileRef.vaultPath) && !!b.fileRef.size);
  if (!candidates.length) return [];

  /** 去掉扩展名与 `(1)` 这类副本后缀，用来判「是不是同一本书改了名」 */
  const stem = (p: string): string => titleFromPath(p).replace(/\s*[(（]\d+[)）]$/, '').trim();

  const taken = new Set<string>();
  const out: Relocation[] = [];
  const sameSize = (b: ReaderBook, f: ScannedFile): boolean =>
    !taken.has(b.id) && b.fileRef.format === f.format && b.fileRef.size === f.size;

  for (const f of files) {
    if (!f.size) continue;
    if (books.some((b) => b.fileRef.vaultPath === f.path)) continue;
    const target = stem(f.path);
    /* 第一轮只认同名的，第二轮才退回「同格式同大小」。
       两轮分开是为了让「A.epub → A (1).epub」优先配到它自己那本，
       而不是被另一本同大小的书先抢走。 */
    const hit =
      candidates.find((b) => sameSize(b, f) && stem(b.fileRef.vaultPath) === target) ??
      candidates.find((b) => sameSize(b, f));
    if (!hit) continue;
    taken.add(hit.id);
    out.push({ book: hit, to: f.path });
  }
  return out;
}
