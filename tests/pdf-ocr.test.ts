import { describe, expect, it } from 'vitest';
import {
  looksScanned,
  normalizeOcrLine,
  ocrLinesToItems,
  ocrPageChars,
  ocrPageEmpty,
  ocrPageText,
  ocrPageTextLayout,
  orderOcrLines,
  parseOcrJson,
  parseOcrValue,
  scanSamplePages,
  type OcrLine,
} from '../src/engine/pdf/ocr';

function line(text: string, left: number, top: number, width = 0.3, height = 0.02): OcrLine {
  return { text, rect: { left, top, width, height } };
}

describe('ocr line 收口径', () => {
  it('文本去首尾空白，换行压成空格', () => {
    const got = normalizeOcrLine({ text: '  Hello \n world  ', box: [0.1, 0.2, 0.3, 0.04] });
    expect(got?.text).toBe('Hello world');
    expect(got?.rect).toEqual({ left: 0.1, top: 0.2, width: 0.3, height: 0.04 });
  });

  it('0..1000 的坐标按千分比收，0..1 原样保留', () => {
    expect(normalizeOcrLine({ text: 'A', box: [100, 200, 300, 40] })?.rect).toEqual({
      left: 0.1,
      top: 0.2,
      width: 0.3,
      height: 0.04,
    });
    expect(normalizeOcrLine({ text: 'A', box: [0.5, 0.6, 0.2, 0.03] })?.rect).toEqual({
      left: 0.5,
      top: 0.6,
      width: 0.2,
      height: 0.03,
    });
  });

  it('负宽高折成正的，越界夹回 0..1', () => {
    const got = normalizeOcrLine({ text: 'A', box: [0.9, 0.95, -0.2, -0.1] });
    expect(got?.rect.left).toBeCloseTo(0.7, 6);
    expect(got?.rect.top).toBeCloseTo(0.85, 6);
    expect(got?.rect.width).toBeCloseTo(0.2, 6);
    expect(got?.rect.height).toBeCloseTo(0.1, 6);
    const out = normalizeOcrLine({ text: 'A', box: [0.9, 0.9, 0.5, 0.5] });
    expect(out?.rect).toEqual({ left: 0.9, top: 0.9, width: 0.1, height: 0.1 });
  });

  it('空文本、零面积的框一律丢掉', () => {
    expect(normalizeOcrLine({ text: '   ', box: [0.1, 0.1, 0.2, 0.02] })).toBeNull();
    expect(normalizeOcrLine({ text: 'A', box: [0.1, 0.1, 0, 0.02] })).toBeNull();
    expect(normalizeOcrLine({ text: 'A', box: [0.1, 0.1] })).toBeNull();
    expect(normalizeOcrLine(null)).toBeNull();
  });

  it('像素坐标没有参照尺寸时拒绝，不猜（猜错会让划线整体错位）', () => {
    expect(normalizeOcrLine({ text: 'A', box: [1200, 300, 800, 40] })).toBeNull();
    const got = normalizeOcrLine({ text: 'A', box: [1200, 300, 800, 40] }, { width: 2400, height: 3200 });
    expect(got?.rect.left).toBeCloseTo(0.5, 6);
    expect(got?.rect.top).toBeCloseTo(0.09375, 6);
    expect(got?.rect.width).toBeCloseTo(1 / 3, 6);
    expect(got?.rect.height).toBeCloseTo(0.0125, 6);
  });

  /* 2026-11-16：外部服务同时认 0..1000 千分比与像素。坐标明显超出图宽高
     （像素不可能超那么多）时按千分比收，不再整页贴左上。 */
  it('坐标超出图宽高：按千分比收，不按像素除', () => {
    const got = normalizeOcrLine({ text: 'A', box: [950, 100, 40, 30] }, { width: 800, height: 600 });
    expect(got?.rect.left).toBeCloseTo(0.95, 6);
    expect(got?.rect.top).toBeCloseTo(0.1, 6);
    expect(got?.rect.width).toBeCloseTo(0.04, 6);
    expect(got?.rect.height).toBeCloseTo(0.03, 6);
  });
});

describe('阅读顺序', () => {
  it('乱序进来，按行聚好再行内从左到右', () => {
    const rows = orderOcrLines([
      line('第二行右', 0.5, 0.12),
      line('第三行', 0.1, 0.18),
      line('第一行右', 0.5, 0.1),
      line('第一行左', 0.1, 0.101),
      line('第二行左', 0.1, 0.121),
    ]);
    expect(rows.map((r) => r.text)).toEqual([
      '第一行左',
      '第一行右',
      '第二行左',
      '第二行右',
      '第三行',
    ]);
  });

  it('同一行里高低不一的框算一行（OCR 给的字框常常差半行）', () => {
    const rows = orderOcrLines([line('后', 0.4, 0.1005, 0.2, 0.022), line('前', 0.1, 0.1, 0.2, 0.018)]);
    expect(rows.map((r) => r.text)).toEqual(['前', '后']);
  });

  it('空输入返回空数组，坏数据被过滤', () => {
    expect(orderOcrLines([])).toEqual([]);
    expect(orderOcrLines([line('', 0.1, 0.1)])).toEqual([]);
  });
});

describe('OCR 页文本与文字层', () => {
  const page = {
    engine: 'vision' as const,
    model: 'test',
    at: 0,
    layout: true,
    lines: [line('第一行', 0.1, 0.1), line('第二行', 0.1, 0.13)],
  };

  it('换行归一成空格，中文之间不补空格', () => {
    expect(ocrPageText(page)).toBe('第一行 第二行');
  });

  it('行级 span 的文本顺序与字符偏移一致（划线靠它对位）', () => {
    const items = ocrLinesToItems(page.lines);
    expect(items).toHaveLength(2);
    expect(items[0]?.str).toBe('第一行');
    expect(items[0]?.hasEOL).toBe(true);
    const layout = ocrPageTextLayout(page);
    /* 第 4 个字符（第二行首字）在 DOM 里也是第 3 个：行与行之间不插分隔符 */
    expect(layout.text.charAt(4)).toBe('第');
    expect(layout.layerIndex[4]).toBe(3);
    expect(layout.text).toHaveLength(7);
    expect(layout.layerIndex).toHaveLength(7);
  });

  it('英文行之间补一个空格，DOM 偏移仍然对得上', () => {
    const en = {
      engine: 'vision' as const,
      model: 'test',
      at: 0,
      layout: true,
      lines: [line('Hello', 0.1, 0.1), line('world', 0.1, 0.13)],
    };
    const layout = ocrPageTextLayout(en);
    expect(layout.text).toBe('Hello world');
    /* 空格的 layerIndex 指向第二行起点（DOM 里没有这个字符） */
    expect(layout.layerIndex[5]).toBe(5);
    expect(layout.layerIndex[6]).toBe(5);
    expect(layout.text.charAt(6)).toBe('w');
  });

  it('字符数与空页判定', () => {
    expect(ocrPageChars(page)).toBe(6);
    expect(ocrPageEmpty(page)).toBe(false);
    expect(ocrPageEmpty({ ...page, lines: [] })).toBe(true);
  });

  it('整页文字里连续空白压成一个空格', () => {
    const messy = {
      engine: 'manual' as const,
      model: '',
      at: 0,
      layout: true,
      lines: [line('A   B', 0.1, 0.1), line('  C  ', 0.1, 0.13)],
    };
    expect(ocrPageText(messy)).toBe('A B C');
  });
});

describe('模型返回的 JSON 解析', () => {
  it('认 ```json 围栏和前后废话', () => {
    const raw = '好的，结果如下：\n```json\n{"lines":[{"text":"甲","box":[0.1,0.1,0.2,0.03]}]}\n```\n以上。';
    const got = parseOcrJson(raw);
    expect(got.layout).toBe(true);
    expect(got.lines.map((l) => l.text)).toEqual(['甲']);
  });

  it('裸数组、bbox 四角坐标都认', () => {
    const got = parseOcrJson('[{"text":"甲","bbox":[0.1,0.1,0.3,0.13]}]');
    expect(got.layout).toBe(true);
    expect(got.lines[0]?.rect).toEqual({ left: 0.1, top: 0.1, width: 0.2, height: 0.03 });
  });

  it('x/y/w/h 形状也认', () => {
    const got = parseOcrJson('{"lines":[{"text":"甲","x":0.1,"y":0.2,"w":0.3,"h":0.04}]}');
    expect(got.lines[0]?.rect).toEqual({ left: 0.1, top: 0.2, width: 0.3, height: 0.04 });
  });

  it('只给整页文字、没有位置：保留文本但不造层', () => {
    const got = parseOcrJson('{"text":"整页的一段文字"}');
    expect(got.layout).toBe(false);
    expect(got.lines).toEqual([]);
    expect(got.text).toBe('整页的一段文字');
  });

  it('一行有位置一行没有：整页按「不能造层」处理，但位置算不到的那行不丢文本', () => {
    const got = parseOcrJson('{"lines":[{"text":"甲","box":[0.1,0.1,0.2,0.03]},{"text":"乙"}]}');
    expect(got.layout).toBe(false);
    expect(got.lines.map((l) => l.text)).toEqual(['甲', '乙']);
  });

  it('垃圾输入不抛错', () => {
    expect(parseOcrJson('')).toEqual({ lines: [], layout: false, text: '' });
    expect(parseOcrJson('这不是 JSON').layout).toBe(false);
    expect(parseOcrJson('{"lines":[]}').layout).toBe(false);
  });

  it('已经是对象（外部 OCR 服务直接回 JSON）也能解析', () => {
    const got = parseOcrValue({ lines: [{ text: '甲', box: [0.1, 0.1, 0.2, 0.03] }] });
    expect(got.layout).toBe(true);
    expect(got.lines[0]?.text).toBe('甲');
  });

  it('四边形多边形 + 像素坐标（Umi-OCR 的形状）也收成行', () => {
    const data = [
      {
        text: '第一行',
        /* 左上 / 右上 / 右下 / 左下 四个点，像素单位 */
        box: [
          [100, 200],
          [500, 200],
          [500, 240],
          [100, 240],
        ],
        score: 0.96,
      },
    ];
    const got = parseOcrValue(data, { width: 1000, height: 2000 });
    expect(got.layout).toBe(true);
    expect(got.lines[0]?.rect).toEqual({ left: 0.1, top: 0.1, width: 0.4, height: 0.02 });
  });

  it('给了出图尺寸，也不能把 0..1 的比例坐标当成像素除一遍（自建服务常回比例）', () => {
    const got = normalizeOcrLine({ text: '甲', box: [0.1, 0.2, 0.3, 0.04] }, { width: 1000, height: 2000 });
    expect(got?.rect).toEqual({ left: 0.1, top: 0.2, width: 0.3, height: 0.04 });
  });

  it('PaddleOCR 的 [box, [文本, 分数]] 嵌套形状也收（自建 Flask 服务原样返回）', () => {
    const got = parseOcrValue(
      [
        [
          [
            [100, 200],
            [500, 200],
            [500, 240],
            [100, 240],
          ],
          ['第一行', 0.96],
        ],
      ],
      { width: 1000, height: 2000 },
    );
    expect(got.layout).toBe(true);
    expect(got.lines[0]?.text).toBe('第一行');
    expect(got.lines[0]?.rect).toEqual({ left: 0.1, top: 0.1, width: 0.4, height: 0.02 });
  });

  it('只取前四个点会把框算歪——八个数必须走多边形那条', () => {
    /* 前四个数是「左上 x,y + 右上 x,y」，按宽高收的话 width 会变成 500（像素） */
    const got = normalizeOcrLine(
      { text: '甲', box: [[100, 200], [500, 200], [500, 240], [100, 240]] },
      { width: 1000, height: 1000 },
    );
    expect(got?.rect.width).toBeCloseTo(0.4, 6);
    expect(got?.rect.height).toBeCloseTo(0.04, 6);
  });
});

describe('扫描件判定', () => {
  it('抽样三页都没字才算扫描件（只看首页会把「封面是图」判错）', () => {
    expect(scanSamplePages(278)).toEqual([1, 139, 278]);
    expect(scanSamplePages(2)).toEqual([1, 2]);
    expect(scanSamplePages(1)).toEqual([1]);
    expect(scanSamplePages(0)).toEqual([1]);
  });

  it('有一页有字就不是扫描件；样本为空不乱判', () => {
    expect(looksScanned(['', '   ', ''])).toBe(true);
    expect(looksScanned(['', '正文', ''])).toBe(false);
    expect(looksScanned([])).toBe(false);
  });
});
