import { describe, expect, it } from 'vitest';
import { centeredModal, isCenterClass, isDrawerClass, scrimClasses } from '../src/shell/render/modal-shell';

/**
 * 弹层落位的类名契约。
 *
 * 手机上的弹窗默认贴底；带输入框的会被 `has-input` 改成居中偏上。
 * 分类管理曾经要「贴底 + 键盘避让」，靠 `is-drawer` **同时**落在遮罩与
 * 卡片上——CSS 不能从卡片反选遮罩，漏一个这整套就不生效。
 *
 * 2026-11-09 之后分类管理改走居中档：iOS 上系统已经把窗口缩到键盘上方，
 * 再按键盘高度抬一次就会把卡片压成一条缝（真机上的「打不开」）。
 */
describe('isDrawerClass', () => {
  it('类名列表里带 is-drawer 才算抽屉', () => {
    expect(isDrawerClass('is-drawer')).toBe(true);
    expect(isDrawerClass('tall is-drawer')).toBe(true);
    expect(isDrawerClass('tall')).toBe(false);
    expect(isDrawerClass('')).toBe(false);
  });
});

describe('isCenterClass', () => {
  it('类名列表里带 is-center 才算居中档', () => {
    expect(isCenterClass('is-center')).toBe(true);
    expect(isCenterClass('wide is-center')).toBe(true);
    expect(isCenterClass('is-drawer')).toBe(false);
    expect(isCenterClass('')).toBe(false);
  });
});

describe('centeredModal', () => {
  /* 唯一出处在 modal-shell.ts：以后新增「手机上也居中」的弹层，
     改这一张表就够，不必去翻 CSS 猜哪张卡在屏幕中间。 */
  it('分类管理与想法全文走居中档', () => {
    expect(centeredModal('shelves')).toBe(true);
    expect(centeredModal('ideaall')).toBe(true);
  });

  it('搜索 / 解锁这类仍按原来的档位走', () => {
    for (const kind of ['search', 'unlock', 'detail', 'import', 'rename'] as const) {
      expect(centeredModal(kind)).toBe(false);
    }
    expect(centeredModal('')).toBe(false);
  });
});

describe('scrimClasses', () => {
  it('抽屉弹窗：遮罩同时带 has-input 与 is-drawer', () => {
    expect(scrimClasses('', true, true, false)).toBe('bzs-scrim has-input is-drawer');
  });

  it('居中弹窗：遮罩同时带 has-input 与 is-center', () => {
    expect(scrimClasses('', true, false, true)).toBe('bzs-scrim has-input is-center');
    expect(scrimClasses('', false, false, true)).toBe('bzs-scrim is-center');
  });

  it('普通弹窗不凭空多类', () => {
    expect(scrimClasses('', false, false, false)).toBe('bzs-scrim');
  });

  it('带输入框但不贴底的弹窗保持原样（搜索 / 解锁 / 导入）', () => {
    expect(scrimClasses('', true, false, false)).toBe('bzs-scrim has-input');
  });

  it('遮罩自己的类（如文字面板）要保留，且不留空位', () => {
    expect(scrimClasses('bzs-text-scrim', false, false, false)).toBe('bzs-scrim bzs-text-scrim');
    expect(scrimClasses('', false, true, false)).toBe('bzs-scrim is-drawer');
  });

  it('抽屉与居中不会同时出现', () => {
    expect(scrimClasses('', true, true, false)).not.toContain('is-center');
    expect(scrimClasses('', true, false, true)).not.toContain('is-drawer');
  });
});
