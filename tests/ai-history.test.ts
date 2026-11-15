import { describe, expect, it } from 'vitest';
import type { AiSession } from '../src/data/ai-session';
import { sessionMarkdown, sessionsMarkdown } from '../src/data/ai-session';
import {
  dayBucket,
  exportTargets,
  filterSessions,
  fmtAgo,
  groupSessionsByBook,
  groupSessionsByDay,
  historyStats,
  historyConfirmLayer,
  viewHistory,
} from '../src/shell/render/history';

/* 固定「现在」：2026-11-16 15:00（本地时区）。所有边界都相对它算。 */
const NOW = new Date(2026, 10, 16, 15, 0, 0).getTime();
const at = (day: number, hour: number, minute = 0): number =>
  new Date(2026, 10, day, hour, minute, 0).getTime();

const TODAY = at(16, 14, 32);
const YESTERDAY = at(15, 22, 10);
const OLDER = at(14, 9, 0);

function sess(id: string, over: Partial<AiSession> = {}): AiSession {
  return {
    id,
    bookId: 'weicheng',
    bookTitle: '围城',
    author: '钱钟书',
    kind: 'explain',
    when: TODAY,
    quote: '结婚仿佛金漆的鸟笼',
    turns: [
      { me: true, text: '解释这一段' },
      { me: false, text: '这句话把婚姻比作一只金漆的鸟笼。' },
    ],
    ...over,
  };
}

const count = (html: string, cls: string): number => html.split(`class="${cls}`).length - 1;

describe('对话页 · 按书分组', () => {
  it('书顺序按最近一条对话，组内按时间倒序', () => {
    const list = [
      sess('a1', { bookId: 'a', bookTitle: '甲书', when: at(16, 10) }),
      sess('b1', { bookId: 'b', bookTitle: '乙书', when: at(16, 14) }),
      sess('a2', { bookId: 'a', bookTitle: '甲书', when: at(16, 12) }),
    ];
    const groups = groupSessionsByBook(list);
    expect(groups.map((g) => g.bookId)).toEqual(['b', 'a']);
    expect(groups[1].items.map((s) => s.id)).toEqual(['a2', 'a1']);
  });

  it('同书里「已归档」的条数单独数，给组头胶囊用', () => {
    const list = [
      sess('a1', { bookId: 'a', bookTitle: '甲书', archivedAt: 1 }),
      sess('a2', { bookId: 'a', bookTitle: '甲书' }),
      sess('a3', { bookId: 'a', bookTitle: '甲书', archivedAt: 2 }),
    ];
    const [g] = groupSessionsByBook(list);
    expect(g.items.length).toBe(3);
    expect(g.items.filter((s) => s.archivedAt).length).toBe(2);
  });

  it('组头带书名与作者，取书里最近一条的那份', () => {
    const [g] = groupSessionsByBook([sess('a1', { bookTitle: '围城', author: '钱钟书' })]);
    expect(g.bookTitle).toBe('围城');
    expect(g.author).toBe('钱钟书');
  });
});

describe('对话页 · 按时间分组', () => {
  it('今天 / 昨天 / 更早 的边界按本地日界', () => {
    expect(dayBucket(at(16, 0, 0), NOW)).toBe('today');
    expect(dayBucket(at(16, 23, 59), NOW)).toBe('today');
    expect(dayBucket(at(15, 0, 0), NOW)).toBe('yesterday');
    expect(dayBucket(at(15, 23, 59), NOW)).toBe('yesterday');
    expect(dayBucket(at(14, 23, 59), NOW)).toBe('older');
    expect(dayBucket(at(1, 12, 0), NOW)).toBe('older');
  });

  it('组序固定为 今天 → 昨天 → 更早，组内时间倒序', () => {
    const list = [
      sess('old', { when: OLDER }),
      sess('y1', { when: at(15, 9) }),
      sess('t1', { when: at(16, 9) }),
      sess('t2', { when: at(16, 14) }),
      sess('y2', { when: YESTERDAY }),
    ];
    const groups = groupSessionsByDay(list, NOW);
    expect(groups.map((g) => g.key)).toEqual(['today', 'yesterday', 'older']);
    expect(groups[0].items.map((s) => s.id)).toEqual(['t2', 't1']);
    expect(groups[1].items.map((s) => s.id)).toEqual(['y2', 'y1']);
    expect(groups[2].items.map((s) => s.id)).toEqual(['old']);
  });

  it('哪天没有对话就不出那一组', () => {
    const groups = groupSessionsByDay([sess('t', { when: TODAY })], NOW);
    expect(groups.map((g) => g.key)).toEqual(['today']);
  });
});

describe('对话页 · 筛选与搜索', () => {
  it('按类型筛：只留那一种', () => {
    const list = [
      sess('e', { kind: 'explain' }),
      sess('t', { kind: 'translate' }),
      sess('b', { kind: 'book' }),
    ];
    expect(filterSessions(list, 'translate', '').map((s) => s.id)).toEqual(['t']);
    expect(filterSessions(list, 'all', '').length).toBe(3);
  });

  it('搜索命中引文、问题、回答（三处都算）', () => {
    const list = [
      /* 这一条只有引文，turns 为空——免得工厂默认的「解释」把下面的断言搅乱 */
      sess('quote', { quote: '金漆的鸟笼', turns: [] }),
      sess('ask', {
        quote: '',
        turns: [
          { me: true, text: '金漆是什么意思' },
          { me: false, text: '镀金。' },
        ],
      }),
      sess('answer', {
        quote: '',
        turns: [
          { me: true, text: '解释这一段' },
          { me: false, text: '说的是镀金的笼子。' },
        ],
      }),
    ];
    expect(filterSessions(list, 'all', '金漆').map((s) => s.id)).toEqual(['quote', 'ask']);
    expect(filterSessions(list, 'all', '镀金').map((s) => s.id)).toEqual(['ask', 'answer']);
    expect(filterSessions(list, 'all', '解释').map((s) => s.id)).toEqual(['answer']);
  });

  it('搜索不分大小写，首尾空白不算', () => {
    const list = [sess('en', { quote: '', turns: [{ me: false, text: 'Marriage is a Gilded cage' }] })];
    expect(filterSessions(list, 'all', '  gilded ').length).toBe(1);
  });

  it('类型与搜索词叠加', () => {
    const list = [
      sess('e', { kind: 'explain', quote: '鸟笼' }),
      sess('t', { kind: 'translate', quote: '鸟笼' }),
    ];
    expect(filterSessions(list, 'explain', '鸟笼').map((s) => s.id)).toEqual(['e']);
    expect(filterSessions(list, 'explain', '不存在').length).toBe(0);
  });
});

describe('对话页 · 统计', () => {
  it('总数 / 书数 / 已归档数 / 归档比例', () => {
    const list = [
      sess('1', { archivedAt: 1 }),
      sess('2'),
      sess('3', { bookId: 'x', bookTitle: '人类简史' }),
    ];
    const st = historyStats(list, NOW);
    expect(st.total).toBe(3);
    expect(st.books).toBe(2);
    expect(st.archived).toBe(1);
    expect(st.ratio).toBe(33);
  });

  it('一条都没有时比例是 0，不除零', () => {
    const st = historyStats([], NOW);
    expect(st).toEqual({ total: 0, month: 0, books: 0, archived: 0, ratio: 0 });
  });

  it('「本月轮次」只数本自然月', () => {
    const list = [sess('now', { when: TODAY }), sess('last', { when: new Date(2026, 9, 20).getTime() })];
    const st = historyStats(list, NOW);
    expect(st.month).toBe(1);
    expect(st.total).toBe(2);
  });

  it('全部归档时比例 100', () => {
    const st = historyStats([sess('1', { archivedAt: 1 }), sess('2', { archivedAt: 2 })], NOW);
    expect(st.ratio).toBe(100);
  });
});

describe('对话页 · 导出块', () => {
  it('一轮对话 → Markdown：引文、问、答都映射', () => {
    const md = sessionMarkdown(
      sess('s1', {
        quote: '结婚仿佛金漆的鸟笼',
        turns: [
          { me: true, text: '解释这一段' },
          { me: false, text: '这句话把婚姻比作鸟笼。' },
        ],
      }),
    );
    expect(md).toContain('> 结婚仿佛金漆的鸟笼');
    expect(md).toContain('**你**：解释这一段');
    expect(md).toContain('**AI**：这句话把婚姻比作鸟笼。');
    /* 标题带类型与时间，回看时知道这一块是什么 */
    expect(md).toContain('解释');
    expect(md).toContain('2026-11-16 14:32');
  });

  it('多轮保持原顺序', () => {
    const md = sessionMarkdown(
      sess('s1', {
        turns: [
          { me: true, text: '第一问' },
          { me: false, text: '第一答' },
          { me: true, text: '第二问' },
          { me: false, text: '第二答' },
        ],
      }),
    );
    const order = ['第一问', '第一答', '第二问', '第二答'].map((x) => md.indexOf(x));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('没有引文的对话不写空引用块', () => {
    const md = sessionMarkdown(sess('s1', { quote: '' }));
    expect(md).not.toContain('>');
    expect(md).toContain('**你**：解释这一段');
  });

  it('空对话不写一个字', () => {
    expect(sessionMarkdown(sess('s1', { turns: [] }))).toBe('');
    expect(sessionsMarkdown([sess('s1', { turns: [] }), sess('s2', { turns: [] })])).toBe('');
  });

  it('按书汇总：一本书一个目标，路径带书名与条数', () => {
    const list = [
      sess('1', { bookId: 'a', bookTitle: '围城' }),
      sess('2', { bookId: 'a', bookTitle: '围城' }),
      sess('3', { bookId: 'b', bookTitle: '人类简史' }),
    ];
    const targets = exportTargets(list);
    expect(targets.map((x) => x.path)).toEqual(['bz-reader/notes/围城.md', 'bz-reader/notes/人类简史.md']);
    expect(targets.map((x) => x.count)).toEqual([2, 1]);
  });
});

describe('对话页 · 排法切换', () => {
  const list = [
    sess('e1', { kind: 'explain', quote: '鸟笼', when: TODAY }),
    sess('e2', { kind: 'explain', quote: '鸟笼', when: YESTERDAY }),
    sess('t1', { kind: 'translate', quote: '鸟笼', when: TODAY }),
  ];

  it('两种排法吃的是同一份筛选结果', () => {
    const filtered = filterSessions(list, 'explain', '鸟笼');
    const byBook = groupSessionsByBook(filtered).flatMap((g) => g.items);
    const byTime = groupSessionsByDay(filtered, NOW).flatMap((g) => g.items);
    expect(byBook.map((s) => s.id).sort()).toEqual(['e1', 'e2']);
    expect(byTime.map((s) => s.id).sort()).toEqual(['e1', 'e2']);
  });

  it('切排法不改筛选：两种排法渲出的卡片数一样', () => {
    const base = { sessions: list, kind: 'all' as const, kw: '鸟笼', open: [], now: NOW };
    const a = viewHistory({ ...base, group: 'book' });
    const b = viewHistory({ ...base, group: 'time' });
    expect(count(a, 'bzs-dcard')).toBe(3);
    expect(count(b, 'bzs-dcard')).toBe(3);
  });
});

describe('对话页 · 视图结构', () => {
  const list = [
    sess('a1', { bookId: 'a', bookTitle: '围城', author: '钱钟书', archivedAt: 1 }),
    sess('a2', { bookId: 'a', bookTitle: '围城', author: '钱钟书', kind: 'translate', when: YESTERDAY }),
    sess('b1', { bookId: 'b', bookTitle: '人类简史', author: '尤瓦尔·赫拉利', kind: 'book', quote: '', when: OLDER }),
  ];
  const base = { sessions: list, kind: 'all' as const, kw: '', open: [], now: NOW };

  it('头部：标题、副标题、导出全部', () => {
    const h = viewHistory({ ...base, group: 'book' });
    expect(h).toContain('bzs-aihero');
    expect(h).toContain('<h2>对话</h2>');
    expect(h).toContain('3 轮');
    expect(h).toContain('2 本书');
    expect(h).toContain('data-act="aiexportall"');
  });

  it('统计带：三个数字、归档比例与进度条', () => {
    const h = viewHistory({ ...base, group: 'book' });
    expect(h).toContain('本月轮次');
    expect(h).toContain('覆盖书目');
    expect(h).toContain('已归档');
    expect(h).toContain('归档比例 33%');
    expect(h).toContain('width:33%');
  });

  it('工具行：搜索框、六个类型、两种排法', () => {
    const h = viewHistory({ ...base, group: 'book' });
    expect(h).toContain('data-role="aikw"');
    expect(h.match(/data-act="aifilter"/g)?.length).toBe(6);
    expect(h).toContain('data-act="aigroup" data-v="book"');
    expect(h).toContain('data-act="aigroup" data-v="time"');
  });

  it('按书：书脊、书名、作者、轮次胶囊、导出本书', () => {
    const h = viewHistory({ ...base, group: 'book' });
    expect(h).toContain('bzs-aispine');
    expect(h).toContain('钱钟书');
    expect(h).toContain('2 轮 · 1 已归档');
    expect(h).toContain('data-act="aiexportbook"');
  });

  it('按时间：今天 / 昨天 / 更早 三块组头', () => {
    const h = viewHistory({ ...base, group: 'time' });
    expect(h).toContain('bzs-athead');
    expect(h).toContain('今天');
    expect(h).toContain('昨天');
    expect(h).toContain('更早');
  });

  it('卡片：类型色条变量、引文、你、回答、三个底部动作', () => {
    const h = viewHistory({ ...base, group: 'book' });
    const card = h.slice(h.indexOf('data-id="a1"') - 200, h.indexOf('data-id="a1"') + 1600);
    expect(card).toContain('--k:');
    expect(card).toContain('bzs-dquote');
    expect(card).toContain('bzs-qmark');
    expect(card).toContain('data-act="aiexpand" data-id="a1"');
    expect(card).toContain('data-act="aidelete" data-id="a1"');
    expect(card).toContain('已归档');
    expect(card).not.toContain('data-act="aiarchive" data-id="a1"');
  });

  it('未归档的卡才有「归档」，已归档的只有右侧绿字', () => {
    const h = viewHistory({ ...base, group: 'book' });
    expect(h).toContain('data-act="aiarchive" data-id="a2"');
  });

  it('展开的卡带完整对话块，未展开的没有', () => {
    const done = viewHistory({ ...base, group: 'book', open: ['a1'] });
    expect(done).toContain('bzs-aconv');
    expect((done.match(/class="bzs-aconv"/g) ?? []).length).toBe(1);
    const notDone = viewHistory({ ...base, group: 'book' });
    expect(notDone).not.toContain('bzs-aconv');
  });

  it('一条都没有：空态 + 清掉搜索', () => {
    const h = viewHistory({ sessions: [], kind: 'all', kw: '', open: [], now: NOW, group: 'book' });
    expect(h).toContain('bzs-aiempty');
    expect(h).toContain('data-act="aiclearkw"');
    expect(count(h, 'bzs-dcard')).toBe(0);
  });

  it('排法切到时间时空态仍给出口（不画一片空白）', () => {
    const h = viewHistory({ sessions: [], kind: 'all', kw: 'zzz', open: [], now: NOW, group: 'time' });
    expect(h).toContain('bzs-aiempty');
  });

  it('导出确认层列出路径与条数，带取消 / 导出', () => {
    const h = historyConfirmLayer('导出全部到阅读笔记', ['a1', 'a2', 'b1'], list);
    expect(h).toContain('bzs-aiconfirm');
    expect(h).toContain('bzs-aibox');
    expect(h).toContain('bz-reader/notes/围城.md');
    expect(h).toContain('bz-reader/notes/人类简史.md');
    expect(h).toContain('2 轮');
    expect(h).toContain('data-act="aicancel"');
    expect(h).toContain('data-act="aiexportok"');
  });

  it('没有选中任何会话时确认层是空的', () => {
    expect(historyConfirmLayer('导出全部到阅读笔记', [], list)).toBe('');
  });

  it('副标题的「最近」按最后一条算', () => {
    expect(fmtAgo(NOW - 8 * 60_000, NOW)).toBe('8 分钟前');
    expect(fmtAgo(NOW - 3 * 3600_000, NOW)).toBe('3 小时前');
    expect(fmtAgo(YESTERDAY, NOW)).toBe('昨天');
  });
});
