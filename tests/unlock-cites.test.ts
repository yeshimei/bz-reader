import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../src/i18n';
import { planLabel } from '../src/i18n/plan';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { overlayUnlock } from '../src/shell/overlay';

/**
 * 引用页签的门禁高亮（2026-11-12）。
 *
 * 它列的是「笔记里指向本书具体位置的链接」，与「划线存成双链」是两件事：
 * 前者是查看反链，后者是把划线做成链接。以前两者共用一道门禁，基础版点
 * 引用页签被拦时，弹层点亮的是「划线存成双链」——用户看着一行自己没点的
 * 功能，找不到刚点的那一项。
 *
 * 现在引用页签有自己的能力位：点它，弹层只点亮「引用页签：看哪些笔记引了
 * 这本书」；点双链入口仍点亮双链那一行。授权判定没有按能力位细分，
 * 不会出现「引用页要单独买」。
 */

const { ent } = vi.hoisted(() => ({ ent: { free: true } }));

vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return {
    ...actual,
    can: () => !ent.free,
    entitlement: () => ({
      tier: ent.free ? ('free' as const) : ('paid' as const),
      unlocked: !ent.free,
      trialLeft: 0,
      trialUsed: 0,
      exp: 0,
      license: '',
      trialVoid: false,
      installId: 'test',
      days: [],
    }),
  };
});

afterEach(() => {
  ent.free = true;
  setLocale('zh');
  setState({ ...DEFAULT_SHELL_STATE });
});

function el(dataset: Record<string, string> = {}): HTMLElement {
  return { dataset } as unknown as HTMLElement;
}

/** 弹层里被点亮的那几行（行内没有嵌套 div，取到第一个 </div> 就是整行） */
function capRows(html: string): string[] {
  return [...html.matchAll(/<div class="bzs-plan-row is-cap">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
}

describe('引用页签 · 基础版点它被拦', () => {
  it('弹层记下的是引用页签，不是双链', () => {
    dispatchAction('sbtab', el({ tab: 'cites' }));
    expect(getState().overlay).toMatchObject({ kind: 'unlock', mode: 'cites' });
  });

  it('被拦时没有切过去，侧栏还停在原来那一页', () => {
    setState({ ...DEFAULT_SHELL_STATE, sideTab: 'toc' });
    dispatchAction('sbtab', el({ tab: 'cites' }));
    expect(getState().sideTab).toBe('toc');
  });

  it('只点亮「引用页签」这一行，双链那一行不亮', () => {
    const hot = capRows(overlayUnlock('cites'));
    expect(hot).toHaveLength(1);
    expect(hot[0]).toContain(planLabel('cites'));
    expect(hot[0]).not.toContain(planLabel('bilink'));
  });
});

describe('双链入口 · 高亮没有跟着串位', () => {
  it('点双链仍然只点亮「划线存成双链」', () => {
    const hot = capRows(overlayUnlock('bilink'));
    expect(hot).toHaveLength(1);
    expect(hot[0]).toContain(planLabel('bilink'));
    expect(hot[0]).not.toContain(planLabel('cites'));
  });

  it('从设置页进来看全表（不传 mode）时一行都不亮', () => {
    expect(capRows(overlayUnlock())).toHaveLength(0);
  });
});

describe('已激活 · 不再被拦', () => {
  it('点引用页签直接切过去，不弹层', () => {
    ent.free = false;
    dispatchAction('sbtab', el({ tab: 'cites' }));
    expect(getState().overlay).toBeNull();
    expect(getState().sideTab).toBe('cites');
  });
});
