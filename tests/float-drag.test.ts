import { describe, expect, it } from 'vitest';
import { aiFloatIdentity, dragPosition, floatBoxStyle } from '../src/shell/float-drag';

/**
 * 拖动浮窗的落点（纯函数）。
 *
 * 定住之后那张追问卡可以拖到任意地方，但不能拖出屏幕：手一滑把窗口
 * 甩到可视区外面，就再也抓不回来了——没有标题栏可点，也没有滚动条。
 */

const VIEW = { width: 1000, height: 700 };
const SIZE = { width: 400, height: 300 };

describe('dragPosition', () => {
  it('按位移走：起点加位移，尺寸不变', () => {
    expect(dragPosition({ left: 100, top: 80 }, { dx: 30, dy: -20 }, SIZE, VIEW)).toEqual({
      left: 130,
      top: 60,
    });
  });

  it('往左上拖过头：贴住上边与左边', () => {
    expect(dragPosition({ left: 20, top: 10 }, { dx: -200, dy: -200 }, SIZE, VIEW)).toEqual({
      left: 0,
      top: 0,
    });
  });

  it('往右下拖过头：贴住下边与右边（视口减自身）', () => {
    expect(dragPosition({ left: 100, top: 100 }, { dx: 5000, dy: 5000 }, SIZE, VIEW)).toEqual({
      left: 600,
      top: 400,
    });
  });

  it('窗口比面板还窄：落点不出现负数', () => {
    expect(
      dragPosition({ left: 0, top: 0 }, { dx: 50, dy: 50 }, { width: 900, height: 500 }, {
        width: 600,
        height: 400,
      }),
    ).toEqual({ left: 0, top: 0 });
  });

  it('有顶部偏移（手机键盘 / 视觉视口）时上边界跟着走', () => {
    const view = { width: 1000, height: 600, top: 40 };
    expect(dragPosition({ left: 10, top: 50 }, { dx: 0, dy: -100 }, SIZE, view)).toEqual({
      left: 10,
      top: 40,
    });
  });
});

/**
 * 「这张卡」的身份不能认 markId：追问发出去那一刻会新建划线，位置刚摆好
 * 就被判成换卡弹回去——真机上用户明确报过这一点（2026-11-16）。
 */
describe('aiFloatIdentity', () => {
  const card = {
    kind: 'ai',
    bookId: 'b1',
    mode: 'follow',
    text: '结婚仿佛金漆的鸟笼',
    markId: '',
  };

  it('追问发出去、markId 从空变成线 id：还是同一张卡', () => {
    expect(aiFloatIdentity(card)).toBe(aiFloatIdentity({ ...card, markId: 'm1' }));
  });

  it('换原文 / 换书 / 换档就是另一张卡：位置不该带过去', () => {
    const base = aiFloatIdentity(card);
    expect(aiFloatIdentity({ ...card, text: '另一段' })).not.toBe(base);
    expect(aiFloatIdentity({ ...card, bookId: 'b2' })).not.toBe(base);
    expect(aiFloatIdentity({ ...card, mode: 'explain' })).not.toBe(base);
  });

  it('不是 AI 卡：没有身份', () => {
    expect(aiFloatIdentity({ kind: 'idea' })).toBe('');
  });

  /* 清空对话的二次确认带着卡片的全部字段，点「取消」原地开回来——
     拖出来的位置与定住状态都得还在，所以它算同一张卡。 */
  it('清空确认层还是同一张卡：取消回来位置不丢', () => {
    expect(aiFloatIdentity({ ...card, kind: 'aiclear' })).toBe(aiFloatIdentity(card));
  });
});

/**
 * 位置写进模板（2026-11-16）：卡片第一次画出来就在最终坐标上。
 * 以前是「先画在原文旁边，再量一次位置补一个位移」，每次重画都会闪一下。
 */
describe('floatBoxStyle', () => {
  it('固定定位 + 视口坐标，画出来即在那一处', () => {
    const style = floatBoxStyle({ left: 180, top: 96, width: 430 }, true);
    expect(style).toContain('position:fixed');
    expect(style).toContain('left:180px');
    expect(style).toContain('top:96px');
  });

  it('宽度用 min() 兜住窄窗口，不写死 430', () => {
    expect(floatBoxStyle({ left: 0, top: 0, width: 430 }, true)).toContain('width:min(430px,calc(100vw - 24px))');
  });

  it('高度上限跟着视口算：拖得越靠下，卡片自己收得越短', () => {
    expect(floatBoxStyle({ left: 10, top: 120, width: 430 }, true)).toContain(
      'max-height:calc(100vh - 120px - 12px)',
    );
  });

  it('坐标取整：小数会让内联样式每隔一帧都不一样', () => {
    expect(floatBoxStyle({ left: 180.6, top: 96.4, width: 430.5 }, true)).toContain('left:181px');
    expect(floatBoxStyle({ left: 180.6, top: 96.4, width: 430.5 }, true)).toContain('top:96px');
  });

  /* 没定住时它还不是「自己的窗口」：外层浮层收掉（文字工具条一关），
     卡片也得跟着走。固定定位会让它留在半空——真机截图里就是这么分家的。 */
  it('没定住：留在浮层里跟着走，不固定到视口', () => {
    const style = floatBoxStyle({ left: 180, top: 96, width: 430 }, false);
    expect(style).toContain('position:relative');
    expect(style).not.toContain('position:fixed');
  });

  it('定住：才是视口里的独立窗口', () => {
    expect(floatBoxStyle({ left: 180, top: 96, width: 430 }, true)).toContain('position:fixed');
  });
});
