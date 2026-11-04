import { describe, expect, it, vi } from 'vitest';
import { destroyQuietly } from '../src/core/safe-destroy';

describe('销毁失败不阻断后续清理（A-28 / A-29）', () => {
  it('destroy 正常时等它完成', async () => {
    const order: string[] = [];
    await destroyQuietly({
      destroy: async () => {
        order.push('destroy');
      },
    });
    order.push('after');
    expect(order).toEqual(['destroy', 'after']);
  });

  it('destroy reject 也 resolve，调用方继续跑 settle', async () => {
    const destroy = vi.fn(async () => {
      throw new Error('iframe 已经没了');
    });
    await expect(destroyQuietly({ destroy })).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('没有引擎时是空操作', async () => {
    await expect(destroyQuietly(null)).resolves.toBeUndefined();
    await expect(destroyQuietly(undefined)).resolves.toBeUndefined();
  });
});
