import { afterEach, describe, expect, it } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, overlayKey, setState } from '../src/shell/state';
import { RT } from '../src/shell/runtime';

/* ============================================================
 * AI 卡的「定住」（2026-11-16）
 *
 * 以前只剩「点外面就关」一条路：想边看正文边读回答，手一碰正文整张卡
 * 就没了。定住之后头栏可以拖着走、点书页正文不关；点界面其它地方照关，
 * × 更是随时能关（只留 × 一个出口，用户找不到）。
 * 这里锁住三件事：状态能翻、它进了渲染键（否则按钮长相不会跟着变），
 * 以及解锁会把拖出来的位置还回去。
 * ============================================================ */

function el(): HTMLElement {
  return { dataset: {} } as unknown as HTMLElement;
}

function card(patch: Record<string, unknown> = {}): void {
  setState({
    ...DEFAULT_SHELL_STATE,
    bookId: 'b1',
    overlay: { kind: 'ai', bookId: 'b1', text: '原文', mode: 'follow', ...patch } as never,
  });
}

afterEach(() => {
  setState({ ...DEFAULT_SHELL_STATE });
  RT.aiFloatPos = null;
});

describe('AI 卡 · 定住', () => {
  it('点一次定住，再点一次解除', () => {
    card();

    dispatchAction('aipin', el());
    expect(getState().overlay?.pinned).toBe(true);

    dispatchAction('aipin', el());
    expect(getState().overlay?.pinned).toBe(false);
  });

  it('定住进渲染键：按钮要从空心变实心', () => {
    card();
    const before = overlayKey(getState().overlay);
    card({ pinned: true });
    expect(overlayKey(getState().overlay)).not.toBe(before);
  });

  it('菜单那一行没有定住：它没有可拖的窗口', () => {
    card({ menu: true, pinned: false });
    dispatchAction('aipin', el());
    expect(getState().overlay?.pinned).toBe(false);
  });

  /* 拖出来的位置只属于「定住」这一档：解锁之后卡片回到原文旁边，
     不然它会飘在半空——既不能再拖，点一下又要关，看着像卡住了。 */
  it('解锁就把拖出来的位置还回去', () => {
    card({ pinned: true });
    RT.aiFloatPos = { left: 120, top: 80, width: 430 };
    dispatchAction('aipin', el());
    expect(getState().overlay?.pinned).toBe(false);
    expect(RT.aiFloatPos).toBeNull();
  });
});
