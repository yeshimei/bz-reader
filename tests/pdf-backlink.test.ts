import { beforeEach, describe, expect, it } from 'vitest';
import { BookRepo, makeBook } from '../src/data/book-repo';
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

/** 假 app：复刻 Obsidian 的两条关键行为——
    1. 笔记 cache 里的 `link.link` **带** `#page=…` 子路径；
    2. `getFirstLinkpathDest` 只认纯路径，带 `#` 一律返回 null。 */
const BOOK = 'bz-reader/books/x.pdf';

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

describe('collectPdfBacklinks', () => {
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

/* 缓存改成「按 metadataCache 的解析版本共享整份索引」：开多本书只全量扫一次；
   版本变了（resolvedLinks 换新对象）或 invalidate 都重扫；书改名后旧路径失效。 */
describe('collectPdfBacklinks · 版本化共享缓存', () => {
  beforeEach(() => invalidatePdfBacklinks());

  it('同一版本内取不同书的反链，整份索引只扫一次', () => {
    const { app, cacheReads } = fakeApp({
      'a.md': [{ link: `${BOOK}#page=3` }],
      'b.md': [{ link: 'bz-reader/books/y.pdf#page=5' }],
    });
    collectPdfBacklinks(app, BOOK); // 首次：扫全部笔记
    const first = cacheReads();
    collectPdfBacklinks(app, 'bz-reader/books/y.pdf'); // 同版本另一本书：命中共享缓存
    expect(cacheReads()).toBe(first);
  });

  it('metadataCache 解析版本变了（resolvedLinks 换新对象）即使不 invalidate 也重扫', () => {
    const v1 = fakeApp({ 'a.md': [{ link: `${BOOK}#page=3` }] });
    collectPdfBacklinks(v1.app, BOOK);
    const reads1 = v1.cacheReads();
    // 同一个 vault 内容，但 resolvedLinks 是另一个引用（Obsidian 重建索引会给新对象）
    const v2 = fakeApp({ 'a.md': [{ link: `${BOOK}#page=3` }] });
    collectPdfBacklinks(v2.app, BOOK);
    expect(v2.cacheReads()).toBeGreaterThan(0);
    expect(reads1).toBeGreaterThan(0);
  });

  it('书改名后缓存失效：查到新路径反链、旧路径不再命中', () => {
    const book = makeBook('old.pdf', 'pdf');
    const repo = new BookRepo([book]);
    // 改名前：笔记链到 old.pdf
    const v1 = fakeApp({ '笔记/精读.md': [{ link: 'old.pdf#page=7' }] }, 'old.pdf');
    expect(collectPdfBacklinks(v1.app, 'old.pdf')).toHaveLength(1);
    // 改名（relocate 内部会调 invalidatePdfBacklinks 清缓存）
    repo.relocate(book, 'new.pdf');
    // 改名后：笔记链到 new.pdf，旧路径在索引里已无反链
    const v2 = fakeApp({ '笔记/精读.md': [{ link: 'new.pdf#page=7' }] }, 'new.pdf');
    expect(collectPdfBacklinks(v2.app, 'new.pdf')).toHaveLength(1);
    expect(collectPdfBacklinks(v2.app, 'old.pdf')).toHaveLength(0);
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
