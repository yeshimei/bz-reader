import { describe, expect, it } from 'vitest';
import { chapterTitles, sectionIndexOfChapter } from '../src/engine/chapter-titles';

/**
 * 画像里的章名（2026-11-17 真机：依据跳转全错）。
 *
 * 建索引时要给每一块记「出自哪一章」。EPUB 引擎的 section 只给 `id`
 * （清单里的文件路径），没有 `href`；取章名时读错字段，全书就退化成
 * 「第 1 节 / 第 2 节 …」。来源写着「第 9 节」，点开按这个假名字回目录
 * 找章，目录里是「第五章」，找不到，最后落到「全书第一次出现这句话」。
 *
 * 这里锁两件事：EPUB 那种只有 id 的 section 能认出真名；目录对不上时
 * 才用调用方给的兜底名（TXT / 剪藏本是另一套 section 形状）。
 */
describe('画像章名（chapterTitles）', () => {
  const toc = [
    { label: '封面', href: 'OEBPS/Text/coverpage.html' },
    { label: '第一章', href: 'OEBPS/Text/chapter4.html' },
    { label: '第二章', href: 'OEBPS/Text/chapter5.html#part2' },
  ];
  const fallback = (i: number): string => `section-${i + 1}`;

  it('EPUB 的 section 只有 id、没有 href：照样认出真章名', () => {
    const sections = [
      { id: 'OEBPS/Text/coverpage.html' },
      { id: 'OEBPS/Text/chapter4.html' },
      { id: 'OEBPS/Text/chapter5.html' },
    ];
    expect(chapterTitles(toc, sections, fallback)).toEqual(['封面', '第一章', '第二章']);
  });

  it('TXT / 剪藏本只给 href（id 缺省）也认', () => {
    const sections = [{ href: 'OEBPS/Text/chapter4.html' }, { href: 'OEBPS/Text/chapter5.html' }];
    expect(chapterTitles(toc, sections, fallback)).toEqual(['第一章', '第二章']);
  });

  it('目录里的 href 带 #fragment 时按文件路径匹配', () => {
    const sections = [{ id: 'OEBPS/Text/chapter5.html' }];
    expect(chapterTitles(toc, sections, fallback)).toEqual(['第二章']);
  });

  it('目录里没有这一章、或者 section 两样都空：用兜底名', () => {
    const sections = [{ id: 'OEBPS/Text/unknown.html' }, {}];
    expect(chapterTitles(toc, sections, fallback)).toEqual(['section-1', 'section-2']);
  });

  it('同一份路径在目录里出现多次：取第一条（先出现的才是作者给的入口）', () => {
    const dup = [
      { label: '上篇', href: 'Text/a.html' },
      { label: '上篇 续', href: 'Text/a.html' },
    ];
    expect(chapterTitles(dup, [{ id: 'Text/a.html' }], fallback)).toEqual(['上篇']);
  });

  it('空目录 / 空 section 列表都不抛', () => {
    expect(chapterTitles(undefined, [{ id: 'x' }], fallback)).toEqual(['section-1']);
    expect(chapterTitles(toc, [], fallback)).toEqual([]);
  });
});

/* ============================================================
 * 章名 → 章序号（2026-11-17）
 *
 * 依据跳转要在目标章里搜：先跳章再搜会踩 `chapterIndex` 还没刷新的时序
 * （真机：点了附录，章内搜却还在第九章）。这里把章名先换序号。
 * ============================================================ */
describe('章名 → 章序号（sectionIndexOfChapter）', () => {
  const toc = [
    { label: '封面', href: 'OEBPS/Text/cover.html' },
    { label: '第一章', href: 'OEBPS/Text/ch4.html' },
    { label: '附录 记钱锺书与《围城》', href: 'OEBPS/Text/ch15.html' },
  ];

  it('EPUB 只有 id：算出正确序号', () => {
    const sections = [{ id: 'OEBPS/Text/cover.html' }, { id: 'OEBPS/Text/ch4.html' }, { id: 'OEBPS/Text/ch15.html' }];
    expect(sectionIndexOfChapter(toc, sections, '附录 记钱锺书与《围城》')).toBe(2);
  });

  it('TXT / 剪藏本只有 href：也算得出', () => {
    expect(sectionIndexOfChapter(toc, [{ id: 'txt-0', href: 'OEBPS/Text/ch4.html' }], '第一章')).toBe(0);
  });

  it('章名不在目录里：-1（调用方走全书兜底）', () => {
    expect(sectionIndexOfChapter(toc, [{ id: 'OEBPS/Text/ch4.html' }], '第九章')).toBe(-1);
    expect(sectionIndexOfChapter(toc, [{ id: 'OEBPS/Text/ch4.html' }], '')).toBe(-1);
  });
});
