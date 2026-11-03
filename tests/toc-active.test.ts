import { describe, expect, it } from 'vitest';
import { isTocItemActive } from '../src/shell/toc-active';

/* 真机上的目录长这样：三个部分下面各有一节叫「-1-」，href 不同 */
const items = [
  { label: '引子', href: 'ch1.xhtml' },
  { label: '-1-', href: 'ch2.xhtml#a1' },
  { label: '-2-', href: 'ch2.xhtml#a2' },
  { label: '-1-', href: 'ch3.xhtml#b1' },
  { label: '-1-', href: 'ch4.xhtml#c1' },
];

describe('目录高亮：按 href 而不是 label', () => {
  it('同名章节只亮当前那一行', () => {
    const active = { label: '-1-', href: 'ch3.xhtml#b1' };
    const on = items.filter((it) => isTocItemActive(it, active));
    expect(on).toHaveLength(1);
    expect(on[0]!.href).toBe('ch3.xhtml#b1');
  });

  it('href 对不上时一行都不亮（不会退回 label 误伤同名行）', () => {
    const active = { label: '-1-', href: 'ch9.xhtml#zzz' };
    expect(items.filter((it) => isTocItemActive(it, active))).toHaveLength(0);
  });

  it('引擎还没给 href 时退回 label（老快照兼容）', () => {
    const active = { label: '引子', href: '' };
    const on = items.filter((it) => isTocItemActive(it, active));
    expect(on.map((it) => it.label)).toEqual(['引子']);
  });

  it('label 与 href 都为空时谁都不亮', () => {
    expect(items.some((it) => isTocItemActive(it, { label: '' }))).toBe(false);
  });
});
