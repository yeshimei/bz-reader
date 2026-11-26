import { afterEach, describe, expect, it } from 'vitest';
import { PLAN_GROUPS, PLAN_TABLE, capLabel } from '../src/data/entitlement';
import { LOCALES, setLocale } from '../src/i18n';
import { PLAN_TEXT_PACK, planGroupNameZh } from '../src/i18n/plan';

/**
 * 对照表 · AI 段（2026-11-16 定稿五行；2026-11-22 追问拆出，六行；
 * 2026-11-26 补书目信息下放基础版，七行）。
 *
 * 2026-11-22 作者定稿：解释 / 翻译 / 摘要下放基础版，追问留在高级版并
 * 单独占一行。理由一句话——「让 AI 解释一下」是一问一答，「在答案底下
 * 接着问那几句」要多轮、要带上下文，是另一件事。共用一个勾，用户看不出
 * 买了能多出哪一下；被拦时也亮不到正确的那一行。
 *
 * 2026-11-26：补书目信息按作者口径也是基础版，只补简介与分类。
 *
 *   · AI 解释、翻译、摘要 —— 划词那一颗（aiSel，免费）
 *   · AI 追问 —— 就这段接着问（aiAsk，新能力位）
 *   · AI 全书问答 —— 四种依据都塞得进去（ai）
 *   · AI 对话留档并导出至笔记 —— 与伴读分开（aiLog）
 *   · AI 伴读 —— 按章导读（aiChat）
 *   · AI 补书目信息 —— 简介与分类自动填（aiMeta，免费）
 *   · AI 知识库 —— 增量阅读的闭环（kb）
 */

const CJK = /[\u4e00-\u9fff]/;
const LATIN = ['en', 'de', 'fr', 'es', 'pt'] as const;

/** 七行，顺序即定稿 */
const ROWS = ['aiSel', 'aiFollow', 'aiBook', 'aiLog', 'aiChat', 'aiMeta', 'kb'] as const;

/** 中文基准行名，与作者定稿一字不差（标点统一成顿号） */
const NAMES: Record<(typeof ROWS)[number], string> = {
  aiSel: 'AI 解释、翻译、摘要：即划即用',
  aiFollow: 'AI 追问：就这段接着问',
  aiBook: 'AI 全书问答：划线、正文、截图与笔记四种依据都可添加进去',
  aiLog: 'AI 对话留档并导出至笔记',
  aiChat: 'AI 伴读：边读边问，按章导读',
  aiMeta: 'AI 补书目信息：简介、分类自动填',
  kb: 'AI 知识库：增量阅读、知识输入、整理与输出的闭环',
};

function row(key: string) {
  return PLAN_TABLE.find((r) => r.key === key);
}

afterEach(() => setLocale('zh'));

describe('对照表 · AI 段六行', () => {
  it('段内七行，顺序与全表一致', () => {
    const g = PLAN_GROUPS.find((x) => x.key === 'ai');
    expect(g?.rows).toEqual([...ROWS]);
    expect(planGroupNameZh('ai')).toBe('AI');

    /* 段与表必须同序：组里按定稿顺序，表里也是 */
    const at = PLAN_TABLE.findIndex((r) => r.key === 'aiSel');
    expect(PLAN_TABLE.slice(at, at + ROWS.length).map((r) => r.key)).toEqual([...ROWS]);
    /* 段前一行是数据段的末行，段后一行是朗读段的段首 */
    expect(PLAN_TABLE[at - 1]?.key).toBe('backup');
    expect(PLAN_TABLE[at + ROWS.length]?.key).toBe('tts');
  });

  it('解释摘要与补书目免费；追问起五行都是高级版', () => {
    for (const k of ['aiSel', 'aiMeta']) {
      expect(row(k)?.free, k).toBe('yes');
      expect(row(k)?.pro, k).toBe('yes');
    }
    for (const k of ['aiFollow', 'aiBook', 'aiLog', 'aiChat', 'kb']) {
      expect(row(k)?.free, k).toBe('no');
      expect(row(k)?.pro, k).toBe('yes');
    }
  });

  it('行名与作者定稿一字不差', () => {
    for (const k of ROWS) expect(row(k)?.name, k).toBe(NAMES[k]);
  });

  it('被拦时点亮的就是刚点的那一行：划词那行免费，其余各挂自己的位', () => {
    expect(ROWS.map((k) => row(k)?.cap)).toEqual([undefined, 'aiAsk', 'ai', 'aiLog', 'aiChat', undefined, 'kb']);
    /* 能力位不许两行共用：共用就成了「点 A 亮 B」 */
    const caps = ['aiAsk', 'ai', 'aiLog', 'aiChat', 'kb'];
    expect(new Set(caps).size).toBe(caps.length);
  });

  it('追问是新能力位，卖点说的是「就这段接着问」', () => {
    expect(row('aiFollow')?.cap).toBe('aiAsk');
    const text = capLabel('aiAsk');
    expect(text).toMatch(/问/);
    expect(text).toMatch(/这段|这一段/);
  });

  it('对话留档是新能力位，卖点说的是留档与导出', () => {
    expect(row('aiLog')?.cap).toBe('aiLog');
    const text = capLabel('aiLog');
    /* 两件事都得说到：留着（关掉能接着问）+ 导进笔记 */
    expect(text).toMatch(/留|存|记/);
    expect(text).toContain('笔记');
  });

  it('八种语言都填了，拉丁语系没有汉字', () => {
    for (const l of LOCALES) {
      for (const k of ROWS) {
        expect(String(PLAN_TEXT_PACK[k][l]).trim().length, `${l} ${k}`).toBeGreaterThan(0);
      }
    }
    for (const l of LATIN) {
      for (const k of ROWS) {
        expect(CJK.test(PLAN_TEXT_PACK[k][l]), `${l} ${k}：${PLAN_TEXT_PACK[k][l]}`).toBe(false);
      }
    }
  });

  it('切到英文，六行跟着换；切回中文恢复', () => {
    setLocale('en');
    expect(PLAN_TEXT_PACK.aiLog.en.length).toBeGreaterThan(0);
    expect(CJK.test(PLAN_TEXT_PACK.aiBook.en)).toBe(false);
    setLocale('zh');
    expect(row('aiSel')?.name).toBe(NAMES.aiSel);
  });
});
