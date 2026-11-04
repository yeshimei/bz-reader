import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, type ReaderPrefs } from '../src/data/prefs';

/**
 * host.ts 的引擎行为测试。
 *
 * host 依赖 `foliate-view` 自定义元素与 DOM；node 里没有这两个全局，所以
 * 先装最小桩再动态 import。断言只看「用户能感知的结果」：GBK 文本解对、
 * 排版切换失败会报出来、导航排在队里、关书时断链。
 */
/** 授权状态：默认已解锁；「下放基础版」的用例会临时关掉 */
const entitlement = vi.hoisted(() => ({ unlocked: true }));

vi.mock('../src/data/entitlement', () => ({
  can: () => entitlement.unlocked,
}));

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
    setCssProps: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    style: { setProperty: ReturnType<typeof vi.fn> };
    getAttribute: (name: string) => string | null;
    setAttribute: ReturnType<typeof vi.fn>;
  };
} {
  const renderer = {
    setStyles: vi.fn(),
    setCssProps: vi.fn(),
    render: vi.fn(),
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

describe('host · 分栏（已下放基础版）', () => {
  type HostInternals = {
    prefs: import('../src/data/prefs').ReaderPrefs;
    view: unknown;
    opts: unknown;
  };

  function wire(host: InstanceType<EngineHostCtor>, unlocked = true): ReturnType<typeof fakeView> {
    const goTo = vi.fn(async () => undefined);
    const fake = fakeView(goTo);
    const prefs = { ...(host as unknown as HostInternals).prefs } as import('../src/data/prefs').ReaderPrefs;
    Object.assign(host as unknown as Record<string, unknown>, {
      view: fake.view,
      prefs,
      opts: { prefs },
    });
    entitlement.unlocked = unlocked;
    return fake;
  }

  it('切到双栏：把栏数写给分页器（属性 + CSS 变量），并让它重排一次', () => {
    const host = newHost();
    const { renderer, view } = wire(host);
    const prefs = (host as unknown as HostInternals).prefs;

    host.applyPrefs({ ...prefs, columns: 2 });

    /* 两条都写：属性走 paginator 的 attributeChangedCallback（补丁里那一版），
       CSS 变量是旧版自定义元素/重载后仍在页面上的那一份的退路。 */
    expect(renderer.setAttribute).toHaveBeenCalledWith('max-column-count', '2');
    expect(renderer.setCssProps).toHaveBeenCalledWith({ '--_column-count': '2' });
    expect(renderer.render).toHaveBeenCalled();
    /* 切栏数不该重载章节（goTo 是竖排切换才用的重路径） */
    expect((view as { goTo: ReturnType<typeof vi.fn> }).goTo).not.toHaveBeenCalled();
  });

  it('切回单栏：栏数写成 1（以前永远停在双栏，就是这一步没生效）', () => {
    const host = newHost();
    const { renderer } = wire(host);
    const prefs = (host as unknown as HostInternals).prefs;

    host.applyPrefs({ ...prefs, columns: 2 });
    host.applyPrefs({ ...prefs, columns: 1 });

    expect(
      renderer.setAttribute.mock.calls.filter((c) => c[0] === 'max-column-count').map((c) => c[1]),
    ).toEqual(['2', '1']);
    /* setCssProps 一次调用只带一个变量（padding 也在后面各调一次），所以逐次查 */
    const talked = renderer.setCssProps.mock.calls.map((c) => (c[0] as Record<string, string>)['--_column-count']);
    expect(talked).toContain('1');
  });

  it('基础版（未解锁）：竖排回落到横排，但双栏照样生效', () => {
    const host = newHost();
    const { renderer, view } = wire(host, false);
    const prefs = (host as unknown as HostInternals).prefs;

    host.applyPrefs({ ...prefs, layout: 'vertical', columns: 2 });

    expect(renderer.setAttribute).toHaveBeenCalledWith('max-column-count', '2');
    /* 竖排被门控：不会走 goTo 重载章节 */
    expect((view as { goTo: ReturnType<typeof vi.fn> }).goTo).not.toHaveBeenCalled();
    /* 注入的章节样式不是竖排 */
    const css = String(renderer.setStyles.mock.calls.at(-1)?.[0] ?? '');
    expect(css).not.toContain('vertical-rl');
    entitlement.unlocked = true;
  });
});

describe('host · 滚动模式（一章滚完自动进下一章）', () => {
  type ScrollHost = {
    prefs: import('../src/data/prefs').ReaderPrefs;
    handleWheel(ev: WheelEvent): void;
  };

  function makeScrollHost(pos: { start: number; end: number; viewSize: number }): {
    host: InstanceType<EngineHostCtor>;
    onTurn: ReturnType<typeof vi.fn>;
  } {
    const host = newHost();
    const onTurn = vi.fn();
    const renderer = {
      setStyles: vi.fn(),
      setCssProps: vi.fn(),
      render: vi.fn(),
      getAttribute: () => 'scrolled',
      setAttribute: vi.fn(),
      ...pos,
    };
    const prefs = {
      ...(host as unknown as { prefs: import('../src/data/prefs').ReaderPrefs }).prefs,
      flow: 'scroll',
    } as import('../src/data/prefs').ReaderPrefs;
    Object.assign(host as unknown as Record<string, unknown>, {
      view: { renderer },
      prefs,
      opts: { prefs, onTurn },
    });
    return { host, onTurn };
  }

  function wheel(host: InstanceType<EngineHostCtor>, deltaY: number): void {
    (host as unknown as ScrollHost).handleWheel({
      deltaY,
      deltaX: 0,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent);
  }

  it('还没滚到底：滚轮照旧交给浏览器，不翻章', () => {
    const { host, onTurn } = makeScrollHost({ start: 100, end: 580, viewSize: 2400 });
    wheel(host, 200);
    expect(onTurn).not.toHaveBeenCalled();
  });

  it('贴底后继续向下滚：切下一章', () => {
    const { host, onTurn } = makeScrollHost({ start: 1920, end: 2400, viewSize: 2400 });
    wheel(host, 60);
    expect(onTurn).toHaveBeenCalledWith('next');
  });

  it('贴底却往上回看：不切章', () => {
    const { host, onTurn } = makeScrollHost({ start: 1920, end: 2400, viewSize: 2400 });
    wheel(host, -60);
    expect(onTurn).not.toHaveBeenCalled();
  });

  it('贴顶后继续向上滚：切上一章', () => {
    const { host, onTurn } = makeScrollHost({ start: 0, end: 480, viewSize: 2400 });
    wheel(host, -60);
    expect(onTurn).toHaveBeenCalledWith('prev');
  });

  it('触底一下要连滚好几次才切（挡住触控板惯性）', () => {
    const { host, onTurn } = makeScrollHost({ start: 1920, end: 2400, viewSize: 2400 });
    wheel(host, 10);
    wheel(host, 10);
    expect(onTurn).not.toHaveBeenCalled();
    wheel(host, 10);
    wheel(host, 10);
    wheel(host, 10);
    expect(onTurn).toHaveBeenCalledWith('next');
  });
});

/**
 * 上下边距要写到分页器上，不是只写 body。
 *
 * 分页时每页的上下留白由 shadow 里 html 的 padding 决定（vendor 补丁把它接成
 * `--_pad-top` / `--_pad-bottom`），注入的 body padding 只对章首页生效。
 * 只改 body 的话，用户翻到第二页就看不到任何变化——「调了没效果」。
 */
describe('host · 上下边距（每页留白）', () => {
  function wirePrefs(marginY: number) {
    const host = newHost();
    const fake = fakeView(vi.fn(async () => undefined));
    const prefs = { ...DEFAULT_PREFS, marginY } as import('../src/data/prefs').ReaderPrefs;
    Object.assign(host as unknown as Record<string, unknown>, { view: fake.view, prefs, opts: { prefs } });
    host.applyPrefs(prefs);
    const props = fake.renderer.setCssProps.mock.calls.map((c) => c[0] as Record<string, string>);
    return props;
  }

  it('marginY 写给分页器：上下一样高（用户说的「上下边距」就是这两条）', () => {
    const props = wirePrefs(64);
    expect(props.some((p) => p['--_pad-top'] === '64px')).toBe(true);
    expect(props.some((p) => p['--_pad-bottom'] === '64px')).toBe(true);
  });

  it('调到 0 时顶部就是 0（不再兜底成别的值）', () => {
    const props = wirePrefs(0);
    expect(props.some((p) => p['--_pad-top'] === '0px')).toBe(true);
  });

  /**
   * 改了变量不等于改了版式：分页器把每页高度、iframe 高度都按旧的 padding
   * 算好了，只换 CSS 变量不会重算页数。桌面窗口高、余量足，看起来「生效」；
   * 手机屏矮，新留白直接把内容挤出 iframe，表现就是「拖了没反应」。
   */
  function marginYHost(from: number): {
    host: InstanceType<EngineHostCtor>;
    renderer: ReturnType<typeof fakeView>['renderer'];
    base: ReaderPrefs;
  } {
    const host = newHost();
    const fake = fakeView(vi.fn(async () => undefined));
    const base = { ...DEFAULT_PREFS, marginY: from } as ReaderPrefs;
    Object.assign(host as unknown as Record<string, unknown>, { view: fake.view, prefs: base, opts: { prefs: base } });
    return { host, renderer: fake.renderer, base };
  }

  it('改上下边距后要让分页器重排（手机上拖滑块不能只改变量）', async () => {
    const { host, renderer, base } = marginYHost(28);

    host.applyPrefs({ ...base, marginY: 64 });
    await new Promise((r) => setTimeout(r, 10));

    expect(renderer.render).toHaveBeenCalled();
  });

  it('只改字号不重排（每拖一格都整章重排会卡）', async () => {
    const { host, renderer, base } = marginYHost(28);

    host.applyPrefs({ ...base, fontSize: 22 });
    await new Promise((r) => setTimeout(r, 10));

    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('连续拖多格只重排一次（合到下一帧）', async () => {
    const { host, renderer, base } = marginYHost(28);

    host.applyPrefs({ ...base, marginY: 32 });
    host.applyPrefs({ ...base, marginY: 48 });
    host.applyPrefs({ ...base, marginY: 64 });
    await new Promise((r) => setTimeout(r, 10));

    expect(renderer.render).toHaveBeenCalledTimes(1);
  });
});

describe('host · 落点高亮（从笔记 / 双链跳回原文）', () => {
  /** 覆盖层的 add/remove 是可观测的：跳过去之后用户看到的就是这一层 */
  function wirePulse(index = 3): {
    host: InstanceType<EngineHostCtor>;
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    view: Record<string, unknown>;
  } {
    const host = newHost();
    const add = vi.fn();
    const remove = vi.fn();
    const overlayer = { add, remove, hitTest: () => [undefined, undefined], redraw: () => undefined };
    const view = {
      resolveNavigation: vi.fn(async () => ({ index, anchor: () => ({}) })),
      renderer: { getContents: () => [{ index, doc: {}, overlayer }] },
    };
    Object.assign(host as unknown as Record<string, unknown>, { view });
    return { host, add, remove, view };
  }

  const call = (host: InstanceType<EngineHostCtor>, name: string, arg?: unknown): Promise<void> =>
    (host as unknown as Record<string, (a?: unknown) => Promise<void>>)[name](arg);

  it('在目标章节的覆盖层上加一个框，key 固定（不和划线的 CFI 抢 key）', async () => {
    const { host, add } = wirePulse();
    await call(host, 'pulseAt', 'epubcfi(/6/6)');
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]?.[0]).toBe('__bzr-pulse__');
  });

  it('颜色跟随外观的强调色', async () => {
    const { host, add } = wirePulse();
    const g = globalThis as unknown as { getComputedStyle: unknown };
    const orig = g.getComputedStyle;
    g.getComputedStyle = () => ({
      getPropertyValue: (k: string) => (k === '--interactive-accent' ? ' #ff0000 ' : ''),
    });
    try {
      await call(host, 'pulseAt', 'epubcfi(/6/6)');
      /* add(key, range, draw, options) 的第 4 个参数 */
      expect(add.mock.calls[0]?.[3]).toMatchObject({ color: '#ff0000' });
    } finally {
      g.getComputedStyle = orig;
    }
  });

  it('读不到强调色时退回默认紫（测试环境 / 启动早期）', async () => {
    const { host, add } = wirePulse();
    await call(host, 'pulseAt', 'epubcfi(/6/6)');
    expect(add.mock.calls[0]?.[3]).toMatchObject({ color: '#7c3aed' });
  });

  it('清掉时把框移除，原划线不受影响', async () => {
    const { host, add, remove } = wirePulse();
    await call(host, 'pulseAt', 'epubcfi(/6/6)');
    await call(host, 'clearPulse');
    expect(remove).toHaveBeenCalledWith('__bzr-pulse__');
    /* 全程没有碰 addAnnotation 那条路：划线的颜色不会因为跳转被改掉 */
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('连续跳两次：先清上一个框，不会叠成两层', async () => {
    const { host, add, remove } = wirePulse();
    await call(host, 'pulseAt', 'epubcfi(/6/6)');
    await call(host, 'pulseAt', 'epubcfi(/6/8)');
    expect(remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(2);
  });

  it('CFI 解析不出来时安静收场，不打断阅读', async () => {
    const host = newHost();
    const view = {
      resolveNavigation: vi.fn(async () => {
        throw new Error('bad cfi');
      }),
      renderer: { getContents: () => [] },
    };
    Object.assign(host as unknown as Record<string, unknown>, { view });
    await expect(call(host, 'pulseAt', 'nope')).resolves.toBeUndefined();
  });

  it('章节还没挂上覆盖层时安静返回', async () => {
    const host = newHost();
    const view = {
      resolveNavigation: async () => ({ index: 3, anchor: () => ({}) }),
      /* 只有 doc，没有 overlayer */
      renderer: { getContents: () => [{ index: 3, doc: {} }] },
    };
    Object.assign(host as unknown as Record<string, unknown>, { view });
    await expect(call(host, 'pulseAt', 'epubcfi(/6/6)')).resolves.toBeUndefined();
  });

  it('没有 view（书没开）时什么也不做', async () => {
    const host = newHost();
    await expect(call(host, 'pulseAt', 'epubcfi(/6/6)')).resolves.toBeUndefined();
  });

  it('一秒后自己撤掉：够看清落点，又不挡阅读', async () => {
    const { host, add, remove } = wirePulse();
    const timers: Array<{ fn: () => void; delay?: number }> = [];
    const w = window as unknown as { setTimeout: unknown; clearTimeout: unknown };
    const origSet = w.setTimeout;
    const origClear = w.clearTimeout;
    w.setTimeout = (fn: () => void, delay?: number) => {
      timers.push({ fn, delay });
      return 1;
    };
    w.clearTimeout = () => undefined;
    try {
      await call(host, 'pulseAt', 'epubcfi(/6/6)');
      expect(add).toHaveBeenCalledTimes(1);
      expect(timers).toHaveLength(1);
      expect(timers[0]?.delay).toBe(1000);
      timers[0]?.fn();
      expect(remove).toHaveBeenCalledWith('__bzr-pulse__');
    } finally {
      w.setTimeout = origSet;
      w.clearTimeout = origClear;
    }
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
