/**
 * 查询向量缓存（tests/query-vec-cache.test.ts）
 *
 * 锁三件事：命中不重算、换模型不串用、超容量淘汰最旧那条。
 */
import { describe, expect, it } from 'vitest';
import { createQueryVecCache } from '../src/data/query-vec-cache';

describe('查询向量缓存', () => {
  it('同一个模型 + 同一句话，第二次直接命中', () => {
    const cache = createQueryVecCache();
    cache.set('bge-m3', '这本书讲了什么', [0.1, 0.2]);
    expect(cache.get('bge-m3', '这本书讲了什么')).toEqual([0.1, 0.2]);
  });

  it('换了嵌入模型，旧向量不串用', () => {
    const cache = createQueryVecCache();
    cache.set('bge-m3', '这本书讲了什么', [0.1, 0.2]);
    expect(cache.get('bge-small', '这本书讲了什么')).toBeNull();
  });

  it('存进去的是副本，调用方改原数组不影响缓存', () => {
    const cache = createQueryVecCache();
    const vec = [0.1, 0.2];
    cache.set('m', 'q', vec);
    vec[0] = 9;
    expect(cache.get('m', 'q')).toEqual([0.1, 0.2]);
  });

  it('超过容量时淘汰最久没用的那条', () => {
    const cache = createQueryVecCache(3);
    cache.set('m', 'a', [1]);
    cache.set('m', 'b', [2]);
    cache.set('m', 'c', [3]);
    /* 摸一下 a，让它变成最近使用；该被淘汰的是 b */
    expect(cache.get('m', 'a')).toEqual([1]);
    cache.set('m', 'd', [4]);
    expect(cache.size()).toBe(3);
    expect(cache.get('m', 'b')).toBeNull();
    expect(cache.get('m', 'a')).toEqual([1]);
  });

  it('空向量不占位', () => {
    const cache = createQueryVecCache();
    cache.set('m', 'q', []);
    expect(cache.size()).toBe(0);
  });

  it('clear 清空全部', () => {
    const cache = createQueryVecCache();
    cache.set('m', 'a', [1]);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get('m', 'a')).toBeNull();
  });
});
