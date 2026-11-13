import { describe, expect, it } from 'vitest';
import {
  billedChars,
  buildScript,
  estimateCost,
  splitQuotes,
  splitSentences,
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

describe('按句切分', () => {
  it('句号、叹号、问号各自收尾', () => {
    expect(splitSentences('这是一句足够长的旁白文字。这是第二句够长的话！第三句也够长了？')).toEqual([
      '这是一句足够长的旁白文字。',
      '这是第二句够长的话！',
      '第三句也够长了？',
    ]);
  });

  it('连续标点一起收尾，不拆成两句', () => {
    expect(splitSentences('他说什么？！我不知道……真的吗')).toEqual(['他说什么？！', '我不知道……真的吗']);
  });

  it('太短的碎片并进前一句', () => {
    expect(splitSentences('这是一句足够长的话。好。')).toEqual(['这是一句足够长的话。好。']);
  });

  it('没有句末标点时整段算一句', () => {
    expect(splitSentences('这句话没有标点结尾')).toEqual(['这句话没有标点结尾']);
  });

  it('空白返回空数组', () => {
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('朗读脚本', () => {
  it('一句一段（高亮要跟着句子走）', () => {
    const script = buildScript([{ text: '这是一句足够长的旁白文字。这是第二句够长的话。' }]);
    expect(script.map((s) => s.text)).toEqual(['这是一句足够长的旁白文字。', '这是第二句够长的话。']);
    expect(script.every((s) => s.blocks[0] === 0)).toBe(true);
  });

  it('旁白与对白分属两种角色，不合并', () => {
    const script = buildScript([{ text: '他推开门，屋里很暗很静。“谁？”一个女人的声音。' }]);
    expect(script.map((s) => s.kind)).toEqual(['narration', 'dialogue', 'narration']);
  });

  it('块的序号保留在每一句上（高亮按块定位）', () => {
    const script = buildScript([{ text: '“好。”' }, { text: '“走。”' }]);
    expect(script.map((s) => s.text)).toEqual(['好。', '走。']);
    expect(script.map((s) => s.blocks[0])).toEqual([0, 1]);
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
