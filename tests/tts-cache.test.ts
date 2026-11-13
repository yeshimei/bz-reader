import { describe, expect, it } from 'vitest';
import { cacheKey, pickEvictions } from '../src/data/tts-cache';

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
