/**
 * 设置页 AI 组 · 「连接至 BZ AI 知识库」（tests/settings-kb-row.test.ts）
 *
 * 2026-11-07：这一行原来叫「向量库」，右边报「未检测到第二大脑」，下面再挂一段
 * 「装上并启用 bz…才能建索引」。三个问题：
 *   1. 标签是实现名词（向量），不是用户要得到的东西（知识库）；
 *   2. 品牌词「第二大脑」在标题与正文里各出现一次，读起来像两个东西；
 *   3. 连不上时只说明失败，不给下一步——用户点完也不知道该干什么。
 *
 * 现在钉死的是：**状态只有连没连上，连不上时给一个教程出口。**
 *   · 连上（bz 在且有嵌入模型）→ 「已连接」，不出教程按钮；
 *   · 连不上（没装 / 装了没配模型 / 探测不到）→ 「未连接」+ 观看视频教程；
 *   · 两种状态共用同一句功能说明，不随连接变化。
 *
 * 「全书画像 / 清理无主画像」整行撤掉——这一组不再提画像。
 */
import { describe, expect, it, vi } from 'vitest';

/* 设置页会读授权状态。这里默认已解锁：只有解锁时「清理无主画像」原来才会渲染，
   不解锁就等于测不到「它被删了」。 */
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

/** 功能说明：两种连接状态共用，一个字都不该随状态变 */
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

/** 截出 AI 组：只看组内，不误判授权组、数据组 */
function aiGroup(out: string): string {
  const start = out.indexOf('<h3>AI 助手</h3>');
  const next = out.indexOf('<h3>', start + 1);
  expect(start, '有 AI 组').toBeGreaterThan(-1);
  return out.slice(start, next < 0 ? undefined : next);
}

const LINKED: SettingsView['bz'] = {
  ok: true,
  version: '1.40.0',
  model: 'bge-m3',
  entry: true,
  notes: true,
};

describe('AI 组 · 连接至 BZ AI 知识库', () => {
  it('标签是「连接至 BZ AI 知识库」，不再是「向量库」', () => {
    const g = aiGroup(html());
    expect(g).toContain('<label>连接至 BZ AI 知识库</label>');
    expect(g).not.toContain('<label>向量库</label>');
  });

  it('文案里不再有「第二大脑」这个旧名字', () => {
    expect(html()).not.toContain('第二大脑');
    expect(html(LINKED)).not.toContain('第二大脑');
  });

  /* 「全书画像」整行带走的是唯一一个清无主画像的入口。
     这条钉的是「删干净了」：行、按钮、动作都不该再出现。 */
  it('「全书画像 / 清理无主画像」整行不见（解锁时也不渲染）', () => {
    entState.unlocked = true;
    const g = aiGroup(html(LINKED));
    expect(g).not.toContain('全书画像');
    expect(g).not.toContain('清理无主画像');
    expect(g).not.toContain('data-act="ptclean"');
  });

  it('连上：写「已连接」，且不摆教程按钮', () => {
    const g = aiGroup(html(LINKED));
    expect(g).toContain('已连接');
    expect(g).not.toContain('未连接');
    expect(g).not.toContain('data-act="aitutorial"');
  });

  it('连上时不显示模型名（模型是内部细节，状态只说连没连上）', () => {
    const g = aiGroup(html(LINKED));
    expect(g).not.toContain('bge-m3');
  });

  it('没探测到 bz：写「未连接」，并给出观看视频教程', () => {
    const g = aiGroup(html());
    expect(g).toContain('未连接');
    expect(g).not.toContain('已连接');
    expect(g).toContain('data-act="aitutorial"');
  });

  it('bz 在但没选嵌入模型：也算没连上（建不了索引就是没连上）', () => {
    const g = aiGroup(html({ ...LINKED, model: '' }));
    expect(g).toContain('未连接');
    expect(g).toContain('data-act="aitutorial"');
  });

  it('两种状态都带同一句功能说明', () => {
    expect(aiGroup(html(LINKED))).toContain(HINT);
    expect(aiGroup(html())).toContain(HINT);
  });

  /* 旧版那句「装上并启用 bz…才能建索引」整段撤掉：安装步骤属于教程，
     摆在这里既占地方，也和教程按钮抢同一件事。 */
  it('不再渲染安装步骤那两句旧说明', () => {
    const out = html();
    expect(out).not.toContain('装上并启用 bz');
    expect(out).not.toContain('划词与提问都只用到这本书');
  });
});
