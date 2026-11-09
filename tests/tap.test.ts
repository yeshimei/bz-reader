import { describe, expect, it } from 'vitest';
import { TAP_LONG_PRESS_MS, TAP_SLOP_PX, isTap } from '../src/core/tap';

/**
 * 「这一下算不算点按」（2026-11-09 发版复核）。
 *
 * 位移与时长两个阈值以前散在三处：分类菜单 10px / 600ms、书卡长按 520ms、
 * 菜单弹出后压 click 600ms。收口之后这里钉住边界，调用点只传坐标与时间。
 */

const at = (x: number, y: number, t = 1000) => ({ x, y, at: t });

describe('点按判定', () => {
  it('原地按下抬起算点按', () => {
    expect(isTap(at(10, 10), at(10, 10, 1020))).toBe(true);
  });

  it('位移到阈值就算拖动（边界不含）', () => {
    expect(isTap(at(10, 10), at(10 + TAP_SLOP_PX - 0.1, 10, 1020))).toBe(true);
    expect(isTap(at(10, 10), at(10 + TAP_SLOP_PX, 10, 1020))).toBe(false);
    expect(isTap(at(10, 10), at(10, 10 - TAP_SLOP_PX, 1020))).toBe(false);
  });

  it('按住到长按时长就不算点按（边界含）', () => {
    expect(isTap(at(0, 0), at(0, 0, 1000 + TAP_LONG_PRESS_MS - 1))).toBe(true);
    expect(isTap(at(0, 0), at(0, 0, 1000 + TAP_LONG_PRESS_MS))).toBe(false);
  });

  it('阈值可覆盖：不同场景要不同松紧', () => {
    expect(isTap(at(0, 0), at(0, 30, 1000), { maxDistance: 40 })).toBe(true);
    expect(isTap(at(0, 0, 1000), at(0, 0, 1700), { maxMs: 800 })).toBe(true);
    expect(isTap(at(0, 0, 1000), at(0, 0, 1700))).toBe(false);
  });

  it('脏数据一律不算：少一个坐标 / NaN / 时间倒流', () => {
    expect(isTap(at(NaN, 0), at(0, 0, 1010))).toBe(false);
    expect(isTap(at(0, 0), at(0, 0, 900))).toBe(true); // 时钟回拨不被误判成拖动
    expect(isTap({ x: 0, y: 0, at: 1000 }, { x: 0, y: 0, at: NaN })).toBe(false);
  });
});
