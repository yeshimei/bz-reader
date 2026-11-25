import { describe, expect, it } from 'vitest';
import {
  bookPathsFromTargets,
  confirmBodyKey,
  menuLabelKey,
  planShelfMenu,
  type ShelfMenuTarget,
} from '../src/core/shelf-file-menu';

/* ============================================================
 * 文件浏览器右键「加入书架 / 移除书架」（tests/shelf-file-menu.test.ts）
 *
 * 右键菜单走的是宿主原生入口，真机上不好反复摆文件；把「选了哪些条目 →
 * 该出哪条命令」「哪些路径进/出书架」这些判断抽成纯函数，在这里钉死。
 * ============================================================ */

const target = (path: string): ShelfMenuTarget => ({ path, isFolder: false });
const folder = (path: string): ShelfMenuTarget => ({ path, isFolder: true });

describe('bookPathsFromTargets（右键选中的条目 → 书文件路径）', () => {
  const vault = [
    'Books/三体.epub',
    'Books/童年.txt',
    'Books/子目录/活着.epub',
    'Books2/兄弟.epub',
    'Books/笔记.md',
    'Books/封面.png',
  ];

  it('单个书文件 → 只有它自己', () => {
    expect(bookPathsFromTargets([target('Books/三体.epub')], vault)).toEqual(['Books/三体.epub']);
  });

  it('非书格式（笔记 / 图片）→ 不出菜单，直接空', () => {
    expect(bookPathsFromTargets([target('Books/笔记.md')], vault)).toEqual([]);
    expect(bookPathsFromTargets([target('Books/封面.png')], vault)).toEqual([]);
  });

  it('文件夹 → 展开它下面所有书，含子目录，跳过笔记与图片', () => {
    expect(bookPathsFromTargets([folder('Books')], vault)).toEqual([
      'Books/三体.epub',
      'Books/童年.txt',
      'Books/子目录/活着.epub',
    ]);
  });

  it('文件夹按目录边界匹配：Books 不会把 Books2 的书收进来', () => {
    expect(bookPathsFromTargets([folder('Books')], vault)).not.toContain('Books2/兄弟.epub');
  });

  it('多选：文件夹 + 单文件合并，去重且稳定排序', () => {
    const got = bookPathsFromTargets(
      [target('Books/三体.epub'), folder('Books'), target('Books2/兄弟.epub')],
      vault,
    );
    expect(got).toEqual([
      'Books/三体.epub',
      'Books/童年.txt',
      'Books/子目录/活着.epub',
      'Books2/兄弟.epub',
    ]);
  });

  it('空文件夹 → 空，不让用户点一条什么也不做的命令', () => {
    expect(bookPathsFromTargets([folder('空目录')], vault)).toEqual([]);
  });
});

describe('planShelfMenu（路径 → 进/出书架的两组）', () => {
  const paths = ['Books/三体.epub', 'Books/童年.txt', 'Books/活着.epub'];

  it('一本都不在架 → 全部走加入', () => {
    const plan = planShelfMenu(paths, () => false);
    expect(plan.addPaths).toEqual(paths);
    expect(plan.removePaths).toEqual([]);
  });

  it('全部在架 → 全部走移除', () => {
    const plan = planShelfMenu(paths, () => true);
    expect(plan.addPaths).toEqual([]);
    expect(plan.removePaths).toEqual(paths);
  });

  it('混合 → 各走各的，互不影响', () => {
    const plan = planShelfMenu(paths, (p) => p === 'Books/三体.epub');
    expect(plan.addPaths).toEqual(['Books/童年.txt', 'Books/活着.epub']);
    expect(plan.removePaths).toEqual(['Books/三体.epub']);
  });

  it('空路径 → 两组都空，菜单不出现', () => {
    expect(planShelfMenu([], () => true)).toEqual({ addPaths: [], removePaths: [] });
  });
});

describe('菜单文案 key（数量切换，单条不带数字）', () => {
  it('一条加入 / 一条移除用短文案', () => {
    expect(menuLabelKey('add', 1)).toBe('filemenu.add');
    expect(menuLabelKey('remove', 1)).toBe('filemenu.remove');
  });

  it('多条带数量', () => {
    expect(menuLabelKey('add', 3)).toBe('filemenu.addN');
    expect(menuLabelKey('remove', 3)).toBe('filemenu.removeN');
  });

  it('二次确认正文按本数换文案', () => {
    expect(confirmBodyKey(1)).toBe('filemenu.confirmOne');
    expect(confirmBodyKey(4)).toBe('filemenu.confirmMany');
  });
});
