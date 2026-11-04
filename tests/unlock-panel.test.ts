import { describe, expect, it, vi } from 'vitest';
import { GROUP_ID } from '../src/data/entitlement';
import { copyGroupIdForTrial, trialButtonHtml } from '../src/shell/group';

/**
 * 解锁弹层里的群入口。
 *
 * 只留一颗按钮「进群领试用 · 群号」：复制群号和领试用本来是同一个动作，
 * 拆成两颗按钮会让人以为有两条不同的路。点一下复制群号，7 天试用码由
 * 群管理员人工发，插件不假装能自动开通。
 */
describe('解锁弹层 · 进群领试用', () => {
  it('按钮写明「进群领试用」并直接带群号', () => {
    const html = trialButtonHtml();
    expect(html).toContain('进群领试用');
    expect(html).toContain(GROUP_ID);
    expect(html).toContain('data-act="jointrial"');
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
