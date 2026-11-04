/**
 * vitest 全局补丁：vendor/foliate 在**模块顶层**读的 DOM 常量。
 *
 * node 环境没有 NodeFilter / customElements 这些，import 阶段就会 ReferenceError。
 * 这里只补「常量与空壳」，不模拟 DOM 行为——需要真实布局的测试仍要走
 * tests/helpers/dom-stub.ts 或抽纯函数，别把这里当 jsdom 用。
 */
const g = globalThis as unknown as Record<string, unknown>;

if (typeof g.NodeFilter === 'undefined') {
  g.NodeFilter = {
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
    SHOW_ELEMENT: 1,
    SHOW_ATTRIBUTE: 2,
    SHOW_TEXT: 4,
    SHOW_CDATA_SECTION: 8,
    SHOW_ENTITY_REFERENCE: 16,
    SHOW_ENTITY: 32,
    SHOW_PROCESSING_INSTRUCTION: 64,
    SHOW_COMMENT: 128,
    SHOW_DOCUMENT: 256,
    SHOW_DOCUMENT_TYPE: 512,
    SHOW_DOCUMENT_FRAGMENT: 1024,
    SHOW_NOTATION: 2048,
  };
}

if (typeof g.Node === 'undefined') {
  (g as { Node?: unknown }).Node = class Node {};
}

if (typeof g.Element === 'undefined') {
  (g as { Element?: unknown }).Element = class Element extends (g.Node as new () => object) {};
}

if (typeof g.HTMLElement === 'undefined') {
  (g as { HTMLElement?: unknown }).HTMLElement = class HTMLElement extends (
    g.Element as new () => object
  ) {};
}

if (typeof g.customElements === 'undefined') {
  const defs = new Map<string, unknown>();
  g.customElements = {
    get: (name: string) => defs.get(name),
    define: (name: string, ctor: unknown) => {
      defs.set(name, ctor);
    },
    whenDefined: async () => undefined,
  };
}

/**
 * Obsidian 运行在浏览器里，代码按官方建议用 `window.setTimeout`（弹窗窗口
 * 也能拿到正确的计时器）和全局 `createEl`。node 测试没有这两个，补最小实现：
 * window 指向 globalThis，createEl 延迟到调用时才取 document（DOM 桩可能在
 * 本文件之后才装）。
 */
if (typeof g.window === 'undefined') g.window = g;

if (typeof g.createEl === 'undefined') {
  g.createEl = (tag: string) => (g.document as Document).createElement(tag);
}
if (typeof g.createDiv === 'undefined') {
  g.createDiv = () => (g.document as Document).createElement('div');
}
if (typeof g.createSpan === 'undefined') {
  g.createSpan = () => (g.document as Document).createElement('span');
}
