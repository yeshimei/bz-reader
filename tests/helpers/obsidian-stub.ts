/**
 * node 测试里的 obsidian 替身。
 *
 * `obsidian` 包只有类型没有运行时（package.json 的 main 是空串），所以任何
 * 模块只要在运行时 import 了它（比如 core/notice 的 `Notice`），在 vitest 里
 * 就会「Cannot find module」。vitest.config.ts 把 `obsidian` 指到这里。
 *
 * 原则：只放**被测试模块真正用到的那几个符号**，不追求 API 完整。
 */
export class Notice {
  message: string;
  timeout?: number;
  constructor(message: string, timeout?: number) {
    this.message = message;
    this.timeout = timeout;
  }
  setMessage(m: string): this {
    this.message = m;
    return this;
  }
  hide(): void {
    /* noop */
  }
}

export const Platform = {
  isMobile: false,
  isPhone: false,
  isDesktop: true,
  isMacOS: false,
  isWin: true,
};

/**
 * 宿主界面语言（`@since 1.8.7`）。
 *
 * 测试里一律给 `zh`：默认语言就是中文，这样任何走到语言探测的路径都不会
 * 因为「跑在 node 里、宿主给不出语言」而意外翻成英文——那会让几十个断言
 * 中文文案的老测试随环境漂移。
 */
export function getLanguage(): string {
  return 'zh';
}


export const requestUrl = async (): Promise<{ status: number; text: string; json: unknown }> => ({
  status: 500,
  text: '',
  json: {},
});

/**
 * 下面几个类只为了让「插件主体 / 阅读视图」能在 node 里被 import 与 new。
 *
 * 之前没有测试碰这两个模块，所以替身里只有 Notice / Platform / requestUrl。
 * 插件壳层的几处逻辑（onunload 收尾、activeReader、沉浸引用计数）没有纯函数
 * 可抽，只能把类造出来测行为；宿主 API 用得极少，这里按需给最小实现。
 */

type StubEl = {
  className: string;
  textContent: string;
  children: unknown[];
  classList: { add(...c: string[]): void; remove(...c: string[]): void; toggle(c: string, on?: boolean): boolean; contains(c: string): boolean };
  empty(): void;
  addClass(...c: string[]): void;
  removeClass(...c: string[]): void;
  createDiv(opts?: unknown): StubEl;
  createEl(tag?: string, opts?: unknown): StubEl;
  append(...els: unknown[]): void;
  appendChild(el: unknown): unknown;
  remove(): void;
  querySelector(): null;
  querySelectorAll(): unknown[];
  setAttribute(k: string, v: string): void;
  addEventListener(): void;
  removeEventListener(): void;
};

function stubEl(): StubEl {
  const classes = new Set<string>();
  const el: StubEl = {
    className: '',
    textContent: '',
    children: [],
    classList: {
      add: (...c: string[]) => c.forEach((x) => classes.add(x)),
      remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
      toggle: (c: string, on?: boolean) => {
        const next = on ?? !classes.has(c);
        if (next) classes.add(c);
        else classes.delete(c);
        return next;
      },
      contains: (c: string) => classes.has(c),
    },
    empty: () => {
      el.children = [];
    },
    addClass: (...c: string[]) => c.forEach((x) => classes.add(x)),
    removeClass: (...c: string[]) => c.forEach((x) => classes.delete(x)),
    createDiv: () => el.appendChild(stubEl()) as StubEl,
    createEl: () => el.appendChild(stubEl()) as StubEl,
    append: (...els: unknown[]) => void el.children.push(...els),
    appendChild: (child: unknown) => {
      el.children.push(child);
      return child;
    },
    remove: () => undefined,
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  return el;
}

/** ItemView / View 的最小替身：只提供构造期与收尾期真正会读的字段 */
export class ItemView {
  leaf: unknown;
  app: unknown;
  containerEl: StubEl = stubEl();
  contentEl: StubEl = stubEl();

  constructor(leaf?: unknown) {
    this.leaf = leaf;
    this.app = (leaf as { app?: unknown } | undefined)?.app;
  }

  registerEvent(): void {
    /* noop */
  }

  registerDomEvent(): void {
    /* noop */
  }

  registerInterval(): void {
    /* noop */
  }

  async setState(_state: unknown, _result: unknown): Promise<void> {
    /* noop */
  }

  async onOpen(): Promise<void> {
    /* noop */
  }

  async onClose(): Promise<void> {
    /* noop */
  }
}

/** Plugin 的最小替身：插件测试只 new 出来，不跑 onload */
export class Plugin {
  app: unknown;
  manifest: unknown;

  constructor(app?: unknown, manifest?: unknown) {
    this.app = app;
    this.manifest = manifest;
  }

  async loadData(): Promise<unknown> {
    return null;
  }

  async saveData(_data: unknown): Promise<void> {
    /* noop */
  }

  addCommand(_command: unknown): void {
    /* noop */
  }

  addRibbonIcon(): unknown {
    return {};
  }

  registerView(_type: string, _factory: unknown): void {
    /* noop */
  }

  registerEvent(_event: unknown): void {
    /* noop */
  }

  registerObsidianProtocolHandler(_action: string, _handler: unknown): void {
    /* noop */
  }
}

/** actions/reader-view 只 `new Menu()` + 链式调用；不给真实菜单 */
export class Menu {
  addItem(fn: (item: Menu) => void): this {
    fn(this);
    return this;
  }

  addSeparator(): this {
    return this;
  }

  showAtPosition(_pos: unknown): this {
    return this;
  }
}

export function setIcon(): void {
  /* noop */
}

/** core/folder-pick 的 import 期依赖 */
export class FuzzySuggestModal {
  constructor(readonly app: unknown = undefined) {}
  setPlaceholder(): this {
    return this;
  }
  open(): void {
    /* noop */
  }
  close(): void {
    /* noop */
  }
  /** 真实 Modal 有 onClose（默认空实现）；子类会 super.onClose() */
  onClose(): void {
    /* noop */
  }
}

export class TFolder {
  path = '';
}
