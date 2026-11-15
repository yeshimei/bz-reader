import { describe, expect, it } from 'vitest';
import {
  AI_CTX_ITEM_LIMIT,
  AI_CTX_TOTAL_LIMIT,
  canSendAi,
  clipChars,
  composeAiPrompt,
  ctxChipText,
  type AiContextItem,
  type AiPromptLabels,
} from '../src/shell/ai-context';
import { buildMessages } from '../src/data/ai';

/* ============================================================
 * 侧栏 A 版：待发送上下文。
 *
 * 这一层只做纯计算——拼给模型的提问、chip 上那截摘要、发送按钮亮不亮。
 * 不碰 DOM，才能在 node 里直接断言行为。
 * ============================================================ */

const LABELS: AiPromptLabels = {
  context: '【上下文】',
  question: '【问题】',
  quote: '划线',
  body: '正文',
  shot: '截图',
  note: '笔记',
  chars: (n) => `${n} 字`,
  onlyContext: '（只带了上下文）',
};

const quote = (text: string, meta = '第三章 · 划线'): AiContextItem => ({ kind: 'quote', text, meta });
const body = (text: string): AiContextItem => ({
  kind: 'body',
  text,
  chars: Array.from(text).length,
});
const note = (title: string, path = '读书笔记/围城/主题.md'): AiContextItem => ({
  kind: 'note',
  text: title,
  path,
});

describe('composeAiPrompt · 上下文与问题', () => {
  it('没有上下文时原样返回问题（不补任何标签）', () => {
    expect(composeAiPrompt([], '  这本书讲了什么  ', LABELS)).toBe('  这本书讲了什么  ');
  });

  it('一条上下文：按【上下文】/【问题】分界，原文完整带进去', () => {
    const out = composeAiPrompt([quote('城外的人想冲进去')], '这句什么意思', LABELS);
    expect(out).toBe(
      '【上下文】\n1. 划线 · 第三章 · 划线\n城外的人想冲进去\n【问题】\n这句什么意思',
    );
  });

  it('多条上下文保持插入顺序', () => {
    const out = composeAiPrompt(
      [quote('第一句'), body('这一屏的正文'), note('围城里的三次围城')],
      '一起说说',
      LABELS,
    );
    expect(out.indexOf('第一句')).toBeLessThan(out.indexOf('这一屏的正文'));
    expect(out.indexOf('这一屏的正文')).toBeLessThan(out.indexOf('围城里的三次围城'));
    expect(out).toContain('2. 正文 · 6 字');
    expect(out).toContain('3. 笔记 · 围城里的三次围城\n读书笔记/围城/主题.md');
    expect(out.endsWith('【问题】\n一起说说')).toBe(true);
  });

  it('截图只有尺寸，没有正文也照样占一条', () => {
    const out = composeAiPrompt(
      [{ kind: 'shot', meta: '250 × 152', thumb: 'data:image/png;base64,AA' }],
      '这块什么意思',
      LABELS,
    );
    expect(out).toContain('1. 截图 · 250 × 152');
    expect(out).toContain('【问题】\n这块什么意思');
  });

  it('截图框里的文字会带进上下文（没有图片通道）', () => {
    const out = composeAiPrompt(
      [{ kind: 'shot', meta: '250 × 152', text: '结婚仿佛金漆的鸟笼' }],
      '这块什么意思',
      LABELS,
    );
    expect(out).toContain('1. 截图 · 250 × 152\n结婚仿佛金漆的鸟笼');
  });

  it('只有上下文、没问题时给一句占位，不把【问题】整段省掉', () => {
    const out = composeAiPrompt([quote('原文')], '  ', LABELS);
    expect(out).toContain('【问题】\n（只带了上下文）');
  });

  it('单条超长文本先按条截断，总上下文再封顶', () => {
    const huge = '字'.repeat(9000);
    const out = composeAiPrompt([quote(huge), body(huge), note('标题')], '问', LABELS);
    const ctxPart = out.slice(0, out.indexOf('【问题】'));
    const chars = Array.from(ctxPart).length;
    expect(chars).toBeLessThanOrEqual(AI_CTX_TOTAL_LIMIT + 16);
    expect(ctxPart).toContain('…');
    /* 截断不能把后面的条目整段吃掉 */
    expect(ctxPart).toContain('笔记');
    expect(ctxPart).toContain('标题');
    expect(out.endsWith('【问题】\n问')).toBe(true);
  });

  it('总上下文超过 6000 字时封顶，尾部条目让位', () => {
    const items = Array.from({ length: 8 }, (_, i) => body(`第${i}段${'字'.repeat(2000)}`));
    const out = composeAiPrompt(items, '问', LABELS);
    const ctxPart = out.slice(0, out.indexOf('【问题】')).trimEnd();
    expect(Array.from(ctxPart).length).toBeLessThanOrEqual(AI_CTX_TOTAL_LIMIT + 8);
    expect(ctxPart.endsWith('…')).toBe(true);
    expect(out).toContain('【问题】\n问');
  });

  it('单条上限是 1200 字：英文也按字符算', () => {
    const out = composeAiPrompt([quote('a'.repeat(AI_CTX_ITEM_LIMIT + 50))], 'q', LABELS);
    const line = out.split('\n')[2] ?? '';
    expect(Array.from(line).length).toBe(AI_CTX_ITEM_LIMIT + 1);
    expect(line.endsWith('…')).toBe(true);
  });
});

describe('clipChars · 摘要截断', () => {
  it('中英文都按 1 个字符算', () => {
    expect(clipChars('围城abc', 5)).toBe('围城abc');
    expect(clipChars('围城abc', 4)).toBe('围城ab…');
  });

  it('刚好等于上限时不加省略号', () => {
    expect(clipChars('12345', 5)).toBe('12345');
  });

  it('空值与 0 上限都安全', () => {
    expect(clipChars('', 10)).toBe('');
    expect(clipChars(null as unknown as string, 10)).toBe('');
    expect(clipChars('abc', 0)).toBe('');
  });
});

describe('ctxChipText · 输入条里那一截', () => {
  it('划线按字数截断', () => {
    expect(ctxChipText(quote('结婚仿佛金漆的鸟笼，笼子外面的鸟想住进去'), LABELS)).toBe(
      '结婚仿佛金漆的鸟笼，…',
    );
  });

  it('正文只报字数，不重复正文', () => {
    expect(ctxChipText({ kind: 'body', text: '正文', chars: 462 }, LABELS)).toBe('正文 · 462 字');
  });

  it('笔记截标题，不截路径', () => {
    expect(ctxChipText(note('围城里的三次围城，兼论婚姻与出走'), LABELS, 9)).toBe(
      '围城里的三次围城，…',
    );
  });

  it('截图用固定文案', () => {
    expect(ctxChipText({ kind: 'shot', meta: '250 × 152' }, LABELS)).toBe('截图');
  });
});

describe('canSendAi · 发送按钮判据', () => {
  it('只有空白不算有内容', () => {
    expect(canSendAi('   \n\t ', [])).toBe(false);
  });

  it('打了字就算', () => {
    expect(canSendAi('问', [])).toBe(true);
  });

  it('没打字但有上下文也算', () => {
    expect(canSendAi('', [quote('原文')])).toBe(true);
  });
});

describe('buildMessages · 拼好的提问原样进 ask', () => {
  it('ask 带 userPrompt 时不再套一层【问题】', () => {
    const msgs = buildMessages({
      task: 'ask',
      text: '这句什么意思',
      title: '围城',
      userPrompt: '【上下文】\n1. 划线 · 第三章\n原文\n【问题】\n这句什么意思',
    });
    const last = msgs.at(-1)!;
    expect(last.content).toBe('【上下文】\n1. 划线 · 第三章\n原文\n【问题】\n这句什么意思');
    expect(last.content.match(/【问题】/g)?.length).toBe(1);
  });

  it('不带 userPrompt 的老口径完全不变', () => {
    const msgs = buildMessages({ task: 'ask', text: '讲了什么', title: '围城' });
    expect(msgs.at(-1)!.content).toBe('【问题】\n讲了什么');
  });
});
