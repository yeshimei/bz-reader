// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ChapterClock } from '../src/data/clip-epub/chapter-clock';

describe('ChapterClock', () => {
  it('只记当前章；没有当前章时不收', () => {
    const c = new ChapterClock();
    c.add(10);
    expect(c.take()).toBeNull();
    c.setKey('a');
    c.add(10);
    c.add(5);
    expect(c.take()).toEqual({ key: 'a', seconds: 15 });
    expect(c.take()).toBeNull();
  });

  it('切章后只记新章（调用方先结旧账）', () => {
    const c = new ChapterClock();
    c.setKey('a');
    c.add(12);
    expect(c.take()).toEqual({ key: 'a', seconds: 12 });
    c.setKey('b');
    c.add(3);
    expect(c.take()).toEqual({ key: 'b', seconds: 3 });
  });

  it('忽略 0 / 负数 / 非数字', () => {
    const c = new ChapterClock();
    c.setKey('a');
    c.add(0);
    c.add(-3);
    c.add(Number.NaN);
    expect(c.pending).toBe(0);
    expect(c.take()).toBeNull();
  });

  it('不足 1 秒取整为 0 → 不记账', () => {
    const c = new ChapterClock();
    c.setKey('a');
    c.add(0.4);
    expect(c.take()).toBeNull();
  });
});
