import { describe, expect, it } from 'vitest';
import { keyboardInset, sheetLift } from '../src/shell/keyboard-inset';

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
