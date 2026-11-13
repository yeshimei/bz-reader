/**
 * 设置页 AI 组 · 知识库那一行搬走了（tests/settings-kb-row.test.ts）
 *
 * 这一行的历史：2026-11-07 从实现名词「向量库」改名成用户要得到的东西
 * 「连接至 BZ AI 知识库」，并定下口径——状态只说连没连上，不报模型名、
 * 不摆开关（检测到 bz 就自动连）。
 *
 * 2026-11-13 它跟剪藏本一起抽进了独立的 bz 组，行为断言迁到
 * `tests/settings-bz-group.test.ts`。这个文件只保留两条「搬干净了」：
 *   · AI 组里不该再有这一行——同一件事在页面上有两处说法，改一处就会漏；
 *   · 旧文案不许回潮：「第二大脑」是旧名字，那两句安装步骤说明归教程。
 */
import { describe, expect, it, vi } from 'vitest';

const entState = vi.hoisted(() => ({ unlocked: true }));
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return {
    ...actual,
    can: () => entState.unlocked,
    entitlement: () => ({
      tier: entState.unlocked ? 'paid' : 'free',
      unlocked: entState.unlocked,
      license: 'BZR2.old-code',
    }),
    tierText: () => (entState.unlocked ? '高级版已激活' : '当前未激活'),
  };
});

import { DEFAULT_PREFS } from '../src/data/prefs';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { viewSettings, type SettingsView } from '../src/shell/render/settings';

const HINT =
  '在划词中添加存为名词 / 存为段落，可以为书籍建立本地向量化索引，提问时会一并参考库里的笔记。';

function html(bz?: SettingsView['bz']): string {
  return viewSettings({
    prefs: DEFAULT_PREFS,
    settings: DEFAULT_SETTINGS,
    pen: 'amber',
    hotkeys: [],
    version: '0.1.2',
    bz,
  });
}

function aiGroup(out: string): string {
  const start = out.indexOf('<h3>AI 助手</h3>');
  const next = out.indexOf('<h3>', start + 1);
  expect(start, '有 AI 组').toBeGreaterThan(-1);
  return out.slice(start, next < 0 ? undefined : next);
}

const LINKED: SettingsView['bz'] = {
  ok: true,
  version: '1.47.2',
  model: 'bge-m3',
  entry: true,
  notes: true,
};

describe('AI 组 · 知识库那一行已经搬进 bz 组', () => {
  it('AI 组里不再有这一行的标签与说明', () => {
    for (const bz of [undefined, LINKED]) {
      const g = aiGroup(html(bz));
      expect(g).not.toContain('连接至 BZ AI 知识库');
      expect(g).not.toContain(HINT);
    }
  });

  it('搬过去之后，整页只有一处说这件事', () => {
    const out = html(LINKED);
    expect(out.match(/连接至 BZ AI 知识库/g) ?? []).toHaveLength(0);
    expect(out.match(new RegExp(HINT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).toHaveLength(1);
  });
});

describe('AI 组 · 旧文案不许回潮', () => {
  it('文案里不再有「第二大脑」这个旧名字', () => {
    expect(html()).not.toContain('第二大脑');
    expect(html(LINKED)).not.toContain('第二大脑');
  });

  /* 安装步骤属于教程：写在设置行里既占地方，又和教程按钮抢同一件事 */
  it('不再渲染那两句安装步骤旧说明', () => {
    const out = html();
    expect(out).not.toContain('装上并启用 bz');
    expect(out).not.toContain('划词与提问都只用到这本书');
  });
});
