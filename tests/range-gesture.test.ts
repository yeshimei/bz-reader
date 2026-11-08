import { describe, expect, it } from 'vitest';
import {
  RANGE_GESTURE_SLOP,
  decideRangeGesture,
  rangeValueFromDrag,
  rangeValueFromPoint,
} from '../src/shell/range-gesture';

/* 移动端滑杆的触摸判定。
   背景：原生 input[type=range] 在触摸按下的瞬间就把值跳到触点位置。
   手机上想往下滚页面时，手指扫过滑轨就已经把字号/行距/页边距改了
   （2026-11-08 真机录屏复现）。现在改成「按下不表态，横向移出死区
   才算拖」，这几条钉住判定边界与换算。 */

describe('decideRangeGesture', () => {
  it('死区内不表态：按下瞬间绝不能改值', () => {
    expect(decideRangeGesture(0, 0)).toBe('pending');
    expect(decideRangeGesture(4, 5)).toBe('pending');
    expect(decideRangeGesture(-RANGE_GESTURE_SLOP, RANGE_GESTURE_SLOP)).toBe('pending');
  });

  it('横向移出死区才算拖滑块', () => {
    expect(decideRangeGesture(9, 3)).toBe('drag');
    expect(decideRangeGesture(-9, -2)).toBe('drag');
  });

  it('纵向为主就放行页面滚动', () => {
    expect(decideRangeGesture(2, -12)).toBe('scroll');
    expect(decideRangeGesture(-3, 30)).toBe('scroll');
  });

  it('斜着一半一半时优先滚动：宁可少改一次值', () => {
    expect(decideRangeGesture(12, 12)).toBe('scroll');
  });

  it('坐标不是有限数时不抢手势', () => {
    expect(decideRangeGesture(Number.NaN, 30)).toBe('pending');
    expect(decideRangeGesture(10, Number.POSITIVE_INFINITY)).toBe('pending');
  });
});

describe('rangeValueFromDrag', () => {
  it('按滑轨宽度线性换值', () => {
    expect(rangeValueFromDrag(18, 150, 300, 14, 30, 1)).toBe(26);
    expect(rangeValueFromDrag(18, -75, 300, 14, 30, 1)).toBe(14);
  });

  it('拖出两端夹在 min / max', () => {
    expect(rangeValueFromDrag(18, 9999, 300, 14, 30, 1)).toBe(30);
    expect(rangeValueFromDrag(18, -9999, 300, 14, 30, 1)).toBe(14);
  });

  it('按步长吸附，不留浮点尾巴', () => {
    expect(rangeValueFromDrag(1.4, 120, 300, 1.4, 2.4, 0.1)).toBe(1.8);
    expect(rangeValueFromDrag(8, 100, 300, 8, 120, 4)).toBe(44);
    expect(String(rangeValueFromDrag(1.4, 120, 300, 1.4, 2.4, 0.1))).not.toContain('0000000');
  });

  it('宽度拿不到时保持原值', () => {
    expect(rangeValueFromDrag(18, 40, 0, 14, 30, 1)).toBe(18);
    expect(rangeValueFromDrag(18, 40, Number.NaN, 14, 30, 1)).toBe(18);
  });
});

describe('rangeValueFromPoint', () => {
  it('点按位置线性映射到值', () => {
    expect(rangeValueFromPoint(0, 0, 300, 8, 120, 4)).toBe(8);
    expect(rangeValueFromPoint(150, 0, 300, 8, 120, 4)).toBe(64);
    expect(rangeValueFromPoint(300, 0, 300, 8, 120, 4)).toBe(120);
  });

  it('点在滑轨外夹回两端', () => {
    expect(rangeValueFromPoint(-50, 0, 300, 8, 120, 4)).toBe(8);
    expect(rangeValueFromPoint(900, 0, 300, 8, 120, 4)).toBe(120);
  });

  it('宽度为 0 时给出 null，让调用方保持原值', () => {
    expect(rangeValueFromPoint(100, 0, 0, 8, 120, 4)).toBeNull();
  });
});
