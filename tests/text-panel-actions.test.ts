import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { addHighlight } from '../src/data/notes';
import { makeApp, makeStore, testBook } from './helpers/plugin-harness';

/**
 * 点划线工具条上的动作（S11 合并之后）。
 *
 * 三件事必须成立，否则「工具条只有一枚」只是长得像：
 *   · 「AI」在点划线时真能打开 AI 卡（以前这颗按钮根本不存在，点了没反应）；
 *   · 「复制」点完把浮层关掉——不然复制完还压着正文，用户得再点一下空白；
 *   · 「双链」同理（复制双向链接之后浮层也该收）。
 *
 * 复制本身走 navigator.clipboard，这里桩掉，只验「交给剪贴板的内容」和「浮层关了」。
 */

vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  vi.unstubAllGlobals();
});

function el(data: Record<string, string> = {}): HTMLElement {
  return { dataset: data } as unknown as HTMLElement;
}

function install(books: unknown[]): void {
  setShellSource({
    app: makeApp(),
    repo: {
      all: () => books,
      byId: (id: string) => (books as Array<{ id: string }>).find((b) => b.id === id),
    },
    store: makeStore(),
    settings: () => ({ ...DEFAULT_SETTINGS, exportDir: '书摘' }),
    searchText: async () => [],
    hasOpenReader: () => true,
    setGoal: () => undefined,
  } as unknown as ShellSource);
}

/** 一本书 + 一条带想法的划线，并让浮层停在「点划线」这一步 */
function setup(): { markId: string } {
  const book = testBook('b1', '测试书');
  const mark = addHighlight(book as never, {
    text: '划线原文一段',
    cfiRange: 'cfi1',
    chapterTitle: '第一章',
    color: 'green',
    comment: '这条想法',
  });
  install([book]);
  const anchor = { left: 120, top: 300, width: 0, height: 0 };
  setState({
    ...DEFAULT_SHELL_STATE,
    bookId: 'b1',
    overlay: { kind: 'hltools', markId: mark.id, bookId: 'b1', anchor },
  });
  return { markId: mark.id };
}

/** 桩剪贴板，返回写进去的文本 */
function stubClipboard(): string[] {
  const writes: string[] = [];
  vi.stubGlobal('navigator', {
    clipboard: { writeText: async (text: string) => void writes.push(text) },
  });
  return writes;
}

describe('AI：点划线也能直接问', () => {
  it('打开 AI 卡，带上这条划线的原文与锚点', () => {
    const { markId } = setup();
    dispatchAction('hlai', el({ id: markId, book: 'b1' }));

    const o = getState().overlay;
    expect(o?.kind).toBe('ai');
    expect(o?.text).toBe('划线原文一段');
    expect(o?.markId).toBe(markId);
    expect(o?.anchor).toEqual({ left: 120, top: 300, width: 0, height: 0 });
  });

  it('划线已经没了就不开空面板', () => {
    setup();
    dispatchAction('hlai', el({ id: 'h-gone', book: 'b1' }));
    expect(getState().overlay?.kind).toBe('hltools');
  });
});

describe('复制：点完收起浮层', () => {
  it('复制划线原文并关掉工具条', async () => {
    const { markId } = setup();
    const writes = stubClipboard();

    dispatchAction('hlcopy', el({ id: markId, book: 'b1' }));

    expect(getState().overlay).toBeNull();
    await vi.waitFor(() => expect(writes).toEqual(['划线原文一段']));
  });

  it('复制双向链接也关掉工具条', async () => {
    const { markId } = setup();
    const writes = stubClipboard();

    dispatchAction('copylink', el({ id: markId, book: 'b1' }));

    expect(getState().overlay).toBeNull();
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    /* 2026-11-05 起产出双链 `[[书.epub#bzr-cfi=…|划线文字]]`：
       书本来就是 vault 里的文件，`[[]]` 能解析到，反链面板也看得见。
       obsidian:// 那条路退到「复制概要链接」与老链接兼容。 */
    expect(writes[0]).toContain('[[书/b1.epub#bzr-cfi=');
  });
});
