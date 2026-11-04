import { describe, expect, it } from 'vitest';
import { bookMenuItems } from '../src/shell/book-menu';

/**
 * 书卡右键 / 长按菜单（S2 定稿）。
 *
 * 菜单外壳是 Obsidian 原生 Menu，这里只钉条目、顺序、图标与禁用条件。
 * 条目顺序即使用频次，危险动作沉底并隔开。
 */

const plain = { done: false, fav: false };

describe('bookMenuItems · 条目与顺序', () => {
  it('七条都在，顺序是 阅读 / 详情 / 收藏 / 标为读完 / 改名 / 移除', () => {
    expect(bookMenuItems(plain).map((i) => i.title)).toEqual([
      '阅读',
      '书籍详情',
      '收藏',
      '标为读完',
      '改名',
      '移除书库',
    ]);
  });

  it('改名前有一道分隔线，且只有这一道', () => {
    const seps = bookMenuItems(plain).filter((i) => i.sepBefore);
    expect(seps.map((i) => i.title)).toEqual(['改名']);
  });

  it('移除书库是危险项', () => {
    expect(bookMenuItems(plain).find((i) => i.act === 'remove')?.danger).toBe(true);
  });

  it('每条都有自己的图标', () => {
    const icons = bookMenuItems(plain).map((i) => i.icon);
    expect(icons).toEqual(['book-open', 'info', 'star', 'check', 'pencil', 'trash']);
  });
});

describe('bookMenuItems · 状态互换', () => {
  it('已读完时是「标为在读」，图标换成 refresh', () => {
    const item = bookMenuItems({ done: true, fav: false }).find((i) => i.act === 'done');
    expect(item?.title).toBe('标为在读');
    expect(item?.icon).toBe('refresh');
  });

  it('已收藏时是「取消收藏」', () => {
    const item = bookMenuItems({ done: false, fav: true }).find((i) => i.act === 'fav');
    expect(item?.title).toBe('取消收藏');
  });

  it('两个状态可以同时成立', () => {
    const list = bookMenuItems({ done: true, fav: true });
    expect(list.find((i) => i.act === 'done')?.title).toBe('标为在读');
    expect(list.find((i) => i.act === 'fav')?.title).toBe('取消收藏');
  });
});

describe('bookMenuItems · 文件丢失', () => {
  it('「阅读」禁用但仍在菜单里', () => {
    const list = bookMenuItems({ ...plain, missing: true });
    const open = list.find((i) => i.act === 'open');
    expect(open).toBeTruthy();
    expect(open?.disabled).toBe(true);
    expect(open?.title).toBe('阅读');
  });

  it('其余项照旧可用（详情里才给原因与「重新定位文件」）', () => {
    const list = bookMenuItems({ ...plain, missing: true });
    expect(list.filter((i) => i.disabled).map((i) => i.act)).toEqual(['open']);
    expect(list).toHaveLength(6);
  });
});
