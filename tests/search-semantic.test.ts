import { afterEach, describe, expect, it } from 'vitest';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';
import { RT } from '../src/shell/runtime';
import { searchFormHtml, searchResultsHtml } from '../src/shell/render/search';
import {
  noteSemanticInput,
  resetSemanticSearch,
  semanticScopeFor,
} from '../src/shell/search-semantic';

/* ============================================================
 * 按意思搜接进两个搜索入口（2026-11-11）。
 *
 * 检索本身借 bz 的嵌入服务，node 里跑不了；这里钉的是「接线」：
 *   · 两个入口都露出并列的「按意思搜」，字面搜索的 chips 原样还在；
 *   · 切到按意思后，状态句永远在（没建画像 / 没激活 / 正在搜 / 空结果）；
 *   · 结果按书分组，行上带 data-act 与书号，点得动；
 *   · 书内入口只给「本书」的范围，没开书时明说先打开一本。
 * ============================================================ */

const books = [
  {
    id: 'b1',
    meta: { title: '我的天才女友', author: '[意] 埃莱娜·费兰特' },
    notes: { highlights: [] },
  },
  {
    id: 'b2',
    meta: { title: '血与蜜之地', author: '刘子超' },
    notes: { highlights: [] },
  },
];

function installSource(): void {
  setShellSource({ repo: { all: () => books } } as unknown as ShellSource);
}

function reset(): void {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  resetSemanticSearch();
  RT.semantic.listeners.clear();
}

afterEach(reset);

describe('两个入口的范围', () => {
  it('书架搜索页搜全库，书内搜索只搜当前这本', () => {
    expect(semanticScopeFor('shelf')).toBe('all');
    expect(semanticScopeFor('book')).toBe('book');
  });
});

describe('搜索表单里的「按意思搜」', () => {
  it('字面模式：不再给范围开关，只剩并列的「字面 / 按意思」', () => {
    installSource();
    const html = searchFormHtml('shelf');
    expect(html).not.toContain('data-act="searchscope"');
    expect(html).toContain('data-act="searchmode"');
    expect(html).toContain('data-v="semantic"');
    expect(html).toContain('按意思');
    expect(html).toContain('字面');
  });

  it('书内入口固定只搜这本书：表单里没有可点的范围', () => {
    installSource();
    expect(searchFormHtml('book')).not.toContain('data-act="searchscope"');
  });

  it('按意思模式：回车提示还在，范围开关不回来', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, searchMode: 'semantic', searchKw: '知行合一' });
    const html = searchFormHtml('shelf');
    expect(html).not.toContain('data-act="semrun"');
    expect(html).toContain('回车即搜');
    expect(html).not.toContain('data-act="searchscope"');
    expect(html).toContain('data-v="literal"');
    expect(html).toContain('字面');
    expect(html).toContain('描述你要找的内容');
  });
});

describe('按意思搜的结果区', () => {
  it('还没按回车时给提示，不是一片空白', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, searchMode: 'semantic', searchKw: '知行合一', bookId: 'b1' });
    RT.semantic.kw = '知行合一';
    RT.semantic.ran = false;
    const html = searchResultsHtml('知行合一', 'all', 'shelf');
    expect(html).toContain('回车开始');
  });

  it('没建画像 / 嵌入服务不可用：原因原样显示，不静默失败', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, searchMode: 'semantic', searchKw: '知行合一', bookId: 'b1' });
    RT.semantic.kw = '知行合一';
    RT.semantic.ran = true;
    RT.semantic.problem = '还没有可检索的画像：先打开一本，在侧栏 AI 页签里建一次';
    const html = searchResultsHtml('知行合一', 'all', 'shelf');
    expect(html).toContain('还没有可检索的画像');
  });

  /* 2026-11-16：搜不了的时候要给一条出口。同一个词换字面搜索是现成能力，
     没建画像 / 服务挂了 / 没激活都该一键换条路，而不是卡在一句原因上。 */
  it('搜不了时给「字面搜索」按钮，点了走同一个词', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, searchMode: 'semantic', searchKw: '知行合一', bookId: 'b1' });
    RT.semantic.kw = '知行合一';
    RT.semantic.ran = true;
    RT.semantic.problem = '嵌入服务没有响应，稍后再试';
    const html = searchResultsHtml('知行合一', 'all', 'shelf');
    expect(html).toContain('data-act="searchmode"');
    expect(html).toContain('data-v="literal"');
  });

  it('按意思搜 0 条时也给这条出口（空结果不是死路）', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, searchMode: 'semantic', searchKw: '知行合一', bookId: 'b1' });
    RT.semantic.kw = '知行合一';
    RT.semantic.ran = true;
    RT.semantic.books = 3;
    RT.semantic.hits = [];
    const html = searchResultsHtml('知行合一', 'all', 'shelf');
    expect(html).toContain('data-v="literal"');
  });

  it('命中按书分组，行上带 data-act / 书号 / 下标', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, searchMode: 'semantic', searchKw: '知行合一', bookId: 'b1' });
    RT.semantic.kw = '知行合一';
    RT.semantic.ran = true;
    RT.semantic.books = 2;
    RT.semantic.hits = [
      { bookId: 'b2', title: '血与蜜之地', chapter: '第三章', chunk: '知行合一在书里的这一段', score: 0.9 },
      { bookId: 'b2', title: '血与蜜之地', chapter: '第四章', chunk: '另一段', score: 0.8 },
    ];
    const html = searchResultsHtml('知行合一', 'all', 'shelf');
    expect(html).toContain('血与蜜之地');
    expect(html).toContain('data-act="semhittotext"');
    expect(html).toContain('data-book="b2"');
    expect(html).toContain('data-idx="0"');
    expect(html).toContain('data-idx="1"');
    expect(html).toContain('第三章');
  });

  it('书内入口没有当前书时，明说先打开一本', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, searchMode: 'semantic', searchKw: '知行合一', bookId: null });
    RT.semantic.kw = '知行合一';
    RT.semantic.ran = true;
    const html = searchResultsHtml('知行合一', 'book', 'book');
    expect(html).toContain('先打开一本书');
  });

  it('书内命中的统计行说「N 段相近的段落」，不说「来自 N 本」', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, searchMode: 'semantic', searchKw: '知行合一', bookId: 'b1' });
    RT.semantic.kw = '知行合一';
    RT.semantic.scope = 'book';
    RT.semantic.bookId = 'b1';
    RT.semantic.ran = true;
    RT.semantic.books = 1;
    RT.semantic.hits = [
      { bookId: 'b1', title: '我的天才女友', chapter: '第一章', chunk: '一段', score: 0.9 },
    ];
    const html = searchResultsHtml('知行合一', 'book', 'book');
    expect(html).toContain('<b>1</b> 段相近的段落');
    expect(html).not.toContain('来自 1 本');
  });

  it('别处搜出来的结果不能挂到这个入口下面（全库结果不进书内浮层）', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, searchMode: 'semantic', searchKw: '知行合一', bookId: 'b1' });
    RT.semantic.kw = '知行合一';
    RT.semantic.scope = 'all';
    RT.semantic.ran = true;
    RT.semantic.hits = [
      { bookId: 'b2', title: '血与蜜之地', chapter: '第三章', chunk: '别的书里的命中', score: 0.9 },
    ];
    const html = searchResultsHtml('知行合一', 'book', 'book');
    expect(html).not.toContain('别的书里的命中');
    expect(html).toContain('回车开始');
  });

  it('书内入口换了书：上一本的命中不能跟到新书里', () => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, searchMode: 'semantic', searchKw: '知行合一', bookId: 'b1' });
    RT.semantic.kw = '知行合一';
    RT.semantic.scope = 'book';
    RT.semantic.bookId = 'b2';
    RT.semantic.ran = true;
    RT.semantic.hits = [
      { bookId: 'b2', title: '血与蜜之地', chapter: '第三章', chunk: '上一本书的命中', score: 0.9 },
    ];
    const html = searchResultsHtml('知行合一', 'book', 'book');
    expect(html).not.toContain('上一本书的命中');
    expect(html).toContain('回车开始');
  });
});

describe('输入期间不花检索费', () => {
  it('改词只清旧结果，把状态退回「回车开始」', () => {
    installSource();
    RT.semantic.kw = '旧词';
    RT.semantic.ran = true;
    RT.semantic.hits = [
      { bookId: 'b1', title: '我的天才女友', chapter: '第一章', chunk: '旧结果', score: 0.9 },
    ];
    noteSemanticInput('新词');
    expect(RT.semantic.kw).toBe('新词');
    expect(RT.semantic.ran).toBe(false);
    expect(RT.semantic.hits).toEqual([]);
  });
});
