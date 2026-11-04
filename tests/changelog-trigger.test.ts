import { describe, expect, it, vi } from 'vitest';

/* 弹窗本体是 DOM 层，这里只关心「什么时候弹」：把打开入口换成探针。 */
const { openNote } = vi.hoisted(() => ({ openNote: vi.fn() }));
vi.mock('../src/shell/changelog-note', () => ({
  openChangelogNote: openNote,
  changelogNoteHtml: () => '',
  activeIndex: () => 0,
}));

import { CHANGELOG_RELEASES } from '../src/shell/changelog';
import { makeApp, makePlugin } from './helpers/plugin-harness';

/* ============================================================
 * 「第一次打开书库时弹更新日志」的接线
 *
 * 判据全在 planChangelog（已单独测），这里测插件真的照它做了：
 * 弹一次、先记账再弹、写不进盘就这次不弹（否则会每次启动都弹）。
 * ============================================================ */

function make(current = '0.1.2', seen = '0.1.1', freshInstall = false): any {
  const plugin = makePlugin(makeApp());
  plugin.manifest = { version: current };
  plugin.cfg.changelogSeenVersion = seen;
  plugin.freshInstall = freshInstall;
  plugin.saveData = vi.fn(async () => undefined);
  return plugin;
}

describe('升级后第一次进书库', () => {
  it('弹出更新日志，并把这一版记下来', async () => {
    openNote.mockClear();
    const plugin = make('0.1.2', '0.1.1');

    await plugin.maybeShowChangelog();

    expect(openNote).toHaveBeenCalledTimes(1);
    expect(openNote.mock.calls[0][0]).toBe(CHANGELOG_RELEASES);
    expect(openNote.mock.calls[0][1]).toBe('0.1.2');
    expect(plugin.cfg.changelogSeenVersion).toBe('0.1.2');
  });

  it('先记账、写成功才弹（写不进去就这次不弹，下次再试）', async () => {
    openNote.mockClear();
    const plugin = make('0.1.2', '0.1.1');
    plugin.saveData = vi.fn(async () => {
      throw new Error('disk full');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await plugin.maybeShowChangelog();
    expect(openNote).not.toHaveBeenCalled();

    /* 下次启动还是「升级过」的状态，可以重试；这次写成功了才弹 */
    plugin.saveData = vi.fn(async () => undefined);
    await plugin.maybeShowChangelog();
    expect(openNote).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('同一次会话再进书库不弹第二次（记录已经追上当前版本）', async () => {
    openNote.mockClear();
    const plugin = make('0.1.2', '0.1.1');
    await plugin.maybeShowChangelog();
    await plugin.maybeShowChangelog();
    expect(openNote).toHaveBeenCalledTimes(1);
  });
});

describe('不该弹的情况', () => {
  it('真新装：只记账，不弹（第一次用的人没经历过旧版）', async () => {
    openNote.mockClear();
    const plugin = make('0.1.2', '', true);

    await plugin.maybeShowChangelog();

    expect(openNote).not.toHaveBeenCalled();
    expect(plugin.cfg.changelogSeenVersion).toBe('0.1.2');
  });

  it('已经记过同一版：不弹、也不白写一次盘', async () => {
    openNote.mockClear();
    const plugin = make('0.1.2', '0.1.2');

    await plugin.maybeShowChangelog();

    expect(openNote).not.toHaveBeenCalled();
    expect(plugin.saveData).not.toHaveBeenCalled();
  });

  it('降级 / 回滚：不弹，但把记录改成当前版本', async () => {
    openNote.mockClear();
    const plugin = make('0.1.1', '0.2.0');

    await plugin.maybeShowChangelog();

    expect(openNote).not.toHaveBeenCalled();
    expect(plugin.cfg.changelogSeenVersion).toBe('0.1.1');
  });

  it('内置日志里没有这一版（发版漏加了）：不弹空窗，只记账', async () => {
    openNote.mockClear();
    const plugin = make('9.9.9', '0.1.1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await plugin.maybeShowChangelog();

    expect(openNote).not.toHaveBeenCalled();
    expect(plugin.cfg.changelogSeenVersion).toBe('9.9.9');
    warn.mockRestore();
  });

  it('拿不到当前版本：什么都不做', async () => {
    openNote.mockClear();
    const plugin = make('', '0.1.1');

    await plugin.maybeShowChangelog();

    expect(openNote).not.toHaveBeenCalled();
    expect(plugin.saveData).not.toHaveBeenCalled();
  });
});

