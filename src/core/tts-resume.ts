/* ============================================================
 * bz-reader · 朗读续听位置（core/tts-resume.ts）
 *
 * 「上次听到第 37 句」这件事要跨翻页、跨切标签、跨重开书活下来，所以
 * 记录落在插件数据里（settings），不放在视图内存。视图只管「要不要显示
 * 那个浮窗」，恢复位置的判断全在这里——纯函数，node 里可测。
 *
 * 恢复**不拿文本去 DOM 里搜**（那是 2026-11-14 明确否掉的方案：同一块里
 * 的重复短语会命到别处）。这里只在**脚本块**里按「块序号 + 块内偏移」
 * 对位；正文改过、对不上才退回「拿这一句的原文在这一块里 indexOf」，
 * 再对不上就交给调用方退回页首——宁可少念一句，不可跳到别处。
 * ============================================================ */

import type { PageAnchor, ScriptBlock } from './tts-script';

/** 一条续听记录：哪个库的哪本书、哪一章、哪一句，以及恢复用的锚点 */
export interface TtsResumePoint {
  bookId: string;
  /** 章名（可能为空：TXT / 有些书没有目录） */
  chapterTitle: string;
  /** 目录序号，-1 = 不知道 */
  chapterIndex: number;
  /** 块序号（与 `currentChapterBlocks()` 同一套遍历） */
  block: number;
  /** 块内偏移：建脚本时按原始 textContent 算的 */
  at: number;
  /** 这一句在原始文本里的长度 */
  len: number;
  /** 这一句的文本，锚点对不上时用它兜底 */
  text: string;
  /** 0-based 句号；界面显示时 +1 */
  index: number;
  /** 这一章共几句 */
  total: number;
  updatedAt: number;
}

/** 章的身份：标题 + 目录序号，两个都拿来比（一个可能改，一个可能错） */
export interface ResumeChapter {
  title: string;
  index: number;
}

function int(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : Number.NaN;
}

/**
 * 从落盘的原始值还原一条记录；坏值一律 null。
 *
 * 宁可不显示「继续听」，也不要拿半条记录去跳页——跳错地方比不跳更糟。
 */
export function normalizeTtsResume(raw: unknown): TtsResumePoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<TtsResumePoint>;
  const bookId = typeof r.bookId === 'string' ? r.bookId.trim() : '';
  if (!bookId) return null;
  const index = int(r.index);
  const total = int(r.total);
  const block = int(r.block);
  const at = int(r.at);
  const len = int(r.len);
  if (!(index >= 0) || !(total >= 0) || !(block >= 0) || !(at >= 0) || !(len >= 0)) return null;
  return {
    bookId,
    chapterTitle: typeof r.chapterTitle === 'string' ? r.chapterTitle.trim() : '',
    chapterIndex: int(r.chapterIndex),
    block,
    at,
    len,
    text: typeof r.text === 'string' ? r.text : '',
    index,
    total,
    updatedAt: int(r.updatedAt) || 0,
  };
}

/**
 * 这条记录是不是当前这一章。
 *
 * 标题或目录序号任一相同就算同章：目录重排过（序号变了、章名没变）和
 * 章名改过（章名变了、序号没变）都还在同一章。两个都无效时判否——不然
 * 一本没有目录的 TXT 和另一本也会「同章」。
 */
export function sameChapter(point: Pick<TtsResumePoint, 'chapterTitle' | 'chapterIndex'>, chapter: ResumeChapter): boolean {
  const title = String(chapter.title ?? '').trim();
  if (title && point.chapterTitle === title) return true;
  const index = int(chapter.index);
  return Number.isFinite(index) && index >= 0 && point.chapterIndex === index;
}

const squash = (s: string): string => String(s ?? '').replace(/\s+/g, '');

/**
 * 续听记录 → 脚本锚点（块序号 + 块内偏移）。
 *
 * 三级：换章直接放弃 → 原位对得上就用原位 → 按原文找回来。
 * 返回 null 表示「这一句已经定位不到了」，调用方退回这一页第一句。
 */
export function resumeAnchorOf(
  point: TtsResumePoint,
  blocks: readonly ScriptBlock[],
  chapter: ResumeChapter,
): PageAnchor | null {
  if (!sameChapter(point, chapter)) return null;
  const want = squash(point.text);
  if (!want) return null;

  /* 原位：块还在，且偏移处的原文就是那一句（前缀命中也算——句末被截断时
     前半段一样能对上，总比跳到别处强） */
  const block = blocks[point.block];
  if (block) {
    const raw = String(block.raw ?? block.text ?? '');
    const at = Math.min(Math.max(0, point.at), raw.length);
    const head = squash(raw.slice(at, at + Math.max(1, point.len)));
    if (head && (head === want || want.startsWith(head) || head.startsWith(want))) {
      return { block: point.block, offset: at };
    }
  }

  /* 按原文找回来：块序号变了、前面插了几句，都靠这一级。用原文 indexOf，
     不用压缩后的——偏移必须落回原始 textContent 的坐标系 */
  for (let i = 0; i < blocks.length; i += 1) {
    const raw = String(blocks[i]?.raw ?? blocks[i]?.text ?? '');
    const pos = raw.indexOf(point.text);
    if (pos >= 0) return { block: i, offset: pos };
  }
  return null;
}
