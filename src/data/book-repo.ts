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

/** 基础版认得的格式。高级版放开全部，由调用方传 allowed 覆盖。 */
export const BASE_FORMATS: BookFormat[] = ['epub', 'txt'];
export const PRO_FORMATS: BookFormat[] = ['epub', 'txt', 'mobi', 'azw3', 'fb2', 'cbz'];

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
export function makeBook(path: string, format: BookFormat, size = 0): ReaderBook {
  const now = Date.now();
  return {
    id: hashId(path),
    meta: { title: titleFromPath(path) },
    fileRef: { vaultPath: path, format, size },
    reading: emptyReading(),
    notes: emptyNotes(),
    addedAt: now,
    updatedAt: now,
  };
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

  /** 有则更新路径（书被改名/移动时不丢进度），无则新建。返回记录与是否新建。 */
  ensure(path: string, format: BookFormat, size = 0): { book: ReaderBook; created: boolean } {
    const exist = this.byPath(path);
    if (exist) {
      exist.fileRef.size = size || exist.fileRef.size;
      return { book: exist, created: false };
    }
    const book = makeBook(path, format, size);
    this.books.push(book);
    return { book, created: true };
  }

  /** 清掉指向已不存在文件的记录（不删用户数据，只是标记 fileMissing） */
  markMissing(existingPaths: Set<string>): void {
    for (const b of this.books) {
      (b.fileRef as { fileMissing?: boolean }).fileMissing = !existingPaths.has(b.fileRef.vaultPath);
    }
  }

  /** 书在磁盘上换了位置：只改路径，id / 进度 / 划线全部保留 */
  relocate(book: ReaderBook, to: string): void {
    book.fileRef.vaultPath = to;
    (book.fileRef as { fileMissing?: boolean }).fileMissing = false;
    book.updatedAt = Date.now();
  }

  remove(id: string): boolean {
    const i = this.books.findIndex((b) => b.id === id);
    if (i < 0) return false;
    this.books.splice(i, 1);
    return true;
  }

  /** 最近在读（按 lastReadTime 倒序，未读过的排后面按加入时间） */
  recent(limit = 0): ReaderBook[] {
    const sorted = [...this.books].sort((a, b) => {
      const la = a.reading.stats.lastReadTime || 0;
      const lb = b.reading.stats.lastReadTime || 0;
      if (la !== lb) return lb - la;
      return b.addedAt - a.addedAt;
    });
    return limit > 0 ? sorted.slice(0, limit) : sorted;
  }
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
 * 判据只有两条——同格式、同字节数，且旧路径已经不在扫描结果里。不做这一步的
 * 话，改个文件名就等于换了一本书：新记录从零开始，旧记录被 markMissing 标成
 * 幽灵，划线与进度还挂在旧 id 上（深链一起失效）。
 *
 * 保守起见，`size` 为 0（未知）不参与匹配，避免把所有 0 字节文件认成同一本；
 * 同一批里一本书只能认领一次，两个同大小候选按加入时间从新到旧配。
 */
export function planRelocations(books: ReaderBook[], files: ScannedFile[]): Relocation[] {
  const nowPaths = new Set(files.map((f) => f.path));
  const candidates = books.filter((b) => !nowPaths.has(b.fileRef.vaultPath) && !!b.fileRef.size);
  if (!candidates.length) return [];

  const taken = new Set<string>();
  const out: Relocation[] = [];
  for (const f of files) {
    if (!f.size) continue;
    if (books.some((b) => b.fileRef.vaultPath === f.path)) continue;
    const hit = candidates.find(
      (b) => !taken.has(b.id) && b.fileRef.format === f.format && b.fileRef.size === f.size,
    );
    if (!hit) continue;
    taken.add(hit.id);
    out.push({ book: hit, to: f.path });
  }
  return out;
}
