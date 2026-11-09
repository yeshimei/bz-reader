import { describe, expect, it } from 'vitest';
import {
  encodePdfLocator,
  isPdfLocator,
  parsePdfLocator,
  pdfLocatorPage,
  pdfPageLocator,
} from '../src/engine/pdf/locator';

describe('pdf locator', () => {
  it('编码页码与字符区间', () => {
    expect(encodePdfLocator(12)).toBe('pdf/12');
    expect(encodePdfLocator(3, 5, 9)).toBe('pdf/3/5-9');
  });

  it('页码至少从 1 开始，非法入参归一到 1', () => {
    expect(encodePdfLocator(0)).toBe('pdf/1');
    expect(encodePdfLocator(-5)).toBe('pdf/1');
    expect(encodePdfLocator(Number.NaN)).toBe('pdf/1');
  });

  it('区间端点归一：负数归零，end < start 时交换', () => {
    expect(encodePdfLocator(2, -3, 4)).toBe('pdf/2/0-4');
    expect(encodePdfLocator(2, 9, 4)).toBe('pdf/2/4-9');
    expect(encodePdfLocator(2, 5, 5)).toBe('pdf/2/5-5');
  });

  it('能认出自己的 locator，不误认 epubcfi', () => {
    expect(isPdfLocator('pdf/1')).toBe(true);
    expect(isPdfLocator('pdf/204/10-30')).toBe(true);
    expect(isPdfLocator('epubcfi(/6/4[chap01]!/4/2/2)')).toBe(false);
    expect(isPdfLocator('pdf/')).toBe(false);
    expect(isPdfLocator('')).toBe(false);
  });

  it('解析纯页码与带区间两种形状', () => {
    expect(parsePdfLocator('pdf/7')).toEqual({ page: 7, start: 0, end: 0 });
    expect(parsePdfLocator('pdf/7/2-11')).toEqual({ page: 7, start: 2, end: 11 });
  });

  it('拒绝坏形状，不抛错', () => {
    expect(parsePdfLocator('pdf/0')).toBeNull();
    expect(parsePdfLocator('pdf/abc')).toBeNull();
    expect(parsePdfLocator('pdf/3/')).toBeNull();
    expect(parsePdfLocator('pdf/3/1-')).toBeNull();
    expect(parsePdfLocator('pdf/3/1-2-3')).toBeNull();
    expect(parsePdfLocator('pdf/3.5')).toBeNull();
    expect(parsePdfLocator('epubcfi(/6/4)')).toBeNull();
  });

  it('pdfLocatorPage 只取页码', () => {
    expect(pdfLocatorPage('pdf/9/1-2')).toBe(9);
    expect(pdfLocatorPage('epubcfi(/6/4)')).toBeNull();
  });

  it('pdfPageLocator 与 encodePdfLocator 同形', () => {
    expect(pdfPageLocator(5)).toBe(encodePdfLocator(5));
  });
});
