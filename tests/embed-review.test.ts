/**
 * 书架内嵌 bz Review（data/review-bridge.ts + shell/render/study.ts + shell/state.ts）
 *
 * 纯函数部分钉在这里：
 *   · 判据 version >= 3 且有 embedInto 才算「装了且支持嵌入」；
 *   · 复习页是第四个页签页（isStudyTab 认它，但不进 STUDY_SUB_PAGES）；
 *   · 页签是否列出由上层算好的布尔决定（渲染保持纯函数，可单测）；
 *   · 复习页右侧不画 Reader 四颗，只留 Review 自己塞图标的空容器。
 * DOM 挂载与 cleanup 不在这里测（没引 jsdom），留真机验证。
 */
import { describe, expect, it, vi } from 'vitest';
import { reviewEmbedReady } from '../src/data/review-bridge';
import { isStudyTab, nextStudyPage, STUDY_SUB_PAGES, type StudyPage } from '../src/shell/state';
import { actBar, studyShell, STUDY_TABS, visibleStudyTabs } from '../src/shell/render/study';

/* 页签里的「对话」是高级版，测试统一放行；未解锁时隐藏的既有断言在
   tests/ai-log-gate.test.ts 里。 */
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

const counts = { books: 2, notes: 3, chats: 4 };

/** 一张最小可用门面（只关心 version / embedInto 两处，其余补形状） */
function api(version?: number, embedInto?: unknown): any {
  return {
    version,
    addCards: async () => ({ added: 0, exists: 0, notFound: 0 }),
    ...(embedInto !== undefined ? { embedInto } : {}),
  };
}

describe('reviewEmbedReady：装了且支持嵌入才认', () => {
  it('没装（null）不算', () => {
    expect(reviewEmbedReady(null)).toBe(false);
  });

  it('老版本即便有 embedInto 也不算（version < 3）', () => {
    expect(reviewEmbedReady(api(1, () => () => {}))).toBe(false);
    expect(reviewEmbedReady(api(2, () => () => {}))).toBe(false);
  });

  it('没写 version 也不算（按 0 处理）', () => {
    expect(reviewEmbedReady(api(undefined, () => () => {}))).toBe(false);
  });

  it('v3 且有 embedInto 函数才算', () => {
    expect(reviewEmbedReady(api(3, () => () => {}))).toBe(true);
    expect(reviewEmbedReady(api(4, () => () => {}))).toBe(true);
  });

  it('version 够但 embedInto 不是函数（缺失 / 写坏）不算', () => {
    expect(reviewEmbedReady(api(3))).toBe(false);
    expect(reviewEmbedReady(api(3, 'yes'))).toBe(false);
  });
});

describe('复习页是页签页，不是子页', () => {
  it('StudyPage / StudyTab 都认 review，且不进子页名单', () => {
    expect(isStudyTab('review')).toBe(true);
    expect(isStudyTab('library')).toBe(true);
    expect(isStudyTab('stats')).toBe(false);
    expect(STUDY_SUB_PAGES).not.toContain('review');
  });

  it('页签点自己留在自己这页（不会被当成子页送回 studyBack）', () => {
    expect(nextStudyPage('review', 'review', 'library')).toBe('review');
    expect(nextStudyPage('library', 'review', 'notes')).toBe('review');
  });
});

describe('复习页签：只在开关开且 Review 支持嵌入时列出', () => {
  it('STUDY_TABS 顺序固定为 书库 / 笔记 / 对话 / 复习', () => {
    expect(STUDY_TABS.map((p) => p.value)).toEqual(['library', 'notes', 'ai', 'review']);
  });

  it('关（false）时不列 review 页签', () => {
    expect(visibleStudyTabs(false).map((p) => p.value)).not.toContain('review');
    const html = studyShell('library', '', counts, '', false);
    expect(html).not.toContain('data-p="review"');
  });

  it('开（true）时列在最后，且页签文案是「复习」', () => {
    expect(visibleStudyTabs(true).map((p) => p.value)).toEqual(['library', 'notes', 'ai', 'review']);
    const html = studyShell('library', '', counts, '', true);
    expect(html).toContain('data-p="review"');
    expect(html).toContain('>复习<');
  });
});

describe('复习页右侧：Reader 四颗让位给 Review 容器', () => {
  it('复习页只输出 reviewacts 空容器，不渲染 Reader 四颗', () => {
    const html = actBar('review');
    expect(html).toContain('class="bzs-review-acts" data-role="reviewacts"');
    for (const p of ['search', 'stats', 'import', 'settings'] as StudyPage[]) {
      expect(html, p).not.toContain(`data-p="${p}"`);
    }
  });

  it('其它页照旧渲染 Reader 四颗，不出现 reviewacts', () => {
    for (const p of ['library', 'notes', 'ai', 'settings'] as StudyPage[]) {
      const html = actBar(p);
      expect(html, p).not.toContain('bzs-review-acts');
      for (const act of ['search', 'stats', 'import', 'settings']) expect(html, p).toContain(`data-p="${act}"`);
    }
  });

  it('复习页的内容容器去掉内边距/滚动，给嵌入面板撑满（is-embed）', () => {
    const html = studyShell('review', '<div class="bzs-review-host" data-role="reviewhost"></div>', counts, '', true);
    expect(html).toContain('class="bzs-stubody is-embed"');
    expect(html).toContain('data-role="reviewhost"');
    expect(html).toContain('data-role="reviewacts"');
    /* Review 的四颗由 Review 自己挂，Reader 不能先塞自己的进容器 */
    expect(html).not.toContain('data-p="search"');
  });
});
