import { describe, expect, it } from 'vitest';
import { focusSelector } from '../src/shell/focus-memo';
import { searchHits, type SearchTarget } from '../src/shell/search-hits';

describe('focusSelector', () => {
  it('带 data-k 时同时限定 role 与 k（设置页三个 AI 输入框靠它区分）', () => {
    expect(focusSelector('setting', 'ai.apiKey')).toBe('[data-role="setting"][data-k="ai.apiKey"]');
  });

  it('没有 k 时退回只按 role（搜索框这类只有一个的控件）', () => {
    expect(focusSelector('libkw')).toBe('[data-role="libkw"]');
  });
});

const books: SearchTarget[] = [
  {
    id: 'b1',
    title: '三体',
    author: '刘慈欣',
    marks: [
      { id: 'm1', text: '给岁月以文明', chapterTitle: '第一章' },
      { id: 'm2', text: '黑暗森林', comment: '猜疑链', chapterTitle: '第二章' },
      { id: 'm3', text: '无关内容', chapterTitle: '第三章' },
    ],
  },
  { id: 'b2', title: '红楼梦', author: '曹雪芹', marks: [] },
];

describe('searchHits', () => {
  it('关键词为空时不出结果（不把整库列出来）', () => {
    expect(searchHits(books, '   ')).toEqual({ groups: [], total: 0 });
  });

  it('命中书名/作者，给出「书籍」行', () => {
    const r = searchHits(books, '红楼');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.rows[0]).toMatchObject({ kind: 'book', bookId: 'b2', label: '书籍' });
  });

  it('命中标注原文与想法，合计总数按书统计', () => {
    const r = searchHits(books, '猜疑链');
    expect(r.total).toBe(1);
    expect(r.groups[0]!.rows[0]).toMatchObject({ kind: 'mark', id: 'm2', label: '第二章' });
  });

  it('大小写不敏感', () => {
    const t: SearchTarget[] = [{ id: 'x', title: 'ABC', marks: [] }];
    expect(searchHits(t, 'abc').total).toBe(1);
  });

  it('单本最多 10 条，但 total 记全量', () => {
    const many: SearchTarget[] = [
      {
        id: 'b',
        title: '书',
        marks: Array.from({ length: 15 }, (_, i) => ({ id: `m${i}`, text: '同样的字' })),
      },
    ];
    const r = searchHits(many, '同样');
    expect(r.groups[0]!.rows).toHaveLength(10);
    expect(r.groups[0]!.total).toBe(15);
    expect(r.total).toBe(15);
  });

  it('标注正文截到 80 字，避免撑爆行高', () => {
    const long: SearchTarget[] = [{ id: 'b', title: '书', marks: [{ id: 'm', text: '字'.repeat(300) }] }];
    expect(searchHits(long, '字').groups[0]!.rows[0]!.text).toHaveLength(80);
  });
});
