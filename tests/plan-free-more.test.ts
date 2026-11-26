import { describe, expect, it } from 'vitest';
import { PLAN_GROUPS, PLAN_TABLE, planTotals } from '../src/data/entitlement';

/**
 * 对照表 · 2026-11-22 作者定稿的又一轮「谁收费」。
 *
 * 四件事下放基础版：导出整本摘录、并排对照、剪藏成书、AI 的解释 / 翻译 /
 * 摘要。追问留在高级版，并且单独占一行——它以前挤在「AI 解释、翻译、
 * 摘要与追问」那一行里，四件事共用一个勾，用户看不出买了能多出哪一下。
 *
 * 下放的不许再挂能力位：行还挂着 cap，弹层就会把用户往一个已经免费的功能
 * 上引；反过来，追问必须有自己的一行与能力位，被拦时才能亮对地方。
 */

function row(key: string) {
  return PLAN_TABLE.find((r) => r.key === key);
}

describe('对照表 · 四行下放基础版', () => {
  /** key → 中文基准行名（与作者定稿一字不差） */
  const FREED: ReadonlyArray<readonly [string, string]> = [
    ['export', '导出整本摘录：每条带双链'],
    ['parallel', '并排对照：与另一本书同步段落'],
    ['clipEpub', '剪藏成书：剪藏本合成一本 EPUB'],
    ['aiSel', 'AI 解释、翻译、摘要：即划即用'],
  ];

  it('两栏都打勾，行名同步改过', () => {
    for (const [key, name] of FREED) {
      const r = row(key);
      expect(r, key).toBeTruthy();
      expect(r?.free, key).toBe('yes');
      expect(r?.pro, key).toBe('yes');
      expect(r?.name, key).toBe(name);
    }
  });

  it('不再挂能力位：免费的行不该再把人引到解锁弹层', () => {
    for (const [key] of FREED) expect(row(key)?.cap, key).toBeUndefined();
  });

  it('三个旧能力位从表里彻底消失', () => {
    /* 只看表，不看 Cap 类型：类型在编译期就拦住了，这条守的是运行时数据 */
    const caps = PLAN_TABLE.map((r) => r.cap).filter((c): c is string => typeof c === 'string');
    for (const gone of ['export', 'parallel', 'clipBook', 'aiSel']) {
      expect(caps, gone).not.toContain(gone);
    }
  });
});

describe('对照表 · 追问单独成行', () => {
  it('基础版打叉、高级版打勾，挂自己的 aiAsk', () => {
    const r = row('aiFollow');
    expect(r).toBeTruthy();
    expect(r?.name).toBe('AI 追问：就这段接着问');
    expect(r?.free).toBe('no');
    expect(r?.pro).toBe('yes');
    expect(r?.cap).toBe('aiAsk');
  });

  it('紧跟「AI 解释、翻译、摘要」下面，AI 段七行', () => {
    const ai = PLAN_GROUPS.find((g) => g.key === 'ai');
    expect(ai?.rows).toEqual(['aiSel', 'aiFollow', 'aiBook', 'aiLog', 'aiChat', 'aiMeta', 'kb']);
    const at = PLAN_TABLE.findIndex((r) => r.key === 'aiFollow');
    expect(at).toBeGreaterThan(0);
    expect(PLAN_TABLE[at - 1]?.key).toBe('aiSel');
    expect(PLAN_TABLE[at + 1]?.key).toBe('aiBook');
  });

  it('追问与其它 AI 行不共用能力位：共用就是「点 A 亮 B」', () => {
    const caps = PLAN_TABLE.filter((r) => r.key.startsWith('ai')).map((r) => r.cap);
    const real = caps.filter((c): c is string => typeof c === 'string');
    expect(new Set(real).size).toBe(real.length);
  });
});

describe('对照表 · 合计与行数', () => {
  it('基础版 34 项、高级版 69 项，全表 73 行', () => {
    expect(planTotals()).toEqual({ free: 34, pro: 69 });
    expect(PLAN_TABLE.length).toBe(73);
  });
});
