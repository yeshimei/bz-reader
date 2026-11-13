// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { planClipBook, type PlanArticle } from '../src/data/clip-epub/plan';
import { todayStart } from '../src/data/clip-epub/scope';

const src = (id: string, name: string) => ({ id, name });
const art = (patch: Partial<PlanArticle> & { key: string; sourceId: string }): PlanArticle => ({
  title: patch.key,
  url: '',
  author: '',
  date: '',
  body: '',
  saved: false,
  sourceId: patch.sourceId,
  sourceName: patch.sourceId,
  ts: 0,
  state: 'unread',
  ...patch,
});

const sources = [src('s1', '少数派'), src('s2', '某 UP'), src('s3', '空源')];
const articles = [
  art({ key: 'a', sourceId: 's1', ts: 100, state: 'unread' }),
  art({ key: 'b', sourceId: 's1', ts: 300, state: 'saved', saved: true }),
  art({ key: 'c', sourceId: 's1', ts: 200, state: 'read' }),
  art({ key: 'd', sourceId: 's2', ts: 400, state: 'unread' }),
];

describe('planClipBook', () => {
  it('默认全部源、含未读，源内按最新排序，空源丢弃', () => {
    const plan = planClipBook(sources, articles);
    expect(plan.sources.map((s) => s.name)).toEqual(['少数派', '某 UP']);
    expect(plan.sources[0].articles.map((a) => a.key)).toEqual(['b', 'c', 'a']);
    expect(plan.articleCount).toBe(4);
    expect(plan.sourceCount).toBe(2);
    expect(plan.filtered).toBe(0);
  });

  it('只选一个源', () => {
    const plan = planClipBook(sources, articles, { sources: ['s2'] });
    expect(plan.sources.map((s) => s.name)).toEqual(['某 UP']);
    expect(plan.filtered).toBe(3);
  });

  it('关掉未保存：只留 saved', () => {
    const plan = planClipBook(sources, articles, { includeUnsaved: false });
    expect(plan.sources.flatMap((s) => s.articles.map((a) => a.key))).toEqual(['b']);
    expect(plan.filtered).toBe(3);
  });

  it('最早优先', () => {
    const plan = planClipBook(sources, articles, { order: 'oldest' });
    expect(plan.sources[0].articles.map((a) => a.key)).toEqual(['a', 'c', 'b']);
  });

  it('只剩空源时给一本空书', () => {
    const plan = planClipBook(sources, [], {});
    expect(plan.sources).toEqual([]);
    expect(plan.articleCount).toBe(0);
  });

  /* 汇总范围（2026-11-14）：设置里三选一，book 只收范围内的文章。
     这里钉住「plan 层真的照做」——scope 的边界判定在 clip-scope.test.ts。 */
  it('范围=未读：读过的那篇不进书，剪藏与未读都留着', () => {
    const plan = planClipBook(sources, articles, { scope: 'unread' });
    expect(plan.sources.flatMap((s) => s.articles.map((a) => a.key))).toEqual(['b', 'a', 'd']);
    expect(plan.articleCount).toBe(3);
    expect(plan.filtered).toBe(1);
  });

  it('范围=今日+未读：今天发的读过文章也能进（ts 在零点之后）', () => {
    const start = todayStart();
    const today = [
      art({ key: 'a', sourceId: 's1', ts: start, state: 'unread' }),
      art({ key: 'b', sourceId: 's1', ts: start + 1, state: 'read' }),
      art({ key: 'c', sourceId: 's1', ts: start - 1, state: 'read' }),
    ];
    const plan = planClipBook(sources, today, { scope: 'todayUnread' });
    expect(plan.sources.flatMap((s) => s.articles.map((a) => a.key)).sort()).toEqual(['a', 'b']);
  });

  it('范围=全部：读过的也收（用户显式选了全部）', () => {
    const plan = planClipBook(sources, articles, { scope: 'all' });
    expect(plan.articleCount).toBe(4);
    expect(plan.filtered).toBe(0);
  });
});
