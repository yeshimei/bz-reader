import { describe, expect, it } from 'vitest';
import { buildPdfLinkHash, hasPdfLinkPreciseTarget, parsePdfLinkHash, pdfSubpathOf } from '../src/data/pdf-link';

describe('PDF++ link format', () => {
  it('解析只有页码的链接', () => {
    expect(parsePdfLinkHash('#page=3')).toEqual({ page: 3 });
    expect(parsePdfLinkHash('page=12')).toEqual({ page: 12 });
  });

  it('解析文字选择（textDiv 下标 + 字符偏移）', () => {
    expect(parsePdfLinkHash('#page=3&selection=0,1,2,3&color=yellow')).toEqual({
      page: 3,
      selection: { beginIndex: 0, beginOffset: 1, endIndex: 2, endOffset: 3 },
      color: 'yellow',
    });
  });

  it('解析矩形选择', () => {
    expect(parsePdfLinkHash('#page=7&rect=10,20,300,40')).toEqual({
      page: 7,
      rect: { left: 10, top: 20, width: 300, height: 40 },
    });
  });

  it('解析 offset（允许空项）', () => {
    expect(parsePdfLinkHash('#page=2&offset=,100,1.5')).toEqual({
      page: 2,
      offset: { left: null, top: 100, zoom: 1.5 },
    });
  });

  it('坏链接一律返回 null，不抛错', () => {
    expect(parsePdfLinkHash('')).toBeNull();
    expect(parsePdfLinkHash('#page=0')).toBeNull();
    expect(parsePdfLinkHash('#page=abc')).toBeNull();
    expect(parsePdfLinkHash('#rect=1,2,3,4')).toBeNull();
    expect(parsePdfLinkHash('#page=3&selection=1,2,3')).toEqual({ page: 3 });
    expect(parsePdfLinkHash('#page=3&rect=a,b,c,d')).toEqual({ page: 3 });
  });

  it('生成往返一致', () => {
    const hash = buildPdfLinkHash({
      page: 5,
      selection: { beginIndex: 1, beginOffset: 2, endIndex: 3, endOffset: 4 },
      color: 'red',
    });
    expect(hash).toBe('#page=5&selection=1,2,3,4&color=red');
    expect(parsePdfLinkHash(hash)).toEqual({
      page: 5,
      selection: { beginIndex: 1, beginOffset: 2, endIndex: 3, endOffset: 4 },
      color: 'red',
    });
  });

  it('矩形生成时取整', () => {
    const hash = buildPdfLinkHash({ page: 1, rect: { left: 1.4, top: 2.6, width: 30.2, height: 40.5 } });
    expect(hash).toBe('#page=1&rect=1,3,30,41');
  });

  it('判断是否带页内位置', () => {
    expect(hasPdfLinkPreciseTarget({ page: 1 })).toBe(false);
    expect(hasPdfLinkPreciseTarget({ page: 1, rect: { left: 0, top: 0, width: 1, height: 1 } })).toBe(true);
  });

  it('带上本插件自己的 locator（bzr=），解析后能还原', () => {
    const hash = pdfSubpathOf({ page: 5, locator: 'pdf/5/12-30' });
    expect(hash).toBe('page=5&bzr=pdf%2F5%2F12-30');
    expect(parsePdfLinkHash(hash)).toEqual({ page: 5, locator: 'pdf/5/12-30' });
  });

  it('框选 locator 里的斜杠和等号也能安全往返', () => {
    const locator = 'pdf/5/r=0.1000,0.2000,0.3000,0.4000';
    const hash = pdfSubpathOf({ page: 5, rect: { left: 10, top: 20, width: 30, height: 40 }, locator });
    const back = parsePdfLinkHash(hash);
    expect(back?.locator).toBe(locator);
    expect(back?.rect).toEqual({ left: 10, top: 20, width: 30, height: 40 });
  });

  it('不认识的 bzr 值直接丢掉（别的插件也往 URL 里塞参数）', () => {
    expect(parsePdfLinkHash('#page=2&bzr=epubcfi%28%2F6%2F4%29')).toEqual({ page: 2 });
    expect(parsePdfLinkHash('#page=2&bzr=hello')).toEqual({ page: 2 });
  });

  it('生成时不带 bzr 就和老格式一模一样，不影响旧链接', () => {
    expect(buildPdfLinkHash({ page: 3, color: 'yellow' })).toBe('#page=3&color=yellow');
  });
});
