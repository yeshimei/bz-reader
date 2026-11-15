import { describe, expect, it } from 'vitest';
import { cacheKey, cachedSegmentCount, pickEvictions } from '../src/data/tts-cache';

describe('缓存键', () => {
  it('同一段文本 + 同一音色得到同一个键（重听命中）', () => {
    expect(cacheKey('b1', 'stella', '他推开门。')).toBe(cacheKey('b1', 'stella', '他推开门。'));
  });

  it('换音色 / 换文本 / 换书都会换键', () => {
    const a = cacheKey('b1', 'stella', '他推开门。');
    expect(cacheKey('b1', 'tide', '他推开门。')).not.toBe(a);
    expect(cacheKey('b1', 'stella', '她推开门。')).not.toBe(a);
    expect(cacheKey('b2', 'stella', '他推开门。')).not.toBe(a);
  });

  it('键里不带整段正文（IndexedDB 的键不该几百字长）', () => {
    const text = '一段很长的正文'.repeat(100);
    expect(cacheKey('b1', 'stella', text).length).toBeLessThan(60);
  });
});

describe('缓存淘汰（LRU）', () => {
  const at = (n: number) => ({ key: `k${n}`, bytes: 100, at: n });

  it('没超上限一个都不删', () => {
    expect(pickEvictions([at(1), at(2)], 1000, 100)).toEqual([]);
  });

  it('超了就删最旧的，删到不超为止', () => {
    expect(pickEvictions([at(3), at(1), at(2)], 250, 100)).toEqual(['k1', 'k2']);
  });

  it('本次要写入的那条不能被删掉', () => {
    expect(pickEvictions([at(1), at(2)], 150, 100, 'k1')).toEqual(['k2']);
  });

  it('新来的一条比上限还大：只留它自己，旧的全清', () => {
    expect(pickEvictions([at(1), at(2)], 100, 500)).toEqual(['k1', 'k2']);
  });
});

/* 续跑：缓存就是进度。点「预生成本章」时先数一数这章已经备好几段，
   才知道给不给「继续」这个选项（2026-11-15 用户要求）。 */
describe('cachedSegmentCount', () => {
  const keyOf = (text: string): string => `k:${text}`;

  it('全命中：等于段数', () => {
    const keys = new Set([keyOf('a'), keyOf('b')]);
    expect(cachedSegmentCount(keys, keyOf, ['a', 'b'])).toBe(2);
  });

  it('半命中：数出已备好的那些', () => {
    const keys = new Set([keyOf('a'), keyOf('c')]);
    expect(cachedSegmentCount(keys, keyOf, ['a', 'b'])).toBe(1);
  });

  it('一条都没有：0', () => {
    expect(cachedSegmentCount(new Set(), keyOf, ['a', 'b'])).toBe(0);
  });

  it('重复的句子各算一段：两处都能出声，续跑时都不必重做', () => {
    const keys = new Set([keyOf('a')]);
    expect(cachedSegmentCount(keys, keyOf, ['a', 'a'])).toBe(2);
  });

  it('空脚本：0，不是 NaN', () => {
    expect(cachedSegmentCount(new Set(), keyOf, [])).toBe(0);
  });
});

