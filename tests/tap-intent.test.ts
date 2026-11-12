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
    /* 手机不看桌面那个开关：那里点按是唯一的翻页手势 */
    expect(tapIntent({ selbar: false, mobile: true, desktopTurn: false })).toBe('turn');
  });

  /* 2026-11-12：桌面默认不再点一下就翻页——正文点下去是用来选字的，
     一页被卷走比「点了没反应」更恼人。触屏笔记本想用手指点，去设置里打开。 */
  it('桌面没有浮层：默认不翻页', () => {
    expect(tapIntent({ selbar: false, mobile: false })).toBe('idle');
    expect(tapIntent({ selbar: false, mobile: false, desktopTurn: false })).toBe('idle');
  });

  it('桌面打开了「点击翻页」：翻页', () => {
    expect(tapIntent({ selbar: false, mobile: false, desktopTurn: true })).toBe('turn');
  });

  it('划词条与浮层同时在：先收条子', () => {
    expect(tapIntent({ selbar: true, mobile: true, overlayKind: 'hltools' })).toBe('dismiss-selbar');
  });
});
