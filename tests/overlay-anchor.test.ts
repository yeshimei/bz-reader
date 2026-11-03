import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { anchoredStyle } from '../src/shell/anchored-style';

/**
 * 文字浮层贴哪儿 = 这个函数的输出。
 *
 * 回归目标：**没有锚点时不要悄悄贴到屏幕中间**（历史上想法卡就是这样
 * 和文字差出十万八千里），有锚点时必须真的贴着锚点，且不出可视区。
 */
let restore: () => void = () => undefined;
beforeAll(() => {
  restore = installDomStub();
});
afterAll(() => restore());

const vw = 390; // dom-stub 里的 window.innerWidth

describe('anchoredStyle', () => {
  it('没有锚点时退回顶部居中（明确的兜底，不是随机位置）', () => {
    const css = anchoredStyle(undefined);
    expect(css).toContain('left:50%');
    expect(css).toContain('top:72px');
    expect(css).toContain('translateX(-50%)');
  });

  it('锚点为空对象时也走兜底', () => {
    const css = anchoredStyle({ left: 0, top: 0 });
    expect(css).toContain('top:72px');
  });

  it('锚点在屏幕下半部 → 卡片贴它上方', () => {
    const css = anchoredStyle({ left: 200, top: 600 });
    expect(css).toContain('translate(-50%,-100%)');
    // 上方意味着 top 比锚点小
    const top = Number(/top:(-?\d+)px/.exec(css)?.[1]);
    expect(top).toBeLessThan(600);
  });

  it('锚点在屏幕上半部 → 卡片贴它下方', () => {
    const css = anchoredStyle({ left: 200, top: 120 });
    expect(css).toContain('translate(-50%,0)');
    const top = Number(/top:(-?\d+)px/.exec(css)?.[1]);
    expect(top).toBeGreaterThan(120);
  });

  it('靠左的锚点被夹住，卡片不越出左边界', () => {
    const css = anchoredStyle({ left: 4, top: 400 });
    const left = Number(/left:(-?\d+)px/.exec(css)?.[1]);
    expect(left).toBeGreaterThanOrEqual(100);
  });

  it('靠右的锚点被夹住，卡片不越出右边界', () => {
    const css = anchoredStyle({ left: vw - 4, top: 400 });
    const left = Number(/left:(-?\d+)px/.exec(css)?.[1]);
    expect(left).toBeLessThanOrEqual(vw - 100);
  });

  it('宽度不超过屏宽的 360 或视口内边距', () => {
    const css = anchoredStyle({ left: 200, top: 400 });
    const width = Number(/width:(\d+)px/.exec(css)?.[1]);
    expect(width).toBeLessThanOrEqual(360);
    expect(width).toBeLessThanOrEqual(vw - 24);
  });
});
