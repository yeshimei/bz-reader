/**
 * 借 bz 的向量库（data/bz-bridge.ts）
 *
 * 2026-11-07 决策回摆：书向量不再由本插件自己算，改用第二大脑（bz）的嵌入
 * 能力。于是「能不能建索引」这件事从「设置里填没填嵌入模型」变成「bz 在不在、
 * 门面齐不齐、bz 那边选没选模型」。
 *
 * 这里钉三件事：
 *   1. 门面齐 → 模型名取自 bz（画像靠它判旧向量要不要重建）；
 *   2. bz 说模型是空串 → 也算不可用（记不下模型名的画像，换模型时发现不了）；
 *   3. 任何异常都收敛成一句人话，不往上抛。
 */
import { describe, expect, it, vi } from 'vitest';
import { bzEmbedder, bzEntryReady, bzNotesReady } from '../src/data/bz-bridge';

function appWith(patch: Record<string, unknown> | null, version = '1.41.0') {
  return {
    plugins: {
      getPlugin: (id: string) => (id === 'bz' ? patch : null),
      plugins: patch ? { bz: patch } : {},
      manifests: patch ? { bz: { version } } : {},
    },
  } as never;
}

const knowledge = { openTermNote: vi.fn(), openPassageNote: vi.fn() };

function readerAi(model: () => string, ready = true) {
  return {
    isIndexReady: () => ready,
    embeddingModel: model,
    searchNotes: async () => [],
    embedDocuments: async (texts: string[]) => texts.map(() => [1, 0]),
    embedQuery: async () => [1, 0],
  };
}

describe('bz 的嵌入能力', () => {
  it('门面齐全：模型名取自 bz，不报问题', () => {
    const e = bzEmbedder(appWith({ knowledge, readerAi: readerAi(() => 'bge-m3') }));
    expect(e.problem).toBeNull();
    expect(e.model).toBe('bge-m3');
    expect(e.ai).not.toBeNull();
  });

  it('没装 bz：拿不到能力，提示引导安装', () => {
    const e = bzEmbedder(appWith(null));
    expect(e.ai).toBeNull();
    expect(e.model).toBe('');
    expect(e.problem).toContain('还没装');
  });

  it('老版本 bz 缺检索门面：提示版本旧，不抛', () => {
    const e = bzEmbedder(appWith({ knowledge }));
    expect(e.ai).toBeNull();
    expect(e.problem).toContain('1.41.0');
  });

  it('bz 那边还没选嵌入模型（空串）：也算不可用，指路 bz 设置', () => {
    const e = bzEmbedder(appWith({ knowledge, readerAi: readerAi(() => '') }));
    expect(e.ai).toBeNull();
    expect(e.problem).toContain('第二大脑');
  });

  it('bz 的 embeddingModel 抛错：当成没配好，不往上传', () => {
    const boom = () => {
      throw new Error('boom');
    };
    const e = bzEmbedder(appWith({ knowledge, readerAi: readerAi(boom) }));
    expect(e.ai).toBeNull();
    expect(() => bzEmbedder(appWith({ knowledge, readerAi: readerAi(boom) }))).not.toThrow();
  });
});

describe('自动识别（不再有开关）', () => {
  it('齐了：录入与笔记依据都算可用', () => {
    const app = appWith({ knowledge, readerAi: readerAi(() => 'bge-m3') });
    expect(bzEntryReady(app)).toBe(true);
    expect(bzNotesReady(app)).toBe(true);
  });

  it('缺录入门面：只有录入不可用，笔记依据照旧', () => {
    const app = appWith({ readerAi: readerAi(() => 'bge-m3') });
    expect(bzEntryReady(app)).toBe(false);
    expect(bzNotesReady(app)).toBe(true);
  });

  it('bz 自己的索引没建好：笔记依据不可用（没索引就没得搜）', () => {
    const app = appWith({ knowledge, readerAi: readerAi(() => 'bge-m3', false) });
    expect(bzEntryReady(app)).toBe(true);
    expect(bzNotesReady(app)).toBe(false);
  });

  it('没装 bz：两样都不可用', () => {
    const app = appWith(null);
    expect(bzEntryReady(app)).toBe(false);
    expect(bzNotesReady(app)).toBe(false);
  });
});
