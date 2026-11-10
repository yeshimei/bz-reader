import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { autoMarks } from '../src/shell/auto-mark';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { RT } from '../src/shell/runtime';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { addHighlight } from '../src/data/notes';
import { makeApp, makeStore, testBook } from './helpers/plugin-harness';

/* ============================================================
 * 点一下就落线（2026-11-10）
 *
 * 划词条上「双链 / 存为名词 / 存为段落」要和「想法」一样：点下去的瞬间，
 * 这段文字就在书里多一条划线。用户要的是「回原文能找到它」——双链只进
 * 剪贴板、知识盒要等 bz 保存成功才划线，都做不到这一点。
 *
 * 三条边界一起钉住：
 *   1. 同位置已有线就复用，不叠第二条；
 *   2. 复用不改色（那条线可能是用户自己划的）；
 *   3. 颜色跟当前笔色，而且点一次色点就记住，下次还是它。
 * ============================================================ */

/* 授权门都放行：这里测的是「点了以后写什么」，不是卖什么 */
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

/** bz 录入门面：默认「一调就成功」，用例里可以改成「用户取消」 */
const bz = vi.hoisted(() => ({
  entry: null as null | ((...args: unknown[]) => { ok: boolean; message?: string }),
}));

vi.mock('../src/data/bz-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/bz-bridge')>();
  return {
    ...actual,
    bzEntryReady: () => true,
    probeBz: () => ({ ok: true, version: '9.9.9', knowledge: {} }),
    openBzEntry: (...args: unknown[]) => (bz.entry ? bz.entry(...args) : { ok: true }),
  };
});

const CFI = 'epubcfi(/6/4!/4/2/2,/1:0,/1:12)';
const CFI_B = 'epubcfi(/6/6!/4/2/2,/1:0,/1:12)';

afterEach(() => {
  bz.entry = null;
  RT.sel = null;
  RT.selMarkId = '';
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
});

function el(dataset: Record<string, string> = {}): HTMLElement {
  return { dataset } as unknown as HTMLElement;
}

function installSource(books: unknown[]): void {
  setShellSource({
    app: makeApp(),
    repo: { all: () => books },
    store: makeStore(),
    settings: () => ({ ...DEFAULT_SETTINGS }),
  } as unknown as ShellSource);
}

function select(cfi = CFI): void {
  RT.sel = {
    text: '注意力是一种有限的资源',
    bookId: 'b1',
    chapterTitle: '注意力',
    cfiRange: cfi,
  };
}

function highlights(book: unknown): Array<Record<string, unknown>> {
  return ((book as { notes: { highlights: unknown[] } }).notes.highlights ?? []) as Array<Record<string, unknown>>;
}

describe('autoMarks：哪些动作点完要顺手落线', () => {
  it('双链 / 存为名词 / 存为段落：要', () => {
    for (const act of ['selbilink', 'selterm', 'selpassage']) {
      expect(autoMarks(act), act).toBe(true);
    }
  });

  it('其余划词动作：不要（想法自己会落，复制不该留痕）', () => {
    for (const act of ['selpen', 'selcopy', 'selidea', 'selquote', 'selai', 'hlterm', 'hlpassage', 'copylink', '']) {
      expect(autoMarks(act), act).toBe(false);
    }
  });

  it('没点中 / 空动作：不要', () => {
    expect(autoMarks(undefined as unknown as string)).toBe(false);
    expect(autoMarks(null as unknown as string)).toBe(false);
  });
});

describe('双链：点下去就落一条线', () => {
  it('落一条，位置与文字取自选区，颜色跟当前笔色', () => {
    const book = testBook('b1');
    installSource([book]);
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1', pen: 'blue' });
    select();

    dispatchAction('selbilink', el());

    const hs = highlights(book);
    expect(hs).toHaveLength(1);
    expect(hs[0].cfiRange).toBe(CFI);
    expect(hs[0].text).toBe('注意力是一种有限的资源');
    expect(hs[0].chapterTitle).toBe('注意力');
    expect(hs[0].color).toBe('blue');
  });

  it('同一段已有线：复用它，不叠第二条、也不改色', () => {
    const book = testBook('b1');
    addHighlight(book as never, { text: '注意力是一种有限的资源', cfiRange: CFI, color: 'amber' });
    installSource([book]);
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1', pen: 'blue' });
    select();

    dispatchAction('selbilink', el());

    const hs = highlights(book);
    expect(hs).toHaveLength(1);
    expect(hs[0].color).toBe('amber');
  });

  it('PDF 框选（没有文字）：只复制链接，不落空划线', () => {
    const book = testBook('b1');
    installSource([book]);
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
    RT.sel = {
      text: '',
      bookId: 'b1',
      chapterTitle: '第一页',
      cfiRange: 'pdf:1',
      pdfRect: { left: 10, top: 20, width: 30, height: 40 },
    };

    dispatchAction('selbilink', el());

    expect(highlights(book)).toHaveLength(0);
  });
});

describe('存为名词 / 存为段落：先落线，再进 bz', () => {
  it('点「存为名词」：不等保存，书里先有线', () => {
    const book = testBook('b1');
    installSource([book]);
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1', pen: 'green' });
    select();
    bz.entry = () => ({ ok: true }); // 用户在 bz 里取消了

    dispatchAction('selterm', el());

    const hs = highlights(book);
    expect(hs).toHaveLength(1);
    expect(hs[0].color).toBe('green');
    expect(hs[0].kb).toBeUndefined();
  });

  it('bz 保存成功：链接挂到刚落的线上，不再多画一条', () => {
    const book = testBook('b1');
    installSource([book]);
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
    select();
    bz.entry = (...args: unknown[]) => {
      const onCreated = args.find((a) => typeof a === 'function') as ((p: string) => void) | undefined;
      onCreated?.('文献/注意力.md');
      return { ok: true };
    };

    dispatchAction('selpassage', el());

    const hs = highlights(book);
    expect(hs).toHaveLength(1);
    const kb = hs[0].kb as Array<{ kind: string; path: string }>;
    expect(kb).toHaveLength(1);
    expect(kb[0].kind).toBe('passage');
    expect(kb[0].path).toBe('文献/注意力.md');
  });

  it('连点两次：第二次仍在同一条线上，不会长成两条', () => {
    const book = testBook('b1');
    installSource([book]);
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
    select();
    bz.entry = () => ({ ok: true });

    dispatchAction('selterm', el());
    select();
    dispatchAction('selterm', el());

    expect(highlights(book)).toHaveLength(1);
  });

  it('先点双链再点想法：同一段复用那条线，不长出第二条', () => {
    const book = testBook('b1');
    installSource([book]);
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
    select();
    dispatchAction('selbilink', el());

    select();
    dispatchAction('selidea', el());

    expect(highlights(book)).toHaveLength(1);
    expect((getState().overlay as { kind?: string } | null)?.kind).toBe('idea');
  });
});

describe('笔色：点一次就记住', () => {
  it('点色点换朱红：状态里记住，下一段不点色点也用朱红', () => {
    const book = testBook('b1');
    installSource([book]);
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1' });
    select();

    dispatchAction('selpen', el({ v: 'vermilion' }));
    expect(getState().pen).toBe('vermilion');

    select(CFI_B);
    dispatchAction('selbilink', el());

    const hs = highlights(book);
    expect(hs).toHaveLength(2);
    expect(hs[1].color).toBe('vermilion');
  });

  it('点「默认色」不算换笔：原来是朱红就还是朱红', () => {
    const book = testBook('b1');
    installSource([book]);
    setState({ ...DEFAULT_SHELL_STATE, bookId: 'b1', pen: 'vermilion' });
    select();

    dispatchAction('selpen', el());
    expect(getState().pen).toBe('vermilion');
  });
});
