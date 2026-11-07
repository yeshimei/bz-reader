import { describe, expect, it } from 'vitest';
import { kbSource, kbThought, mergeThought } from '../src/data/kb-entry';

describe('知识库录入：来源', () => {
  it('来源是协议串，不是库内路径；显示名是书名', () => {
    const src = kbSource('b1', '心流', {
      text: '注意力是一种有限的资源',
      cfiRange: 'epubcfi(/6/4!4/2/1:0)',
      chapterTitle: '注意力',
    });
    expect(src?.kind).toBe('note');
    expect(src?.path.startsWith('obsidian://bz-reader?')).toBe(true);
    expect(src?.path).toContain('book=b1');
    expect(src?.path).toContain('cfi=');
    expect(src?.name).toBe('心流');
  });

  it('没有 CFI 时仍给得出可用来源（书名 + 章节 + 原文片段）', () => {
    const src = kbSource('b2', '论文', { text: '第一句', chapterTitle: '' });
    expect(src?.path).toContain('book=b2');
    expect(src?.path).not.toContain('cfi=');
    expect(src?.name).toBe('论文');
  });
});

describe('知识库录入：回写双链', () => {
  it('去掉 .md、别名用笔记名', () => {
    expect(kbThought('文献/心流.md')).toBe('[[文献/心流|心流]]');
    expect(kbThought('文献/注意.md')).toBe('[[文献/注意|注意]]');
    expect(kbThought('')).toBe('');
  });

  it('空想法写成一行链接', () => {
    expect(mergeThought('', '[[文献/心流|心流]]')).toBe('[[文献/心流|心流]]');
    expect(mergeThought(undefined, '[[a|a]]')).toBe('[[a|a]]');
  });

  it('已有想法追加在下一行，不覆盖用户写的字', () => {
    expect(mergeThought('这段说得很透', '[[文献/心流|心流]]')).toBe('这段说得很透\n[[文献/心流|心流]]');
  });

  it('同一枚链接重复写入不叠行', () => {
    const link = '[[文献/心流|心流]]';
    const once = mergeThought('我的想法', link);
    expect(mergeThought(once, link)).toBe(once);
  });
});
