import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Platform } from 'obsidian';
import { installDomStub } from './helpers/dom-stub';
import { buildChapterCSS } from '../src/engine/theme';
import { DEFAULT_PREFS } from '../src/data/prefs';

/**
 * 2026-11-27 真机反馈：移动端「上方一大片空白」，只有带章节标题的书（含
 * 剪藏成书）出现，且与「双栏」设置同时存在。
 *
 * 真机 CDP 实测：`column-span: all` 让 h1 横跨了分页器横向溢出的**所有列**
 * （几十万像素宽），于是每一列都被标题占掉 321px，正文只能从 y=321 开始、
 * 每列只剩 186px——表现就是上方整片空白、一页只排几行。
 *
 * 手机竖屏实际只有一栏（分页器 portrait 强制单栏），`column-span` 没有任何
 * 好处，只有副作用；桌面双栏时容器真的有两栏，保留原行为。
 */
let restore: () => void = () => undefined;
beforeAll(() => {
  restore = installDomStub();
});
afterAll(() => restore());

function cssFor(mobile: boolean, columns: number): string {
  Platform.isMobile = mobile;
  Platform.isDesktop = !mobile;
  try {
    return buildChapterCSS({ ...DEFAULT_PREFS, columns: columns as 1 | 2 });
  } finally {
    Platform.isMobile = false;
    Platform.isDesktop = true;
  }
}

describe('h1 column-span', () => {
  it('手机双栏设置下不给标题加 column-span（竖屏实际单栏）', () => {
    const css = cssFor(true, 2);
    expect(css).not.toContain('column-span');
  });

  it('桌面双栏仍然横跨两栏', () => {
    const css = cssFor(false, 2);
    expect(css).toContain('column-span: all');
  });

  it('任何端的单栏都不加', () => {
    expect(cssFor(true, 1)).not.toContain('column-span');
    expect(cssFor(false, 1)).not.toContain('column-span');
  });
});
