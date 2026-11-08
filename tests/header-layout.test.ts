import { describe, expect, it } from 'vitest';
import {
  isMoreButton,
  planHeaderVisibility,
  roleOf,
  type HeaderElLike,
} from '../src/view/header-layout';

/**
 * 头栏显隐规则。真机反馈：装了几个往头栏塞图标的插件之后，
 * 「该藏的没藏、三个点的 ⋮ 反倒没了」。
 *
 * 老实现的两条假设都不成立：
 *   1. 最右那颗就是 ⋮ —— 别人排在 ⋮ 后面时，真 ⋮ 被藏、别人被当成 ⋮ 留下；
 *   2. 名额先扣别人的 —— 别人藏不掉，自己的三颗被裁光。
 * 下面第 3、4 组就是这两条 bug 的复现断言。
 */

function fakeEl(opts: {
  classes?: string[];
  svg?: string | null;
  label?: string | null;
} = {}): HeaderElLike {
  const classes = new Set(opts.classes ?? []);
  return {
    classList: { contains: (c) => classes.has(c) },
    getAttribute: (n) => (n === 'aria-label' ? opts.label ?? null : null),
    querySelector: (sel) =>
      sel === 'svg' && opts.svg ? { classList: { contains: (c) => c === opts.svg } } : null,
  };
}

describe('roleOf：按身份分类，不按位置猜', () => {
  it('自己挂的按钮', () => {
    expect(roleOf(fakeEl({ classes: ['clickable-icon', 'bzr-action'] }))).toBe('ours');
  });

  it('宿主 ⋮：认图标名（lucide-more-vertical / ellipsis 两套命名都认）', () => {
    expect(roleOf(fakeEl({ classes: ['clickable-icon'], svg: 'lucide-more-vertical' }))).toBe('more');
    expect(roleOf(fakeEl({ classes: ['clickable-icon'], svg: 'lucide-ellipsis-vertical' }))).toBe('more');
    expect(roleOf(fakeEl({ classes: ['clickable-icon'], svg: 'lucide-more-horizontal' }))).toBe('more');
  });

  it('宿主 ⋮ 的第二判据：aria-label（图标名变了也认得出）', () => {
    expect(roleOf(fakeEl({ label: 'More options' }))).toBe('more');
    expect(roleOf(fakeEl({ label: 'Weitere Optionen' }))).toBe('more');
  });

  it('别人的图标（真机截图里的 home / layout-grid）算 other', () => {
    expect(roleOf(fakeEl({ classes: ['clickable-icon'], svg: 'lucide-home' }))).toBe('other');
    expect(roleOf(fakeEl({ classes: ['clickable-icon'], svg: 'lucide-layout-grid' }))).toBe('other');
  });

  it('普通图标不会被误认成 ⋮', () => {
    expect(isMoreButton(fakeEl({ svg: 'lucide-bookmark' }))).toBe(false);
    expect(isMoreButton(fakeEl({ svg: 'lucide-type' }))).toBe(false);
  });
});

describe('planHeaderVisibility：ours 有名额、⋮ 不占名额、other 一律收', () => {
  it('三颗自己 + 一颗 ⋮', () => {
    expect(planHeaderVisibility(['ours', 'ours', 'ours', 'more'], 3)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('⋮ 永远露着，哪怕它排在最后一位', () => {
    expect(planHeaderVisibility(['ours', 'ours', 'ours', 'more'], 3)[3]).toBe(true);
  });

  it('别人排在 ⋮ 后面时：⋮ 仍然露，别人收起来（真机那一版）', () => {
    const roles = ['ours', 'ours', 'ours', 'more', 'other', 'other'].map((r) => r as
      | 'ours'
      | 'more'
      | 'other');
    expect(planHeaderVisibility(roles, 3)).toEqual([true, true, true, true, false, false]);
  });

  it('别人排在 ⋮ 前面时也一样：别人收、⋮ 留', () => {
    const roles = ['other', 'other', 'ours', 'ours', 'ours', 'more'].map((r) => r as
      | 'ours'
      | 'more'
      | 'other');
    expect(planHeaderVisibility(roles, 3)).toEqual([false, false, true, true, true, true]);
  });

  it('超出名额的 ours 被裁掉，但不动 ⋮', () => {
    expect(planHeaderVisibility(['ours', 'ours', 'ours', 'ours', 'more'], 3)).toEqual([
      true,
      true,
      true,
      false,
      true,
    ]);
  });

  it('other 再多也不会把 ours 挤没（老实现的方向就是错的）', () => {
    const roles = ['other', 'other', 'other', 'other', 'ours', 'more'].map((r) => r as
      | 'ours'
      | 'more'
      | 'other');
    expect(planHeaderVisibility(roles, 3)).toEqual([false, false, false, false, true, true]);
  });

  it('认不出 ⋮ 时不动别人的图标（宁可多留，也不能把 ⋮ 藏掉）', () => {
    const roles = ['ours', 'other', 'other'].map((r) => r as 'ours' | 'more' | 'other');
    expect(planHeaderVisibility(roles, 3, false)).toEqual([true, true, true]);
  });
});
