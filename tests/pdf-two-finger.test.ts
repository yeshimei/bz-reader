import { describe, expect, it } from 'vitest';
import {
  PDF_TWO_FINGER,
  beginTwoFinger,
  endTwoFinger,
  moveTwoFinger,
} from '../src/engine/pdf/two-finger-tap';

/**
 * PDF 的两指轻按 = 切沉浸。
 *
 * 真机反馈：移动端读 PDF 时两指同时轻按完全没反应，进了沉浸只能关书重开
 * （头栏被藏掉，双指是唯一出口）。
 *
 * 根因是 PDF 自己抄了一份旧判定：要求「所有手指都抬离」才认，可每次抬手
 * 都会把计时状态清掉——第一根抬起时还剩一指，条件不满足且状态被清，
 * 第二根再抬时已经是空的。真人两指不可能同时离屏，于是永远不触发。
 *
 * 这几条用例把「第一根抬起就判定」钉住，顺带钉住位移与时长门槛：EPUB 是
 * 320ms / 10px，PDF 里双指是唯一出口，放宽到 400ms / 12px。
 */

const P = (x: number, y: number) => ({ x, y });
/** 两指相距 60px：正常的两指轻按 */
const TWO = [P(100, 200), P(160, 200)];

describe('两指轻按的起手', () => {
  it('恰好两根手指才开始判', () => {
    expect(beginTwoFinger(TWO, 1000)).not.toBeNull();
  });

  it('单指 / 三指 / 空触摸都不是两指轻按', () => {
    expect(beginTwoFinger([P(1, 2)], 1000)).toBeNull();
    expect(beginTwoFinger([], 1000)).toBeNull();
    expect(beginTwoFinger([P(1, 2), P(3, 4), P(5, 6)], 1000)).toBeNull();
  });
});

describe('抬手指时的判定', () => {
  it('第一根手指先抬起就判定：不再等两根全抬（真机主因）', () => {
    const state = beginTwoFinger(TWO, 1000)!;
    const result = endTwoFinger(state, 1120, 1);
    expect(result.fire).toBe(true);
    /* 判定完就清空：视图侧拿着 null 不再喂事件，第二次抬手不会重复触发 */
    expect(result.state).toBeNull();
  });

  it('两根手指被合成一次抬起（剩 0 根）也算', () => {
    const state = beginTwoFinger(TWO, 1000)!;
    expect(endTwoFinger(state, 1120, 0).fire).toBe(true);
  });

  it('还剩两根：这次是别的多指手势，先不判、状态留着', () => {
    const state = beginTwoFinger(TWO, 1000)!;
    const result = endTwoFinger(state, 1100, 2);
    expect(result.fire).toBe(false);
    expect(result.state).not.toBeNull();
  });

  it('判定过一次之后状态是空的，同一次手势不会触发两遍', () => {
    const first = endTwoFinger(beginTwoFinger(TWO, 1000)!, 1120, 1);
    expect(first.state).toBeNull();
    /* 视图侧此时不会再调用 endTwoFinger；即便调了，传入的也是空状态，
       由调用方按 null 短路——这里只确认判定函数不自己回滚状态 */
    expect(first.fire).toBe(true);
  });
});

describe('时长门槛（PDF 独立放宽到 400ms）', () => {
  it('门槛是 400ms，比 EPUB 的 320ms 宽', () => {
    expect(PDF_TWO_FINGER.maxMs).toBe(400);
  });

  it('正好 400ms 仍算轻按', () => {
    const state = beginTwoFinger(TWO, 1000)!;
    expect(endTwoFinger(state, 1400, 1).fire).toBe(true);
  });

  it('401ms 不算：按住超过门槛是要别的操作', () => {
    const state = beginTwoFinger(TWO, 1000)!;
    expect(endTwoFinger(state, 1401, 1).fire).toBe(false);
  });

  it('超时那次判定完也清空状态，不会拖到下一次手势', () => {
    const result = endTwoFinger(beginTwoFinger(TWO, 1000)!, 1401, 1);
    expect(result.fire).toBe(false);
    expect(result.state).toBeNull();
  });
});

describe('位移门槛（防止把滚动 / 捏合当成轻按）', () => {
  it('两指平行滑走：间距没变，但手指确实动了，不切沉浸', () => {
    const state = beginTwoFinger(TWO, 1000)!;
    const moved = moveTwoFinger(state, [P(100, 260), P(160, 260)]);
    expect(moved).not.toBeNull();
    expect(endTwoFinger(moved!, 1150, 1).fire).toBe(false);
  });

  it('两指捏合：间距变了，不切沉浸', () => {
    const state = beginTwoFinger(TWO, 1000)!;
    const pinched = moveTwoFinger(state, [P(100, 200), P(220, 200)]);
    expect(pinched).not.toBeNull();
    expect(endTwoFinger(pinched!, 1150, 1).fire).toBe(false);
  });

  it('小幅抖动（真机上手指总会抖）：仍算轻按', () => {
    const state = beginTwoFinger(TWO, 1000)!;
    const shaky = moveTwoFinger(state, [P(103, 202), P(162, 198)]);
    expect(endTwoFinger(shaky!, 1150, 1).fire).toBe(true);
  });

  it('恰好 12px 仍算，13px 不算（阈值含边界）', () => {
    const atLimit = moveTwoFinger(beginTwoFinger(TWO, 1000)!, [P(100, 212), P(160, 200)]);
    expect(endTwoFinger(atLimit!, 1150, 1).fire).toBe(true);
    const overLimit = moveTwoFinger(beginTwoFinger(TWO, 1000)!, [P(100, 213), P(160, 200)]);
    expect(endTwoFinger(overLimit!, 1150, 1).fire).toBe(false);
  });

  it('按住时手指换成三根：这次手势作废', () => {
    const state = beginTwoFinger(TWO, 1000)!;
    expect(moveTwoFinger(state, [P(100, 200), P(160, 200), P(220, 300)])).toBeNull();
  });
});
