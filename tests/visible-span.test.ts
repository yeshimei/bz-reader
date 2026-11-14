import { describe, expect, it } from 'vitest';
import { overlapsSpan, visibleSpan } from '../src/engine/visible-span';

/** 阅读区：桌面侧栏 344px + 正文 680px（真机 1024 宽窗口） */
const HOST = { left: 344, width: 680 };

describe('visibleSpan', () => {
  it('分栏平移后，可见区间是 iframe 内容坐标里落在阅读区的那一段', () => {
    /* 真机（围城）：iframe 被 translateX(-21767px)，宽 38577 */
    expect(visibleSpan({ left: -21767, width: 38577 }, HOST)).toEqual({ x0: 22111, x1: 22791 });
  });

  it('iframe 整块被推到阅读区左边之外，什么都不念', () => {
    expect(visibleSpan({ left: -40000, width: 38577 }, HOST)).toBeNull();
  });

  it('iframe 整块在阅读区右边之外，也返回 null', () => {
    expect(visibleSpan({ left: 2000, width: 800 }, HOST)).toBeNull();
  });

  it('没有平移（滚动模式）时可见区间就是整个 iframe', () => {
    expect(visibleSpan({ left: 344, width: 680 }, HOST)).toEqual({ x0: 0, x1: 680 });
  });

  it('iframe 比阅读区窄（单栏），区间到 iframe 右边缘为止', () => {
    expect(visibleSpan({ left: 400, width: 600 }, HOST)).toEqual({ x0: 0, x1: 600 });
  });
});

describe('overlapsSpan', () => {
  const span = { x0: 1530, x1: 2554 };

  it('横跨两页的长段落，只要压到当前页就算这一页的', () => {
    expect(overlapsSpan({ left: 664, right: 1865, top: 0, bottom: 586 }, span, 626)).toBe(true);
  });

  it('整段都在左边（上一页）时不算', () => {
    expect(overlapsSpan({ left: 32, right: 1233, top: 0, bottom: 586 }, span, 626)).toBe(false);
  });

  it('纵向完全在视口下方时不算', () => {
    expect(overlapsSpan({ left: 1600, right: 2200, top: 700, bottom: 800 }, span, 626)).toBe(false);
  });

  it('纵向完全在视口上方时不算', () => {
    expect(overlapsSpan({ left: 1600, right: 2200, top: -300, bottom: -10 }, span, 626)).toBe(false);
  });

  it('刚好压在边界上（右边缘等于区间起点）不算', () => {
    expect(overlapsSpan({ left: 300, right: 1530, top: 0, bottom: 586 }, span, 626)).toBe(false);
  });
});

/* lineInSpan 已删（2026-11-14）：高亮不再逐行裁矩形，「在不在眼前」
   改由 tts-anchor.test.ts 的 anyRectInView 覆盖。 */
