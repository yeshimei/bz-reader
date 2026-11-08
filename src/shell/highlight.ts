/* ============================================================
 * bz-reader · 搜索命中高亮（shell/highlight.ts）
 *
 * 纯字符串函数：把关键词命中的片段包进 <em>，其余原样转义。
 * 为什么不能「先 esc 再找词」：`&amp;` 比 `&` 长，下标会错位，标签就插进
 * 实体中间（界面上出现半截 `&<em>amp</em>;`）。这里按原文切段，再逐段转义。
 * ============================================================ */
import { esc } from './render/html';

export function highlightEscaped(text: string, keyword: string): string {
  const src = String(text ?? '');
  const needle = String(keyword ?? '').trim();
  if (!needle) return esc(src);

  const lower = src.toLowerCase();
  const target = needle.toLowerCase();
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const i = lower.indexOf(target, at);
    if (i < 0) break;
    out.push(esc(src.slice(at, i)));
    out.push(`<em>${esc(src.slice(i, i + target.length))}</em>`);
    at = i + target.length;
  }
  out.push(esc(src.slice(at)));
  return out.join('');
}
