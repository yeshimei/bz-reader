/**
 * 1.0.0 上架版对照表文案（tests/plan-copy.test.ts）
 *
 * 这一轮不是改功能，是把「表里写的话」与「真机上能做的事」对齐：
 *   · 引用页签这版新做出来，表里此前一行都没有；它列的是双链反链，
 *     最终归到高级版、与「双向链接」共用一道门禁，在弹层里紧排其下；
 *   · 书摘图片 1.0.0 下放基础版，两栏都打勾，图片一律带 bz reader 徽章；
 *   · 一批行名与界面用词不一致（跨书搜索 / 全库、并排译文 / 任意两本书）。
 *
 * 先钉住这些说法，再改 plan.ts 与 entitlement.ts——行名是八语言共用的，
 * 少一种语言就会在某个界面里冒出一句英文。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PLAN_GROUPS, PLAN_TABLE } from '../src/data/entitlement';
import { LOCALES, setLocale } from '../src/i18n';
import { PLAN_GROUP_TEXT_PACK, PLAN_TEXT_PACK, planGroupNameZh, planLabel, planNameZh } from '../src/i18n/plan';

afterEach(() => setLocale('zh'));

function row(key: string) {
  return PLAN_TABLE.find((r) => r.key === key);
}

/**
 * 1.0.0 定稿改过口径的行：这一版按「两版定位」重写过一遍行名——
 * 看得懂、不重复、把卖点点出来。中文基准与 PLAN_TABLE 必须同源。
 */
const CHANGED: ReadonlyArray<readonly [string, string]> = [
  ['reading', 'EPUB / TXT 打开即读'],
  ['bilink', '划线存成双链：笔记里点回原文'],
  ['export', '导出整本摘录：每条带双链'],
  ['back', '回到上一处：跳走之后一键回来'],
  ['footnote', '脚注浮窗：小注不用离页'],
  ['formats', 'Kindle 系（MOBI / AZW3）、FB2、CBZ 漫画'],
  ['pdfView', '打开 PDF：缩放、旋转、单双页、滚动，每本记住视角'],
  ['pdfLink', '复制页链接：页码 / 视图 / 嵌入 / 批注'],
  ['pdfAnnots', '本页反链与文件自带批注'],
  ['stats', '数据面板：时长、趋势、节律、书籍明细'],
  ['poster', '阅读海报：年度总结与数据长图'],
  ['crossSearch', '全库搜索：PDF 正文也搜得到'],
  ['aiSel', 'AI 解释、翻译与摘要：划词即用'],
  ['vertical', '竖排排版：EPUB / TXT'],
  ['tts', '朗读：EPUB、TXT 与 PDF，念完自动翻页'],
  ['parallel', '与另一本书并排对照'],
  ['kb', '连接 BZ AI 知识库（需另装 bz）'],
];

describe('1.0.0 对照表 · 引用页签归入高级版', () => {
  it('基础版打叉、高级版打勾：不挂自己的 cap，跟双向链接共用一道门禁', () => {
    const r = row('cites');
    expect(r).toBeTruthy();
    expect(r?.free).toBe('no');
    expect(r?.pro).toBe('yes');
    expect(r?.cap).toBeUndefined();
  });

  it('在表和「格式与导出」段里都紧排在双向链接下面', () => {
    const at = PLAN_TABLE.findIndex((r) => r.key === 'cites');
    expect(PLAN_TABLE[at - 1]?.key).toBe('bilink');
    const output = PLAN_GROUPS.find((g) => g.key === 'output');
    expect(output?.rows.indexOf('cites')).toBe((output?.rows.indexOf('bilink') ?? -2) + 1);
    const read = PLAN_GROUPS.find((g) => g.key === 'read');
    expect(read?.rows).not.toContain('cites');
  });

  it('行名说清它做什么，八种语言都写实', () => {
    expect(planNameZh('cites')).toContain('引用页签');
    for (const l of LOCALES) {
      expect(String(PLAN_TEXT_PACK.cites[l]).trim().length, l).toBeGreaterThan(0);
    }
  });
});

describe('1.0.0 对照表 · 书摘下放与行名', () => {
  it('书摘图片下放基础版：两栏都打勾，不再标「部分可用」', () => {
    const card = row('card');
    expect(card?.free).toBe('yes');
    expect(card?.pro).toBe('yes');
    expect(card?.cap).toBeUndefined();
  });

  it('改名后的行名与中文基准一致', () => {
    for (const [key, name] of CHANGED) {
      expect(planNameZh(key as keyof typeof PLAN_TEXT_PACK), key).toBe(name);
      expect(row(key)?.name, key).toBe(name);
    }
  });

  it('行名不带括号补充说明（只有 formats 的族名枚举与 kb 的前置条件例外）', () => {
    /* formats 的括号是「族 → 枚举」（Kindle 系（MOBI / AZW3）），不是解释；
       kb 的「（需另装 bz）」是前置条件，写进正文会读成「知识库要另装」。
       除了这两行，行名里不该再出现括号。 */
    const ALLOWED = new Set(['formats', 'kb']);
    for (const r of PLAN_TABLE) {
      if (ALLOWED.has(r.key)) continue;
      expect(r.name, r.name).not.toMatch(/[（(]/);
    }
  });

  it('表尾仍是知识库那一行', () => {
    expect(PLAN_TABLE.at(-1)?.key).toBe('kb');
    expect(PLAN_TABLE.at(-1)?.name).toBe('连接 BZ AI 知识库（需另装 bz）');
  });
});

describe('1.0.0 对照表 · 上架前把英文占位换成正式翻译', () => {
  const PDF_KEYS = ['pdfView', 'pdfThumbs', 'pdfLink', 'pdfAnnots', 'pdfExport'] as const;

  it('PDF 段五行与组名在五种外语里不再照抄英文', () => {
    for (const l of ['ja', 'de', 'fr', 'es', 'pt'] as const) {
      expect(PLAN_GROUP_TEXT_PACK.pdf[l], l).not.toBe(PLAN_GROUP_TEXT_PACK.pdf.en);
      for (const key of PDF_KEYS) {
        expect(PLAN_TEXT_PACK[key][l], `${l} ${key}`).not.toBe(PLAN_TEXT_PACK[key].en);
      }
    }
  });

  it('引用页签在五种外语里也不是英文占位', () => {
    for (const l of ['ja', 'de', 'fr', 'es', 'pt'] as const) {
      expect(PLAN_TEXT_PACK.cites[l], l).not.toBe(PLAN_TEXT_PACK.cites.en);
    }
  });

  it('切到德文，行名跟着换；切回中文恢复', () => {
    setLocale('de');
    expect(planLabel('pdfView')).toBe(PLAN_TEXT_PACK.pdfView.de);
    setLocale('zh');
    expect(planLabel('pdfView')).toBe('打开 PDF：缩放、旋转、单双页、滚动，每本记住视角');
    expect(planGroupNameZh('pdf')).toBe('PDF 阅读');
  });
});
