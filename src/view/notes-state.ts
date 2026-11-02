/* ============================================================
 * bz-reader · 标注的共享状态（view/notes-state.ts）
 *
 * 和 toc-state 同一个理由：书签与划线住在阅读视图里，展示在左侧栏里，
 * 两个视图谁先开、谁先关都说不准。所以只传快照 + 订阅，不互相拿实例。
 *
 * 一条额外纪律：**快照必须是新的数组引用**。侧栏靠引用判断「要不要重建
 * 列表」，如果阅读视图改完原数组直接 setNotes 同一个对象，侧栏会以为
 * 没变，表现是「划了一条线，侧栏里没有」。
 * ============================================================ */
import type { Bookmark, Highlight } from '../data/schema';

export interface NotesSnapshot {
  bookId: string;
  bookTitle: string;
  highlights: Highlight[];
  bookmarks: Bookmark[];
  /** 点条目时怎么跳（CFI），由阅读视图注入 */
  jump: (cfi: string) => void;
  removeHighlight: (id: string) => void;
  removeBookmark: (id: string) => void;
  /** 把这本书的划线/书签导出成一份笔记（写文件、弹结果提示都由阅读视图做） */
  exportNotes: () => void;
}

let snapshot: NotesSnapshot | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const cb of [...subscribers]) {
    try {
      cb();
    } catch {
      /* 单个订阅者出错不该连累其余 */
    }
  }
}

export function setNotes(next: NotesSnapshot): void {
  snapshot = next;
  notify();
}

export function clearNotes(): void {
  if (!snapshot) return;
  snapshot = null;
  notify();
}

export function getNotes(): NotesSnapshot | null {
  return snapshot;
}

export function subscribeNotes(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/** 侧栏点书签/划线时调；书已经关了就是空操作 */
export function jumpToCfi(cfi: string): void {
  snapshot?.jump(cfi);
}

/** 侧栏底部「导出」用；书已经关了就是空操作 */
export function exportNotes(): void {
  snapshot?.exportNotes();
}
