import { afterEach, describe, expect, it } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { RT } from '../src/shell/runtime';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { makeApp, makeStore, testBook } from './helpers/plugin-harness';
import { installDomStub } from './helpers/dom-stub';

/**
 * 划词菜单 →「插入到全书问答」。
 *
 * 这一条曾经是断的：菜单只往 `RT.aiPendingInsert` 塞一条，侧栏那边没人取，
 * 点下去只有一句 toast，输入条上什么都不会出现。合并两条分支之后改成直接
 * 调 `attachAiContext`，这里锁住「真的挂进上下文 + 切到 AI 页签」。
 */

let undoDom: (() => void) | null = null;

afterEach(async () => {
  /* attachAiContext 里有一个 setTimeout(0) 把焦点还给输入框：
     先让它跑掉，再卸 DOM 桩，否则回调里摸不到 document。 */
  await new Promise((resolve) => setTimeout(resolve, 5));
  undoDom?.();
  undoDom = null;
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  RT.aiCtx = [];
});

function installSource(books: unknown[]): void {
  setShellSource({
    app: makeApp(),
    repo: { all: () => books },
    store: makeStore(),
    settings: () => ({ ...DEFAULT_SETTINGS }),
  } as unknown as ShellSource);
}

function menuPick(task: string): HTMLElement {
  return { dataset: { task } } as unknown as HTMLElement;
}

describe('划词 AI · 插入到全书问答', () => {
  it('原文与出处挂进侧栏上下文，并切到 AI 页签、收起浮框', () => {
    undoDom = installDomStub();
    installSource([testBook('b1', '围城')]);
    setState({
      ...DEFAULT_SHELL_STATE,
      bookId: 'b1',
      sideTab: 'toc',
      overlay: {
        kind: 'ai',
        menu: true,
        text: '结婚仿佛金漆的鸟笼',
        chapterTitle: '第三章',
        bookId: 'b1',
      },
    });

    dispatchAction('aimenupick', menuPick('book'));

    expect(RT.aiCtx).toHaveLength(1);
    expect(RT.aiCtx[0].kind).toBe('quote');
    expect(RT.aiCtx[0].text).toContain('金漆的鸟笼');
    expect(RT.aiCtx[0].meta).toContain('第三章');
    expect(getState().sideTab).toBe('ai');
    expect(getState().overlay).toBeNull();
  });

  it('选中的是空白：不进上下文，也不报成插入成功', () => {
    undoDom = installDomStub();
    installSource([testBook('b1', '围城')]);
    setState({
      ...DEFAULT_SHELL_STATE,
      bookId: 'b1',
      overlay: { kind: 'ai', menu: true, text: '   ', chapterTitle: '第三章', bookId: 'b1' },
    });

    dispatchAction('aimenupick', menuPick('book'));

    expect(RT.aiCtx).toHaveLength(0);
    expect(getState().overlay).not.toBeNull();
  });

  it('解释 / 追问这些项不碰上下文，只把菜单换成浮框', () => {
    undoDom = installDomStub();
    installSource([testBook('b1', '围城')]);
    setState({
      ...DEFAULT_SHELL_STATE,
      bookId: 'b1',
      overlay: { kind: 'ai', menu: true, text: '原文', chapterTitle: '第三章', bookId: 'b1' },
    });

    dispatchAction('aimenupick', menuPick('follow'));

    expect(RT.aiCtx).toHaveLength(0);
    const o = getState().overlay;
    expect(o?.menu).toBe(false);
    expect(o?.mode).toBe('follow');
  });
});
