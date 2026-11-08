import { describe, expect, it } from 'vitest';
import type { MarkRow } from '../src/shell/domain';
import { noteCardHtml, viewNotes } from '../src/shell/render/notes';

function mark(id: string, patch: Partial<MarkRow> = {}): MarkRow {
  return {
    id,
    bookId: 'b1',
    bookTitle: '一本测试书',
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

function html(patch: Partial<Parameters<typeof viewNotes>[0]> = {}): string {
  return viewNotes({
    marks: [mark('a'), mark('b')],
    filter: 'all',
    kw: '',
    reviewIdx: 0,
    select: false,
    picked: [],
    ...patch,
  });
}

describe('标注多选（笔记页）', () => {
  it('非选择模式：有「选择」入口，没有逐条 checkbox', () => {
    const h = html();
    expect(h).toContain('data-act="notesel"');
    expect(h).not.toContain('data-act="notepick"');
  });

  /* 2026-11-08：笔记头换成圆形语汇，「选择」是动作而不是筛选值，
     所以做成圆形图标钮（勾选框），文字交给 aria-label / title。 */
  it('「选择」是圆形图标钮，不再是一颗文字按钮', () => {
    const h = html();
    const tag = h.match(/<button[^>]*data-act="notesel"[^>]*>/)?.[0] ?? '';
    expect(tag).toContain('bzs-round');
    expect(tag).toContain('aria-label');
    expect(h).not.toContain('>选择<');
  });

  it('选择模式：每条卡片可勾选，顶部显示已选数量与批量操作', () => {
    const h = html({ select: true, picked: ['a'] });
    expect(h).toContain('data-act="notepick"');
    expect(h).toContain('已选 1 条');
    expect(h).toContain('data-act="notedrop"');
    expect(h).toContain('data-act="noteall"');
  });

  it('勾选框带 data-id，能对上具体那一条', () => {
    const h = html({ select: true, picked: [] });
    expect(h).toContain('data-act="notepick" data-id="a"');
    expect(h).toContain('data-act="notepick" data-id="b"');
  });

  it('已选中的卡片带 on 标记（重绘后仍看得出选没选）', () => {
    const h = html({ select: true, picked: ['a'] });
    expect(h).toMatch(/data-id="a"[^>]*class="[^"]*on|class="[^"]*on[^"]*"[^>]*data-id="a"/);
  });

  it('选择模式下不再出现「回到原文 / 双向链接」，避免误触走错', () => {
    const h = html({ select: true, picked: [] });
    expect(h).not.toContain('data-act="jumpmark"');
    expect(h).not.toContain('data-act="copylink"');
  });
});

/**
 * 知识盒双链：存在划线自己身上，显示成一枚可点的标签。
 *
 * 以前它是想法里的一行 `[[…]]` 纯文本——看得见文字、点不动，而且用户一改想法
 * 就把它删了。现在想法归想法，链接归链接，点标签直接开知识盒那篇笔记。
 */
describe('标注卡 · 知识盒标签', () => {
  it('没有链接：不冒出空标签', () => {
    expect(noteCardHtml(mark('a'))).not.toContain('data-act="kbopen"');
  });

  it('存过名词：卡片上有「名词」标签，带笔记路径与显示名', () => {
    const h = noteCardHtml(mark('a', { kb: [{ kind: 'term', path: '文献/心流.md', at: 1 }] }));
    expect(h).toContain('data-act="kbopen"');
    expect(h).toContain('data-path="文献/心流.md"');
    expect(h).toContain('心流');
  });

  it('名词与段落各一格，两颗都在', () => {
    const h = noteCardHtml(
      mark('a', {
        kb: [
          { kind: 'term', path: '文献/心流.md', at: 1 },
          { kind: 'passage', path: '文献/注意力.md', at: 2 },
        ],
      }),
    );
    expect(h.match(/data-act="kbopen"/g)?.length).toBe(2);
  });
});
