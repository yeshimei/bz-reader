import { describe, expect, it } from 'vitest';
import { bookMenuItems } from '../src/shell/book-menu';

/**
 * 书卡右键 / 长按菜单（S2 定稿）。
 *
 * 菜单外壳是 Obsidian 原生 Menu，这里只钉条目、顺序、图标与禁用条件。
 * 条目顺序即使用频次，管理类动作沉底并隔开。
 */

const plain = { done: false, fav: false };

describe('bookMenuItems · 条目与顺序', () => {
  it('十条都在，顺序是 阅读 / 详情 / 补全信息 / 导出 / 加入复习计划 / 收藏 / 标为读完 / 改名 / 归入分类 / 移出书架', () => {
    expect(bookMenuItems(plain).map((i) => i.title)).toEqual([
      '阅读',
      '书籍详情',
      '补全信息（AI）',
      '导出这本书',
      '加入复习计划',
      '收藏',
      '标为读完',
      '改名',
      '归入分类…',
      '移出书架',
    ]);
  });

  /* 导出紧跟在「书籍详情」后面：它和详情一样是「看这本书产出什么」，
     不该沉到底部管理组，也不该插进收藏/读完这种状态开关中间。
     复习（2026-11-11）同理，紧跟导出——两者都是「把划线搬出去」。
     2026-11-11 补全信息插在详情与导出之间：它补的是详情页那几个空字段。 */
  it('导出排在详情之后、收藏之前，且不带分隔线', () => {
    const list = bookMenuItems(plain);
    const acts = list.map((i) => i.act);
    expect(acts.indexOf('enrich')).toBe(acts.indexOf('detail') + 1);
    expect(acts.indexOf('export')).toBe(acts.indexOf('enrich') + 1);
    expect(acts.indexOf('review')).toBe(acts.indexOf('export') + 1);
    /* 复习与导出之间不插状态开关，最终都落在收藏前面 */
    expect(acts.indexOf('review')).toBeLessThan(acts.indexOf('fav'));
    expect(list.find((i) => i.act === 'export')?.sepBefore).toBeFalsy();
    expect(list.find((i) => i.act === 'review')?.sepBefore).toBeFalsy();
  });

  /* 归类是「整理书架」的动作，和改名同一组：它不该插到阅读/收藏这些
     高频项中间，也不该和「移出书架」混在一起（那道线是「要动书架」的分界）。 */
  it('归入分类与改名同组，分隔线位置不变', () => {
    const seps = bookMenuItems(plain).filter((i) => i.sepBefore).map((i) => i.act);
    expect(seps).toEqual(['rename', 'remove']);
  });

  it('归入分类排在改名之后、移出书架之前', () => {
    const acts = bookMenuItems(plain).map((i) => i.act);
    expect(acts.indexOf('shelf')).toBe(acts.indexOf('rename') + 1);
    expect(acts.indexOf('shelf')).toBe(acts.indexOf('remove') - 1);
  });

  it('改名与移出书架前各有一道分隔线', () => {
    const seps = bookMenuItems(plain).filter((i) => i.sepBefore);
    expect(seps.map((i) => i.title)).toEqual(['改名', '移出书架']);
  });

  it('移出书架不是危险项：它只归档，数据全留、可复活', () => {
    expect(bookMenuItems(plain).find((i) => i.act === 'remove')?.danger).toBeFalsy();
  });

  it('每条都有自己的图标', () => {
    const icons = bookMenuItems(plain).map((i) => i.icon);
    expect(icons).toEqual([
      'book-open',
      'info',
      'sparkles',
      'download',
      'rotate-ccw',
      'star',
      'check',
      'pencil',
      'folder',
      'trash',
    ]);
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

  it('多一条「重新定位文件…」，其余项照旧可用', () => {
    const list = bookMenuItems({ ...plain, missing: true });
    expect(list.find((i) => i.act === 'relocate')?.title).toBe('重新定位文件…');
    expect(list.filter((i) => i.disabled).map((i) => i.act)).toEqual(['open']);
    expect(list).toHaveLength(11);
  });

  /* 书文件丢了，摘录和书签还在本机：导出不该跟着禁用 */
  it('文件丢失时「导出这本书」仍可点', () => {
    const list = bookMenuItems({ ...plain, missing: true });
    const ex = list.find((i) => i.act === 'export');
    expect(ex?.disabled).toBeFalsy();
    expect(ex?.title).toBe('导出这本书');
  });
});
