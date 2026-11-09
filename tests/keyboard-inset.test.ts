import { describe, expect, it } from 'vitest';
import {
  drawerLift,
  drawerLiftFor,
  keyboardHeightFromCss,
  keyboardInset,
  sheetLift,
} from '../src/shell/keyboard-inset';

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

/**
 * 双端判断：安卓 WebView 不缩窗口，靠抬高；iOS 的 Capacitor 往往已经把
 * WebView 缩到键盘上方，这时再抬一次就会把抽屉顶到屏幕上半截。
 * 判据是「当前窗口高是否明显小于键盘弹起前的窗口高」。
 */
describe('drawerLiftFor', () => {
  const base = 872;

  it('安卓：窗口没缩，抬宿主给的高度（哪怕 vv 只报半截）', () => {
    expect(
      drawerLiftFor({ innerHeight: 872, visualHeight: 725, hostHeight: 411, baseInnerHeight: base }),
    ).toBe(411);
  });

  it('安卓：宿主没给变量时退回视觉视口差值', () => {
    expect(
      drawerLiftFor({ innerHeight: 872, visualHeight: 461, hostHeight: 0, baseInnerHeight: base }),
    ).toBe(411);
  });

  it('iOS：窗口已被系统缩到键盘上方，不再抬', () => {
    expect(
      drawerLiftFor({ innerHeight: 461, visualHeight: 461, hostHeight: 411, baseInnerHeight: base }),
    ).toBe(0);
  });

  it('iOS：窗口没缩、只是视觉视口缩了，照常抬', () => {
    expect(
      drawerLiftFor({ innerHeight: 872, visualHeight: 461, hostHeight: 411, baseInnerHeight: base }),
    ).toBe(411);
  });

  it('键盘收起时归零', () => {
    expect(
      drawerLiftFor({ innerHeight: 872, visualHeight: 872, hostHeight: 0, baseInnerHeight: base }),
    ).toBe(0);
  });

  it('还不知道完整窗口高（首次打开）时按安卓口径不乱判缩窗', () => {
    expect(
      drawerLiftFor({ innerHeight: 461, visualHeight: 461, hostHeight: 411, baseInnerHeight: 0 }),
    ).toBe(411);
  });
});

/**
 * iOS 首次打开：键盘先被叫起，弹层画出来时窗口已经缩到键盘上方，
 * 而「缩窗前有多高」还没记下来（baseInnerHeight = 0）。
 *
 * 真机 2026-11-09 的「分类管理打不开」就卡在这里：旧判据把它当成
 * 「窗口没缩」→ 按宿主报的键盘高再抬一次 → 卡片高度被扣到只剩一条缝。
 * 新判据不靠基线：iOS 上窗口与视觉视口一样高，本身就说明系统已经让过位。
 */
describe('drawerLiftFor · iOS 已让位但还没有基线', () => {
  it('iOS：窗口与视觉视口等高，即便不知道基线也不抬', () => {
    expect(
      drawerLiftFor({ innerHeight: 461, visualHeight: 461, hostHeight: 411, baseInnerHeight: 0, ios: true }),
    ).toBe(0);
  });

  it('安卓：同样等高、宿主报了键盘高，照常抬（adjustPan 不缩视觉视口）', () => {
    expect(
      drawerLiftFor({ innerHeight: 872, visualHeight: 872, hostHeight: 411, baseInnerHeight: 0, ios: false }),
    ).toBe(411);
  });

  it('iOS：视觉视口明显更小，说明窗口没缩，照常抬', () => {
    expect(
      drawerLiftFor({ innerHeight: 872, visualHeight: 461, hostHeight: 411, baseInnerHeight: 0, ios: true }),
    ).toBe(411);
  });
});
