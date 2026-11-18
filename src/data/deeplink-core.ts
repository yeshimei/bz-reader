/* ============================================================
 * bz-reader · 跳书协议的纯核心（data/deeplink-core.ts）
 *
 * protocolUrl / snippet / parseProtocolParams 本来在 deeplink.ts 里，但那个文件
 * 为了导出带翻译的链接文字要 import i18n（进而 import obsidian），导致「推卡时
 * 生成 backlink」这条纯数据链路没法在 node 单测里跑。
 *
 * 这里只放拼装与解析，deeplink.ts 原样 re-export——所有既有调用方的 import
 * 路径不变，协议格式也只有这一份。
 * ============================================================ */

/** 协议名：注册在 plugin.registerObsidianProtocolHandler('bz-reader', …) */
export const PROTOCOL = 'bz-reader';

export interface LinkTarget {
  bookId: string;
  /** EPUB CFI（首选定位于此） */
  cfi?: string;
  /** 原文前若干字，CFI 失效时用来搜 */
  text?: string;
  /** 章节标题，给降级搜索限定范围，也用来写链接文字 */
  chapter?: string;
  /** 章节内百分比 0..1，最后兜底 */
  pct?: number;
}

/** CFI 里塞全文会撑爆链接，20 字足够在章节里唯一定位一次 */
const SNIPPET = 20;

export function snippet(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET);
}

function enc(v: string | number | undefined): string | null {
  if (v === undefined || v === null || v === '') return null;
  return encodeURIComponent(String(v));
}

/** 生成 `obsidian://bz-reader?book=…&cfi=…&t=…&c=…&p=…` */
export function protocolUrl(t: LinkTarget): string {
  const q: string[] = [];
  const push = (k: string, v: string | number | undefined): void => {
    const e = enc(v);
    if (e) q.push(`${k}=${e}`);
  };
  push('book', t.bookId);
  push('cfi', t.cfi);
  push('t', t.text);
  push('c', t.chapter);
  push('p', t.pct);
  return `obsidian://${PROTOCOL}?${q.join('&')}`;
}

/**
 * 解析协议参数。Obsidian 传进来的值已经 decode 过，这里不要再 decode 一次，
 * 否则原文里的 `%` 会被二次解释成乱码。
 */
export function parseProtocolParams(p: Record<string, string> | null | undefined): LinkTarget | null {
  if (!p) return null;
  const bookId = p.book;
  if (!bookId) return null;
  const pct = p.p === undefined ? undefined : Number(p.p);
  return {
    bookId,
    cfi: p.cfi || undefined,
    text: p.t || undefined,
    chapter: p.c || undefined,
    pct: Number.isFinite(pct) ? pct : undefined,
  };
}
