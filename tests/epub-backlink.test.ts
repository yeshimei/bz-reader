/**
 * EPUB 反链（tests/epub-backlink.test.ts）
 *
 * 笔记里从书里复制出来的划线链接长这样：
 *   `[[bz-reader/books/围城.epub#bzr-cfi=epubcfi(/6/10!/4/2/4,/1:124,/1:192)&t=…&c=重印前记|重印前记]]`
 *
 * PDF 那套按 `#page=` 认页；EPUB 没有页码，靠 `bzr-cfi=…` 认「引的是哪一句」。
 * 只做解析、不做扫描：全库扫描在调用方（和 PDF 共用一份缓存）。
 */
import { describe, expect, it } from 'vitest';
import { epubBacklinkHits } from '../src/data/epub-backlink';

const BOOK = 'bz-reader/books/围城.epub';

function src(path: string, link: string): { path: string; link: string } {
  return { path, link };
}

/** 复制的划线链接原文（与测试库「欢迎.md」里那条同形） */
const MARK =
  `[[${BOOK}#bzr-cfi=epubcfi(/6/10!/4/2/4,/1:124,/1:192)` +
  `&t=%E6%9C%AC%E3%80%82%E6%97%A5%E6%9C%AC` +
  `&c=%E9%87%8D%E5%8D%B0%E5%89%8D%E8%AE%B0|重印前记]]`;

describe('EPUB 反链解析', () => {
  it('从划线双链里取出定位、章节与别名', () => {
    const hits = epubBacklinkHits([src('欢迎.md', MARK)], BOOK);
    expect(hits).toHaveLength(1);
    expect(hits[0].sourcePath).toBe('欢迎.md');
    expect(hits[0].cfi).toBe('epubcfi(/6/10!/4/2/4,/1:124,/1:192)');
    expect(hits[0].chapter).toBe('重印前记');
    expect(hits[0].label).toBe('重印前记');
    expect(hits[0].text).toBe('本。日本');
  });

  it('只有原文片段、没有 cfi 的链接也算引用', () => {
    /* 老格式 / 手写的 `bzr-t=`：定位靠「章节内搜这段原文」，仍然是引用 */
    const link = `[[${BOOK}#bzr-t=%E6%96%B9%E9%B8%BF%E6%B8%90&c=%E7%AC%AC%E4%B8%80%E7%AB%A0]]`;
    const hits = epubBacklinkHits([src('a.md', link)], BOOK);
    expect(hits).toHaveLength(1);
    expect(hits[0].cfi).toBeUndefined();
    expect(hits[0].text).toBe('方鸿渐');
    expect(hits[0].chapter).toBe('第一章');
    expect(hits[0].label).toBeUndefined();
  });

  it('光有书名的链接不算：没有定位，点进去也不知道去哪', () => {
    expect(epubBacklinkHits([src('a.md', `[[${BOOK}]]`)], BOOK)).toEqual([]);
  });

  it('指向别的书的链接不会混进来', () => {
    const other = `[[bz-reader/books/别的书.epub#bzr-cfi=epubcfi(/6/2)|别的]]`;
    expect(epubBacklinkHits([src('a.md', other)], BOOK)).toEqual([]);
  });

  it('PDF 的 #page= 链接不进 EPUB 这一份', () => {
    const pdf = `[[${BOOK}#page=3|第三页]]`;
    expect(epubBacklinkHits([src('a.md', pdf)], BOOK)).toEqual([]);
  });

  it('同一篇笔记里同一条链接写两遍只算一次', () => {
    const hits = epubBacklinkHits([src('a.md', MARK), src('a.md', MARK)], BOOK);
    expect(hits).toHaveLength(1);
  });

  it('同一篇笔记引了两处，两处都列出来', () => {
    const second = `[[${BOOK}#bzr-cfi=epubcfi(/6/12!/4/2/2)|第二章那句]]`;
    const hits = epubBacklinkHits([src('a.md', MARK), src('a.md', second)], BOOK);
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.cfi)).toContain('epubcfi(/6/12!/4/2/2)');
  });
});
