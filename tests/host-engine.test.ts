import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * host.ts 的引擎行为测试。
 *
 * host 依赖 `foliate-view` 自定义元素与 DOM；node 里没有这两个全局，所以
 * 先装最小桩再动态 import。断言只看「用户能感知的结果」：GBK 文本解对、
 * 排版切换失败会报出来、导航排在队里、关书时断链。
 */
vi.mock('../src/data/entitlement', () => ({ can: () => true }));

type EngineHostCtor = typeof import('../src/engine/host').EngineHost;

let EngineHost: EngineHostCtor;
let restoreDom: () => void;

beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.HTMLElement ??= class {};
  g.customElements ??= { get: () => undefined, define: () => undefined };
  // text-walker.js 在模块顶层读 NodeFilter
  g.NodeFilter ??= { SHOW_ELEMENT: 1, SHOW_TEXT: 4, SHOW_CDATA_SECTION: 8 };
  const { installDomStub } = await import('./helpers/dom-stub');
  restoreDom = installDomStub();
  const mod = await import('../src/engine/host');
  EngineHost = mod.EngineHost;
});

afterAll(() => {
  restoreDom?.();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function newHost(): InstanceType<EngineHostCtor> {
  return new EngineHost({} as never);
}

function fakeView(goTo: (target: unknown) => Promise<unknown>): {
  view: unknown;
  renderer: {
    setStyles: ReturnType<typeof vi.fn>;
    style: { setProperty: ReturnType<typeof vi.fn> };
    getAttribute: (name: string) => string | null;
    setAttribute: ReturnType<typeof vi.fn>;
  };
} {
  const renderer = {
    setStyles: vi.fn(),
    style: { setProperty: vi.fn() },
    getAttribute: () => null,
    setAttribute: vi.fn(),
  };
  return { view: { renderer, goTo }, renderer };
}

describe('host · TXT 编码（A-06）', () => {
  it('走 readBinary + decodeTxtBytes：GBK 文件解出正确中文', async () => {
    const host = newHost();
    const gbk = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4]);
    (host as unknown as { app: unknown }).app = {
      vault: { adapter: { readBinary: async () => gbk.buffer.slice(0) } },
    };

    const { book } = (await (
      host as unknown as { buildBook: (p: string) => Promise<{ book: import('../src/types/foliate').FoliateBook }> }
    ).buildBook('测试.txt')) as { book: import('../src/types/foliate').FoliateBook };

    const captured: Blob[] = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      captured.push(blob);
      return 'blob:host-txt-test';
    }) as typeof URL.createObjectURL;
    try {
      await book.sections[0]?.load?.();
    } finally {
      URL.createObjectURL = orig;
    }

    expect(await captured[0]?.text()).toContain('中文测试');
  });

  it('不再依赖 adapter.read（TXT 也整份读字节）', async () => {
    const host = newHost();
    const read = vi.fn(async () => {
      throw new Error('不该走文本 read');
    });
    (host as unknown as { app: unknown }).app = {
      vault: {
        adapter: {
          read,
          readBinary: async () => new TextEncoder().encode('纯文本').buffer,
        },
      },
    };
    await (host as unknown as { buildBook: (p: string) => Promise<unknown> }).buildBook('a.txt');
    expect(read).not.toHaveBeenCalled();
  });
});

describe('host · 竖排/横排切换走导航队列（A-34）', () => {
  it('goTo 失败时报 onStall，而不是静默吞掉', async () => {
    const host = newHost();
    const goTo = vi.fn(async () => {
      throw new Error('layout failed');
    });
    const { view } = fakeView(goTo);
    const onStall = vi.fn();
    const prefs = { ...(host as unknown as { prefs: object }).prefs } as import('../src/data/prefs').ReaderPrefs;

    Object.assign(host as unknown as Record<string, unknown>, {
      view,
      prefs,
      lastLocationCfi: 'epubcfi(/6/2)',
      opts: { prefs, onStall },
    });

    host.applyPrefs({ ...prefs, layout: 'vertical' });
    await (host as unknown as { navChain: Promise<unknown> }).navChain;

    expect(goTo).toHaveBeenCalledWith('epubcfi(/6/2)');
    expect(onStall).toHaveBeenCalled();
  });

  it('切换排版排在已排队的导航后面，不插队', async () => {
    const host = newHost();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const goTo = vi.fn(async () => undefined);
    const { view } = fakeView(goTo);
    const prefs = { ...(host as unknown as { prefs: object }).prefs } as import('../src/data/prefs').ReaderPrefs;
    Object.assign(host as unknown as Record<string, unknown>, {
      view,
      prefs,
      lastLocationCfi: 'epubcfi(/6/2)',
      opts: { prefs },
    });

    const queued = (host as unknown as { enqueue: <T>(run: () => Promise<T>) => Promise<T> }).enqueue(
      () => gate,
    );
    host.applyPrefs({ ...prefs, layout: 'vertical' });
    expect(goTo).not.toHaveBeenCalled();

    release();
    await queued;
    await (host as unknown as { navChain: Promise<unknown> }).navChain;
    expect(goTo).toHaveBeenCalledWith('epubcfi(/6/2)');
  });
});

describe('host · 关书兜底（A-08）', () => {
  it('view.close() 抛错后仍然断链：sections 清空、兜底 destroy、控件移除', async () => {
    const host = newHost();
    const renderer = {
      sections: [{ id: 'a' }, { id: 'b' }],
      destroy: vi.fn(),
    };
    const view = {
      close: () => {
        throw new Error('renderer already destroyed');
      },
      remove: vi.fn(),
      renderer,
    };
    Object.assign(host as unknown as Record<string, unknown>, {
      view,
      book: { sections: [], destroy: vi.fn() },
      container: {},
    });

    await host.destroy();

    expect(renderer.sections).toEqual([]);
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
    expect(view.remove).toHaveBeenCalledTimes(1);
    expect((host as unknown as { view: unknown }).view).toBeNull();
  });
});
