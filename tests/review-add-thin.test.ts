import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reviewReaderFlowReady, type ReviewApi } from '../src/data/review-bridge';

/**
 * 2026-11-21：复习的一切逻辑搬进 bz Review 之后，Reader 侧只剩「内容供货」
 * 两个接口和三个薄入口。这组断言守两件事：
 *   1. 入口不再自己挑内容（旧的两大窗口类已删，也不许再 import 旧的执行层）；
 *   2. readerApi 真的长出了 reviewCatalog / reviewChapterText。
 */
const SRC = readFileSync(new URL('../src/shell/review-add.ts', import.meta.url), 'utf8');
const PLUGIN = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8');

describe('加入复习 · Reader 侧薄入口', () => {
  it('侧栏 / 书右键入口只把书 id 递给 Review', () => {
    expect(SRC).toContain('api.openReaderFlow?.({ bookId: book.id })');
    expect(SRC).not.toContain('class ReviewAddFlow');
    expect(SRC).not.toContain('class BookScopeFlow');
    expect(SRC).not.toContain('review-run');
    expect(SRC).not.toContain('review-scope');
  });

  it('没装 / 老版本只说一句话，不退回旧流程', () => {
    expect(SRC).toContain("t('review.needPlugin')");
    expect(SRC).toContain("t('review.cardsNeedUpdate')");
    expect(SRC).toContain('reviewReaderFlowReady(api)');
  });

  it('工具条单条 / 划选仍走统一制卡窗口', () => {
    expect(SRC).toContain('openCardsFlow(app');
    expect(SRC).toContain('addSelectionToReview');
    expect(SRC).toContain('addMarkToReview');
  });
});

describe('readerApi · 内容供货两接口', () => {
  it('列内容：不带书 → 书清单；带书 → 划线 + 章节目录', () => {
    expect(PLUGIN).toContain('reviewCatalog: async (bookId?: string)');
    expect(PLUGIN).toContain('markCount:');
    expect(PLUGIN).toContain('reviewChaptersOf');
  });

  it('读正文：按书 + 章节下标，读不到给空串', () => {
    expect(PLUGIN).toContain('reviewChapterText: async (bookId: string, index: number)');
    expect(PLUGIN).toContain('reviewFoliateOf');
  });
});

describe('reviewReaderFlowReady：契约 v6 + 方法存在', () => {
  const base = { version: 6, openReaderFlow: () => {} } as unknown as ReviewApi;
  it('v6 且带 openReaderFlow 才放行', () => {
    expect(reviewReaderFlowReady(base)).toBe(true);
  });
  it('v5 的老 Review 不放行（不退回旧流程）', () => {
    expect(reviewReaderFlowReady({ ...base, version: 5 } as ReviewApi)).toBe(false);
  });
  it('版本号够但没这个方法也不放行', () => {
    expect(reviewReaderFlowReady({ version: 6 } as ReviewApi)).toBe(false);
  });
  it('没装就是 false', () => {
    expect(reviewReaderFlowReady(null)).toBe(false);
  });
});

describe('加入复习 · Reader 侧死配置与死入口不回头', () => {
  const SETTINGS = readFileSync(new URL('../src/data/settings.ts', import.meta.url), 'utf8');
  const ACTIONS = readFileSync(new URL('../src/shell/actions.ts', import.meta.url), 'utf8');

  it('「加入复习先选方式 / 上次用的方式」已删（现在只有 Review 的「新卡默认方式」）', () => {
    expect(SETTINGS).not.toContain('reviewAskMode');
    expect(SETTINGS).not.toContain('reviewLastMode');
  });

  it('侧栏的 reviewadd 动作与 openReviewAdd 入口已删，没人派发就别留', () => {
    expect(ACTIONS).not.toContain("case 'reviewadd'");
    expect(ACTIONS).not.toContain('openReviewAdd');
  });
});
