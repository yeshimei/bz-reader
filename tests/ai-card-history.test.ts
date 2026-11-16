import { beforeEach, describe, expect, it } from 'vitest';
import type { AiSession } from '../src/data/ai-session';
import {
  aiCardGet,
  aiCardKey,
  aiCardSeed,
  aiCardReset,
  sessionToCard,
} from '../src/shell/ai-card';
import { jumpKey, pickChapterHit, type TextHit } from '../src/shell/text-search';

/* ============================================================
 * 划词 AI 的历史（2026-11-16）
 *
 *   1. 记账键要把「哪条划线」算进去：同一段原文划两次是两段独立对话；
 *   2. 落盘的会话要能还原成卡片（首问的答案进正文，不是进轮次）；
 *   3. 「依据」跳转要按章名挑命中，不能永远跳书里第一次出现的那句。
 * ============================================================ */

beforeEach(() => {
  aiCardReset();
});

describe('划词卡 · 按划线记账', () => {
  it('同一段原文、不同划线是两份，不会串', () => {
    expect(aiCardKey('ai', 'explain', '金漆的鸟笼', 'm1')).not.toBe(
      aiCardKey('ai', 'explain', '金漆的鸟笼', 'm2'),
    );
  });

  it('同一段、同一条线、不同档位仍是分开的', () => {
    expect(aiCardKey('ai', 'explain', '原文', 'm1')).not.toBe(aiCardKey('ai', 'translate', '原文', 'm1'));
  });

  it('灌回来的结果拿得到，重开一次不会被当成没问过', () => {
    const key = aiCardKey('ai', 'explain', '原文', 'm1');
    expect(aiCardGet(key)).toBeUndefined();
    aiCardSeed(key, { status: 'done', text: '答案' });
    expect(aiCardGet(key)?.text).toBe('答案');
  });
});

function session(patch: Partial<AiSession> = {}): AiSession {
  return {
    id: 'id-1',
    bookId: 'b1',
    bookTitle: '围城',
    kind: 'explain',
    when: 1_700_000_000_000,
    markId: 'm1',
    turns: [
      { me: true, text: '解释这一段' },
      { me: false, text: '首答' },
      { me: true, text: '那笼子呢' },
      { me: false, text: '追问的答案' },
    ],
    ...patch,
  };
}

describe('落盘会话 → 卡片', () => {
  it('首问进 ask、首答进正文、之后是轮次', () => {
    const entry = sessionToCard(session());
    expect(entry.status).toBe('done');
    expect(entry.ask).toBe('解释这一段');
    expect(entry.text).toBe('首答');
    expect(entry.turns).toEqual([{ q: '那笼子呢', a: '追问的答案' }]);
    expect(entry.at).toMatch(/^\d\d:\d\d$/);
  });

  it('只有一问一答时不造空轮次', () => {
    const entry = sessionToCard(
      session({ turns: [{ me: true, text: '问' }, { me: false, text: '答' }] }),
    );
    expect(entry.text).toBe('答');
    expect(entry.turns).toEqual([]);
  });

  it('没有首答（只有一问）时正文为空，但不丢提问', () => {
    const entry = sessionToCard(session({ turns: [{ me: true, text: '只问了没答' }] }));
    expect(entry.ask).toBe('只问了没答');
    expect(entry.text).toBe('');
  });
});

describe('依据跳转 · 关键词与命中', () => {
  function hit(label: string, cfi: string): TextHit {
    return { cfi, excerpt: '', chapterLabel: label, chapterIndex: 0 };
  }

  it('取第一句完整的话，去掉首尾引号与省略号', () => {
    const key = jumpKey('“原来如此。你瞧瞧镜子里的脸……”后面还有一长串别的字');
    expect(key.startsWith('原来如此。')).toBe(true);
    expect(key).not.toContain('“');
    expect(key).not.toContain('…');
  });

  it('原文没有句号时按上限截，不吞掉整段', () => {
    const key = jumpKey('没'.repeat(80));
    expect(Array.from(key).length).toBe(28);
  });

  it('空白原文给空串（调用方据此只跳章）', () => {
    expect(jumpKey('   ')).toBe('');
  });

  it('章名对得上就跳那一条，不是书里第一次出现的那句', () => {
    const hits = [hit('第一章', 'cfi1'), hit('第九章', 'cfi9')];
    expect(pickChapterHit(hits, '第九章')?.cfi).toBe('cfi9');
  });

  it('章名写得长短不一也能对上', () => {
    const hits = [hit('第一章 归途', 'cfi1'), hit('第九章 围城', 'cfi9')];
    expect(pickChapterHit(hits, '第九章')?.cfi).toBe('cfi9');
    expect(pickChapterHit(hits, '第九章 围城')?.cfi).toBe('cfi9');
  });

  it('章名对不上 / 没给章名：退回第一条，不能一条都不跳', () => {
    const hits = [hit('第一章', 'cfi1')];
    expect(pickChapterHit(hits, '没这一章')?.cfi).toBe('cfi1');
    expect(pickChapterHit(hits, '')?.cfi).toBe('cfi1');
    expect(pickChapterHit([], '第一章')).toBeUndefined();
  });
});
