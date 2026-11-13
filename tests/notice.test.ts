/**
 * 通知句柄（core/notice.ts）。
 *
 * 摘要要跑十几秒：进度条必须常驻到出结果，出结果时必须能被调用方收掉。
 * 以前 notify 只弹不管，进度条只能等默认 3 秒自己消失（看着像没点上），
 * 或者永远留在屏幕上（关不掉）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Notice } from 'obsidian';
import { notify } from '../src/core/notice';

describe('notify 返回句柄', () => {
  beforeEach(() => {
    Notice.instances.length = 0;
  });

  it('hide() 关掉的是刚弹的那一条', () => {
    const handle = notify('进度甲', 'info');
    expect(Notice.instances).toHaveLength(1);
    handle.hide();
    expect(Notice.instances[0].hidden).toBe(true);
  });

  it('timeout 传 0 就是常驻，直到调用方自己关', () => {
    const handle = notify('进度乙', 'info', 0);
    expect(Notice.instances[0].timeout).toBe(0);
    expect(Notice.instances[0].hidden).toBe(false);
    handle.hide();
    expect(Notice.instances[0].hidden).toBe(true);
  });

  it('800ms 内同一句只弹一条，两次返回的句柄都能安全关', () => {
    const first = notify('进度丙', 'info');
    const second = notify('进度丙', 'info');
    expect(Notice.instances).toHaveLength(1);
    first.hide();
    expect(() => second.hide()).not.toThrow();
    expect(Notice.instances[0].hidden).toBe(true);
  });
});
