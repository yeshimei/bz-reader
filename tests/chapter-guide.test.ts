import { describe, expect, it } from 'vitest';
import type { PortraitFile } from '../src/data/portrait';
import { buildGuideMessages, chapterDigestOf, guideOf, withGuide } from '../src/data/chapter-guide';

/**
 * 开章导读（2026-11-11）。
 *
 * 读完一章（或刚翻开一章）时，点一下拿一份「这一章在讲什么 + 带着哪几个
 * 问题读」。三条约束：
 *   1. **按章落盘**：同一章只花一次钱，下次打开直接看；
 *   2. **不自动调用**：用户点了命令才生成；
 *   3. **章名是键**：章节名就是书里目录上那串字，不另造 id——换书版本
 *      自然对不上，与画像「换版本 = 另一本书」同一口径。
 */

function portrait(patch: Partial<PortraitFile> = {}): PortraitFile {
  return {
    version: 1,
    bookId: 'b1',
    bookTitle: '一本书',
    plan: 'vector',
    model: 'm1',
    chunkChars: 1000,
    total: 1,
    blocks: [{ chapter: '第一章', chars: 10, text: '正文' }],
    createdAt: 1,
    updatedAt: 1,
    done: true,
    ...patch,
  };
}

describe('guideOf', () => {
  it('取出某一章的导读', () => {
    const p = portrait({ guides: { 第一章: '这一章讲开端。', 第二章: '这一章讲冲突。' } });
    expect(guideOf(p, '第一章')).toBe('这一章讲开端。');
  });

  it('没有画像 / 没有这一章 / 章名为空都返回空串', () => {
    expect(guideOf(null, '第一章')).toBe('');
    expect(guideOf(portrait(), '第三章')).toBe('');
    expect(guideOf(portrait({ guides: { 第一章: 'x' } }), '')).toBe('');
  });
});

describe('withGuide', () => {
  it('返回新对象，原画像不动', () => {
    const p = portrait();
    const next = withGuide(p, '第一章', '导读正文');
    expect(next).not.toBe(p);
    expect(p.guides).toBeUndefined();
    expect(next.guides?.['第一章']).toBe('导读正文');
  });

  it('同一章再写是覆盖，别的章还在', () => {
    const once = withGuide(portrait(), '第一章', '旧');
    const twice = withGuide(once, '第一章', '新');
    expect(twice.guides?.['第一章']).toBe('新');
    const both = withGuide(twice, '第二章', '第二章的');
    expect(Object.keys(both.guides ?? {}).sort()).toEqual(['第一章', '第二章']);
  });

  it('章名为空 / 正文为空时不写（不留一条空导读）', () => {
    const p = portrait();
    expect(withGuide(p, '', '正文').guides).toBeUndefined();
    expect(withGuide(p, '第一章', '   ').guides).toBeUndefined();
  });

  it('导读过长时截断（画像文件里不该出现一篇长文）', () => {
    const long = withGuide(portrait(), '第一章', '长'.repeat(5000));
    expect(long.guides!['第一章'].length).toBeLessThanOrEqual(2001);
  });
});

describe('chapterDigestOf', () => {
  it('从画像里找这一章的摘要（compress 方案的要点优先）', () => {
    const p = portrait({
      blocks: [
        { chapter: '第一章', chars: 10, digest: '一句话' },
        { chapter: '第二章', chars: 10, summary: '一段要点' },
      ],
    });
    expect(chapterDigestOf(p, '第一章')).toBe('一句话');
    expect(chapterDigestOf(p, '第二章')).toBe('一段要点');
  });

  it('没有这一章 / 没有画像返回空串', () => {
    expect(chapterDigestOf(portrait(), '第三章')).toBe('');
    expect(chapterDigestOf(null, '第一章')).toBe('');
  });
});

describe('buildGuideMessages · guide', () => {
  it('章名与书名进上下文，要求给三句话与问题', () => {
    const msgs = buildGuideMessages({ chapter: '第二章 出走的少年', book: '一本书' });
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain('问题');
    const all = msgs.map((m) => m.content).join('\n');
    expect(all).toContain('第二章 出走的少年');
    expect(all).toContain('一本书');
  });

  it('有章摘要时一并带上（让导读贴着这一章，而不是复述全书）', () => {
    const all = buildGuideMessages({ chapter: '第一章', digest: '这一章交代了家世。' })
      .map((m) => m.content)
      .join('\n');
    expect(all).toContain('这一章交代了家世。');
  });

  it('没有章摘要时不出现那一节', () => {
    const all = buildGuideMessages({ chapter: '第一章' }).map((m) => m.content).join('\n');
    expect(all).not.toContain('【章摘要】');
  });
});
