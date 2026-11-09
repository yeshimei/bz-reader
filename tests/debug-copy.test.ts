import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';
import { setShellSource } from '../src/shell/source';
import { debugEvent, setDebugMeta, startDebugLog, stopDebugLog } from '../src/data/debug-log';

/**
 * 「复制调试数据」（2026-11-09 发版复核）。
 *
 * 设置页那颗按钮把当前快照整份塞进粘贴板：真机没法翻数据目录，
 * 用户只能这样把日志带出来发给作者。书名与事件都要在里面——
 * 少了书名，一份日志分不清是读哪本书时出的问题。
 */

afterEach(() => {
  stopDebugLog();
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  vi.unstubAllGlobals();
});

function el(): HTMLElement {
  return { dataset: {} } as unknown as HTMLElement;
}

describe('调试数据复制', () => {
  it('复制出来的 JSON 带书名与事件', async () => {
    let copied = '';
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async (text: string) => {
          copied = text;
        },
      },
    });
    startDebugLog(() => undefined, { app: 'bz-reader test', platform: 'test' });
    setDebugMeta({ book: '围城' });
    debugEvent('tap', { zone: 'prev' });

    dispatchAction('debugcopy', el());
    await new Promise((r) => setTimeout(r, 0));

    const dump = JSON.parse(copied) as { book?: string; events?: Array<{ k: string }> };
    expect(dump.book).toBe('围城');
    expect(dump.events?.[0]?.k).toBe('tap');
  });
});
