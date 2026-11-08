import { describe, expect, it } from 'vitest';
import { highlightEscaped } from '../src/shell/highlight';

/* ============================================================
 * 命中高亮（fix/search-body 增强 1）。
 *
 * 必须先把原文按命中切成段、逐段转义，再插 <em>；不能先 esc 再找关键词——
 * `&amp;` 会让下标错位，标签就被插进实体中间。
 * ============================================================ */

describe('highlightEscaped', () => {
  it('命中段包 <em>，未命中段原样', () => {
    expect(highlightEscaped('我的天才女友', '天才')).toBe('我的<em>天才</em>女友');
  });

  it('一次出现多处，每处都包', () => {
    expect(highlightEscaped('天才与天才', '天才')).toBe('<em>天才</em>与<em>天才</em>');
  });

  it('大小写不敏感，保留原文写法', () => {
    expect(highlightEscaped('ABC abc', 'abc')).toBe('<em>ABC</em> <em>abc</em>');
  });

  it('先转义再包标签：书里的尖括号不会变成真标签', () => {
    expect(highlightEscaped('<b>天才</b>', '天才')).toBe('&lt;b&gt;<em>天才</em>&lt;/b&gt;');
  });

  it('关键词为空时只转义，不插标签', () => {
    expect(highlightEscaped('a<b', '  ')).toBe('a&lt;b');
  });

  it('关键词里的正则元字符按字面处理，不抛异常', () => {
    expect(highlightEscaped('a.*b', '.*')).toBe('a<em>.*</em>b');
  });
});
