import { describe, expect, it } from 'vitest';
import { excerptAt, pageTextOf, pageTextLayoutOf, type PdfTextItemLike } from '../src/engine/pdf/text';

/**
 * 一页真实 PDF 的碎片（第 9 页 12.75pt 那段，"and is roughly at parity today."）。
 * 带字距调整的词被 pdf.js 切成 "rou" "ghl" "y"、"p" "a" "r" "i" "ty"——
 * 旧拼接规则会给每一块之间补空格，整页变成 "p a r i t y"，搜什么都搜不到。
 */
function frag(str: string, x: number, y: number, width: number, size = 12.75): PdfTextItemLike {
  return { str, transform: [size, 0, 0, size, x, y], width, height: size };
}

const PAGE9: PdfTextItemLike[] = [
  frag('a', 116.119, 136.92, 6.866),
  frag('n', 122.985, 136.92, 8.173),
  frag('d i', 131.031, 136.92, 14.127),
  frag('s', 145.158, 136.92, 5.973),
  frag(' ', 151.131, 136.92, 3.298),
  frag('rou', 153.604, 136.92, 20.349),
  frag('ghl', 173.953, 136.92, 19.361),
  frag('y', 193.187, 136.92, 7.478),
  frag(' ', 200.665, 136.92, 3.298),
  frag('a', 203.138, 136.92, 6.866),
  frag('t', 209.685, 136.92, 4.768),
  frag(' ', 214.454, 136.92, 3.298),
  frag('p', 216.927, 136.92, 7.803),
  frag('a', 224.858, 136.92, 6.866),
  frag('r', 231.724, 136.92, 5.221),
  frag('i', 236.945, 136.92, 3.819),
  frag('ty', 240.636, 136.92, 12.246),
  frag(' ', 252.882, 136.92, 3.298),
  frag('to', 255.356, 136.92, 11.94),
  frag('da', 267.423, 136.92, 14.701),
  frag('y', 281.55, 136.92, 7.478),
  frag('.', 288.136, 136.92, 2.983),
];

const SENTENCE = 'and is roughly at parity today.';

describe('pdf page text', () => {
  it('按 item 拼接，英文缺空格时补一个', () => {
    expect(pageTextOf([{ str: 'Hello' }, { str: ' ' }, { str: 'world' }])).toBe('Hello world');
    expect(pageTextOf([{ str: 'Hello' }, { str: 'world' }])).toBe('Hello world');
  });

  it('中文之间不补空格', () => {
    expect(pageTextOf([{ str: '中' }, { str: '文' }])).toBe('中文');
    expect(pageTextOf([{ str: '中文' }, { str: '阅读' }])).toBe('中文阅读');
  });

  it('换行归一成空格，连续空白压成一个', () => {
    expect(pageTextOf([{ str: 'a', hasEOL: true }, { str: 'b' }])).toBe('a b');
    expect(pageTextOf([{ str: 'a   b' }, { str: '  c' }])).toBe('a b c');
  });

  it('空页返回空串', () => {
    expect(pageTextOf([])).toBe('');
    expect(pageTextOf([{ str: '' }])).toBe('');
    expect(pageTextOf([{ str: '   ' }])).toBe('');
  });

  it('摘录按 start/end 取上下文，并归一空白', () => {
    const text = '前面一句话。目标 词语 出现在这里，后面还有一句。';
    const got = excerptAt(text, text.indexOf('目标'), text.indexOf('目标') + 6, 6);
    expect(got.match).toBe('目标 词语');
    expect(got.pre.length).toBeLessThanOrEqual(6);
    expect(got.post.length).toBeLessThanOrEqual(6);
    expect(got.pre).not.toContain('\n');
  });

  it('越界区间会被夹到文本范围内', () => {
    const got = excerptAt('abc', -5, 99, 10);
    expect(got.match).toBe('abc');
    expect(got.pre).toBe('');
    expect(got.post).toBe('');
  });
});

/* ============================================================
 * 按字号/坐标拼接（fix/pdf-search）。
 *
 * 旧规则只看「两侧是不是拉丁字母」，带字距调整的 PDF 每个碎片之间都被补
 * 一个空格——真机上整页变成 "p a r i t y"，搜 parity 永远没有结果。
 * ============================================================ */
describe('pdf page text：按实际间隙拼接', () => {
  it('同词内的碎片不补空格（真机第 9 页那一段）', () => {
    expect(pageTextOf(PAGE9)).toBe(SENTENCE);
    expect(pageTextOf(PAGE9)).not.toContain('p a r');
  });

  it('没有显式空格字符时，靠间隙断词', () => {
    const noSpaces = PAGE9.filter((item) => item.str !== ' ');
    expect(pageTextOf(noSpaces)).toBe(SENTENCE);
  });

  it('间隙明显（超过约 0.15 字宽）才补空格', () => {
    expect(pageTextOf([frag('a', 10, 100, 10, 10), frag('b', 24.4, 100, 10, 10)])).toBe('a b');
    expect(pageTextOf([frag('a', 10, 100, 10, 10), frag('b', 20.2, 100, 10, 10)])).toBe('ab');
  });

  it('同一行内的词间大间隙也只补一个空格', () => {
    expect(pageTextOf([frag('a', 10, 100, 10), frag('b', 60, 100, 10, 10)])).toBe('a b');
  });

  it('换行补空格（纵坐标不同即换行）', () => {
    expect(pageTextOf([frag('a', 10, 100, 10), frag('b', 10, 88, 10)])).toBe('a b');
  });

  it('旋转页按文字方向算间隙，不按横坐标', () => {
    const rotated = (str: string, x: number, y: number, width: number): PdfTextItemLike => ({
      str,
      transform: [0, 12.75, -12.75, 0, x, y],
      width,
      height: 12.75,
    });
    expect(pageTextOf([rotated('a', 100, 500, 40), rotated('b', 100, 540, 30)])).toBe('ab');
    expect(pageTextOf([rotated('a', 100, 500, 40), rotated('b', 100, 545, 30)])).toBe('a b');
    expect(pageTextOf([rotated('a', 100, 500, 40), rotated('b', 120, 500, 30)])).toBe('a b');
  });

  it('没给坐标（外部构造的 item）时退回旧规则', () => {
    expect(pageTextOf([{ str: 'Hello' }, { str: 'world' }])).toBe('Hello world');
    expect(pageTextOf([{ str: 'Hello' }, { str: ' ' }, { str: 'world' }])).toBe('Hello world');
    expect(pageTextOf([{ str: 'p' }, { str: 'a' }, { str: 'r' }])).toBe('p a r');
  });

  it('有坐标但缺字宽：退回旧规则，不猜', () => {
    const noWidth: PdfTextItemLike[] = [
      { str: 'Hello', transform: [10, 0, 0, 10, 0, 0] },
      { str: 'world', transform: [10, 0, 0, 10, 30, 0] },
    ];
    expect(pageTextOf(noWidth)).toBe('Hello world');
  });

  it('中文之间仍然不补空格', () => {
    expect(pageTextOf([frag('中', 10, 100, 12), frag('文', 22, 100, 12)])).toBe('中文');
  });
});

/* ============================================================
 * 文字层偏移映射：PDF 命中要写 `pdf/<页>/<起>-<止>`，而划线、页内高亮
 * 用的都是文字层（DOM textContent）里的字符位置。搜索文本里补出来的空格
 * 在文字层里并不存在，所以必须带一份映射，不能直接拿下标去用。
 * ============================================================ */
describe('pdf page text：文字层偏移映射', () => {
  it('显式空格字符占一个文字层位置', () => {
    const layout = pageTextLayoutOf([
      frag('a', 10, 100, 10, 10),
      frag(' ', 20, 100, 3, 10),
      frag('b', 23.5, 100, 10, 10),
    ]);
    expect(layout.text).toBe('a b');
    expect(layout.layerIndex).toEqual([0, 1, 2]);
  });

  it('补出来的空格不占文字层位置，指向它后面的真实字符', () => {
    const layout = pageTextLayoutOf([frag('a', 10, 100, 10, 10), frag('b', 24.4, 100, 10, 10)]);
    expect(layout.text).toBe('a b');
    expect(layout.layerIndex).toEqual([0, 1, 1]);
  });

  it('真机第 9 页：映射长度与文本一致，层内下标单调不减', () => {
    const layout = pageTextLayoutOf(PAGE9);
    expect(layout.text).toBe(SENTENCE);
    expect(layout.layerIndex).toHaveLength(layout.text.length);
    for (let i = 1; i < layout.layerIndex.length; i += 1) {
      expect(layout.layerIndex[i]!).toBeGreaterThanOrEqual(layout.layerIndex[i - 1]!);
    }
    expect(layout.layerIndex.at(-1)).toBe(SENTENCE.length - 1);
  });
});
