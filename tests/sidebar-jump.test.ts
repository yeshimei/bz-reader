import { describe, expect, it } from 'vitest';
import { shouldCollapseSidebar } from '../src/shell/sidebar-jump';

/**
 * 手机上从侧栏跳转之后要不要收抽屉。
 *
 * 三个条件缺一不可：
 *   1. 真机移动端——桌面侧栏常驻是正常形态，收起来反而多一次点开；
 *   2. 这一下点的是**侧栏里**的行——全书鸟瞰弹层里有同款章节行，不能点完把侧栏收掉；
 *   3. 跳转真的发生了——没找到章节、标注已被删时只弹一句提示，抽屉不该跟着动。
 */
describe('shouldCollapseSidebar', () => {
  it('手机 + 侧栏 + 真跳了：收', () => {
    expect(shouldCollapseSidebar({ mobile: true, fromSidebar: true, jumped: true })).toBe(true);
  });

  it('桌面：永远不收', () => {
    expect(shouldCollapseSidebar({ mobile: false, fromSidebar: true, jumped: true })).toBe(false);
  });

  it('不是从侧栏点的：不收（鸟瞰弹层同款行）', () => {
    expect(shouldCollapseSidebar({ mobile: true, fromSidebar: false, jumped: true })).toBe(false);
  });

  it('没跳成：不收', () => {
    expect(shouldCollapseSidebar({ mobile: true, fromSidebar: true, jumped: false })).toBe(false);
  });
});
