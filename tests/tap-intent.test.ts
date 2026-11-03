import { describe, expect, it } from 'vitest';
import { tapIntent } from '../src/view/tap-intent';

/**
 * 点正文这一下到底该干什么（纯函数，node 里直接测）。
 *
 * 真机反馈：划词条挂着的时候点别处，期望是「把条子收掉」，
 * 实际是页面翻走了——条子 320ms 后才自己消失。
 *
 * 优先级：划词条 > 浮层 > 翻页。划词条是最后出现的那个控件，
 * 手指点下去先要收的就是它。
 */
describe('tapIntent', () => {
  it('划词条开着：只收条子，不翻页（桌面手机一样）', () => {
    expect(tapIntent({ selbar: true, mobile: true })).toBe('dismiss-selbar');
    expect(tapIntent({ selbar: true, mobile: false })).toBe('dismiss-selbar');
  });

  it('书摘 / AI 浮层开着：关浮层，不翻页', () => {
    expect(tapIntent({ selbar: false, mobile: true, overlayKind: 'quote' })).toBe('dismiss-overlay');
    expect(tapIntent({ selbar: false, mobile: true, overlayKind: 'ai' })).toBe('dismiss-overlay');
  });

  it('写想法开着：不关也不翻（内容是正在打的字）', () => {
    expect(tapIntent({ selbar: false, mobile: true, overlayKind: 'idea' })).toBe('idle');
  });

  it('移动端没有浮层：翻页', () => {
    expect(tapIntent({ selbar: false, mobile: true })).toBe('turn');
  });

  it('桌面没有浮层：不翻页（桌面靠按钮和方向键）', () => {
    expect(tapIntent({ selbar: false, mobile: false })).toBe('idle');
  });

  it('划词条与浮层同时在：先收条子', () => {
    expect(tapIntent({ selbar: true, mobile: true, overlayKind: 'hltools' })).toBe('dismiss-selbar');
  });
});
