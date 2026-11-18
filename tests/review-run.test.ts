/**
 * 加入复习的执行层（shell/review-run.ts）
 *
 * 这里盯的是三种「不能悄悄错」的情况：
 *   · 一批模型调用失败，后面的批次还要继续；
 *   · 模型没按 JSON 回，不能把用户勾的划线全丢掉（保底全留）；
 *   · 模型明确说「都不留」，要尊重（不能又给全加回去）。
 */
import { describe, expect, it } from 'vitest';
import { markChars, marksChars, runReviewAdd, splitBody } from '../src/shell/review-run';

const book = { id: 'b1', meta: { title: '围城' } } as any;

function mark(id: string, text: string, chapterTitle = '第一章', comment = ''): any {
  return { id, chapterIndex: 0, chapterTitle, text, comment };
}

/** 假的 Review 门面：记下收到的卡片 */
function fakeApi() {
  const got: any[] = [];
  return {
    got,
    api: {
      addCards: async (cards: any[]) => {
        got.push(...cards);
        return { added: cards.length, exists: 0, notFound: 0 };
      },
    } as any,
  };
}

describe('字数与切块', () => {
  it('划线字数含想法', () => {
    // 「四个字啊」4 字 + 「想法」2 字
    expect(markChars(mark('h1', '四个字啊', '第一章', '想法'))).toBe(6);
    expect(marksChars([mark('h1', '甲'), mark('h2', '乙')])).toBe(2);
  });

  it('短正文不切', () => {
    expect(splitBody('一段话', 1000)).toEqual(['一段话']);
  });

  it('长正文按段落切，不劈开句子', () => {
    const para = '甲'.repeat(600);
    const blocks = splitBody(`${para}\n\n${para}\n\n${para}`, 1000);
    expect(blocks.length).toBeGreaterThan(1);
    // 每一块都是完整段落（600 字），没有被劈成 1000 字里的一半
    for (const b of blocks) expect(b.replace(/\n/g, '').length % 600).toBe(0);
  });

  it('单段超长时才硬切', () => {
    const blocks = splitBody('甲'.repeat(2500), 1000);
    expect(blocks.length).toBe(3);
    expect(blocks.join('')).toBe('甲'.repeat(2500));
  });

  it('空正文返回空数组', () => {
    expect(splitBody('   ', 1000)).toEqual([]);
  });
});

describe('runReviewAdd：按划线挑', () => {
  it('挑出来的划线变成卡片，钥匙是 reader:<书>:<划线>', async () => {
    const { api, got } = fakeApi();
    const res = await runReviewAdd(
      { book, api, ask: async () => '{"keep":["h1"]}', chapterText: async () => '' },
      { mode: 'marks', chapters: [{ index: 0, title: '第一章', marks: [mark('h1', '甲'), mark('h2', '乙')] }], limit: 0 },
    );
    expect(res.added).toBe(1);
    expect(got[0].key).toBe('reader:b1:h1');
    expect(got[0].text).toBe('甲');
    expect(got[0].backlink).toBe('obsidian://bz-reader?book=b1&t=%E7%94%B2&c=%E7%AC%AC%E4%B8%80%E7%AB%A0');
  });

  it('推卡的 backlink 只带前 20 字原文，不把整段塞进链接', async () => {
    const { api, got } = fakeApi();
    const long = '甲'.repeat(80);
    await runReviewAdd(
      { book, api, ask: async () => '{"keep":["h1"]}', chapterText: async () => '' },
      { mode: 'marks', chapters: [{ index: 0, title: '第一章', marks: [mark('h1', long)] }], limit: 0 },
    );
    const t = decodeURIComponent(got[0].backlink.split('&t=')[1].split('&')[0]);
    expect(t).toBe('甲'.repeat(20));
  });

  it('模型没按 JSON 回时保底全留，不丢用户勾的内容', async () => {
    const { api, got } = fakeApi();
    const res = await runReviewAdd(
      { book, api, ask: async () => '我觉得都挺好，不用挑。', chapterText: async () => '' },
      { mode: 'marks', chapters: [{ index: 0, title: '第一章', marks: [mark('h1', '甲'), mark('h2', '乙')] }], limit: 0 },
    );
    expect(res.added).toBe(2);
    expect(got.map((c) => c.key)).toEqual(['reader:b1:h1', 'reader:b1:h2']);
  });

  it('模型明确说都不留时，一张都不加', async () => {
    const { api, got } = fakeApi();
    const res = await runReviewAdd(
      { book, api, ask: async () => '{"keep":[]}', chapterText: async () => '' },
      { mode: 'marks', chapters: [{ index: 0, title: '第一章', marks: [mark('h1', '甲')] }], limit: 0 },
    );
    expect(res.added).toBe(0);
    expect(got).toHaveLength(0);
  });

  it('一批失败不影响后面（失败计数 + 其余照常加）', async () => {
    const { api, got } = fakeApi();
    let n = 0;
    const res = await runReviewAdd(
      {
        book,
        api,
        ask: async () => {
          n += 1;
          if (n === 1) throw new Error('超时');
          return '{"keep":["h2"]}';
        },
        chapterText: async () => '',
      },
      {
        mode: 'marks',
        chapters: [
          { index: 0, title: '第一章', marks: [mark('h1', '甲'.repeat(15000))] },
          { index: 1, title: '第二章', marks: [mark('h2', '乙'.repeat(15000))] },
        ],
        limit: 0,
      },
    );
    expect(res.failed).toBe(1);
    expect(res.added).toBe(1);
    expect(got[0].key).toBe('reader:b1:h2');
  });
});

describe('runReviewAdd：按章节挑', () => {
  it('AI 出的卡带着题面进计划，钥匙按书+章+句子算', async () => {
    const { api, got } = fakeApi();
    const body = '红海早过了，船在印度洋面上开驶着。太阳也落下去了。';
    const res = await runReviewAdd(
      {
        book,
        api,
        ask: async () =>
          '{"cards":[{"text":"红海早过了，船在印度洋面上开驶着。","q":"船开到哪了？","a":"印度洋"}]}',
        chapterText: async () => body,
      },
      { mode: 'chapters', chapters: [{ index: 2, title: '第一章', marks: [] }], limit: 0 },
    );
    expect(res.added).toBe(1);
    expect(got[0].qa).toEqual({ q: '船开到哪了？', a: '印度洋' });
    expect(got[0].key.startsWith('reader:b1:ai:')).toBe(true);
    expect(got[0].chapterTitle).toBe('第一章');
    expect(got[0].backlink).toContain('obsidian://bz-reader?book=b1');
    expect(got[0].backlink).toContain('c=%E7%AC%AC%E4%B8%80%E7%AB%A0');
  });

  it('正文为空的章节跳过并计数，不算失败', async () => {
    const { api } = fakeApi();
    const res = await runReviewAdd(
      { book, api, ask: async () => '{"cards":[]}', chapterText: async () => '   ' },
      { mode: 'chapters', chapters: [{ index: 0, title: '第一章', marks: [] }], limit: 0 },
    );
    expect(res.empty).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.added).toBe(0);
  });

  it('一章模型失败时继续下一章', async () => {
    const { api, got } = fakeApi();
    let n = 0;
    const res = await runReviewAdd(
      {
        book,
        api,
        ask: async () => {
          n += 1;
          if (n === 1) throw new Error('超时');
          return '{"cards":[{"text":"乙句","q":"问题一是什么？","a":"乙"}]}';
        },
        chapterText: async (i) => (i === 0 ? '甲句' : '乙句'),
      },
      {
        mode: 'chapters',
        chapters: [
          { index: 0, title: '第一章', marks: [] },
          { index: 1, title: '第二章', marks: [] },
        ],
        limit: 0,
      },
    );
    expect(res.failed).toBe(1);
    expect(res.added).toBe(1);
    expect(got[0].text).toBe('乙句');
  });
});

describe('runReviewAdd：落库', () => {
  it('门面报「已存在」时如实转达，不算失败', async () => {
    const api = { addCards: async () => ({ added: 1, exists: 2, notFound: 0 }) } as any;
    const res = await runReviewAdd(
      { book, api, ask: async () => '{"keep":["h1"]}', chapterText: async () => '' },
      { mode: 'marks', chapters: [{ index: 0, title: '第一章', marks: [mark('h1', '甲')] }], limit: 0 },
    );
    expect(res.added).toBe(1);
    expect(res.exists).toBe(2);
    expect(res.failed).toBe(0);
  });

  it('门面抛错时记一次失败，不往外抛', async () => {
    const api = {
      addCards: async () => {
        throw new Error('boom');
      },
    } as any;
    const res = await runReviewAdd(
      { book, api, ask: async () => '{"keep":["h1"]}', chapterText: async () => '' },
      { mode: 'marks', chapters: [{ index: 0, title: '第一章', marks: [mark('h1', '甲')] }], limit: 0 },
    );
    expect(res.failed).toBe(1);
    expect(res.added).toBe(0);
  });

  it('一张卡都没生成时不去打扰门面', async () => {
    let called = 0;
    const api = {
      addCards: async () => {
        called += 1;
        return { added: 0, exists: 0, notFound: 0 };
      },
    } as any;
    await runReviewAdd(
      { book, api, ask: async () => '{"keep":[]}', chapterText: async () => '' },
      { mode: 'marks', chapters: [{ index: 0, title: '第一章', marks: [mark('h1', '甲')] }], limit: 0 },
    );
    expect(called).toBe(0);
  });
});
