import { afterEach, describe, expect, it } from 'vitest';
import { can, entitlement, setEntBackend, setLicense, setProBuild } from '../src/data/entitlement';
import { devTierForced, forceBaseTier, initDevTier } from '../src/core/dev-tier';

/**
 * 测试库专用：强制基础版。
 *
 * 需求是「命令面板只留一条切换为基础版的命令」——**切到高级版与恢复真实
 * 授权都删掉**。所以这层只认一个方向：把界面压到基础版，没有反向入口。
 * 覆盖不碰 data.json 里的真实激活码；这段逻辑只在开发构建（__BZ_DEV__）里
 * 生效，发布包整块摇掉。
 */

let savedTier: unknown = null;
let ent: Record<string, unknown> = {};

function emptyEnt(): Record<string, unknown> {
  return {
    installId: 'test',
    activeDays: [],
    lastSeenTs: 0,
    clockAnomaly: 0,
    trialVoid: false,
    license: '',
    checkedTs: 0,
  };
}

function wire(persisted: unknown = null): void {
  savedTier = persisted;
  ent = emptyEnt();
  initDevTier({
    read: () => savedTier,
    write: (raw) => {
      savedTier = raw;
    },
  });
  setEntBackend({
    read: () => ent,
    write: (raw) => {
      ent = raw as Record<string, unknown>;
    },
  });
  setProBuild(true);
}

/**
 * 造一枚「已验签」的高级版码。
 *
 * `setLicense` 是验签通过之后才走的写入点，它直接置 verifyState = ok；
 * 判定档位只需要能拆出 payload，所以不必动发行私钥。
 */
function paidCode(): string {
  const payload = Buffer.from(
    JSON.stringify({ v: 2, id: 'BZR-TEST-0001', plan: 'lifetime' }),
  ).toString('base64url');
  return `BZR2.${payload}.sig`;
}

function makePaid(): void {
  setLicense(paidCode());
  expect(entitlement().tier).toBe('paid');
}

afterEach(() => {
  initDevTier(null);
  setEntBackend(null);
  setProBuild(false);
});

describe('测试库 · 只能切到基础版', () => {
  it('没启用时完全不干预：真实判定是什么就是什么', () => {
    wire();
    makePaid();
    expect(devTierForced()).toBe(false);
    expect(entitlement().tier).toBe('paid');
  });

  it('强制基础版：真实码是高级版也压成 free，can() 立刻收紧', () => {
    wire();
    makePaid();
    expect(forceBaseTier()).toBe(true);
    expect(devTierForced()).toBe(true);
    expect(entitlement().tier).toBe('free');
    expect(entitlement().unlocked).toBe(false);
    expect(can('ai')).toBe(false);
  });

  it('单向：没有切回高级版的入口，重复调用只会说「已经是基础版」', () => {
    wire();
    makePaid();
    forceBaseTier();
    expect(forceBaseTier()).toBe(false);
    expect(entitlement().tier).toBe('free');
    expect(savedTier).toBe('free');
  });

  it('真实激活码没被动过：只覆盖界面判定，码还躺在配置里', () => {
    wire();
    makePaid();
    const code = ent.license;
    forceBaseTier();
    expect(ent.license).toBe(code);
  });

  it('重启后接着生效：持久化只写 free', () => {
    wire();
    makePaid();
    forceBaseTier();
    expect(savedTier).toBe('free');
    initDevTier({ read: () => savedTier, write: () => {} });
    expect(devTierForced()).toBe(true);
    expect(entitlement().tier).toBe('free');
  });

  it('旧版本留下的 paid 覆盖不再生效（切高级版已删）', () => {
    wire('paid');
    makePaid();
    expect(devTierForced()).toBe(false);
    expect(entitlement().tier).toBe('paid');
  });

  it('坏数据当没设置', () => {
    wire('trial');
    expect(devTierForced()).toBe(false);
  });

  it('没初始化时强制不了：正式构建里这条路径根本不存在', () => {
    initDevTier(null);
    setProBuild(true);
    expect(forceBaseTier()).toBe(false);
    expect(devTierForced()).toBe(false);
  });
});
