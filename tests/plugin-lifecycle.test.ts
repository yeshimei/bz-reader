import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHELL_STATE, getState, setState, subscribe } from '../src/shell/state';
import { setShellSource } from '../src/shell/source';
import { resetUiState } from '../src/shell/actions';
import { DEFAULT_DATA_DIR, dataDirOf, setDataDir } from '../src/core/plugin-path';
import { VIEW_TYPE_READER } from '../src/view/reader-view';
import { VIEW_TYPE_STUDY } from '../src/shell/study-view';
import { VIEW_TYPE_TOC } from '../src/view/side-view';
import { FakeAdapter } from './helpers/fake-adapter';
import { makeApp, makeLeaf, makePlugin, makeReaderView, testBook } from './helpers/plugin-harness';

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
});

describe('插件卸载（A-11）', () => {
  it('只对 ReaderView 实例调 forceClose；其它 leaf 照样 detach', () => {
    const app = makeApp();
    const plugin = makePlugin(app);
    const { view } = makeReaderView(app, 'b1');
    const close = vi.spyOn(view, 'forceClose').mockResolvedValue(undefined);
    const readerLeaf = { view, detach: vi.fn() };
    const otherClose = vi.fn();
    const otherLeaf = { view: { forceClose: otherClose }, detach: vi.fn() };
    app.workspace.getLeavesOfType = (type: string) =>
      (type === VIEW_TYPE_READER ? [readerLeaf, otherLeaf] : []) as never;

    plugin.onunload();

    expect(close).toHaveBeenCalledTimes(1);
    expect(otherClose).not.toHaveBeenCalled();
    expect(readerLeaf.detach).toHaveBeenCalledTimes(1);
    expect(otherLeaf.detach).toHaveBeenCalledTimes(1);
  });

  it('清理中途抛错也把全局收尾走完（try/finally）', () => {
    const app = makeApp();
    const plugin = makePlugin(app);
    plugin.store.destroy = vi.fn(async () => undefined);
    plugin.flushCfg = vi.fn(async () => undefined);
    plugin.overlay = {
      destroy: () => {
        throw new Error('overlay boom');
      },
    };

    expect(() => plugin.onunload()).toThrow('overlay boom');
    expect(plugin.store.destroy).toHaveBeenCalledTimes(1);
    expect(plugin.flushCfg).toHaveBeenCalledTimes(1);
  });

  it('每个 leaf 先收视图再 detach，视图收尾抛错也不把 leaf 留在工作区', () => {
    const app = makeApp();
    const plugin = makePlugin(app);
    const { view } = makeReaderView(app, 'b1');
    vi.spyOn(view, 'forceClose').mockImplementation(() => {
      throw new Error('close boom');
    });
    const leaf = { view, detach: vi.fn() };
    app.workspace.getLeavesOfType = (type: string) => (type === VIEW_TYPE_READER ? [leaf] : []) as never;

    expect(() => plugin.onunload()).toThrow('close boom');
    expect(leaf.detach).toHaveBeenCalledTimes(1);
    expect(plugin.flushCfg).toHaveBeenCalledTimes(1);
  });
});

describe('改排版偏好（A-11）', () => {
  it('只对 ReaderView 调 updatePrefs，deferred / 占位视图不碰', () => {
    const app = makeApp();
    const plugin = makePlugin(app);
    const a = makeReaderView(app, 'b1');
    const b = makeReaderView(app, 'b2');
    const updateA = vi.spyOn(a.view, 'updatePrefs').mockImplementation(() => undefined);
    const updateB = vi.spyOn(b.view, 'updatePrefs').mockImplementation(() => undefined);
    const placeholder = { updatePrefs: vi.fn() };
    app.workspace.getLeavesOfType = () =>
      [{ view: a.view }, { view: placeholder }, { view: b.view }] as never;

    plugin.setPrefs({ fontSize: 23 });

    expect(updateA).toHaveBeenCalledTimes(1);
    expect(updateB).toHaveBeenCalledTimes(1);
    expect(placeholder.updatePrefs).not.toHaveBeenCalled();
    expect((plugin.store.get().prefs as { fontSize: number }).fontSize).toBe(23);
  });

  it('写盘失败也要广播（notifyShell 在 finally 里）', () => {
    const app = makeApp();
    const plugin = makePlugin(app);
    const listener = vi.fn();
    const off = subscribe(listener);
    plugin.store.touch = () => {
      throw new Error('touch boom');
    };

    expect(() => plugin.setPrefs({ fontSize: 24 })).toThrow('touch boom');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });
});

describe('复用延迟加载的 leaf（A-11）', () => {
  it('openStudy：DeferredView 是书架类型时复用该 leaf，不 detach 重建', async () => {
    const app = makeApp();
    const plugin = makePlugin(app);
    const leaf = makeLeaf({ getViewType: () => VIEW_TYPE_STUDY });
    const reveal = vi.fn(async () => undefined);
    app.workspace.getLeavesOfType = (type: string) =>
      (type === VIEW_TYPE_STUDY ? [leaf] : []) as never;
    app.workspace.revealLeaf = reveal;
    const detach = vi.spyOn(leaf, 'detach');

    plugin.openStudy('notes');

    expect(detach).not.toHaveBeenCalled();
    expect(leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_STUDY, active: true });
    await vi.waitFor(() => expect(reveal).toHaveBeenCalledWith(leaf));
  });

  it('openStudy：别的类型的旧视图仍然 detach，再开新 leaf', () => {
    const app = makeApp();
    const plugin = makePlugin(app);
    const stale = makeLeaf({ getViewType: () => 'some-other-view' });
    const fresh = makeLeaf(null);
    app.workspace.getLeavesOfType = () => [stale] as never;
    app.workspace.getLeaf = () => fresh as never;
    const detach = vi.spyOn(stale, 'detach');

    plugin.openStudy('library');

    expect(detach).toHaveBeenCalledTimes(1);
    expect(fresh.setViewState).toHaveBeenCalledWith(
      expect.objectContaining({ type: VIEW_TYPE_STUDY, active: true }),
    );
  });

  it('openTocSidebar：目录类型的 DeferredView 复用，不 detach', () => {
    const app = makeApp();
    const plugin = makePlugin(app);
    const leaf = makeLeaf({ getViewType: () => VIEW_TYPE_TOC });
    const expand = vi.fn();
    app.workspace.getLeavesOfType = (type: string) => (type === VIEW_TYPE_TOC ? [leaf] : []) as never;
    app.workspace.leftSplit = { expand };
    const detach = vi.spyOn(leaf, 'detach');

    plugin.openTocSidebar('highlights');

    expect(detach).not.toHaveBeenCalled();
    expect(leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_TOC, active: true });
    expect(expand).toHaveBeenCalled();
  });
});

describe('activeReader（A-25）', () => {
  it('活动视图优先', () => {
    const app = makeApp();
    const plugin = makePlugin(app);
    const a = makeReaderView(app, 'b1');
    const b = makeReaderView(app, 'b2');
    app.workspace.getLeavesOfType = () => [{ view: a.view }, { view: b.view }] as never;
    app.workspace.getActiveViewOfType = () => b.view as never;
    setState({ activeReaderId: 'b1' });
    expect(plugin.activeReader()).toBe(b.view);
  });

  it('没有活动阅读视图时按 activeReaderId 找 currentBookId 匹配的 leaf', () => {
    const app = makeApp();
    const plugin = makePlugin(app);
    const a = makeReaderView(app, 'b1');
    const b = makeReaderView(app, 'b2');
    app.workspace.getLeavesOfType = () => [{ view: a.view }, { view: b.view }] as never;
    app.workspace.getActiveViewOfType = () => null;
    setState({ activeReaderId: 'b2' });
    expect(plugin.activeReader()).toBe(b.view);
  });

  it('activeReaderId 过期时回退到第一个 ReaderView 实例', () => {
    const app = makeApp();
    const plugin = makePlugin(app);
    const a = makeReaderView(app, 'b1');
    const b = makeReaderView(app, 'b2');
    app.workspace.getLeavesOfType = () => [{ view: a.view }, { view: b.view }] as never;
    app.workspace.getActiveViewOfType = () => null;
    setState({ activeReaderId: 'missing' });
    expect(plugin.activeReader()).toBe(a.view);
  });

  it('没有阅读视图时返回 null，不把别的视图强转成 ReaderView', () => {
    const app = makeApp();
    const plugin = makePlugin(app);
    app.workspace.getLeavesOfType = () => [{ view: { getViewType: () => 'x' } }] as never;
    app.workspace.getActiveViewOfType = () => ({ getViewType: () => VIEW_TYPE_READER }) as never;
    expect(plugin.activeReader()).toBeNull();
  });
});

describe('数据目录找回（A-30）', () => {
  it('多个候选时选书最多的那个，不盲选第一个', async () => {
    const adapter = new FakeAdapter();
    setDataDir(DEFAULT_DATA_DIR);
    await adapter.write(
      '旧库/bz-reader.json',
      JSON.stringify({ version: 1, books: [testBook('a')] }),
    );
    await adapter.write(
      '主库/bz-reader.json',
      JSON.stringify({ version: 1, books: [testBook('a'), testBook('b'), testBook('c')] }),
    );
    const app = makeApp({ adapter });
    const plugin = makePlugin(app);
    plugin.cfg = { ...plugin.cfg, dataDir: DEFAULT_DATA_DIR };

    await plugin.resolveDataDir();

    expect(dataDirOf()).toBe('主库');
    expect(plugin.cfg.dataDir).toBe('主库');
  });

  it('书数并列时取数据文件更新的那个', async () => {
    const adapter = new FakeAdapter();
    setDataDir(DEFAULT_DATA_DIR);
    await adapter.write('旧库/bz-reader.json', JSON.stringify({ version: 1, books: [testBook('a')] }));
    await adapter.write('新库/bz-reader.json', JSON.stringify({ version: 1, books: [testBook('b')] }));
    const app = makeApp({ adapter });
    const plugin = makePlugin(app);

    await plugin.resolveDataDir();

    expect(dataDirOf()).toBe('新库');
  });

  it('书数与 mtime 都并列时不写指针，留给设置页', async () => {
    const adapter = new FakeAdapter();
    setDataDir(DEFAULT_DATA_DIR);
    await adapter.write('甲库/bz-reader.json', JSON.stringify({ version: 1, books: [testBook('a')] }));
    await adapter.write('乙库/bz-reader.json', JSON.stringify({ version: 1, books: [testBook('b')] }));
    adapter.mtimes.set('甲库/bz-reader.json', 7);
    adapter.mtimes.set('乙库/bz-reader.json', 7);
    const app = makeApp({ adapter });
    const plugin = makePlugin(app);

    await plugin.resolveDataDir();

    expect(dataDirOf()).toBe(DEFAULT_DATA_DIR);
    expect(plugin.cfg.dataDir).toBe(DEFAULT_DATA_DIR);
  });
});

describe('调试开书入口（A-11 · debug 门控）', () => {
  it('debug 日志没开时连文件都不读，更不会替你开书', async () => {
    const adapter = new FakeAdapter();
    const app = makeApp({ adapter });
    const plugin = makePlugin(app);
    const path = '.obsidian/plugins/bz-reader/storage/debug-open.json';
    await adapter.write(path, JSON.stringify({ command: 'open' }));
    const openStudy = vi.spyOn(plugin, 'openStudy');

    await plugin.autoOpenIfRequested();

    expect(openStudy).not.toHaveBeenCalled();
    expect(adapter.files.has(path)).toBe(true);
  });
});

describe('壳层状态复位（A-23）', () => {
  it('收藏 / 分组从业务数据回灌，目标写回业务数据', () => {
    const books = [testBook('a'), { ...testBook('b'), favorite: true, shelf: '技术' }];
    const goals: number[] = [];
    setShellSource({
      repo: { all: () => books },
      setGoal: (n: number) => goals.push(n),
    } as never);
    setState({
      favIds: ['a'],
      shelves: { a: '旧分组' },
      goal: 35,
      libKw: '筛过',
      libFilter: 'done',
      studyPage: 'notes',
      bookId: 'a',
    });

    resetUiState();
    const s = getState();

    expect(s.studyPage).toBe('library');
    expect(s.libKw).toBe('');
    expect(s.libFilter).toBe('all');
    expect(s.bookId).toBe('a');
    expect(s.goal).toBe(20);
    expect(goals).toEqual([20]);
    expect(s.favIds).toEqual(['b']);
    expect(s.shelves).toEqual({ b: '技术' });
    setShellSource(null);
  });
});
