import { describe, expect, it } from 'vitest';
import { parseJumpInput, percentText } from '../src/view/jump-input';

describe('parseJumpInput · 百分比输入', () => {
  it('纯数字转成 0..1', () => {
    expect(parseJumpInput('0')).toBe(0);
    expect(parseJumpInput('35')).toBe(0.35);
    expect(parseJumpInput('100')).toBe(1);
    expect(parseJumpInput('12.5')).toBe(0.125);
  });

  it('带半角 / 全角百分号都认', () => {
    expect(parseJumpInput('35%')).toBe(0.35);
    expect(parseJumpInput('35％')).toBe(0.35);
    expect(parseJumpInput(' 35 % ')).toBe(0.35);
  });

  it('越界与非法输入返回 null', () => {
    expect(parseJumpInput('101')).toBeNull();
    expect(parseJumpInput('-5')).toBeNull();
    expect(parseJumpInput('abc')).toBeNull();
    expect(parseJumpInput('')).toBeNull();
    expect(parseJumpInput('   ')).toBeNull();
    expect(parseJumpInput('3.5.1')).toBeNull();
    expect(parseJumpInput('.5')).toBeNull();
  });

  it('不把科学计数法当数字', () => {
    expect(parseJumpInput('1e2')).toBeNull();
  });
});

describe('percentText · 输入框初值', () => {
  it('四舍五入到整数百分比', () => {
    expect(percentText(0)).toBe('0');
    expect(percentText(0.356)).toBe('36');
    expect(percentText(1)).toBe('100');
  });

  it('脏数据夹回 0..100', () => {
    expect(percentText(NaN)).toBe('0');
    expect(percentText(-1)).toBe('0');
    expect(percentText(2)).toBe('100');
  });
});
