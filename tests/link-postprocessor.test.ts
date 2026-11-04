import { describe, expect, it } from 'vitest';
import { makeBook } from '../src/data/book-repo';
import { addHighlight } from '../src/data/notes';
import { wikilinkOfMark } from '../src/data/wikilink';
import {
  hrefCandidates,
  interceptableClick,
  planWikilinkClick,
  resolveClickTarget,
} from '../src/shell/link-postprocessor';
import { parseMiniHtml } from './helpers/dom-stub';

/**
 * 双链点击接管。
 *
 * 只测纯函数：`createWikilinkPostProcessor` 里的 DOM 绑定与事件捕获
 * 需要真实布局/事件系统，项目没装 jsdom，走真机冒烟。
 */
function bookWithHighlight(text: string, chapterTitle?: string) {
  const book = makeBook('书/测试书.epub', 'epub');
  book.meta.title = '测试书';
  const h = addHighlight(book, { text, cfiRange: 'epubcfi(/6/4)', chapterTitle });
  return { book, h };
}

/** 从生成的 `[[路径#子路径|别名]]` 里取 `路径#子路径`，也就是 Obsidian 存进 data-href 的东西 */
function hrefOf(book: ReturnType<typeof makeBook>, h: ReturnType<typeof addHighlight>): string {
  const link = wikilinkOfMark(book, h);
  return link.slice(2, link.lastIndexOf('|'));
}

function anchor(attrs: string): Element {
  const doc = parseMiniHtml(`<a ${attrs}>x</a>`);
  return doc.body.children[0] as unknown as Element;
}

const library = (path: string) => (path === '书/测试书.epub' ? { id: 'book-1' } : undefined);

describe('planWikilinkClick · 该不该接管', () => {
  it('自家双链 + 书在库里 → 返回带 bookId 的定位', () => {
    const { book, h } = bookWithHighlight('她转过身，没有回头', '第一章');
    const target = planWikilinkClick(hrefOf(book, h), library);
    expect(target).not.toBeNull();
    expect(target!.bookId).toBe('book-1');
    expect(target!.cfi).toBe('epubcfi(/6/4)');
    expect(target!.text).toBe('她转过身，没有回头');
  });

  it('书不在库里 → 不拦，交给 Obsidian 默认处理', () => {
    const { book, h } = bookWithHighlight('一句话', '第一章');
    expect(planWikilinkClick(hrefOf(book, h), () => undefined)).toBeNull();
  });

  it('普通笔记链接与老 obsidian:// 链接都不拦', () => {
    expect(planWikilinkClick('笔记/某条.md#标题', library)).toBeNull();
    expect(planWikilinkClick('obsidian://bz-reader?book=x&cfi=y', library)).toBeNull();
  });
});

describe('hrefCandidates · 从元素取地址', () => {
  it('data-href 排第一：那是原始 linktext，移动端 href 会被改写', () => {
    const el = anchor('data-href="书/测试书.epub#bzr-cfi=x" href="app://obsidian.md/书"');
    expect(hrefCandidates(el)).toEqual(['书/测试书.epub#bzr-cfi=x', 'app://obsidian.md/书']);
  });

  it('只有 href 时也能取到', () => {
    const el = anchor('href="书/测试书.epub#bzr-cfi=x"');
    expect(hrefCandidates(el)).toEqual(['书/测试书.epub#bzr-cfi=x']);
  });

  it('两个都没有时返回空数组', () => {
    expect(hrefCandidates(anchor('class="internal-link"'))).toEqual([]);
  });

  it('两个属性相同时不重复', () => {
    const el = anchor('data-href="a.epub#bzr-cfi=x" href="a.epub#bzr-cfi=x"');
    expect(hrefCandidates(el)).toHaveLength(1);
  });
});

describe('resolveClickTarget · 候选地址里挑一个能用的', () => {
  it('第一个不行就用第二个（移动端 href 是 app:// 的那种）', () => {
    const { book, h } = bookWithHighlight('一句话', '第一章');
    const target = resolveClickTarget(['app://obsidian.md/x', hrefOf(book, h)], library);
    expect(target!.bookId).toBe('book-1');
  });

  it('全都不是自家链接 → null', () => {
    expect(resolveClickTarget(['笔记.md#标题', 'https://example.com'], library)).toBeNull();
  });
});

describe('interceptableClick · 全局点击捕获', () => {
  /* 只在阅读视图挂 post-processor 时，Live Preview 里点双链走的是 Obsidian
     默认处理：直接把 .epub 打开、替换掉当前笔记，回都回不来。全局捕获要能
     从点击目标往上找到链接元素。 */
  function clickInside(attrs: string): Element {
    const link = anchor(attrs);
    return {
      closest: (sel: string) => (sel.includes('a') ? link : null),
    } as unknown as Element;
  }

  it('点在自家双链上：返回定位', () => {
    const { book, h } = bookWithHighlight('一句话', '第一章');
    const target = interceptableClick(clickInside(`data-href="${hrefOf(book, h)}"`), library);
    expect(target?.bookId).toBe('book-1');
    expect(target?.cfi).toBe('epubcfi(/6/4)');
  });

  it('书不在库里：不拦（让 Obsidian 按默认方式处理）', () => {
    const { book, h } = bookWithHighlight('一句话', '第一章');
    expect(interceptableClick(clickInside(`data-href="${hrefOf(book, h)}"`), () => undefined)).toBeNull();
  });

  it('普通笔记链接不拦', () => {
    expect(interceptableClick(clickInside('data-href="笔记/某条.md#标题"'), library)).toBeNull();
  });

  it('点到空白处（没有链接元素）不拦', () => {
    expect(interceptableClick(null, library)).toBeNull();
  });
});
