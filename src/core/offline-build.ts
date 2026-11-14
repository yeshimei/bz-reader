/* ============================================================
 * bz-reader · 离线包生成（core/offline-build.ts）
 *
 * 把「缓存里按句存的音频」压成「一章一个文件 + 一条时间轴」。这一层
 * 仍然是纯函数：给它字节，它给文件和清单，不碰库、不发请求。
 *
 * 时长必须逐段算（见 audio-length.ts），不能用「总字节 ÷ 码率」：后者
 * 会把 ID3 头和帧对齐的零头都算成声音，整章累计能偏出几秒。
 * ============================================================ */

import { audioDurationMs } from './audio-length';
import {
  OFFLINE_VERSION,
  buildMarks,
  chapterFile,
  type OfflineBook,
  type OfflineChapter,
} from './offline-pack';
import { concatMp3Slices } from './tts-local';
import { concatWav } from './wav';

export interface ChapterSource {
  /** 章标题，同时是文件名 */
  title: string;
  /** 与 parts 一一对应的句子原文 */
  texts: readonly string[];
  /** 每句的音频字节 */
  parts: readonly ArrayBuffer[];
  /** 音频格式（mp3 / wav），决定扩展名与时长算法 */
  format: string;
}

export interface BuiltChapter {
  chapter: OfflineChapter;
  /** 拼好的整章音频 */
  data: ArrayBuffer;
}

/**
 * 一章的音频 + 时间轴。
 *
 * 任一段算不出时长就返回 null：宁可不给这本书离线包，也不要给一个
 * 稳定偏的时间轴——高亮全程错位比「没有离线音频」更让人以为坏了。
 */
export function buildChapter(src: ChapterSource): BuiltChapter | null {
  const n = Math.min(src.texts.length, src.parts.length);
  if (!n) return null;
  const format = String(src.format || 'mp3').toLowerCase();
  const parts = src.parts.slice(0, n);
  const texts = src.texts.slice(0, n).map((t) => String(t ?? ''));

  const ms: number[] = [];
  for (const buf of parts) {
    const one = audioDurationMs(buf, format);
    if (!one) return null;
    ms.push(one);
  }

  let data: ArrayBuffer | null;
  let slices: Array<{ off: number; bytes: number }> = [];
  if (format === 'wav') {
    /* wav 拼完只剩一条 PCM 流，句子切片得重写 44 字节头才能播；先不记
       区间，播放器会退回整章播放。本地 mp3 才是离线包的主路径。 */
    data = concatWav(parts);
  } else if (format === 'mp3') {
    const joined = concatMp3Slices(parts);
    data = joined?.data ?? null;
    slices = joined?.slices ?? [];
  } else return null;
  if (!data || !data.byteLength) return null;

  const marks = buildMarks(texts, ms, slices);
  const chapter: OfflineChapter = {
    title: src.title,
    file: chapterFile(src.title, format),
    ms: marks.reduce((sum, m) => sum + m.ms, 0),
    bytes: data.byteLength,
    marks,
  };
  return { chapter, data };
}

/** 新建一份空清单（第一次导这一本书时用） */
export function emptyBook(meta: {
  title: string;
  bookId?: string;
  engine?: string;
  voice?: string;
  format?: string;
  madeAt?: number;
}): OfflineBook {
  return {
    version: OFFLINE_VERSION,
    title: meta.title,
    bookId: meta.bookId ?? '',
    engine: meta.engine ?? '',
    voice: meta.voice ?? '',
    format: meta.format ?? 'mp3',
    madeAt: meta.madeAt ?? Date.now(),
    chapters: [],
  };
}

/**
 * 放进一章：同名章原位替换，新章追加。
 *
 * 原位替换是为了「重新生成某一章」不把它挤到表尾——表尾会让章序和书
 * 里的顺序对不上，用户按顺序听会跳。
 */
export function upsertChapter(book: OfflineBook, chapter: OfflineChapter): OfflineBook {
  const chapters = book.chapters.slice();
  const at = chapters.findIndex((c) => c.title === chapter.title);
  if (at >= 0) chapters[at] = chapter;
  else chapters.push(chapter);
  return { ...book, chapters };
}

/** 按书里的章序重排；清单里有、这次没给的章留在末尾 */
export function reorderChapters(book: OfflineBook, titles: readonly string[]): OfflineBook {
  const rank = new Map<string, number>();
  titles.forEach((t, i) => rank.set(t, i));
  const chapters = book.chapters
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ra = rank.get(a.c.title) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.c.title) ?? Number.MAX_SAFE_INTEGER;
      return ra === rb ? a.i - b.i : ra - rb;
    })
    .map((x) => x.c);
  return { ...book, chapters };
}

/** 去掉一章（文件被用户删了，或要重导） */
export function dropChapter(book: OfflineBook, title: string): OfflineBook {
  return { ...book, chapters: book.chapters.filter((c) => c.title !== title) };
}

/**
 * 丢掉音频文件已经不在的章。
 *
 * 用户会把包目录拷来拷去，经常只拷了 manifest 没拷 mp3；留着这种章
 * 只会在点播放时静默失败。
 */
export function pruneChapters(book: OfflineBook, exists: (file: string) => boolean): OfflineBook {
  return { ...book, chapters: book.chapters.filter((c) => exists(c.file)) };
}

/** 已经导过哪几章（给「重新生成要跳过还是覆盖」判断用） */
export function hasChapter(book: OfflineBook | null, title: string): boolean {
  return !!book?.chapters.some((c) => c.title === title);
}
