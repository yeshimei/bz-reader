import { afterEach, describe, expect, it } from 'vitest';
import {
  can,
  clearLicense,
  entitlement,
  setEntBackend,
  setLicense,
  setProBuild,
} from '../src/data/entitlement';
import { forceBaseTier, initDevTier } from '../src/core/dev-tier';

/**
 * 测试库专用：一个命令真正退回基础版。
 *
 * 2026-11-12 修：这条命令以前只把 entitlement() 的结论压成 free，激活码
 * 还躺在 data.json 里；于是「切完之后再填一枚高级版码」也永远停在基础版
 * ——覆盖没人解，用户还以为码坏了。现在改成**真降级**：清掉激活码本身。
 * 基础版就是基础版，重新填码立刻回到高级版（下面那条回归断言锁死）。
 */

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

function wire(): void {
  ent = emptyEnt();
  setEntBackend({
    read: () => ent,
    write: (raw) => {
      ent = raw as Record<string, unknown>;
    },
  });
  setProBuild(true);
  initDevTier({ dropLicense: clearLicense });
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

describe('测试库 · 切换为基础版是真的降级', () => {
  it('切换 = 清掉激活码本身，不只压界面', () => {
    wire();
    makePaid();
    expect(forceBaseTier()).toBe(true);
    expect(ent.license).toBe('');
    expect(ent.checkedTs).toBe(0);
    expect(entitlement().license).toBe('');
    expect(entitlement().tier).toBe('free');
    expect(entitlement().unlocked).toBe(false);
    expect(can('ai')).toBe(false);
  });

  it('切完之后再填一枚合法码，立刻回到高级版（回归）', () => {
    wire();
    makePaid();
    forceBaseTier();
    expect(entitlement().tier).toBe('free');

    /* 等价于「设置页 / 解锁层重新输入激活码并验签通过」 */
    setLicense(paidCode());
    expect(entitlement().tier).toBe('paid');
    expect(entitlement().unlocked).toBe(true);
    expect(can('ai')).toBe(true);
  });

  it('本来就是基础版：不做事，返回 false（提示「已经是基础版」）', () => {
    wire();
    expect(forceBaseTier()).toBe(false);
    expect(ent.license).toBe('');
  });

  it('没初始化时强制不了：正式构建里这条路径根本不存在', () => {
    initDevTier(null);
    setProBuild(true);
    expect(forceBaseTier()).toBe(false);
  });
});
