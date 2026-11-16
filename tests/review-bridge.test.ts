/**
 * 与 bz Review 的契约（data/review-bridge.ts）
 *
 * 跨插件的东西最容易「看起来能用」：插件没装时抛错、钥匙不稳定导致重复排期、
 * 章节分组把同名章节并成一行。这些都不该靠真机才发现，所以纯逻辑全部钉住。
 */
import { describe, expect, it } from 'vitest';
import {
  AI_BATCH_CHARS,
  aiCardKey,
  batchByChars,
  findReviewApi,
  markCardKey,
  markChapterGroups,
  pickedMarkStats,
  pickedMarks,
} from '../src/data/review-bridge';

function mark(id: string, chapterIndex: number, chapterTitle: string, text: string, comment = ''): any {
  return { id, chapterIndex, chapterTitle, text, comment };
}

describe('findReviewApi：探测 Review 装没装', () => {
  it('没装插件时返回 null，不抛错', () => {
    expect(findReviewApi({ plugins: { plugins: {} } } as any)).toBeNull();
    expect(findReviewApi({} as any)).toBeNull();
    expect(findReviewApi(null as any)).toBeNull();
  });

  it('装了但门面缺 addCards（老版本）也返回 null', () => {
    const app = { plugins: { plugins: { 'bz-review': { reviewApi: { version: 1 } } } } } as any;
    expect(findReviewApi(app)).toBeNull();
  });

  it('门面齐全时原样返回', () => {
    const api = { version: 1, addCards: async () => ({ added: 1, exists: 0, notFound: 0 }) };
    const app = { plugins: { plugins: { 'bz-review': { reviewApi: api } } } } as any;
    expect(findReviewApi(app)).toBe(api);
  });
});

describe('钥匙：重复加入不会排两次', () => {
  it('划线卡钥匙是 reader:<书>:<划线>', () => {
    expect(markCardKey('b1', 'h1')).toBe('reader:b1:h1');
  });

  it('正文卡钥匙对同一句话稳定，换顺序/空白也稳定', () => {
    const a = aiCardKey('b1', '第一章', '红海早过了，船在印度洋面上开驶着。');
    const b = aiCardKey('b1', '第一章', '  红海早过了，船在印度洋面上开驶着。  ');
    const c = aiCardKey('b1', '第一章', '红海早过了，\n船在印度洋面上开驶着。');
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a.startsWith('reader:b1:ai:')).toBe(true);
  });

  it('不同书、不同章、不同句子不会撞', () => {
    const a = aiCardKey('b1', '第一章', '同一句话');
    expect(aiCardKey('b2', '第一章', '同一句话')).not.toBe(a);
    expect(aiCardKey('b1', '第二章', '同一句话')).not.toBe(a);
    expect(aiCardKey('b1', '第一章', '另一句话')).not.toBe(a);
  });
});

describe('markChapterGroups：按划线分章', () => {
  it('只列出有划线的章节，空章不出现', () => {
    const groups = markChapterGroups([mark('h1', 0, '第一章', '甲'), mark('h2', 2, '第三章', '乙')]);
    expect(groups.map((g) => g.title)).toEqual(['第一章', '第三章']);
  });

  it('同名章节按序号分开（有些书每章都叫「注释」）', () => {
    const groups = markChapterGroups([mark('h1', 3, '注释', '甲'), mark('h2', 7, '注释', '乙')]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.index)).toEqual([3, 7]);
  });

  it('条数与字数（含想法）算对', () => {
    const groups = markChapterGroups([mark('h1', 0, '第一章', '四个字啊', '想法'), mark('h2', 0, '第一章', '两字')]);
    expect(groups[0].count).toBe(2);
    // 4 + 2 + 2（想法）= 8
    expect(groups[0].chars).toBe(8);
  });

  it('没有章节信息的划线归到第一组，不丢', () => {
    const groups = markChapterGroups([{ id: 'h1', text: '甲', comment: '' } as any]);
    expect(groups).toHaveLength(1);
    expect(groups[0].index).toBe(0);
  });
});

describe('pickedMarkStats / pickedMarks：勾了章节等于勾了整章', () => {
  const marks = [mark('h1', 0, '第一章', '甲'), mark('h2', 0, '第一章', '乙'), mark('h3', 1, '第二章', '丙')];

  it('勾第一章时只算这一章', () => {
    const stats = pickedMarkStats(marks, ['0\u0001第一章']);
    expect(stats.count).toBe(2);
    expect(stats.chars).toBe(2);
  });

  it('全选时全算', () => {
    const stats = pickedMarkStats(marks, ['0\u0001第一章', '1\u0001第二章']);
    expect(stats.count).toBe(3);
  });

  it('一个都不勾时是 0，不是全部', () => {
    expect(pickedMarkStats(marks, []).count).toBe(0);
  });

  it('挑出来的划线保持原顺序', () => {
    expect(pickedMarks(marks, ['1\u0001第二章']).map((m) => m.id)).toEqual(['h3']);
  });
});

describe('batchByChars：按字数分批', () => {
  it('不超上限时一批走完', () => {
    const batches = batchByChars([1, 2, 3], () => 100, 1000);
    expect(batches).toEqual([[1, 2, 3]]);
  });

  it('超上限时切开', () => {
    const batches = batchByChars([1, 2, 3, 4], () => 400, 1000);
    expect(batches).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('单条超过上限时自成一派，不丢也不死循环', () => {
    const batches = batchByChars(['big', 'small'], (x) => (x === 'big' ? 50000 : 10), 1000);
    expect(batches).toEqual([['big'], ['small']]);
  });

  it('默认上限是 2 万字', () => {
    expect(AI_BATCH_CHARS).toBe(20000);
  });
});
