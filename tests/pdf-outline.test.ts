import { describe, expect, it } from 'vitest';
import { mapPdfOutline, synthPdfToc } from '../src/engine/pdf/outline';

describe('pdf outline → toc', () => {
  const pageOf = (dest: unknown): number | null => {
    if (typeof dest === 'number') return dest + 1;
    if (Array.isArray(dest) && typeof dest[0] === 'number') return dest[0] + 1;
    return null;
  };

  it('把大纲节点映射成目录项，href 用页 locator', () => {
    const got = mapPdfOutline(
      [
        { title: '第一章', dest: 0 },
        { title: '第二章', dest: [11] },
      ],
      pageOf,
    );
    expect(got).toEqual([
      { label: '第一章', href: 'pdf/1' },
      { label: '第二章', href: 'pdf/12' },
    ]);
  });

  it('保留子项，并把解析不出页码的父节点提升子项', () => {
    const got = mapPdfOutline(
      [
        {
          title: '坏节点',
          dest: null,
          items: [{ title: '子节点', dest: 4 }],
        },
        { title: '正常', dest: 2 },
      ],
      pageOf,
    );
    expect(got).toEqual([
      { label: '子节点', href: 'pdf/5' },
      { label: '正常', href: 'pdf/3' },
    ]);
  });

  it('空标题用「第 N 页」兜底，非空标题原样保留', () => {
    const got = mapPdfOutline([{ title: '   ', dest: 1 }], pageOf);
    expect(got).toEqual([{ label: '第 2 页', href: 'pdf/2' }]);
  });

  it('空大纲返回空数组', () => {
    expect(mapPdfOutline(null, pageOf)).toEqual([]);
    expect(mapPdfOutline(undefined, pageOf)).toEqual([]);
    expect(mapPdfOutline([], pageOf)).toEqual([]);
  });

  it('没有大纲时按步长合成页码目录', () => {
    const toc = synthPdfToc(23, 10);
    expect(toc).toEqual([
      { label: '第 1–10 页', href: 'pdf/1' },
      { label: '第 11–20 页', href: 'pdf/11' },
      { label: '第 21–23 页', href: 'pdf/21' },
    ]);
    expect(synthPdfToc(8, 10)).toEqual([{ label: '第 1–8 页', href: 'pdf/1' }]);
    expect(synthPdfToc(0, 10)).toEqual([]);
    expect(synthPdfToc(5, 0)).toEqual([{ label: '第 1–5 页', href: 'pdf/1' }]);
  });
});
