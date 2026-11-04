import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { GROUP_ID, REPO_URL } from '../src/data/entitlement';

/* notify 走 Obsidian 的 Notice，node 里拿不到弹出来的那条；
   换成收集器，验「说了什么」而不是「弹了几次」。 */
const notices = vi.hoisted(() => [] as string[]);
vi.mock('../src/core/notice', () => ({
  notify: (text: string) => void notices.push(text),
}));

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  notices.length = 0;
  vi.unstubAllGlobals();
});

function el(): HTMLElement {
  return { dataset: {} } as unknown as HTMLElement;
}

function stubClipboard(): string[] {
  const writes: string[] = [];
  vi.stubGlobal('navigator', {
    clipboard: { writeText: async (text: string) => void writes.push(text) },
  });
  return writes;
}

describe('关于组 · GitHub', () => {
  it('点一下在新窗口打开仓库，带 noopener', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    dispatchAction('aboutgithub', el());

    expect(open).toHaveBeenCalledWith(REPO_URL, '_blank', 'noopener,noreferrer');
  });
});

describe('关于组 · 视频教程', () => {
  /* 教程还没剪完。这一项不能是死按钮：点了要说清「为什么没反应、什么时候有」，
     也不能顺手打开一个不存在的链接。 */
  it('不打开任何链接，只说明还在做', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    dispatchAction('aboutvideo', el());

    expect(open).not.toHaveBeenCalled();
    expect(notices.join('')).toContain('还在剪');
  });
});

describe('关于组 · 交流群', () => {
  /* 群号是唯一不会失效的入口：qm.qq.com 的短链实测 404，短码也是另一套。
     所以复制出去的必须是群号本身。 */
  it('复制的是群号本身，不是短链', async () => {
    const writes = stubClipboard();

    dispatchAction('copygroup', el());

    await vi.waitFor(() => expect(writes).toEqual([GROUP_ID]));
    expect(notices.join('')).toContain(GROUP_ID);
  });
});

describe('关于组 · 更新日志', () => {
  /* 走的是插件的「回看」入口，不是升级后自动弹那条带记账的路：
     同一份弹窗，记账与否是两件事。 */
  it('点一下调 openChangelog', () => {
    const openChangelog = vi.fn();
    setShellSource({ openChangelog } as unknown as ShellSource);

    dispatchAction('changelog', el());

    expect(openChangelog).toHaveBeenCalledTimes(1);
  });
});
