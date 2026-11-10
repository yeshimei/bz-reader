/**
 * 壳层搜索的命中计算（纯函数）。
 *
 * 只搜「已建索引」的字段：书名 / 作者 / 章节名 / 标注原文 / 想法。
 * 抽出来的两个原因：
 *   1. 搜索框要「边打边出结果」，就得单独重算命中列表，不能整块重绘；
 *   2. 纯函数能在 node 里测，不用造 DOM。
 *
 * 2026-11-08（fix/search-body）：补上「章节名」与「想法摘要」。
 * 以前占位符写着能搜章节名，匹配里却没有它；想法命中时也只显示原文，
 * 用户看不出为什么命中。现在每行带 `via` 说明来源。
 */

export interface SearchMark {
  id: string;
  text: string;
  comment?: string;
  chapterTitle?: string;
}

export interface SearchTarget {
  id: string;
  title: string;
  author?: string;
  marks: SearchMark[];
}

export type SearchKind = 'book' | 'mark' | 'body';
export type SearchVia = 'title' | 'text' | 'comment' | 'chapter' | 'body';

export interface SearchRow {
  kind: SearchKind;
  /** 书 id（openbook / jumpmark / hittotext 都要它） */
  bookId: string;
  /** 标注 id；kind==='book' 时为空串 */
  id: string;
  /** 行首小字：书籍 / 章节名。书籍行留空——那枚小字按界面语言由渲染层填 */
  label: string;
  /** 正文（标注截到 80 字；想法命中时是想法本身；章节名命中时是章节名） */
  text: string;
  /** 为什么命中：书名 / 原文 / 想法 / 章节名 / 正文扫描 */
  via?: SearchVia;
  /** 正文命中的 CFI（kind==='body' 才有） */
  cfi?: string;
}

export interface SearchGroup {
  bookId: string;
  title: string;
  rows: SearchRow[];
  /** 这本书的命中总数（rows 可能被 maxPerBook 截断） */
  total: number;
}

export interface SearchResult {
  groups: SearchGroup[];
  total: number;
}

/** 每组先画多少条；点「显示更多」按这个数递增 */
export const HITS_PAGE = 50;

/**
 * 一组里先画几条。
 *
 * `extra` 是用户点了几次「显示更多」累加出来的额外条数。截断本身由渲染层
 * 明说（「共 N 处 · 已显示 M 处」），不再像以前那样悄悄只画 10 行、
 * 分组头却写着真实总数——数字和行数对不上，用户以为结果丢了。
 */
export function visibleHits(total: number, extra: number): number {
  const all = Math.max(0, Math.floor(Number.isFinite(total) ? total : 0));
  const more = Math.max(0, Math.floor(Number.isFinite(extra) ? extra : 0));
  return Math.min(all, HITS_PAGE + more);
}

/** 大小写不敏感；关键词为空直接返回空结果（不把整库列出来） */
export function searchHits(books: SearchTarget[], keyword: string, maxPerBook = 0): SearchResult {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return { groups: [], total: 0 };

  const groups: SearchGroup[] = [];
  let total = 0;
  for (const b of books) {
    const rows: SearchRow[] = [];
    if (`${b.title}${b.author ?? ''}`.toLowerCase().includes(kw)) {
      const author = (b.author ?? '').trim();
      rows.push({
        kind: 'book',
        bookId: b.id,
        id: '',
        label: '',
        /* 没有作者就只显示书名：以前兜底写「佚名」，非中文界面会冒中文 */
        text: author ? `${b.title} · ${author}` : b.title,
        via: 'title',
      });
    }
    for (const m of b.marks) {
      const text = m.text ?? '';
      const comment = m.comment ?? '';
      const chapter = m.chapterTitle?.trim() || '';
      /* 一条标注只出一行：原文优先，其次想法，最后章节名。三个都命中时
         只算一条命中——否则同一处划线会在结果里出现三遍。 */
      if (text.toLowerCase().includes(kw)) {
        rows.push({ kind: 'mark', bookId: b.id, id: m.id, label: chapter, text: text.slice(0, 80), via: 'text' });
      } else if (comment.toLowerCase().includes(kw)) {
        rows.push({ kind: 'mark', bookId: b.id, id: m.id, label: chapter, text: comment.slice(0, 80), via: 'comment' });
      } else if (chapter.toLowerCase().includes(kw)) {
        rows.push({ kind: 'mark', bookId: b.id, id: m.id, label: chapter, text: chapter, via: 'chapter' });
      }
    }
    if (!rows.length) continue;
    total += rows.length;
    groups.push({
      bookId: b.id,
      title: b.title,
      /* 行全留着：截断由渲染层按 50 条一屏明说，不在这里悄悄丢 */
      rows: maxPerBook > 0 ? rows.slice(0, maxPerBook) : rows,
      total: rows.length,
    });
  }
  return { groups, total };
}
