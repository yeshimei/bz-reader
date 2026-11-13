/**
 * 剪藏本在书架上的样子（真机两组反馈）：
 *   · 封面只竖排「剪藏」两个字，和真 EPUB 并排像没做完的占位卡；
 *   · 作者位写「bz 剪藏本」，读者会以为这是作者名。
 */
import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { toRow } from '../src/shell/adapt';
import { coverHtml } from '../src/shell/render/html';
import { makeClipBookRecord } from '../src/data/clip-book-entry';

const app = { vault: { adapter: { getResourcePath: () => '' } } } as unknown as App;

describe('剪藏本书架卡片', () => {
  it('作者位只留来源「bz」，不是「bz 剪藏本」', () => {
    const book = makeClipBookRecord('剪藏本');
    expect(toRow(app, book).author).toBe('bz');
  });

  it('封面给完整书名与「23 篇 · 3 源 · 实时更新」', () => {
    const book = makeClipBookRecord('剪藏本');
    book.meta.clipArticleCount = 23;
    book.meta.clipSourceCount = 3;
    const row = toRow(app, book);
    expect(row.clip).toBe(true);
    expect(row.clipArticleCount).toBe(23);

    const html = coverHtml(row);
    expect(html).toContain('剪藏本');
    expect(html).toContain('23 篇');
    expect(html).toContain('3 源');
    expect(html).toContain('实时更新');
  });

  it('没打开过的剪藏本：封面仍有完整书名，不显示 0 篇', () => {
    const row = toRow(app, makeClipBookRecord('剪藏本'));
    const html = coverHtml(row);
    expect(html).toContain('剪藏本');
    expect(html).not.toContain('0 篇');
  });
});
