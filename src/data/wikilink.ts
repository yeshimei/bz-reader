/* ============================================================
 * bz-reader · 双链（data/wikilink.ts）
 *
 * 一条划线 → `[[书.epub#bzr-cfi=epubcfi(…)|划线文字]]` → 点一下跳回原文那一句。
 *
 * deeplink.ts 当初判断「做不了双链」的理由只对了一半：
 *   `[[]]` 解析的是 vault 里的**文件**，不要求是 .md。书本来就是 vault 里的
 *   真实文件（`fileRef.vaultPath`），`[[书.epub]]` 天然可解析——不需要给
 *   每本书生成占位笔记。真正缺的只是：`#` 后面那段 Obsidian 不认识，点了
 *   不会跳到那一句。这一步由 shell/link-postprocessor.ts 拦截点击补上。
 *
 * 代价（所以 obsidian:// 那条路必须留着）：
 *   Live Preview 里 post-processor 不跑，点开的是书、落到上次阅读位置而不是
 *   那一句；老链接也早就散在用户笔记里了。
 *
 * 定位仍然做三级降级，和 obsidian:// 那条路同源：
 *   CFI 精确跳 → 章节内搜原文片段 → 章节百分比。
 * ============================================================ */
import { formatOf } from './book-repo';
import { cleanLabel, snippet, type LinkTarget, type LinkTextInput } from './deeplink';
import type { Highlight, ReaderBook } from './schema';

/** 子路径前缀。只有以它开头的 `#…` 才是本插件写的定位串。 */
const PREFIX = 'bzr-';

/**
 * CFI 里会撑破 wikilink 语法的三个字符：
 * `]` 会提前闭合 `[[…]]`，`|` 是别名分隔符，`[` 会让 Obsidian 的解析歧义。
 * 只转这三个，`/` `(` `,` `:` 保持原样——CFI 本来就长，全编码没法看。
 */
export function escapeForWikilink(v: string): string {
  return v.replace(/\[/g, '%5B').replace(/\]/g, '%5D').replace(/\|/g, '%7C');
}

export function unescapeForWikilink(v: string): string {
  return v.replace(/%5B/gi, '[').replace(/%5D/gi, ']').replace(/%7C/gi, '|');
}

/** `decodeURIComponent` 遇到半截编码不抛错，原样退回 */
function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** 子路径里能带的定位字段（bookId 不进链接，按路径查书是调用方的事） */
export type LocatorFields = Pick<LinkTarget, 'cfi' | 'text' | 'chapter' | 'pct'>;

/**
 * 定位子路径：`bzr-cfi=…&t=…&c=…&p=…`。
 * 没有 CFI 时以 `bzr-t=` 开头——两种都算「本插件的」，靠 `bzr-` 前缀认。
 */
export function subpathOf(t: LocatorFields): string {
  const cfi = t.cfi?.trim();
  const text = t.text?.trim();
  const chapter = t.chapter?.trim();
  const parts: string[] = [];
  if (cfi) parts.push(`cfi=${escapeForWikilink(cfi)}`);
  if (text) parts.push(`t=${encodeURIComponent(text)}`);
  if (chapter) parts.push(`c=${encodeURIComponent(chapter)}`);
  if (t.pct !== undefined && Number.isFinite(t.pct)) parts.push(`p=${t.pct}`);
  if (!parts.length) return '';
  return PREFIX + parts.join('&');
}

export interface ParsedWikilink {
  /** 书文件在 vault 里的相对路径 */
  vaultPath: string;
  /** 定位（不含 bookId——调用方按 vaultPath 去 BookRepo 里查） */
  target: Omit<LinkTarget, 'bookId'>;
}

/**
 * 从链接地址还原定位。`书/某书.epub#bzr-cfi=…` → { vaultPath, target }。
 *
 * 只认自家子路径：普通笔记链接、别的插件写的锚点、obsidian:// 老链接
 * 一律返回 null，让调用方交给 Obsidian 默认处理。
 */
export function parseWikilinkHref(href: string): ParsedWikilink | null {
  const raw = String(href || '').trim();
  if (!raw) return null;
  const hash = raw.indexOf('#');
  /* `#` 在 0 位说明没有路径；没有 `#` 说明不是带定位的链接 */
  if (hash <= 0) return null;

  const vaultPath = raw.slice(0, hash);
  const subpath = raw.slice(hash + 1);
  if (!subpath.startsWith(PREFIX)) return null;
  /* 只认书文件：笔记的 .md、附件的 .png 都不该被当成书 */
  if (!formatOf(vaultPath)) return null;

  const params = new Map<string, string>();
  for (const part of subpath.slice(PREFIX.length).split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    params.set(part.slice(0, eq), part.slice(eq + 1));
  }

  const cfi = params.get('cfi');
  const text = params.get('t');
  /* 既没 CFI 也没原文片段 = 定位不了，不如不拦，交给默认行为 */
  if (!cfi && !text) return null;

  const chapter = params.get('c');
  const pctRaw = params.get('p');
  const pct = pctRaw === null || pctRaw === undefined ? undefined : Number(pctRaw);

  return {
    vaultPath,
    target: {
      cfi: cfi ? unescapeForWikilink(cfi) : undefined,
      text: text ? safeDecode(text) : undefined,
      chapter: chapter ? safeDecode(chapter) : undefined,
      pct: Number.isFinite(pct) ? pct : undefined,
    },
  };
}

function displayName(book: ReaderBook): string {
  return book.meta.title?.trim() || '未命名';
}

/**
 * 别名里的竖线要转义：`[[路径#子路径|A|B]]` 会把第二个竖线之前都当别名，
 * 剩下的被吞掉。方括号由 cleanLabel 统一清（`]` 会提前闭合）。
 */
function aliasOf(v: string): string {
  return v.replace(/\|/g, '\\|');
}

/**
 * 底层拼装：一个定位 + 一句显示文字 → `[[路径#定位|文字]]`。
 * 显示文字为空或定位字段全空时返回空串，由调用方决定怎么退。
 */
export function wikilinkTo(book: ReaderBook, fields: LocatorFields, label: string): string {
  const sub = subpathOf(fields);
  if (!sub) return '';
  const text = aliasOf(cleanLabel(label));
  if (!text) return '';
  return `[[${book.fileRef.vaultPath}#${sub}|${text}]]`;
}

/**
 * 划词 / 划线 → `[[书路径#定位|别名]]`。
 *
 * 别名与 obsidian:// 那条路同一套清洗（cleanLabel / snippet），
 * 免得同一条划线在两种格式下显示得不一样。
 */
export function wikilinkOf(book: ReaderBook, input: LinkTextInput): string {
  const label = cleanLabel(input.text) || `《${displayName(book)}》`;
  return wikilinkTo(
    book,
    {
      cfi: input.cfiRange,
      text: snippet(input.text),
      chapter: input.chapterTitle?.trim() || undefined,
    },
    label,
  );
}

export function wikilinkOfMark(book: ReaderBook, h: Highlight): string {
  return wikilinkOf(book, { text: h.text, cfiRange: h.cfiRange, chapterTitle: h.chapterTitle });
}
