/**
 * 壳层的两道「口子」（C4 / C11）。
 *
 *   C11  弹层里的确认按钮也是数据入口：`ackok` / `ptresume` / `ptretry` /
 *        `aiidxrebuildyes` 以前直接干活，授权掉了照样能点——按钮不渲染不等于
 *        动作不存在（`data-act` 是 DOM 属性，脚本一样能派发）。
 *   C4   换书之后，上一本的问答记录与在途请求都该作废：留着会张冠李戴，
 *        「这本书讲了什么」的答案出现在另一本书的侧栏里。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { RT } from '../src/shell/runtime';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { withSignal } from '../src/core/with-signal';
import { makeApp, makeStore } from './helpers/plugin-harness';

const notices = vi.hoisted(() => [] as string[]);
vi.mock('../src/core/notice', () => ({
  notify: (text: string) => void notices.push(text),
}));

/* 授权已失效：这几条动作都该被拦在解锁层 */
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => false };
});

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  RT.ackPending = null;
  RT.aiAbort = null;
  RT.aiBookId = '';
  RT.aiLog = [];
  notices.length = 0;
});

function el(dataset: Record<string, string> = {}): HTMLElement {
  return { dataset } as unknown as HTMLElement;
}

function installSource(): void {
  setShellSource({
    app: makeApp(),
    repo: { all: () => [] },
    store: makeStore(),
    settings: () => ({ ...DEFAULT_SETTINGS }),
  } as unknown as ShellSource);
}

describe('确认类动作补能力门（C11）', () => {
  it('ackok：授权掉了就开解锁层，不记「已确认」也不重发提问', () => {
    installSource();
    RT.ackPending = { q: '这本书讲什么' };
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'ack' } });

    dispatchAction('ackok', el());

    expect(getState().overlay?.kind).toBe('unlock');
    expect(getState().overlay?.mode).toBe('ai');
    expect(RT.ackPending).toEqual({ q: '这本书讲什么' });
  });

  it.each(['ptresume', 'ptretry', 'aiidxrebuildyes'])('%s：授权掉了开解锁层，不碰索引', (act) => {
    installSource();
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'rebuildidx', bookId: 'b1' } });

    dispatchAction(act, el());

    expect(getState().overlay?.kind).toBe('unlock');
    /* 2026-11-09 起对照表不再单列向量检索：建索引被拦统一高亮「AI 全书问答」 */
    expect(getState().overlay?.mode).toBe('ai');
  });
});

describe('换书作废上一本的问答（C4）', () => {
  it('切到另一本书：记录清空、在途请求掐掉', () => {
    const ctrl = new AbortController();
    RT.aiLog = [{ me: true, tag: '我', text: '问' }];
    RT.aiAbort = ctrl;
    RT.aiBookId = 'b1';

    setState({ bookId: 'b2' });

    expect(RT.aiLog).toEqual([]);
    expect(RT.aiAbort).toBeNull();
    expect(ctrl.signal.aborted).toBe(true);
    expect(RT.aiBookId).toBe('');
  });

  it('还是同一本书：记录原样留着', () => {
    setState({ bookId: 'b1' });
    RT.aiLog = [{ me: true, tag: '我', text: '问' }];
    RT.aiBookId = 'b1';

    setState({ bookId: 'b1' });

    expect(RT.aiLog).toHaveLength(1);
  });
});

describe('取证阶段的取消出口（C5）', () => {
  it('signal 掐断后不再等外部检索', async () => {
    const ctrl = new AbortController();
    const never = new Promise<number>(() => undefined);

    const p = withSignal(never, ctrl.signal);
    ctrl.abort();

    await expect(p).rejects.toThrow();
  });

  it('已经 abort 的 signal 立刻拒绝', async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(withSignal(Promise.resolve(1), ctrl.signal)).rejects.toThrow();
  });

  it('没有 signal 时原样透传', async () => {
    await expect(withSignal(Promise.resolve(7))).resolves.toBe(7);
  });
});
