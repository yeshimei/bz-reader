import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DATA_DIR, dataDirOf, debugLogPath, debugOpenPath, setDataDir } from '../src/core/plugin-path';

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

  /* 2026-11-09 发版复核：调试日志与调试入口是同族文件，必须走同一个出口。
     以前日志路径在 plugin.ts 里裸拼，换数据目录或加清理规则时容易漏掉它。 */
  it('调试日志也落在数据目录里', () => {
    expect(debugLogPath()).toBe(`${DEFAULT_DATA_DIR}/debug.json`);
  });

  it('换数据目录时调试日志一起走', () => {
    setDataDir('我的数据');
    expect(debugLogPath()).toBe('我的数据/debug.json');
  });
});
