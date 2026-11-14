/**
 * 对照表文案（tests/plan-copy.test.ts）
 *
 * 这一轮不是改功能，是把「表里写的话」与「真机上能做的事」对齐：
 *   · 2026-11-14 按作者定稿重排：八段、38 行，每段只讲一类事；
 *   · 新增「本页反链」一行，与「文件自带批注」拆开；
 *   · 「AI 知识盒」改叫「AI 知识库」，小字写清存哪三类；
 *   · 一批行名补上说明（全书鸟瞰、AI 全书问答、分类管理、并排对照）。
 *
 * 行名是八语言共用的，少一种语言就会在某个界面里冒出一句英文。
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
 * 2026-11-14 定稿改过口径的行：按「两版定位」重写过一遍行名——
 * 看得懂、不重复、把卖点点出来。中文基准与 PLAN_TABLE 必须同源。
 */
const CHANGED: ReadonlyArray<readonly [string, string]> = [
  ['reading', 'EPUB / TXT 打开即读'],
  ['columns', '单栏 / 双栏排版'],
  ['back', '跳转历史：一键回到上一处'],
  ['footnote', '脚注浮窗：小注不用离页'],
  ['classify', '分类管理：自建分类归书'],
  ['formats', 'Kindle 系（MOBI / AZW3）、FB2、CBZ 漫画、PDF'],
  ['clipEpub', '剪藏成书：剪藏本合成一本 EPUB'],
  ['pdfView', 'PDF 阅读：缩放、旋转、单双页、滚动'],
  ['pdfLink', '复制页链接：页码、视图、嵌入、批注'],
  ['pdfBacklink', '本页反链：笔记引了这页就画出来'],
  ['pdfAnnots', '文件自带批注：别人标的也能读'],
  ['bilink', '划线存成双链：笔记里点回原文'],
  ['export', '导出整本摘录：每条带双链'],
  ['stats', '数据面板：时长、趋势、节律、书籍明细'],
  ['poster', '阅读海报：年度总结与数据长图'],
  ['crossSearch', '全库搜索：按字面搜所有书，含 PDF'],
  ['semantic', '语义搜索：按意思找，本书或全库'],
  ['aiSel', 'AI 解释、翻译与摘要：划词即用'],
  ['aiBook', 'AI 全书问答：先建索引，再问整本'],
  ['kb', 'AI 知识库：划线、想法、增量阅读存进去，提问带上笔记'],
  ['vertical', '竖排排版：EPUB / TXT'],
  ['tts', '朗读：EPUB、TXT 与 PDF，念完自动翻页'],
  ['parallel', '并排对照：与另一本书同步段落'],
  ['bookmap', '全书鸟瞰：各章划线数与一句话摘要'],
];

describe('对照表 · 引用页签归入高级版', () => {
  it('基础版打叉、高级版打勾：挂自己的 cap，点它时高亮这一行', () => {
    /* 2026-11-12 改：以前引用页签与双向链接共用一道门禁，点引用页签被拦
       时弹层点亮的是「划线存成双链」，用户看的不是自己刚点的那一行。
       现在它有自己的能力位，只影响这条入口的归属，不影响授权判定。 */
    const r = row('cites');
    expect(r).toBeTruthy();
    expect(r?.free).toBe('no');
    expect(r?.pro).toBe('yes');
    expect(r?.cap).toBe('cites');
  });

  it('在表和「笔记与导出」段里都紧排在双向链接下面', () => {
    const at = PLAN_TABLE.findIndex((r) => r.key === 'cites');
    expect(PLAN_TABLE[at - 1]?.key).toBe('bilink');
    const notes = PLAN_GROUPS.find((g) => g.key === 'notes');
    expect(notes?.rows.indexOf('cites')).toBe((notes?.rows.indexOf('bilink') ?? -2) + 1);
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

describe('对照表 · 稿子与勾叉', () => {
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

  it('行名不带括号补充说明（只有 formats 的族名枚举例外）', () => {
    /* formats 的括号是「族 → 枚举」（Kindle 系（MOBI / AZW3）），不是解释。
       2026-11-14 起 kb 的「（需另装 bz）」不再写进行名，改走行尾小字。 */
    const ALLOWED = new Set(['formats']);
    for (const r of PLAN_TABLE) {
      if (ALLOWED.has(r.key)) continue;
      expect(r.name, r.name).not.toMatch(/[（(]/);
    }
  });

  it('AI 段收在知识库，之后是阅读方式与探索段', () => {
    const kbAt = PLAN_TABLE.findIndex((r) => r.key === 'kb');
    expect(kbAt).toBeGreaterThan(-1);
    expect(PLAN_TABLE[kbAt]?.name).toBe('AI 知识库：划线、想法、增量阅读存进去，提问带上笔记');
    expect(PLAN_TABLE[kbAt + 1]?.key).toBe('vertical');
    const modes = PLAN_GROUPS.find((g) => g.key === 'modes');
    expect(modes?.rows).toEqual(['vertical', 'tts', 'parallel', 'bookmap']);
  });
});

describe('对照表 · 八段分组', () => {
  it('八段顺序固定', () => {
    expect(PLAN_GROUPS.map((g) => g.key)).toEqual([
      'read',
      'import',
      'pdf',
      'notes',
      'data',
      'ai',
      'modes',
      'explore',
    ]);
  });
});

describe('对照表 · 上架前把英文占位换成正式翻译', () => {
  const PDF_KEYS = ['pdfView', 'pdfThumbs', 'pdfLink', 'pdfBacklink', 'pdfAnnots', 'pdfExport'] as const;

  it('PDF 段六行与组名在五种外语里不再照抄英文', () => {
    for (const l of ['ja', 'de', 'fr', 'es', 'pt'] as const) {
      expect(PLAN_GROUP_TEXT_PACK.pdf[l], l).not.toBe(PLAN_GROUP_TEXT_PACK.pdf.en);
      for (const key of PDF_KEYS) {
        expect(PLAN_TEXT_PACK[key][l], `${l} ${key}`).not.toBe(PLAN_TEXT_PACK[key].en);
      }
    }
  });

  it('引用页签与知识库在五种外语里也不是英文占位', () => {
    for (const l of ['ja', 'de', 'fr', 'es', 'pt'] as const) {
      expect(PLAN_TEXT_PACK.cites[l], l).not.toBe(PLAN_TEXT_PACK.cites.en);
      expect(PLAN_TEXT_PACK.kb[l], l).not.toBe(PLAN_TEXT_PACK.kb.en);
    }
  });

  it('切到德文，行名跟着换；切回中文恢复', () => {
    setLocale('de');
    expect(planLabel('pdfView')).toBe(PLAN_TEXT_PACK.pdfView.de);
    setLocale('zh');
    expect(planLabel('pdfView')).toBe('PDF 阅读：缩放、旋转、单双页、滚动');
    expect(planGroupNameZh('pdf')).toBe('PDF 阅读');
  });
});
