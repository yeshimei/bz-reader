import { describe, expect, it } from 'vitest';
import { ttsProgressHtml, ttsProgressPercent, type TtsTaskState } from '../src/view/tts-progress';

function state(patch: Partial<TtsTaskState> = {}): TtsTaskState {
  return { kind: 'chapter', stage: 'synth', done: 0, total: 100, ...patch };
}

describe('ttsProgressPercent', () => {
  it('按已完成段数算百分比', () => {
    expect(ttsProgressPercent(state({ done: 31, total: 100 }))).toBe(31);
    expect(ttsProgressPercent(state({ done: 1, total: 3 }))).toBe(33);
  });

  it('总数为 0 时不除零，给 0', () => {
    expect(ttsProgressPercent(state({ done: 0, total: 0 }))).toBe(0);
  });

  it('超出或负数都夹在 0–100', () => {
    expect(ttsProgressPercent(state({ done: 120, total: 100 }))).toBe(100);
    expect(ttsProgressPercent(state({ done: -5, total: 100 }))).toBe(0);
  });

  it('完成态一律 100，哪怕计数不全（跳过 / 从缓存命中的边界）', () => {
    expect(ttsProgressPercent(state({ stage: 'done', done: 12, total: 100 }))).toBe(100);
  });
});

describe('ttsProgressHtml 的阶段', () => {
  it('排队：显示阶段名与「正在读取正文」，进度 0', () => {
    const html = ttsProgressHtml(state({ kind: 'book', stage: 'queue', done: 0, total: 0 }));
    expect(html).toContain('排队');
    expect(html).toContain('正在读取');
    expect(html).toContain('aria-valuenow="0"');
  });

  it('处理中：给出百分比、已完成与剩余段数', () => {
    const html = ttsProgressHtml(state({ done: 128, total: 208 }));
    expect(html).toContain('处理中');
    expect(html).toContain('62%');
    expect(html).toContain('128/208');
    expect(html).toContain('还剩 80 段');
    expect(html).toContain('aria-valuenow="62"');
  });

  it('整本：进度里带章序', () => {
    const html = ttsProgressHtml(
      state({ kind: 'book', done: 40, total: 400, chapter: 3, chapters: 12 }),
    );
    expect(html).toContain('第 3/12 章');
  });

  it('收尾：阶段名换成「收尾」，进度沿用整体百分比，不假装 100', () => {
    const html = ttsProgressHtml(
      state({ kind: 'book', stage: 'pack', done: 120, total: 400, chapter: 4, chapters: 12, packed: 3 }),
    );
    expect(html).toContain('收尾');
    expect(html).toContain('第 4/12 章的离线包');
    expect(html).toContain('aria-valuenow="30"');
  });

  it('完成：100%、结果确认、只留关闭不留停止', () => {
    const html = ttsProgressHtml(state({ stage: 'done', done: 208, total: 208 }));
    expect(html).toContain('完成');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('208');
    expect(html).toContain('data-act="progclose"');
    expect(html).not.toContain('data-act="progstop"');
  });

  it('取消：说明已经做好的部分仍然可用，且不给停止', () => {
    const html = ttsProgressHtml(state({ stage: 'cancelled', done: 30, total: 100 }));
    expect(html).toContain('已取消');
    expect(html).toContain('仍然可用');
    expect(html).not.toContain('data-act="progstop"');
  });

  it('失败：写清原因，给重试与关闭', () => {
    const html = ttsProgressHtml(state({ stage: 'failed', reason: '连不上语音服务' }));
    expect(html).toContain('失败');
    expect(html).toContain('连不上语音服务');
    expect(html).toContain('data-act="progretry"');
    expect(html).toContain('data-act="progclose"');
    expect(html).not.toContain('data-act="progstop"');
  });
});

describe('ttsProgressHtml 的异常提示', () => {
  it('没有进展超过阈值：给出秒数与「可能卡住」', () => {
    const html = ttsProgressHtml(state({ stalled: 35 }));
    expect(html).toContain('35 秒');
    expect(html).toContain('可能卡住');
  });

  it('卡得更久：提示升级为建议停止排查', () => {
    const html = ttsProgressHtml(state({ stalled: 120, longStall: true }));
    expect(html).toContain('建议停止');
  });

  it('正常时不出现卡住提示', () => {
    expect(ttsProgressHtml(state())).not.toContain('卡住');
  });

  it('失败原因里的尖括号被转义，不破坏结构', () => {
    const html = ttsProgressHtml(state({ stage: 'failed', reason: '<b>boom</b>' }));
    expect(html).toContain('&lt;b&gt;boom&lt;/b&gt;');
    expect(html).not.toContain('<b>boom</b>');
  });
});
