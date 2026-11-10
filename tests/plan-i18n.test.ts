import { afterEach, describe, expect, it } from 'vitest';
import { LOCALES, PACK_OF, locale, setLocale, t, type Locale } from '../src/i18n';
import { PLAN_TEXT_PACK, planLabel, planNameZh } from '../src/i18n/plan';
import { GROUP_ID, PLAN_TABLE, TRIAL_ACTIVE } from '../src/data/entitlement';
import { groupButtonHtml } from '../src/shell/group';

const CJK = /[\u4e00-\u9fff]/;
const LATIN = ['en', 'de', 'fr', 'es', 'pt'] as const;

/**
 * 解锁弹层是基础版用户最常看到的一屏。以前整屏中文硬编码在 overlay.ts 里，
 * 换到德语界面还是一张中文表；现在行名走集中表、其余走语言包，
 * 这两条闸保证以后加行 / 加语言不会再漏一半。
 */
afterEach(() => setLocale('zh'));

describe('对照表行名 · 八种语言', () => {
  it('每行都有 key，中文名只来自集中表', () => {
    for (const r of PLAN_TABLE) expect(planNameZh(r.key), r.key).toBe(r.name);
    expect(PLAN_TABLE.length).toBe(Object.keys(PLAN_TEXT_PACK).length);
  });

  it('八种语言每行都填了，且没有空串', () => {
    for (const l of LOCALES) {
      for (const [key, pack] of Object.entries(PLAN_TEXT_PACK)) {
        expect(String(pack[l]).trim().length, `${l} ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('拉丁语系包里没有残留汉字', () => {
    for (const l of LATIN) {
      for (const [key, pack] of Object.entries(PLAN_TEXT_PACK)) {
        expect(CJK.test(pack[l]), `${l} ${key}：${pack[l]}`).toBe(false);
      }
    }
  });

  it('切换界面语言，行名跟着变；切回中文恢复', () => {
    expect(planLabel('aiBook')).toBe('AI 全书问答');
    expect(planNameZh('classify')).toBe('分类管理');
    expect(planNameZh('stats')).toBe('数据面板：时长、趋势、节律、书籍明细');
    setLocale('en');
    expect(locale()).toBe('en');
    expect(planLabel('aiBook')).toBe('AI Q&A over the whole book');
    expect(planLabel('classify')).toBe('Shelf categories');
    setLocale('zh');
    expect(planLabel('aiBook')).toBe('AI 全书问答');
  });
});

describe('解锁弹层的其余文案', () => {
  const keys = [
    'common.close',
    'unlock.title',
    'unlock.activated',
    'unlock.col.feature',
    'unlock.col.base',
    'unlock.col.pro',
    'unlock.part',
    'unlock.buy',
    'unlock.hint',
    'unlock.haveCode',
  ] as const;

  it('八种语言都补齐了，且没留空串', () => {
    for (const l of LOCALES) {
      for (const k of keys) expect(PACK_OF[l][k]?.trim().length, `${l} ${k}`).toBeGreaterThan(0);
    }
  });

  it('拉丁语系包里没有残留汉字', () => {
    for (const l of LATIN) {
      for (const k of keys) expect(CJK.test(PACK_OF[l][k]), `${l} ${k}`).toBe(false);
    }
  });

  it('切到英文后表头与按钮都是英文', () => {
    setLocale('en' as Locale);
    expect(t('unlock.col.feature')).toBe('Feature');
    expect(t('unlock.col.pro')).toBe('Pro');
    expect(t('unlock.buy')).toBe('Get Pro');
  });
});

describe('不发试用时，弹层只留交流群入口', () => {
  it('TRIAL_ACTIVE=false：按钮不提试用，只印群号', () => {
    expect(TRIAL_ACTIVE).toBe(false);
    const html = groupButtonHtml();
    expect(html).not.toContain('试用');
    expect(html).toContain(GROUP_ID);
  });
});
