/* ============================================================
 * bz-reader · 离线包生成（tests/offline-build.test.ts）
 *
 * 这一层决定「一章的音频和时间轴是不是同源」。断言重点不是字节内容，
 * 而是**每句的起点**：起点错一句，整章高亮就错一句。
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  buildChapter,
  dropChapter,
  emptyBook,
  hasChapter,
  pruneChapters,
  reorderChapters,
  upsertChapter,
} from '../src/core/offline-build';
import { OFFLINE_VERSION, chapterFile } from '../src/core/offline-pack';

const FRAME = Uint8Array.from([0xff, 0xfb, 0x50, 0xc0]);

function mp3(frames: number): ArrayBuffer {
  const out = new Uint8Array(frames * 208);
  for (let i = 0; i < frames; i++) out.set(FRAME, i * 208);
  return out.buffer;
}

function wav(dataBytes: number): ArrayBuffer {
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return out.buffer;
}

const src = (over: Record<string, unknown> = {}): {
  title: string;
  texts: string[];
  parts: ArrayBuffer[];
  format: string;
} => ({
  title: '第一章',
  texts: ['甲', '乙'],
  parts: [mp3(10), mp3(10)],
  format: 'mp3',
  ...over,
});

describe('一章打包', () => {
  it('时间轴按每段真实时长累加，每句还记下自己的字节区间', () => {
    const built = buildChapter(src())!;
    expect(built.chapter.file).toBe(chapterFile('第一章', 'mp3'));
    expect(built.chapter.ms).toBe(522);
    expect(built.chapter.marks).toEqual([
      { text: '甲', at: 0, ms: 261, off: 0, bytes: 208 * 10 },
      { text: '乙', at: 261, ms: 261, off: 208 * 10, bytes: 208 * 10 },
    ]);
  });

  it('按区间切出来的就是那一句自己的音频，不用猜帧头', () => {
    const parts = [mp3(10), mp3(10)];
    const built = buildChapter(src({ parts }))!;
    const data = new Uint8Array(built.data);
    const slices = built.chapter.marks.map((m) => [
      ...data.slice(m.off ?? 0, (m.off ?? 0) + (m.bytes ?? 0)),
    ]);
    expect(slices).toEqual(parts.map((p) => [...new Uint8Array(p)]));
  });

  it('拼出来的字节数是各段之和，不含被剥掉的标签', () => {
    const built = buildChapter(src())!;
    expect(built.chapter.bytes).toBe(208 * 20);
    expect(built.data.byteLength).toBe(208 * 20);
  });

  it('句子比音频多时按短的截，不硬配', () => {
    const built = buildChapter(src({ texts: ['甲', '乙', '丙'] }))!;
    expect(built.chapter.marks.map((m) => m.text)).toEqual(['甲', '乙']);
  });

  it('音频比句子多时同样截断', () => {
    const built = buildChapter(src({ parts: [mp3(10)] }))!;
    expect(built.chapter.marks.map((m) => m.text)).toEqual(['甲']);
  });

  it('wav 也支持，扩展名跟着换', () => {
    const built = buildChapter(src({ parts: [wav(48000)], texts: ['甲'], format: 'wav' }))!;
    expect(built.chapter.file).toBe(chapterFile('第一章', 'wav'));
    expect(built.chapter.marks[0].ms).toBe(1000);
    /* wav 拼完是一条 PCM 流，不给逐句区间：播放时退回整章模式 */
    expect(built.chapter.marks[0].off).toBeUndefined();
    expect(built.chapter.marks[0].bytes).toBeUndefined();
  });

  it('没有音频 / 没有句子都返回 null', () => {
    expect(buildChapter(src({ parts: [] }))).toBeNull();
    expect(buildChapter(src({ texts: [] }))).toBeNull();
  });

  it('不认识的格式返回 null，不把 ogg 当 mp3 拼', () => {
    expect(buildChapter(src({ format: 'ogg' }))).toBeNull();
  });

  it('有一段算不出时长就整章放弃——稳定偏的时间轴比没有更糟', () => {
    expect(buildChapter(src({ parts: [mp3(10), new ArrayBuffer(100)] }))).toBeNull();
  });
});

describe('清单维护', () => {
  const one = buildChapter(src())!.chapter;
  const two = buildChapter(src({ title: '第二章' }))!.chapter;

  it('空清单从版本号与书名起', () => {
    const book = emptyBook({ title: '围城' });
    expect(book.version).toBe(OFFLINE_VERSION);
    expect(book.chapters).toEqual([]);
    expect(book.title).toBe('围城');
  });

  it('新章追加到末尾', () => {
    const book = upsertChapter(emptyBook({ title: '围城' }), one);
    expect(upsertChapter(book, two).chapters.map((c) => c.title)).toEqual(['第一章', '第二章']);
  });

  it('同名章原位替换，不把它挤到表尾', () => {
    let book = upsertChapter(emptyBook({ title: '围城' }), one);
    book = upsertChapter(book, two);
    const again = buildChapter(src({ parts: [mp3(20), mp3(20)] }))!.chapter;
    book = upsertChapter(book, again);
    expect(book.chapters.map((c) => c.title)).toEqual(['第一章', '第二章']);
    expect(book.chapters[0].ms).toBe(1044);
  });

  it('按书里的章序重排，清单多出来的留在末尾', () => {
    let book = upsertChapter(emptyBook({ title: '围城' }), two);
    book = upsertChapter(book, one);
    expect(reorderChapters(book, ['第一章', '第二章']).chapters.map((c) => c.title)).toEqual([
      '第一章',
      '第二章',
    ]);
    expect(reorderChapters(book, []).chapters.map((c) => c.title)).toEqual(['第二章', '第一章']);
  });

  it('删一章不影响别的章', () => {
    let book = upsertChapter(emptyBook({ title: '围城' }), one);
    book = upsertChapter(book, two);
    expect(dropChapter(book, '第一章').chapters.map((c) => c.title)).toEqual(['第二章']);
  });

  it('音频文件不在的章被剪掉', () => {
    let book = upsertChapter(emptyBook({ title: '围城' }), one);
    book = upsertChapter(book, two);
    const kept = pruneChapters(book, (file) => file === chapterFile('第二章', 'mp3'));
    expect(kept.chapters.map((c) => c.title)).toEqual(['第二章']);
  });

  it('问有没有导过某章', () => {
    expect(hasChapter(null, '第一章')).toBe(false);
    expect(hasChapter(emptyBook({ title: '围城' }), '第一章')).toBe(false);
    expect(hasChapter(upsertChapter(emptyBook({ title: '围城' }), one), '第一章')).toBe(true);
  });
});
