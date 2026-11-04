import { describe, expect, it } from 'vitest';
import { updateImmersiveHolders } from '../src/view/immersive';

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
