import { beforeEach, describe, expect, it } from 'vitest';
import {
  backlinkCountByPage,
  collectPdfBacklinks,
  hitsOnPage,
  invalidatePdfBacklinks,
  pdfBacklinkHits,
  subpathOfHref,
} from '../src/data/pdf-backlink';

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

  it('本插件自己复制的链接（只有 bzr= 精确定位）也要带上定位串', () => {
    const hits = pdfBacklinkHits([
      { path: 'a.md', link: 'books/x.pdf#page=4&bzr=pdf%2F4%2F29-81' },
    ]);
    expect(hits[0]).toMatchObject({ page: 4, locator: 'pdf/4/29-81' });
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

/* 从 Obsidian 的链接索引里捞反链：这一层以前没有测试，结果「链接带子路径
   就查不到目标文件」这种硬伤一路活到了真机（页面上一个框都画不出来）。 */
describe('collectPdfBacklinks', () => {
  const BOOK = 'bz-reader/books/x.pdf';

  /** 假 app：复刻 Obsidian 的两条关键行为——
      1. 笔记 cache 里的 `link.link` **带** `#page=…` 子路径；
      2. `getFirstLinkpathDest` 只认纯路径，带 `#` 一律返回 null。 */
  function fakeApp(
    notes: Record<string, Array<{ link: string; original?: string }>>,
    bookPath = BOOK,
  ): {
    app: Parameters<typeof collectPdfBacklinks>[0];
    cacheReads: () => number;
  } {
    let reads = 0;
    const resolvedLinks: Record<string, Record<string, number>> = {};
    for (const [source, links] of Object.entries(notes)) {
      const hits: Record<string, number> = {};
      for (const l of links) {
        if (l.link.split('#')[0] === bookPath) hits[bookPath] = 1;
      }
      if (Object.keys(hits).length) resolvedLinks[source] = hits;
    }
    const app = {
      metadataCache: {
        resolvedLinks,
        getFileCache(file: unknown) {
          reads += 1;
          const path = (file as { path: string }).path;
          return { links: notes[path] ?? [] };
        },
        getFirstLinkpathDest(linkpath: string) {
          if (!linkpath || linkpath.includes('#')) return null;
          return linkpath === bookPath ? { path: bookPath } : null;
        },
      },
      vault: {
        getFileByPath(path: string) {
          return path in notes ? { path } : null;
        },
      },
    };
    return { app, cacheReads: () => reads };
  }

  beforeEach(() => invalidatePdfBacklinks());

  it('带 #page 子路径的链接能查到这本书', () => {
    const { app } = fakeApp({
      '笔记/精读.md': [
        { link: `${BOOK}#page=7&selection=2,1,4,6`, original: `[[${BOOK}#page=7&selection=2,1,4,6|第七页]]` },
      ],
    });
    expect(collectPdfBacklinks(app, BOOK)).toEqual([
      { path: '笔记/精读.md', link: `[[${BOOK}#page=7&selection=2,1,4,6|第七页]]` },
    ]);
  });

  it('解析不到这本书的链接丢掉（别把别的书算进来）', () => {
    const { app } = fakeApp({
      'a.md': [{ link: 'bz-reader/books/y.pdf#page=3' }],
      'b.md': [{ link: `${BOOK}#page=3` }],
    });
    expect(collectPdfBacklinks(app, BOOK).map((s) => s.path)).toEqual(['b.md']);
  });

  it('同一本书算完就缓存，第二次不再读笔记 cache', () => {
    const { app, cacheReads } = fakeApp({
      'a.md': [{ link: `${BOOK}#page=3` }],
    });
    collectPdfBacklinks(app, BOOK);
    const first = cacheReads();
    collectPdfBacklinks(app, BOOK);
    expect(cacheReads()).toBe(first);
  });

  it('索引变了（invalidate）之后重新扫', () => {
    const { app, cacheReads } = fakeApp({
      'a.md': [{ link: `${BOOK}#page=3` }],
    });
    collectPdfBacklinks(app, BOOK);
    const first = cacheReads();
    invalidatePdfBacklinks();
    collectPdfBacklinks(app, BOOK);
    expect(cacheReads()).toBeGreaterThan(first);
  });
});

describe('反链的可交互信息', () => {
  it('链接别名作为「引的是哪一句」的提示', () => {
    const hits = pdfBacklinkHits([
      { path: '读书笔记/论文.md', link: '[[x.pdf#page=3&rect=1,2,3,4|第 3 页那段]]' },
      { path: 'b.md', link: '[[x.pdf#page=3]]' },
    ]);
    expect(hits[0]!.label).toBe('第 3 页那段');
    expect(hits[1]!.label).toBeUndefined();
  });

  it('按页筛出这一页的引用（侧栏「只看本页」用）', () => {
    const hits = pdfBacklinkHits([
      { path: 'a.md', link: '[[x.pdf#page=3]]' },
      { path: 'b.md', link: '[[x.pdf#page=7]]' },
      { path: 'c.md', link: '[[x.pdf#page=3&rect=1,1,2,2]]' },
    ]);
    expect(hitsOnPage(hits, 3).map((h) => h.sourcePath)).toEqual(['a.md', 'c.md']);
    expect(hitsOnPage(hits, 4)).toEqual([]);
  });
});
