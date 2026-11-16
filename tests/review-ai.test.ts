/**
 * 让 AI 挑重点（data/review-ai.ts）
 *
 * 这里最容易出的事故是「模型编了一个不存在的 id」和「模型概括出一句原文里
 * 没有的话」——两种都会让调用方拿到一张对不上原文的卡。所以解析层宁可少收，
 * 也不收一条验不过的。
 */
import { describe, expect, it } from 'vitest';
import {
  buildChapterCardPrompt,
  buildMarkPickPrompt,
  parseChapterCards,
  parsePickedIds,
} from '../src/data/review-ai';

describe('buildMarkPickPrompt：按划线挑', () => {
  it('带上书名、章节、条数和每条的 id', () => {
    const p = buildMarkPickPrompt('围城', '第一章', [
      { id: 'h1', text: '红海早过了。', comment: '开篇' },
      { id: 'h2', text: '船在印度洋面上开驶着。' },
    ]);
    expect(p).toContain('《围城》第一章');
    expect(p).toContain('一共 2 条');
    expect(p).toContain('[id=h1]');
    expect(p).toContain('我的想法：开篇');
    expect(p).toContain('{"keep"');
  });

  it('强调「不要为了凑比例硬删」', () => {
    const p = buildMarkPickPrompt('书', '', [{ id: 'h1', text: '甲' }]);
    expect(p).toContain('不要为了凑比例硬删');
    expect(p).toContain('全部保留');
  });
});

describe('parsePickedIds：只认真实存在的 id', () => {
  it('正常解析', () => {
    expect(parsePickedIds('{"keep":["h1","h2"]}', ['h1', 'h2', 'h3'])).toEqual(['h1', 'h2']);
  });

  it('模型编出来的 id 丢掉', () => {
    expect(parsePickedIds('{"keep":["h1","id3"]}', ['h1', 'h2'])).toEqual(['h1']);
  });

  it('包了代码块也能取', () => {
    expect(parsePickedIds('```json\n{"keep":["h1"]}\n```', ['h1'])).toEqual(['h1']);
  });

  it('重复 id 只留一次', () => {
    expect(parsePickedIds('{"keep":["h1","h1"]}', ['h1'])).toEqual(['h1']);
  });

  it('解析不了时返回 null（调用方据此保底全留），不抛', () => {
    expect(parsePickedIds('模型说了一堆话', ['h1'])).toBeNull();
    expect(parsePickedIds('{"keep":"h1"}', ['h1'])).toBeNull();
  });

  it('模型明确说一条都不留时返回空数组（这是有效答案，要尊重）', () => {
    expect(parsePickedIds('{"keep":[]}', ['h1', 'h2'])).toEqual([]);
  });
});

describe('buildChapterCardPrompt：按章节挑', () => {
  it('不限制条数时给的是区间参考，不是硬指标', () => {
    const p = buildChapterCardPrompt('书', '第一章', '正文', 0);
    expect(p).toContain('短章 3~5 张');
    expect(p).toContain('宁可少而精');
    expect(p).not.toContain('最多出');
  });

  it('给了上限时补一句「最多」，且不要求出满', () => {
    const p = buildChapterCardPrompt('书', '第一章', '正文', 6);
    expect(p).toContain('最多出 6 张');
    expect(p).toContain('不够就不出满');
  });

  it('带上正文与书名', () => {
    const p = buildChapterCardPrompt('围城', '第一章', '红海早过了。', 0);
    expect(p).toContain('《围城》第一章');
    expect(p).toContain('红海早过了。');
  });
});

describe('parseChapterCards：原文必须对得上', () => {
  const body = '红海早过了，船在印度洋面上开驶着。太阳也落下去了。';

  it('正常解析出三样', () => {
    const cards = parseChapterCards('{"cards":[{"text":"红海早过了，船在印度洋面上开驶着。","q":"故事开始时船在哪？","a":"印度洋"}]}', body);
    expect(cards).toHaveLength(1);
    expect(cards[0].q).toBe('故事开始时船在哪？');
  });

  it('模型概括出来的句子（原文里没有）丢掉', () => {
    const cards = parseChapterCards('{"cards":[{"text":"主角坐船去了印度洋。","q":"去哪了？","a":"印度洋"}]}', body);
    expect(cards).toEqual([]);
  });

  it('换行与多余空白不影响比对', () => {
    const cards = parseChapterCards('{"cards":[{"text":"红海早过了， 船在印度洋面上开驶着。","q":"船在哪？","a":"印度洋"}]}', body);
    expect(cards).toHaveLength(1);
  });

  it('同一句原文只留第一张', () => {
    const cards = parseChapterCards(
      '{"cards":[{"text":"太阳也落下去了。","q":"问题一是什么？","a":"甲"},{"text":"太阳也落下去了。","q":"问题二是什么？","a":"乙"}]}',
      body,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].q).toBe('问题一是什么？');
  });

  it('缺问句的卡丢掉', () => {
    const cards = parseChapterCards('{"cards":[{"text":"太阳也落下去了。","q":"","a":"甲"}]}', body);
    expect(cards).toEqual([]);
  });

  it('没给正文时不校验原文（宽容），但仍然要求 text 与 q', () => {
    const cards = parseChapterCards('{"cards":[{"text":"任意句子","q":"问题一是什么？","a":"甲"}]}');
    expect(cards).toHaveLength(1);
  });
});
