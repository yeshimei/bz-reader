import { describe, expect, it } from 'vitest';
import { viewportSpan } from '../src/engine/range-text';

/* 2026-11-14 真机：站在第二页点朗读，它从第一页开头念。
   根因是「可见横区间」跟块矩形不在同一套坐标系里比——把 iframe 元素的
   `getBoundingClientRect()`（宽 = 整章 38577）当成可见宽，区间就成了整章。
   块矩形其实是**视口坐标**（当前一栏 0..632），于是第一页也「可见」。 */

describe('当前屏的横区间（iframe 视口坐标）', () => {
  it('从 0 到文档元素的渲染宽：分栏模式下就是当前这一栏', () => {
    expect(viewportSpan(632)).toEqual({ x0: 0, x1: 632 });
  });

  it('文档还没布局（宽不到 8）时不返回区间，别把整章都算成这一页', () => {
    expect(viewportSpan(0)).toBeNull();
    expect(viewportSpan(7)).toBeNull();
    expect(viewportSpan(7.9)).toBeNull();
  });

  it('窄屏也照返回，只要排过版', () => {
    expect(viewportSpan(320)).toEqual({ x0: 0, x1: 320 });
  });
});
