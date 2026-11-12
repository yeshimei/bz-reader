// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  addChapterSeconds,
  chapterIndex,
  emptySidecar,
  findChapter,
  hashArticles,
  mergeSeconds,
  migrateCfi,
  normHref,
  type ClipBookSidecar,
} from '../src/data/clip-epub/sidecar';

const sidecar = (): ClipBookSidecar => ({
  ...emptySidecar('b1', '剪藏成书', 1000),
  dataHash: 'x',
  chapters: [
    { key: 'url:a', href: 'text/t-a.xhtml', title: 'A', sourceId: 's1', sourceName: '源一', state: 'unread', url: 'https://a', notePath: null },
    { key: 'url:b', href: 'text/t-b.xhtml', title: 'B', sourceId: 's1', sourceName: '源一', state: 'saved', url: 'https://b', notePath: '剪藏/b.md' },
  ],
});

describe('sidecar · href 与章节', () => {
  it('href 归一（锚点、./、前导斜杠）', () => {
    expect(normHref('./text/t-a.xhtml#x')).toBe('text/t-a.xhtml');
    expect(normHref('/OEBPS/text/t-a.xhtml')).toBe('OEBPS/text/t-a.xhtml');
  });

  it('按 href 找到章节，找不到为 null', () => {
    expect(findChapter(sidecar(), 'text/t-a.xhtml#frag')?.key).toBe('url:a');
    expect(findChapter(sidecar(), 'text/none.xhtml')).toBeNull();
    expect(findChapter(null, 'text/t-a.xhtml')).toBeNull();
  });

  it('按 key 取章节序号', () => {
    expect(chapterIndex(sidecar(), 'url:b')).toBe(1);
    expect(chapterIndex(sidecar(), 'url:none')).toBe(-1);
  });
});

describe('sidecar · CFI 迁移', () => {
  it('spine 段从旧序号换到新序号', () => {
    expect(migrateCfi('epubcfi(/6/24!/4/10,/1:0,/1:5)', 11, 12)).toBe('epubcfi(/6/26!/4/10,/1:0,/1:5)');
  });

  it('对不上的序号 / 非标准 CFI 原样返回', () => {
    expect(migrateCfi('epubcfi(/6/24!/4/10)', 10, 12)).toBe('epubcfi(/6/24!/4/10)');
    expect(migrateCfi('txt:123', 11, 12)).toBe('txt:123');
    expect(migrateCfi('', 1, 2)).toBe('');
  });
});

describe('sidecar · 时长与指纹', () => {
  it('时长累加，0 与空键不记', () => {
    expect(addChapterSeconds({}, 'a', 30)).toEqual({ a: 30 });
    expect(addChapterSeconds({ a: 30 }, 'a', 15)).toEqual({ a: 45 });
    expect(addChapterSeconds({ a: 30 }, 'a', 0)).toEqual({ a: 30 });
    expect(addChapterSeconds({ a: 30 }, '', 10)).toEqual({ a: 30 });
  });

  it('mergeSeconds 不就地改原对象', () => {
    const s = sidecar();
    const next = mergeSeconds(s, { 'url:a': 60 });
    expect(next.chapterSeconds).toEqual({ 'url:a': 60 });
    expect(s.chapterSeconds).toEqual({});
  });

  it('数据指纹随 key/状态/正文变化', () => {
    const a = hashArticles([{ key: 'k1', state: 'unread', body: 'x' }, { key: 'k2', state: 'saved', body: 'y' }]);
    expect(hashArticles([{ key: 'k2', state: 'saved', body: 'y' }, { key: 'k1', state: 'unread', body: 'x' }])).toBe(a);
    expect(hashArticles([{ key: 'k1', state: 'read', body: 'x' }, { key: 'k2', state: 'saved', body: 'y' }])).not.toBe(a);
    expect(hashArticles([{ key: 'k1', state: 'unread', body: 'x2' }, { key: 'k2', state: 'saved', body: 'y' }])).not.toBe(a);
    expect(hashArticles([{ key: 'k1', state: 'unread', body: 'x' }])).not.toBe(a);
  });
});
