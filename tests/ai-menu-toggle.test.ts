import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { RT } from '../src/shell/runtime';

/* ============================================================
 * 工具条上的 AI：点一下摊开五项，再点一下收起（2026-11-16）。
 *
 * 中间有过一版是「鼠标放上去就展开、移走就收」。桌面用起来被打断得
 * 太频繁（手从工具条移到正文，菜单一路跟着开合），作者定回点击：
 *   1. 点一下开，再点一下关；
 *   2. 手机上一样，轻点不会先「悬停」再「点击」，两个状态各来一次；
 *   3. 没买高级版时点击弹解锁页（这条是老设计，别一起丢了）。
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
});

afterEach(() => {
  RT.sel = null;
  setState({ ...DEFAULT_SHELL_STATE });
});

describe('工具条 AI · 点击开合', () => {
  it('点一下：摊开五项菜单', () => {
    dispatchAction('selai', btn());

    const o = getState().overlay;
    expect(o?.kind).toBe('ai');
    expect(o?.menu).toBe(true);
  });

  it('再点一下：收起', () => {
    dispatchAction('selai', btn());
    dispatchAction('selai', btn());

    expect(getState().overlay).toBeNull();
  });

  it('没有高级版：点击弹解锁页，不吞掉提示', () => {
    ent.ai = false;
    dispatchAction('selai', btn());

    expect(getState().overlay?.kind).toBe('unlock');
  });

  it('没有原文（选区已收）：不摊开空菜单', () => {
    RT.sel = null;
    dispatchAction('selai', btn());

    expect(getState().overlay).toBeNull();
  });
});
