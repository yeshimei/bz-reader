/**
 * 路线图分组平铺（2026-11-19 作者要求「普通平铺，不需要折叠」）。
 * 之前第 3 个分组起默认带 fold、主题头可点折叠，且长分组被 flex 压缩 +
 * overflow:hidden 裁掉内容。现在所有分组恒展开、条目不裁剪。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { changelogNoteHtml, setChangelogDataForTests } from '../src/shell/changelog-note';
import type { ChangelogRelease } from '../src/core/changelog-data';
import type { BzrData } from '../src/data/bzr-data';

const release = (): ChangelogRelease => ({
  version: '1.5.3', date: '2026-11-15',
  added: [{ domain: '书架', text: '一条改动' }], improved: [], fixed: [],
} as ChangelogRelease);

const manyThemes = (n: number): BzrData => ({
  roadmap: Array.from({ length: n }, (_, i) => ({
    theme: '主题' + i, color: '#7856d6', order: i,
    items: Array.from({ length: 30 }, (_, j) => ({
      title: `条目${i}-${j}`, state: 'done', src: 'builtin',
      fb: { kind: 'issue', n: 1, label: '#1' },
    })),
  })),
  feedback: [],
  changelog: [], stats: { reward: 6, patrons: 8, premium: 47 }, links: {},
} as unknown as BzrData);

beforeEach(() => setChangelogDataForTests(null));

describe('路线图分组平铺，不折叠', () => {
  it('任意多个主题都不带 fold，主题头不再可点折叠', () => {
    setChangelogDataForTests(manyThemes(5));
    const html = changelogNoteHtml([release()], '', undefined, manyThemes(5));
    expect(html).not.toContain('rmtheme fold');
    expect(html).not.toContain('data-rm-theme');
    expect(html).not.toContain('bzs-chgn-chev');
    // 所有主题的条目都在 DOM 里，不因折叠被摘掉
    for (let i = 0; i < 5; i++) expect(html).toContain(`条目${i}-29`);
  });
});
