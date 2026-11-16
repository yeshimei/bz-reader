import { describe, expect, it } from 'vitest';
import {
  AI_MENU_GROUPS,
  AI_MENU_ITEMS,
  aiArchiveTurns,
  aiFirstPrompt,
  aiFloatMessages,
  aiMenuFallback,
  aiMenuHtml,
  aiTranscript,
} from '../src/shell/ai-menu';
import { aiConversationMarkdown } from '../src/data/ai-save';
import { aiCardHtml } from '../src/shell/reader-cards';

/**
 * 划词 AI：工具条上方平摊五项 → 同一位置换成锚定浮框（原型第 2 稿）。
 *
 * 这一组只测纯函数/字符串模板，不碰 DOM：
 *   · 菜单项的顺序、分组与两种长相（文字 / 图标）；
 *   · 任务 → 首问文案：解释 / 翻译 / 总结有，追问为空（空面板的判据）；
 *   · 浮框里的气泡：解释从「问 + 答」起，追问从空白起；
 *   · 归档把对话映射成「用户问 / AI 答」的轮次，空对话不写盘。
 */

describe('AI 菜单 · 五项与分组', () => {
  it('顺序固定：解释 / 翻译 / 总结 / 追问 / 插入到全书问答', () => {
    expect(AI_MENU_ITEMS.map((item) => item.task)).toEqual([
      'explain',
      'translate',
      'summarize',
      'follow',
      'book',
    ]);
  });

  it('插入到全书问答单独一组（中间一道竖分隔）', () => {
    expect(AI_MENU_GROUPS.map((group) => group.map((item) => item.task))).toEqual([
      ['explain', 'translate', 'summarize', 'follow'],
      ['book'],
    ]);
    const html = aiMenuHtml('text');
    expect(html.match(/data-role="aimenu-divider"/g)).toHaveLength(1);
    /* 分隔落在追问与全书问答之间 */
    const divider = html.indexOf('data-role="aimenu-divider"');
    expect(html.indexOf('data-task="follow"')).toBeLessThan(divider);
    expect(divider).toBeLessThan(html.indexOf('data-task="book"'));
  });

  it('文字模式：五项都带标签与图标，点下去能拿到任务', () => {
    const html = aiMenuHtml('text');
    expect(html).toContain('data-style="text"');
    expect(html.match(/data-act="aimenupick"/g)).toHaveLength(5);
    for (const label of ['解释', '翻译', '总结', '追问', '插入到全书问答']) {
      expect(html).toContain(label);
    }
    /* 两种模式是同一份数据：文字模式也带图标节点，由样式决定露不露 */
    expect(html.match(/data-icon-name=/g)).toHaveLength(5);
  });

  it('图标模式：同一份五项，只把长相切成图标', () => {
    const html = aiMenuHtml('icon');
    expect(html).toContain('data-style="icon"');
    const names = [...html.matchAll(/data-icon-name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([
      'help-circle',
      'languages',
      'list',
      'corner-down-left',
      'panel-right-open',
    ]);
  });

  it('全文问答那颗必须是 panel-right-open，不能复用 AI 按钮的 sparkles', () => {
    const book = AI_MENU_ITEMS.find((item) => item.task === 'book');
    expect(book?.icon).toBe('panel-right-open');
    expect(book?.icon).not.toBe('sparkles');
  });

  it('五项都走同一个动作，任务在 data-task 里', () => {
    const html = aiMenuHtml('text');
    expect([...html.matchAll(/data-task="([^"]+)"/g)].map((m) => m[1])).toEqual([
      'explain',
      'translate',
      'summarize',
      'follow',
      'book',
    ]);
  });
});

describe('任务 → 首问文案', () => {
  it('解释 / 翻译 / 总结各有一句首问', () => {
    expect(aiFirstPrompt('explain')).toBe('解释这一段');
    expect(aiFirstPrompt('translate')).toBe('把这一段翻译成英文');
    expect(aiFirstPrompt('summarize')).toBe('用三句话总结这一段');
  });

  it('追问没有首问：这就是「空面板」的判据', () => {
    expect(aiFirstPrompt('follow')).toBe('');
    expect(
      aiFloatMessages({ mode: 'follow', ask: aiFirstPrompt('follow') }),
    ).toEqual([]);
  });
});

describe('浮框气泡 · 解释从问答起，追问从空白起', () => {
  it('解释：首条是问题，第二条是答案', () => {
    const msgs = aiFloatMessages({
      mode: 'explain',
      ask: aiFirstPrompt('explain'),
      answer: '这句话把婚姻比作金漆的鸟笼。',
    });
    expect(msgs.map((m) => m.role)).toEqual(['me', 'ai']);
    expect(msgs[0].text).toBe('解释这一段');
    expect(msgs[1].text).toBe('这句话把婚姻比作金漆的鸟笼。');
  });

  it('请求还在路上：问题先出现，下面一个等待气泡', () => {
    const msgs = aiFloatMessages({
      mode: 'translate',
      ask: aiFirstPrompt('translate'),
      answer: '',
      busy: true,
    });
    expect(msgs.map((m) => m.role)).toEqual(['me', 'ai']);
    expect(msgs[1]).toMatchObject({ pending: true });
  });

  it('追问空面板：0 条消息', () => {
    expect(aiFloatMessages({ mode: 'follow' })).toEqual([]);
  });

  it('追问发出后：自己那句 + 答案；再问续在轮次里', () => {
    const msgs = aiFloatMessages({
      mode: 'follow',
      ask: '「金漆」两个字是作者自己加的吗？',
      answer: '关键确实在「金漆」。',
      turns: [{ q: '那笼子呢？', a: '笼子就是婚姻。' }],
    });
    expect(msgs.map((m) => m.role)).toEqual(['me', 'ai', 'me', 'ai']);
    expect(msgs[3].text).toBe('笼子就是婚姻。');
  });

  it('失败的一轮把原因留在 AI 气泡里', () => {
    const msgs = aiFloatMessages({
      mode: 'explain',
      ask: aiFirstPrompt('explain'),
      turns: [{ q: '再问', a: '', error: '接口 500' }],
    });
    expect(msgs.at(-1)).toMatchObject({ role: 'ai', text: '接口 500', error: true });
  });

  it('来源跟着各自的答案走，追问气泡带轮次下标（2026-11-17）', () => {
    const head = [{ title: '第一章', bookId: 'b1', text: '红海早过了' }];
    const tail = [{ title: '第二章', bookId: 'b1' }];
    const msgs = aiFloatMessages({
      mode: 'explain',
      ask: '解释这一段',
      answer: '首答',
      sources: head,
      turns: [{ q: '后来呢', a: '追问答', sources: tail }],
    });
    expect(msgs[1].sources).toEqual(head);
    /* 首问 / 首答没有 turn 下标，删按钮只挂追问那一对 */
    expect(msgs[1].turn).toBeUndefined();
    expect(msgs[2]).toMatchObject({ role: 'me', turn: 0 });
    expect(msgs[3]).toMatchObject({ role: 'ai', turn: 0, sources: tail });
  });

  it('复制用的一整段对话带「你 / AI」前缀', () => {
    const text = aiTranscript(
      aiFloatMessages({ mode: 'explain', ask: '解释这一段', answer: '答案' }),
    );
    expect(text).toContain('你：解释这一段');
    expect(text).toContain('AI：答案');
  });
});

describe('浮框模板 · 430×420 的对话', () => {
  /** 原型第 2 稿：顶栏 38 / 引文两行 / 消息区 / 输入行 / 底栏 */
  it('解释：顶栏、引文、问题 + 答案、底栏复制 / 归档', () => {
    const html = aiCardHtml({
      ready: true,
      mode: 'explain',
      quote: '结婚仿佛金漆的鸟笼，笼子外面的鸟想住进去。',
      bookTitle: '围城',
      chapter: '第三章',
      ask: aiFirstPrompt('explain'),
      answer: '这句话把婚姻比作金漆的鸟笼。',
      at: '03:15',
    });
    expect(html).toContain('class="bzs-aifloat"');
    expect(html).toContain('bzs-af-head');
    expect(html).toContain('bzs-af-kind');
    expect(html).toContain('围城 · 第三章');
    expect(html).toContain('bzs-af-quote');
    expect(html).toContain('data-role="aimsgs"');
    expect(html).toContain('bzs-pm is-me');
    expect(html).toContain('bzs-pm is-ai');
    expect(html).toContain('data-ai-md');
    expect(html).toContain('03:15');
    expect(html).toContain('复制');
    expect(html).toContain('归档');
    expect(html).toContain('未归档');
    /* 底栏与发送都是图标钮：复制 / 归档走宿主图标集，发送与想法框同一枚纸飞机 */
    expect(html).toContain('data-icon="copy"');
    expect(html).toContain('data-icon="archive"');
    expect(html).toContain('M4 12l16-7-7 16-2-7z');
    /* 旧结构全部撤掉：三档页签、旧追问输入行、重试 / 存为笔记 */
    expect(html).not.toContain('data-act="aimode"');
    expect(html).not.toContain('class="modes"');
    expect(html).not.toContain('data-act="airetry"');
    expect(html).not.toContain('data-act="aisave"');
  });

  it('追问：空白面板 + 聚焦用的输入框，一条消息都没有', () => {
    const html = aiCardHtml({
      ready: true,
      mode: 'follow',
      quote: '结婚仿佛金漆的鸟笼。',
      bookTitle: '围城',
      chapter: '第三章',
    });
    expect(html).not.toContain('bzs-pm');
    expect(html).toContain('直接问，问题会带着上面那段原文。');
    expect(html).toContain('data-role="aifollow"');
    expect(html).toContain('data-act="aifollow"');
  });

  it('归档之后：按钮变灰，底栏写「已归档 HH:mm」', () => {
    const html = aiCardHtml({
      ready: true,
      mode: 'explain',
      quote: '引文',
      ask: aiFirstPrompt('explain'),
      answer: '答案',
      archivedAt: '14:32',
    });
    /* 浮框的归档与书架「对话」页的归档是两个动作：同名会让后者先匹配，
       浮框那颗按钮拿到空 id、直接报「已删除」。名字必须分开。 */
    expect(html).toMatch(/data-act="aifloatarchive"[^>]*disabled/);
    expect(html).not.toContain('data-act="aiarchive"');
    expect(html).toContain('已归档 14:32');
  });

  it('没配服务：先说清楚，且不摆输入行', () => {
    const html = aiCardHtml({ ready: false, mode: 'explain', quote: '引文' });
    expect(html).toContain('还没有配置 AI 服务');
    expect(html).not.toContain('data-role="aifollow"');
  });

  it('答案与引文都是用户内容，必须转义', () => {
    const html = aiCardHtml({
      ready: true,
      mode: 'explain',
      quote: '<b>引</b>',
      ask: '解释这一段',
      answer: '<img>',
    });
    expect(html).toContain('&lt;img&gt;');
    expect(html).toContain('&lt;b&gt;引&lt;/b&gt;');
  });
});

describe('归档轮次 · 用户问 / AI 答', () => {
  it('首问 + 首答 + 每轮追问都按「问 → 答」排', () => {
    const turns = aiArchiveTurns('explain', {
      ask: aiFirstPrompt('explain'),
      text: '首答',
      turns: [{ q: '追问一', a: '回答一' }, { q: '追问二', a: '回答二' }],
    });
    expect(turns.map((turn) => turn.me)).toEqual([true, false, true, false, true, false]);
    expect(turns.map((turn) => turn.text)).toEqual([
      '解释这一段',
      '首答',
      '追问一',
      '回答一',
      '追问二',
      '回答二',
    ]);
  });

  it('追问面板的首问就是用户打的那句', () => {
    const turns = aiArchiveTurns('follow', { ask: '为什么是鸟笼？', text: '因为进出的人看到的是两面。' });
    expect(turns).toEqual([
      { me: true, text: '为什么是鸟笼？' },
      { me: false, text: '因为进出的人看到的是两面。' },
    ]);
  });

  it('空对话 / 失败轮次不写盘', () => {
    expect(aiArchiveTurns('follow', {})).toEqual([]);
    const turns = aiArchiveTurns('explain', {
      ask: '解释这一段',
      text: '首答',
      turns: [{ q: '问了一半', a: '', error: '接口 500' }],
    });
    expect(turns).toHaveLength(2);
    expect(aiConversationMarkdown({ day: '2026-11-16', turns: [] })).toBe('');
  });
});

/**
 * 再点一次 AI 把菜单收起来之后，落到哪一层（2026-11-16）。
 *
 * 以前悬停开的那行是自己「移走就收」，收起时直接退回划线工具条。现在
 * 改成点击开合，收起也要落在同一个地方：手不用重新去找那条工具条。
 */
describe('AI 菜单收起后的落点', () => {
  it('从划线进来的：退回那条工具条，markId 与锚点原样带着', () => {
    const anchor = { left: 10, top: 20, width: 30, height: 0 };
    expect(aiMenuFallback({ markId: 'm1', bookId: 'b1', anchor })).toEqual({
      kind: 'hltools',
      markId: 'm1',
      bookId: 'b1',
      anchor,
    });
  });

  it('从选区进来的（没有划线）：没有工具条这一层可退', () => {
    expect(aiMenuFallback({ bookId: 'b1' })).toBeNull();
  });
});
