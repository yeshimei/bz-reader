/**
 * 右键「加入复习」的范围解析（shell/review-scope.ts）：
 *   每条划线一张 / AI 挑划线重点 / AI 从正文挑重点。
 * ask 与 chapterText 注入，纯逻辑可测。
 */
import { describe, expect, it } from 'vitest';
import { resolveScope, type ScopeMark, type ScopeChapter } from '../src/shell/review-scope';

const MARKS: ScopeMark[] = [
  { id: 'm1', chapterIndex: 0, chapterTitle: '一', text: '婚姻像城', comment: '' },
  { id: 'm2', chapterIndex: 0, chapterTitle: '一', text: '城外想进去', comment: '' },
  { id: 'm3', chapterIndex: 1, chapterTitle: '二', text: '风景描写', comment: '' },
];
const CHAPTERS: ScopeChapter[] = [
  { index: 0, title: '一' },
  { index: 1, title: '二' },
];

describe('resolveScope：内容来源 → 待制卡的原文', () => {
  it('每条划线一张：全收，钥匙带划线 id', async () => {
    const out = await resolveScope('marks', {
      bookId: 'b', bookTitle: '围城', marks: MARKS, chapters: CHAPTERS,
      ask: async () => '', chapterText: async () => '',
    });
    expect(out).toHaveLength(3);
    expect(out[0]!.key).toContain('m1');
    expect(out.map((x) => x.text)).toEqual(['婚姻像城', '城外想进去', '风景描写']);
  });

  it('划线重点：AI 说保留哪些，只收这些', async () => {
    const out = await resolveScope('marksKey', {
      bookId: 'b', bookTitle: '围城', marks: MARKS, chapters: CHAPTERS,
      ask: async () => JSON.stringify({ keep: ['m1'] }), chapterText: async () => '',
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('婚姻像城');
  });

  it('划线重点：AI 解析失败保底全留', async () => {
    const out = await resolveScope('marksKey', {
      bookId: 'b', bookTitle: '围城', marks: MARKS, chapters: CHAPTERS,
      ask: async () => '乱码', chapterText: async () => '',
    });
    expect(out).toHaveLength(3);
  });

  it('按章节重点：读正文，AI 挑句子，每句一张', async () => {
    const out = await resolveScope('chaptersKey', {
      bookId: 'b', bookTitle: '围城', marks: MARKS, chapters: CHAPTERS,
      ask: async () => JSON.stringify({ cards: [{ text: '城里的句子', q: '问', a: '答' }] }),
      chapterText: async (i) => (i === 0 ? '城里的句子和别的正文' : ''),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('城里的句子');
    expect(out[0]!.chapterTitle).toBe('一');
  });

  it('按章节重点：AI 编的原文（正文里没有）不收', async () => {
    const out = await resolveScope('chaptersKey', {
      bookId: 'b', bookTitle: '围城', marks: [], chapters: [CHAPTERS[0]!],
      ask: async () => JSON.stringify({ cards: [{ text: '编的句子', q: '问', a: '答' }] }),
      chapterText: async () => '正文里根本没有这句',
    });
    expect(out).toHaveLength(0);
  });

  it('空正文章节跳过，不影响其他章节', async () => {
    const out = await resolveScope('chaptersKey', {
      bookId: 'b', bookTitle: '围城', marks: [], chapters: CHAPTERS,
      ask: async () => JSON.stringify({ cards: [{ text: '二的句子', q: '问', a: '答' }] }),
      chapterText: async (i) => (i === 0 ? '' : '二的句子'),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.chapterTitle).toBe('二');
  });
});
