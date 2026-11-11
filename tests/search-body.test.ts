import { describe, expect, it, vi } from 'vitest';
import { mergeBodyHits, planBodyBooks, runBodySearch, type BodyHit } from '../src/shell/search-body';
import { searchQueryKey, settleBodySearch } from '../src/shell/search-run';
import { RT } from '../src/shell/runtime';

/* ============================================================
 * 正文搜索的纯逻辑（fix/search-body）。
 *
 * 「本书 / 全库」要能搜正文，但全库正文是逐本解包的重操作：这里只负责
 * 定范围、去重、顺序与停止，真正的引擎调用由注入的 searchOne 完成。
 * ============================================================ */

const hit = (bookId: string, cfi: string): BodyHit => ({
  bookId,
  bookTitle: `书-${bookId}`,
  cfi,
  chapterLabel: '第一章',
  excerpt: `摘录 ${cfi}`,
});

describe('planBodyBooks', () => {
  const books = [{ id: 'a' }, { id: 'b' }];

  it('全库：所有在架书', () => {
    expect(planBodyBooks(books, 'all', 'a')).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('本书：只扫当前这本书', () => {
    expect(planBodyBooks(books, 'book', 'b')).toEqual([{ id: 'b' }]);
  });

  it('本书但没有当前书：空（界面负责提示先打开一本）', () => {
    expect(planBodyBooks(books, 'book', null)).toEqual([]);
  });

  it('当前书已经不在架上：不回落到别的书', () => {
    expect(planBodyBooks(books, 'book', 'missing')).toEqual([]);
  });
});

describe('mergeBodyHits', () => {
  it('同一本书的同一个 CFI 只留一条', () => {
    const merged = mergeBodyHits([hit('a', 'c1')], [hit('a', 'c1'), hit('a', 'c2')]);
    expect(merged.map((h) => h.cfi)).toEqual(['c1', 'c2']);
  });

  it('不同书的同名 CFI 各算各的', () => {
    const merged = mergeBodyHits([hit('a', 'c1')], [hit('b', 'c1')]);
    expect(merged).toHaveLength(2);
    expect(merged.map((h) => h.bookId)).toEqual(['a', 'b']);
  });

  it('每本最多留 maxPerBook 条，多出来的不挤占别的书', () => {
    const next = Array.from({ length: 8 }, (_, i) => hit('a', `c${i}`));
    const merged = mergeBodyHits([], next, 3);
    expect(merged).toHaveLength(3);
  });

  it('已满的书再来的命中直接忽略', () => {
    const merged = mergeBodyHits([hit('a', 'c1'), hit('a', 'c2')], [hit('a', 'c3')], 2);
    expect(merged.map((h) => h.cfi)).toEqual(['c1', 'c2']);
  });

  it('默认每本留 300 条：以前只留 20 条，长书后面的命中永远看不见', () => {
    const next = Array.from({ length: 250 }, (_, i) => hit('a', `c${i}`));
    expect(mergeBodyHits([], next)).toHaveLength(250);
  });
});

describe('runBodySearch', () => {
  const books = [
    { id: 'a', title: '书-a' },
    { id: 'b', title: '书-b' },
  ];

  it('逐本跑，命中按书回调，进度走到 2/2', async () => {
    const progress: Array<[number, number]> = [];
    const found: Array<[string, string[]]> = [];
    const done = await runBodySearch({
      kw: '词',
      books,
      shouldStop: () => false,
      searchOne: async (book) =>
        book.id === 'a'
          ? [
              { cfi: 'c1', excerpt: '摘录一', chapterLabel: '第一章' },
              { cfi: 'c2', excerpt: '摘录二', chapterLabel: '第一章' },
            ]
          : [],
      onHits: (book, hits) => found.push([book.id, hits.map((h) => h.cfi)]),
      onProgress: (d, t) => progress.push([d, t]),
    });

    expect(done).toBe(true);
    expect(found).toEqual([['a', ['c1', 'c2']]]);
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('第一本扫完后叫停：不再开第二本', async () => {
    const searchOne = vi.fn(async () => []);
    let stop = false;
    await runBodySearch({
      kw: '词',
      books,
      shouldStop: () => stop,
      searchOne: async (book) => {
        await searchOne(book);
        stop = true; // 第一本一结束就停
        return [];
      },
      onHits: () => undefined,
      onProgress: () => undefined,
    });
    expect(searchOne).toHaveBeenCalledTimes(1);
  });

  it('开始前就已经叫停：一本都不扫', async () => {
    const searchOne = vi.fn(async () => []);
    const done = await runBodySearch({
      kw: '词',
      books,
      shouldStop: () => true,
      searchOne,
      onHits: () => undefined,
      onProgress: () => undefined,
    });
    expect(done).toBe(false);
    expect(searchOne).not.toHaveBeenCalled();
  });

  it('某本书打不开：跳过它，后面的书照常扫，并把它报给界面', async () => {
    const failed: string[] = [];
    const done = await runBodySearch({
      kw: '词',
      books,
      shouldStop: () => false,
      searchOne: async (book) => {
        if (book.id === 'a') throw new Error('坏文件');
        return [{ cfi: 'x', excerpt: '一本好的', chapterLabel: '' }];
      },
      onHits: (_book, hits) => {
        expect(hits[0]!.bookId).toBe('b');
      },
      onFail: (book) => failed.push(book.title),
      onProgress: () => undefined,
    });
    expect(done).toBe(true);
    /* 静默跳过 = 用户看到「没有找到」，却不知道有一本根本没搜 */
    expect(failed).toEqual(['书-a']);
  });
});

describe('searchQueryKey（搜索浮层缓存的复用判据）', () => {
  it('同一个词同一个范围得到同一把钥匙', () => {
    expect(searchQueryKey('文明', 'all')).toBe(searchQueryKey('  文明  ', 'all'));
  });

  it('换词或换范围都要换钥匙：否则会把上一处的旧结果还回去', () => {
    expect(searchQueryKey('文明', 'all')).not.toBe(searchQueryKey('文明', 'book'));
    expect(searchQueryKey('文明', 'all')).not.toBe(searchQueryKey('文明史', 'all'));
  });

  it('字面 / 按意思各是一屏：切了方式不能还原上一屏的 DOM', () => {
    expect(searchQueryKey('文明', 'all', 'literal')).not.toBe(searchQueryKey('文明', 'all', 'semantic'));
  });
});

describe('settleBodySearch（真机出现过「跑完却显示已停止」）', () => {
  it('完整跑完：不记「已停止」', () => {
    RT.body.running = true;
    RT.body.stopped = true;
    settleBodySearch(true);
    expect(RT.body.running).toBe(false);
    expect(RT.body.stopped).toBe(false);
  });

  it('被叫停：记「已停止」', () => {
    RT.body.running = true;
    settleBodySearch(false);
    expect(RT.body.stopped).toBe(true);
  });
});
