import { describe, expect, it } from 'vitest';
import { drawerLift, keyboardHeightFromCss, keyboardInset, sheetLift } from '../src/shell/keyboard-inset';

describe('keyboardInset', () => {
  it('没键盘时为 0', () => {
    expect(keyboardInset({ innerHeight: 800, visualHeight: 800 })).toBe(0);
  });

  it('键盘弹起时给出高度差', () => {
    expect(keyboardInset({ innerHeight: 800, visualHeight: 500 })).toBe(300);
  });

  it('小幅差值（地址栏收起）不算键盘', () => {
    expect(keyboardInset({ innerHeight: 800, visualHeight: 760 })).toBe(0);
  });

  it('非法输入不抛错', () => {
    expect(keyboardInset({ innerHeight: NaN, visualHeight: 500 })).toBe(0);
  });
});

describe('sheetLift', () => {
  it('没键盘不抬', () => {
    expect(sheetLift({ innerHeight: 800, visualHeight: 800 })).toBe(0);
  });

  it('抬起量 = 键盘高度', () => {
    expect(sheetLift({ innerHeight: 800, visualHeight: 500 })).toBe(300);
  });

  it('不超过可视高度 60%', () => {
    expect(sheetLift({ innerHeight: 900, visualHeight: 200 })).toBe(120);
  });
});

describe('drawerLift', () => {
  /* 真机 2026-11-09：分类抽屉只抬起键盘高度的三分之一，下半截还在键盘后面。
     两个原因——60% 上限，以及安卓键盘动画中途只发一次 resize。这里钉住上限这一条。 */
  it('抽屉要抬满整个键盘，不像小卡那样截到 60%', () => {
    expect(drawerLift({ innerHeight: 900, visualHeight: 200 })).toBe(700);
    expect(sheetLift({ innerHeight: 900, visualHeight: 200 })).toBe(120);
  });

  it('没键盘、或差值太小（地址栏收起）都不抬', () => {
    expect(drawerLift({ innerHeight: 800, visualHeight: 800 })).toBe(0);
    expect(drawerLift({ innerHeight: 800, visualHeight: 760 })).toBe(0);
  });
});

describe('keyboardHeightFromCss', () => {
  /* Obsidian 移动端把键盘高写在根元素的 --keyboard-height 上，自己的移动工具栏
     就靠它定位。visualViewport 在部分安卓 WebView 上只报一半，所以优先读这个。 */
  it('读带 px 的键盘高度', () => {
    expect(keyboardHeightFromCss('411px')).toBe(411);
  });

  it('键盘收起时是 0 或空', () => {
    expect(keyboardHeightFromCss('0px')).toBe(0);
    expect(keyboardHeightFromCss('')).toBe(0);
    expect(keyboardHeightFromCss('   ')).toBe(0);
  });

  it('脏值不抛错，一律当没有键盘', () => {
    expect(keyboardHeightFromCss('abc')).toBe(0);
    expect(keyboardHeightFromCss(undefined as unknown as string)).toBe(0);
    expect(keyboardHeightFromCss(null as unknown as string)).toBe(0);
  });

  it('小数四舍五入', () => {
    expect(keyboardHeightFromCss('411.6px')).toBe(412);
  });
});
