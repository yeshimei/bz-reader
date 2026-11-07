import { describe, expect, it } from 'vitest';
import { immersiveExitHint, updateImmersiveHolders } from '../src/view/immersive';

describe('沉浸模式的引用计数（A-27）', () => {
  it('两个持有者：关掉一个，另一个仍然沉浸', () => {
    const holders = new Set<object>();
    const a = {};
    const b = {};

    expect(updateImmersiveHolders(holders, a, true)).toBe(true);
    expect(updateImmersiveHolders(holders, b, true)).toBe(true);

    expect(updateImmersiveHolders(holders, a, false)).toBe(true);
    expect(updateImmersiveHolders(holders, b, false)).toBe(false);
  });

  it('同一个视图重复释放不会把别人的计数减掉', () => {
    const holders = new Set<object>();
    const a = {};
    const b = {};
    updateImmersiveHolders(holders, a, true);
    updateImmersiveHolders(holders, b, true);

    updateImmersiveHolders(holders, a, false);
    updateImmersiveHolders(holders, a, false);
    expect(holders.size).toBe(1);
    expect(updateImmersiveHolders(holders, b, false)).toBe(false);
  });

  it('重复进入同一视图不重复计数', () => {
    const holders = new Set<object>();
    const a = {};
    updateImmersiveHolders(holders, a, true);
    updateImmersiveHolders(holders, a, true);
    expect(holders.size).toBe(1);
    expect(updateImmersiveHolders(holders, a, false)).toBe(false);
  });
});

describe('进入沉浸时的退出提示', () => {
  it('桌面刚进全屏：提示按 ESC', () => {
    expect(immersiveExitHint(false, false, true)).toBe('desktop');
  });

  it('手机刚进全屏：提示双指轻按', () => {
    expect(immersiveExitHint(true, false, true)).toBe('mobile');
  });

  it('退出全屏不提示：按 ESC 和关书都走这条', () => {
    expect(immersiveExitHint(false, true, false)).toBeNull();
    expect(immersiveExitHint(true, true, false)).toBeNull();
  });

  it('重复进入、以及关书时把已经是关的状态再置一次，都不提示', () => {
    expect(immersiveExitHint(false, true, true)).toBeNull();
    expect(immersiveExitHint(true, true, true)).toBeNull();
    expect(immersiveExitHint(false, false, false)).toBeNull();
  });
});
