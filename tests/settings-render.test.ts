import { describe, expect, it, vi } from 'vitest';

/* 设置页会读授权状态；测试里用一个可变开关模拟解锁前后 */
const entState = vi.hoisted(() => ({ unlocked: false }));
vi.mock('../src/data/entitlement', () => ({
  can: () => entState.unlocked,
  entitlement: () => ({
    tier: entState.unlocked ? 'paid' : 'free',
    unlocked: entState.unlocked,
    license: 'BZR2.old-code',
  }),
  tierText: () => (entState.unlocked ? '高级版已激活' : '当前未激活'),
}));

import { DEFAULT_PREFS } from '../src/data/prefs';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { viewSettings } from '../src/shell/render/settings';

const html = (relicense = false): string =>
  viewSettings({
    prefs: DEFAULT_PREFS,
    settings: DEFAULT_SETTINGS,
    pen: 'amber',
    hotkeys: [],
    relicense,
    version: '0.1.2',
  });

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

  it('基础版：AI 组整组灰化，点击弹高级功能说明', () => {
    entState.unlocked = false;
    const out = html();
    expect(out).toMatch(/class="bzs-setgrp is-locked"[^>]*data-act="unlock" data-mode="ai"/);
  });

  it('placeholder 用「填写…」句式，不拿真实地址/模型名冒充已填内容', () => {
    const out = html();
    expect(out).toContain('placeholder="填写服务商接口地址，以 https:// 开头"');
    expect(out).toContain('placeholder="填写你的账号可用的模型名"');
    expect(out).toContain('placeholder="填写 API 密钥"');
    expect(out).not.toContain('deepseek-chat');
  });

  it('朗读语速与朗读跟随在设置页，单成一组', () => {
    const out = html();
    expect(out).toContain('<h3>朗读</h3>');
    expect(out).toContain('data-k="ttsRate"');
    expect(out).toContain('data-k="ttsFollow"');
  });

  it('阅读页图标可以排序与收起', () => {
    const out = html();
    expect(out).toContain('<h3>阅读页图标</h3>');
    expect(out).toContain('data-act="headertoggle"');
    expect(out).toContain('data-act="headermove"');
  });

  it('阅读页图标列出全部十项（含对照书籍 / 朗读 / 鸟瞰 / 沉浸 / 返回书架）', () => {
    const out = html();
    for (const id of ['paraBook', 'tts', 'bookmap', 'immersive', 'library']) {
      expect(out, id).toContain(`data-k="${id}"`);
    }
    expect((out.match(/data-act="headertoggle"/g) ?? []).length).toBe(10);
  });

  it('分组顺序：阅读页图标排在外观之前', () => {
    const out = html();
    const headerAt = out.indexOf('<h3>阅读页图标</h3>');
    const lookAt = out.indexOf('<h3>外观</h3>');
    expect(headerAt).toBeGreaterThan(0);
    expect(lookAt).toBeGreaterThan(0);
    expect(headerAt).toBeLessThan(lookAt);
  });

  it('收起的去向写明是 Obsidian 自带的 ⋮，不是插件自己的菜单', () => {
    const out = html();
    expect(out).toContain('最右侧 ⋮');
    expect(out).not.toContain('进右上角 ⋮');
  });

  it('三个目录的「迁移」按钮已去掉（改由选不同目录时二次确认）', () => {
    const out = html();
    expect(out).not.toContain('datadirmove');
    expect(out).not.toContain('datadomigrate');
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

  /* 入口平权：基础版也看得见 AI 组。但没解锁时输入框只读——
     让基础版改一个用不了的配置只会制造「我填了为什么不行」的困惑。
     AI 组里不放「查看功能对照」这类提示：要解锁去授权组，别在配置区塞推销。 */
  it('基础版：AI 组仍在，三个输入框都是只读', () => {
    entState.unlocked = false;
    const out = html();
    expect(out).toContain('<h3>AI 助手</h3>');
    for (const k of ['ai.baseUrl', 'ai.model', 'ai.apiKey']) {
      expect(out, k).toMatch(new RegExp(`data-k="${k.replace('.', '\\.')}"[^>]*readonly`));
    }
  });

  it('基础版：AI 组里没有查看 / 对照按钮', () => {
    entState.unlocked = false;
    const out = html();
    const start = out.indexOf('<h3>AI 助手</h3>');
    const next = out.indexOf('<h3>', start + 1);
    const aiGroup = out.slice(start, next < 0 ? undefined : next);
    expect(aiGroup).not.toContain('data-act="unlock"');
    expect(aiGroup).not.toContain('查看');
    expect(aiGroup).not.toContain('对照');
  });

  it('基础版：AI 组不再有「状态」描述行', () => {
    entState.unlocked = false;
    const out = html();
    const start = out.indexOf('<h3>AI 助手</h3>');
    const next = out.indexOf('<h3>', start + 1);
    const aiGroup = out.slice(start, next < 0 ? undefined : next);
    expect(aiGroup).not.toContain('<label>状态</label>');
    expect(aiGroup).not.toContain('高级版功能 · 配置会保存在本地');
  });

  it('解锁后 AI 输入框可编辑，且不再提示解锁', () => {
    entState.unlocked = true;
    const out = html();
    expect(out).not.toMatch(/data-k="ai\.baseUrl"[^>]*readonly/);
    expect(out).not.toContain('data-act="unlock"');
    entState.unlocked = false;
  });
});

/**
 * 2026-11-05：设置页去掉「更新日志」入口，说明文字只留备份那一条。
 *
 * 弹窗仍会在升级后第一次进书库时自动出现一次；只是不再有常驻入口。
 * 文案是用户挑定的定稿，别再改回长句。
 */
describe('数据组 · 说明文字', () => {
  /** 截出「数据」组那一段：只看组内，不误判别的组 */
  function dataGroup(out: string): string {
    const start = out.indexOf('<h3>数据</h3>');
    const next = out.indexOf('<h3>', start + 1);
    return out.slice(start, next < 0 ? undefined : next);
  }

  it('不再画「更新日志」入口（行与按钮都不见）', () => {
    expect(html()).not.toContain('data-act="changelog"');
    expect(dataGroup(html())).not.toContain('更新日志');
  });

  it('说明文字只讲备份：范围与不备份的东西', () => {
    const group = dataGroup(html());
    expect(group).toContain('备份含书架、进度、标注、收藏与目标。不含激活码和 AI Key，换设备需重填。');
    expect(group).not.toContain('导入的书');
    expect(group).not.toContain('改数据目录');
  });
});

/**
 * 已激活的人也必须能换码：先用群里的 7 天试用，再买正式版——
 * 如果输入框只读、又没有激活按钮，用户就卡在「买了却填不进去」。
 */
describe('授权组 · 重新激活', () => {
  it('已激活：输入框只读，但给出「重新激活」', () => {
    entState.unlocked = true;
    const out = html(false);
    expect(out).toMatch(/data-role="license"[^>]*readonly/);
    expect(out).toContain('data-act="relicense"');
    expect(out).toContain('重新激活');
    expect(out).not.toContain('data-act="activate"');
    entState.unlocked = false;
  });

  it('点了「重新激活」：输入框可编辑，原码保留，只给激活', () => {
    entState.unlocked = true;
    const out = html(true);
    expect(out).not.toMatch(/data-role="license"[^>]*readonly/);
    expect(out).toContain('data-act="activate"');
    expect(out).not.toContain('data-act="cancelrelicense"');
    expect(out).toContain('value="BZR2.old-code"');
    entState.unlocked = false;
  });
});