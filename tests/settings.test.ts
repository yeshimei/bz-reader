import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/data/settings';

/**
 * exportDir / importDir 是自由文本框。以前只收首尾斜杠，`../x` 会让导出写到
 * 数据目录（甚至库）之外；这里与 normalizeDataDir 同口径：按段过滤。
 */
describe('目录设置收口', () => {
  it('上跳段被丢弃', () => {
    expect(normalizeSettings({ exportDir: '../外面' }).exportDir).toBe('外面');
    expect(normalizeSettings({ exportDir: '书摘/../../外面' }).exportDir).toBe('书摘/外面');
  });

  it('. 段与点开头的隐藏目录被丢弃', () => {
    expect(normalizeSettings({ exportDir: './书摘' }).exportDir).toBe('书摘');
    expect(normalizeSettings({ exportDir: '.obsidian/plugins/x' }).exportDir).toBe('plugins/x');
  });

  it('正常多级目录原样保留，反斜杠转正斜杠', () => {
    expect(normalizeSettings({ exportDir: '阅读\\书摘' }).exportDir).toBe('阅读/书摘');
  });

  it("'/' 仍然表示库根目录（不是空值）", () => {
    expect(normalizeSettings({ exportDir: '/' }).exportDir).toBe('/');
  });

  it('空串回落到默认目录', () => {
    expect(normalizeSettings({ exportDir: '   ' }).exportDir).toBe(DEFAULT_SETTINGS.exportDir);
    expect(normalizeSettings({ exportDir: '..' }).exportDir).toBe(DEFAULT_SETTINGS.exportDir);
  });

  it('importDir 用同一套规则，但回落到自己的默认值', () => {
    expect(normalizeSettings({ importDir: '../x' }).importDir).toBe('x');
    expect(normalizeSettings({ importDir: '' }).importDir).toBe(DEFAULT_SETTINGS.importDir);
  });
});
