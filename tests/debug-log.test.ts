import { afterEach, describe, expect, it } from 'vitest';
import {
  debugEnabled,
  debugEvent,
  debugSnapshot,
  flushDebugLog,
  installDebugHook,
  setDebugMeta,
  startDebugLog,
  stopDebugLog,
  type DebugDump,
} from '../src/data/debug-log';

/* 调试日志（排查「划词时页面跳到固定位置」用）的行为边界。
 *
 * 这个模块要长期留在正式包里，但默认关、关着时一个字节都不写。
 * 这里钉四件事：默认关、开启后能落盘、容量有限、关闭即清空。 */

afterEach(() => {
  stopDebugLog();
});

function collector(): { texts: string[]; write: (t: string) => void } {
  const texts: string[] = [];
  return { texts, write: (t) => texts.push(t) };
}

const META = { app: 'bz-reader 0.3.3', platform: 'android' };

describe('debug-log', () => {
  it('默认关闭：不记录，也不写盘', () => {
    const c = collector();
    expect(debugEnabled()).toBe(false);
    debugEvent('tap', { zone: 'prev' });
    flushDebugLog();
    expect(c.texts).toHaveLength(0);
    expect(debugSnapshot().events).toHaveLength(0);
  });

  it('开启后记录事件，flush 写出可读 JSON', () => {
    const c = collector();
    startDebugLog(c.write, META);
    debugEvent('touch', { phase: 'start', x: 120, y: 640 });
    debugEvent('relocate', { index: 3, fraction: 0.21 });
    flushDebugLog();

    expect(debugEnabled()).toBe(true);
    expect(c.texts.length).toBeGreaterThan(0);
    const dump = JSON.parse(c.texts[c.texts.length - 1]) as DebugDump;
    expect(dump.version).toBe(1);
    expect(dump.platform).toBe('android');
    expect(dump.events.map((e) => e.k)).toEqual(['touch', 'relocate']);
    expect(dump.events[0]?.d?.x).toBe(120);
    /* t 是相对开启时刻的毫秒数，不该是 1970 那一串 */
    expect(dump.events[0]?.t).toBeGreaterThanOrEqual(0);
    expect(dump.events[0]?.t).toBeLessThan(60_000);
  });

  it('只留最近 400 条', () => {
    const c = collector();
    startDebugLog(c.write, META);
    for (let i = 0; i < 450; i += 1) debugEvent('n', { i });
    const events = debugSnapshot().events;
    expect(events).toHaveLength(400);
    expect(events[0]?.d?.i).toBe(50);
    expect(events[399]?.d?.i).toBe(449);
  });

  it('长字符串截断，不把整章正文写进文件', () => {
    const c = collector();
    startDebugLog(c.write, META);
    debugEvent('sel', { text: 'x'.repeat(500) });
    const text = debugSnapshot().events[0]?.d?.text;
    expect(typeof text).toBe('string');
    expect((text as string).length).toBeLessThanOrEqual(81);
  });

  it('关闭后不再记录，也不留着上一轮的事件', () => {
    const c = collector();
    startDebugLog(c.write, META);
    debugEvent('a');
    stopDebugLog();
    expect(debugEnabled()).toBe(false);
    expect(debugSnapshot().events).toHaveLength(0);
    debugEvent('b');
    expect(debugSnapshot().events).toHaveLength(0);
  });

  it('meta 可更新，vendor 的全局入口直通记录', () => {
    const c = collector();
    startDebugLog(c.write, META);
    setDebugMeta({ book: '围城' });
    installDebugHook();
    const hook = (globalThis as unknown as { __bzrDbg?: (k: string, d?: Record<string, string>) => void }).__bzrDbg;
    expect(typeof hook).toBe('function');
    hook?.('focusin', { tag: 'A' });
    expect(debugSnapshot().book).toBe('围城');
    expect(debugSnapshot().events[0]?.k).toBe('focusin');
  });
});
