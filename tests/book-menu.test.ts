import { describe, expect, it } from 'vitest';
import { bookMenuItems } from '../src/shell/book-menu';

/**
 * 书卡右键 / 长按菜单（S2 定稿）。
 *
 * 菜单外壳是 Obsidian 原生 Menu，这里只钉条目、顺序、图标与禁用条件。
 * 条目顺序即使用频次，管理类动作沉底并隔开。
 */

const plain = { done: false, fav: false };

describe('bookMenuItems · 加入复习入口常显', () => {
  /* 2026-11-21：没装 / 没启用 bz Review 时也保留这一条。
     点了会打开设置页的插件组引导安装，而不是摆一个点了没反应的项。 */
  it('没装 Review 时「加入复习」仍在', () => {
    expect(bookMenuItems(plain).map((i) => i.act)).toContain('review');
  });
  it('「加入复习」紧跟书籍详情', () => {
    const acts = bookMenuItems({ ...plain, review: true }).map((i) => i.act);
    expect(acts).toContain('review');
    expect(acts.indexOf('review')).toBe(acts.indexOf('detail') + 1);
  });
  it('归档书菜单不摆「加入复习」：归档书没有可挑的内容', () => {
    const acts = bookMenuItems({ ...plain, archived: true }).map((i) => i.act);
    expect(acts).not.toContain('review');
  });
});

describe('bookMenuItems · 条目与顺序', () => {
  it('十条都在，顺序是 阅读 / 详情 / 加入复习 / 补全信息 / 导出 / 收藏 / 标为读完 / 编辑信息 / 归入分类 / 移出书架', () => {
    expect(bookMenuItems(plain).map((i) => i.title)).toEqual([
      '阅读',
      '书籍详情',
      '加入复习',
      '补全信息（AI）',
      '导出这本书',
      '收藏',
      '标为读完',
      '编辑信息',
      '归入分类…',
      '移出书架',
    ]);
  });

  /* 导出紧跟在「补全信息」后面：它和详情一样是「看这本书产出什么」，
     不该沉到底部管理组，也不该插进收藏/读完这种状态开关中间。
     2026-11-11 补全信息插在详情与导出之间：它补的是详情页那几个空字段。
     2026-11-21 加入复习插在详情与补全之间（紧跟着「这本书是什么」）。 */
  it('导出排在补全信息之后、收藏之前，且不带分隔线', () => {
    const list = bookMenuItems(plain);
    const acts = list.map((i) => i.act);
    expect(acts.indexOf('review')).toBe(acts.indexOf('detail') + 1);
    expect(acts.indexOf('enrich')).toBe(acts.indexOf('review') + 1);
    expect(acts.indexOf('export')).toBe(acts.indexOf('enrich') + 1);
    expect(acts.indexOf('export')).toBeLessThan(acts.indexOf('fav'));
    expect(list.find((i) => i.act === 'export')?.sepBefore).toBeFalsy();
  });

  /* 归类是「整理书架」的动作，和改名同一组：它不该插到阅读/收藏这些
     高频项中间，也不该和「移出书架」混在一起（那道线是「要动书架」的分界）。 */
  it('归入分类与编辑信息同组，分隔线位置不变', () => {
    const seps = bookMenuItems(plain).filter((i) => i.sepBefore).map((i) => i.act);
    expect(seps).toEqual(['editmeta', 'remove']);
  });

  it('归入分类排在编辑信息之后、移出书架之前', () => {
    const acts = bookMenuItems(plain).map((i) => i.act);
    expect(acts.indexOf('shelf')).toBe(acts.indexOf('editmeta') + 1);
    expect(acts.indexOf('shelf')).toBe(acts.indexOf('remove') - 1);
  });

  it('编辑信息与移出书架前各有一道分隔线', () => {
    const seps = bookMenuItems(plain).filter((i) => i.sepBefore);
    expect(seps.map((i) => i.title)).toEqual(['编辑信息', '移出书架']);
  });

  it('移出书架不是危险项：它只归档，数据全留、可复活', () => {
    expect(bookMenuItems(plain).find((i) => i.act === 'remove')?.danger).toBeFalsy();
  });

  it('每条都有自己的图标', () => {
    const icons = bookMenuItems(plain).map((i) => i.icon);
    expect(icons).toEqual([
      'book-open',
      'info',
      'layers',
      'sparkles',
      'download',
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

describe('bookMenuItems · 归档书', () => {
  /* 2026-11-25：归档书的删除项直接进「彻底删除」确认框。
     以前这项叫「移除记录」，点开弹的却是「移出书架」——对一本已经在归档里
     的书是一层空转页；而且那个弹层只在在架书里找记录，打开就显示
     「这本书已不在书库」，彻底删除根本走不到。 */
  it('删除项是「彻底删除…」，直接对这本书发起彻底删除', () => {
    const item = bookMenuItems({ ...plain, archived: true }).find((i) => i.act === 'purge');
    expect(item?.title).toBe('彻底删除…');
    expect(item?.danger).toBe(true);
    expect(item?.sepBefore).toBe(true);
  });

  it('归档书菜单不再摆「移出书架 / 移除记录」那一项', () => {
    const acts = bookMenuItems({ ...plain, archived: true }).map((i) => i.act);
    expect(acts).not.toContain('remove');
  });

  it('恢复到书架仍在第一位：删除是最后手段', () => {
    const acts = bookMenuItems({ ...plain, archived: true }).map((i) => i.act);
    expect(acts[0]).toBe('restore');
    expect(acts[acts.length - 1]).toBe('purge');
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
