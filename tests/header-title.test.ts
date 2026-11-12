import { describe, expect, it } from 'vitest';
import { headTitleBox, headerTitleText } from '../src/view/header-title';

/**
 * 头栏那一行字（2026-11-12 用户要求）。
 *
 * 两件事：
 *   · 显示**当前章节名**，不是书名——书名在 tab、书架、侧栏都有；
 *   · 左缘对齐正文左缘。桌面正文居中排版，宿主把标题居中放在头栏里，
 *     和正文左缘差出一大截。
 *
 * 2026-11-12 换成自绘：宿主那条 `.is-focused … .view-header-title` 会在窗口
 * 聚焦时把颜色写回正常色（失焦灰、聚焦黑），索性收掉宿主标题、自己画一个。
 * 这里只测算术，rect 由 reader-view 量好传进来。
 */

describe('头栏标题：章节名优先', () => {
  it('有章节名就显示章节名', () => {
    expect(headerTitleText('围城', '第一章')).toBe('第一章');
    expect(headerTitleText('围城', '  第三章  ')).toBe('第三章');
  });

  it('章节名还没有（封面 / 目录 / 刚打开）时退回书名，别让头栏空着', () => {
    expect(headerTitleText('围城', '')).toBe('围城');
    expect(headerTitleText('围城', '   ')).toBe('围城');
    expect(headerTitleText('围城', undefined)).toBe('围城');
  });

  it('两者都没有时留空，不写「阅读」这种没有信息量的兜底词', () => {
    expect(headerTitleText(undefined, undefined)).toBe('');
    expect(headerTitleText('', '')).toBe('');
  });

  it('手机形态只显示书名：章节名再清楚也不换（2026-11-12 用户要求）', () => {
    expect(headerTitleText('围城', '第一章', 'mobile')).toBe('围城');
    expect(headerTitleText('围城', '', 'mobile')).toBe('围城');
    expect(headerTitleText(undefined, '第一章', 'mobile')).toBe('');
  });
});

describe('自绘标题的位置', () => {
  /* 头栏 328 → 1428，左侧按钮区到 396，动作区从 1400 开始 */
  const base = {
    headerLeft: 328,
    headerWidth: 1100,
    rootLeft: 328,
    contentLeft: 200,
    leftRegionRight: 396,
    actionsLeft: 1400,
    gap: 10,
  };

  it('左缘落在正文左缘上，右缘停在动作区左侧', () => {
    /* left = 328 - 328 + 200 = 200；right = 1428 - 1400 + 10 = 38 */
    expect(headTitleBox(base)).toEqual({ left: 200, right: 38 });
  });

  it('正文贴着阅读区左边时，停在左侧按钮区右侧，不压返回 / 前进', () => {
    /* target = 0 < minLeft = 396 - 328 + 10 = 78 */
    expect(headTitleBox({ ...base, contentLeft: 0 })).toEqual({ left: 78, right: 38 });
  });

  it('动作区还没建出来时，右缘只留空隙', () => {
    expect(headTitleBox({ ...base, actionsLeft: null })).toEqual({ left: 200, right: 10 });
  });

  it('头栏还没量出宽度（沉浸 / 换 tab）时不动', () => {
    expect(headTitleBox({ ...base, headerWidth: 0 })).toBeNull();
    expect(headTitleBox({ ...base, headerWidth: Number.NaN })).toBeNull();
  });

  it('量不到位图（NaN）时退回按钮区右侧，不写坏值', () => {
    expect(headTitleBox({ ...base, contentLeft: Number.NaN })).toEqual({ left: 78, right: 38 });
  });
});
