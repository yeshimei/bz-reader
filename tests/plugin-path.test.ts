import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DATA_DIR, dataDirOf, debugOpenPath, setDataDir } from '../src/core/plugin-path';

/**
 * 插件目录（`.obsidian/plugins/bz-reader/`）只留 Obsidian 自己的东西：
 * `main.js` / `manifest.json` / `styles.css` / `data.json`。
 * 插件不再往里写任何自有文件——以前 `debug-open.json` 落在
 * `<插件目录>/storage/` 下，用户重装插件时它跟着一起没了，而且那会儿
 * 谁都想不到一个"调试入口"会和代码住在一起。
 */
describe('插件目录不放自有文件', () => {
  afterEach(() => {
    setDataDir(DEFAULT_DATA_DIR);
  });

  it('调试入口落在数据目录里', () => {
    expect(debugOpenPath()).toBe(`${DEFAULT_DATA_DIR}/debug-open.json`);
  });

  it('换个数据目录，调试入口跟着走（不是钉死在插件目录）', () => {
    setDataDir('我的数据');
    expect(dataDirOf()).toBe('我的数据');
    expect(debugOpenPath()).toBe('我的数据/debug-open.json');
  });
});
