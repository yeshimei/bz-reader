import { describe, expect, it } from 'vitest';
import type { PortraitFile } from '../src/data/portrait';
import { buildMessages } from '../src/data/ai';
import { mergeShelfEvidence, pickAskPortraits, shelfSources, type ShelfHit } from '../src/data/shelf-ask';

/**
 * 问这摞书（2026-11-10）。
 *
 * 与「问这本书」的分工：那边一本书、一份依据；这边几本书的块混在一起，
 * 每条依据都得能指出**是哪本书哪一章**——否则模型说了什么用户没法核对，
 * 「这几本对同一件事有什么不同说法」这类问题也就答不了。
 *
 * 纯逻辑三块：选谁参战、依据怎么拼、来源怎么去重。
 */

function portrait(patch: Partial<PortraitFile> = {}): PortraitFile {
  return {
    version: 1,
    bookId: 'b1',
    bookTitle: '一本书',
    plan: 'vector',
    model: 'm1',
    chunkChars: 1000,
    total: 1,
    blocks: [{ chapter: '第一章', chars: 10, text: '正文' }],
    createdAt: 1,
    updatedAt: 1,
    done: true,
    ...patch,
  };
}

function hit(patch: Partial<ShelfHit> = {}): ShelfHit {
  return {
    bookId: 'b1',
    title: '一本书',
    chapter: '第一章',
    chunk: '这是书里的一段话。',
    score: 0.9,
    ...patch,
  };
}

describe('pickAskPortraits', () => {
  it('只留被选中的书，且必须是建完的向量画像、模型一致', () => {
    const list = [
      portrait({ bookId: 'a' }),
      portrait({ bookId: 'b' }),
      portrait({ bookId: 'c', plan: 'compress' }),
      portrait({ bookId: 'd', model: 'old' }),
      portrait({ bookId: 'e', done: false }),
    ];
    const out = pickAskPortraits(list, new Set(['a', 'b', 'c', 'd', 'e']), 'm1');
    expect(out.map((p) => p.bookId)).toEqual(['a', 'b']);
  });

  it('没选中任何书时为空（不偷偷搜全库）', () => {
    expect(pickAskPortraits([portrait()], new Set(), 'm1')).toEqual([]);
  });

  it('模型名未知时一本都不给', () => {
    expect(pickAskPortraits([portrait()], new Set(['b1']), '')).toEqual([]);
  });
});

describe('mergeShelfEvidence', () => {
  it('每段前面带书名与章节，来源能对上', () => {
    const text = mergeShelfEvidence([
      hit({ bookId: 'a', title: '书甲', chapter: '第二章', chunk: '甲说过。' }),
      hit({ bookId: 'b', title: '书乙', chapter: '第一章', chunk: '乙说过。' }),
    ]);
    expect(text).toContain('【书甲 · 第二章】');
    expect(text).toContain('【书乙 · 第一章】');
    expect(text).toContain('甲说过。');
    expect(text).toContain('乙说过。');
  });

  it('超过上限就截断，并标明省略', () => {
    const long = '很长的一段。'.repeat(2000);
    const text = mergeShelfEvidence([hit({ chunk: long })], 300);
    expect(text.length).toBeLessThanOrEqual(320);
    expect(text).toContain('…');
  });

  it('空输入返回空串', () => {
    expect(mergeShelfEvidence([])).toBe('');
  });
});

describe('shelfSources', () => {
  it('同一本书同一章只留一条来源', () => {
    const list = [
      hit({ bookId: 'a', title: '书甲', chapter: '第一章', score: 0.9 }),
      hit({ bookId: 'a', title: '书甲', chapter: '第一章', score: 0.8 }),
      hit({ bookId: 'a', title: '书甲', chapter: '第二章', score: 0.7 }),
      hit({ bookId: 'b', title: '书乙', chapter: '第一章', score: 0.6 }),
    ];
    const out = shelfSources(list);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ title: '书甲', chapter: '第一章' });
  });

  it('来源带上 bookId，点一下能打开那本书', () => {
    const out = shelfSources([hit({ bookId: 'a' })]);
    expect(out[0]?.bookId).toBe('a');
  });

  it('最多给几条', () => {
    const list = Array.from({ length: 20 }, (_, i) => hit({ bookId: `b${i}`, title: `书${i}`, chapter: '第一章' }));
    expect(shelfSources(list, 5)).toHaveLength(5);
  });
});

describe('buildMessages · shelf', () => {
  it('多本书的依据与问题分开，system 要求指明是哪本书说的', () => {
    const msgs = buildMessages({
      task: 'shelf',
      text: '这几本对知行合一怎么说？',
      context: '【书甲 · 第一章】\n甲说过。',
    });
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain('这几本书');
    const all = msgs.map((m) => m.content).join('\n');
    expect(all).toContain('甲说过。');
    expect(all.indexOf('甲说过')).toBeLessThan(all.indexOf('这几本对知行合一怎么说'));
  });

  it('没有依据时不编造，并说明只能凭问题回答', () => {
    const msgs = buildMessages({ task: 'shelf', text: '随便问问' });
    expect(msgs[0]!.content).toContain('没有取到可用的依据');
    expect(msgs.at(-1)!.content).not.toContain('【依据】');
  });
});
