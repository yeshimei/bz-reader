/**
 * 剪藏本实时刷新：结构判定、key/URL 迁移、只同步状态不重排。
 *
 * 真机回归（2026-11-13）：
 *   · 标一篇已读 → 20 秒轮询重建整本 → 同一处页码 196/552 变 691/1587；
 *   · 当前章「存为剪藏」后 key 从 url: 变 clip:，位置被挪到相邻一篇。
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  carryMeasuredPages,
  clipStructureChanged,
  migrateClipKey,
  syncClipChapterMeta,
} from '../src/data/clip-epub/refresh';
import type { ClipBookSnapshot } from '../src/data/clip-book';
import type { ClipChapter } from '../src/engine/clipbook';

const chapter = (key: string, title: string, patch: Partial<ClipChapter> = {}): ClipChapter => ({
  key,
  title,
  sourceId: 's1',
  sourceName: '少数派',
  author: '少数派',
  date: '2026-11-01',
  url: `https://x.com/${key}`,
  state: 'unread',
  notePath: null,
  body: '',
  ...patch,
});

const snap = (chapters: ClipChapter[], version = 'v1'): ClipBookSnapshot => ({
  version,
  title: '剪藏本',
  groups: [],
  chapters,
  articleCount: chapters.length,
  sourceCount: 1,
});

describe('剪藏本刷新 · 结构判定', () => {
  it('只改已读状态 / 笔记路径不算结构变化（不该重排整本书）', () => {
    const a = snap([chapter('url:a', 'A'), chapter('url:b', 'B')]);
    const b = snap([
      chapter('url:a', 'A', { state: 'read' }),
      chapter('url:b', 'B', { state: 'saved', notePath: '归档/A.md' }),
    ]);
    expect(clipStructureChanged(a, b)).toBe(false);
    expect(clipStructureKeyOf(a)).toBe(clipStructureKeyOf(b));
  });

  it('增删文章、改标题、换顺序都算结构变化', () => {
    const base = [chapter('url:a', 'A'), chapter('url:b', 'B')];
    const add = [chapter('url:a', 'A'), chapter('url:b', 'B'), chapter('url:c', 'C')];
    const rename = [chapter('url:a', 'A 改'), chapter('url:b', 'B')];
    const reorder = [chapter('url:b', 'B'), chapter('url:a', 'A')];
    expect(clipStructureChanged(snap(base), snap(add))).toBe(true);
    expect(clipStructureChanged(snap(base), snap(rename))).toBe(true);
    expect(clipStructureChanged(snap(base), snap(reorder))).toBe(true);
  });
});

describe('剪藏本刷新 · 位置迁移', () => {
  const handle = (chapters: ClipChapter[]) => ({
    chapters,
    byKey: (key: string) => chapters.find((c) => c.key === key) ?? null,
  });

  it('key 还在就原样用', () => {
    const h = handle([chapter('url:a', 'A')]);
    expect(migrateClipKey(h, 'url:a', 'https://x.com/url:a')).toBe('url:a');
  });

  it('存为剪藏后 key 从 url: 变 clip:，按 URL 认回同一篇', () => {
    /* 门面按 URL 去重：同一篇只剩剪藏这一行，news 的 url: 行已经没了 */
    const h = handle([chapter('clip:归档/A.md', 'A', { url: 'https://x.com/url:a', state: 'saved' })]);
    expect(migrateClipKey(h, 'url:a', 'https://x.com/url:a')).toBe('clip:归档/A.md');
  });

  it('URL 也为空/对不上：保留旧 key，交给百分比兜底', () => {
    const h = handle([chapter('url:b', 'B')]);
    expect(migrateClipKey(h, 'url:a', '')).toBe('url:a');
  });
});

describe('剪藏本刷新 · 状态就地同步', () => {
  it('把新快照的已读/已存/笔记路径写进现有章节，并报告有变化', () => {
    const target = [chapter('url:a', 'A'), chapter('url:b', 'B')];
    const fresh = snap([chapter('url:a', 'A', { state: 'read' }), chapter('url:b', 'B')]);
    expect(syncClipChapterMeta({ chapters: target }, fresh)).toBe(true);
    expect(target[0].state).toBe('read');
    expect(target[1].state).toBe('unread');

    expect(syncClipChapterMeta({ chapters: target }, fresh)).toBe(false);
  });
});

function clipStructureKeyOf(s: ClipBookSnapshot): string {
  return s.chapters.map((c) => `${c.key}\u0000${c.title}`).join('\u0001');
}

describe('剪藏本刷新 · 实测页数迁移', () => {
  it('同一位置还是同一篇才带实测页数；下标挪位的不带', () => {
    const oldKeys = ['a', 'b', 'c'];
    const measured = new Map([[0, 2], [1, 40], [2, 3]]);
    /* 新增一篇在最前面：a 挪到 1，只有 b、c 的位置对不上，全不带 */
    expect(carryMeasuredPages(oldKeys, ['x', 'a', 'b', 'c'], measured).size).toBe(0);
    /* 只改一篇的 key（存为剪藏）：其余位置照带 */
    const kept = carryMeasuredPages(oldKeys, ['a', 'clip:b', 'c'], measured);
    expect([...kept.entries()]).toEqual([[0, 2], [2, 3]]);
  });
});
