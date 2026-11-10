/* ============================================================
 * bz-reader · 知识盒链接的纯计算（data/kb-link.ts）
 *
 * 一条划线 → 知识盒里的名词 / 段落笔记。这里只管**数据形状**与字符串：
 *   · 一格一条：名词一格、段落一格，同类型再存是替换；
 *   · 显示名与导出用的双链写法。
 *
 * 单独成文件是为了不跟 deeplink / bz-bridge 缠在一起：deeplink 也要用它
 * 拼导出里的 `[[…]]`，若放在 kb-entry 里就会形成运行时循环 import
 * （kb-entry 又 import deeplink 的 protocolUrl）。
 * ============================================================ */
import type { KbLink } from './schema';

export type { KbLink };

/** 路径统一：反斜杠转正斜杠、去首尾空白。大小写与扩展名一律不动 */
export function cleanKbPath(v: unknown): string {
  /* 只认字符串：路径来自 bz 回传，类型上是 unknown；对象 String() 会变成
     "[object Object]"，宁可按空路径处理，也不要拿它去拼文件。 */
  if (typeof v !== 'string') return '';
  return v.trim().replace(/\\/g, '/');
}

/**
 * 写进一格：名词 / 段落各一条，同类型再存是**替换**而不是叠加。
 *
 * 空路径返回原列表（bz 某些失败路径会给空 notePath，不能因此把旧链接抹掉）。
 */
export function upsertKbLink(list: KbLink[] | undefined, next: KbLink): KbLink[] {
  const cur = Array.isArray(list) ? [...list] : [];
  const path = cleanKbPath(next.path);
  if (!path) return cur;
  const item: KbLink = { kind: next.kind, path, at: next.at || Date.now() };
  const at = cur.findIndex((x) => x.kind === next.kind);
  if (at >= 0) cur[at] = item;
  else cur.push(item);
  return cur;
}

/** 取某一格（名词 / 段落） */
export function kbLinkOf(list: KbLink[] | undefined, kind: KbLink['kind']): KbLink | undefined {
  return (list ?? []).find((x) => x.kind === kind);
}

/**
 * 工具条上那两颗该不该写「看名词 / 看段落」（2026-11-10）。
 *
 * 判据是**这条划线自己身上**有没有链接，不是「刚刚是不是点过」——
 * 划词时 `RT.selMarkId` 是空的，只按它判的话，刚存完名词再选中同一段，
 * 按钮还写着「存为名词」，点下去却打开了笔记。
 */
export function kbDoneOf(list: KbLink[] | undefined): { term: boolean; passage: boolean } {
  return { term: !!kbLinkOf(list, 'term'), passage: !!kbLinkOf(list, 'passage') };
}

/** 链接的显示名：笔记名（去 .md，取最后一段） */
export function kbLinkLabel(path: string): string {
  const p = cleanKbPath(path).replace(/\.md$/i, '');
  return p.split('/').pop() || '';
}

/**
 * 导出成 Markdown 用的双链：`[[文献/心流|心流]]`。
 *
 * 导出的是笔记库里的文件，`[[…]]` 由 Obsidian 自己解析成可点链接——
 * 和以前写进想法的那一行同一个写法，只是搬到了单独的位置。
 */
export function kbLinkMarkdown(path: string): string {
  const p = cleanKbPath(path).replace(/\.md$/i, '');
  if (!p) return '';
  const name = p.split('/').pop() || p;
  return `[[${p}|${name}]]`;
}
