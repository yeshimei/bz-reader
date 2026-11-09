import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { TITLE_TOC_ATTR, TITLE_TOC_CLASS, clearTitleToc, isTitleToc, markTitleToc } from '../src/view/title-toc';

/**
 * 头栏书名标记（2026-11-09 发版复核）。
 *
 * `.view-header-title` 是宿主元素，同一个 leaf 切视图时会被复用。
 * 标了「可点」不摘，别的视图里那块仍是按钮样 + 「打开目录」的读屏标签，
 * 点了却不动——读屏用户尤其容易被误导。
 */

let restore: () => void = () => undefined;

beforeEach(() => {
  restore = installDomStub();
});

afterEach(() => {
  restore();
});

describe('头栏书名标记的加与摘', () => {
  it('加上之后是可点的按钮语义', () => {
    const el = document.createElement('div');
    markTitleToc(el, '打开目录', '围城 · 打开目录');
    expect(el.classList.contains(TITLE_TOC_CLASS)).toBe(true);
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-label')).toBe('打开目录');
    expect(el.getAttribute('title')).toBe('围城 · 打开目录');
    expect(isTitleToc(el)).toBe(true);
  });

  it('摘掉之后元素回到宿主的样子，属性一个不留', () => {
    const el = document.createElement('div');
    markTitleToc(el, '打开目录', '围城 · 打开目录');
    clearTitleToc(el, '围城');
    expect(el.classList.contains(TITLE_TOC_CLASS)).toBe(false);
    expect(el.getAttribute('role')).toBeNull();
    expect(el.getAttribute('tabindex')).toBeNull();
    expect(el.getAttribute('aria-label')).toBeNull();
    expect(el.getAttribute(TITLE_TOC_ATTR)).toBeNull();
    expect(isTitleToc(el)).toBe(false);
    expect(el.getAttribute('title')).toBe('围城');
  });

  it('没有书名要还原时，title 也一起删掉，不留一句无主文案', () => {
    const el = document.createElement('div');
    markTitleToc(el, '打开目录', '打开目录');
    clearTitleToc(el);
    expect(el.getAttribute('title')).toBeNull();
  });

  it('重复标记不会叠加出第二套语义', () => {
    const el = document.createElement('div');
    markTitleToc(el, '打开目录', '围城');
    markTitleToc(el, '打开目录', '围城');
    expect(el.getAttribute('role')).toBe('button');
    expect(isTitleToc(el)).toBe(true);
  });
});
