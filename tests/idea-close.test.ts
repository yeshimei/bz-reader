import { beforeEach, describe, expect, it } from 'vitest';
import {
  cancelIdeaClose,
  closeOverlay,
  dismissesOnSelect,
  dismissesOnTap,
  getState,
  markIdeaDirty,
  openOverlay,
  setIdeaDraft,
} from '../src/shell/state';

/**
 * 写想法怎么退出（真机反馈）。
 *
 * 规则只有三条：
 *   1. 输入框是空的 → 点别处直接关，不打扰；
 *   2. 输入框有字   → 先亮「还有没保存的内容」那一条，再点一次才真关；
 *   3. 点发送键     → 存完直接关，不问（用户已经在表达了「我要这个」）。
 *
 * 以前整条路径是不通的：`dismissesOnOutside('idea')` 恒为 false，点别处
 * 连关闭请求都发不出去，「保护输入」被实现成了「根本关不掉」。
 */

function openIdea(): void {
  openOverlay({ kind: 'idea', markId: 'm1', bookId: 'b1' });
}

/** 模拟在输入框里打字：草稿与「改动过」两个状态一起变 */
function typeIdea(v: string, saved = ''): void {
  setIdeaDraft(v);
  markIdeaDirty(v.trim() !== saved.trim());
}

beforeEach(() => {
  closeOverlay({ force: true });
});

describe('点别处退出写想法', () => {
  it('输入框空的：直接关，不弹确认', () => {
    openIdea();
    closeOverlay();
    expect(getState().overlay).toBeNull();
    expect(getState().ideaConfirm).toBe(false);
  });

  it('输入框有字：第一次只亮确认条，浮层留着', () => {
    openIdea();
    typeIdea('想到外婆');
    closeOverlay();
    expect(getState().overlay?.kind).toBe('idea');
    expect(getState().ideaConfirm).toBe(true);
  });

  it('确认条亮着再点一次：真的关掉', () => {
    openIdea();
    typeIdea('想到外婆');
    closeOverlay();
    closeOverlay();
    expect(getState().overlay).toBeNull();
  });

  it('点「继续写」：收掉确认条，草稿原样还在', () => {
    openIdea();
    typeIdea('想到外婆');
    closeOverlay();
    cancelIdeaClose();
    expect(getState().ideaConfirm).toBe(false);
    expect(getState().overlay?.kind).toBe('idea');
    expect(getState().ideaDraft).toBe('想到外婆');
  });

  it('保存：有内容也直接关，不弹确认', () => {
    openIdea();
    typeIdea('想到外婆');
    closeOverlay({ force: true });
    expect(getState().overlay).toBeNull();
  });

  it('编辑已有想法但一个字没改：直接关（没有东西可丢）', () => {
    openIdea();
    setIdeaDraft('原来的想法');
    markIdeaDirty(false);
    closeOverlay();
    expect(getState().overlay).toBeNull();
  });

  it('把已有想法清空：算改动，仍然要确认一次', () => {
    openIdea();
    typeIdea('', '原来的想法');
    closeOverlay();
    expect(getState().ideaConfirm).toBe(true);
  });

  it('关掉后草稿清空，下次点开是书里存的那条', () => {
    openIdea();
    typeIdea('临时写了一半');
    closeOverlay({ force: true });
    expect(getState().ideaDraft).toBeNull();
    openIdea();
    expect(getState().ideaDraft).toBeNull();
  });
});

describe('哪些「别处」算关闭请求', () => {
  it('点一下：浮层都算（写想法交给 closeOverlay 决定问不问）', () => {
    expect(dismissesOnTap('idea')).toBe(true);
    expect(dismissesOnTap('quote')).toBe(true);
    expect(dismissesOnTap('hltools')).toBe(true);
    expect(dismissesOnTap('footnote')).toBe(true);
  });

  it('点一下：带遮罩的弹层不归这条管', () => {
    expect(dismissesOnTap('search')).toBe(false);
    expect(dismissesOnTap('unlock')).toBe(false);
    expect(dismissesOnTap(null)).toBe(false);
  });

  it('开始新划词：写想法不跟着收（要选正文粘进去）', () => {
    expect(dismissesOnSelect('idea')).toBe(false);
    expect(dismissesOnSelect('quote')).toBe(true);
    expect(dismissesOnSelect('hltools')).toBe(true);
  });
});
