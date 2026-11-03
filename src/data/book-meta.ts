/* ============================================================
 * bz-reader · 引擎元数据回填（data/book-meta.ts）
 *
 * 打开一本书时，引擎会把 epub 里读到的书名 / 作者 / 字数回填进元数据。
 * 问题出在书名：用户在书架上改过名之后，每次打开都会被文件里的旧名覆盖，
 * 重启插件也回不来——改名等于没做（真机反馈第 4 条）。
 *
 * 规则：
 *   - 用户改过名（meta.titleEdited）就永远不再用文件里的书名覆盖；
 *   - 作者与字数照旧回填：目前没有改它们的入口，引擎的值就是最新的。
 *
 * 抽成纯函数是为了能直接测：回填发生在 onReady 回调里，拖进 DOM 与
 * foliate 之后只能靠真机看。
 * ============================================================ */
import type { ReaderBook } from './schema';

export interface EngineMeta {
  title?: string;
  author?: string;
  wordCount?: number;
}

/**
 * 把引擎读到的元数据回填进书。返回是否有字段真的变了
 * （调用方据此决定要不要重绘 / 落盘）。
 */
export function applyEngineMeta(book: ReaderBook, m: EngineMeta): boolean {
  let changed = false;
  if (m.title && !book.meta.titleEdited && book.meta.title !== m.title) {
    book.meta.title = m.title;
    changed = true;
  }
  if (m.author && book.meta.author !== m.author) {
    book.meta.author = m.author;
    changed = true;
  }
  if (m.wordCount && book.meta.wordCount !== m.wordCount) {
    book.meta.wordCount = m.wordCount;
    changed = true;
  }
  return changed;
}
