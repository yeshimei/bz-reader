import { describe, expect, it } from 'vitest';
import { ClipOwnerRegistry } from '../src/view/clip-owner';

/**
 * 同一本剪藏本开两个视图（把 tab 拖到新窗口 / 分屏）时，只能有一个计时器。
 * 真机：两边 clipClock.pending 同时 +15，关书后同一章秒数被加两遍。
 */
describe('ClipOwnerRegistry', () => {
  it('第二个视图接管，第一个被通知让位', () => {
    const reg = new ClipOwnerRegistry<string>();
    expect(reg.claim('clipbook', 'A')).toBeNull();
    expect(reg.claim('clipbook', 'B')).toBe('A');
    expect(reg.ownerOf('clipbook')).toBe('B');
  });

  it('同一个视图重复认领不算被抢', () => {
    const reg = new ClipOwnerRegistry<string>();
    reg.claim('clipbook', 'A');
    expect(reg.claim('clipbook', 'A')).toBeNull();
  });

  it('释放只对当前主人生效', () => {
    const reg = new ClipOwnerRegistry<string>();
    reg.claim('clipbook', 'A');
    reg.claim('clipbook', 'B');
    reg.release('clipbook', 'A');
    expect(reg.ownerOf('clipbook')).toBe('B');
    reg.release('clipbook', 'B');
    expect(reg.ownerOf('clipbook')).toBeNull();
  });

  it('不同书互不影响', () => {
    const reg = new ClipOwnerRegistry<string>();
    reg.claim('a', 'A');
    expect(reg.claim('b', 'B')).toBeNull();
    expect(reg.ownerOf('a')).toBe('A');
  });
});
