import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'obsidian';
import { installDomStub } from './helpers/dom-stub';
import { makeApp, makeReaderView } from './helpers/plugin-harness';
import type { ReaderPrefs } from '../src/data/prefs';

/**
 * 重启后打开书，版式要读**本平台**那一份。
 *
 * 偏好分两个槽存（`prefsDesktop` / `prefsMobile`，见 data/prefs.ts）。旧版本
 * 只有一份全局 `prefs`，升级时留作迁移源。视图当初读的是那个旧槽，
 * 于是：手机上调好的字号、行距、边距都写进了 `prefsMobile`，重启后打开书
 * 却读 `prefs`（只有升级前那一份，或者干脆没有）——版式回到默认，
 * 用户看到的就是「设置没生效」。当场调设置没事，因为那条路直接
 * applyPrefs，只有重开书才暴露，所以特别像「重启之后才坏」。
 */
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

let uninstall: () => void = () => undefined;

beforeEach(() => {
  uninstall = installDomStub();
});

afterEach(() => {
  uninstall();
  Platform.isMobile = false;
  Platform.isDesktop = true;
  Platform.isPhone = false;
});

const prefsOf = (view: unknown): ReaderPrefs => (view as { prefs: ReaderPrefs }).prefs;

describe('重启后打开书：版式读本平台那一份', () => {
  it('手机端读 prefsMobile，不是升级前那份旧 prefs', () => {
    Platform.isMobile = true;
    Platform.isDesktop = false;
    const { view } = makeReaderView(makeApp(), '', {
      prefs: { fontSize: 15, lineHeight: 1.6 },
      prefsMobile: { fontSize: 21, lineHeight: 2.2, margin: 30 },
    });

    expect(prefsOf(view).fontSize).toBe(21);
    expect(prefsOf(view).lineHeight).toBe(2.2);
    expect(prefsOf(view).margin).toBe(30);
  });

  it('桌面端读 prefsDesktop，不会被手机那份覆盖', () => {
    const { view } = makeReaderView(makeApp(), '', {
      prefsDesktop: { fontSize: 17 },
      prefsMobile: { fontSize: 23 },
    });

    expect(prefsOf(view).fontSize).toBe(17);
  });

  it('新槽还空着时回落到旧 prefs（升级第一天的老用户）', () => {
    Platform.isMobile = true;
    const { view } = makeReaderView(makeApp(), '', {
      prefs: { fontSize: 18, margin: 40 },
    });

    expect(prefsOf(view).fontSize).toBe(18);
    expect(prefsOf(view).margin).toBe(40);
  });

  it('一份都没有就是默认值，不炸', () => {
    const { view } = makeReaderView(makeApp());
    expect(prefsOf(view).fontSize).toBeGreaterThan(0);
  });
});
