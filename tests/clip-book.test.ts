/**
 * 剪藏本数据层（data/clip-book.ts）：空数据必须是「可判定的空」。
 *
 * 2026-11-13 真机：新装 bz、一个源都没订阅时打开剪藏本是一整屏纯白——
 * 门面正常返回 0 篇，阅读页直接拿一本 0 章节的书去 open，foliate 不派发
 * 任何事件，也没有错误页。空状态必须由数据层说清楚，界面才有东西可画。
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { clipBookIsEmpty, loadClipBook } from '../src/data/clip-book';
import type { ClipbookFacade } from '../src/data/clipbook-bridge';

function fakeApp(facade: Partial<ClipbookFacade>): App {
  const full = {
    version: 1 as const,
    sources: async () => [],
    articles: async () => [],
    articleBody: async () => '',
    markRead: async () => 0,
    saveArticle: async () => ({ ok: false }),
    isReady: () => ({ ok: true }),
    dataVersion: async () => 'v0',
    ...facade,
  };
  return {
    plugins: { manifests: { bz: { version: '1.44.2' } }, plugins: { bz: { clipbook: full } } },
  } as unknown as App;
}

describe('loadClipBook · 空数据', () => {
  it('没有任何源/文章时返回 0 章，不抛错', async () => {
    const snap = await loadClipBook(fakeApp({}));
    expect(snap.chapters).toEqual([]);
    expect(snap.groups).toEqual([]);
    expect(snap.articleCount).toBe(0);
    expect(snap.sourceCount).toBe(0);
    expect(clipBookIsEmpty(snap)).toBe(true);
  });

  it('有文章时不是空书', async () => {
    const app = fakeApp({
      sources: async () => [{ id: 'rss:a', name: '少数派', kind: 'rss' }],
      articles: async () => [
        {
          key: 'url:https://a.com/1',
          origin: 'news',
          title: '文章 A',
          url: 'https://a.com/1',
          author: '少数派',
          sourceId: 'rss:a',
          source: '少数派',
          date: '2026-11-01',
          ts: 1790000000000,
          summary: '',
          state: 'unread',
          notePath: null,
          tags: [],
        },
      ],
    });
    const snap = await loadClipBook(app);
    expect(snap.chapters).toHaveLength(1);
    expect(snap.articleCount).toBe(1);
    expect(clipBookIsEmpty(snap)).toBe(false);
  });
});
