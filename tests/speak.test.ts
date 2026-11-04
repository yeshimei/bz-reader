import { describe, expect, it } from 'vitest';
import { guessLang, splitForSpeech } from '../src/core/speak';

describe('朗读分段（P2-11）', () => {
  it('短句并到目标长度，不会一句一段地排队', () => {
    const text = '第一句。第二句。第三句。第四句。';
    const parts = splitForSpeech(text, 12);
    expect(parts.length).toBeLessThan(4);
    expect(parts.join('')).toBe(text);
  });

  it('整段不超过目标长度时就是一段', () => {
    const parts = splitForSpeech('很短的一段话。', 220);
    expect(parts).toEqual(['很短的一段话。']);
  });

  it('超过 4000 字的长句硬切，后半页不再被丢掉', () => {
    /* 以前是 `text.slice(0, 4000)`：一页 6000 字，后 2000 字永远不念。 */
    const long = '甲'.repeat(9000);
    const parts = splitForSpeech(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toHaveLength(9000);
  });

  it('空文本 / 纯空白返回空数组', () => {
    expect(splitForSpeech('')).toEqual([]);
    expect(splitForSpeech('   \n\t ')).toEqual([]);
  });

  it('英文按 . ! ? 切', () => {
    const parts = splitForSpeech('One sentence. Two sentence! Three?', 20);
    expect(parts.join('')).toContain('One sentence.');
    expect(parts.join('')).toContain('Three?');
  });

  it('换行也当断点（TXT 里的段落）', () => {
    const parts = splitForSpeech('第一段\n第二段\n第三段', 8);
    expect(parts.length).toBeGreaterThan(1);
  });
});

describe('朗读语言猜测（P2-11）', () => {
  it('中文内容用 zh-CN', () => {
    expect(guessLang('这是一段中文，里面有 English 单词也没关系。')).toBe('zh-CN');
  });

  it('英文内容用 en-US，不再拿中文腔读英文书', () => {
    expect(guessLang('This is a paragraph of English text about reading.')).toBe('en-US');
  });

  it('数字与标点不算中文', () => {
    expect(guessLang('12345 !!! ???')).toBe('en-US');
  });
});
