/**
 * 画像在界面上露头的两处（shell/render/portrait.ts）。
 *
 * 建画像的准备 / 进度 / 完成三块 2026-11-07 搬进了侧栏 AI 页签，这里只剩
 * 侧栏选建法用的预估，和书籍详情页那一行状态。断言的是**用户看到的那句话**，
 * 因为这两处都在替他判断「值不值得花钱、要不要重建」。
 */
import { describe, expect, it } from 'vitest';
import { portraitEstimate, portraitStatusLine } from '../src/shell/render/portrait';
import type { PortraitFile } from '../src/data/portrait';

function portrait(patch: Partial<PortraitFile> = {}): PortraitFile {
  return {
    version: 1,
    bookId: 'b1',
    bookTitle: '心流',
    plan: 'compress',
    model: 'chat',
    chunkChars: 8000,
    total: 2,
    blocks: [
      { chapter: '第一章', chars: 100, digest: '讲注意力的有限', summary: '要点一' },
      { chapter: '第二章', chars: 100, digest: '讲心流的条件', summary: '要点二' },
    ],
    overview: '整本书讲的是如何进入心流',
    createdAt: 0,
    updatedAt: 0,
    done: true,
    ...patch,
  };
}

describe('预估：选建法时把代价写在卡片上', () => {
  it('没切块时按字数估，两种方案各说各的请求数', () => {
    const vector = portraitEstimate(30_000, 'vector');
    const compress = portraitEstimate(30_000, 'compress');
    expect(vector.blocks).toBeGreaterThan(0);
    /* 压缩方案每块都要一次 AI 请求，向量方案是一批算一次，两者不该相等 */
    expect(vector.requests).toBeGreaterThan(0);
    expect(compress.requests).toBeGreaterThan(0);
  });

  it('已经切过块就用真实块数，不再估', () => {
    const est = portraitEstimate(30_000, 'vector', 12);
    expect(est.blocks).toBe(12);
  });
});

describe('状态行：详情页那一行', () => {
  it('没有 = 未建；没跑完 = 建到一半；模型换了 = 需要重建', () => {
    expect(portraitStatusLine(null, 'bge-m3')).toBe('未建');
    expect(portraitStatusLine(portrait({ plan: 'vector', done: false }), 'bge-m3')).toBe('建到一半');
    expect(portraitStatusLine(portrait({ plan: 'vector', model: 'old', done: true }), 'bge-m3')).toBe('需要重建');
    expect(portraitStatusLine(portrait({ plan: 'vector', model: 'bge-m3', done: true }), 'bge-m3')).toBe('已建');
  });

  it('压缩方案不受嵌入模型影响（摘要换个模型照样读得懂）', () => {
    expect(portraitStatusLine(portrait({ plan: 'compress', model: 'gpt-x' }), 'bge-m3')).toBe('已建');
  });

  it('正在建时优先说「建到一半」，不让人以为没开始', () => {
    expect(portraitStatusLine(null, 'bge-m3', true)).toBe('建到一半');
  });
});
