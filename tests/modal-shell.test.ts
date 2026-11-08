import { describe, expect, it } from 'vitest';
import { isDrawerClass, scrimClasses } from '../src/shell/render/modal-shell';

/**
 * 贴底抽屉的类名契约。
 *
 * 手机上的弹窗默认贴底；带输入框的以前会被 `has-input` 改成居中偏上。
 * 分类弹窗要「贴底 + 键盘避让」，靠的就是 `is-drawer` **同时**落在
 * 遮罩与卡片上——CSS 不能从卡片反选遮罩，漏一个这整套就不生效。
 */
describe('isDrawerClass', () => {
  it('类名列表里带 is-drawer 才算抽屉', () => {
    expect(isDrawerClass('is-drawer')).toBe(true);
    expect(isDrawerClass('tall is-drawer')).toBe(true);
    expect(isDrawerClass('tall')).toBe(false);
    expect(isDrawerClass('')).toBe(false);
  });
});

describe('scrimClasses', () => {
  it('抽屉弹窗：遮罩同时带 has-input 与 is-drawer', () => {
    expect(scrimClasses('', true, true)).toBe('bzs-scrim has-input is-drawer');
  });

  it('普通弹窗不凭空多类', () => {
    expect(scrimClasses('', false, false)).toBe('bzs-scrim');
  });

  it('带输入框但不贴底的弹窗保持原样（搜索 / 解锁 / 导入）', () => {
    expect(scrimClasses('', true, false)).toBe('bzs-scrim has-input');
  });

  it('遮罩自己的类（如文字面板）要保留，且不留空位', () => {
    expect(scrimClasses('bzs-text-scrim', false, false)).toBe('bzs-scrim bzs-text-scrim');
    expect(scrimClasses('', false, true)).toBe('bzs-scrim is-drawer');
  });
});
