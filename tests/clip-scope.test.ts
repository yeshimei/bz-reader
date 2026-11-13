/**
 * 剪藏成书 · 汇总范围（tests/clip-scope.test.ts）
 *
 * 2026-11-14 用户要求：设置里给剪藏本一个「汇总范围」，三档——
 * 全部 / 未读 / 今日+未读，默认未读。口径必须先把三件事说死，
 * 否则以后改筛选条件没人知道原来是什么：
 *
 *   1. 「未读」不是「state === unread」：bz 里剪藏（saved）是「存下来的」，
 *      不是「读过的」。用户收藏了一篇没读，它就该留在书里——所以未读
 *      = 除明确读过（read）以外都算。
 *   2. 「今日」按**文章发布时间**（ts），按本机时区的零点切，不按抓取时间：
 *      昨晚抓的今天的早报，读者认为它就是今天的。
 *   3. ts 拿不到（0）的旧数据只靠 state 判定：未读照收，已读不进
 *      「今日+未读」——不能因为时间缺失就把它当成今天的。
 */
import { describe, expect, it } from 'vitest';
import { scopeKeeps, todayStart, DEFAULT_CLIP_SCOPE } from '../src/data/clip-epub/scope';

const NOW = new Date(2026, 10, 14, 10, 30, 0).getTime(); // 2026-11-14 10:30 本地
const START = todayStart(NOW);

function item(state: 'unread' | 'read' | 'saved', ts: number) {
  return { state, ts };
}

describe('todayStart', () => {
  it('取本机时区的零点，不是 UTC', () => {
    const d = new Date(START);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
    expect(START).toBeLessThan(NOW);
    expect(NOW - START).toBeLessThan(86_400_000);
  });

  it('同一自然日的任意时刻都落在同一个零点上', () => {
    const early = new Date(2026, 10, 14, 0, 0, 1).getTime();
    const late = new Date(2026, 10, 14, 23, 59, 59).getTime();
    expect(todayStart(early)).toBe(START);
    expect(todayStart(late)).toBe(START);
  });
});

describe('scopeKeeps', () => {
  it('默认是未读（不是全部）', () => {
    expect(DEFAULT_CLIP_SCOPE).toBe('unread');
  });

  it('全部：什么状态、什么时间都收', () => {
    expect(scopeKeeps(item('unread', 0), 'all', START)).toBe(true);
    expect(scopeKeeps(item('read', START - 1), 'all', START)).toBe(true);
    expect(scopeKeeps(item('saved', 0), 'all', START)).toBe(true);
  });

  it('未读：收没读过的（含已剪藏），只剔掉明确读过的', () => {
    expect(scopeKeeps(item('unread', START - 86_400_000), 'unread', START)).toBe(true);
    expect(scopeKeeps(item('saved', 0), 'unread', START)).toBe(true);
    expect(scopeKeeps(item('read', START), 'unread', START)).toBe(false);
  });

  it('今日+未读：读过的也能进，但必须是今天发布的', () => {
    expect(scopeKeeps(item('unread', START - 86_400_000), 'todayUnread', START)).toBe(true);
    expect(scopeKeeps(item('saved', 0), 'todayUnread', START)).toBe(true);
    expect(scopeKeeps(item('read', START), 'todayUnread', START)).toBe(true);
    expect(scopeKeeps(item('read', START - 1), 'todayUnread', START)).toBe(false);
  });

  it('时间缺失（ts=0）的已读旧数据不进「今日+未读」', () => {
    expect(scopeKeeps(item('read', 0), 'todayUnread', START)).toBe(false);
  });

  it('零点那一刻发的文章算今天', () => {
    expect(scopeKeeps(item('read', START), 'todayUnread', START)).toBe(true);
    expect(scopeKeeps(item('read', START - 1), 'todayUnread', START)).toBe(false);
  });
});
