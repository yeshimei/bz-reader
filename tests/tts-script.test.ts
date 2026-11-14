import { describe, expect, it } from 'vitest';
import {
  billedChars,
  buildScript,
  estimateCost,
  splitQuotes,
  splitSentences,
  startIndexOf,
  startPointOf,
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

  /* 2026-11-14 真机：EPUB 里有一个孤立的「、」段落，被当成一句发给语音服务，
     本地模型对纯标点吐不出音频（`no audio produced`），整章导出就断在这。
     没有可读字符的碎片一律不念。 */
  it('纯标点的碎片不念', () => {
    expect(splitSentences('、')).toEqual([]);
    expect(splitSentences('——')).toEqual([]);
    expect(splitSentences('……')).toEqual([]);
    expect(splitSentences('﹒﹒')).toEqual([]);
  });

  it('句子里混着标点照样念，只丢纯标点的碎片', () => {
    expect(splitSentences('甲。、')).toEqual(['甲。']);
  });

  it('数字和字母也算可读字符', () => {
    expect(splitSentences('2024')).toEqual(['2024']);
    expect(splitSentences('OK')).toEqual(['OK']);
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

  /* 真机踩过：EPUB 排版里单放一个「、」当分隔，它是块，但不是话 */
  it('只有标点的段落不产出脚本', () => {
    expect(buildScript([{ text: '、' }, { text: '这是正文。' }]).map((s) => s.text)).toEqual(['这是正文。']);
  });
});

/* 2026-11-14 新方案：高亮不再靠文本搜索定位，每句自带「原文区间」。
   at/len 相对块的**原始** textContent（引号、破折号、空白都算在原文里），
   朗读用的 text 仍是规范化后的可念文本。两者必须指向同一段原文。 */
describe('句子锚点（原文区间）', () => {
  it('多句：每句的 at/len 精确落在原文上', () => {
    const raw = '这是一句足够长的旁白文字。这是第二句够长的话。';
    const segs = buildScript([{ text: raw, raw }]);
    expect(segs.map((s) => raw.slice(s.at, s.at + s.len))).toEqual([
      '这是一句足够长的旁白文字。',
      '这是第二句够长的话。',
    ]);
  });

  it('引号不进朗读文本，但区间跳过引号本身', () => {
    const raw = '他推开门，屋里很暗。“谁？”一个女人的声音。';
    const segs = buildScript([{ text: raw, raw }]);
    expect(segs.map((s) => s.text)).toEqual(['他推开门，屋里很暗。', '谁？', '一个女人的声音。']);
    expect(segs.map((s) => s.at)).toEqual([0, 11, 14]);
    expect(segs.map((s) => s.len)).toEqual([10, 2, 8]);
  });

  it('换行与缩进不挪动区间', () => {
    const raw = '第一句话足够长。\n\n  第二句话也够长。';
    const segs = buildScript([{ text: raw.replace(/\s+/g, ' ').trim(), raw }]);
    expect(segs.map((s) => raw.slice(s.at, s.at + s.len).replace(/\s+/g, ' '))).toEqual([
      '第一句话足够长。',
      '第二句话也够长。',
    ]);
  });

  it('短句合并后区间连成一片', () => {
    const raw = '这是一句足够长的话。好。';
    const segs = buildScript([{ text: raw, raw }]);
    expect(segs).toHaveLength(1);
    expect(segs[0].at).toBe(0);
    expect(segs[0].len).toBe(raw.length);
  });

  it('没有 raw 时区间相对 text 本身，不崩', () => {
    const text = '这是一句足够长的旁白文字。这是第二句够长的话。';
    const segs = buildScript([{ text }]);
    expect(segs.map((s) => text.slice(s.at, s.at + s.len))).toEqual([
      '这是一句足够长的旁白文字。',
      '这是第二句够长的话。',
    ]);
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


describe('startIndexOf', () => {
  /* 整章脚本 vs 当前页文字：整章往后连续播，但起点必须落在「这一屏第一句」。
     离线包播的是整章 mp3，起点算错的直接后果是「声音从章首开始、高亮却在
     当前页」——真机反馈过的那个 bug。 */
  const segs = [
    { text: '在这本书里，我想写现代中国某一部分社会。' },
    { text: '照例这本书该献给她。不过，近来觉得献书也像佳话。' },
    { text: '三十五年（一九四六年）十二月十五日' },
  ];

  it('整句出现在这一页时，从这一句开始', () => {
    const page = '照例这本书该献给她。不过，近来觉得献书也像佳话。三十五年（一九四六年）十二月十五日';
    expect(startIndexOf(segs, page)).toBe(1);
  });

  it('段落跨页、页首只是后半段时，退到「这一句包含页首」的那一句', () => {
    /* 第 2 句从上一页开始，“照例”两个字留在了上一屏 */
    const page = '这本书该献给她。不过，近来觉得献书也像佳话。';
    expect(startIndexOf(segs, page)).toBe(1);
  });

  it('页首是短句而整页都对不上时，从这一页第一条对得上的句子开始', () => {
    const page = '三十五年（一九四六年）十二月十五日';
    expect(startIndexOf(segs, page)).toBe(2);
  });

  it('一句都对不上（换过排版）就从章首开始，至少能听', () => {
    expect(startIndexOf(segs, '完全不相干的一段文字')).toBe(0);
  });

  it('页文字为空时也从章首开始', () => {
    expect(startIndexOf(segs, '')).toBe(0);
    expect(startIndexOf(segs, '   ')).toBe(0);
  });

  it('标点与空白差异不影响判断', () => {
    const page = '照例这本书该献给她。 不过， 近来觉得献书也像佳话。';
    expect(startIndexOf(segs, page)).toBe(1);
  });

  it('空脚本返回 0（不返回 -1，调用方直接拿去 start）', () => {
    expect(startIndexOf([], '随便')).toBe(0);
  });
});

describe('startPointOf', () => {
  /* 起点要落到「屏幕上的第一个字」，不是一个段落的开头：段落跨页时，
     这一页从段落中间开始，可整句音频只能从句首放。返回要跳过几个字，
     播放器按比例换算成毫秒，把上一页那点尾巴跳过去。 */
  const segs = [
    { text: '序' },
    { text: '照例这本书该献给她。' },
    { text: '不过，近来觉得献书也像佳话。' },
  ];

  it('页首落在句中时，给出要跳过几个字', () => {
    const page = '这本书该献给她。不过，近来觉得献书也像佳话。';
    expect(startPointOf(segs, page)).toEqual({ index: 1, skip: 2 });
  });

  it('整句就在页首时不用跳', () => {
    expect(startPointOf(segs, '不过，近来觉得献书也像佳话。')).toEqual({ index: 2, skip: 0 });
  });

  it('一句都对不上时从章首、不跳', () => {
    expect(startPointOf(segs, '完全不相干的一段文字')).toEqual({ index: 0, skip: 0 });
  });

  it('页首只有两个字也能定位（极短页）', () => {
    expect(startPointOf(segs, '献给她。')).toEqual({ index: 1, skip: 6 });
  });

  it('空页面不跳', () => {
    expect(startPointOf(segs, '')).toEqual({ index: 0, skip: 0 });
  });
});
