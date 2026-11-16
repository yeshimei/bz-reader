import { afterEach, describe, expect, it } from 'vitest';
import { PLAN_GROUPS, PLAN_TABLE, capLabel, type Cap } from '../src/data/entitlement';
import { LOCALES, setLocale } from '../src/i18n';
import { PLAN_TEXT_PACK, planGroupNameZh } from '../src/i18n/plan';

/**
 * 对照表 · AI 段（2026-11-16 作者定稿）。
 *
 * 这一轮 AI 做了一大批增强（划词五项菜单与悬停展开、锚定追问浮框、
 * 划词会话留痕、侧栏问答历史与等待态、依据按章跳转、连接笔记浮层、
 * 书架对话页），但表里原来只有四行，增强全被埋在旧行名下面，
 * 用户看不出「贵在哪儿」。定稿把它拆成五行，一行只说一件事：
 *
 *   · AI 解释、翻译、摘要与追问 —— 划词那一颗（aiSel）
 *   · AI 全书问答 —— 四种依据都塞得进去（ai）
 *   · AI 对话留档并导出至笔记 —— 与伴读分开（aiLog，新能力位）
 *   · AI 伴读 —— 按章导读（aiChat）
 *   · AI 知识库 —— 增量阅读的闭环（kb）
 *
 * 「对话留档」为什么要自己的能力位：它和伴读走同一个侧栏，但两行分开
 * 写了，就得让被拦时点亮的是用户刚点的那一行——共用 aiChat 的话，
 * 点「导出到笔记」会亮到「AI 伴读」上，又是 2026-11-12 引用页签那个老毛病。
 */

const CJK = /[\u4e00-\u9fff]/;
const LATIN = ['en', 'de', 'fr', 'es', 'pt'] as const;

/** 五行，顺序即定稿 */
const ROWS = ['aiSel', 'aiBook', 'aiLog', 'aiChat', 'kb'] as const;

/** 中文基准行名，与作者定稿一字不差（标点统一成顿号） */
const NAMES: Record<(typeof ROWS)[number], string> = {
  aiSel: 'AI 解释、翻译、摘要与追问：即划即用',
  aiBook: 'AI 全书问答：划线、正文、截图与笔记四种依据都可添加进去',
  aiLog: 'AI 对话留档并导出至笔记',
  aiChat: 'AI 伴读：边读边问，按章导读',
  kb: 'AI 知识库：增量阅读、知识输入、整理与输出的闭环',
};

function row(key: string) {
  return PLAN_TABLE.find((r) => r.key === key);
}

afterEach(() => setLocale('zh'));

describe('对照表 · AI 段五行', () => {
  it('段内五行，顺序与全表一致', () => {
    const g = PLAN_GROUPS.find((x) => x.key === 'ai');
    expect(g?.rows).toEqual([...ROWS]);
    expect(planGroupNameZh('ai')).toBe('AI');

    /* 段与表必须同序：组里按定稿顺序，表里也是 */
    const at = PLAN_TABLE.findIndex((r) => r.key === 'aiSel');
    expect(PLAN_TABLE.slice(at, at + ROWS.length).map((r) => r.key)).toEqual([...ROWS]);
    /* 段前一行是数据与搜索的末行，段后一行是朗读段的段首 */
    expect(PLAN_TABLE[at - 1]?.key).toBe('semantic');
    expect(PLAN_TABLE[at + ROWS.length]?.key).toBe('tts');
  });

  it('五行全是高级版：基础版打叉、高级版打勾', () => {
    for (const k of ROWS) {
      const r = row(k);
      expect(r, k).toBeTruthy();
      expect(r?.free, k).toBe('no');
      expect(r?.pro, k).toBe('yes');
    }
  });

  it('行名与作者定稿一字不差', () => {
    for (const k of ROWS) expect(row(k)?.name, k).toBe(NAMES[k]);
  });

  it('每行各挂自己的能力位：被拦时点亮的就是刚点的那一行', () => {
    const caps: Cap[] = ['aiSel', 'ai', 'aiLog', 'aiChat', 'kb'];
    expect(ROWS.map((k) => row(k)?.cap)).toEqual(caps);
    /* 能力位不许两行共用：共用就成了「点 A 亮 B」 */
    expect(new Set(caps).size).toBe(caps.length);
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

  it('切到英文，五行跟着换；切回中文恢复', () => {
    setLocale('en');
    expect(PLAN_TEXT_PACK.aiLog.en.length).toBeGreaterThan(0);
    expect(CJK.test(PLAN_TEXT_PACK.aiBook.en)).toBe(false);
    setLocale('zh');
    expect(row('aiSel')?.name).toBe(NAMES.aiSel);
  });
});
