import { describe, expect, it } from 'vitest';
import { mapFileAnnots } from '../src/engine/pdf/annots';

const box = [0, 0, 600, 800];

describe('PDF 自带标注映射', () => {
  it('高亮取 quadPoints，换算成左上原点的比例', () => {
    const out = mapFileAnnots(
      [
        {
          subtype: 'Highlight',
          quadPoints: [100, 700, 300, 700, 100, 680, 300, 680],
          color: [1, 1, 0],
          contents: '重点',
        },
      ],
      { box },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('highlight');
    expect(out[0]!.color).toBe('#ffff00');
    expect(out[0]!.contents).toBe('重点');
    expect(out[0]!.rects[0]!.left).toBeCloseTo(100 / 600);
    expect(out[0]!.rects[0]!.top).toBeCloseTo(0.125);
    expect(out[0]!.rects[0]!.width).toBeCloseTo(200 / 600);
    expect(out[0]!.rects[0]!.height).toBeCloseTo(20 / 800);
  });

  it('多条 quad（一段跨行的划词）各自成块', () => {
    const out = mapFileAnnots(
      [
        {
          subtype: 'Highlight',
          quadPoints: [
            0, 700, 100, 700, 0, 690, 100, 690,
            0, 680, 100, 680, 0, 670, 100, 670,
          ],
        },
      ],
      { box },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.rects).toHaveLength(2);
  });

  it('便签类只有 rect，但内容要留着（点开能看批注）', () => {
    const out = mapFileAnnots(
      [{ subtype: 'Text', rect: [50, 50, 70, 70], contents: '这里的论证有漏洞', title: 'PC' }],
      { box },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('note');
    expect(out[0]!.contents).toBe('这里的论证有漏洞');
    expect(out[0]!.author).toBe('PC');
    expect(out[0]!.rects[0]!.top).toBeCloseTo(1 - 70 / 800);
  });

  it('下划线 / 删除线 / 波浪线各自保留类型', () => {
    const quad = [100, 700, 300, 700, 100, 690, 300, 690];
    const out = mapFileAnnots(
      [
        { subtype: 'Underline', quadPoints: quad },
        { subtype: 'StrikeOut', quadPoints: quad },
        { subtype: 'Squiggly', quadPoints: quad },
      ],
      { box },
    );
    expect(out.map((a) => a.kind)).toEqual(['underline', 'strike', 'squiggly']);
  });

  it('链接、弹窗、面积过小的、认不出的类型一律丢掉', () => {
    const out = mapFileAnnots(
      [
        { subtype: 'Link', rect: [0, 0, 100, 100] },
        { subtype: 'Popup', rect: [0, 0, 100, 100] },
        { subtype: 'Widget', rect: [0, 0, 100, 100] },
        { subtype: 'Underline', quadPoints: [0, 0, 0.4, 0, 0, 0.4, 0.4, 0.4] },
        { subtype: 'Text' },
        null,
      ],
      { box },
    );
    expect(out).toEqual([]);
  });

  it('pdf.js 4 的颜色是 Uint8ClampedArray，也得认', () => {
    const out = mapFileAnnots(
      [
        {
          subtype: 'Highlight',
          quadPoints: [100, 700, 300, 700, 100, 680, 300, 680],
          color: new Uint8ClampedArray([255, 230, 0]),
        },
        {
          subtype: 'Underline',
          quadPoints: [100, 600, 300, 600, 100, 590, 300, 590],
          color: new Uint8Array([0, 102, 255]),
        },
      ],
      { box },
    );
    expect(out.map((a) => a.color)).toEqual(['#ffe600', '#0066ff']);
  });

  it('pdf.js 4 的批注正文/作者在 contentsObj / titleObj 里', () => {
    const out = mapFileAnnots(
      [
        {
          subtype: 'Highlight',
          quadPoints: [100, 700, 300, 700, 100, 680, 300, 680],
          contentsObj: { str: '这一句被别的阅读器标过', dir: 'ltr' },
          titleObj: { str: '审稿人', dir: 'ltr' },
        },
      ],
      { box },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.contents).toBe('这一句被别的阅读器标过');
    expect(out[0]!.author).toBe('审稿人');
  });

  it('页面转过 90 度时，标注跟着转', () => {
    const out = mapFileAnnots(
      [{ subtype: 'Highlight', quadPoints: [0, 800, 300, 800, 0, 400, 300, 400] }],
      { box, rotation: 90 },
    );
    const rect = out[0]!.rects[0]!;
    /* 左上角的半页，转 90 度后应落在右上角 */
    expect(rect.left).toBeCloseTo(0.5);
    expect(rect.top).toBeCloseTo(0);
    expect(rect.width).toBeCloseTo(0.5);
    expect(rect.height).toBeCloseTo(0.5);
  });
});
