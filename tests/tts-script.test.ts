import { describe, expect, it } from 'vitest';
import {
  billedChars,
  buildScript,
  estimateCost,
  splitQuotes,
  ttsLangSupported,
} from '../src/core/tts-script';

describe('引号切分（旁白 / 对话）', () => {
  it('旁白—对话—旁白按出现顺序拆成三段', () => {
    const parts = splitQuotes('他推开门，屋里很暗。“谁？”一个女人的声音。');
    expect(parts.map((p) => p.kind)).toEqual(['narration', 'dialogue', 'narration']);
    expect(parts[1].text).toBe('谁？');
  });

  it('引号本身不进朗读文本', () => {
    const parts = splitQuotes('“走吧。”');
    expect(parts).toEqual([{ kind: 'dialogue', text: '走吧。' }]);
  });

  it('嵌套引号只认最外层，内层引号留在同一句里', () => {
    const parts = splitQuotes('他说：“她喊‘别走’。”');
    expect(parts.map((p) => p.kind)).toEqual(['narration', 'dialogue']);
    expect(parts[1].text).toBe('她喊‘别走’。');
  });

  it('引号没闭合时剩下的算对话，不整段退回旁白', () => {
    const parts = splitQuotes('他说：“天黑了');
    expect(parts.map((p) => p.kind)).toEqual(['narration', 'dialogue']);
  });

  it('段首破折号按对白处理', () => {
    expect(splitQuotes('——你来了。')).toEqual([{ kind: 'dialogue', text: '你来了。' }]);
  });

  it('英文缩写里的单引号不触发对白', () => {
    const parts = splitQuotes("He didn't come. She left.");
    expect(parts.every((p) => p.kind === 'narration')).toBe(true);
  });

  it('英文双引号成对识别', () => {
    const parts = splitQuotes('He said, "Go now." Then he left.');
    expect(parts.map((p) => p.kind)).toEqual(['narration', 'dialogue', 'narration']);
    expect(parts[1].text).toBe('Go now.');
  });
});

describe('朗读脚本合并', () => {
  it('连续同角色合并，跨角色的段不合并', () => {
    const script = buildScript([
      { text: '第一段旁白。' },
      { text: '第二段旁白。' },
      { text: '“对白。”' },
    ]);
    expect(script.map((s) => s.kind)).toEqual(['narration', 'dialogue']);
    expect(script[0].blocks).toEqual([0, 1]);
    expect(script[1].blocks).toEqual([2]);
  });

  it('同一段里旁白与对话交替时拆开，block 号相同', () => {
    const script = buildScript([{ text: '他推开门。“谁？”她问。' }]);
    expect(script.map((s) => s.kind)).toEqual(['narration', 'dialogue', 'narration']);
    expect(script.every((s) => s.blocks[0] === 0)).toBe(true);
  });

  it('合并不超过目标字数', () => {
    const long = '甲'.repeat(150);
    const script = buildScript([{ text: long }, { text: long }], { target: 200 });
    expect(script).toHaveLength(2);
  });

  it('空白段落不产出空段', () => {
    expect(buildScript([{ text: '   ' }, { text: '\n' }])).toEqual([]);
  });
});

describe('计费口径', () => {
  it('汉字算 2、英文字母与空格算 1', () => {
    expect(billedChars('中文')).toBe(4);
    expect(billedChars('ab c')).toBe(4);
  });

  it('一万计费字符 = 3 元（刊例价）', () => {
    expect(estimateCost(10000)).toBeCloseTo(3);
    expect(estimateCost(2000)).toBeCloseTo(0.6);
  });

  it('五折价传 1.5', () => {
    expect(estimateCost(10000, 1.5)).toBeCloseTo(1.5);
  });
});

describe('语种支持', () => {
  it('中文、繁体、粤语、英文都认', () => {
    for (const tag of ['zh', 'zh-CN', 'zh-TW', 'yue', 'en-US', 'ja', 'ko']) {
      expect(ttsLangSupported(tag)).toBe(true);
    }
  });

  it('德语、法语、西语、葡语不认（DeepSeek 没这些语种）', () => {
    for (const tag of ['de', 'fr', 'es', 'pt', '', '-']) {
      expect(ttsLangSupported(tag)).toBe(false);
    }
  });
});
