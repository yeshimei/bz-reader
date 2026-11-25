/* ============================================================
 * bz-reader · 书籍信息编辑（data/book-edit.ts）
 *
 * 用户在书籍详情里改书名 / 作者 / 简介、上传替换封面（2026-11-25）。
 *
 * 三件事都在这里定口径：
 *   1. 手改过的字段要打标记，打开书时引擎读到的元数据不再覆盖它们
 *      （titleEdited 早就存在，作者与简介这两个标记是这一版补的）；
 *   2. 「还原默认信息」把书名退回文件名、作者与简介清空、三个标记一起清掉；
 *   3. 封面来源分三种：自定义 / 原书封面 / 没有原封面（TXT 的占位色块）。
 *
 * 纯函数，不碰 DOM、不碰 IO——写盘与选图在 shell 层做。
 * ============================================================ */
import type { ReaderBook } from './schema';

export interface MetaEditInput {
  title: string;
  author: string;
  description: string;
}

export type CoverSource = 'custom' | 'builtin' | 'none';

/**
 * 从书文件路径推出默认书名：去掉目录与扩展名。
 * 剪藏本是虚拟书（vaultPath 为空），返回空串——调用方保留当前书名。
 */
export function titleFromPath(book: ReaderBook): string {
  const p = (book.fileRef.vaultPath || '').trim();
  if (!p) return '';
  const base = p.split('/').pop() ?? '';
  return base.replace(/\.[^.]+$/, '');
}

/**
 * 把用户填的三项写进书，并给每项打上「手改过」标记。
 *
 * - 书名留空不写（书架上不能出现无名书），返回 false 时调用方按原值处理；
 * - 作者 / 简介允许清空：清空也是用户的选择，标记照样打上，引擎不再填回来；
 * - 三项都没变时返回 false，调用方免去重绘与落盘。
 */
export function applyMetaEdit(book: ReaderBook, input: MetaEditInput): boolean {
  const title = input.title.trim();
  const author = input.author.trim();
  const description = input.description.trim();
  let changed = false;

  if (title && book.meta.title !== title) {
    book.meta.title = title;
    book.meta.titleEdited = true;
    changed = true;
  }
  if ((book.meta.author ?? '') !== author) {
    book.meta.author = author;
    book.meta.authorEdited = true;
    changed = true;
  }
  if ((book.meta.description ?? '') !== description) {
    book.meta.description = description;
    book.meta.descriptionEdited = true;
    changed = true;
  }

  if (changed) book.updatedAt = Date.now();
  return changed;
}

/**
 * 还原原书的默认信息：书名退回文件名，作者与简介清空，三个标记一起清掉。
 *
 * 不做「重新解一遍书」：那是打开书时引擎的活。清掉标记之后，下次打开这本书
 * 引擎会把读到的新值写回来（有值才写）。剪藏本没有文件名，书名保持不动。
 */
export function restoreMetaDefaults(book: ReaderBook): void {
  const fromPath = titleFromPath(book);
  if (fromPath && book.meta.clipBook !== true) book.meta.title = fromPath;
  book.meta.author = '';
  book.meta.description = '';
  delete book.meta.titleEdited;
  delete book.meta.authorEdited;
  delete book.meta.descriptionEdited;
  book.updatedAt = Date.now();
}

/** 封面是不是用户上传替换的那张（标记与路径都在才算） */
export function isCustomCover(book: ReaderBook): boolean {
  return book.meta.coverEdited === true && !!book.meta.coverPath;
}

/**
 * 当前封面来源：
 *   custom  —— 用户上传的图；
 *   builtin —— 从书里解出来的原封面（EPUB / PDF 等）；
 *   none    —— 没有原封面（TXT），显示占位色块。
 */
export function coverSourceOf(book: ReaderBook): CoverSource {
  if (isCustomCover(book)) return 'custom';
  if (book.fileRef.format === 'txt') return 'none';
  return 'builtin';
}
