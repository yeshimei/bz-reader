import { describe, expect, it, vi } from 'vitest';

/* 设置页会读授权状态；测试只关心模板，把授权模块换成固定值 */
vi.mock('../src/data/entitlement', () => ({
  can: () => false,
  entitlement: () => ({ tier: 'free', unlocked: false, license: '' }),
  tierText: () => '当前未激活',
}));

import { DEFAULT_PREFS } from '../src/data/prefs';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { viewSettings } from '../src/shell/render/settings';

const html = (): string =>
  viewSettings({ prefs: DEFAULT_PREFS, settings: DEFAULT_SETTINGS, pen: 'amber', hotkeys: [] });

describe('设置页渲染', () => {
  it('导出目录与数据目录都有文件夹选择钮', () => {
    const out = html();
    expect(out).toContain('data-act="pickexportdir"');
    expect(out).toContain('data-act="pickdatadir"');
    expect(out).toContain('data-act="pickimportdir"');
  });

  it('三个目录都不给手输框，只能从清单里选', () => {
    const out = html();
    expect(out).not.toContain('data-role="datadir"');
    expect(out).not.toContain('data-k="exportDir"');
    /* 导入位置从来没有输入框，这条防回归 */
    expect(out).not.toContain('data-k="importDir"');
  });

  it('不再出现「关于这一版」与它的说明', () => {
    const out = html();
    expect(out).not.toContain('关于这一版');
    expect(out).not.toContain('不联网、不上传');
  });

  it('滑杆渲染时就带上 --fill（否则圆点和已填充段对不上）', () => {
    const out = html();
    expect(out).toMatch(/data-k="fontSize"[^>]*--fill:\d/);
  });

  /* 插件已不再注册 Obsidian 原生设置页，这里是填激活码的唯一入口。
     一旦这组被删或改名，用户就无处可激活——所以钉死输入框与按钮。 */
  it('未激活时给出激活码输入框与激活按钮', () => {
    const out = html();
    expect(out).toContain('<h3>授权</h3>');
    expect(out).toContain('data-role="license"');
    expect(out).toContain('data-act="activate"');
  });
});
