import { describe, expect, it } from 'vitest';
import type { SemanticHit } from '../src/data/book-search';
import { buildRouteMessages, routeCandidates, routeMarkdown } from '../src/data/topic-route';

/**
 * 主题书单（2026-11-11）。
 *
 * 输入一个主题，用画像向量找书与章节，再让模型排一条「先读哪本」的路线。
 * 与「问这摞书」相反：那边用户指定书，这边让检索去找。
 *
 * 纯逻辑三块：候选怎么聚、prompt 怎么拼、书单怎么落成 Markdown。
 */

function hit(patch: Partial<SemanticHit> = {}): SemanticHit {
  return {
    bookId: 'b1',
    title: '书甲',
    chapter: '第一章',
    chunk: '一段话',
    score: 0.9,
    ...patch,
  };
}

describe('routeCandidates', () => {
  it('同一本书的多个命中合并成一行，章名去重且按相关度保留前几章', () => {
    const list = [
      hit({ bookId: 'a', title: '书甲', chapter: '第一章', score: 0.9 }),
      hit({ bookId: 'a', title: '书甲', chapter: '第一章', score: 0.85 }),
      hit({ bookId: 'a', title: '书甲', chapter: '第二章', score: 0.8 }),
      hit({ bookId: 'a', title: '书甲', chapter: '第三章', score: 0.7 }),
      hit({ bookId: 'a', title: '书甲', chapter: '第四章', score: 0.6 }),
    ];
    const out = routeCandidates(list, 3);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ bookId: 'a', title: '书甲', best: 0.9, hits: 5 });
    expect(out[0]!.chapters).toEqual(['第一章', '第二章', '第三章']);
  });

  it('按最高分降序，不是按命中数', () => {
    const list = [
      hit({ bookId: 'a', score: 0.5 }),
      hit({ bookId: 'b', score: 0.9 }),
      hit({ bookId: 'b', score: 0.85 }),
    ];
    expect(routeCandidates(list).map((r) => r.bookId)).toEqual(['b', 'a']);
  });

  it('空输入返回空数组', () => {
    expect(routeCandidates([])).toEqual([]);
  });
});

describe('buildRouteMessages', () => {
  it('主题与候选书名、章节都进上下文，要求只用列出的书', () => {
    const msgs = buildRouteMessages({
      topic: '知行合一',
      books: [{ bookId: 'a', title: '书甲', chapters: ['第一章'], best: 0.9, hits: 2 }],
    });
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain('只用');
    const all = msgs.map((m) => m.content).join('\n');
    expect(all).toContain('知行合一');
    expect(all).toContain('书甲');
    expect(all).toContain('第一章');
  });

  it('没有候选时明说只能给方向，不编书名', () => {
    const msgs = buildRouteMessages({ topic: '某个主题', books: [] });
    expect(msgs[0]!.content).toContain('没有找到');
  });
});

describe('routeMarkdown', () => {
  const base = {
    topic: '知行合一',
    body: '先读书甲第一章。',
    day: '2026-11-11',
    books: [{ bookId: 'a', title: '书甲', chapters: ['第一章'], best: 0.9, hits: 2 }],
  };

  it('带 frontmatter、标题、正文与来源', () => {
    const md = routeMarkdown(base);
    expect(md).toContain('---');
    expect(md).toContain('主题书单 · 知行合一');
    expect(md).toContain('先读书甲第一章。');
    expect(md).toContain('书甲 · 第一章');
    expect(md).toContain('2026-11-11');
  });

  it('正文为空时返回空串（调用方据此不写盘）', () => {
    expect(routeMarkdown({ ...base, body: '  ' })).toBe('');
  });

  it('主题里的引号不会打断 frontmatter', () => {
    const md = routeMarkdown({ ...base, topic: '他说"你好"' });
    expect(md.split('\n---').length).toBeGreaterThanOrEqual(2);
  });
});
