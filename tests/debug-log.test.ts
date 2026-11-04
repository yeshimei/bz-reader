import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dlog, initDebugLog, isDebugLogEnabled, shutdownDebugLog } from '../src/core/debug-log';
import { installDomStub } from './helpers/dom-stub';

const FLAG = 'bz-reader:debug-log';
let flag: string | null = null;
let uninstall: () => void = () => undefined;

function installGlobals(): void {
  uninstall = installDomStub();
  const win = window as unknown as Record<string, unknown>;
  win.localStorage = {
    getItem: (key: string) => (key === FLAG ? flag : null),
  };
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  win.addEventListener = () => undefined;
  win.removeEventListener = () => undefined;
}

beforeEach(() => {
  flag = null;
  installGlobals();
  vi.useFakeTimers();
});

afterEach(() => {
  shutdownDebugLog();
  vi.useRealTimers();
  uninstall();
});

const app = { vault: { adapter: { exists: async () => false } } } as never;

describe('运行日志默认关闭（A-11 · debug 门控）', () => {
  it('没设 localStorage 开关时 initDebugLog 不启用，dlog 连定时器都不排', () => {
    const timeout = vi.spyOn(window, 'setTimeout');
    initDebugLog(app);

    expect(isDebugLogEnabled()).toBe(false);
    dlog('tap', { zone: 'next' });
    expect(timeout).not.toHaveBeenCalled();
  });

  it('开关不是 1（比如 0 / true）也不启用', () => {
    for (const v of ['0', 'true', 'yes', '']) {
      flag = v;
      initDebugLog(app);
      expect(isDebugLogEnabled()).toBe(false);
    }
  });

  it("localStorage['bz-reader:debug-log'] === '1' 才启用，并排一次刷盘", () => {
    flag = '1';
    const timeout = vi.spyOn(window, 'setTimeout');
    initDebugLog(app);

    expect(isDebugLogEnabled()).toBe(true);
    expect(timeout).toHaveBeenCalledTimes(1); // boot 那一行排了一次
    dlog('tap', { zone: 'next' });
    expect(window.setTimeout).toHaveBeenCalledTimes(1); // 同一批合并，不重复排
  });
});
