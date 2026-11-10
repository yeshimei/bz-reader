import { describe, expect, it } from 'vitest';
import { NAV_HISTORY_LIMIT, NavHistory } from '../src/core/nav-history';

/**
 * 跳转历史（「回到上一处」）。
 *
 * PDF 早就有这条栈（点目录 / 链接跳走之前记一手，翻页与滚动不算）。
 * 2026-11-10 起 EPUB 也有同一个动作，规则必须两边一样，所以把它抽成纯函数：
 *   · 只记「显式跳转」的那一刻，翻页不记（否则一路翻过去，回退要按十几次）；
 *   · 同一处连着记只算一次（进度条与重绘会重复报同一个位置）；
 *   · 栈有上限，读完一本书不至于留下几百个点。
 */
describe('NavHistory', () => {
  it('刚开始没有可回退的位置', () => {
    const h = new NavHistory();
    expect(h.canBack).toBe(false);
    expect(h.size).toBe(0);
    expect(h.pop()).toBeNull();
  });

  it('记一处之后就能退回那一处', () => {
    const h = new NavHistory();
    h.push({ cfi: 'epubcfi(/6/8!/4/2)' });
    expect(h.canBack).toBe(true);
    expect(h.pop()?.cfi).toBe('epubcfi(/6/8!/4/2)');
    expect(h.canBack).toBe(false);
  });

  it('后进先出：连记三处，先回到最近那一处', () => {
    const h = new NavHistory();
    h.push({ cfi: 'a' });
    h.push({ cfi: 'b' });
    h.push({ cfi: 'c' });
    expect(h.pop()?.cfi).toBe('c');
    expect(h.pop()?.cfi).toBe('b');
    expect(h.pop()?.cfi).toBe('a');
  });

  it('同一个位置连着记只算一次', () => {
    const h = new NavHistory();
    expect(h.push({ cfi: 'a' })).toBe(true);
    expect(h.push({ cfi: 'a' })).toBe(false);
    expect(h.size).toBe(1);
  });

  it('空定位串不记：引擎还没准备好时会报空串', () => {
    const h = new NavHistory();
    expect(h.push({ cfi: '' })).toBe(false);
    expect(h.push({ cfi: '   ' })).toBe(false);
    expect(h.size).toBe(0);
  });

  it('超过上限时丢掉最早那一处', () => {
    const h = new NavHistory(NAV_HISTORY_LIMIT);
    for (let i = 0; i < NAV_HISTORY_LIMIT + 5; i += 1) h.push({ cfi: `p${i}` });
    expect(h.size).toBe(NAV_HISTORY_LIMIT);
    let last = '';
    while (h.canBack) last = h.pop()?.cfi ?? '';
    /* 先弹出来的是最新的，最后弹出来的是还留在栈里的最早一处 */
    expect(last).toBe(`p5`);
  });

  it('章节名跟着位置一起记：提示里能说回到哪一章', () => {
    const h = new NavHistory();
    h.push({ cfi: 'a', label: '第三章' });
    expect(h.pop()?.label).toBe('第三章');
  });

  it('换书时清空，上一本的定位串不能拿来跳这本', () => {
    const h = new NavHistory();
    h.push({ cfi: 'a' });
    h.clear();
    expect(h.canBack).toBe(false);
  });

  it('peek 不弹栈：重挂头栏时只看一眼亮不亮', () => {
    const h = new NavHistory();
    h.push({ cfi: 'a' });
    expect(h.peek()?.cfi).toBe('a');
    expect(h.size).toBe(1);
  });
});
