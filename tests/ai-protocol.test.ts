/**
 * 请求协议适配（tests/ai-protocol.test.ts）
 *
 * 自定义通道支持两套报文：OpenAI 兼容 /chat/completions 与 Anthropic
 * /messages。差异全部收在纯函数里，超时 / 流式读取沿用 reader 原有实现。
 */
import { describe, expect, it } from 'vitest';
import { buildChatRequest, chatTextOf, drainChatSse } from '../src/data/ai-protocol';

describe('请求构造', () => {
  it('OpenAI 兼容：Bearer 头、messages 原样、思考参数并入 body', () => {
    const req = buildChatRequest(
      { endpoint: 'https://api.deepseek.com', apiKey: 'sk-d', protocol: 'openai', model: 'deepseek-chat', thinkingBody: { reasoning_effort: 'low' } },
      [{ role: 'system', content: '你好' }, { role: 'user', content: '讲讲' }],
      { stream: true, temperature: 0.3, maxTokens: 2048 },
    );
    expect(req.url).toBe('https://api.deepseek.com/chat/completions');
    expect(req.headers.Authorization).toBe('Bearer sk-d');
    expect(req.body.stream).toBe(true);
    expect(req.body.max_tokens).toBe(2048);
    expect(req.body.reasoning_effort).toBe('low');
    expect(req.body.messages).toHaveLength(2);
  });

  it('Anthropic：x-api-key + 版本头，system 抽到顶层，role 收敛', () => {
    const req = buildChatRequest(
      { endpoint: 'https://api.anthropic.com/v1', apiKey: 'sk-c', protocol: 'anthropic', model: 'claude-x' },
      [{ role: 'system', content: '你是助手' }, { role: 'user', content: '嗨' }],
      { maxTokens: 1024 },
    );
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.headers['x-api-key']).toBe('sk-c');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    expect(req.body.system).toBe('你是助手');
    expect(req.body.messages).toEqual([{ role: 'user', content: '嗨' }]);
    expect(req.body.max_tokens).toBe(1024);
  });
});

describe('非流式正文提取', () => {
  it('OpenAI 读 choices[0].message.content', () => {
    expect(chatTextOf('openai', { choices: [{ message: { content: '答案' } }] })).toBe('答案');
  });

  it('Anthropic 读 content 里的 text 段', () => {
    expect(
      chatTextOf('anthropic', {
        content: [{ type: 'text', text: '你' }, { type: 'text', text: '好' }],
      }),
    ).toBe('你好');
  });
});

describe('流式增量解析', () => {
  it('Anthropic 认 content_block_delta 与 message_stop', () => {
    const frame =
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}\n\n';
    const out = drainChatSse('anthropic', frame);
    expect(out.deltas).toEqual(['你好']);

    const stop = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
    expect(drainChatSse('anthropic', stop).done).toBe(true);
  });

  it('Anthropic 的错误事件暴露给人看', () => {
    const frame = 'event: error\ndata: {"type":"error","error":{"message":"额度不足"}}\n\n';
    expect(drainChatSse('anthropic', frame).error).toBe('额度不足');
  });

  it('OpenAI 兼容仍走原有 [DONE] 与 choices 增量', () => {
    const frame = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    const out = drainChatSse('openai', frame);
    expect(out.deltas).toEqual(['hi']);
    expect(out.done).toBe(true);
  });
});
