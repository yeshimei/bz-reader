import { describe, expect, it } from 'vitest';
import {
  needsGestureBind,
  pickGestureDoc,
  zoneFromFrameY,
} from '../src/engine/gesture-binding';

/* 手势监听挂在哪份文档、点按落在哪个区。
   这两条以前都是内联在 host 里的一次性判断，iPhone 上「点按和划词一起失效」
   正是第一条判错造成的，所以单独抽出来钉住。 */

describe('pickGestureDoc', () => {
  it('渲染器还没就绪时没有文档可挂', () => {
    expect(pickGestureDoc(null)).toBeNull();
    expect(pickGestureDoc(undefined)).toBeNull();
    expect(pickGestureDoc([])).toBeNull();
  });

  it('取当前可见的那份文档', () => {
    const doc = {} as Document;
    expect(pickGestureDoc([{ doc }])).toBe(doc);
  });

  it('多栏布局只挂第一份（每个 host 只管自己那一栏）', () => {
    const left = {} as Document;
    const right = {} as Document;
    expect(pickGestureDoc([{ doc: left }, { doc: right }])).toBe(left);
  });

  it('doc 为空不抛错，也不返回别的东西', () => {
    expect(pickGestureDoc([{ doc: null }])).toBeNull();
    expect(pickGestureDoc([{}])).toBeNull();
  });
});

describe('needsGestureBind', () => {
  it('同一份文档不重复挂（relocate 会频繁来）', () => {
    const doc = {} as Document;
    expect(needsGestureBind(doc, doc)).toBe(false);
  });

  it('换了文档要重挂', () => {
    const a = {} as Document;
    const b = {} as Document;
    expect(needsGestureBind(a, b)).toBe(true);
    expect(needsGestureBind(null, b)).toBe(true);
  });

  it('拿不到文档时什么都不做', () => {
    expect(needsGestureBind(null, null)).toBe(false);
    expect(needsGestureBind({} as Document, null)).toBe(false);
  });
});

describe('zoneFromFrameY', () => {
  /* 分区用**正文自己的高度**，不绕到屏幕坐标再减回去：
     iOS 上 iframe 的 screenY 与宿主窗口对不上，绕这一圈会把上下判反。 */
  it('上 40% 是上一页，下 60% 是下一页', () => {
    expect(zoneFromFrameY(0, 1000)).toBe('prev');
    expect(zoneFromFrameY(399, 1000)).toBe('prev');
    expect(zoneFromFrameY(400, 1000)).toBe('next');
    expect(zoneFromFrameY(999, 1000)).toBe('next');
  });

  it('量不到高度时按下一页处理（宁可前进，不留在一个点不动的页面）', () => {
    expect(zoneFromFrameY(120, 0)).toBe('next');
    expect(zoneFromFrameY(120, Number.NaN)).toBe('next');
    expect(zoneFromFrameY(Number.NaN, 1000)).toBe('next');
  });

  it('坐标跑到界外也落在两区之一，不会算出第三种结果', () => {
    expect(zoneFromFrameY(-50, 1000)).toBe('prev');
    expect(zoneFromFrameY(5000, 1000)).toBe('next');
  });
});
