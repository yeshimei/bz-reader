/* ============================================================
 * bz-reader · 通知（core/notice.ts）
 *
 * 与 bz 主插件同口径：正文不带 emoji，只有类型影响观感。
 * 800ms 内同一条正文只弹一次——翻页失败、存盘失败这类高频路径上，
 * 不设去重时用户会被同一句话糊满屏。
 *
 * 返回值是句柄：摘要这类要跑十几秒的操作，进度条得手动收（timeout 传 0
 * 常驻，出结果时 hide()）。否则要么 3 秒就消失、看着像没点上，要么永远
 * 留在屏幕上关不掉。
 * ============================================================ */
import { Notice } from 'obsidian';

export type NoticeKind = 'info' | 'success' | 'error';

/** 关掉一条通知。被去重掉的重复调用拿到的是空句柄，hide() 什么也不做 */
export interface NoticeHandle {
  hide(): void;
}

const GONE: NoticeHandle = { hide: () => undefined };

let lastText = '';
let lastAt = 0;

export function notify(text: string, kind: NoticeKind = 'info', timeout?: number): NoticeHandle {
  const now = Date.now();
  if (text === lastText && now - lastAt < 800) return GONE;
  lastText = text;
  lastAt = now;
  const ms = timeout ?? (kind === 'error' ? 6000 : 3000);
  return new Notice(text, ms);
}

/**
 * 到点无条件收掉的通知：鼠标压在它上面也照走。
 *
 * Obsidian 的 Notice 悬停时会暂停倒计时（为了让人读完长通知）。但阅读页
 * 右上角那颗「生成摘要」按钮和通知的位置几乎重合：用户点完手没动，鼠标
 * 一直压在通知上，倒计时就永远不走——「摘要已生成」挂在那里，只有移开
 * 鼠标才消失，看起来就是一条关不掉的通知。
 *
 * 只给「刚点完的动作反馈」用；别的通知保持宿主原样，悬停暂停对它们是对的。
 */
export function notifyNow(text: string, kind: NoticeKind = 'info', ms?: number): NoticeHandle {
  const wait = ms ?? (kind === 'error' ? 6000 : 3000);
  const handle = notify(text, kind, wait);
  if (wait > 0 && typeof window !== 'undefined') {
    window.setTimeout(() => handle.hide(), wait);
  }
  return handle;
}

/** 一条会自己改字的常驻通知（2026-11-14 整本预生成用） */
export interface ProgressHandle {
  setMessage(text: string): void;
  hide(): void;
}

/**
 * 常驻进度通知：timeout 0，自己 hide()。
 *
 * 不走 `notify()`：那条路有 800ms 去重，而进度要每十段改一次字，
 * 撞上去重就会「跳到 30%，然后卡着不动」。
 */
export function notifyProgress(text: string): ProgressHandle {
  const n = new Notice(text, 0);
  return {
    setMessage: (next: string) => n.setMessage(next),
    hide: () => n.hide(),
  };
}
