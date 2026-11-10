/**
 * 划线 → 复习卡（data/review-sync.ts）。
 *
 * 这条链路有一半风险在盘上：同名怎么办、用户改过的卡会不会被重写、
 * 卡片被删之后还能不能重来。这里用一个内存 adapter 把这几条钉住。
 */
import { describe, expect, it, vi } from 'vitest';
import { FakeAdapter } from './helpers/fake-adapter';
import { makeApp, testBook } from './helpers/plugin-harness';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { normalizeReviewDir, refreshReviewCard, reviewCardFor, syncReviewCard } from '../src/data/review-sync';
import { REVIEW_CARD_MARK, REVIEW_IDEA_END, REVIEW_IDEA_START } from '../src/data/review-card';
import type { Highlight, ReaderBook } from '../src/data/schema';
import type { BzReviewFacade } from '../src/data/bz-bridge';

interface PlanSpy extends BzReviewFacade {
  added: string[];
}

function planSpy(outcome: { added: boolean; reason?: 'exists' | 'notFound' } = { added: true }): PlanSpy {
  const added: string[] = [];
  return {
    added,
    isReady: () => true,
    hasNote: async () => false,
    addNote: async (p: string) => {
      added.push(p);
      return outcome;
    },
    addNotes: async () => ({ added: 0, exists: 0, notFound: 0 }),
    removeNote: async () => false,
  };
}

function fixture() {
  const adapter = new FakeAdapter();
  const app = makeApp({ adapter });
  const book = testBook('b1', '活着') as unknown as ReaderBook;
  const h: Highlight = {
    id: 'hl-1',
    text: '她转过身',
    chapterTitle: '第十二章',
    cfiRange: 'epubcfi(/6/14!/4/2)',
    createdAt: 1,
  };
  return { adapter, app, book, h };
}

const settings = { ...DEFAULT_SETTINGS };

describe('复习卡目录归一', () => {
  it('空串与 / 都表示库根', () => {
    expect(normalizeReviewDir('')).toBe('');
    expect(normalizeReviewDir('/')).toBe('');
    expect(normalizeReviewDir('   ')).toBe('');
  });

  it('去掉首尾斜杠（否则会拼出 /读书/复习//卡.md）', () => {
    expect(normalizeReviewDir('/读书/复习/')).toBe('读书/复习');
  });
});

describe('生成复习卡', () => {
  it('新卡：写进配置的目录，并交给复习门面', async () => {
    const { adapter, app, book, h } = fixture();
    const plan = planSpy();
    const res = await syncReviewCard({ app, book, highlight: h, settings, plan });

    expect(res.written).toBe(true);
    expect(res.reused).toBe(false);
    expect(res.added).toBe(true);
    expect(res.path).toBe('bz-reader/review/她转过身.md');
    expect(adapter.files.get(res.path)).toContain(REVIEW_CARD_MARK);
    expect(plan.added).toEqual([res.path]);
  });

  it('目录配成库根时落在根下，不拼出绝对路径', async () => {
    const { app, book, h } = fixture();
    const res = await syncReviewCard({
      app,
      book,
      highlight: { ...h, id: 'hl-2' },
      settings: { ...settings, reviewDir: '/' },
      plan: planSpy(),
    });
    expect(res.path).toBe('她转过身.md');
  });

  it('已经记过路径且文件还在：复用，不重写（用户在卡片里补的想法不能冲掉）', async () => {
    const { adapter, app, book, h } = fixture();
    const plan = planSpy();
    const first = await syncReviewCard({ app, book, highlight: h, settings, plan });
    const before = adapter.files.get(first.path);
    const writes = adapter.writes.length;

    /* 模拟用户往卡片里补了一行自己的想法 */
    adapter.files.set(first.path, `${before}\n\n我的补充`);
    const second = await syncReviewCard({
      app,
      book,
      highlight: { ...h, review: { path: first.path, at: 1 } },
      settings,
      plan,
    });

    expect(second.written).toBe(false);
    expect(second.reused).toBe(true);
    expect(adapter.files.get(first.path)).toContain('我的补充');
    expect(adapter.writes.length).toBe(writes);
  });

  it('同名文件是别人的笔记：让开成「(2)」，不覆盖', async () => {
    const { adapter, app, book, h } = fixture();
    adapter.dirs.add('bz-reader/review');
    adapter.files.set('bz-reader/review/她转过身.md', '别人手写的笔记');

    const res = await syncReviewCard({ app, book, highlight: h, settings, plan: planSpy() });
    expect(res.path).toBe('bz-reader/review/她转过身 (2).md');
    expect(adapter.files.get('bz-reader/review/她转过身.md')).toBe('别人手写的笔记');
  });

  it('同名文件是这条划线的旧卡（记录丢了）：直接接管，不另造一张', async () => {
    const { adapter, app, book, h } = fixture();
    adapter.dirs.add('bz-reader/review');
    const ok = adapter as unknown as { files: Map<string, string> };
    ok.files.set('bz-reader/review/她转过身.md', reviewCardFor({ book, highlight: h }));

    const res = await syncReviewCard({ app, book, highlight: h, settings, plan: planSpy() });
    expect(res.path).toBe('bz-reader/review/她转过身.md');
  });

  it('卡片文件被删了：重新生成，不报错', async () => {
    const { adapter, app, book, h } = fixture();
    const plan = planSpy();
    const res = await syncReviewCard({
      app,
      book,
      highlight: { ...h, review: { path: 'bz-reader/review/旧路径.md', at: 1 } },
      settings,
      plan,
    });
    expect(res.written).toBe(true);
    expect(res.reused).toBe(false);
    expect(adapter.files.has(res.path)).toBe(true);
  });

  it('没有 bz 门面：照样写卡，只是没进复习计划', async () => {
    const { adapter, app, book, h } = fixture();
    const res = await syncReviewCard({ app, book, highlight: h, settings, plan: null });
    expect(res.written).toBe(true);
    expect(res.added).toBe(false);
    expect(res.reason).toBe('notFound');
    expect(adapter.files.has(res.path)).toBe(true);
  });

  it('门面说已经在计划里：原因原样带回去', async () => {
    const { app, book, h } = fixture();
    const res = await syncReviewCard({
      app,
      book,
      highlight: h,
      settings,
      plan: planSpy({ added: false, reason: 'exists' }),
    });
    expect(res.added).toBe(false);
    expect(res.reason).toBe('exists');
  });

  it('写盘失败会抛出去，交给调用方提示（不假装成功）', async () => {
    const { app, book, h } = fixture();
    (app.vault.adapter as unknown as { write: () => Promise<void> }).write = () => Promise.reject(new Error('EACCES'));
    (app.vault.adapter as unknown as { rename: () => Promise<void> }).rename = () => Promise.reject(new Error('EACCES'));
    await expect(syncReviewCard({ app, book, highlight: h, settings, plan: planSpy() })).rejects.toThrow();
  });
});

describe('卡片正文', () => {
  it('带书名、章节、原文与回到原文的双链', async () => {
    const { app, book, h } = fixture();
    const md = reviewCardFor({ book, highlight: h });
    expect(md).toContain('# 活着 · 第十二章');
    expect(md).toContain('> 她转过身');
    expect(md).toContain('书/b1.epub#bzr-cfi=');
    expect(app).toBeTruthy();
  });
});

describe('重建卡片：换掉自动区，留住用户写的想法', () => {
  it('划线文字改了，重建后是新原文；想法那一段原样捞回来', async () => {
    const { adapter, app, book, h } = fixture();
    adapter.files.set(
      'bz-reader/review/卡片.md',
      '---' + String.fromCharCode(10) + 'highlight: "hl-1"' + String.fromCharCode(10) + '---' + String.fromCharCode(10) + String.fromCharCode(10) + '# 活着' + String.fromCharCode(10) + String.fromCharCode(10) + '> 旧的原文' + String.fromCharCode(10) + String.fromCharCode(10) + REVIEW_IDEA_START + String.fromCharCode(10) + '我自己补的' + String.fromCharCode(10) + REVIEW_IDEA_END + String.fromCharCode(10) + String.fromCharCode(10) + REVIEW_CARD_MARK,
    );
    const mark = { ...h, text: '改过的原文', review: { path: 'bz-reader/review/卡片.md', at: 1, scheduled: true } };
    const res = await refreshReviewCard({ app, book, highlight: mark, settings, plan: null });
    expect(res.updated).toBe(true);
    const now = adapter.files.get('bz-reader/review/卡片.md')!;
    expect(now).toContain('> 改过的原文');
    expect(now).toContain('我自己补的');
  });

  it('不是我们写的卡：一个字都不动', async () => {
    const { adapter, app, book, h } = fixture();
    adapter.files.set('bz-reader/review/别人的.md', '# 别人手写的');
    const mark = { ...h, review: { path: 'bz-reader/review/别人的.md', at: 1, scheduled: true } };
    const res = await refreshReviewCard({ app, book, highlight: mark, settings, plan: null });
    expect(res.updated).toBe(false);
    expect(adapter.files.get('bz-reader/review/别人的.md')).toBe('# 别人手写的');
  });

  it('文件不在了：返回没更新，不造新卡', async () => {
    const { app, book, h } = fixture();
    const mark = { ...h, review: { path: 'bz-reader/review/不存在.md', at: 1, scheduled: true } };
    const res = await refreshReviewCard({ app, book, highlight: mark, settings, plan: null });
    expect(res.updated).toBe(false);
  });
});