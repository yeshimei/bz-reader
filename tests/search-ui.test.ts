import { afterEach, describe, expect, it } from 'vitest';
import type { ReaderBook } from '../src/data/schema';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';
import { RT } from '../src/shell/runtime';
import { viewSearch } from '../src/shell/render/search';
import { overlaySearch } from '../src/shell/overlay';
import { resetSemanticSearch } from '../src/shell/search-semantic';

/* ============================================================
 * 搜索页改版（2026-11-16 · 检索台）
 *
 * 原型 `prototype/search/` 的两件出口共用一套语汇：
 *   · 书架整页默认全库；
 *   · 阅读页弹窗默认本书；
 *   · 命中分布只在 ≥2 本时画；
 *   · 空态四张示例卡用真实数据；
 *   · 正文扫描中给进度块与占位行；
 *   · 无命中给「按意思搜」出口。
 * 这里钉的是结构与默认值，视觉尺寸由真机截图验收。
 * ============================================================ */

interface MakeBook {
  id: string;
  title: string;
  author?: string;
  chapter?: string;
  percent?: number;
  lastReadTime?: number;
  /** 每条标注：[原文, 想法?, 章节名?] */
  marks?: Array<[string, string?, string?]>;
}

function makeBook(o: MakeBook): ReaderBook {
  const highlights = (o.marks ?? []).map(([text, comment, chapterTitle], i) => ({
    id: `${o.id}-m${i}`,
    text,
    comment,
    chapterTitle,
    createdAt: 1000 + i,
  }));
  return {
    id: o.id,
    meta: { title: o.title, author: o.author ?? '' },
    fileRef: { format: 'epub', path: `${o.title}.epub` },
    reading: {
      position: { percent: o.percent ?? 0, chapterTitle: o.chapter ?? '' },
      stats: { totalReadTime: 0, lastReadTime: o.lastReadTime ?? 0 },
    },
    notes: { highlights },
    addedAt: 0,
    updatedAt: 0,
  } as unknown as ReaderBook;
}

function installSource(books: Array<MakeBook | ReaderBook>): void {
  setShellSource({ repo: { all: () => books } } as unknown as ShellSource);
}

/** 取某颗范围 chip 的 `<button>` 开标签，看它有没有 `on` */
function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

const library = [
  makeBook({
    id: 'b1',
    title: '围城',
    author: '钱锺书',
    chapter: '第一章',
    percent: 62,
    lastReadTime: 300,
    marks: [['鸿渐在船上望着远处的灯火', '这段写的是体面', '第一章']],
  }),
  makeBook({
    id: 'b2',
    title: '千亿个太阳',
    author: '鲁道夫·基彭哈恩',
    chapter: '第二章',
    percent: 31,
    lastReadTime: 200,
    marks: [['恒星把氢烧成氦的时候，整颗星都在发亮', undefined, '第二章']],
  }),
  makeBook({ id: 'b3', title: '没有读过的书', author: '某人' }),
];

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  resetSemanticSearch();
  RT.body.hits = [];
  RT.body.running = false;
  RT.body.stopped = false;
  RT.body.noBook = false;
  RT.body.kw = '';
  RT.body.done = 0;
  RT.body.total = 0;
  RT.body.more = {};
  RT.body.failed = [];
  RT.body.seq += 1;
  RT.semantic.listeners.clear();
});

describe('固定范围', () => {
  it('状态默认：书架全库、阅读页弹窗本书', () => {
    expect(DEFAULT_SHELL_STATE.searchScope).toBe('all');
    expect(DEFAULT_SHELL_STATE.searchFloatScope).toBe('book');
  });

  it('书架搜索页固定全库：没有范围开关，状态残留「本书」也按全库出结果', () => {
    installSource([
      makeBook({ id: 'b1', title: '围城', marks: [['金漆', undefined, '第一章']] }),
      makeBook({ id: 'b2', title: '千亿个太阳', marks: [['金漆', undefined, '第二章']] }),
    ]);
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1', searchScope: 'book', searchKw: '金漆' });
    const html = viewSearch();
    expect(html).not.toContain('data-act="searchscope"');
    expect(html).toContain('围城');
    expect(html).toContain('千亿个太阳');
  });

  it('阅读页弹窗固定本书：没有范围开关，状态残留「全库」也只出当前这本', () => {
    installSource([
      makeBook({ id: 'b1', title: '围城', marks: [['金漆', undefined, '第一章']] }),
      makeBook({ id: 'b2', title: '千亿个太阳', marks: [['金漆', undefined, '第二章']] }),
    ]);
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1', searchFloatScope: 'all', searchKw: '金漆' });
    const html = overlaySearch();
    expect(html).not.toContain('data-act="searchscope"');
    expect(html).toContain('围城');
    expect(html).not.toContain('千亿个太阳');
  });

  it('基础版在书架搜索页说明「全库正文搜索为高级版」', () => {
    installSource(library);
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
    expect(viewSearch()).toContain('全库正文搜索为高级版');
  });

  it('弹窗头写明当前是哪一本书', () => {
    installSource(library);
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
    expect(overlaySearch()).toContain('本书 · 《围城》');
  });
});

describe('命中分布', () => {
  function hitBooks(): ReaderBook[] {
    return ['a', 'b', 'c'].map((id, bi) =>
      makeBook({
        id,
        title: `书${bi + 1}`,
        marks: Array.from({ length: 4 }, (_, i) => [`金漆第 ${i} 处`, undefined, '第一章'] as [string, undefined, string]),
      }),
    );
  }

  it('3 本书 12 处命中：分布条画 3 段', () => {
    installSource(hitBooks());
    setState({ ...DEFAULT_SHELL_STATE, searchKw: '金漆' });
    const html = viewSearch();
    expect(count(html, 'class="bzs-srch-distseg"')).toBe(3);
    expect(html).toContain('共 12 处');
  });

  it('只有 1 本命中时不画分布条', () => {
    installSource([makeBook({ id: 'a', title: '书一', marks: [['金漆', undefined, '第一章']] })]);
    setState({ ...DEFAULT_SHELL_STATE, searchKw: '金漆' });
    expect(viewSearch()).not.toContain('bzs-srch-distbar');
  });
});

describe('空态示例卡', () => {
  it('没输入时出现四张示例卡，书名卡用最近读的真实书名', () => {
    installSource(library);
    setState({ ...DEFAULT_SHELL_STATE, searchKw: '' });
    const html = viewSearch();
    expect(count(html, 'class="bzs-srch-wcard')).toBe(4);
    expect(html).toContain('《围城》');
    expect(html).toContain('第一章');
    /* 最近在读只列真正读过的两本 */
    expect(html).toContain('最近在读');
    expect(html).toContain('千亿个太阳');
    expect(html).not.toContain('没有读过的书');
  });

  it('没有书 / 没有标注时示例卡退化成通用文案，不留空', () => {
    installSource([]);
    setState({ ...DEFAULT_SHELL_STATE, searchKw: '' });
    const html = viewSearch();
    expect(html).toContain('搜书名或作者');
    expect(html).toContain('搜章节名');
    expect(html).toContain('搜划线原文');
    expect(html).toContain('搜正文任意一句');
    expect(count(html, 'class="bzs-srch-wcard')).toBe(4);
  });
});

describe('正文扫描进度', () => {
  it('扫描中出进度块，含 done / total 与占位行', () => {
    installSource(library);
    setState({ ...DEFAULT_SHELL_STATE, searchKw: '恒星' });
    RT.body.kw = '恒星';
    RT.body.running = true;
    RT.body.done = 3;
    RT.body.total = 12;
    RT.body.hits = [
      {
        bookId: 'b2',
        bookTitle: '千亿个太阳',
        cfi: 'epubcfi(/6/8)',
        chapterLabel: '第二章',
        excerpt: '恒星把氢烧成氦',
      },
    ];
    const html = searchResultsHtmlFor('恒星');
    expect(html).toContain('bzs-srch-prog');
    expect(html).toContain('正在翻');
    expect(html).toContain('3');
    expect(html).toContain('12');
    expect(html).toContain('已找到');
    expect(html).toContain('bzs-srch-ghost');
  });

  it('书架页默认全库，扫描范围包含全部书', () => {
    installSource(library);
    setState({ ...DEFAULT_SHELL_STATE, searchKw: '恒星' });
    RT.body.kw = '恒星';
    RT.body.running = true;
    RT.body.total = 3;
    expect(searchResultsHtmlFor('恒星')).toContain('正在翻');
  });
});

describe('没有命中', () => {
  it('出无结果块，并给「按意思搜」出口', () => {
    installSource(library);
    setState({ ...DEFAULT_SHELL_STATE, searchKw: '青鸟' });
    RT.body.kw = '青鸟';
    const html = searchResultsHtmlFor('青鸟');
    expect(html).toContain('bzs-srch-miss');
    expect(html).toContain('没有找到「青鸟」');
    expect(html).toContain('data-v="semantic"');
    expect(html).toContain('按意思搜');
  });
});

/** 走 viewSearch 拿真实默认范围（书架 = searchScope） */
function searchResultsHtmlFor(kw: string): string {
  setState({ searchKw: kw });
  return viewSearch();
}
