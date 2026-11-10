import { describe, expect, it } from 'vitest';
import { searchHits, visibleHits, type SearchTarget } from '../src/shell/search-hits';

/* ============================================================
 * 搜索命中：书名 / 作者 / 章节名 / 标注原文 / 想法。
 *
 * 2026-11-08（fix/search-body）：用户报「本书和全库都搜不到内容」。
 * 原来的 searchHits 只比对「书名+作者」与「标注原文+想法」，占位符写着
 * 的「章节名」根本没进匹配；想法命中时也只显示原文，用户看不出为什么命中。
 * 这里把三种来源钉住。
 * ============================================================ */

const books: SearchTarget[] = [
  {
    id: 'b1',
    title: '三体',
    author: '刘慈欣',
    marks: [
      { id: 'm1', text: '给岁月以文明', chapterTitle: '第一章 疯狂年代' },
      { id: 'm2', text: '黑暗森林', comment: '猜疑链与黑暗森林法则', chapterTitle: '第二章 面壁' },
      { id: 'm3', text: '无关内容', chapterTitle: '第三章 死神永生' },
    ],
  },
  { id: 'b2', title: '红楼梦', author: '曹雪芹', marks: [] },
];

describe('搜索命中来源（fix/search-body）', () => {
  it('章节名也能搜到：命中行标明是章节名，并带章节标签', () => {
    const r = searchHits(books, '死神永生');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.rows[0]).toMatchObject({
      kind: 'mark',
      id: 'm3',
      via: 'chapter',
      label: '第三章 死神永生',
      text: '第三章 死神永生',
    });
  });

  it('想法命中时展示想法本身，而不是原文', () => {
    const r = searchHits(books, '猜疑链');
    expect(r.groups[0]!.rows[0]).toMatchObject({
      kind: 'mark',
      id: 'm2',
      via: 'comment',
      text: '猜疑链与黑暗森林法则',
    });
  });

  it('原文与想法同时命中时，优先按原文展示', () => {
    const r = searchHits(books, '黑暗森林');
    /* m2 的原文和想法都含这个词：算一条命中，不是两条 */
    expect(r.total).toBe(1);
    expect(r.groups[0]!.rows[0]).toMatchObject({ id: 'm2', via: 'text', text: '黑暗森林' });
  });

  it('书籍行带 via=title，方便界面区分「为什么命中」', () => {
    const r = searchHits(books, '红楼');
    expect(r.groups[0]!.rows[0]).toMatchObject({ kind: 'book', via: 'title' });
  });

  it('书没有作者时只显示书名，不留「佚名」兜底', () => {
    const noAuthor: SearchTarget[] = [{ id: 'b9', title: '无名之书', marks: [] }];
    const r = searchHits(noAuthor, '无名');
    expect(r.groups[0]!.rows[0]!.text).toBe('无名之书');
  });

  it('书籍行的 label 留空：行首小字由渲染层按界面语言填', () => {
    const r = searchHits(books, '红楼');
    expect(r.groups[0]!.rows[0]!.label).toBe('');
  });

  it('书名、作者、章节名、原文、想法都不含关键词时，一本都别列', () => {
    expect(searchHits(books, '不存在的字')).toEqual({ groups: [], total: 0 });
  });

  it('章节名命中按书分组，全部行都留着，由渲染层决定先画几条', () => {
    const many: SearchTarget[] = [
      {
        id: 'b',
        title: '书',
        marks: Array.from({ length: 15 }, (_, i) => ({ id: `m${i}`, text: `第 ${i} 段`, chapterTitle: '同一个章节' })),
      },
    ];
    const r = searchHits(many, '同一个章节');
    /* 以前这里截到 10 条、total 写 15：分组头写 15 处，下面只画 10 行，
       数字和行数对不上。现在全留着，截断由界面明说。 */
    expect(r.groups[0]!.rows).toHaveLength(15);
    expect(r.groups[0]!.total).toBe(15);
    expect(r.total).toBe(15);
  });
});

describe('分组可见条数（50 条 + 显示更多）', () => {
  it('不满 50 条：全画', () => {
    expect(visibleHits(12, 0)).toBe(12);
  });

  it('超过 50 条：先画 50，每次「显示更多」多 50', () => {
    expect(visibleHits(160, 0)).toBe(50);
    expect(visibleHits(160, 50)).toBe(100);
    expect(visibleHits(160, 500)).toBe(160);
  });

  it('额外条数是负数也不倒扣', () => {
    expect(visibleHits(160, -30)).toBe(50);
  });
});
