import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* 分页器 vendor 补丁的守卫，不是行为测试。
 *
 * 为什么只能这样测：这段逻辑在 foliate 的 paginator.js 里，依赖 shadow DOM、
 * iframe 文档和真实布局，仓库没装 jsdom，跑不起来；但它确实是「拖选择手柄
 * 越界就把整页翻走」的唯一源头（2026-11-08 安卓真机录屏复现：向上拖起点手柄，
 * 约 0.7 秒后跳上一页；向下拖终点手柄则跳下一页）。
 *
 * 守住三件事：
 *   1. 拖选越界自动翻页只认鼠标指针——触摸（含选择手柄拖动）不参与；
 *   2. 指针取消能把开关复位——安卓长按选字拿到的是 pointercancel 而不是
 *      pointerup，不复位的话开关会一直挂在真上；
 *   3. 移动端拖选时页面完全不动——浏览器会把选区 scrollIntoView 到横向容器，
 *      整页横移半屏、右边露出下一列（2026-11-08 安卓截图：左边每行少一个字，
 *      右侧一条竖排单字就是下一列每行的第一个字）。
 *
 * 升级 foliate 或重装依赖把补丁冲掉时，这几条会先红。 */
const PAGINATOR = new URL('../node_modules/foliate-js/paginator.js', import.meta.url);
const src = readFileSync(PAGINATOR, 'utf8');

describe('foliate paginator 补丁', () => {
  it('触摸与触控笔不参与拖选越界自动翻页', () => {
    expect(src).toContain("e.pointerType !== 'touch'");
    expect(src).toContain("e.pointerType !== 'pen'");
    expect(src).not.toContain("doc.addEventListener('pointerdown', () => isPointerSelecting = true)");
  });

  it('pointercancel 复位选择开关', () => {
    expect(src).toContain("doc.addEventListener('pointercancel', () => isPointerSelecting = false)");
  });

  it('移动端拖选把横向容器吸回整页', () => {
    expect(src).toContain("(pointer: coarse)");
    expect(src).toContain('this.containerPosition = snapped');
  });
});
