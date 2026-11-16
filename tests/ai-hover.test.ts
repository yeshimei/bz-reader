import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { AI_HOVER_DELAY, aiHoverOpens, aiMenuFallback, makeHoverIntent } from '../src/shell/ai-hover';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { RT } from '../src/shell/runtime';

/* ============================================================
 * 工具条上的 AI：悬停就摊开二级菜单（解释 / 翻译 / 总结 / 追问）。
 *
 * 三条硬规矩：
 *   1. 只认真鼠标——手机上轻点也会先发一个「悬停」，那会变成点两下开开关关；
 *   2. 悬停只「确保打开」，不 toggle——鼠标停在同一颗按钮上会反复进事件；
 *   3. 没买高级版时悬停什么都不做——鼠标扫过去就蹦付费页是最吓人的一种交互。
 * ============================================================ */

const { ent } = vi.hoisted(() => ({ ent: { ai: true } }));

vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => ent.ai };
});

function btn(): HTMLElement {
  return { dataset: {} } as unknown as HTMLElement;
}

beforeEach(() => {
  ent.ai = true;
  setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
  RT.sel = {
    text: '结婚仿佛金漆的鸟笼',
    bookId: 'b1',
    chapterTitle: '第三章',
    cfiRange: 'cfi1',
  };
  RT.aiHover = false;
});

afterEach(() => {
  setState({ ...DEFAULT_SHELL_STATE });
  RT.sel = null;
  RT.aiHover = false;
});

describe('悬停判定', () => {
  it('真鼠标 + 有权限 + 有原文才展开', () => {
    expect(
      aiHoverOpens({ hoverCapable: true, pointerType: 'mouse', entitled: true, text: '原文' }),
    ).toBe(true);
  });

  it('触摸不会当成悬停', () => {
    expect(
      aiHoverOpens({ hoverCapable: true, pointerType: 'touch', entitled: true, text: '原文' }),
    ).toBe(false);
  });

  it('没有真鼠标的设备（手机 / 平板）一律不展开', () => {
    expect(
      aiHoverOpens({ hoverCapable: false, pointerType: 'mouse', entitled: true, text: '原文' }),
    ).toBe(false);
  });

  it('没有高级版不展开：付费页不能被鼠标扫出来', () => {
    expect(
      aiHoverOpens({ hoverCapable: true, pointerType: 'mouse', entitled: false, text: '原文' }),
    ).toBe(false);
  });

  it('没有原文不展开：空面板等于点了没反应', () => {
    expect(
      aiHoverOpens({ hoverCapable: true, pointerType: 'mouse', entitled: true, text: '   ' }),
    ).toBe(false);
  });
});

describe('悬停意图计时', () => {
  it('停够时间才执行，扫过去不算', () => {
    vi.useFakeTimers();
    const ran: number[] = [];
    const intent = makeHoverIntent(() => ran.push(1));
    intent.arm();
    vi.advanceTimersByTime(AI_HOVER_DELAY - 10);
    expect(ran).toHaveLength(0);
    vi.advanceTimersByTime(20);
    expect(ran).toHaveLength(1);
    vi.useRealTimers();
  });

  it('离开得早就取消，不会在半路上弹出来', () => {
    vi.useFakeTimers();
    const ran: number[] = [];
    const intent = makeHoverIntent(() => ran.push(1));
    intent.arm();
    intent.cancel();
    vi.advanceTimersByTime(AI_HOVER_DELAY + 50);
    expect(ran).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe('菜单收起来之后退回哪一层', () => {
  it('从划线进来的：退回到那条工具条，markId 与锚点原样带着', () => {
    const anchor = { left: 10, top: 20, width: 30, height: 0 };
    expect(aiMenuFallback({ markId: 'm1', bookId: 'b1', anchor })).toEqual({
      kind: 'hltools',
      markId: 'm1',
      bookId: 'b1',
      anchor,
    });
  });

  it('从选区进来的（没有划线）：没有工具条可退，整块关掉', () => {
    expect(aiMenuFallback({ bookId: 'b1' })).toBeNull();
  });
});

describe('工具栏 AI 悬停展开', () => {
  it('悬停摊开五项菜单，并记下这是悬停开的', () => {
    dispatchAction('selai', btn(), {}, { hover: true });

    const o = getState().overlay;
    expect(o?.kind).toBe('ai');
    expect(o?.menu).toBe(true);
    expect(RT.aiHover).toBe(true);
  });

  it('再悬停一次仍然开着：不 toggle，否则鼠标停在按钮上会自己开开关关', () => {
    dispatchAction('selai', btn(), {}, { hover: true });
    const first = getState().overlay;
    dispatchAction('selai', btn(), {}, { hover: true });

    expect(getState().overlay?.menu).toBe(true);
    /* 没有整框重画：同一个对象原样留着 */
    expect(getState().overlay).toBe(first);
  });

  it('点击仍是开合：从鼠标移进去再点一下会收起', () => {
    dispatchAction('selai', btn(), {}, { hover: true });
    dispatchAction('selai', btn());

    expect(getState().overlay).toBeNull();
    expect(RT.aiHover).toBe(false);
  });

  it('没有高级版：悬停不弹解锁页，什么都不发生', () => {
    ent.ai = false;
    dispatchAction('selai', btn(), {}, { hover: true });

    expect(getState().overlay).toBeNull();
  });

  it('没有高级版：点击仍然弹解锁页，不吞掉原来的提示', () => {
    ent.ai = false;
    dispatchAction('selai', btn());

    expect(getState().overlay?.kind).toBe('unlock');
  });

  it('没有原文（选区已收）：悬停不展开空菜单', () => {
    RT.sel = null;
    dispatchAction('selai', btn(), {}, { hover: true });

    expect(getState().overlay).toBeNull();
  });
});
