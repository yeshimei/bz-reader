import { describe, expect, it } from 'vitest';
import { ttsBarHtml, ttsBarLift, ttsSourceLabel } from '../src/view/tts-bar';

describe('ttsBarHtml', () => {
  const html = ttsBarHtml({ paused: false });

  it('只有一排按钮，不再显示旁白/页数/费用/正在念的原文', () => {
    expect(html).not.toContain('bzr-ttsbar-head');
    expect(html).not.toContain('bzr-ttsbar-pos');
    expect(html).not.toContain('bzr-ttsbar-cost');
    expect(html).not.toContain('bzr-ttsbar-text');
    expect(html).not.toContain('元');
  });

  /* 2026-11-14 二轮：用户要求摊平——「那个工具栏不要折叠，把图标都给平铺」 */
  it('八颗图标全平铺：听得四个 + 音色 / 预生成 / 导出 / 设置', () => {
    for (const act of [
      'ttsprev',
      'ttstoggle',
      'ttsnext',
      'ttsstop',
      'ttsvoices',
      'ttsprefetch',
      'ttsexport',
      'ttstune',
    ]) {
      expect(html).toContain(`data-act="${act}"`);
    }
  });

  it('没有「更多」、没有隐藏的二级面板：任何一颗都不许收起来', () => {
    expect(html).not.toContain('ttsmore');
    expect(html).not.toContain('more-horizontal');
    /* 注意别把 aria-hidden 也算进来：那道分隔线本来就不给屏幕阅读器念 */
    expect(html).not.toMatch(/(^|\s)hidden[\s=>]/);
  });

  it('音色按钮带着引擎：本地开本地列表，其余按在线开', () => {
    expect(ttsBarHtml({ paused: false, voiceEngine: 'local' })).toMatch(/data-act="ttsvoices" data-v="local"/);
    expect(ttsBarHtml({ paused: false, voiceEngine: 'online' })).toMatch(/data-act="ttsvoices" data-v="online"/);
  });

  it('图标走 data-icon 占位，交给 Obsidian 的 setIcon，不用 emoji 字符', () => {
    for (const icon of ['skip-back', 'pause', 'square', 'skip-forward', 'mic', 'download', 'share', 'settings']) {
      expect(html).toContain(`data-icon="${icon}"`);
    }
    for (const emoji of ['⏮', '⏸', '⏭', '■', '⤓', '⭳', '▶']) {
      expect(html).not.toContain(emoji);
    }
  });

  it('暂停时主按钮换成「继续」（播放图标）', () => {
    const paused = ttsBarHtml({ paused: true });
    expect(paused).toContain('data-icon="play"');
    expect(paused).not.toContain('data-icon="pause"');
    expect(paused).toContain('is-main');
  });

  it('等待音频时主按钮转圈，不再是暂停图标', () => {
    const loading = ttsBarHtml({ paused: false, loading: true });
    expect(loading).toContain('is-loading');
    expect(loading).toContain('bzr-ttsspin');
    expect(loading).not.toContain('data-icon="pause"');
    expect(loading).not.toContain('data-icon="play"');
  });

  /* 来源徽标：缓存 / 离线 / 实时，可能混着来（一章里一半命中一半要现合） */
  it('有来源说明时把它画在最左边，没有就整块不出现', () => {
    const withSrc = ttsBarHtml({ paused: false, source: '缓存 12 · 实时 3' });
    expect(withSrc).toContain('bzr-ttssrc');
    expect(withSrc).toContain('缓存 12 · 实时 3');
    expect(html).not.toContain('bzr-ttssrc');
  });

  it('来源说明里的尖括号被转义，不会被当成标签', () => {
    const bad = ttsBarHtml({ paused: false, source: '<img src=x>' });
    expect(bad).not.toContain('<img');
    expect(bad).toContain('&lt;img');
  });
});

/* 用户要知道「这段声音是存的还是刚花钱合的」 */
describe('ttsSourceLabel', () => {
  it('离线包：只说离线，不混缓存/实时', () => {
    expect(ttsSourceLabel({ cached: 9, live: 4, offline: 1 })).toBe('离线');
  });

  it('全命中缓存：只报缓存多少段', () => {
    expect(ttsSourceLabel({ cached: 12, live: 0, offline: 0 })).toBe('缓存 12');
  });

  it('全现合：只报实时多少段', () => {
    expect(ttsSourceLabel({ cached: 0, live: 3, offline: 0 })).toBe('实时 3');
  });

  it('一半缓存一半现合：两条都写，用间隔点分开', () => {
    expect(ttsSourceLabel({ cached: 12, live: 3, offline: 0 })).toBe('缓存 12 · 实时 3');
  });

  it('还没开始：空串，浮条上不留空壳', () => {
    expect(ttsSourceLabel({ cached: 0, live: 0, offline: 0 })).toBe('');
  });
});

/* 状态栏压在朗读条上（2026-11-14 真机截图）：按实测高度抬，别写死数值 */
describe('ttsBarLift', () => {
  const fake = (h: number): HTMLElement =>
    ({ getBoundingClientRect: () => ({ height: h }) }) as unknown as HTMLElement;

  it('量到多高就抬多高，取整', () => {
    expect(ttsBarLift(fake(26.4))).toBe(26);
  });

  it('没有状态栏（全屏 / 隐藏）：不抬', () => {
    expect(ttsBarLift(null)).toBe(0);
    expect(ttsBarLift(undefined)).toBe(0);
    expect(ttsBarLift(fake(0))).toBe(0);
  });

  it('量出怪值也不抬：宁可贴底，别把条子顶到正文中间', () => {
    expect(ttsBarLift(fake(-5))).toBe(0);
    expect(ttsBarLift(fake(Number.NaN))).toBe(0);
  });
});
