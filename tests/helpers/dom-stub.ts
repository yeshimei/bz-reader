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
  setCssProps(props: Record<string, string>): void;
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
    setCssProps: (props) => {
      for (const [k, v] of Object.entries(props)) style.setProperty(k, v);
    },
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

/* ============================================================
 * 迷你 HTML 解析器（只给 inlineMarkup 这类「解析 → 改属性 → 序列化」的
 * 纯逻辑测试用）。
 *
 * 项目没装 jsdom / linkedom，而 node 也没有 DOMParser。这里实现一个**够用**
 * 的子集：标签、属性（含 xlink:href）、文本、注释、style/script 原始文本；
 * 查询只支持 `tag` / `*` / `[attr]` / `[attr="v"]` / `[attr~="v"]` 与逗号分组。
 * 它不是通用 DOM：布局、事件、Range 一概没有，别拿它测那些东西。
 * ============================================================ */

interface MiniAttr {
  name: string;
  value: string;
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

function decodeEntities(s: string): string {
  return String(s).replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]*));/gi, (whole, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(String(hex), 16));
    return NAMED_ENTITIES[String(name).toLowerCase()] ?? whole;
  });
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function isElement(node: MiniNode): node is MiniElement {
  return node.nodeType === 1;
}

class MiniText {
  readonly nodeType = 3;
  parentNode: MiniElement | null = null;
  constructor(public data: string) {}
  get textContent(): string {
    return this.data;
  }
  set textContent(v: string) {
    this.data = String(v);
  }
  get outerHTML(): string {
    return escapeText(this.data);
  }
  remove(): void {
    const p = this.parentNode;
    if (!p) return;
    p.childNodes = p.childNodes.filter((n) => n !== this);
    this.parentNode = null;
  }
}

class MiniElement {
  readonly nodeType = 1;
  parentNode: MiniElement | null = null;
  childNodes: MiniNode[] = [];
  attributes: MiniAttr[] = [];

  constructor(
    public localName: string,
    public ownerDocument: MiniDocument,
  ) {}

  get tagName(): string {
    return this.localName.toUpperCase();
  }

  get children(): MiniElement[] {
    return this.childNodes.filter(isElement);
  }

  getAttribute(name: string): string | null {
    const n = String(name).toLowerCase();
    return this.attributes.find((a) => a.name === n)?.value ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }

  setAttribute(name: string, value: unknown): void {
    const n = String(name).toLowerCase();
    const v = String(value ?? '');
    const hit = this.attributes.find((a) => a.name === n);
    if (hit) hit.value = v;
    else this.attributes.push({ name: n, value: v });
  }

  removeAttribute(name: string): void {
    const n = String(name).toLowerCase();
    this.attributes = this.attributes.filter((a) => a.name !== n);
  }

  /* 真实 DOM 里 xlink:href 是 XLink 命名空间属性；桩按限定名存，够 inlineMarkup 用 */
  setAttributeNS(_namespace: string | null, qualifiedName: string, value: unknown): void {
    this.setAttribute(qualifiedName, value);
  }

  appendChild<T extends MiniNode>(node: T): T {
    node.parentNode?.childNodes && (node.parentNode.childNodes = node.parentNode.childNodes.filter((n) => n !== node));
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  append(...nodes: MiniNode[]): void {
    for (const n of nodes) this.appendChild(n);
  }

  remove(): void {
    const p = this.parentNode;
    if (!p) return;
    p.childNodes = p.childNodes.filter((n) => n !== this);
    this.parentNode = null;
  }

  replaceWith(node: MiniNode): void {
    const p = this.parentNode;
    if (!p) return;
    const at = p.childNodes.indexOf(this);
    if (at < 0) return;
    node.parentNode = p;
    p.childNodes.splice(at, 1, node);
    this.parentNode = null;
  }

  get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('');
  }

  set textContent(v: string) {
    this.childNodes = [];
    const text = String(v ?? '');
    if (text) this.appendChild(new MiniText(text));
  }

  get outerHTML(): string {
    return serializeElement(this);
  }

  querySelectorAll(selector: string): MiniElement[] {
    return queryAll(this, selector);
  }

  querySelector(selector: string): MiniElement | null {
    return queryAll(this, selector)[0] ?? null;
  }
}

type MiniNode = MiniElement | MiniText;

function serializeElement(el: MiniElement): string {
  const attrs = el.attributes.map((a) => ` ${a.name}="${escapeAttr(a.value)}"`).join('');
  if (VOID_TAGS.has(el.localName)) return `<${el.localName}${attrs}>`;
  const inner = el.childNodes.map((n) => n.outerHTML).join('');
  return `<${el.localName}${attrs}>${inner}</${el.localName}>`;
}

/* ── 选择器（子集） ── */

interface AttrTest {
  name: string;
  op: 'exists' | '=' | '~=';
  value: string;
}

interface Compound {
  tag: string | null;
  attrs: AttrTest[];
}

function parseCompound(text: string): Compound {
  let rest = text.trim();
  let tag: string | null = null;
  const tagMatch = /^(\*|[a-zA-Z][\w:-]*)/.exec(rest);
  if (tagMatch) {
    tag = tagMatch[1] === '*' ? null : String(tagMatch[1]).toLowerCase();
    rest = rest.slice(tagMatch[0].length);
  }
  const attrs: AttrTest[] = [];
  const attrRe = /\[\s*([^\s=\]]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(rest))) {
    const name = String(m[1]).toLowerCase();
    const op = m[2];
    const value = String(m[3] ?? m[4] ?? m[5] ?? '');
    if (op === '=') attrs.push({ name, op: '=', value });
    else if (op === '~=') attrs.push({ name, op: '~=', value });
    else attrs.push({ name, op: 'exists', value: '' });
  }
  return { tag, attrs };
}

function matchesCompound(el: MiniElement, c: Compound): boolean {
  if (c.tag && el.localName !== c.tag) return false;
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name);
    if (v === null) return false;
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.value)) return false;
  }
  return true;
}

function queryAll(root: MiniElement, selector: string): MiniElement[] {
  const groups = String(selector)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseCompound);
  if (!groups.length) return [];
  const out: MiniElement[] = [];
  const walk = (el: MiniElement): void => {
    for (const child of el.childNodes) {
      if (!isElement(child)) continue;
      if (groups.some((g) => matchesCompound(child, g))) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

/* ── 文档与解析 ── */

class MiniDocument {
  readonly documentElement: MiniElement;
  readonly head: MiniElement;
  readonly body: MiniElement;

  constructor() {
    this.documentElement = new MiniElement('html', this);
    this.head = new MiniElement('head', this);
    this.body = new MiniElement('body', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }

  createElement(tag: string): MiniElement {
    return new MiniElement(String(tag).toLowerCase(), this);
  }

  querySelectorAll(selector: string): MiniElement[] {
    return queryAll(this.documentElement, selector);
  }

  querySelector(selector: string): MiniElement | null {
    return queryAll(this.documentElement, selector)[0] ?? null;
  }
}

function parseAttrs(text: string): MiniAttr[] {
  const out: MiniAttr[] = [];
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({
      name: String(m[1]).toLowerCase(),
      value: decodeEntities(String(m[2] ?? m[3] ?? m[4] ?? '')),
    });
  }
  return out;
}

/** 解析一份 HTML 片段/整页，返回带 html/head/body 的迷你文档 */
export function parseMiniHtml(input: string): MiniDocument {
  const html = String(input ?? '');
  const doc = new MiniDocument();
  const root = doc.documentElement;
  let stack: MiniElement[] = [root];
  let i = 0;

  const top = (): MiniElement => stack[stack.length - 1]!;
  const toBody = (): MiniElement => {
    if (top() === root) stack = [root, doc.body];
    return top();
  };
  const addText = (text: string): void => {
    if (!text) return;
    toBody().appendChild(new MiniText(decodeEntities(text)));
  };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      addText(html.slice(i));
      break;
    }
    if (lt > i) addText(html.slice(i, lt));

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      const end = html.indexOf('>', lt);
      i = end < 0 ? html.length : end + 1;
      continue;
    }

    const close = /^<\/\s*([a-zA-Z][^\s>]*)\s*>/.exec(html.slice(lt));
    if (close) {
      const name = String(close[1]).toLowerCase();
      for (let k = stack.length - 1; k >= 1; k -= 1) {
        if (stack[k]!.localName === name) {
          stack = stack.slice(0, k);
          break;
        }
      }
      i = lt + close[0].length;
      continue;
    }

    const open = /^<([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>])*)>/.exec(html.slice(lt));
    if (!open) {
      addText('<');
      i = lt + 1;
      continue;
    }
    const name = String(open[1]).toLowerCase();
    let rest = String(open[2] ?? '');
    let selfClosing = false;
    if (/\/\s*$/.test(rest)) {
      selfClosing = true;
      rest = rest.replace(/\/\s*$/, '');
    }
    i = lt + open[0].length;

    if (name === 'html') {
      stack = [root];
      continue;
    }
    if (name === 'head') {
      stack = [root, doc.head];
      continue;
    }
    if (name === 'body') {
      stack = [root, doc.body];
      continue;
    }

    const el = doc.createElement(name);
    el.attributes = parseAttrs(rest);
    toBody().appendChild(el);

    if (RAW_TEXT_TAGS.has(name)) {
      const closeAt = html.toLowerCase().indexOf(`</${name}`, i);
      const end = closeAt < 0 ? html.length : closeAt;
      el.appendChild(new MiniText(html.slice(i, end)));
      const gt = closeAt < 0 ? -1 : html.indexOf('>', closeAt);
      i = gt < 0 ? html.length : gt + 1;
      continue;
    }
    if (!VOID_TAGS.has(name) && !selfClosing) stack.push(el);
  }

  return doc;
}

class MiniDomParser {
  parseFromString(input: string): MiniDocument {
    return parseMiniHtml(input);
  }
}

/** 装好全局 document / getComputedStyle / DOMParser；返回卸载函数 */
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
  const hadWindow = 'window' in g;
  /* 不少模块会走 window.setTimeout；没有定时器时测试会以
     「window.setTimeout is not a function」这种假故障炸掉。 */
  (g as { window?: unknown }).window = {
    innerWidth: 390,
    innerHeight: 844,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
  };
  const hadDoc = 'document' in g;
  const hadGcs = 'getComputedStyle' in g;
  const hadParser = 'DOMParser' in g;
  const prevParser = g.DOMParser;
  g.document = stub;
  g.getComputedStyle = () => ({ getPropertyValue: () => '' });
  g.DOMParser = MiniDomParser;
  return () => {
    if (!hadDoc) delete g.document;
    if (!hadGcs) delete g.getComputedStyle;
    if (!hadWindow) delete (g as { window?: unknown }).window;
    if (hadParser) g.DOMParser = prevParser;
    else delete g.DOMParser;
  };
}
