import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* 分页器 vendor 补丁的守卫，不是行为测试。
 *
 * 为什么只能这样测：这段逻辑在 foliate 的 paginator.js 里，依赖 shadow DOM、
 * iframe 文档和真实布局，仓库没装 jsdom，跑不起来；但它确实是「划词时页面
 * 乱跳」的唯一源头。
 *
 * 2026-11-08 定稿：**跨页选择完全禁止**。
 *   · 拖到页边不再自动翻页（上游的 checkPointerSelection 删掉，触摸/鼠标都不留）；
 *   · 移动端拖选时页面完全不动（浏览器会把选区 scrollIntoView 到横向容器，
 *     粗指针上有选区就吸回整页）。
 *
 * 升级 foliate 或重装依赖把补丁冲掉时，这几条会先红。 */
const PAGINATOR = new URL('../node_modules/foliate-js/paginator.js', import.meta.url);
const src = readFileSync(PAGINATOR, 'utf8');

describe('foliate paginator 补丁', () => {
  it('边缘自动翻页已经删干净', () => {
    expect(src).not.toContain('checkPointerSelection');
    expect(src).not.toContain('isPointerSelecting');
  });

  it('移动端拖选把横向容器吸回整页', () => {
    expect(src).toContain('(pointer: coarse)');
    expect(src).toContain('this.containerPosition = snapped');
  });
});
