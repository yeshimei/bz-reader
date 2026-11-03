/**
 * 壳层搜索的命中计算（纯函数）。
 *
 * 只搜「已建索引」的字段：书名 / 作者 / 标注原文 / 想法 / 章节名。
 * 抽出来的两个原因：
 *   1. 搜索框要「边打边出结果」，就得单独重算命中列表，不能整块重绘；
 *   2. 纯函数能在 node 里测，不用造 DOM。
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

export interface SearchRow {
  kind: 'book' | 'mark';
  /** 书 id（openbook / jumpmark 都要它） */
  bookId: string;
  /** 标注 id；kind==='book' 时为空串 */
  id: string;
  /** 行首小字：书籍 / 章节名 */
  label: string;
  /** 正文（标注会截到 80 字） */
  text: string;
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

/** 大小写不敏感；关键词为空直接返回空结果（不把整库列出来） */
export function searchHits(books: SearchTarget[], keyword: string, maxPerBook = 10): SearchResult {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return { groups: [], total: 0 };

  const groups: SearchGroup[] = [];
  let total = 0;
  for (const b of books) {
    const rows: SearchRow[] = [];
    if (`${b.title}${b.author ?? ''}`.toLowerCase().includes(kw)) {
      rows.push({
        kind: 'book',
        bookId: b.id,
        id: '',
        label: '书籍',
        text: `${b.title} · ${b.author || '佚名'}`,
      });
    }
    for (const m of b.marks) {
      if (!`${m.text}${m.comment ?? ''}`.toLowerCase().includes(kw)) continue;
      rows.push({
        kind: 'mark',
        bookId: b.id,
        id: m.id,
        label: m.chapterTitle?.trim() || '',
        text: m.text.slice(0, 80),
      });
    }
    if (!rows.length) continue;
    total += rows.length;
    groups.push({ bookId: b.id, title: b.title, rows: rows.slice(0, maxPerBook), total: rows.length });
  }
  return { groups, total };
}
