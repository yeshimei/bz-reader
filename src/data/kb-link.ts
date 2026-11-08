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
  return String(v ?? '').trim().replace(/\\/g, '/');
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
