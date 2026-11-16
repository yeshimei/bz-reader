import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { RT } from '../src/shell/runtime';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { makeApp, makeStore, testBook } from './helpers/plugin-harness';

/* ============================================================
 * 点了划词 AI 就先落一条线（2026-11-16）
 *
 * 以前点「解释 / 翻译 / 总结 / 追问」只开卡片，什么都不落到书里：
 * 关掉卡片这段对话就找不回来了。现在先在原文落一条划线，对话绑在线上——
 * 再点那条线，看到的是上次那份问答。
 *
 * 三条边界：
 *   1. 同段已有线就复用（不叠第二条，也不改用户自己划的颜色）；
 *   2. 从划线工具条进来的已经带了 markId，不要再落一条；
 *   3. 落线不影响「插入到全书问答」那条路（它不写线）。
 * ============================================================ */

vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

const CFI = 'epubcfi(/6/4!/4/2/2,/1:0,/1:12)';

/* 「插入到全书问答」那条路会 setTimeout 去聚焦侧栏输入框，需要 document */
const undoDom = installDomStub();

afterAll(() => undoDom());

afterEach(() => {
  RT.sel = null;
  RT.selMarkId = '';
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
});

function el(dataset: Record<string, string> = {}): HTMLElement {
  return { dataset } as unknown as HTMLElement;
}

function install(books: unknown[]): void {
  setShellSource({
    app: makeApp(),
    repo: { all: () => books },
    store: makeStore(),
    settings: () => ({ ...DEFAULT_SETTINGS }),
  } as unknown as ShellSource);
}

function marksOf(book: unknown): unknown[] {
  return ((book as { notes: { highlights: unknown[] } }).notes.highlights ?? []) as unknown[];
}

function menuOpen(patch: Record<string, unknown> = {}): void {
  setState({
    ...DEFAULT_SHELL_STATE,
    bookId: 'b1',
    overlay: {
      kind: 'ai',
      menu: true,
      text: '注意力是一种有限的资源',
      bookId: 'b1',
      ...patch,
    } as never,
  });
}

describe('划词 AI 自动落线', () => {
  it('点「解释」：原文多一条划线，对话挂在这条线上', () => {
    const book = testBook('b1');
    install([book]);
    RT.sel = {
      text: '注意力是一种有限的资源',
      bookId: 'b1',
      chapterTitle: '第一章',
      cfiRange: CFI,
    };
    menuOpen();

    dispatchAction('aimenupick', el({ task: 'explain' }));

    const marks = marksOf(book);
    expect(marks).toHaveLength(1);
    const id = (marks[0] as { id: string }).id;
    const o = getState().overlay;
    expect(o?.kind).toBe('ai');
    expect(o?.menu).toBe(false);
    expect(o?.markId).toBe(id);
  });

  it('同一段再点一次：复用那条线，不叠第二条', () => {
    const book = testBook('b1');
    install([book]);
    RT.sel = {
      text: '注意力是一种有限的资源',
      bookId: 'b1',
      chapterTitle: '第一章',
      cfiRange: CFI,
    };
    menuOpen();
    dispatchAction('aimenupick', el({ task: 'explain' }));
    const first = getState().overlay?.markId;

    menuOpen();
    dispatchAction('aimenupick', el({ task: 'translate' }));

    expect(marksOf(book)).toHaveLength(1);
    expect(getState().overlay?.markId).toBe(first);
  });

  it('从划线工具条进来（已带 markId）：不再落线', () => {
    const book = testBook('b1');
    install([book]);
    RT.sel = null;
    menuOpen({ markId: 'm-existing' });

    dispatchAction('aimenupick', el({ task: 'explain' }));

    expect(marksOf(book)).toHaveLength(0);
    expect(getState().overlay?.markId).toBe('m-existing');
  });

  it('「插入到全书问答」不写线：它只是把原文送进侧栏', async () => {
    const book = testBook('b1');
    install([book]);
    RT.sel = {
      text: '注意力是一种有限的资源',
      bookId: 'b1',
      chapterTitle: '第一章',
      cfiRange: CFI,
    };
    menuOpen();

    dispatchAction('aimenupick', el({ task: 'book' }));

    expect(marksOf(book)).toHaveLength(0);
    /* 这条路会延后一拍去聚焦侧栏输入框：等它跑完再收 DOM 桩，
       否则会在 afterAll 之后炸一句「document is not defined」 */
    await new Promise((r) => setTimeout(r, 80));
  });
});
