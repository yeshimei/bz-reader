import { describe, expect, it } from 'vitest';
import { backlinkCountByPage, pdfBacklinkHits, subpathOfHref } from '../src/data/pdf-backlink';

describe('pdf backlink', () => {
  it('取 # 之后的子路径', () => {
    expect(subpathOfHref('books/a.pdf#page=3&rect=1,2,3,4')).toBe('page=3&rect=1,2,3,4');
    expect(subpathOfHref('books/a.pdf')).toBe('');
    expect(subpathOfHref('')).toBe('');
  });

  it('文字选择的反链能解析出页码与 selection', () => {
    const hits = pdfBacklinkHits([
      { path: '笔记/论文精读.md', link: 'books/论文.pdf#page=7&selection=2,1,4,6&color=yellow' },
    ]);
    expect(hits).toEqual([
      {
        sourcePath: '笔记/论文精读.md',
        page: 7,
        selection: { beginIndex: 2, beginOffset: 1, endIndex: 4, endOffset: 6 },
        rect: undefined,
        color: 'yellow',
      },
    ]);
  });

  it('框选反链带矩形', () => {
    const hits = pdfBacklinkHits([{ path: 'a.md', link: 'books/x.pdf#page=2&rect=10,20,30,40' }]);
    expect(hits[0].rect).toEqual({ left: 10, top: 20, width: 30, height: 40 });
  });

  it('只有页码的反链也算命中（页边标一条竖线）', () => {
    const hits = pdfBacklinkHits([{ path: 'a.md', link: 'books/x.pdf#page=9' }]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ page: 9, sourcePath: 'a.md' });
  });

  it('普通锚点、坏页码、空链接一律丢掉', () => {
    expect(
      pdfBacklinkHits([
        { path: 'a.md', link: 'books/x.pdf#section-2' },
        { path: 'b.md', link: 'books/x.pdf#page=0' },
        { path: 'c.md', link: 'books/x.pdf' },
        { path: '', link: 'books/x.pdf#page=3' },
      ]),
    ).toEqual([]);
  });

  it('同一条链接写两遍只算一次，不同笔记各算一条', () => {
    const link = 'books/x.pdf#page=3&selection=0,0,1,1';
    const hits = pdfBacklinkHits([
      { path: 'a.md', link },
      { path: 'a.md', link },
      { path: 'b.md', link },
    ]);
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.sourcePath)).toEqual(['a.md', 'b.md']);
  });

  it('按页统计引用次数', () => {
    const hits = pdfBacklinkHits([
      { path: 'a.md', link: 'books/x.pdf#page=3' },
      { path: 'b.md', link: 'books/x.pdf#page=3&rect=1,1,1,1' },
      { path: 'c.md', link: 'books/x.pdf#page=5' },
    ]);
    const counts = backlinkCountByPage(hits);
    expect(counts.get(3)).toBe(2);
    expect(counts.get(5)).toBe(1);
    expect(counts.get(4)).toBeUndefined();
  });
});
