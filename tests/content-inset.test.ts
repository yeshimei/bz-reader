import { describe, expect, it } from 'vitest';
import { contentInset } from '../src/engine/content-inset';

describe('contentInset', () => {
  it('把 iframe 的平移算进正文边缘（真机：分页器把 iframe 右推 13.54）', () => {
    const r = contentInset({
      rootWidth: 390.4,
      frameLeft: 13.54,
      htmlPadLeft: 13.66,
      bodyWidth: 335.75,
      bodyPadLeft: 8,
      bodyPadRight: 8,
    });
    expect(r.left).toBe(35);
    expect(r.right).toBe(35);
  });

  it('iframe 贴左时退化成 padding 相加（滚动模式）', () => {
    const r = contentInset({
      rootWidth: 360,
      frameLeft: 0,
      htmlPadLeft: 0,
      bodyWidth: 360,
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
      htmlPadLeft: 0,
      bodyWidth: 300,
      bodyPadLeft: 0,
      bodyPadRight: 0,
    });
    expect(r.right).toBe(0);
  });
});
