import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { installDomStub } from './helpers/dom-stub';

/* ============================================================
 * 全库搜索 × 扫描件（2026-11-15）。
 *
 * 扫描页的正文不在 PDF 里，而在数据目录的 `storage/ocr/<书>.json`。
 * 跨书搜索是「临时开引擎、扫完即拆」，不打开书就没有那次 `applyOcr`——
 * 以前这里会直接搜一本空书，面板还写「没有找到」。这个测试钉住：
 *   · PDF 进搜索前一定先读识别结果并灌进临时引擎；
 *   · 非 PDF 不去碰那个文件。
 * ============================================================ */

const h = vi.hoisted(() => ({
  applied: [] as Array<Record<string, unknown> | null | undefined>,
  mounted: [] as string[],
}));

vi.mock('../src/engine/reader-engine', () => ({
  createEngine: () => ({
    mount: async (_stage: unknown, path: string) => {
      h.mounted.push(path);
    },
    ocrUi: { apply: (pages: Record<string, unknown> | null) => h.applied.push(pages) },
    search: async () => [{ cfi: 'pdf/2', excerpt: '甲' }],
    destroy: async () => undefined,
  }),
}));

vi.mock('../src/data/pdf-ocr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/pdf-ocr')>();
  return {
    ...actual,
    readOcr: async () => ({
      v: 1,
      bookId: 'b1',
      pages: {
        2: {
          engine: 'deepseek',
          model: 'm',
          at: 1,
          layout: true,
          lines: [{ text: '甲', rect: { left: 0.1, top: 0.1, width: 0.2, height: 0.02 } }],
        },
      },
    }),
  };
});

import { searchAcrossBooks } from '../src/engine/cross-search';
import { disposeCrossSearchStage } from '../src/engine/cross-search';

let off: () => void;
const g = globalThis as unknown as Record<string, unknown>;
let prevCreateDiv: unknown;
let hadCreateDiv = false;

beforeAll(() => {
  off = installDomStub();
  hadCreateDiv = 'createDiv' in g;
  prevCreateDiv = g.createDiv;
  g.createDiv = () => document.createElement('div');
});

afterAll(() => {
  disposeCrossSearchStage();
  if (hadCreateDiv) g.createDiv = prevCreateDiv;
  else delete g.createDiv;
  off();
});

describe('全库搜索 · 扫描件', () => {
  it('PDF 先读识别结果、灌进临时引擎，再搜', async () => {
    h.applied.length = 0;
    h.mounted.length = 0;
    const hits: unknown[] = [];
    await searchAcrossBooks({
      app: {} as never,
      books: [{ id: 'b1', fileRef: { format: 'pdf', vaultPath: 'books/a.pdf' } } as never],
      prefs: {} as never,
      query: '甲',
      onHits: (_b, list) => hits.push(...list),
    });
    expect(h.mounted).toEqual(['books/a.pdf']);
    expect(h.applied).toHaveLength(1);
    expect(Object.keys(h.applied[0] ?? {})).toEqual(['2']);
    expect(hits).toHaveLength(1);
  });

  it('非 PDF 不去读 OCR 文件', async () => {
    h.applied.length = 0;
    await searchAcrossBooks({
      app: {} as never,
      books: [{ id: 'b2', fileRef: { format: 'epub', vaultPath: 'books/b.epub' } } as never],
      prefs: {} as never,
      query: '甲',
      onHits: () => undefined,
    });
    expect(h.applied).toHaveLength(0);
  });
});
