/* ============================================================
 * bz-reader · 划线 → 复习卡的交付（data/review-deliver.ts）
 *
 * 2026-11-11 起不再生成 Markdown：卡片内容直接交给 bz 的复习计划，躺在排期
 * 表里。理由是文件系统不该被「一句话笔记」占满——读十本书划八百条，库里就
 * 多八百篇碎片，搜索、图谱、文件列表全被污染。
 *
 * 所以这里只剩两件事：把一条划线组装成卡片，交给门面。
 * 纯数据层：不碰 UI、不弹通知，成败由调用方提示。
 * ============================================================ */
import type { ReaderBook, Highlight } from './schema';
import { t } from '../i18n';

/** 交给 bz 的一张卡（与 bz 门面的 ReviewCardInput 同形） */
export interface CardPayload {
  key: string;
  bookTitle: string;
  chapterTitle?: string;
  text: string;
  comment?: string;
  backlink?: string;
}

/** 卡片钥匙：一个库里唯一即可，不需要能被 vault 解析 */
export function cardKeyOf(book: ReaderBook, h: Highlight): string {
  return `reader:${book.id}:${h.id}`;
}

/** 原文最长这么多字：再长复习时那一屏就成了一篇文，不是复习 */
export const CARD_TEXT_MAX = 800;

/** 回到原文的链接；没有 cfi 就退回书本身 */
export function backlinkOf(book: ReaderBook, h: Highlight): string {
  const cfi = String(h.cfiRange ?? '').trim();
  const base = `obsidian://bz-reader?book=${encodeURIComponent(book.id)}`;
  return cfi ? `${base}&cfi=${encodeURIComponent(cfi)}` : base;
}

/**
 * 一条划线 → 一张卡。
 *
 * 带上「回到原文」的协议链接：复习时想看上下文点一下就回去，不需要卡片里
 * 再存一篇笔记的路径。
 */
export function cardOf(book: ReaderBook, h: Highlight): CardPayload {
  const chars = Array.from(String(h.text ?? '').trim());
  const cut = chars.length > CARD_TEXT_MAX ? `${chars.slice(0, CARD_TEXT_MAX).join('')}…` : chars.join('');
  const bookTitle = String(book.meta?.title ?? '').trim() || t('common.untitled');
  const chapter = String(h.chapterTitle ?? '').trim();
  const comment = String(h.comment ?? '').trim();
  return {
    key: cardKeyOf(book, h),
    bookTitle,
    ...(chapter ? { chapterTitle: chapter } : {}),
    text: cut,
    ...(comment ? { comment } : {}),
    backlink: backlinkOf(book, h),
  };
}
