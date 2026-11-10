import { describe, expect, it } from 'vitest';
import type { MarkRow } from '../src/shell/domain';
import { groupMaterials, matchMarks, materialMarkdown } from '../src/data/material-kit';

/**
 * 写作素材包（2026-11-11）。
 *
 * 把划过、想过的东西按主题收拢成一篇能直接用的稿子。这一档**不花 AI**：
 * 匹配是本地字面，排序按命中数，用户看得见为什么它被收进来。
 *
 * 三条：
 *   1. 主题词支持逗号 / 顿号 / 空格分隔；
 *   2. 想法也参与匹配——「划过但没想法」的句子常常只是半句，写东西时更想要
 *      自己写过的那些；
 *   3. 输出按书分组，每条带出处，能直接贴进文章。
 */

function mark(id: string, patch: Partial<MarkRow> = {}): MarkRow {
  return {
    id,
    bookId: 'b1',
    bookTitle: '书甲',
    bookAuthor: '作者',
    text: `划线 ${id}`,
    comment: '',
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

describe('matchMarks', () => {
  it('多个主题词按逗号 / 顿号 / 空格拆开', () => {
    const marks = [mark('a', { text: '知行合一，事上磨炼' })];
    expect(matchMarks(marks, '知行合一、磨炼')).toHaveLength(1);
    expect(matchMarks(marks, '知行合一 磨炼')).toHaveLength(1);
    expect(matchMarks(marks, '知行合一，磨炼')).toHaveLength(1);
  });

  it('想法也算命中（写在想法里的主题词同样被收进来）', () => {
    const marks = [mark('a', { text: '一段原文', comment: '这段讲的是知行合一' })];
    const out = matchMarks(marks, '知行合一');
    expect(out).toHaveLength(1);
    expect(out[0]!.where).toContain('idea');
  });

  it('命中词多的排在前面', () => {
    const marks = [
      mark('a', { text: '只讲到知行合一' }),
      mark('b', { text: '知行合一与事上磨炼，都在讲知行合一' }),
    ];
    const out = matchMarks(marks, '知行合一 磨炼');
    expect(out[0]!.mark.id).toBe('b');
  });

  it('英文不分大小写', () => {
    const marks = [mark('a', { text: 'Mindfulness and attention' })];
    expect(matchMarks(marks, 'mindfulness')).toHaveLength(1);
  });

  it('单字词不收（噪音太大）', () => {
    const marks = [mark('a', { text: '知行合一' })];
    expect(matchMarks(marks, '知')).toHaveLength(0);
  });

  it('空白主题返回空', () => {
    expect(matchMarks([mark('a')], '   ')).toEqual([]);
  });
});

describe('groupMaterials', () => {
  it('按书分组，书内保持命中顺序', () => {
    const list = matchMarks(
      [
        mark('a', { bookId: 'b1', bookTitle: '书甲', text: '知行合一' }),
        mark('b', { bookId: 'b2', bookTitle: '书乙', text: '知行合一' }),
        mark('c', { bookId: 'b1', bookTitle: '书甲', text: '知行合一再谈' }),
      ],
      '知行合一',
    );
    const groups = groupMaterials(list);
    expect(groups.map((g) => g.bookId)).toEqual(['b1', 'b2']);
    expect(groups[0]!.rows.map((r) => r.mark.id)).toEqual(['a', 'c']);
  });
});

describe('materialMarkdown', () => {
  const list = matchMarks(
    [
      mark('a', { text: '知行合一', comment: '我的想法' }),
      mark('b', { bookId: 'b2', bookTitle: '书乙', text: '知行合一，另一种说法' }),
    ],
    '知行合一',
  );

  it('标题带主题与日期，每条带原文与出处', () => {
    const md = materialMarkdown({ topic: '知行合一', day: '2026-11-11', groups: groupMaterials(list) });
    expect(md).toContain('素材包 · 知行合一 · 2026-11-11');
    expect(md).toContain('知行合一');
    expect(md).toContain('书甲 · 第一章');
    expect(md).toContain('书乙');
  });

  it('有想法的排在原文下面', () => {
    const md = materialMarkdown({ topic: '知行合一', day: '2026-11-11', groups: groupMaterials(list) });
    expect(md).toContain('我的想法');
  });

  it('没有命中时返回空串', () => {
    expect(materialMarkdown({ topic: 'x', day: '2026-11-11', groups: [] })).toBe('');
  });
});
