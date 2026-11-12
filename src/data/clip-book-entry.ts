/**
 * 剪藏本的书架入口（2026-11-13）：一本「虚拟书」。
 *
 * 它不是文件，也不生成文件：`fileRef.vaultPath` 是空串，打开时由阅读页
 * 现拉 bz 剪藏本的数据。设置里的开关只决定它在不在架子上——关掉是归档，
 * 进度、划线、每章时长都留在记录里，再打开原样接上。
 */
import { emptyNotes, emptyReading, type ReaderBook } from './schema';
import { t } from '../i18n';

/** 固定 id：书架上永远只有这一本，开关来回拨也不会长出第二本 */
export const CLIP_BOOK_ID = 'clipbook';

export function isClipBookRecord(book: ReaderBook | null | undefined): boolean {
  return !!book && book.meta?.clipBook === true;
}

export function makeClipBookRecord(title: string, author = t('clip.author'), now = Date.now()): ReaderBook {
  return {
    id: CLIP_BOOK_ID,
    meta: { title, author, language: 'zh', clipBook: true, titleEdited: true },
    /* 没有真实文件：format 占 epub 是为了走现有的格式放行与引擎分派，
       vaultPath 空串让「文件在不在」这类检查全部跳过（见 reader-view 的虚拟书分支） */
    fileRef: { vaultPath: '', format: 'epub', size: 0 },
    reading: emptyReading(),
    notes: emptyNotes(),
    addedAt: now,
    updatedAt: now,
  };
}

export interface SyncClipBookResult {
  changed: boolean;
  book: ReaderBook | null;
  /** created = 第一次放上书架；revived = 关过又开；archived = 这次移走 */
  action: 'none' | 'created' | 'revived' | 'archived' | 'kept';
}

/**
 * 按开关同步书架：开 → 确保在架（归档过的复活）；关 → 归档。
 * 幂等：状态已经是目标态就一个字段都不碰。
 */
export function syncClipBookEntry(
  books: ReaderBook[],
  enabled: boolean,
  title: string,
  now = Date.now(),
): SyncClipBookResult {
  const existing = books.find(isClipBookRecord) ?? null;
  if (enabled) {
    if (!existing) {
      const book = makeClipBookRecord(title, t('clip.author'), now);
      books.push(book);
      return { changed: true, book, action: 'created' };
    }
    if (typeof existing.archivedAt === 'number') {
      delete existing.archivedAt;
      existing.updatedAt = now;
      return { changed: true, book: existing, action: 'revived' };
    }
    return { changed: false, book: existing, action: 'kept' };
  }
  if (existing && typeof existing.archivedAt !== 'number') {
    existing.archivedAt = now;
    existing.updatedAt = now;
    return { changed: true, book: existing, action: 'archived' };
  }
  return { changed: false, book: existing, action: 'none' };
}
