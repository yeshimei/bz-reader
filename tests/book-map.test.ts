/**
 * 全书地图（tests/book-map.test.ts）
 *
 * 锁的是一条真实缺口：问「这本书讲了什么」「作者的态度怎么变的」时，
 * 六块碎片答不出来——不是依据不够多，是**顺序和结构**没了。
 *
 * 社区三条线（PageIndex 的 tree index、MindMax 的 chapter map、BookRAG 的
 * BookIndex）收敛到同一件事：先把书的目录摆出来，再挑章整段读。
 * 这里锁的就是「地图怎么建」「哪一章该读」「读了多长」。
 */
import { describe, expect, it } from 'vitest';
import {
  bookMap,
  bookSpread,
  chapterText,
  isChapterQuestion,
  isWholeBookQuestion,
  needsMap,
  pickChapters,
  wholeBookEvidence,
} from '../src/data/book-map';
import type { PortraitFile } from '../src/data/portrait';

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
    blocks: blocks.map((b) => ({ chapter: b.chapter, chars: b.text.length, text: b.text })),
    createdAt: 0,
    updatedAt: 0,
    done: true,
    ...extra,
  };
}

const BOOK = portraitOf([
  { chapter: '第一章 归国', text: '红海早过了，船在印度洋面上开驶着。方鸿渐站在甲板上。' },
  { chapter: '第一章 归国', text: '苏小姐也在船上，两人说着闲话。' },
  { chapter: '第二章 上海', text: '回到上海，方鸿渐住在周家，婚事又被提起。' },
  { chapter: '第三章 三闾大学', text: '一行人辗转到了三闾大学，教书的日子并不如意。' },
  { chapter: '第四章 结婚', text: '方鸿渐与孙柔嘉结婚，争吵从第一天就开始了。' },
]);

describe('全书地图', () => {
  it('按章归组、保持书的顺序', () => {
    const map = bookMap(BOOK);
    expect(map.map((m) => m.chapter)).toEqual(['第一章 归国', '第二章 上海', '第三章 三闾大学', '第四章 结婚']);
    expect(map[0].blocks).toBe(2);
    expect(map[1].blocks).toBe(1);
  });

  it('一行说明取该章开头，不取中段', () => {
    const map = bookMap(BOOK);
    expect(map[2].line.startsWith('一行人辗转到了三闾大学')).toBe(true);
  });

  it('有导读时用导读第一句，比正文开头更像「这一章讲什么」', () => {
    const map = bookMap(
      portraitOf(BOOK.blocks.map((b) => ({ chapter: b.chapter, text: b.text ?? '' })), {
        guides: { '第二章 上海': '这一章写方鸿渐回沪后的处境。带着三个问题……' },
      }),
    );
    expect(map[1].line).toBe('这一章写方鸿渐回沪后的处境。');
  });

  it('一行不超过上限，长了截断', () => {
    const long = '甲'.repeat(200);
    const map = bookMap(portraitOf([{ chapter: '第一章', text: long }]), { lineMax: 20 });
    expect(map[0].line.length).toBeLessThanOrEqual(21);
  });

  /* 真机踩到：《血与蜜之地》的 nav 只给「第 7 节」，真章名在正文第一行。
     不补出来，用户问「第九章讲了什么」时目录里根本没有「第九章」三个字。 */
  it('目录只有序号时，从正文第一行补出真章名', () => {
    const map = bookMap(
      portraitOf([
        {
          chapter: '第 7 节',
          text: '第九章贝尔格莱德Ⅰ：蓝色火车 踏上巴尔干的旅途后，塞尔维亚就成为一个挥之不去的名字。',
        },
      ]),
    );
    expect(map[0].title).toBe('第九章贝尔格莱德Ⅰ：蓝色火车');
    expect(map[0].chapter).toBe('第 7 节');
    expect(map[0].line.startsWith('踏上巴尔干')).toBe(true);
  });

  it('正文第一行不是标题时，不乱猜', () => {
    const map = bookMap(portraitOf([{ chapter: '第 3 节', text: '当鸟群飞过阴霾的天际，人们鸦雀无声。' }]));
    expect(map[0].title).toBe('第 3 节');
  });
});

describe('挑章', () => {
  it('章名命中优先：问三闾大学就挑第三章', () => {
    const picked = pickChapters(bookMap(BOOK), '三闾大学教书的日子怎么样', 1);
    expect(picked.map((p) => p.chapter)).toEqual(['第三章 三闾大学']);
  });

  it('章名没中时看正文开头那句', () => {
    const picked = pickChapters(bookMap(BOOK), '孙柔嘉和他为什么吵架', 1);
    expect(picked.map((p) => p.chapter)).toEqual(['第四章 结婚']);
  });

  it('一个都不沾就返回空，不许硬凑', () => {
    expect(pickChapters(bookMap(BOOK), '量子色动力学的渐近自由', 2)).toEqual([]);
  });

  it('章名只有序号时，靠补出来的真章名命中', () => {
    const map = bookMap(
      portraitOf([
        { chapter: '第 7 节', text: '第九章贝尔格莱德Ⅰ：蓝色火车 踏上巴尔干的旅途后，塞尔维亚就成为一个挥之不去的名字。' },
        { chapter: '第 9 节', text: '第十章贝尔格莱德Ⅱ：肖像与观察 大年初一的早上醒来，我的脑袋就像有个胖大哥坐在上面。' },
      ]),
    );
    const picked = pickChapters(map, '第九章讲了什么', 1);
    expect(picked.map((p) => p.title)).toEqual(['第九章贝尔格莱德Ⅰ：蓝色火车']);
  });

  /* 二字组把「第二十九章」切成「第二」，正好撞上「第二章」——问 29 章
     答第 2 章。序号对不上就不挑。 */
  it('点名第几章时，序号是硬条件', () => {
    const map = bookMap(BOOK);
    expect(pickChapters(map, '第二十九章讲了什么', 2)).toEqual([]);
    expect(pickChapters(map, '第 3 章讲了什么', 2).map((p) => p.chapter)).toEqual(['第三章 三闾大学']);
  });

  it('中文数字与阿拉伯数字等价', () => {
    const map = bookMap(BOOK);
    expect(pickChapters(map, '第4章讲了什么', 1).map((p) => p.chapter)).toEqual(['第四章 结婚']);
  });

  it('最多两章，保持书的顺序（读的时候要能连上）', () => {
    const picked = pickChapters(bookMap(BOOK), '归国那一段和后来结婚', 2);
    expect(picked).toHaveLength(2);
    expect(picked[0].chapter).toBe('第一章 归国');
    expect(picked[1].chapter).toBe('第四章 结婚');
  });
});

describe('整章读', () => {
  it('按块顺序拼起来，不重排', () => {
    const text = chapterText(BOOK, '第一章 归国', 5000);
    expect(text.indexOf('红海早过了')).toBeLessThan(text.indexOf('苏小姐也在船上'));
  });

  it('超预算截断并留痕', () => {
    const text = chapterText(BOOK, '第一章 归国', 12);
    expect(text.length).toBeLessThanOrEqual(13);
    expect(text.endsWith('…')).toBe(true);
  });

  it('没有原文时退回要点（压缩画像）', () => {
    const compress = portraitOf([], {
      plan: 'compress',
      blocks: [{ chapter: '第一章', chars: 10, digest: '这一章写归国。' }],
    });
    expect(chapterText(compress, '第一章', 100)).toBe('这一章写归国。');
  });
});

describe('问题是不是在问结构', () => {
  it('全书类', () => {
    expect(isWholeBookQuestion('这本书讲了什么')).toBe(true);
    expect(isWholeBookQuestion('全书的脉络是怎样的')).toBe(true);
    expect(isWholeBookQuestion('作者在全书的立场有什么变化')).toBe(true);
  });

  it('单章类', () => {
    expect(isChapterQuestion('第九章讲了什么')).toBe(true);
    expect(isChapterQuestion('第三章主要写什么')).toBe(true);
    expect(isChapterQuestion('第三章的内容')).toBe(true);
    expect(isChapterQuestion('船上那个法国人叫什么')).toBe(false);
    expect(isChapterQuestion('第3章里那个船叫什么名字')).toBe(false);
  });

  it('具体问题不进地图（那里要的是某一句，不是结构）', () => {
    expect(needsMap('方鸿渐回国坐的船叫什么名字')).toBe(false);
    expect(needsMap('这本书的船叫什么')).toBe(false);
    expect(needsMap('这本书讲了什么')).toBe(true);
    expect(needsMap('第九章讲了什么')).toBe(true);
  });
});

describe('组装依据', () => {
  /* 目录那一行是句式（「当鸟群飞过阴霾的天际」），答不出「这本书讲什么」。
     全书问题改成每章开头各取一段：分布铺满，模型看到的是整本书。 */
  it('全书问题给每章开头，不是只给目录', () => {
    const got = wholeBookEvidence(BOOK, '这本书讲了什么', { limit: 4000 });
    expect(got).not.toBeNull();
    expect(got!.context).toContain('【第一章 归国】');
    expect(got!.context).toContain('【第四章 结婚】');
    expect(got!.context).toContain('红海早过了');
    expect(got!.sources[0].bookId).toBe('book-1');
  });

  it('问到具体章时，目录在前、那一章整段在后', () => {
    const got = wholeBookEvidence(BOOK, '第三章主要写什么', { limit: 4000 });
    expect(got!.context).toContain('【全书目录】');
    expect(got!.context).toContain('【重点章节】');
    expect(got!.context).toContain('一行人辗转到了三闾大学');
  });

  it('一章都挑不中、又不是全书问题时，用检索结果兜底', () => {
    const got = wholeBookEvidence(BOOK, '第二十九章讲了什么', {
      limit: 4000,
      fallback: { context: '【第一章 归国】\n红海早过了。', sources: [] },
    });
    expect(got!.context).toContain('【全书目录】');
    expect(got!.context).toContain('【相关段落】');
    expect(got!.context).toContain('红海早过了');
  });

  it('总长不超过预算', () => {
    const got = wholeBookEvidence(BOOK, '这本书讲了什么', { limit: 300 });
    expect(got!.context.length).toBeLessThanOrEqual(300);
  });

  it('空画像返回 null，不编一份空目录', () => {
    expect(wholeBookEvidence(portraitOf([]), '这本书讲了什么')).toBeNull();
  });

  /* 「这份依据是不是自足的」要能问出来：chapters / spread 不需要再检索，
     catalog 才需要补细节。调用方据此决定要不要算查询向量——嵌入服务
     不可用时，结构型问题靠前者照样答得出来。 */
  it('标出这份依据是怎么来的', () => {
    expect(wholeBookEvidence(BOOK, '这本书讲了什么', { limit: 4000 })!.kind).toBe('spread');
    expect(wholeBookEvidence(BOOK, '第三章主要写什么', { limit: 4000 })!.kind).toBe('chapters');
    const filled = wholeBookEvidence(BOOK, '第二十九章讲了什么', {
      limit: 4000,
      fallback: { context: '【第一章】\n红海早过了。', sources: [] },
    });
    expect(filled!.kind).toBe('fallback');
    const bare = wholeBookEvidence(BOOK, '第二十九章讲了什么', { limit: 4000 });
    expect(bare!.kind).toBe('catalog');
  });

  /* 两章的书曾经只读到半本：`per = cap` 让第一章吃掉整份预算，
     第二章直接变成「…（后文省略）」。 */
  it('两章的书两章都要撒到，不许第一章吃掉整份预算', () => {
    const two = portraitOf([
      { chapter: '第一章', text: `甲${'一'.repeat(900)}` },
      { chapter: '第二章', text: `乙${'二'.repeat(900)}` },
    ]);
    const spread = bookSpread(two, 1200);
    expect(spread).toContain('【第一章】');
    expect(spread).toContain('【第二章】');
    expect(spread).not.toContain('后文省略');
  });
});
