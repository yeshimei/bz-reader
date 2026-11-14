import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return {
    ...actual,
    can: () => true,
    entitlement: () => ({ tier: 'paid' as const, unlocked: true, license: 'BZR2.test' }),
  };
});

import { DEFAULT_PREFS } from '../src/data/prefs';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { viewSettings } from '../src/shell/render/settings';

/**
 * 朗读组的版式（2026-11-14 重排）。
 *
 * 三段：连接（服务怎么连上）→ 播放（怎么念）→ 缓存与离线（怎么存下来）。
 * 之前是一整列平铺，高级项还缩进折叠里，用户要一边读一边猜哪几行是一伙的。
 *
 * 同一天还砍掉了五句解释性小字——它们把一列拉长两屏，说的却都是「你已经
 * 知道的」；仍有用的两句（音色属于模型、整本只对本地）改成悬停提示，不占
 * 版面。
 */

const out = (prefs: Partial<typeof DEFAULT_PREFS> = {}): string =>
  viewSettings({
    prefs: { ...DEFAULT_PREFS, ...prefs },
    settings: DEFAULT_SETTINGS,
    pen: 'amber',
    hotkeys: [],
    version: '1.4.0',
  });

/** 朗读组这一段（从组容器到下一个组容器之前） */
function ttsGroup(html: string): string {
  const start = html.indexOf('id="bz-set-tts"');
  expect(start, '有朗读组').toBeGreaterThan(-1);
  /* 从自己的开标签之后找下一组的 div：匹配要带引号或空格，否则会命中
     自己里面的 <div class="bzs-setgrp-head">（组头那一层）。 */
  const tagEnd = html.indexOf('>', start);
  const hit = /<div class="bzs-setgrp[" ]/.exec(html.slice(tagEnd));
  const next = hit ? tagEnd + hit.index : -1;
  return html.slice(start, next < 0 ? undefined : next);
}

const LOCAL = { ttsEngine: 'local' as const };
const SYSTEM = { ttsEngine: 'system' as const };

describe('朗读组 · 三段排版', () => {
  it('三段小标题按「连接 → 播放 → 缓存与离线」出现', () => {
    const grp = ttsGroup(out(LOCAL));
    const conn = grp.indexOf('连接');
    const play = grp.indexOf('播放');
    const cache = grp.indexOf('缓存与离线');

    expect(conn).toBeGreaterThan(-1);
    expect(play).toBeGreaterThan(conn);
    expect(cache).toBeGreaterThan(play);
  });

  it('系统语音没有可连的服务，就不挂「连接」这个空标题', () => {
    const grp = ttsGroup(out(SYSTEM));
    expect(grp).not.toContain('bzs-subh">连接');
    expect(grp).toContain('bzs-subh">播放');
  });

  it('模型、密钥、格式直接铺开，不再缩进折叠里', () => {
    const grp = ttsGroup(out(LOCAL));
    expect(grp).not.toContain('<details');
    expect(grp).not.toContain('高级：模型、密钥、格式');
    expect(grp).toContain('data-k="ttsLocal.model"');
    expect(grp).toContain('data-k="ttsLocal.apiKey"');
    expect(grp).toContain('data-k="ttsLocalFormat"');
  });
});

describe('朗读组 · 文案瘦身', () => {
  it('五句解释性小字不再占版面', () => {
    const grp = ttsGroup(out(LOCAL));
    /* 只看可见文字：`>…` 是正文，`title="…"` 是悬停提示，后者留着不占版面 */
    expect(grp).not.toMatch(/>\s*音色属于模型/);
    expect(grp).not.toMatch(/>\s*同一段再听直接播放/);
    expect(grp).not.toMatch(/>\s*只对本地语音，免费但慢/);
    expect(grp).not.toMatch(/>\s*多数本地服务不用填/);
    expect(grp).not.toMatch(/>\s*丢给 AI/);
  });

  it('还有用的两句改成悬停提示，不占一行', () => {
    const grp = ttsGroup(out(LOCAL));
    expect(grp).toContain('title="音色属于模型');
    expect(grp).toContain('title="只对本地语音');
  });
});

describe('朗读组 · 缓存与离线', () => {
  it('「清空」并进滑杆那一行，不再单占一行', () => {
    const grp = ttsGroup(out(LOCAL));
    const rows = grp.split('<div class="bzs-setrow">');
    const slider = rows.find((r) => r.includes('data-k="ttsCacheMB"'));

    expect(slider, '有缓存滑杆这一行').toBeTruthy();
    expect(slider).toContain('data-act="ttscacheclear"');
  });

  it('整本预生成紧跟离线音频，说的是一件事', () => {
    const grp = ttsGroup(out(LOCAL));
    const offline = grp.indexOf('data-act="ttsofflinereload"');
    const book = grp.indexOf('data-act="ttsprefetchbook"');
    const packFirst = grp.indexOf('data-k="ttsPackFirst"');

    expect(offline).toBeGreaterThan(-1);
    expect(book).toBeGreaterThan(offline);
    expect(packFirst).toBeGreaterThan(book);
  });
});
