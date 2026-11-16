/**
 * 融合与收口（tests/hybrid-rank.test.ts）
 *
 * RRF 只融名次；adaptiveCutoff 负责「保底、划线、按章去重」。
 * 这两个函数是检索质量的最后一道闸，参数照抄社区实现，不要把 60 / 3 / 0.3 改掉。
 */
import { describe, expect, it } from 'vitest';
import { RRF_K, adaptiveCutoff, rrfFuse, sortedByScore } from '../src/data/hybrid-rank';

describe('RRF 融合', () => {
  it('两路都靠前的排第一', () => {
    const fused = rrfFuse([['a', 'b', 'c'], ['b', 'a', 'd']]);
    expect([...fused.entries()].sort((x, y) => y[1] - x[1])[0][0]).toBe('a');
  });

  it('只在一路出现的也能进（字面捞回来的专名靠这条）', () => {
    const fused = rrfFuse([['a', 'b'], ['z']]);
    expect(fused.has('z')).toBe(true);
    expect(fused.get('z')!).toBeCloseTo(1 / (RRF_K + 1), 10);
  });

  it('同一路里重复的 key 不双倍加分', () => {
    const one = rrfFuse([['a', 'a']]).get('a')!;
    expect(one).toBeCloseTo(1 / (RRF_K + 1), 10);
  });

  it('k 越小越看重头部', () => {
    const small = rrfFuse([['a', 'b']], 1);
    const large = rrfFuse([['a', 'b']], 100);
    const ratio = (x: Map<string, number>) => x.get('a')! / x.get('b')!;
    expect(ratio(small)).toBeGreaterThan(ratio(large));
  });
});

describe('自适应截断', () => {
  const item = (key: string, score: number, group = 'g') => ({ key, score, group });
  const scoreOf = (x: { score: number }) => x.score;
  const keyOf = (x: { key: string }) => x.key;
  const groupOf = (x: { group: string }) => x.group;

  it('保底三条：分数再低也留三条', () => {
    const out = adaptiveCutoff([item('a', 1), item('b', 0.01), item('c', 0.005)], scoreOf, keyOf, groupOf, {
      floor: 3,
      ceiling: 10,
    });
    expect(out).toHaveLength(3);
  });

  it('超过保底后按相对门槛划线', () => {
    const out = adaptiveCutoff(
      [item('a', 1), item('b', 0.9), item('c', 0.8), item('d', 0.1), item('e', 0.05)],
      scoreOf,
      keyOf,
      (x) => x.key, // 每组独立，避免多样性干扰
      { floor: 1, ceiling: 10, relativeThreshold: 0.3 },
    );
    expect(out.map((x) => x.key)).toEqual(['a', 'b', 'c']);
  });

  it('先去重再补：六块依据不会全落在同一章', () => {
    const out = adaptiveCutoff(
      [
        item('a1', 1, '第一章'),
        item('a2', 0.98, '第一章'),
        item('a3', 0.96, '第一章'),
        item('b1', 0.5, '第二章'),
        item('c1', 0.4, '第三章'),
      ],
      scoreOf,
      keyOf,
      groupOf,
      { floor: 3, ceiling: 4, relativeThreshold: 0.1 },
    );
    const groups = new Set(out.map((x) => x.group));
    expect(groups.size).toBe(3);
    expect(out).toHaveLength(4);
  });

  it('天花板封顶', () => {
    const many = Array.from({ length: 20 }, (_, i) => item(String(i), 1 - i * 0.01, `g${i}`));
    const out = adaptiveCutoff(many, scoreOf, keyOf, groupOf, { floor: 3, ceiling: 5 });
    expect(out).toHaveLength(5);
  });

  it('空输入返回空', () => {
    expect(adaptiveCutoff([], scoreOf, keyOf, groupOf)).toEqual([]);
  });
});

describe('排序', () => {
  it('同分按 key 升序，结果可复现', () => {
    const out = sortedByScore([{ k: 'b', s: 1 }, { k: 'a', s: 1 }], (x) => x.s, (x) => x.k);
    expect(out.map((x) => x.k)).toEqual(['a', 'b']);
  });
});
