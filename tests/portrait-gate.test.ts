import { describe, expect, it } from 'vitest';
import { portraitBlock } from '../src/data/portrait-gate';

const base = {
  plan: 'vector' as const,
  mobile: false,
  bookId: 'b1',
  openBookId: 'b1',
  embedReady: true,
  aiReady: true,
};

/**
 * 建画像前的拦截（回归 f9ff6d3）。
 *
 * 这个 bug 没有可见症状：从书籍详情给另一本书建画像，取到的是**正在读的
 * 那本**的正文——向量全错，界面一切正常。所以判定必须被测试钉住，
 * 不能只靠「我记得加了这一段」。
 *
 * 2026-11-07：向量方案不再看 bz，只看自己配没配嵌入模型。
 */
describe('建画像前的拦截', () => {
  it('条件齐了才放行', () => {
    expect(portraitBlock(base)).toBe(null);
  });

  it('开的是另一本书 → 拦（就是 f9ff6d3 修的那个）', () => {
    expect(portraitBlock({ ...base, openBookId: 'b2' })).toBe('otherBook');
  });

  it('压根没开书 → 拦，且和「开错书」分开说', () => {
    expect(portraitBlock({ ...base, openBookId: '' })).toBe('noBook');
  });

  it('手机端不建：先于其它条件判断（手机上一律只说这一句）', () => {
    expect(portraitBlock({ ...base, mobile: true })).toBe('mobile');
    expect(portraitBlock({ ...base, mobile: true, openBookId: '', embedReady: false })).toBe('mobile');
  });

  it('向量方案缺嵌入服务 → 拦（bz 在不在不再影响）', () => {
    expect(portraitBlock({ ...base, embedReady: false })).toBe('noEmbed');
  });

  it('压缩方案不看嵌入，只看对话模型配没配', () => {
    const compress = { ...base, plan: 'compress' as const };
    expect(portraitBlock({ ...compress, embedReady: false })).toBe(null);
    expect(portraitBlock({ ...compress, aiReady: false })).toBe('noAi');
  });

  it('向量方案不看对话模型：算向量是嵌入接口的事', () => {
    expect(portraitBlock({ ...base, aiReady: false })).toBe(null);
  });

  it('书的问题优先于服务的问题：先让用户把书打开，再说缺什么', () => {
    expect(portraitBlock({ ...base, openBookId: 'b2', embedReady: false })).toBe('otherBook');
  });
});
