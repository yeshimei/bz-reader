import { describe, expect, it } from 'vitest';
import { isFloatOverlay, opensTextPanel, overlayKey, overlayRenderKey } from '../src/shell/state';

describe('overlayKey', () => {
  it('关闭状态是空串', () => {
    expect(overlayKey(null)).toBe('');
    expect(overlayKey(undefined)).toBe('');
  });

  it('同 kind 换内容（第二条脚注）也要换键', () => {
    const a = overlayKey({ kind: 'footnote', text: '注一', href: 'x#1' });
    const b = overlayKey({ kind: 'footnote', text: '注二', href: 'x#2' });
    expect(a).not.toBe(b);
  });

  it('同 kind 换标注（文字工具框）也要换键', () => {
    expect(overlayKey({ kind: 'hltools', markId: 'm1' })).not.toBe(overlayKey({ kind: 'hltools', markId: 'm2' }));
  });

  it('锚点变化也算内容变化（卡片要跟着挪）', () => {
    const a = overlayKey({ kind: 'hltools', markId: 'm1', anchor: { left: 10, top: 20 } });
    const b = overlayKey({ kind: 'hltools', markId: 'm1', anchor: { left: 11, top: 20 } });
    expect(a).not.toBe(b);
  });

  it('完全相同的内容键稳定', () => {
    const make = () => overlayKey({ kind: 'idea', markId: 'm1', bookId: 'b1' });
    expect(make()).toBe(make());
  });
});

describe('overlayRenderKey', () => {
  /* 真机发现：确认条是一次「同 kind 的内部状态变化」，overlayKey 看不出
     区别，订阅方就跳过重画——那条「还有没保存的内容」永远不出现，
     而状态里已经置了 true，下一次点别处直接把内容丢了。 */
  it('写想法的确认条亮起 / 收起都要换键', () => {
    const o = { kind: 'idea', markId: 'm1', bookId: 'b1' } as const;
    const off = overlayRenderKey({ overlay: o, ideaConfirm: false });
    const on = overlayRenderKey({ overlay: o, ideaConfirm: true });
    expect(on).not.toBe(off);
  });

  it('别的弹层没有确认条这回事，键不受影响', () => {
    const o = { kind: 'quote', text: '一段原文' } as const;
    expect(overlayRenderKey({ overlay: o, ideaConfirm: true })).toBe(
      overlayRenderKey({ overlay: o, ideaConfirm: false }),
    );
  });

  it('没有弹层时是空串（和 overlayKey 一致）', () => {
    expect(overlayRenderKey({ overlay: null, ideaConfirm: false })).toBe('');
  });
});

describe('isFloatOverlay', () => {
  it('无遮罩浮层（含阅读页工具条）为真', () => {
    for (const kind of ['typography', 'hltools', 'footnote', 'idea'] as const) {
      expect(isFloatOverlay(kind)).toBe(true);
    }
  });

  it('有遮罩的弹层为假（点正文不该关它）', () => {
    for (const kind of ['search', 'import', 'unlock', 'finish'] as const) {
      expect(isFloatOverlay(kind)).toBe(false);
    }
    expect(isFloatOverlay(undefined)).toBe(false);
  });

  /* 桌面删除确认从大弹窗改成贴字的一条之后，点正文也得能关掉它——
     否则卡片留在屏幕上，正文却先翻走了。 */
  it('删除确认条算浮层', () => {
    expect(isFloatOverlay('confirmdel')).toBe(true);
  });
});

/**
 * 文字面板一开，书里那条选区就该收掉。
 *
 * 手机上系统会一直挂着选择手柄与「复制 / 全选」菜单，面板正好开在它们下面：
 * 手柄压在卡片角上，菜单直接盖住引文。清选区的时机只在「打开」那一下——
 * 面板之间互切时选区早就没了，再清一次是空转。
 */
describe('opensTextPanel', () => {
  it('从没有浮层到想法 / 书摘 / AI 都算刚打开', () => {
    expect(opensTextPanel(undefined, 'idea')).toBe(true);
    expect(opensTextPanel(null, 'quote')).toBe(true);
    expect(opensTextPanel('hltools', 'ai')).toBe(true);
  });

  it('面板之间互切不算：选区已经清过了', () => {
    expect(opensTextPanel('idea', 'quote')).toBe(false);
    expect(opensTextPanel('quote', 'ai')).toBe(false);
    expect(opensTextPanel('idea', 'idea')).toBe(false);
  });

  it('关掉面板不是打开', () => {
    expect(opensTextPanel('idea', null)).toBe(false);
    expect(opensTextPanel(undefined, undefined)).toBe(false);
  });

  it('别的浮层不算文字面板', () => {
    expect(opensTextPanel(undefined, 'hltools')).toBe(false);
    expect(opensTextPanel(undefined, 'footnote')).toBe(false);
    expect(opensTextPanel(undefined, 'typography')).toBe(false);
  });
});
