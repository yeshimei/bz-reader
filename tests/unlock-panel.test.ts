import { describe, expect, it, vi } from 'vitest';
import { GROUP_ID, TRIAL_ACTIVE } from '../src/data/entitlement';
import { copyGroupIdForTrial, trialButtonHtml } from '../src/shell/group';

/**
 * 解锁弹层里的群入口。
 *
 * 2026-11-03 起不对外发试用（TRIAL_ACTIVE = false），授权状态机要求
 * 「界面上一个字都不提试用」，所以整颗按钮不渲染。留着它等于让用户
 * 去群里领一枚根本不存在的码。恢复试用只要把开关打开，按钮自己回来。
 */
describe('解锁弹层 · 群入口', () => {
  it('不发试用时不渲染「进群领试用」', () => {
    expect(TRIAL_ACTIVE).toBe(false);
    expect(trialButtonHtml()).toBe('');
  });

  it('点击把群号写进剪贴板', async () => {
    const writes: string[] = [];
    vi.stubGlobal('navigator', {
      clipboard: { writeText: async (text: string) => void writes.push(text) },
    });
    await copyGroupIdForTrial();
    expect(writes).toEqual([GROUP_ID]);
    vi.unstubAllGlobals();
  });
});
