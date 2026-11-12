/**
 * 插件 / 阅读视图测试的共用脚手架。
 *
 * 壳层与视图没有纯函数可抽的几处（onunload 收尾、activeReader、沉浸计数、
 * 并排失败清理）只能把类造出来测行为。`tests/helpers/obsidian-stub.ts` 里补了
 * ItemView / Plugin / Menu 的最小替身，这里再给一层「够用就行」的 app/store。
 *
 * 不模拟真实布局与 iframe：只构造到方法能跑、能看见调用为止。
 */
import type { App } from 'obsidian';
import { vi } from 'vitest';
import { createPlugin } from '../../src/plugin';
import { normalizePluginData } from '../../src/data/plugin-data';
import { ReaderView } from '../../src/view/reader-view';

export interface TestLeaf {
  view: unknown;
  app?: unknown;
  detach: ReturnType<typeof vi.fn>;
  setViewState: ReturnType<typeof vi.fn>;
}

export function makeLeaf(view: unknown = null): TestLeaf {
  return {
    view,
    detach: vi.fn(),
    setViewState: vi.fn(async () => undefined),
  };
}

export function makeWorkspace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activeLeaf: null,
    /* 生产代码先问这个（社区目录嫌 activeLeaf 弃用），替身跟着给一份：
       语义就是「最近激活的 leaf」，测试里等价于 activeLeaf。 */
    getMostRecentLeaf(this: Record<string, unknown>) {
      return this.activeLeaf ?? null;
    },
    getLeavesOfType: () => [],
    getActiveViewOfType: () => null,
    revealLeaf: async () => undefined,
    getLeaf: () => makeLeaf(),
    getLeftLeaf: () => makeLeaf(),
    leftSplit: { expand: () => undefined },
    on: () => ({ unsubscribe: () => undefined }),
    ...overrides,
  };
}

export function makeApp(overrides: { adapter?: unknown; workspace?: Record<string, unknown> } = {}): App {
  return {
    vault: { adapter: overrides.adapter ?? {}, configDir: '.obsidian' },
    workspace: makeWorkspace(overrides.workspace),
  } as unknown as App;
}

export interface TestStore {
  data: {
    version: 1;
    schemaVersion: 2;
    books: unknown[];
    prefs?: unknown;
    goal?: number;
  };
  get(): TestStore['data'];
  touch: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

export function makeStore(): TestStore {
  const store: TestStore = {
    data: { version: 1, schemaVersion: 2, books: [] },
    get: () => store.data,
    touch: vi.fn(),
    flush: vi.fn(async () => undefined),
    load: vi.fn(async () => store.data),
    destroy: vi.fn(async () => undefined),
  };
  return store;
}

/** 造一个插件实例并塞好最小依赖；不会跑 onload */
export function makePlugin(app: App): any {
  const Klass = createPlugin({ pro: true });
  const plugin = new Klass(app, { dir: '.obsidian/plugins/bz-reader' } as never) as any;
  plugin.cfg = normalizePluginData(null);
  plugin.store = makeStore();
  plugin.repo = {
    all: () => plugin.store.get().books,
    byId: (id: string) =>
      (plugin.store.get().books as Array<{ id: string }>).find((b) => b.id === id) ?? null,
  };
  plugin.flushCfg = vi.fn(async () => undefined);
  return plugin;
}

export interface ReaderHandle {
  view: ReaderView;
  api: {
    app: App;
    store: TestStore;
    repo: { all: () => unknown[]; byId: () => null };
    openShelf: () => void;
    openTocSidebar: () => void;
  };
  leaf: TestLeaf;
}

/**
 * 造一个阅读视图；bookId 直接写进私有字段（构造后不会自动挂载）。
 *
 * `storeData` 在构造前就写进 store：视图在构造函数里就会读偏好，
 * 建完再写就晚了（测「重启后读回哪一份版式」时尤其要注意）。
 */
export function makeReaderView(app: App, bookId = '', storeData: Record<string, unknown> = {}): ReaderHandle {
  const store = makeStore();
  Object.assign(store.data, storeData);
  const api = {
    app,
    store,
    repo: { all: () => [], byId: () => null },
    openShelf: () => undefined,
    openTocSidebar: () => undefined,
  };
  const leaf = makeLeaf();
  (leaf as { app?: unknown }).app = app;
  const view = new ReaderView(leaf as never, api as never);
  (view as unknown as { bookId: string }).bookId = bookId;
  return { view, api, leaf };
}

/** 把引擎换成一个只有收尾能力的空壳，避免视图测试真的去碰 iframe */
export function stubHost(view: ReaderView): void {
  (view as unknown as { host: unknown }).host = {
    destroy: async () => undefined,
    contentVertical: false,
    pageKey: '',
    isPdf: false,
    /* 设置页改偏好会走 updatePrefs → host.applyPrefs：空壳要有这一口，
       否则「改设置立刻生效」这类测试会在半路炸掉 */
    applyPrefs: () => undefined,
  };
}

/** 业务书对象的最小形状（测试只读这些字段） */
export function testBook(id: string, title = `书-${id}`): Record<string, unknown> {
  return {
    id,
    meta: { title, author: '作者' },
    fileRef: { vaultPath: `书/${id}.epub`, format: 'epub', size: 1 },
    reading: { position: { percent: 0 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
    notes: { highlights: [], excerpts: [], bookmarks: [] },
    addedAt: 1,
    updatedAt: 1,
  };
}
