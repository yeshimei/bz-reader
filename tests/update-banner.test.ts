/**
 * 更新提示条（tests/update-banner.test.ts）
 *
 * 2026-11-26 作者定稿：不弹模态遮罩，改成书架头栏下面一条细提示。
 * 这里锁四件事：
 *   1. 什么时候该出现——线上比本机新，且这一版还没被忽略；
 *   2. 三颗按钮的动作名与文案（前两颗与设置页「插件」组逐字相同）；
 *   3. 「忽略这一版」写的本地状态（notified 记这一版，下个版本还会提示）；
 *   4. 版本号来自网络，拼进 HTML 前必须转义。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  dismissUpdateBanner,
  shouldShowUpdateBanner,
  updateBannerHtml,
} from '../src/shell/update-banner';
import { readUpdateState, writeUpdateState } from '../src/data/plugin-update';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  (globalThis as unknown as { window?: unknown }).window ??= globalThis;
  (globalThis as unknown as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
});

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

describe('要不要显示更新提示条', () => {
  it('线上更新、且这一版没忽略过：显示', () => {
    expect(shouldShowUpdateBanner('1.8.2', { checkedAt: 1, notified: '', latest: '1.9.0' })).toBe(true);
  });

  it('同一版已经点过「忽略这一版」：不再显示', () => {
    expect(shouldShowUpdateBanner('1.8.2', { checkedAt: 1, notified: '1.9.0', latest: '1.9.0' })).toBe(false);
  });

  it('出了更新的版本：忽略的是旧版，照样显示', () => {
    expect(shouldShowUpdateBanner('1.8.2', { checkedAt: 1, notified: '1.9.0', latest: '1.9.1' })).toBe(true);
  });

  it('本机就是最新 / 比线上新 / 版本号缺失：都不显示', () => {
    expect(shouldShowUpdateBanner('1.9.0', { checkedAt: 1, notified: '', latest: '1.9.0' })).toBe(false);
    expect(shouldShowUpdateBanner('1.10.0', { checkedAt: 1, notified: '', latest: '1.9.9' })).toBe(false);
    expect(shouldShowUpdateBanner('', { checkedAt: 1, notified: '', latest: '1.9.0' })).toBe(false);
    expect(shouldShowUpdateBanner('1.8.2', { checkedAt: 0, notified: '', latest: '' })).toBe(false);
  });
});

describe('提示条的文案与出口', () => {
  const html = updateBannerHtml('1.8.2', '1.9.0');

  it('报出两个版本号', () => {
    expect(html).toContain('v1.9.0');
    expect(html).toContain('当前 v1.8.2');
  });

  it('三颗按钮的动作名固定：商店 / GitHub / 忽略', () => {
    expect(html).toContain('data-act="updstore"');
    expect(html).toContain('data-act="updgithub"');
    expect(html).toContain('data-act="updignore"');
  });

  it('前两颗按钮与设置页「插件」组用同一套文案', () => {
    expect(html).toContain('去市场下载');
    expect(html).toContain('去 GitHub 下载');
    expect(html).toContain('忽略这一版');
  });

  it('版本号来自网络：拼进 HTML 前要转义', () => {
    const evil = updateBannerHtml('1.8.2', '<img src=x onerror=alert(1)>');
    expect(evil).not.toContain('<img');
    expect(evil).toContain('&lt;img');
  });

  it('不挂悬停气泡属性（AGENTS.md 硬规则）', () => {
    expect(html).not.toMatch(/aria-label|title=/);
  });
});

describe('忽略这一版', () => {
  it('把这一版记进 notified，查询时间与线上版本不动', () => {
    writeUpdateState({ checkedAt: 123, notified: '', latest: '1.9.0' });
    dismissUpdateBanner();
    expect(readUpdateState()).toEqual({ checkedAt: 123, notified: '1.9.0', latest: '1.9.0' });
  });

  it('忽略之后不再显示，下个新版本恢复', () => {
    writeUpdateState({ checkedAt: 123, notified: '', latest: '1.9.0' });
    dismissUpdateBanner();
    expect(shouldShowUpdateBanner('1.8.2', readUpdateState())).toBe(false);

    writeUpdateState({ checkedAt: 123, notified: '1.9.0', latest: '1.9.1' });
    expect(shouldShowUpdateBanner('1.8.2', readUpdateState())).toBe(true);
  });

  it('还没查到线上版本时点忽略：不写坏数据', () => {
    writeUpdateState({ checkedAt: 0, notified: '', latest: '' });
    dismissUpdateBanner();
    expect(readUpdateState()).toEqual({ checkedAt: 0, notified: '', latest: '' });
  });
});
