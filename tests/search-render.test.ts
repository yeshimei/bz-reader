import { afterEach, describe, expect, it } from 'vitest';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';
import { RT } from '../src/shell/runtime';
import { searchFormHtml, searchResultsHtml } from '../src/shell/render/search';

/* ============================================================
 * 搜索表单与结果渲染（fix/search-body）。
 *
 * 用户报的三件事里有两条是「看得见的东西」：正文档位与说明文案要去掉、
 * 搜不到内容。这一层用真实字符串钉住界面，避免以后再长回来。
 * ============================================================ */

const books = [
  {
    id: 'b1',
    title: '我的天才女友',
    meta: { title: '我的天才女友', author: '[意] 埃莱娜·费兰特' },
    notes: { highlights: [{ id: 'm1', text: '衣柜里什么都没', chapterTitle: '第一章' }] },
  },
  {
    id: 'b2',
    title: '血与蜜之地',
    meta: { title: '血与蜜之地', author: '刘子超' },
    notes: { highlights: [] },
  },
];

function installSource(): void {
  setShellSource({ repo: { all: () => books } } as unknown as ShellSource);
}

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  RT.body.hits = [];
  RT.body.running = false;
  RT.body.stopped = false;
  RT.body.noBook = false;
  RT.body.kw = '';
  RT.body.more = {};
  RT.body.failed = [];
  RT.body.seq += 1;
});

describe('搜索表单', () => {
  it('只剩「本书 / 全库」两档，不再有正文档位与搜正文按钮', () => {
    installSource();
    const html = searchFormHtml();
    expect(html).toContain('本书');
    expect(html).toContain('全库');
    expect(html).not.toContain('正文');
    expect(html).not.toContain('搜正文');
  });

  it('说明文案与「搜的是已建索引的内容」一起拿掉', () => {
    installSource();
    expect(searchFormHtml()).not.toContain('搜的是');
  });

  it('有词才出现清空键', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, searchKw: '天才' });
    expect(searchFormHtml()).toContain('data-act="searchclear"');
    setState({ ...DEFAULT_SHELL_STATE, searchKw: '' });
    expect(searchFormHtml()).not.toContain('data-act="searchclear"');
  });
});

describe('搜索结果', () => {
  it('空词时提示里不再提「正文」', () => {
    installSource();
    const html = searchResultsHtml('', 'all');
    expect(html).toContain('输入关键词');
    expect(html).not.toContain('搜正文');
  });

  it('书架页没有当前书时，「本书」明说先打开一本，而不是「没有找到」', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, bookId: null });
    const html = searchResultsHtml('天才', 'book');
    expect(html).toContain('先打开一本书');
    expect(html).not.toContain('没有找到');
  });

  it('书名命中立刻出结果（不等正文）', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
    const html = searchResultsHtml('天才', 'book');
    expect(html).toContain('data-act="openbook"');
    expect(html).toContain('<em>天才</em>');
  });

  /* 2026-11-09 iPhone 真机：结果行换成多行之后，整页文字互相叠在一起。
     WebKit 219372 记的就是这件事——iOS 上 <button> 承载多行内容渲染异常。
     所以结果行不再用按钮元素，改用 div + role=button，键盘照样可达。 */
  it('结果行用 div 承载多行文本，不再用 <button>（WebKit 219372）', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
    const html = searchResultsHtml('天才', 'book');
    expect(html).not.toContain('<button class="bzs-hit"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
  });

  it('正文命中按书追加，带 data-book 供跨书跳转', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
    RT.body.kw = '深夜';
    RT.body.hits = [
      { bookId: 'b2', bookTitle: '血与蜜之地', cfi: 'epubcfi(/6/8)', chapterLabel: '第三章', excerpt: '深夜的巴尔干' },
    ];
    const html = searchResultsHtml('深夜', 'all');
    expect(html).toContain('data-act="hittotext"');
    expect(html).toContain('data-book="b2"');
    expect(html).toContain('data-cfi="epubcfi(/6/8)"');
  });

  it('正文还在扫时显示进度与停止，不能先说「没有找到」', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
    RT.body.kw = '巴尔干';
    RT.body.running = true;
    RT.body.done = 0;
    RT.body.total = 2;
    const html = searchResultsHtml('巴尔干', 'all');
    expect(html).toContain('正在搜正文');
    expect(html).toContain('data-act="searchstop"');
    expect(html).not.toContain('没有找到');
  });
});

/* ============================================================
 * 截断要明说（2026-11-10）。
 *
 * 以前每本只画 20 条、分组头却写真实总数，多出来的部分既不显示也不提示；
 * PDF 更狠——同一页的命中在去重时塌成一条。现在：先画 50 条，头写
 * 「共 N 处 · 已显示 M 处」，点「显示更多」按 50 递增。
 * ============================================================ */
describe('搜索结果的截断提示', () => {
  const dense = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      bookId: 'b2',
      bookTitle: '血与蜜之地',
      cfi: `pdf/3/${i}-${i + 1}`,
      chapterLabel: '第 3 页',
      excerpt: `第 ${i} 处摘录`,
    }));

  function rowsOf(html: string): number {
    return (html.match(/data-act="hittotext"/g) ?? []).length;
  }

  it('超过 50 条：先画 50 条，头写真实条数与已显示条数', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
    RT.body.kw = '的';
    RT.body.hits = dense(60);
    const html = searchResultsHtml('的', 'all');
    expect(rowsOf(html)).toBe(50);
    expect(html).toContain('共 60 处');
    expect(html).toContain('已显示 50 处');
    expect(html).toContain('data-act="searchmore"');
  });

  it('展开之后按 50 递增，全部画完就不再给「显示更多」', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
    RT.body.kw = '的';
    RT.body.hits = dense(60);
    RT.body.more[`的\u0001b2`] = 50;
    const html = searchResultsHtml('的', 'all');
    expect(rowsOf(html)).toBe(60);
    expect(html).not.toContain('data-act="searchmore"');
    expect(html).not.toContain('已显示');
  });

  it('没超上限时不加「已显示」这种废话', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
    RT.body.kw = '的';
    RT.body.hits = dense(3);
    const html = searchResultsHtml('的', 'all');
    expect(rowsOf(html)).toBe(3);
    expect(html).not.toContain('已显示');
    expect(html).not.toContain('data-act="searchmore"');
  });

  it('打不开的书单列一行：不能静默当它「没有命中」', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
    RT.body.kw = '巴尔干';
    RT.body.failed = [{ id: 'b2', title: '血与蜜之地' }];
    const html = searchResultsHtml('巴尔干', 'all');
    expect(html).toContain('《血与蜜之地》打不开，未能搜索');
  });
});
