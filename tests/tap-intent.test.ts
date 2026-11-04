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

  /* 写想法也是「点别处就关」，只是关之前要问一句。问不问由 closeOverlay
     根据输入框内容决定；点这一下本身必须先变成关闭请求，否则永远关不掉。 */
  it('写想法开着：点别处是关闭请求，不翻页', () => {
    expect(tapIntent({ selbar: false, mobile: true, overlayKind: 'idea' })).toBe('dismiss-overlay');
    expect(tapIntent({ selbar: false, mobile: false, overlayKind: 'idea' })).toBe('dismiss-overlay');
  });

  it('移动端没有浮层：翻页', () => {
    expect(tapIntent({ selbar: false, mobile: true })).toBe('turn');
  });

  it('桌面没有浮层：也翻页（P2-10 桌面点按翻页）', () => {
    expect(tapIntent({ selbar: false, mobile: false })).toBe('turn');
  });

  it('划词条与浮层同时在：先收条子', () => {
    expect(tapIntent({ selbar: true, mobile: true, overlayKind: 'hltools' })).toBe('dismiss-selbar');
  });
});
