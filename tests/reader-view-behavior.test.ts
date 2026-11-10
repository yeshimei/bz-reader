import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { makeApp, makeReaderView, stubHost, testBook, type ReaderHandle } from './helpers/plugin-harness';
import { normalizePrefs } from '../src/data/prefs';
import { EngineHost } from '../src/engine/host';
import type { ReaderView } from '../src/view/reader-view';
import { clearToc, getToc } from '../src/view/toc-state';

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

describe('并排对照的开启闸门（B8）', () => {
  function wire() {
    const app = makeApp();
    const { view } = makeReaderView(app);
    const book = testBook('main');
    const other = testBook('other');
    (view as unknown as { book: unknown }).book = book;
    (view as unknown as { pagesEl: unknown }).pagesEl = document.createElement('div');
    view.api.store.get().books = [book, other];
    return view;
  }

  /**
   * 开副卷要 mount + start 整本副卷，几百毫秒起。这段时间里再点一次
   * （双击、头栏与命令面板同时触发）会建出第二个副卷：第一个的 host2 被
   * 覆盖，iframe 与监听全漏，界面上并排出现两本书。
   */
  it('副卷还在装载时再点一次：只建一个副卷', async () => {
    const view = wire();
    let release: (() => void) | null = null;
    const mount = vi
      .spyOn(EngineHost.prototype, 'mount')
      .mockImplementation(() => new Promise<void>((res) => (release = () => res())) as never);
    const start = vi.spyOn(EngineHost.prototype, 'start').mockResolvedValue(undefined);

    const first = (view as unknown as { toggleParallel(): Promise<void> }).toggleParallel();
    await (view as unknown as { toggleParallel(): Promise<void> }).toggleParallel();

    expect(mount).toHaveBeenCalledTimes(1);

    release?.();
    await first;
    expect(start).toHaveBeenCalledTimes(1);
    expect((view as unknown as { parallelOpening: boolean }).parallelOpening).toBe(false);
  });
});

describe('排版与主题同时作用到副卷（B9）', () => {
  it('改排版偏好：主卷与副卷都收到', () => {
    const app = makeApp();
    const { view } = makeReaderView(app);
    const applyPrefs = vi.fn();
    (view as unknown as { host: unknown }).host = {
      destroy: async () => undefined,
      contentVertical: false,
      pageKey: '',
      applyPrefs,
    };
    const applyPrefs2 = vi.fn();
    (view as unknown as { host2: unknown }).host2 = { applyPrefs: applyPrefs2, refreshTheme: vi.fn() };

    view.updatePrefs(normalizePrefs({ fontSize: 22 }));

    expect(applyPrefs).toHaveBeenCalledTimes(1);
    /* 只推给主卷的话，调字号时并排的右半边一直不动，像「只对左半边生效」 */
    expect(applyPrefs2).toHaveBeenCalledTimes(1);
  });

  it('宿主换主题：副卷也要刷新', () => {
    const app = makeApp();
    const { view } = makeReaderView(app);
    const refreshTheme = vi.fn();
    const refreshTheme2 = vi.fn();
    (view as unknown as { host: unknown }).host = {
      destroy: async () => undefined,
      contentVertical: false,
      pageKey: '',
      refreshTheme,
    };
    (view as unknown as { host2: unknown }).host2 = { applyPrefs: vi.fn(), refreshTheme: refreshTheme2 };

    /* 宿主抛 css-change 时走的就是这一条 */
    (view as unknown as { onCssChange(): void }).onCssChange();

    expect(refreshTheme).toHaveBeenCalledTimes(1);
    /* 只刷新主卷的话，并排的右半边还是旧底色 */
    expect(refreshTheme2).toHaveBeenCalledTimes(1);
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

describe('打开书默认不碰布局（用户定的：什么也不做）', () => {
  afterEach(() => clearToc());

  /** 造一本已绑好的书 + 只会吐章节的引擎壳；侧栏打开记在 openTocSidebar 上 */
  function wire(): { view: ReaderView; openTocSidebar: ReturnType<typeof vi.fn> } {
    const app = makeApp();
    const handle = makeReaderView(app, 'b-open');
    const openTocSidebar = vi.fn();
    handle.api.openTocSidebar = openTocSidebar;
    const book = testBook('b-open');
    (book.reading as { position: Record<string, unknown> }).position.chapterTitle = '第一章';
    (handle.view as unknown as { book: unknown }).book = book;
    (handle.view as unknown as { host: unknown }).host = {
      toc: () => [{ label: '第一章', href: '1.xhtml' }],
      currentChapterHref: () => '1.xhtml',
    };
    return { view: handle.view, openTocSidebar };
  }

  it('引擎就绪只写目录快照，不展开左栏', () => {
    const { view, openTocSidebar } = wire();

    (view as unknown as { publishToc(): void }).publishToc();

    expect(openTocSidebar).not.toHaveBeenCalled();
    expect(getToc()?.bookId).toBe('b-open');
    expect(getToc()?.items).toHaveLength(1);
  });

  it('切回已开的阅读 tab 也不展开左栏', () => {
    const { view, openTocSidebar } = wire();

    (view as unknown as { activate(): void }).activate();

    expect(openTocSidebar).not.toHaveBeenCalled();
    expect(getToc()?.bookId).toBe('b-open');
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

describe('PDF 的翻页 / 单双页与 EPUB 分开', () => {
  /** PDF 视图：只需要键盘与偏好要碰的那几个字段 */
  function pdfView(prefs: Record<string, unknown>) {
    const app = makeApp();
    const { view, leaf } = makeReaderView(app);
    app.workspace.activeLeaf = leaf as never;
    (view as unknown as { host: unknown }).host = {
      destroy: async () => undefined,
      isPdf: true,
      contentVertical: false,
      contentRtl: false,
      pageKey: '',
      applyPrefs: vi.fn(),
      pdfUi: { setSpread: vi.fn() },
    };
    (view as unknown as { prefs: unknown }).prefs = normalizePrefs(prefs);
    return view;
  }

  it('PDF 设成连续：EPUB 那边是分页，方向键也照样不翻页', () => {
    const view = pdfView({ flow: 'paged', pdfFlow: 'scroll' });
    const run = vi.spyOn(view, 'runCommand').mockImplementation(() => undefined);

    const e = key('ArrowRight');
    view.handleKey(e);

    expect(run).not.toHaveBeenCalled();
    expect((e.preventDefault as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('PDF 设成一屏一页：EPUB 那边是滚动，方向键照样翻页', () => {
    const view = pdfView({ flow: 'scroll', pdfFlow: 'paged' });
    const run = vi.spyOn(view, 'runCommand').mockImplementation(() => undefined);

    const e = key('ArrowRight');
    view.handleKey(e);

    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('next');
  });

  it('设置页改单双页：推给当前这本 PDF', () => {
    const view = pdfView({ pdfSpread: false });
    const setSpread = (view as unknown as { host: { pdfUi: { setSpread: ReturnType<typeof vi.fn> } } }).host.pdfUi
      .setSpread;

    view.updatePrefs(normalizePrefs({ pdfSpread: true }));

    expect(setSpread).toHaveBeenCalledWith(true);
  });

  it('单双页没变就不碰当前书：打开时的全局默认不能冲掉按书记忆', () => {
    const view = pdfView({ pdfSpread: true });
    const setSpread = (view as unknown as { host: { pdfUi: { setSpread: ReturnType<typeof vi.fn> } } }).host.pdfUi
      .setSpread;

    view.updatePrefs(normalizePrefs({ pdfSpread: true, fontSize: 22 }));

    expect(setSpread).not.toHaveBeenCalled();
  });
});
