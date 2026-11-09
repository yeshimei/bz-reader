/* ============================================================
 * bz-reader · 通知（core/notice.ts）
 *
 * 与 bz 主插件同口径：正文不带 emoji，只有类型影响观感。
 * 800ms 内同一条正文只弹一次——翻页失败、存盘失败这类高频路径上，
 * 不设去重时用户会被同一句话糊满屏。
 * ============================================================ */
import { Notice } from 'obsidian';

export type NoticeKind = 'info' | 'success' | 'error';

let lastText = '';
let lastAt = 0;

export function notify(text: string, kind: NoticeKind = 'info', timeout?: number): void {
  const now = Date.now();
  if (text === lastText && now - lastAt < 800) return;
  lastText = text;
  lastAt = now;
  const ms = timeout ?? (kind === 'error' ? 6000 : 3000);
  new Notice(text, ms);
}
