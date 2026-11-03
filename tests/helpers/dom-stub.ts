/**
 * 极简 DOM 桩：让只依赖 document.body / getComputedStyle 的纯函数能在 node 里测。
 *
 * 项目没装 jsdom（离线环境装不了），所以这里手写够用的一层。凡是需要完整
 * 布局/事件系统的测试，一律不要走这条路——把逻辑抽成纯函数再测。
 */
type FakeEl = {
  tagName: string;
  className: string;
  textContent: string;
  children: FakeEl[];
  style: Record<string, string> & { setProperty(k: string, v: string): void; removeProperty(k: string): void };
  classList: {
    add(...c: string[]): void;
    remove(...c: string[]): void;
    contains(c: string): boolean;
    toggle(c: string, on?: boolean): boolean;
  };
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  appendChild(el: FakeEl): FakeEl;
  append(...els: FakeEl[]): void;
  remove(): void;
  querySelector(): null;
  addEventListener(): void;
  removeEventListener(): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
};

function makeEl(tagName = 'div'): FakeEl {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  const style = new Proxy(
    {
      setProperty(k: string, v: string): void {
        (style as unknown as Record<string, string>)[k] = v;
      },
      removeProperty(k: string): void {
        delete (style as unknown as Record<string, string>)[k];
      },
    } as unknown as FakeEl['style'],
    {
      set(target, key, value) {
        (target as unknown as Record<string, string>)[String(key)] = String(value);
        return true;
      },
    },
  );
  const el: FakeEl = {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    children: [],
    style,
    classList: {
      add: (...c: string[]) => c.forEach((x) => classes.add(x)),
      remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
      contains: (c: string) => classes.has(c),
      toggle: (c: string, on?: boolean) => {
        const next = on ?? !classes.has(c);
        if (next) classes.add(c);
        else classes.delete(c);
        return next;
      },
    },
    setAttribute: (k, v) => void attrs.set(k, v),
    getAttribute: (k) => attrs.get(k) ?? null,
    appendChild: (child) => {
      el.children.push(child);
      return child;
    },
    append: (...els) => void el.children.push(...els),
    remove: () => undefined,
    querySelector: () => null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  };
  return el;
}

/** 装好全局 document / getComputedStyle；返回卸载函数 */
export function installDomStub(): () => void {
  const body = makeEl('body');
  const head = makeEl('head');
  const documentElement = makeEl('html');
  const stub = {
    body,
    head,
    documentElement,
    createElement: (tag: string) => makeEl(tag),
    querySelector: () => null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getSelection: () => null,
  };
  const g = globalThis as unknown as Record<string, unknown>;
  const hadDoc = 'document' in g;
  const hadGcs = 'getComputedStyle' in g;
  g.document = stub;
  g.getComputedStyle = () => ({ getPropertyValue: () => '' });
  return () => {
    if (!hadDoc) delete g.document;
    if (!hadGcs) delete g.getComputedStyle;
  };
}
