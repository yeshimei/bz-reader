import { describe, expect, it } from 'vitest';
import { lineInSpan, overlapsSpan, visibleSpan } from '../src/engine/visible-span';

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

describe('lineInSpan', () => {
  /* 朗读高亮画的是一行一行的矩形，不是段落外接框：一句话在屏外时
     `getClientRects()` 仍然会给出整章布局坐标，不裁就会把框画到看不见的
     地方，上层还会据此以为「这句在眼前」，自动翻页永远不触发 */
  const span = { x0: 1530, x1: 2554 };

  it('落在当前页的那一行要画', () => {
    expect(lineInSpan({ left: 1600, right: 2200 }, span)).toBe(true);
  });

  it('上一页的行不画', () => {
    expect(lineInSpan({ left: 32, right: 1233 }, span)).toBe(false);
  });

  it('下一页的行不画', () => {
    expect(lineInSpan({ left: 2600, right: 3200 }, span)).toBe(false);
  });

  it('跨页的那一行只要压到当前页就画（后半个字还在屏上）', () => {
    expect(lineInSpan({ left: 2400, right: 2700 }, span)).toBe(true);
  });

  it('右边缘正好等于页起点时不画', () => {
    expect(lineInSpan({ left: 1200, right: 1530 }, span)).toBe(false);
  });

  it('左边缘正好等于页终点时不画', () => {
    expect(lineInSpan({ left: 2554, right: 2700 }, span)).toBe(false);
  });

  it('没有可见区间（拿不到 iframe 位置）时一律照画，别把高亮吞掉', () => {
    expect(lineInSpan({ left: 32, right: 1233 }, null)).toBe(true);
  });
});
