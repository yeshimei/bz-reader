import { afterEach, describe, expect, it } from 'vitest';
import { can, entitlement, setEntBackend, setProBuild } from '../src/data/entitlement';
import { devTierOverride, initDevTier, resetDevTier, setDevTier } from '../src/core/dev-tier';

/**
 * 测试库专用：授权档位覆盖。
 *
 * 需求是「在测试库里一键看基础版 / 高级版界面」，不是造一枚假码——
 * 覆盖只影响 entitlement() 的结论，不动 data.json 里的真实激活码。
 * 这段逻辑只在开发构建（__BZ_DEV__）里生效，发布包整块摇掉。
 */

let saved: unknown = null;

function wire(persisted: unknown = null): void {
  saved = persisted;
  initDevTier({
    read: () => saved,
    write: (raw) => {
      saved = raw;
    },
  });
  setEntBackend({
    read: () => ({
      installId: 'test',
      activeDays: [],
      lastSeenTs: 0,
      clockAnomaly: 0,
      trialVoid: false,
      license: '',
      checkedTs: 0,
    }),
    write: () => {},
  });
  setProBuild(true);
}

afterEach(() => {
  initDevTier(null);
  setEntBackend(null);
  setProBuild(false);
});

describe('测试库档位覆盖', () => {
  it('没启用时完全不干预：基础版还是基础版', () => {
    setEntBackend({ read: () => null, write: () => {} });
    setProBuild(true);
    expect(devTierOverride()).toBeNull();
    expect(entitlement().tier).toBe('free');
  });

  it('切到高级版：tier 与 unlocked 一起变，can() 立刻放行', () => {
    wire();
    setDevTier('paid');
    expect(entitlement().tier).toBe('paid');
    expect(entitlement().unlocked).toBe(true);
    expect(can('ai')).toBe(true);
  });

  it('切回基础版：界面按 free 算，但真实激活码没被动过', () => {
    wire();
    setDevTier('paid');
    setDevTier('free');
    expect(entitlement().tier).toBe('free');
    expect(can('ai')).toBe(false);
  });

  it('重启后能接着用：覆盖值由 data.json 持久化', () => {
    wire();
    setDevTier('paid');
    expect(saved).toBe('paid');
    /* 模拟下次启动：同一份存储重新读一遍 */
    initDevTier({ read: () => saved, write: () => {} });
    expect(entitlement().tier).toBe('paid');
  });

  it('恢复真实授权：清掉覆盖，回到归档里的原始判定', () => {
    wire();
    setDevTier('paid');
    resetDevTier();
    expect(devTierOverride()).toBeNull();
    expect(entitlement().tier).toBe('free');
    expect(saved).toBeNull();
  });

  it('只有 free / paid 是合法覆盖值，坏数据当没设置', () => {
    wire('trial');
    expect(devTierOverride()).toBeNull();
    expect(entitlement().tier).toBe('free');
  });
});
