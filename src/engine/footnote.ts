/* ============================================================
 * bz-reader · 脚注判定与正文提取（engine/footnote.ts）
 *
 * 原来这两件事直接写在 engine/host.ts 里，只有一条通道：
 *   `book.resolveHref()` → `section.createDocument()` → `anchor(doc).textContent`
 * 真机上大量脚注读不出来，原因都在这条通道的假设上：
 *   · `epub:type="noteref"` 在 HTML 解析路径下只剩字面属性，`getAttributeNS`
 *     拿不到，第一档判据直接失效；
 *   · 中文出版物的序号是「注1」「[1]」「①」，原正则只收阿拉伯数字；
 *   · 目标 id 常打在 `<li>` / `<aside>` 上，也可能错打在回链 `<sup>` 里，
 *     取 `textContent` 会得到空串、箭头或整页注文；
 *   · 注释页不在 spine 里时 `index` 是 -1，原实现直接放弃。
 *
 * 这里把判定与提取拆成不依赖 foliate / Obsidian 的纯逻辑，节点用只读的
 * `FNode` 树（结构见下），便于单测。宿主负责把 DOM 转成 FNode、按 href
 * 找章节、加载 Document；怎么判断、怎么抠字，全在这个文件里。
 *
 * 判定与评分移植自同目录 weave 的实现（fork-weave-src 的 footnote-preview），
 * 那里已经用真实书踩过这些坑。
 * ============================================================ */

const OPS_NS = 'http://www.idpf.org/2007/ops';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

/** 文本节点在 FNode 树里的 tag */
export const TEXT_TAG = '#text';

/**
 * 极简节点树。元素节点带 `tag` / `attrs` / `children`；文本节点只有 `text`。
 * `parent` 由构建方回填，用来向上找注文容器；`ancestors` 仅转换锚点时填
 * （判断 `<sup><a>` 这种老写法）。
 */
export interface FNode {
  tag: string;
  text?: string;
  attrs?: Record<string, string>;
  children?: FNode[];
  parent?: FNode;
  ancestors?: string[];
}

/** 注文的展示上限：浮窗只有一小块，再长就该「跳到原文」 */
const FOOTNOTE_PREVIEW_MAX = 220;
/** 一页注文里回链超过这个数，说明目标指向的是整页而不是单条 */
const MULTI_NOTE_BACKREFS = 1;

/** 容器候选：注文一般落在这些块级元素上 */
const CONTAINER_TAGS = new Set([
  'li',
  'aside',
  'section',
  'article',
  'dd',
  'dt',
  'blockquote',
  'p',
  'div',
  'span',
]);

/** 这些元素前后要留空格，否则两段注文会黏成一串 */
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'td',
  'th',
  'tr',
  'ul',
]);

const SEMANTIC_ROLE = new Set(['doc-footnote', 'doc-endnote', 'doc-footnotes', 'doc-endnotes']);
const SEMANTIC_TYPE = new Set(['footnote', 'footnotes', 'endnote', 'endnotes', 'rearnote', 'rearnotes']);
const FOOTNOTE_KEYWORD = /(?:footnote|footnotes|endnote|endnotes|rearnote|rearnotes|backnote|backnotes|notes?)/i;

/**
 * 纯脚注序号标签——中文出版 EPUB 的各类序号形态：
 * 数字（半/全角）、中文数字、圈号（①…⑳ 与 ㉑…㊿）、符号（* † ‡ § ¶）、
 * 可选「注」前缀与常见的配对括号。
 */
const MARK_LABEL_PATTERN =
  /^(?:注\s*)?[[（(【〔「『]?(?:[0-9０-９]+|[一二三四五六七八九十百零〇两]{1,4}|[\u2460-\u249B\u3251-\u325F\u32B1-\u32BF]{1,2}|[*＊†‡§¶]{1,3})[\]）)】〕」』]?$/;

/** href 片段像脚注锚点：fn1 / note-12 / footnote_3 / zhushi2 */
const FRAGMENT_MARK_PATTERN = /(?:^|[-_:.])(?:fn|footnote|endnote|note|zhu|zhushi)\d*/i;
/** href 路径像注文页：notes.xhtml / endnotes/… / footnote_2.html */
const PATH_MARK_PATTERN = /(?:^|[\\/_-])(?:footnote|endnote|notes?)(?:[\\/_.-]|$)/i;

function attr(node: FNode, name: string): string {
  return node.attrs?.[name] ?? '';
}

function normalizeFootnoteText(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 原始文本（不跳回链）：锚点序号用 */
function rawText(node: FNode | null): string {
  if (!node) return '';
  if (node.tag === TEXT_TAG) return node.text ?? '';
  let out = '';
  for (const child of node.children ?? []) out += rawText(child);
  return out;
}

function isBackref(node: FNode): boolean {
  if (node.tag !== 'a') return false;
  const cls = attr(node, 'class');
  const href = attr(node, 'href');
  const role = attr(node, 'role');
  return (
    cls.includes('footnote-backref') ||
    href.includes('#fnref') ||
    href.includes('#ref') ||
    role === 'doc-backlink'
  );
}

function countBackrefs(node: FNode): number {
  let count = 0;
  for (const child of node.children ?? []) {
    if (child.tag === TEXT_TAG) continue;
    if (isBackref(child)) count += 1;
    count += countBackrefs(child);
  }
  return count;
}

/** 注文正文：跳回链、块级之间留空格 */
function footnoteTextOf(node: FNode | null): string {
  if (!node) return '';
  const out: string[] = [];
  collectFootnoteText(node, out);
  return normalizeFootnoteText(out.join(''));
}

function collectFootnoteText(node: FNode, out: string[]): void {
  if (node.tag === TEXT_TAG) {
    out.push(node.text ?? '');
    return;
  }
  if (isBackref(node)) return;
  const block = BLOCK_TAGS.has(node.tag);
  if (block) out.push(' ');
  for (const child of node.children ?? []) collectFootnoteText(child, out);
  if (block) out.push(' ');
}

function hasAncestorTag(node: FNode, tag: string): boolean {
  if (node.ancestors?.includes(tag)) return true;
  let cur = node.parent ?? null;
  while (cur) {
    if (cur.tag === tag) return true;
    cur = cur.parent ?? null;
  }
  return false;
}

function isExternalHref(href: string): boolean {
  return /^(?:https?:|mailto:|tel:|javascript:)/i.test(href);
}

function isMarkLabel(label: string): boolean {
  return MARK_LABEL_PATTERN.test(label);
}

function signalText(node: FNode): string {
  return ['role', 'epub:type', 'type', 'class', 'rel', 'aria-describedby', 'aria-label', 'title']
    .map((name) => attr(node, name))
    .join(' ')
    .toLowerCase();
}

function hrefPathOf(href: string): string {
  const hash = href.indexOf('#');
  return hash < 0 ? href : href.slice(0, hash);
}

/**
 * 这个 `<a>` 是不是脚注引用？
 *
 * 判据从硬到软（顺序沿用 weave）：
 *  1. `<a>` 上带 noteref / footnote / endnote 语义（role、epub:type、class…）；
 *  2. href 片段像 fn1 / note-12；
 *  3. href 路径像 notes.xhtml；
 *  4. 链接文字就是「[1]」「注一」「①」这种纯序号；
 *  5. 老书写法：被 `<sup>` 包着。
 *
 * 前提是 href 必须带 `#`：没有书内锚点的链接不可能是注释。
 * 误判成脚注的代价是「点章节互链弹出一小窗」，而漏判是「点了直接跳走，
 * 读者回不来」——所以宁可多认，但外链与无锚点链接一律不碰。
 */
export function isFootnoteRef(a: FNode | null): boolean {
  if (!a || a.tag !== 'a') return false;
  const href = attr(a, 'href').trim();
  if (!href || !href.includes('#') || isExternalHref(href)) return false;

  if (/noteref|footnote|endnote/.test(signalText(a))) return true;

  const path = hrefPathOf(href);
  if (PATH_MARK_PATTERN.test(path)) return true;

  const { fragment } = splitFootnoteHref(href);
  if (fragment && FRAGMENT_MARK_PATTERN.test(fragment)) return true;

  if (isMarkLabel(normalizeFootnoteText(rawText(a)))) return true;

  if (hasAncestorTag(a, 'sup')) return true;

  return false;
}

/** 把 href 拆成「章节路径 + 片段」，片段做一次 URL 解码（中文 id 常见） */
export function splitFootnoteHref(href: string): { path: string; fragment: string } {
  const raw = String(href ?? '').trim();
  const hash = raw.indexOf('#');
  if (hash < 0) return { path: raw, fragment: '' };
  const path = raw.slice(0, hash);
  let fragment = raw.slice(hash + 1);
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    /* 坏编码就按原文用 */
  }
  return { path, fragment };
}

export interface FragmentLookupDoc {
  getElementById?: (id: string) => unknown;
  getElementsByTagName?: (name: string) => ArrayLike<unknown>;
}

/**
 * 在文档里找 fragment 指向的元素。
 *
 * 先 `getElementById`；找不到再遍历查 `name` / `xml:id`——老 EPUB 常把
 * 注释锚点写成 `<a name="fn1">`，或 id 用 `xml:id` 声明。
 */
export function findFragmentTarget(doc: FragmentLookupDoc | null, fragment: string): Element | null {
  const id = String(fragment ?? '').trim();
  if (!doc || !id) return null;
  if (typeof doc.getElementById === 'function') {
    const found = doc.getElementById(id);
    if (found) return found as Element;
  }
  const elements = typeof doc.getElementsByTagName === 'function' ? doc.getElementsByTagName('*') : [];
  for (const raw of Array.from(elements)) {
    const el = raw as Element;
    if (!el || typeof el.getAttribute !== 'function') continue;
    if (el.getAttribute('id') === id || el.getAttribute('name') === id || el.getAttribute('xml:id') === id) {
      return el;
    }
  }
  return null;
}

/**
 * 把 href 的路径对到章节序号上。
 *
 * 不用 `book.resolveHref()` 的 index 直接取 `sections[index]`：foliate 的
 * sections 是 `spine.map(...).filter(Boolean)`，只要有一章缺项，spine 下标
 * 与 sections 下标就错位，会读到别的章。这里按 section.id 自己找。
 */
export function matchSectionIndex(sections: ArrayLike<{ id?: string }>, path: string): number {
  const raw = String(path ?? '').trim();
  if (!raw) return -1;
  const norm = (value: string): string => {
    let text = String(value ?? '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\/+/, '');
    try {
      text = decodeURIComponent(text);
    } catch {
      /* 坏编码按原文比 */
    }
    return text.toLowerCase();
  };
  const target = norm(raw);
  const list = Array.from(sections);
  const exact = list.findIndex((section) => norm(String(section?.id ?? '')) === target);
  if (exact >= 0) return exact;
  const base = target.split('/').pop() ?? '';
  if (!base) return -1;
  return list.findIndex((section) => (norm(String(section?.id ?? '')).split('/').pop() ?? '') === base);
}

/**
 * 一条脚注该去哪个章节找。
 *
 * 三步，顺序不能反：
 *  1. href 带路径：按 section.id 对；
 *  2. href 只有 `#fragment`（同文件锚点）：就在当前章节找——别全书扫，
 *     很多书每章都有 `#fn1`，先扫到别章会取错注文；
 *  3. 路径对不上时退回 foliate 给的 spine 下标（它可能因 spine 过滤错位，
 *     但总比不找好）。
 */
export function chooseSectionIndex(options: {
  sections: ArrayLike<{ id?: string }>;
  path: string;
  currentIndex: number;
  resolvedIndex: number;
}): number {
  const { sections, path, currentIndex, resolvedIndex } = options;
  const valid = (index: number): boolean => index >= 0 && index < sections.length;
  const byHref = matchSectionIndex(sections, path);
  if (byHref >= 0) return byHref;
  if (!path && valid(currentIndex)) return currentIndex;
  if (valid(resolvedIndex)) return resolvedIndex;
  return -1;
}

/** 去掉首尾括号与标点后的可比较形式 */
function comparableLabel(text: string): string {
  return normalizeFootnoteText(text)
    .replace(/^[[(（【〔「『]+/, '')
    .replace(/[\])）】〕」』.,;:、，。]+$/g, '')
    .toLowerCase();
}

function isMeaningfulFootnoteText(text: string, label = ''): boolean {
  const normalized = normalizeFootnoteText(text);
  if (!normalized) return false;
  const comparableText = comparableLabel(normalized);
  const comparable = comparableLabel(label);
  if (comparableText && comparable && comparableText === comparable) return false;
  return !/^[[(（【〔「『\])）】〕」』*†‡§#\d\s.,;:!?、，。．·‧…-]+$/.test(normalized);
}

/** 去掉注文开头的序号（「1. 」「[12] 」「注一 」），最多两轮，避免误吃正文 */
function stripLeadingLabel(text: string, label: string): string {
  const normalized = normalizeFootnoteText(text);
  const comparable = comparableLabel(label);
  if (!normalized || !comparable) return normalized;
  const escaped = comparable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefix = new RegExp(
    `^[\\s[(（【〔「『<]*${escaped}[\\s\\])）】〕」』>.:：;；、，。．·‧…-]*`,
    'i',
  );
  let cleaned = normalized;
  for (let round = 0; round < 2; round += 1) {
    const next = cleaned.replace(prefix, '').trim();
    if (!next || next === cleaned) break;
    cleaned = next;
  }
  return cleaned;
}

function truncateFootnoteText(text: string, max = FOOTNOTE_PREVIEW_MAX): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function isSemanticFootnoteElement(node: FNode): boolean {
  if (SEMANTIC_ROLE.has(attr(node, 'role').trim().toLowerCase())) return true;
  const type = attr(node, 'epub:type') || attr(node, 'type');
  if (
    type
      .split(/\s+/)
      .filter(Boolean)
      .some((token) => SEMANTIC_TYPE.has(token.trim().toLowerCase()))
  ) {
    return true;
  }
  const className = attr(node, 'class');
  const id = attr(node, 'id') || attr(node, 'xml:id');
  return FOOTNOTE_KEYWORD.test(className) || FOOTNOTE_KEYWORD.test(id);
}

function isContainerCandidate(node: FNode): boolean {
  return isSemanticFootnoteElement(node) || CONTAINER_TAGS.has(node.tag);
}

function elementSiblings(node: FNode): FNode[] {
  return (node.parent?.children ?? []).filter((child) => child.tag !== TEXT_TAG);
}

function nextElementSibling(node: FNode): FNode | null {
  const siblings = elementSiblings(node);
  const index = siblings.indexOf(node);
  return index >= 0 ? siblings[index + 1] ?? null : null;
}

function previousElementSibling(node: FNode): FNode | null {
  const siblings = elementSiblings(node);
  const index = siblings.indexOf(node);
  return index > 0 ? siblings[index - 1] ?? null : null;
}

function closestContainer(node: FNode | null): FNode | null {
  let cur = node;
  while (cur) {
    if (isContainerCandidate(cur)) return cur;
    cur = cur.parent ?? null;
  }
  return null;
}

function descendants(node: FNode): FNode[] {
  const out: FNode[] = [];
  const walk = (current: FNode): void => {
    for (const child of current.children ?? []) {
      if (child.tag === TEXT_TAG) continue;
      out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

function contains(ancestor: FNode, node: FNode): boolean {
  let cur: FNode | null = node;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parent ?? null;
  }
  return false;
}

function domDistance(target: FNode, candidate: FNode): number {
  let distance = 0;
  let cur: FNode | null = target;
  while (cur) {
    if (cur === candidate) return distance;
    cur = cur.parent ?? null;
    distance += 1;
  }
  cur = candidate;
  while (cur) {
    if (cur === target) return distance;
    cur = cur.parent ?? null;
    distance += 1;
  }
  return distance + 4;
}

function collectCandidates(target: FNode): FNode[] {
  const list: FNode[] = [];
  const seen = new Set<FNode>();
  const push = (node: FNode | null | undefined): void => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    list.push(node);
  };

  push(target);
  push(closestContainer(target));

  let cur: FNode | null = target;
  for (let depth = 0; cur && depth < 4; depth += 1) {
    const parent: FNode | null = cur.parent ?? null;
    push(parent);
    push(parent ? closestContainer(parent) : null);
    push(nextElementSibling(cur));
    push(previousElementSibling(cur));
    push(parent ? nextElementSibling(parent) : null);
    push(parent ? previousElementSibling(parent) : null);
    cur = parent;
  }

  let added = 0;
  for (const child of descendants(target)) {
    if (!isContainerCandidate(child)) continue;
    push(child);
    added += 1;
    if (added >= 24) break;
  }

  return list;
}

function tagScore(tag: string): number {
  switch (tag) {
    case 'li':
      return 34;
    case 'p':
      return 26;
    case 'dd':
      return 22;
    case 'blockquote':
      return 18;
    case 'aside':
    case 'article':
      return 16;
    case 'section':
      return 12;
    case 'div':
      return 8;
    case 'span':
      return -4;
    default:
      return 0;
  }
}

function lengthScore(length: number): number {
  if (length >= 8 && length <= 320) return 22;
  if (length <= 520) return 10;
  if (length <= 900) return -4;
  return -Math.min(36, Math.floor((length - 900) / 80) + 8);
}

function scoreCandidate(node: FNode, target: FNode, text: string, label: string): number {
  let score = 0;
  if (node === target) score += 32;
  /* 只给「包住 target 的祖先」加分；target 自身已经拿过 32，别重复加 */
  if (contains(node, target) && node !== target) score += 24;
  if (isSemanticFootnoteElement(node)) score += 36;
  const backrefs = countBackrefs(node);
  if (backrefs > 0) score += 10;
  /* 一页注文（多个回链）不是一条注：压下去，让单条 li/aside 胜出 */
  if (backrefs > MULTI_NOTE_BACKREFS) score -= 48;
  score += tagScore(node.tag);
  score += lengthScore(text.length);
  score -= domDistance(target, node) * 4;
  const comparableText = comparableLabel(text);
  const comparable = comparableLabel(label);
  if (comparableText && comparable && comparableText.startsWith(comparable)) score += 6;
  if ((node.children ?? []).some((child) => ['p', 'li', 'dd', 'blockquote'].includes(child.tag))) {
    score += 6;
  }
  return score;
}

/**
 * 从目标元素里抠出一条注文。
 *
 * 目标可能不是注文本身（id 打在回链上、打在整页容器上），所以先收集
 * 「目标 + 最近容器 + 上下兄弟 + 后代容器」做评分，选文本最像一条注文的。
 * 回链会剔掉、开头的序号会去掉，超过 220 字截断。
 *
 * 找不到像样的正文返回 null，宿主据此退回「直接跳过去」。
 */
export function resolveFootnoteText(target: FNode | null, label = ''): string | null {
  if (!target) return null;
  const candidates: Array<{ node: FNode; text: string }> = [];
  for (const node of collectCandidates(target)) {
    const text = footnoteTextOf(node);
    if (!isMeaningfulFootnoteText(text, label)) continue;
    /* 只剩一个序号锚点的 <a> 本身不是注文 */
    if (node.tag === 'a' && (node.children?.length ?? 0) === 0 && text.length <= 8) continue;
    candidates.push({ node, text });
  }
  if (!candidates.length) return null;

  /* 一页注文（多个回链）不是一条注：只要还有单条候选，就不看整页 */
  const single = candidates.filter(({ node }) => countBackrefs(node) <= MULTI_NOTE_BACKREFS);
  const pool = single.length ? single : candidates;

  /* 语义上就是注文的元素（<aside epub:type="footnote">、role=doc-footnote）优先，
     不能因为它的外层 div 包着 target 就选外层。 */
  const semantic = pool.filter(({ node }) => isSemanticFootnoteElement(node));
  const finalPool = semantic.length ? semantic : pool;

  let best: { text: string; score: number } | null = null;
  for (const { node, text } of finalPool) {
    const score = scoreCandidate(node, target, text, label);
    if (!best || score > best.score) best = { text, score };
  }
  if (!best) return null;
  const cleaned = stripLeadingLabel(best.text, label);
  return truncateFootnoteText(cleaned || best.text);
}

/**
 * 真实 DOM 元素 → FNode 树。
 *
 * 只读取不修改；`attributes` 遍历时把名字压成小写（HTML 解析下是
 * `epub:type`，XML 下 `getAttributeNS` 才有值，两条路都收）。
 */
export function domToFNode(el: Element, opts: { ancestors?: string[] } = {}): FNode {
  const node = convertDomNode(el);
  if (opts.ancestors?.length) node.ancestors = opts.ancestors.map((tag) => tag.toLowerCase());
  return node;
}

function convertDomNode(node: Node | null): FNode {
  if (!node) return { tag: TEXT_TAG, text: '' };
  if (node.nodeType === 3) return { tag: TEXT_TAG, text: node.nodeValue ?? '' };
  const el = node as Element;
  const attrs: Record<string, string> = {};
  const list = el.attributes as unknown as ArrayLike<{ name: string; value: string }> | undefined;
  if (list) {
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i];
      if (item) attrs[String(item.name).toLowerCase()] = String(item.value);
    }
  }
  try {
    const opsType = el.getAttributeNS?.(OPS_NS, 'type');
    if (opsType && !attrs['epub:type']) attrs['epub:type'] = opsType;
    const xmlId = el.getAttributeNS?.(XML_NS, 'id');
    if (xmlId && !attrs['xml:id']) attrs['xml:id'] = xmlId;
  } catch {
    /* 非 XML 文档可能没有命名空间 API，忽略 */
  }
  const out: FNode = { tag: (el.tagName ?? '').toLowerCase(), attrs, children: [] };
  const children = el.childNodes;
  if (children) {
    for (let i = 0; i < children.length; i += 1) {
      const child = convertDomNode(children[i] ?? null);
      child.parent = out;
      out.children!.push(child);
    }
  }
  return out;
}
