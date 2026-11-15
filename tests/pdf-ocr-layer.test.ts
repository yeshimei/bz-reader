/* ============================================================
 * 扫描页透明文字层的摆放（tests/pdf-ocr-layer.test.ts）
 *
 * 这里守的是「识别框和画面上的字必须是同一个基准」：
 *  · 基准尺寸取页面框（文字层容器）自己的宽高，外部算出来的页面尺寸只兜底；
 *  · 每行字要按真实排版宽度拉伸到识别框宽，不然行尾几个字永远落在框外；
 *  · 旋转页与未旋转页走同一套换算。
 *
 * 回归背景：旧实现拿 span.scrollWidth 当「文字自然宽」，但绝对定位且已经
 * 写死 width 的 span，scrollWidth 就是框宽本身，于是拉伸比例永远是 1。
 * ============================================================ */
import { afterAll, describe, expect, it } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import {
  lineScaleX,
  ocrLayerBox,
  ocrLinePlacement,
  paintOcrTextLayer,
  type OcrLayerBox,
} from '../src/engine/pdf/ocr-layer';
import type { OcrPage } from '../src/engine/pdf/ocr';

const uninstall = installDomStub();
afterAll(() => uninstall());

const RECT = { left: 0.1, top: 0.2, width: 0.3, height: 0.05 };

function pageOf(rect = RECT): OcrPage {
  return {
    engine: 'http',
    model: 'http',
    at: 1,
    layout: true,
    lines: [{ text: '第一行', rect }, { text: '第二行', rect: { ...rect, top: rect.top + 0.08 } }],
  };
}

/** 只实现 paintOcrTextLayer 用到的那几个 DOM 方法 */
function fakeLayer(clientWidth: number, clientHeight: number, natural: number) {
  type Span = {
    className: string;
    textContent: string;
    style: Record<string, string>;
    getBoundingClientRect(): { width: number };
    offsetWidth: number;
  };
  const spans: Span[] = [];
  const doc = (globalThis as unknown as { document: Record<string, unknown> }).document;
  doc.createElement = () => {
    const span: Span = {
      className: '',
      textContent: '',
      style: {},
      getBoundingClientRect: () => ({ width: natural }),
      offsetWidth: natural,
    };
    spans.push(span);
    return span;
  };
  doc.createDocumentFragment = () => ({ appendChild: () => undefined });
  const container = {
    clientWidth,
    clientHeight,
    replaceChildren: () => {
      spans.length = 0;
    },
    appendChild: () => undefined,
    querySelectorAll: () => spans,
  };
  return { container, spans };
}

function paint(container: unknown, box: OcrLayerBox, rotation = 0, ocr = pageOf()) {
  paintOcrTextLayer(container as HTMLElement, ocr, box, rotation);
}

describe('文字层的基准尺寸', () => {
  it('优先用容器自己的宽高，外部传进来的页面尺寸不参与计算', () => {
    expect(ocrLayerBox({ clientWidth: 900, clientHeight: 1300 } as HTMLElement, { width: 700, height: 1000 })).toEqual({
      width: 900,
      height: 1300,
    });
  });

  it('容器还没上屏（量不到）才退回外部尺寸', () => {
    expect(ocrLayerBox({ clientWidth: 0, clientHeight: 0 } as HTMLElement, { width: 700, height: 1000 })).toEqual({
      width: 700,
      height: 1000,
    });
  });

  it('两边都量不到时也不许除出 0 或负数', () => {
    expect(ocrLayerBox(null, { width: 0, height: -1 })).toEqual({ width: 1, height: 1 });
  });
});

describe('一行的像素位置', () => {
  it('按基准尺寸换算，缩放后比例不变', () => {
    const a = ocrLinePlacement(RECT, 0, { width: 700, height: 1000 });
    const b = ocrLinePlacement(RECT, 0, { width: 1400, height: 2000 });
    expect(a).toEqual({ left: 70, top: 200, width: 210, height: 50 });
    expect(b).toEqual({ left: 140, top: 400, width: 420, height: 100 });
  });

  it('旋转 90 度按旋转后的基准换算', () => {
    expect(ocrLinePlacement(RECT, 90, { width: 1000, height: 700 })).toEqual({ left: 750, top: 70, width: 50, height: 210 });
  });
});

describe('行内拉伸', () => {
  it('字排得比识别框窄就拉伸，比框宽就压缩', () => {
    expect(lineScaleX(440, 474)).toBeCloseTo(474 / 440, 6);
    expect(lineScaleX(600, 474)).toBeCloseTo(474 / 600, 6);
  });

  it('量不到自然宽或框宽时不拉伸（宁可不拉，也别把字拉飞）', () => {
    expect(lineScaleX(0, 474)).toBe(1);
    expect(lineScaleX(440, 0)).toBe(1);
    expect(lineScaleX(Number.NaN, 474)).toBe(1);
    expect(lineScaleX(440, Number.NaN)).toBe(1);
  });
});

describe('铺进容器', () => {
  it('位置按容器尺寸摆，不按外部传进来的尺寸', () => {
    const { container, spans } = fakeLayer(900, 1300, 440);
    paint(container, { width: 700, height: 1000 });
    expect(spans).toHaveLength(2);
    expect(spans[0]!.style.left).toBe('90px');
    expect(spans[0]!.style.top).toBe('260px');
    expect(spans[0]!.style.width).toBe(`${RECT.width * 900}px`);
    expect(spans[0]!.style.height).toBe(`${RECT.height * 1300}px`);
    expect(spans[0]!.style.fontSize).toBe(`${RECT.height * 1300}px`);
  });

  it('容器量不到时退回外部尺寸', () => {
    const { container, spans } = fakeLayer(0, 0, 440);
    paint(container, { width: 700, height: 1000 });
    expect(spans[0]!.style.left).toBe('70px');
    expect(spans[0]!.style.top).toBe('200px');
  });

  it('拉伸按真实排版宽算，写完把框宽放回去', () => {
    const { container, spans } = fakeLayer(900, 1300, 200);
    paint(container, { width: 900, height: 1300 });
    const target = RECT.width * 900;
    expect(spans[0]!.style.width).toBe(`${target}px`);
    expect(spans[0]!.style.transform).toBe(`scaleX(${target / 200})`);
    expect(spans[1]!.style.transform).toBe(`scaleX(${target / 200})`);
  });

  it('自然宽与框宽一致时不写 transform', () => {
    const { container, spans } = fakeLayer(900, 1300, RECT.width * 900);
    paint(container, { width: 900, height: 1300 });
    expect(spans[0]!.style.transform).toBeUndefined();
  });

  it('旋转 90 度时位置按转后的矩形摆', () => {
    const { container, spans } = fakeLayer(900, 1300, 440);
    paint(container, { width: 900, height: 1300 }, 90);
    /* 0.1/0.2/0.3/0.05 → 左 0.75、上 0.1、宽 0.05、高 0.3 */
    expect(spans[0]!.style.left).toBe('675px');
    expect(spans[0]!.style.top).toBe('130px');
    expect(spans[0]!.style.width).toBe('45px');
    expect(spans[0]!.style.height).toBe('390px');
  });
});
