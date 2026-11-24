/**
 * 更新日志弹层的跳转按界面语言分流，购买链接走远程名单。
 *
 * 统计卡「去购买 / 去支持」走二次确认，确认后跳 confirmTarget：
 *   · 购买（pro 卡）→ purchaseUrlFor(lang)：简中取 buyCn、非简中取 buyIntl，
 *     远程优先、内置兜底，和解锁弹层那颗「去购买」同一套机制；
 *   · 打赏（patrons 卡）→ links.support 老字段，兜底国内赞助店；
 *     两档语言都用同一个 support（打赏渠道目前只有国内一条）。
 *
 * 作者在远程换购买渠道后，用户联网拉到新数据 → 覆盖缓存 → 这边自动跳新店。
 * 视频/QQ 群按钮已按语言隐藏（见 locale-diff.test.ts）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../src/i18n';
import { resolveConfirmTarget, setChangelogDataForTests } from '../src/shell/changelog-note';
import { SPONSOR_URL } from '../src/data/reward';
import type { BzrData } from '../src/data/bzr-data';

const dataWithLinks = (links: {
  buy?: string; support?: string; buyCn?: string; buyIntl?: string;
}): BzrData => ({
  version: 3,
  updatedAt: '',
  changelog: [],
  roadmap: [],
  feedback: [],
  stats: { reward: 0, pro: 0, patrons: 0 },
  links: {
    buy: links.buy ?? '', support: links.support ?? '',
    buyCn: links.buyCn ?? '', buyIntl: links.buyIntl ?? '',
  },
} as BzrData);

afterEach(() => {
  setLocale('zh');
  setChangelogDataForTests(null);
});

describe('更新日志跳转 · 简体中文购买', () => {
  it('购买取 buyCn 远程值', () => {
    setLocale('zh');
    const d = dataWithLinks({ buyCn: 'https://cn.example.com/pay', buyIntl: 'https://intl.example.com/pay' });
    expect(resolveConfirmTarget('buy', d)).toBe('https://cn.example.com/pay');
  });

  it('buyCn 缺失时兜底国内店', () => {
    setLocale('zh');
    expect(resolveConfirmTarget('buy', null)).toBe(SPONSOR_URL);
  });
});

describe('更新日志跳转 · 非简体中文购买', () => {
  it('英文取 buyIntl 远程值', () => {
    setLocale('en');
    const d = dataWithLinks({ buyCn: 'https://cn.example.com/pay', buyIntl: 'https://intl.example.com/pay' });
    expect(resolveConfirmTarget('buy', d)).toBe('https://intl.example.com/pay');
  });

  it('繁体同样取 buyIntl', () => {
    setLocale('zh-TW');
    const d = dataWithLinks({ buyIntl: 'https://intl.example.com/pay' });
    expect(resolveConfirmTarget('buy', d)).toBe('https://intl.example.com/pay');
  });

  it('远程换成新渠道域名就跟随（不受反馈白名单限制）', () => {
    setLocale('en');
    const d = dataWithLinks({ buyIntl: 'https://brand-new-mor.example.com/checkout' });
    expect(resolveConfirmTarget('buy', d)).toBe('https://brand-new-mor.example.com/checkout');
  });

  it('buyIntl 缺失时兜底 Creem', () => {
    setLocale('en');
    expect(resolveConfirmTarget('buy', null)).toBe('https://www.creem.io/stores/baizai');
  });
});

describe('更新日志跳转 · 打赏走 support', () => {
  it('两档语言都走 support 老字段', () => {
    const d = dataWithLinks({ support: 'https://afdian.net/a/x' });
    setLocale('zh');
    expect(resolveConfirmTarget('support', d)).toBe('https://afdian.net/a/x');
    setLocale('en');
    expect(resolveConfirmTarget('support', d)).toBe('https://afdian.net/a/x');
  });

  it('support 缺失兜底国内赞助店', () => {
    setLocale('en');
    expect(resolveConfirmTarget('support', null)).toBe(SPONSOR_URL);
  });
});
