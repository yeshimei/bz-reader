import { describe, expect, it } from 'vitest';
import { labelOfPage, labelsFromPdf, pageLabelText } from '../src/engine/pdf/pagelabels';

describe('PDF 页标签', () => {
  it('按 PDF 自己的页码标签取，缺的退回物理页号', () => {
    const labels = labelsFromPdf(['i', 'ii', null, '1', '']);
    expect(labels).toEqual(['i', 'ii', '3', '1', '5']);
  });

  it('整本没有页标签时返回 null，交给物理页号', () => {
    expect(labelsFromPdf(null)).toBeNull();
    expect(labelsFromPdf([])).toBeNull();
    /* 全是空串 / 全等于物理页号：和没有一样，别让调用方以为有 */
    expect(labelsFromPdf([null, '', null])).toBeNull();
    expect(labelsFromPdf(['1', '2', '3'])).toBeNull();
  });

  it('取某一页的标签，越界与坏数据都不抛错', () => {
    const labels = labelsFromPdf(['i', 'ii', 'iii', '1']);
    expect(labelOfPage(labels, 2)).toBe('ii');
    expect(labelOfPage(labels, 4)).toBe('1');
    expect(labelOfPage(labels, 9)).toBe('9');
    expect(labelOfPage(null, 7)).toBe('7');
  });

  it('页脚文案：单页 / 双页 / 没有页标签', () => {
    const roman = labelsFromPdf(['i', 'ii', 'iii', '1']);
    expect(pageLabelText(4, 10, false, roman)).toBe('1 / 10');
    expect(pageLabelText(2, 10, true, roman)).toBe('ii–iii / 10');
    expect(pageLabelText(4, 10, false, null)).toBe('4 / 10');
    expect(pageLabelText(2, 10, true, null)).toBe('2–3 / 10');
    /* 末页落单时只报这一页，不能写出不存在的第 11 页 */
    expect(pageLabelText(10, 10, true, null)).toBe('10 / 10');
  });
});
