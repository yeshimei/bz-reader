import { describe, expect, it } from 'vitest';
import { contentInset } from '../src/engine/content-inset';

/** 真机手机（390×844 DPR3，app.emulateMobile）量到的一组数 */
const PHONE = {
  rootWidth: 390.4,
  pageWidth: 363.075,
  htmlPadLeft: 13.66,
  htmlPadRight: 13.66,
  bodyPadLeft: 8,
  bodyPadRight: 8,
};

/** 桌面双栏（1420 宽阅读区、两栏 + 列间距 = 1320.6 一整页） */
const DESKTOP = {
  rootWidth: 1420,
  pageWidth: 1320.6,
  htmlPadLeft: 49.7,
  htmlPadRight: 49.7,
  bodyPadLeft: 32,
  bodyPadRight: 32,
};

describe('contentInset', () => {
  it('手机第一页：iframe 被右推 13.54，两角要补上这一截', () => {
    const r = contentInset({ ...PHONE, frameLeft: 13.54 });
    expect(r.left).toBe(35);
    expect(r.right).toBe(35);
  });

  it('手机翻到第 52 页：iframe 平移成 -18503，余数仍是 13.5', () => {
    const r = contentInset({ ...PHONE, frameLeft: -18503.26 });
    expect(r.left).toBe(35);
    expect(r.right).toBe(35);
  });

  it('桌面双栏：页码落在右栏外沿，不是屏幕中间', () => {
    const r = contentInset({ ...DESKTOP, frameLeft: -3912.1 });
    expect(r.left).toBe(131);
    expect(r.right).toBe(131);
  });

  it('翻到第 93 页也一样（平移是整页步长，余数不变）', () => {
    const a = contentInset({ ...PHONE, frameLeft: -33000.5 });
    const b = contentInset({ ...PHONE, frameLeft: -33000.5 - 363.075 * 7 });
    expect(a).toEqual(b);
  });

  it('拿不到页宽（滚动模式）时退化成 padding 相加', () => {
    const r = contentInset({
      rootWidth: 360,
      frameLeft: 0,
      pageWidth: 0,
      htmlPadLeft: 0,
      htmlPadRight: 0,
      bodyPadLeft: 24,
      bodyPadRight: 24,
    });
    expect(r.left).toBe(24);
    expect(r.right).toBe(24);
  });

  it('正文比阅读区还宽时不返回负数', () => {
    const r = contentInset({
      rootWidth: 100,
      frameLeft: 0,
      pageWidth: 0,
      htmlPadLeft: 0,
      htmlPadRight: 0,
      bodyPadLeft: 0,
      bodyPadRight: 0,
    });
    expect(r.right).toBe(0);
  });
});
