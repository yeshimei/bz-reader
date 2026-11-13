/**
 * 设置页 bz 组（tests/settings-bz-group.test.ts）
 *
 * 从 AI 组里抽出来的两项：剪藏本、AI 知识盒。
 * 三个决定，这里逐条钉住：
 *   1. **剪藏本是要人开的开关**，只有装了 bz 才出现——没装时连开关都不画，
 *      摆一颗灰开关只会让人以为「我点坏了」；
 *   2. **AI 知识盒是自动连接的**，只有连没连上两种状态，永远没有开关
 *      （2026-11-07 起就是自动识别，见 data/settings.ts 里那段注释）；
 *   3. **两项各有自己的教程**，链接不共用；没装时给的是「怎么装 bz」，
 *      指向安装那一 P，不是功能教程。
 *
 * 另外钉住「没有版本太旧这回事」：能力按门面探测逐项降级，不拿版本号判，
 * 所以设置页也不该出现「版本太旧，升级一下」这种说法。
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

/** 知识盒那句功能说明：原本的文案，两种连接状态共用 */
const KB_HINT =
  '在划词中添加存为名词 / 存为段落，可以为书籍建立本地向量化索引，提问时会一并参考库里的笔记。';
/** 剪藏本那句：讲的是「打开后会怎样」 */
const CLIP_HINT = '打开后书架多一本剪藏成书，自动同步剪藏本的文章。';

function html(bz?: SettingsView['bz'], clipBook = false): string {
  return viewSettings({
    prefs: DEFAULT_PREFS,
    settings: { ...DEFAULT_SETTINGS, clipBook },
    pen: 'amber',
    hotkeys: [],
    version: '0.1.2',
    bz,
  });
}

/** 截出 bz 组：只看组内，不误判授权组、AI 组 */
function bzGroup(out: string): string {
  const start = out.indexOf('<h3>bz</h3>');
  const next = out.indexOf('<h3>', start + 1);
  expect(start, '有 bz 组').toBeGreaterThan(-1);
  return out.slice(start, next < 0 ? undefined : next);
}

/** 截出 AI 组：它不该再有知识盒那一行 */
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

describe('设置页 bz 组 · 剪藏本', () => {
  it('装了 bz：出开关，挂在 clipBook 上', () => {
    const g = bzGroup(html(LINKED));
    expect(g).toContain('<label>剪藏本</label>');
    expect(g).toContain('data-k="clipBook"');
  });

  it('开关态跟着设置走，不写死', () => {
    expect(bzGroup(html(LINKED, true))).toContain('class="bzs-switch on" data-act="toggle" data-k="clipBook"');
    const off = bzGroup(html(LINKED, false));
    expect(off).toContain('data-k="clipBook"');
    expect(off).not.toContain('class="bzs-switch on" data-act="toggle" data-k="clipBook"');
  });

  it('没装 bz：开关整颗不出现，描述照旧在', () => {
    const g = bzGroup(html());
    expect(g).toContain('<label>剪藏本</label>');
    expect(g).not.toContain('data-k="clipBook"');
    expect(g).toContain(CLIP_HINT);
  });

  it('剪藏本有自己的教程出口，不是组头共用一颗', () => {
    expect(bzGroup(html(LINKED))).toContain('data-act="cliptut"');
  });
});

describe('设置页 bz 组 · AI 知识盒', () => {
  it('永远没有开关：连上与否是自动识别', () => {
    expect(bzGroup(html(LINKED))).not.toContain('data-k="aiKnowledge"');
    expect(bzGroup(html())).not.toContain('data-k="aiKnowledge"');
    expect(bzGroup(html(LINKED))).toContain('<label>AI 知识盒</label>');
  });

  it('连上写「已连接」，没装写「未连接」', () => {
    expect(bzGroup(html(LINKED))).toContain('已连接');
    expect(bzGroup(html())).toContain('未连接');
  });

  it('bz 在但没配嵌入模型：也算没连上', () => {
    const g = bzGroup(html({ ...LINKED, model: '' }));
    expect(g).toContain('未连接');
    expect(g).not.toContain('已连接');
  });

  it('两种状态共用原本那句说明，一个字都不随状态变', () => {
    expect(bzGroup(html(LINKED))).toContain(KB_HINT);
    expect(bzGroup(html())).toContain(KB_HINT);
  });

  it('自己的教程是讲索引的那一期，和剪藏本那颗不是同一个动作', () => {
    const g = bzGroup(html(LINKED));
    expect(g).toContain('data-act="aitutorial"');
    expect(g).toContain('data-act="cliptut"');
  });
});

describe('设置页 bz 组 · 没装 bz 时', () => {
  it('给的是安装出口，不是功能教程', () => {
    const g = bzGroup(html());
    expect(g).toContain('data-act="bzinstall"');
  });

  it('说明里交代这两项要 bz 才能用', () => {
    expect(bzGroup(html())).toContain('没检测到 bz');
  });

  it('装了之后不再摆安装引导', () => {
    expect(bzGroup(html(LINKED))).not.toContain('data-act="bzinstall"');
  });

  /* 能力按门面探测判，不按版本号：老版本 bz 缺哪个接口就降级哪一项，
     「版本太旧，去升级」既吓人又不准。 */
  it('不出现「版本太旧」这类版本门禁说法', () => {
    expect(html()).not.toContain('版本太旧');
    expect(html({ ...LINKED, version: '1.20.0' })).not.toContain('版本太旧');
  });
});

describe('设置页 · 分组归位', () => {
  it('AI 组里不再有知识盒那一行', () => {
    const g = aiGroup(html(LINKED));
    expect(g).not.toContain('连接至 BZ AI 知识库');
    expect(g).not.toContain(KB_HINT);
  });

  it('bz 组排在 AI 组之后、授权组之前', () => {
    const out = html(LINKED);
    expect(out.indexOf('<h3>AI 助手</h3>')).toBeLessThan(out.indexOf('<h3>bz</h3>'));
    expect(out.indexOf('<h3>bz</h3>')).toBeLessThan(out.indexOf('<h3>授权</h3>'));
  });
});
