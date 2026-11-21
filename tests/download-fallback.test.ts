/**
 * 下载入口的自动切换（tests/download-fallback.test.ts）
 *
 * 2026-11-20 的改动：国内 GitHub 裸网常连不上，点「下载」时先用一个短超时
 * 探测 GitHub Release，不通就静默换码云——用户看到的只是「点一下就开浏览器」。
 *
 * 这里钉住三件事：通开主线路、非 2xx 换备份、探测抛错（断网）也换备份。
 * 不测真实网络：requestUrl 换成可控替身。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomStub } from './helpers/dom-stub';

const net = vi.hoisted(() => ({ status: 200, fail: false }));

vi.mock('obsidian', () => ({
  requestUrl: async () => {
    if (net.fail) throw new Error('offline');
    return { status: net.status };
  },
}));

import { openDownloadWithFallback } from '../src/core/links';

const PRIMARY = 'https://github.com/x/y/releases/latest';
const MIRROR = 'https://gitee.com/x/y/releases/latest';

describe('下载入口：GitHub 不通自动切码云', () => {
  let uninstall = () => undefined as void;
  const open = vi.fn();

  beforeAll(() => {
    uninstall = installDomStub();
    (globalThis as unknown as { window: { open: typeof open } }).window.open = open;
  });
  afterAll(() => uninstall());
  beforeEach(() => {
    open.mockClear();
    net.status = 200;
    net.fail = false;
  });

  it('GitHub 通（2xx）：开主线路', async () => {
    await openDownloadWithFallback(PRIMARY, MIRROR);
    expect(open).toHaveBeenCalledWith(PRIMARY, '_blank', 'noopener,noreferrer');
  });

  it('GitHub 404：静默切码云', async () => {
    net.status = 404;
    await openDownloadWithFallback(PRIMARY, MIRROR);
    expect(open).toHaveBeenCalledWith(MIRROR, '_blank', 'noopener,noreferrer');
  });

  it('探测抛错（断网）：也切码云', async () => {
    net.fail = true;
    await openDownloadWithFallback(PRIMARY, MIRROR);
    expect(open).toHaveBeenCalledWith(MIRROR, '_blank', 'noopener,noreferrer');
  });
});
