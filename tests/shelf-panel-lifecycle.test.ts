import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { ShelfPanel } from '../src/shell/shelf-panel';

/* ============================================================
 * 书架面板的委托监听（D3）。
 *
 * 监听挂在宿主的 contentEl 上，而 contentEl 活得比面板久、又没有保存
 * 监听句柄可退订。面板销毁后同一块 contentEl 上再开一个书架，旧监听会
 * 跟着新点击跑一遍——同一个动作派发两次，点一下开两层。
 * 所以判据是「目标在不在自己这层 root 里」，销毁后一律丢弃。
 * ============================================================ */

const spy = vi.hoisted(() => ({ acts: [] as string[] }));

vi.mock('../src/shell/actions', () => ({
  dispatchAction: (act: string) => {
    spy.acts.push(act);
  },
  dispatchInput: () => undefined,
}));

/** 只实现 ShelfPanel 真正用到的那几个成员；事件监听记下来由测试手动触发 */
class FakeEl {
  dataset: Record<string, string> = {};
  children: FakeEl[] = [];
  handlers: Record<string, Array<(e: unknown) => void>> = {};
  removed = false;
  classList = {
    add: () => undefined,
    remove: () => undefined,
    contains: () => false,
    toggle: () => false,
  };
  private inside = new Set<unknown>();

  constructor(readonly tagName = 'DIV') {}

  /** 测试里指定「这个节点算在面板里面」 */
  mark(node: unknown): void {
    this.inside.add(node);
  }

  contains(node: unknown): boolean {
    return node === this || this.inside.has(node);
  }

  get clientWidth(): number {
    return 1200;
  }

  addClass(): void {}
  empty(): void {
    this.children = [];
  }
  createDiv(): FakeEl {
    const el = new FakeEl();
    this.children.push(el);
    return el;
  }
  appendChild(el: FakeEl): FakeEl {
    this.children.push(el);
    return el;
  }
  querySelector(): null {
    return null;
  }
  querySelectorAll(): [] {
    return [];
  }
  remove(): void {
    this.removed = true;
  }
  setAttribute(): void {}
  focus(): void {}
  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.handlers[type] ??= []).push(fn);
  }
  removeEventListener(): void {}
}

interface Mounted {
  host: FakeEl;
  root: FakeEl;
  panel: ShelfPanel;
  click: (e: unknown) => void;
}

function mountPanel(host = new FakeEl()): Mounted {
  const panel = new ShelfPanel(host as unknown as HTMLElement);
  panel.mount();
  const root = host.children[host.children.length - 1]!;
  /* 同一块 host 上换面板时监听会叠加，取最新那一个（旧记录由调用方持有） */
  const list = host.handlers.click!;
  const click = list[list.length - 1]!;
  return { host, root, panel, click };
}

/** 假事件：只要 target 与两个拦截方法 */
function clickOn(target: unknown): unknown {
  return { target, preventDefault: () => undefined, stopPropagation: () => undefined };
}

/** 书卡上的「开书」按钮 */
const HIT = { dataset: { act: 'openbook' } };
const target = { closest: (sel: string) => (sel === '[data-act]' ? HIT : null) };

let uninstall = (): void => undefined;

beforeAll(() => {
  uninstall = installDomStub();
});

afterAll(() => {
  uninstall();
});

describe('销毁之后旧监听不再派发动作', () => {
  it('活着的时候点书卡照常派发', () => {
    spy.acts.length = 0;
    const { root, panel, click } = mountPanel();
    root.mark(target);
    click(clickOn(target));
    expect(spy.acts).toEqual(['openbook']);
    panel.destroy();
  });

  it('销毁后同一个监听再跑一次：什么都不做', () => {
    spy.acts.length = 0;
    const { root, panel, click } = mountPanel();
    root.mark(target);
    panel.destroy();
    click(clickOn(target));
    expect(spy.acts).toEqual([]);
  });

  it('销毁时把自己那层 root 摘掉', () => {
    const { root, panel } = mountPanel();
    panel.destroy();
    expect(root.removed).toBe(true);
  });

  /* 同一块 contentEl 上换一个书架：旧面板的监听还在，但目标已经不在它的树里 */
  it('同一块 contentEl 换新面板，旧监听不会让动作派发两遍', () => {
    spy.acts.length = 0;
    const host = new FakeEl();
    const first = mountPanel(host);
    first.root.mark(target);
    first.panel.destroy();

    const second = mountPanel(host);
    second.root.mark(target);

    first.click(clickOn(target)); // 旧监听：目标不在它的 root 里
    second.click(clickOn(target)); // 新监听
    expect(spy.acts).toEqual(['openbook']);
    second.panel.destroy();
  });
});
