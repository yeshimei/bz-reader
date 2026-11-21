/**
 * 没装 / 没启用 bz Review 时的引导（shell/review-require.ts）
 *
 * 三处入口（书右键、工具条单条、划选）都从这里取门面。以前只弹一句
 * 「还没装」；2026-11-21 起统一打开设置页的插件组，用户点两下就能装好。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const notifySpy = vi.hoisted(() => vi.fn());
vi.mock('../src/core/notice', () => ({ notify: notifySpy }));

const openStudySpy = vi.hoisted(() => vi.fn());
vi.mock('../src/shell/source', () => ({
  getShellSource: () => ({ openStudy: openStudySpy }),
}));

import { requireReviewFlow } from '../src/shell/review-require';
import { takeSettingsFocus } from '../src/shell/settings-focus';

const appWith = (plugins: {
  plugins?: Record<string, unknown>;
  manifests?: Record<string, unknown>;
  enabledPlugins?: Set<string>;
}) => ({ plugins: { plugins: {}, manifests: {}, enabledPlugins: new Set(), ...plugins } }) as any;

describe('requireReviewFlow · 未安装 / 未启用', () => {
  beforeEach(() => {
    notifySpy.mockClear();
    openStudySpy.mockClear();
    takeSettingsFocus();
  });

  it('未安装：提示一句并打开设置页插件组', () => {
    expect(requireReviewFlow(appWith({}), 'card')).toBeNull();
    expect(openStudySpy).toHaveBeenCalledWith('settings');
    /* 设置页渲染后会滚到这一组：请求已经排在 pending 里 */
    expect(takeSettingsFocus()).toBe('plugins');
    expect(notifySpy).toHaveBeenCalled();
  });

  it('已安装未启用：同样去设置页，不逼用户重新下载', () => {
    const app = appWith({ manifests: { 'bz-review': { id: 'bz-review' } } });
    expect(requireReviewFlow(app, 'card')).toBeNull();
    expect(openStudySpy).toHaveBeenCalledWith('settings');
    expect(takeSettingsFocus()).toBe('plugins');
  });

  it('已启用但契约太老：只提示更新，不把用户拽去设置页', () => {
    const api = { version: 4, addCards: async () => ({ added: 1, exists: 0, notFound: 0 }) };
    const app = appWith({ plugins: { 'bz-review': { reviewApi: api } } });
    expect(requireReviewFlow(app, 'card')).toBeNull();
    expect(openStudySpy).not.toHaveBeenCalled();
    expect(takeSettingsFocus()).toBeNull();
    expect(notifySpy).toHaveBeenCalled();
  });

  it('门面齐全：原样返回，不提示、不跳页', () => {
    const api = {
      version: 6,
      addCards: async () => ({ added: 1, exists: 0, notFound: 0 }),
      openCardFlow: () => undefined,
    };
    const app = appWith({ plugins: { 'bz-review': { reviewApi: api } } });
    expect(requireReviewFlow(app, 'card')).toBe(api);
    expect(openStudySpy).not.toHaveBeenCalled();
    expect(takeSettingsFocus()).toBeNull();
    expect(notifySpy).not.toHaveBeenCalled();
  });
});
