import { describe, expect, it } from 'vitest';
import { findTocHref } from '../src/engine/toc';

type Node = { label: string; href: string; subitems?: Node[] };
const item = (label: string, href: string, subitems?: Node[]): Node => ({ label, href, subitems });

/**
 * AI 回答的来源只带「章名」，不带 href（画像里存不下 CFI，也不该存）。
 * 点来源时要拿章名回目录换一次 href——找不到就不动，别把人扔到书开头。
 */
describe('按章名找目录项', () => {
  const toc = [
    item('第一章 心流', 'ch1.xhtml'),
    item('第二章 专注', 'ch2.xhtml', [item('2.1 注意力', 'ch2-1.xhtml#a')]),
  ];

  it('顶层按章名精确命中', () => {
    expect(findTocHref(toc, '第一章 心流')).toBe('ch1.xhtml');
  });

  it('子目录也找得到', () => {
    expect(findTocHref(toc, '2.1 注意力')).toBe('ch2-1.xhtml#a');
  });

  it('前后空白不算差异（章名是从正文里带出来的，常带空白）', () => {
    expect(findTocHref(toc, '  第二章 专注  ')).toBe('ch2.xhtml');
  });

  it('找不到、空名字、空目录都返回空串（调用方据此不动）', () => {
    expect(findTocHref(toc, '第三章')).toBe('');
    expect(findTocHref(toc, '')).toBe('');
    expect(findTocHref(undefined, '第一章 心流')).toBe('');
  });

  it('同名多项时取第一个（先出现的才是作者给的入口）', () => {
    const dup = [item('附录', 'a.xhtml'), item('附录', 'b.xhtml')];
    expect(findTocHref(dup, '附录')).toBe('a.xhtml');
  });

  it('没有 href 的目录项要跳过，别返回一个空 href 当成功', () => {
    const dirty = [item('封面', ''), item('正文', 'main.xhtml')];
    expect(findTocHref(dirty, '封面')).toBe('');
    expect(findTocHref(dirty, '正文')).toBe('main.xhtml');
  });
});
