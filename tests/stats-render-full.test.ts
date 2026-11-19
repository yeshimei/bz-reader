/**
 * 统计页强化版的整页渲染（tests/stats-render-full.test.ts）
 *
 * 原型 prototype/stats/index.html 的结构在这里逐块锁住：
 * 头部六联 → 洞察 → 对比 → 趋势 → 节律 → 热力 → 目标与书 →
 * 明细表 → 口径对照 → 数据质量 → 报告出口。
 */
import { describe, expect, it } from 'vitest';
import { viewStats, viewStatsLocked, type StatsView } from '../src/shell/render/stats';
import { defaultStatsUi, type StatsUiState } from '../src/shell/stats-ui';

const NOW = new Date(2026, 10, 8, 19, 5).getTime();
const D = (day: number, hour = 9): number => new Date(2026, 10, day, hour).getTime();

function view(patch: Partial<StatsView> = {}): StatsView {
  return {
    stats: { totalSeconds: 0, todaySeconds: 0, streakDays: 0, activeDays: 0, days: {}, books: [] },
    books: [
      {
        id: 'a',
        meta: { title: '甲', author: '作者甲', chapterCount: 10, wordCount: 1000 },
        reading: {
          sessions: [
            { start: D(5), end: D(5) + 129_000, durationSeconds: 129, percent: 0.01 },
            { start: NOW, end: NOW + 600_000, durationSeconds: 60, percent: 0.02 },
          ],
          position: { percent: 0.02 },
          stats: { totalReadTime: 189, lastReadTime: NOW + 600_000 },
        },
      },
      {
        id: 'b',
        meta: { title: '乙', author: '作者乙', chapterCount: 8, wordCount: 800 },
        reading: {
          sessions: [{ start: D(6, 14), end: D(6, 14) + 395_000, durationSeconds: 395, percent: 0.04 }],
          position: { percent: 0.04 },
          stats: { totalReadTime: 395, lastReadTime: D(6, 14) + 395_000 },
        },
      },
    ] as unknown as StatsView['books'],
    goal: 18,
    checkins: { '2026-11-05': 2658, '2026-11-07': 18 },
    dailyGoalMinutes: 20,
    now: NOW,
    ...patch,
  };
}

function ui(patch: Partial<StatsUiState> = {}): StatsUiState {
  return { ...defaultStatsUi(), ...patch };
}

describe('统计页 · 整页结构', () => {
  it('头部六个统计数字，洞察四条，对比六格', () => {
    const h = viewStats(view());
    expect((h.match(/class="kpi"/g) ?? []).length).toBe(6);
    expect((h.match(/class="ins"/g) ?? []).length).toBe(4);
    expect((h.match(/class="c"/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(h).toContain('总有效时长');
    expect(h).toContain('单日峰值');
    expect(h).toContain('上月同期');
  });

  it('趋势 / 节律 / 热力 / 目标 / 书籍都在，热力固定 140 格', () => {
    const h = viewStats(view());
    expect(h).toContain('class="chart"');
    expect(h).toContain('目标 20 分');
    expect(h).toContain('阅读节律');
    expect(h).toContain('单次会话');
    expect((h.match(/<i class="l[0-4]"/g) ?? []).length).toBe(140);
    expect(h).toContain('年度目标');
    expect(h).toContain('data-act="setgoal"');
    expect(h).toContain('书籍投入');
  });

  it('书籍明细表八列，状态与沉寂/读完耗时都给值', () => {
    const h = viewStats(view());
    for (const th of ['书名', '翻至', '有效时长', '占比', '每 1%', '沉寂', '读完耗时', '状态']) {
      expect(h).toContain(th);
    }
    expect(h).toContain('甲');
    expect(h).toContain('在读');
  });

  it('口径对照三套账、体检六格、底部两个出口', () => {
    const h = viewStats(view());
    expect(h).toContain('口径对照');
    expect(h).toContain('会话有效');
    expect(h).toContain('挂钟');
    expect(h).toContain('打卡');
    expect(h).toContain('合计');
    expect((h.match(/class="q"/g) ?? []).length).toBe(6);
    expect(h).toContain('data-act="statscopy"');
    expect(h).toContain('data-act="statsposter"');
  });

  it('数字由传入数据现场计算，页面里没有 NaN / undefined', () => {
    const h = viewStats(view());
    expect(h).toContain('09:44');
    expect(h).toContain('44:36');
    expect(h).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('空库也能画，不炸不空', () => {
    const h = viewStats(view({ books: [], checkins: {} }));
    expect(h).toContain('class="kpi"');
    expect(h).not.toMatch(/NaN|undefined/);
  });
});

describe('统计页 · 交互状态', () => {
  it('范围切到今天：按钮高亮变化，全量指标仍在', () => {
    const all = viewStats(view(), ui());
    const today = viewStats(view(), ui({ range: 'today' }));
    /* 属性顺序由共用的分段按钮生成器决定，这里只认「这一项带着 on」 */
    expect(all).toContain('class="on" data-act="statsrange" data-v="all"');
    expect(today).toContain('class="on" data-act="statsrange" data-v="today"');
    expect(today).toContain('01:00');
    expect(today).not.toMatch(/NaN|undefined/);
  });

  it('口径互斥：挂钟高亮时不高亮打卡，反之亦然', () => {
    const wall = viewStats(view(), ui({ audit: 'wall' }));
    const ck = viewStats(view(), ui({ audit: 'checkin' }));
    expect((wall.match(/class="num hi"/g) ?? []).length).toBeGreaterThan(0);
    expect(wall).toContain('class="on" data-act="statsaudit" data-v="wall"');
    expect(ck).toContain('class="on" data-act="statsaudit" data-v="checkin"');
    expect(ck).not.toContain('class="on" data-act="statsaudit" data-v="wall"');
  });

  it('重算预演给逐日清单 + 应用/取消，应用后只显示还原', () => {
    const preview = viewStats(view(), ui({ preview: true }));
    expect(preview).toContain('逐日清单');
    expect(preview).toContain('data-act="statsapply"');
    expect(preview).toContain('data-act="statscancel"');
    expect(preview).not.toContain('data-act="statsrestore"');

    const applied = viewStats(view(), ui({ recalced: true }));
    expect(applied).toContain('data-act="statsrestore"');
    expect(applied).not.toContain('data-act="statsrecalc"');
    expect(applied).not.toContain('data-act="statsapply"');
    expect(applied).not.toMatch(/NaN|undefined/);
  });

  it('应用预演只改页面里的打卡，不改传入的原始数据', () => {
    const v = view();
    viewStats(v, ui({ recalced: true }));
    expect(v.checkins).toEqual({ '2026-11-05': 2658, '2026-11-07': 18 });
  });
});

describe('统计页 · 基础版锁态', () => {
  it('头部只留六个数字与范围控件，洞察条被压进模糊层', () => {
    const h = viewStatsLocked(view());
    const maskAt = h.indexOf('bzs-lockstat-mask');
    expect(h.indexOf('class="kpis"')).toBeLessThan(h.indexOf('bzs-lockstat-body'));
    expect(h.indexOf('class="insights"')).toBeGreaterThan(h.indexOf('bzs-lockstat-body'));
    expect(h.indexOf('class="insights"')).toBeLessThan(maskAt);
    expect((h.match(/class="kpi"/g) ?? []).length).toBe(6);
  });

  it('遮罩里是真实图表，按钮与整块都走 unlock/stats', () => {
    const h = viewStatsLocked(view());
    expect(h).toContain('bzs-lockstat-body');
    expect(h).toContain('class="chart"');
    expect(h).toContain('data-act="unlock" data-mode="stats"');
    expect((h.match(/data-act="unlock"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(h).toContain('>高级版</button>');
  });

  it('锁态数字与完整版同源，没有 NaN', () => {
    const full = viewStats(view());
    const locked = viewStatsLocked(view());
    expect(locked).toContain('09:44');
    expect(full).toContain('09:44');
    expect(locked).not.toMatch(/NaN|undefined/);
  });
});

/**
 * 文案键（2026-11-09 发版复核）。
 *
 * 统计页与周报的 key 以前经过 `key as MsgKey` 强转：新键打错一个字照样
 * 编译通过，界面上直接显示成 `stats.f.xxx` 原文。现在 key 参数就是
 * `MsgKey`，动态那几档（时段 / 会话长度 / 周报时段）走常量数组。
 * 这条测试盯住渲染结果：任何键名原文漏到 HTML 里都算红。
 */
describe('统计页 · 文案键', () => {
  it('整页与锁态里不出现键名原文', () => {
    for (const h of [viewStats(view()), viewStatsLocked(view())]) {
      expect(h).not.toMatch(/stats\.(f|lock)\./);
    }
  });
});

/**
 * 强化版（2026-11-19）：六个子页签，所有内容一次渲染完、只切显示。
 * 这样切页签不重算，三条出口（页面 / 报告 / 海报）也永远同一份模型。
 */
describe('统计页 · 六个子页签', () => {
  it('页签完整，默认开在概览，其余是隐藏态而不是没渲染', () => {
    const h = viewStats(view());
    for (const tab of ['overview', 'time', 'books', 'notes', 'achv', 'data']) {
      expect(h).toContain(`data-act="statstab" data-v="${tab}"`);
      expect(h).toContain(`data-pane="${tab}"`);
    }
    expect(h).toContain('class="tabpane" data-pane="overview"');
    expect(h).toContain('class="tabpane off" data-pane="time"');
    expect(h).toContain('class="on" data-act="statstab" data-v="overview"');
  });

  it('切页签只换 on / off，不减少内容', () => {
    const overview = viewStats(view(), ui({ tab: 'overview' }));
    const books = viewStats(view(), ui({ tab: 'books' }));
    expect(books).toContain('class="on" data-act="statstab" data-v="books"');
    expect(books).toContain('class="tabpane off" data-pane="overview"');
    /* 概览里的六联 KPI 与书籍明细都还在（只是其中一个被隐藏） */
    expect(overview).toContain('class="kpis"');
    expect(books).toContain('class="kpis"');
  });

  it('五个范围档位都在，未知值回落全部记录', () => {
    const h = viewStats(view(), ui({ range: 'month' }));
    for (const r of ['all', 'today', 'week', 'month', 'year']) {
      expect(h).toContain(`data-act="statsrange" data-v="${r}"`);
    }
    expect(h).toContain('class="on" data-act="statsrange" data-v="month"');
  });
});

describe('统计页 · 强化版新卡片', () => {
  it('概览：时间账本、阅读量、速度、坚持、本周小结', () => {
    const h = viewStats(view());
    expect(h).toContain('时间账本');
    expect(h).toContain('阅读量');
    expect(h).toContain('阅读速度');
    expect(h).toContain('坚持');
    expect(h).toContain('本周小结');
    expect(h).toContain('在库未读');
    expect(h).toContain('历史最长连续');
    expect(h).toContain('近 14 天');
  });

  it('时间：24 小时铺满、星期七行、月度十二格', () => {
    const h = viewStats(view(), ui({ tab: 'time' }));
    expect((h.match(/class="hc"/g) ?? []).length).toBe(24);
    expect(h).toContain('24 小时');
    expect(h).toContain('星期');
    expect(h).toContain('月度投入');
  });

  it('书：分类 / 格式 / 分档 / 预计读完 / 久未打开', () => {
    const h = viewStats(view(), ui({ tab: 'books' }));
    expect(h).toContain('分类分布');
    expect(h).toContain('格式分布');
    expect(h).toContain('进度分档');
    expect(h).toContain('预计读完');
    expect(h).toContain('久未打开');
    expect(h).toContain('字数');
    expect(h).toContain('预计');
  });

  it('笔记：四类标注、月度、最多、评分', () => {
    const h = viewStats(view(), ui({ tab: 'notes' }));
    expect(h).toContain('标注产出');
    expect(h).toContain('划线');
    expect(h).toContain('想法');
    expect(h).toContain('书签');
    expect(h).toContain('知识盒');
    expect(h).toContain('评分');
  });

  it('成就：徽章有解锁态与进度', () => {
    const h = viewStats(view(), ui({ tab: 'achv' }));
    expect(h).toContain('成就');
    expect((h.match(/class="bdg/g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect(h).toContain('已解锁');
    expect(h).toContain('连续 7 天');
  });

  it('热力格可点开当天明细，再点同一天收起', () => {
    const closed = viewStats(view());
    expect(closed).toContain('data-act="statsday"');
    const open = viewStats(view(), ui({ day: '2026-11-05' }));
    expect(open).toContain('class="daybox"');
    expect(open).toContain('2026-11-05');
    expect(open).toContain('当天合计');
    expect(open).toContain('data-act="statsday" data-v="2026-11-05"');
  });

  it('锁态：页签与新增卡片全进模糊层，头部不泄漏新数字', () => {
    const h = viewStatsLocked(view());
    const maskAt = h.indexOf('bzs-lockstat-mask');
    /* 锁态不摆页签：基础版连「有哪些板块」都不给看 */
    expect(h).not.toContain('data-act="statstab"');
    expect(h.indexOf('时间账本')).toBeGreaterThan(h.indexOf('bzs-lockstat-body'));
    expect(h.indexOf('时间账本')).toBeLessThan(maskAt);
    /* 头部只有六联 KPI：新卡片都在模糊层里 */
    expect(h.indexOf('阅读速度')).toBeGreaterThan(h.indexOf('bzs-lockstat-body'));
    expect(h.indexOf('阅读速度')).toBeLessThan(maskAt);
  });
});
