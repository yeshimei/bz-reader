import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { RT } from '../src/shell/runtime';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { makeApp, makeStore, testBook } from './helpers/plugin-harness';

/* ============================================================
 * 划词 AI 什么时候落线（2026-11-16）
 *
 * 以前点「解释 / 翻译 / 总结 / 追问」只开卡片，什么都不落到书里：
 * 关掉卡片这段对话就找不回来了。现在解释 / 翻译 / 总结一点就落一条线，
 * 对话绑在线上——再点那条线，看到的是上次那份问答。
 *
 * 「追问」要分开看（作者 2026-11-16 定）：点它只是打开输入框，一句话还
 * 没问出去，这时候不该留痕；等第一句真的发出去才落线。两条边界照旧：
 *   1. 同段已有线就复用（不叠第二条，也不改用户自己划的颜色）；
 *   2. 从划线工具条进来的已经带了 markId，不要再落一条；
 *   3. 落线不影响「插入到全书问答」那条路（它不写线）。
 * ============================================================ */

vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

/* 追问那一路要真的发一次请求：只把网络那层换掉，记账 / 落线照跑 */
vi.mock('../src/data/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/ai')>();
  return { ...actual, aiAsk: async () => ({ text: '追问的答案' }) };
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

/** 收选区的次数：追问发送那一刻要清一次，靠它证明「划线之后选区没了」 */
let cleared = 0;

function install(books: unknown[]): void {
  cleared = 0;
  setShellSource({
    app: makeApp(),
    repo: { all: () => books },
    store: makeStore(),
    /* AI 配齐：追问那条路要先过 aiReady 才谈得上发请求、落线 */
    settings: () => ({
      ...DEFAULT_SETTINGS,
      ai: { baseUrl: 'https://api.test/v1', apiKey: 'k', model: 'm' },
    }),
    clearSelection: () => {
      cleared++;
    },
  } as unknown as ShellSource);
}

/** 追问输入框：动作要求 el.closest('.bzs-aifloat') 里能取到那行字 */
function followEl(value: string): HTMLElement {
  const input = { value };
  const card = { querySelector: () => input };
  return { closest: () => card } as unknown as HTMLElement;
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

  it('点「解释」的同时把正文选区收掉：蓝底不该一直挂着', () => {
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

    expect(cleared).toBe(1);
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

/**
 * 追问的落线时机（作者 2026-11-16 定）。
 *
 * 「点追问」只是打开输入框——一句话都还没问出去，这时候在书里留一条线
 * 是凭空造痕；真正要留的是「我问过这段」这件事，得等那句话发出去。
 */
describe('追问：点开不落线，发出去才落线', () => {
  function pickFollow(book: unknown): void {
    install([book]);
    RT.sel = {
      text: '注意力是一种有限的资源',
      bookId: 'b1',
      chapterTitle: '第一章',
      cfiRange: CFI,
    };
    menuOpen();
    dispatchAction('aimenupick', el({ task: 'follow' }));
  }

  it('点「追问」：不落线，只把菜单换成空面板', () => {
    const book = testBook('b1');
    pickFollow(book);

    expect(marksOf(book)).toHaveLength(0);
    const o = getState().overlay;
    expect(o?.menu).toBe(false);
    expect(o?.mode).toBe('follow');
    expect(o?.markId ?? '').toBe('');
  });

  it('点「追问」也收掉正文选区', () => {
    pickFollow(testBook('b1'));
    expect(cleared).toBe(1);
  });

  it('第一句真的发出去：这一刻才落线，随后把选区收掉', async () => {
    const book = testBook('b1');
    pickFollow(book);

    dispatchAction('aifollow', followEl('那她为什么还是嫁了？'));
    await new Promise((r) => setTimeout(r, 30));

    const marks = marksOf(book);
    expect(marks).toHaveLength(1);
    const id = (marks[0] as { id: string }).id;
    expect(getState().overlay?.markId).toBe(id);
    /* 点开时清过一次，发送时再清一次 */
    expect(cleared).toBe(2);
  });

  it('输入框里只有空白：不落线，也不发请求', async () => {
    const book = testBook('b1');
    pickFollow(book);

    dispatchAction('aifollow', followEl('   '));
    await new Promise((r) => setTimeout(r, 20));

    expect(marksOf(book)).toHaveLength(0);
  });
});
