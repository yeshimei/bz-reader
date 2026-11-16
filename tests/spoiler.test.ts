/**
 * 剧透门（tests/spoiler.test.ts）
 *
 * 锁的是「读到哪答到哪」：开着的时候，读到第 2 章就不能把第 3 章的内容
 * 摆给模型。反过来，章名对不上时**必须不截**——把整本书藏起来比多答
 * 一两段更难查，也更容易被当成插件的 bug。
 */
import { describe, expect, it } from 'vitest';
import { encodeVector, type PortraitFile } from '../src/data/portrait';
import { spoilerNote, spoilerScope } from '../src/data/spoiler';

function portraitOf(
  blocks: Array<{ chapter: string; text: string }>,
  extra: Partial<PortraitFile> = {},
): PortraitFile {
  return {
    version: 1,
    bookId: 'book-1',
    bookTitle: '围城',
    plan: 'vector',
    model: 'test-embed',
    dim: 2,
    chunkChars: 1000,
    total: blocks.length,
    blocks: blocks.map((b) => ({
      chapter: b.chapter,
      chars: b.text.length,
      text: b.text,
      vec: encodeVector([1, 0]),
    })),
    createdAt: 0,
    updatedAt: 0,
    done: true,
    ...extra,
  };
}

const BOOK = portraitOf([
  { chapter: '第一章 归国', text: '红海早过了，船在印度洋面上开驶着。' },
  { chapter: '第一章 归国', text: '方鸿渐在甲板上站着。' },
  { chapter: '第二章 上海', text: '回到上海，家里已经给他定下亲事。' },
  { chapter: '第三章 三闾大学', text: '一行人辗转到了三闾大学。' },
  { chapter: '第四章 结婚', text: '他们在上海结了婚。' },
]);

describe('剧透门 · 截断', () => {
  it('读到第二章：只留前两章', () => {
    const scope = spoilerScope(BOOK, '第二章 上海')!;
    expect(scope).toBeTruthy();
    expect(scope.portrait.blocks).toHaveLength(3);
    expect(scope.portrait.blocks.map((b) => b.chapter)).toEqual([
      '第一章 归国',
      '第一章 归国',
      '第二章 上海',
    ]);
    expect(scope.dropped).toBe(2);
  });

  it('截出来的块下标仍是原书的前缀（来源要能跳回去）', () => {
    const scope = spoilerScope(BOOK, '第二章 上海')!;
    expect(scope.portrait.blocks[2].text).toBe(BOOK.blocks[2].text);
  });

  it('块本身是同一份引用，不深拷贝（每次提问都要走这条路）', () => {
    const scope = spoilerScope(BOOK, '第一章 归国')!;
    expect(scope.portrait.blocks[0]).toBe(BOOK.blocks[0]);
  });

  it('全书总述一并清掉：留着等于把后面的事先说了', () => {
    const withOverview = portraitOf(BOOK.blocks.map((b) => ({ chapter: b.chapter, text: b.text })), {
      overview: '这本书讲方鸿渐留学归来后的几段感情。',
    });
    const scope = spoilerScope(withOverview, '第一章 归国')!;
    expect(scope.portrait.overview).toBe('');
  });

  it('不动态改原画像（缓存里那份是共享的）', () => {
    spoilerScope(BOOK, '第一章 归国');
    expect(BOOK.blocks).toHaveLength(5);
    expect(BOOK.total).toBe(5);
  });
});

describe('剧透门 · 不截的情况', () => {
  it('章名对不上：整本可查，不能一个字都搜不到', () => {
    expect(spoilerScope(BOOK, '第九章 不存在')).toBeNull();
  });

  it('已经在最后一章：截了等于没截', () => {
    expect(spoilerScope(BOOK, '第四章 结婚')).toBeNull();
  });

  it('没有当前位置（还没开始读 / 老数据没这字段）', () => {
    expect(spoilerScope(BOOK, '')).toBeNull();
    expect(spoilerScope(BOOK, undefined)).toBeNull();
  });

  it('没有画像 / 没有块', () => {
    expect(spoilerScope(null, '第一章 归国')).toBeNull();
    expect(spoilerScope(portraitOf([]), '第一章 归国')).toBeNull();
  });
});

describe('剧透门 · 章名的两种来源', () => {
  it('nav 只有节号时按节号精确截', () => {
    const p = portraitOf([
      { chapter: '第 1 节', text: '红海早过了。' },
      { chapter: '第 2 节', text: '第二章贝尔格莱德 大年初一的早上。' },
      { chapter: '第 3 节', text: '第三章 后面的事。' },
    ]);
    const scope = spoilerScope(p, '第 2 节')!;
    expect(scope.portrait.blocks).toHaveLength(2);
    expect(scope.chapter).toBe('第 2 节');
  });

  it('当前位置是真章名、画像里是节号：按目录补出来的名字对', () => {
    const p = portraitOf([
      { chapter: '第 1 节', text: '第一章塞格德 我们出发了。' },
      /* 这一节的正文第一行就是真章名，bookMap 会拿它补名 */
      { chapter: '第 2 节', text: '第二章贝尔格莱德 大年初一的早上。' },
      { chapter: '第 3 节', text: '第三章 后面的事。' },
    ]);
    const scope = spoilerScope(p, '第二章贝尔格莱德')!;
    expect(scope).toBeTruthy();
    /* 命中的是补名后的那一条，不是节号 */
    expect(scope.chapter).toContain('第二章');
    expect(scope.portrait.blocks).toHaveLength(2);
  });

  it('同名章不连续时只取第一段（宁可少给，不能多给）', () => {
    const p = portraitOf([
      { chapter: '正文', text: '甲。' },
      { chapter: '正文', text: '乙。' },
      { chapter: '附录', text: '丙。' },
      { chapter: '正文', text: '丁。' },
      { chapter: '后记', text: '戊。' },
    ]);
    const scope = spoilerScope(p, '正文')!;
    expect(scope.portrait.blocks).toHaveLength(2);
    expect(scope.dropped).toBe(3);
  });
});

describe('剧透门 · 依据里那句范围说明', () => {
  it('写明只到哪一章，并给出「还没读到」的说法', () => {
    const scope = spoilerScope(BOOK, '第一章 归国')!;
    const note = spoilerNote(scope);
    expect(note).toContain('第一章 归国');
    expect(note).toContain('还没读到');
  });
});
