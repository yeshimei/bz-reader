import { describe, expect, it } from 'vitest';
import type { MarkRow } from '../src/shell/domain';
import { viewNotes } from '../src/shell/render/notes';

/**
 * 每日回顾的「问问 AI」（2026-11-10）。
 *
 * 回顾块原本只有「下一条 / 跳到原文」：回来看看一条旧想法，看完也就看完了。
 * 现在多一颗「问问 AI」——基于那条划线与当时写的想法，让模型出一句追问；
 * 追问可以落进想法继续写。
 *
 * 三条要守的：
 *   1. 按钮永远在（没配 AI 时点了给提示，不是把入口藏起来）；
 *   2. 结果只挂在**当前这一条**回顾上（换一条不该带着上一条的追问）；
 *   3. 失败也留在块里，重试入口不丢。
 *
 * 每条只放一条有想法的标注：回顾按「年内第几天」轮，放两条时当前是哪条
 * 取决于今天，断言会随日期漂移。
 */

function mark(id: string, patch: Partial<MarkRow> = {}): MarkRow {
  return {
    id,
    bookId: 'b1',
    bookTitle: '一本测试书',
    bookAuthor: '作者',
    text: `划线 ${id}`,
    comment: `想法 ${id}`,
    color: 'amber',
    colorLabel: '琥珀',
    css: '#e8b53a',
    chapterTitle: '第一章',
    chapterIndex: 0,
    createdAt: 1,
    cfiRange: `cfi-${id}`,
    ...patch,
  };
}

type Probe = Parameters<typeof viewNotes>[0]['probe'];

function html(patch: { probe?: Probe; marks?: MarkRow[] } = {}): string {
  return viewNotes({
    marks: patch.marks ?? [mark('a')],
    filter: 'all',
    kw: '',
    reviewIdx: 0,
    select: false,
    picked: [],
    probe: patch.probe,
  });
}

describe('每日回顾 · AI 追问', () => {
  it('回顾块里有「问问 AI」入口，带着这一条的 id 与书 id', () => {
    const h = html();
    expect(h).toContain('data-act="reviewask"');
    expect(h).toMatch(/data-act="reviewask"[^>]*data-id="a"/);
    expect(h).toMatch(/data-act="reviewask"[^>]*data-book="b1"/);
  });

  it('请求中：显示正在想，按钮仍在（可重试）', () => {
    const h = html({ probe: { id: 'a', text: '', status: 'busy' } });
    expect(h).toContain('正在想');
    expect(h).toContain('data-act="reviewask"');
  });

  it('拿到追问：问题画在回顾块里，并给「存进想法」', () => {
    const h = html({ probe: { id: 'a', text: '你当时为什么这么想？', status: 'done' } });
    expect(h).toContain('你当时为什么这么想？');
    expect(h).toContain('data-act="probeidea"');
  });

  it('换一条回顾：上一条的追问不跟过去', () => {
    const h = html({ marks: [mark('b')], probe: { id: 'a', text: '只属于 a 的追问', status: 'done' } });
    expect(h).not.toContain('只属于 a 的追问');
    expect(h).not.toContain('data-act="probeidea"');
  });

  it('失败：原因留在块里，能再问一次', () => {
    const h = html({ probe: { id: 'a', text: '接口 401', status: 'error' } });
    expect(h).toContain('接口 401');
    expect(h).toContain('data-act="reviewask"');
  });
});
