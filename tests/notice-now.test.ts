/**
 * 「到点就走」的通知（core/notice.ts 的 notifyNow，纯行为）。
 *
 * Obsidian 的 Notice 在鼠标悬停时会暂停倒计时。这条本来是为了让人读完长通知，
 * 但摘要那颗按钮就在右上角，通知弹出来正好盖住鼠标——用户点完手没动，
 * 通知就一直挂着，只有移开鼠标（或点一下）才消失。
 * `notifyNow` 自己再掐一遍表，到点无条件收掉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notice } from 'obsidian';
import { notifyNow } from '../src/core/notice';

describe('notifyNow', () => {
  beforeEach(() => {
    Notice.instances.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('到点自动关，不用管鼠标停在哪', () => {
    notifyNow('摘要已生成', 'success', 3000);
    expect(Notice.instances).toHaveLength(1);
    expect(Notice.instances[0].hidden).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(Notice.instances[0].hidden).toBe(true);
  });

  it('timeout 0 不排计时器：常驻通知由调用方自己收', () => {
    notifyNow('正在生成摘要', 'info', 0);
    vi.advanceTimersByTime(60_000);
    expect(Notice.instances[0].hidden).toBe(false);
  });
});
