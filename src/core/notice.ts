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

/**
 * 带一个按钮的提示条（目前只给「撤销归类」用）。
 *
 * Obsidian 的 Notice 收 `string | DocumentFragment`，所以按钮可以藏在片段里。
 * 它是壳层里唯一自带动作的提示：归类没有确认框挡着，点错一格只靠
 * 「自己记得再改回去」不可靠。
 *
 * 按钮类名以 `bzs-` 开头：构建时只给非 `bzs-` 的选择器套 `.bzs-shell`，
 * 而 Notice 挂在宿主 body 上、不在壳层里，套了前缀就匹配不到。
 */
export function notifyUndo(
  text: string,
  label: string,
  onUndo: () => void,
  timeout = 8000,
): void {
  let notice: Notice | null = null;
  const frag = document.createDocumentFragment();
  frag.append(text, ' ');
  const btn = document.createElement('button');
  btn.className = 'bzs-undo-btn';
  btn.textContent = label;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onUndo();
    /* 点完就收掉：留着一条已经点过的「撤销」会让人以为还能再撤一次 */
    notice?.hide();
  });
  frag.append(btn);
  notice = new Notice(frag, timeout);
}
