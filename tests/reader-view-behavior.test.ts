import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { makeApp, makeReaderView, stubHost, testBook, type ReaderHandle } from './helpers/plugin-harness';
import { normalizePrefs } from '../src/data/prefs';
import { EngineHost } from '../src/engine/host';

/* 并排对照 / 朗读要过能力门；这里只测壳层状态机，统一放行 */
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

let uninstall: () => void = () => undefined;

beforeEach(() => {
  uninstall = installDomStub();
});

afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

function key(key: string): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: null,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

describe('滚动模式的键盘（A-26）', () => {
  it('方向键与空格交给浏览器滚动，不 preventDefault、不翻页', () => {
    const app = makeApp();
    const { view, leaf } = makeReaderView(app);
    app.workspace.activeLeaf = leaf as never;
    (view as unknown as { prefs: unknown }).prefs = normalizePrefs({ flow: 'scroll' });
    const run = vi.spyOn(view, 'runCommand').mockImplementation(() => undefined);

    for (const k of ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', ' ']) {
      const e = key(k);
      view.handleKey(e);
      expect((e.preventDefault as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('分页模式照旧：方向键翻页并 preventDefault', () => {
    const app = makeApp();
    const { view, leaf } = makeReaderView(app);
    app.workspace.activeLeaf = leaf as never;
    (view as unknown as { prefs: unknown }).prefs = normalizePrefs({ flow: 'paged' });
    const run = vi.spyOn(view, 'runCommand').mockImplementation(() => undefined);

    const e = key('ArrowRight');
    view.handleKey(e);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('next');
  });
});

describe('沉浸模式（A-27）', () => {
  it('两个视图同时沉浸，关掉一个不摘掉另一个的 body class', async () => {
    const app = makeApp();
    const a = makeReaderView(app);
    const b = makeReaderView(app);
    stubHost(a.view);
    stubHost(b.view);

    (a.view as unknown as { toggleImmersive(on?: boolean): void }).toggleImmersive(true);
    (b.view as unknown as { toggleImmersive(on?: boolean): void }).toggleImmersive(true);
    expect(document.body.classList.contains('bzr-immersive')).toBe(true);

    await a.view.onClose();
    expect(document.body.classList.contains('bzr-immersive')).toBe(true);

    await b.view.onClose();
    expect(document.body.classList.contains('bzr-immersive')).toBe(false);
  });
});

describe('并排对照失败清理（A-28）', () => {
  it('副卷装载失败时先销毁引擎，再清引用与 DOM', async () => {
    const app = makeApp();
    const { view } = makeReaderView(app);
    const book = testBook('main');
    const other = testBook('other');
    (view as unknown as { book: unknown }).book = book;
    (view as unknown as { pagesEl: unknown }).pagesEl = document.createElement('div');
    view.api.store.get().books = [book, other];

    const mount = vi.spyOn(EngineHost.prototype, 'mount').mockRejectedValue(new Error('解析失败'));
    const destroy = vi.spyOn(EngineHost.prototype, 'destroy').mockResolvedValue(undefined);

    await (view as unknown as { toggleParallel(): Promise<void> }).toggleParallel();

    expect(mount).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect((view as unknown as { host2: unknown }).host2).toBeNull();
    expect((view as unknown as { stage2: unknown }).stage2).toBeNull();
    expect(
      (view as unknown as { pagesEl: HTMLElement }).pagesEl.classList.contains('is-parallel'),
    ).toBe(false);
  });
});

describe('从链接落回原文：落点高亮', () => {
  /** 跳转后不闪一下，用户只知道「翻到别处了」，不知道落到哪一句 */
  function wire(host: Record<string, unknown>): ReaderHandle {
    const app = makeApp();
    const handle = makeReaderView(app);
    (handle.view as unknown as { host: unknown }).host = {
      destroy: async () => undefined,
      contentVertical: false,
      pageKey: '',
      ...host,
    };
    /* 跳过 maybeMount：这里只测「定位成功后有没有喊高亮」 */
    (handle.view as unknown as { mounted: boolean }).mounted = true;
    return handle;
  }

  it('CFI 精确跳成功：按这个 CFI 闪一下', async () => {
    const pulseAt = vi.fn();
    const { view } = wire({ goToCfi: vi.fn(async () => true), pulseAt });

    const ok = await view.locateFromLink({ bookId: 'b', cfi: 'epubcfi(/6/4)' });

    expect(ok).toBe(true);
    expect(pulseAt).toHaveBeenCalledWith('epubcfi(/6/4)');
  });

  it('CFI 失效、靠原文片段搜到时：闪的是搜到的那个位置', async () => {
    const pulseAt = vi.fn();
    const { view } = wire({
      goToCfi: vi.fn(async (cfi: string) => cfi === 'found-cfi'),
      search: vi.fn(async () => [{ cfi: 'found-cfi' }]),
      pulseAt,
    });

    const ok = await view.locateFromLink({ bookId: 'b', cfi: 'stale-cfi', text: '原文片段' });

    expect(ok).toBe(true);
    expect(pulseAt).toHaveBeenCalledWith('found-cfi');
  });

  it('三级全落空：不闪（停在原位，闪了反而误导）', async () => {
    const pulseAt = vi.fn();
    const { view } = wire({
      goToCfi: vi.fn(async () => false),
      search: vi.fn(async () => []),
      pulseAt,
    });

    const ok = await view.locateFromLink({ bookId: 'b', cfi: 'stale', text: '搜不到' });

    expect(ok).toBe(false);
    expect(pulseAt).not.toHaveBeenCalled();
  });
});

describe('关书收尾（A-29）', () => {
  it('closeParallel 失败也要把 settle 跑完', async () => {
    const app = makeApp();
    const { view } = makeReaderView(app);
    stubHost(view);
    vi.spyOn(view as unknown as { closeParallel(): Promise<void> }, 'closeParallel').mockRejectedValue(
      new Error('destroy failed'),
    );

    await expect(view.onClose()).resolves.toBeUndefined();

    expect((view as unknown as { closed: boolean }).closed).toBe(true);
    expect(view.api.store.flush).toHaveBeenCalled();
  });
});
