/* ============================================================
 * bz-reader · 知识库录入的对接细则（data/kb-entry.ts）
 *
 * 划词条上「存为名词 / 存为段落」点下去之后，真正跨插件的那一步在
 * `data/bz-bridge.ts`；这里只放两件需要被测试锁住的纯计算：
 *
 *   1. **来源怎么给**：书名做显示名、协议串做定位。bz 保存的是
 *      `obsidian://bz-reader?book=…&cfi=…`，点开能回到原句（bz 侧 ADR-0294）。
 *   2. **想法怎么写回**：写入成功后给这条划线挂一枚双链。已经有想法的，
 *      追加一行而不是覆盖——那是用户自己写的东西，不能因为存了一次名词就没了。
 * ============================================================ */
import { protocolUrl } from './deeplink';
import type { BzEntryOptions } from './bz-bridge';

export interface KbTarget {
  text: string;
  cfiRange?: string;
  chapterTitle?: string;
}

/**
 * 交给 bz 的来源。
 *
 * `path` 是协议串而不是库内路径：来源 chip 上写的是书名，点开走协议回到原文，
 * 比「一个名字叫书名的、点开说文件不存在的链接」有用得多。
 */
export function kbSource(bookId: string, bookTitle: string, target: KbTarget): BzEntryOptions['source'] {
  return {
    kind: 'note',
    path: protocolUrl({
      bookId,
      cfi: target.cfiRange || undefined,
      text: target.text,
      chapter: target.chapterTitle?.trim() || undefined,
    }),
    name: bookTitle || undefined,
  };
}

/** 双链正文：去 `.md`，别名用笔记名（与 Obsidian 自动补全的口径一致） */
export function kbThought(notePath: string): string {
  const path = String(notePath ?? '').trim().replace(/\\/g, '/');
  const bare = path.replace(/\.md$/i, '');
  const name = bare.split('/').pop() || bare;
  return bare ? `[[${bare}|${name}]]` : '';
}

/**
 * 把双链并进现有想法。
 *
 * 已经有这枚链接就原样返回（重复点两次不该叠两行）；空想法就是一行链接。
 */
export function mergeThought(prev: string | undefined | null, link: string): string {
  const before = String(prev ?? '').trim();
  if (!link) return before;
  if (!before) return link;
  if (before.includes(link)) return before;
  return `${before}\n${link}`;
}
