import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { guessLang, normalizeSpeakLang, speak, speakLang, splitForSpeech } from '../src/core/speak';

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

/* ───────────── B11：英文句号也断句 ───────────── */

describe('英文断句（B11）', () => {
  it('按句号切成多段，不再整页一段', () => {
    const text = 'First sentence. Second sentence. Third one.';
    const parts = splitForSpeech(text, 18);
    expect(parts).toEqual(['First sentence.', 'Second sentence.', 'Third one.']);
  });

  it('小数点不算句末：3.14 不会被切成两段', () => {
    const parts = splitForSpeech('The value is 3.14 exactly.', 200);
    expect(parts).toEqual(['The value is 3.14 exactly.']);
  });

  it('点后面没有空白也不算句末（e.g.x 这类缩写与文件名）', () => {
    expect(splitForSpeech('see file.txt now', 200)).toEqual(['see file.txt now']);
  });

  it('并段时保留句间空格：不会念成 sentence.Two', () => {
    const parts = splitForSpeech('One. Two.', 200);
    expect(parts).toEqual(['One. Two.']);
  });

  it('中文不受影响：仍然按中文标点断，句间不插空格', () => {
    expect(splitForSpeech('第一句。第二句。', 200)).toEqual(['第一句。第二句。']);
  });
});

describe('朗读语言（B11）', () => {
  it('书里标了语言就用它，压倒内容猜测', () => {
    /* 英文书里夹了大量中文引文，按内容猜会变成 zh-CN——元数据才是作者的话 */
    expect(speakLang('这是一段引文，很长很长。', 'en', 'zh')).toBe('en');
  });

  it('ISO 639-2 也能认（eng / zho / jpn）', () => {
    expect(normalizeSpeakLang('eng')).toBe('en');
    expect(normalizeSpeakLang('zho')).toBe('zh-CN');
    expect(normalizeSpeakLang('jpn')).toBe('ja');
    expect(normalizeSpeakLang('zh_Hant')).toBe('zh-TW');
  });

  it('书里没标：界面语言同文种时才采用（zh-TW 界面读中文书）', () => {
    expect(speakLang('这是一段中文正文。', undefined, 'zh-TW')).toBe('zh-TW');
  });

  it('界面是中文、正文是英文：不用界面语言，按内容猜', () => {
    /* 拿 zh-CN 去念英文比按内容猜成 en-US 更糟 */
    expect(speakLang('This is English body text, long enough to tell.', undefined, 'zh')).toBe(
      'en-US',
    );
  });

  it('认不出的标签既不崩也不乱用', () => {
    expect(normalizeSpeakLang('')).toBe('');
    expect(normalizeSpeakLang(undefined)).toBe('');
    expect(normalizeSpeakLang('!!!')).toBe('');
    expect(speakLang('这是一段中文正文。', '???', '???')).toBe('zh-CN');
  });
});

/* ───────────── B12：cancel() 抛错不该整段静音 ───────────── */

describe('speak() 的容错（B12）', () => {
  const g = globalThis as unknown as Record<string, unknown>;
  let restoreDom: () => void = () => undefined;
  let spoken: Array<{ text: string }> = [];

  class FakeUtterance {
    text: string;
    lang = '';
    rate = 1;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }

  beforeEach(() => {
    spoken = [];
    restoreDom = installDomStub();
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      /* iOS 从后台回来时真的会这样抛：以前整个 speak() 就崩在这里 */
      cancel: () => {
        throw new Error('cancel boom');
      },
      speak: (u: { text: string }) => spoken.push(u),
    };
    g.SpeechSynthesisUtterance = FakeUtterance;
  });

  afterEach(() => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    delete g.SpeechSynthesisUtterance;
    restoreDom();
  });

  it('首次 cancel() 抛错也照样开始念', async () => {
    const handle = speak('一句话。');
    expect(handle).not.toBeNull();
    /* 首句被放到下一个宏任务（A-31），等一拍 */
    await new Promise((r) => setTimeout(r, 10));
    expect(spoken.map((u) => u.text)).toEqual(['一句话。']);
  });
});
