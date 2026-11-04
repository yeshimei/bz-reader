import { describe, expect, it } from 'vitest';
import { COVER_MEM_LIMIT, CoverFailureCache, CoverMemory } from '../src/data/cover-cache';

/** 内存封面上限：60 条 LRU + 失败负缓存（A-18 / A-19） */
describe('封面内存 LRU（A-19）', () => {
  it('上限是 60 条左右', () => {
    expect(COVER_MEM_LIMIT).toBeGreaterThanOrEqual(40);
    expect(COVER_MEM_LIMIT).toBeLessThanOrEqual(80);
  });

  it('超过上限时淘汰最久未用的那条，并立即 revokeObjectURL', () => {
    const revoked: string[] = [];
    const mem = new CoverMemory(3, (url) => revoked.push(url));
    mem.set('a', 'blob:a');
    mem.set('b', 'blob:b');
    mem.set('c', 'blob:c');

    mem.get('a'); // a 变成最近使用
    mem.set('d', 'blob:d');

    expect(mem.size).toBe(3);
    expect(mem.get('b')).toBeUndefined();
    expect(revoked).toEqual(['blob:b']);
    expect(mem.get('a')).toBe('blob:a');
    expect(mem.get('c')).toBe('blob:c');
    expect(mem.get('d')).toBe('blob:d');
  });

  it('clear() 释放剩下的全部 URL，内存清空', () => {
    const revoked: string[] = [];
    const mem = new CoverMemory(3, (url) => revoked.push(url));
    mem.set('a', 'blob:a');
    mem.set('b', 'blob:b');

    mem.clear();

    expect(mem.size).toBe(0);
    expect(revoked.sort()).toEqual(['blob:a', 'blob:b']);
  });
});

describe('封面失败负缓存（A-18）', () => {
  it('同一个 key、size 与 mtime 都没变：不再重试', () => {
    const failures = new CoverFailureCache();
    failures.remember('b1-100', 100, 5);
    expect(failures.blocked('b1-100', 100, 5)).toBe(true);
  });

  it('size 或 mtime 变了就允许重试（书换了 / 文件被重新写过）', () => {
    const failures = new CoverFailureCache();
    failures.remember('b1-100', 100, 5);
    expect(failures.blocked('b1-100', 200, 5)).toBe(false);
    expect(failures.blocked('b1-100', 100, 6)).toBe(false);
  });

  it('forget / clear 之后会重新尝试', () => {
    const failures = new CoverFailureCache();
    failures.remember('b1-100', 100, 5);
    failures.forget('b1-100');
    expect(failures.blocked('b1-100', 100, 5)).toBe(false);

    failures.remember('b1-100', 100, 5);
    failures.clear();
    expect(failures.blocked('b1-100', 100, 5)).toBe(false);
  });
});
