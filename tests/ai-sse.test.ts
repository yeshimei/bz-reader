/**
 * 流式切帧（tests/ai-sse.test.ts）
 *
 * `fetch` 的 body 是任意边界的字节流：一帧可能被切成两半，汉字的
 * 三个字节也可能被切开。这里锁住「切到哪儿算一帧」「剩下的怎么留」——
 * 切错了的表现是「答到一半突然没了」或者「一个字都不出」。
 */
import { describe, expect, it } from 'vitest';
import { drainSse } from '../src/data/ai-sse';

const frame = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (text: string): string => frame({ choices: [{ delta: { content: text } }] });

describe('drainSse', () => {
  it('一条完整帧取出一段文字', () => {
    const out = drainSse(delta('围城'));
    expect(out.deltas).toEqual(['围城']);
    expect(out.done).toBe(false);
    expect(out.rest).toBe('');
  });

  it('多帧按顺序取', () => {
    const out = drainSse(delta('婚姻') + delta('是一座') + delta('围城'));
    expect(out.deltas).toEqual(['婚姻', '是一座', '围城']);
  });

  it('半帧留着，不吐半个字', () => {
    const whole = delta('围城');
    const out = drainSse(whole.slice(0, 12));
    expect(out.deltas).toEqual([]);
    expect(out.rest).toBe(whole.slice(0, 12));
  });

  it('接着上一次的尾巴能拼回完整帧', () => {
    const whole = delta('围城');
    const cut = 12;
    const first = drainSse(whole.slice(0, cut));
    const second = drainSse(first.rest + whole.slice(cut));
    expect(second.deltas).toEqual(['围城']);
  });

  it('[DONE] 只标结束，不当正文', () => {
    const out = drainSse(`data: [DONE]\n\n`);
    expect(out.done).toBe(true);
    expect(out.deltas).toEqual([]);
  });

  it('\\r\\n\\r\\n 也认（不认就一个字都不出）', () => {
    const out = drainSse('data: {"choices":[{"delta":{"content":"好"}}]}\r\n\r\n');
    expect(out.deltas).toEqual(['好']);
  });

  it('心跳与只带 role 的空帧跳过', () => {
    const out = drainSse(`: ping\n\n${delta('甲')}${frame({ choices: [{ delta: { role: 'assistant' } }] })}`);
    expect(out.deltas).toEqual(['甲']);
  });

  it('坏 JSON 不炸整条回答（已经收到的字还要留着）', () => {
    const out = drainSse(`data: {"choices":[{"delta":{"content":"半` + '\n\n' + delta('城'));
    expect(out.deltas).toEqual(['城']);
  });

  it('数组分段的老形状也认（与 chatText 同一口径）', () => {
    const out = drainSse(frame({ choices: [{ delta: { content: [{ type: 'text', text: '甲' }, { type: 'text', text: '乙' }] } }] }));
    expect(out.deltas).toEqual(['甲乙']);
  });

  it('尾部残帧原样返回，不重复消费', () => {
    const out = drainSse(delta('甲') + 'data: {"choices":[{"delta"');
    expect(out.deltas).toEqual(['甲']);
    expect(out.rest.startsWith('data: {"choices"')).toBe(true);
  });
});
