import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA_DIR } from '../src/core/plugin-path';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { IMPORT_FOLDER } from '../src/data/importer';

/**
 * 库根只认一个容器：`bz-reader/`。三份东西各占一个子目录：
 *   storage/  插件私有数据（bz-reader.json + covers/）
 *   books/    用户导入的书
 *   notes/    导出的书摘（用户要在 Obsidian 里直接读、改、搜）
 *
 * 为什么不再叫 `bz 阅读/`：带空格。同步工具、命令行、URL 编码都会在空格上翻车，
 * 而且它和插件 id、仓库名、`.obsidian/plugins/bz-reader` 对不上。
 *
 * 三个名字一旦定下就别再动：Windows 文件系统不区分大小写，`Books/` → `books/`
 * 这种迁移在 Windows 上会静默失败或根本没动静。
 */
describe('目录约定：库根只有一个 bz-reader/', () => {
  it('数据目录是 bz-reader/storage', () => {
    expect(DEFAULT_DATA_DIR).toBe('bz-reader/storage');
  });

  it('导入目录与导出目录也在同一个容器下', () => {
    expect(DEFAULT_SETTINGS.importDir).toBe('bz-reader/books');
    expect(DEFAULT_SETTINGS.exportDir).toBe('bz-reader/notes');
  });

  it('导入模块的默认值不另写一份', () => {
    // 'Books' 曾经在两处各写一次（importer 的 IMPORT_FOLDER + settings 的默认值），
    // 改一处漏一处就是「导入进 A 目录、设置页显示 B 目录」。
    expect(IMPORT_FOLDER).toBe(DEFAULT_SETTINGS.importDir);
  });

  it('三者互不嵌套', () => {
    const dirs = [DEFAULT_DATA_DIR, DEFAULT_SETTINGS.importDir, DEFAULT_SETTINGS.exportDir];
    for (const a of dirs) {
      for (const b of dirs) {
        if (a === b) continue;
        // 导出的 .md 落进 books/ 会跟书混在一起；数据落进 notes/ 会被用户当笔记编辑。
        expect(a.startsWith(`${b}/`)).toBe(false);
      }
    }
  });

  it('每个默认目录都是合法的 vault 相对路径', () => {
    // 没有首尾斜杠（拼出来会变成 `//bz-reader/notes`），没有点开头的隐藏段
    //（normalizeDataDir / cleanDir 会把它拒掉，读用户设置时就悄悄变回默认值）。
    for (const dir of [DEFAULT_DATA_DIR, DEFAULT_SETTINGS.importDir, DEFAULT_SETTINGS.exportDir]) {
      expect(dir).not.toMatch(/^[\\/]|[\\/]$/);
      for (const seg of dir.split('/')) {
        expect(seg).not.toBe('');
        expect(seg.startsWith('.')).toBe(false);
      }
    }
  });
});
