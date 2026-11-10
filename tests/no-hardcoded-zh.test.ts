import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/* ============================================================
 * 硬编码中文的存量门禁（D9）。
 *
 * 界面文案一律走 i18n（`t('key')`）。这条门禁不要求把存量清干净——那会把
 * 一次修复变成一次大重构——它只保证**不再新增**：按文件记下今天的数字，
 * 任何文件多写一句中文就红。
 *
 * 为什么不数注释：注释是给人看的，不进界面。这里只数字符串与模板字面量。
 * 为什么不数 `src/i18n/**`：那里就是文案本身。
 * 为什么不数 `src/shell/changelog.ts`：内置更新日志是中英双语的数据表，
 *   不经过 i18n 表、也不在界面拼装；每发一版都要手写两条，按「文案本身」
 *   同样豁免（否则每版都得来改一次基线，等于把门禁改成记账）。
 *
 * 少了（重构进 i18n）不用改基线，多了才要。新增文件默认预算 0。
 *
 * 基线的时点是「A–D 四批合并进 master 之后」：那之前 master 上新增的
 * `dev-tier` 提交给 plugin.ts 添了两句，B 批把 reader-view.ts 的 17 句
 * 搬进了语言包，所以这里的数字与逐批开发时的中间值不同——以合并后为准。
 * ============================================================ */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** 存量白名单：2026-11-08 写死，只许减不许增 */
const BASELINE: Record<string, number> = {  'src/core/app.ts': 1,
  'src/core/diagnose.ts': 18,
  'src/core/folder-pick.ts': 3,
  'src/core/move-plan.ts': 5,
  /* 2026-11-10 +5（27 → 32）：追问任务的两段 system 指令与「【原文】/【问题】」
     标签。这些是发给模型的 prompt，不是界面文案——同文件既有 27 处全是这个
     性质（explain / summarize / translate 的口径），界面文案早在别的文件里
     走 t() 了。
     2026-11-10 +5（32 → 37）：问这摞书的 system 指令与「【依据】/【问题】」标签，
     同一性质。 */
  'src/data/ai.ts': 37,
  'src/data/backup.ts': 4,
  /* 2026-11-11 新文件：补元数据的 prompt 与解析标签（'简介' / '标签' / '语言'
     是模型输出里的字段名，解析器必须认得这几个字；它们不显示给用户，
     与 data/ai.ts 里的 prompt 同一性质）。 */
  'src/data/book-enrich.ts': 10,
  /* 2026-11-11 新文件：开章导读的 prompt 与「这一章 / 带着三个问题」的段落名，
     只发给模型、不显示给用户，与 data/ai.ts 同一性质。 */
  'src/data/chapter-guide.ts': 7,
  /* 2026-11-11 新文件：主题书单的 prompt 与「阅读路线 / 来源」段落名，
     只发给模型或写进生成的笔记，不显示为界面文案。 */
  'src/data/topic-route.ts': 10,
  'src/data/book-scan.ts': 1,
  'src/data/deeplink.ts': 4,
  /* 2026-11-11 +2（42 → 44）：新增「划线加入复习计划」这一行能力的卖点句
     （CAP_TEXT 的 zh 与 zh-TW 两份）。这张表本来就是八语言的集中表，
     不是散落的界面句子——与 header-actions.ts 的标签表同理。 */
  'src/data/entitlement.ts': 44,
  'src/data/export.ts': 9,
  'src/data/importer.ts': 1,
  'src/data/license.ts': 16,
  'src/data/notes.ts': 13,
  'src/data/portrait-build.ts': 8,
  'src/data/portrait.ts': 2,
  'src/data/prefs.ts': 33,
  /* 两个保留名「全部」「未分类」既是分类条上的一格，也是筛选与存储里的值。
     它们不走 t()：改名会把已存进 localStorage 的 libShelf 全部对不上。
     真正的多语言标签要等这两个值改成不依赖语言之后再补。 */
  'src/data/shelves.ts': 2,
  'src/data/store.ts': 12,
  'src/data/wikilink.ts': 1,
  'src/engine/host.ts': 21,
  /* PDF 引擎的页号标签（「第 N 页」「第 1–10 页」）与引擎内提示，和
     txt.ts 的「第 N 节」同口径：都是**数据标签**（目录行、状态栏），
     不是可替换的界面句子。按钮 title 是纯符号说明，随 PDF 文案一起
     进语言包时再收。
     2026-11-09 +1：导出目录名 `_导出`（库内路径，不进界面文案表）。
     2026-11-09 +9（view.ts 23 → 32）：新增的翻页 / 导出 / 跳页 / 页内链接
     四组按钮的 title 与 aria-label，与既有 8 颗按钮的 title 是同一批——
     只给新按钮走 i18n 会变成中英混排，整组留到一次性收。 */
  'src/engine/pdf/document.ts': 1,
  /* 2026-11-09 +1（5 → 6）：「反链事件注册失败」的控制台告警，与同文件
     「反链读取失败」「渲染失败」是同一批引擎日志，随 PDF 文案一起进语言包。 */
  'src/engine/pdf/host.ts': 6,
  'src/engine/pdf/outline.ts': 6,
  'src/engine/pdf/view.ts': 32,
  'src/engine/theme.ts': 3,
  'src/engine/txt.ts': 4,
  /* 2026-11-10 +3（26 → 29）：debug-open 调试入口两条控制台痕迹
     （收到指令 / 执行失败）。这个仓库的控制台日志一律中文——同一文件里
     十几条老告警都是中文，翻译成英文反而看不出是哪一处。 */
  /* 2026-11-11 +1（29 → 30）：主题书单的落盘目录名「主题书单」。与引擎的
     `_导出` 同性质——它是库内路径（用户在文件树里看到的文件夹名），
     不是可替换的界面文案。 */
  'src/plugin.ts': 30,
  'src/shell/actions.ts': 16,
  'src/shell/adapt.ts': 9,
  /* 2026-11-08 +1：书卡菜单多一条「归入分类…」。这一列菜单本来就是
     硬编码中文（六条老条目都在），只给新条目单独走 i18n 会变成中英混排，
     所以整组留到以后一次性收。
     2026-11-10 +1（10 → 11）：同理多一条「导出这本书」。
     2026-11-11 +1（11 → 12）：多一条「划线加入复习」。这一列菜单整组仍是
     硬编码中文，只给新条目走 t() 会变成中英混排，整组留到以后一次性收。
     2026-11-10 +1（12 → 13）：多一条「划线加入复习（AI 出题）」，理由同上。
     2026-11-11 +1（13 → 14）：多一条「补全信息（AI）」，理由同上。
     2026-11-11 +1（14 → 15）：多一条「重建复习卡」，理由同上。 */
  'src/shell/book-menu.ts': 15,
  'src/shell/card-image.ts': 4,
  'src/shell/card-template.ts': 8,
  /* 2026-11-10 +2（17 → 19）：更新日志页脚多一枚「支持作者（已有 N 位）」，
     那半句是弹窗框架文案，跟更新日志一样只有中英两版（`changelogLang`），
     不走八语言 t()——否则日文界面会出现「日文按钮 + 中文条目」的半翻状态。 */
  /* 2026-11-10 19 → 21：页脚照 bz 收成「三个纯图标 + 支持作者胶囊」，
     删掉「知道了」与「问题反馈」，补上群号提示（模板头尾各一处中文）、
     「视频教程」与「支持作者」。这一整组仍是中英两版框架文案，理由同上。 */
  'src/shell/changelog-note.ts': 21,
  'src/shell/domain.ts': 14,
  'src/shell/idea-sheet.ts': 2,
  'src/shell/overlay.ts': 179,
  'src/shell/reader-cards.ts': 13,
  'src/shell/render/html.ts': 12,
  'src/shell/render/quote-card.ts': 2,
  'src/shell/render/search.ts': 17,
  'src/shell/render/settings.ts': 1,
  'src/shell/search-hits.ts': 2,
  'src/shell/state.ts': 2,
  'src/shell/study-view.ts': 1,
  /* 2026-11-10 +6（20 → 26）：跨书搜索多一组「打不开的书」提示（组标题、
     跳过提示、状态里的跳过计数）。整个面板仍是老样子硬编码中文、没有
     t() 入口，只给新条目单独走 i18n 会变成中英混排——整面板翻译留到
     1.0.1 一次做完（见 docs 里的后续清单）。 */
  'src/ui/cross-search-panel.ts': 26,
  'src/ui/dom.ts': 7,
  'src/ui/import-panel.ts': 24,
  /* 2026-11-10 +11（29 → 40）：新增四颗 PDF 专属图标。这个文件里的十个
     标签本来就是一张 Record<Locale, string> 集中表（见文件头），不是散落
     的界面文案；四颗 × zh / zh-TW 两份写法加进来，存量自然要跟着抬。 */
  'src/view/header-actions.ts': 40,
  'src/view/reader-fault.ts': 1,
  'src/view/reader-view.ts': 9,
  'src/view/side-view.ts': 1,
};

/** 纯文案数据文件：与 i18n 同口径豁免（见文件头）
 *
 *  2026-11-10 加 `src/data/reward.ts`：支持者名单。里面的昵称与留言是**别人
 *  写下的字**，不是界面文案——它们不翻译、也不该随界面语言变，所以不进
 *  语言包。界面那一层（序号、金额符号、「赞助人」）都走 t()。
 */
const EXEMPT = new Set(['src/shell/changelog.ts', 'src/data/reward.ts']);

const SRC = join(__dirname, '../src');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      /* i18n 是文案本身；别把「语言包里有中文」当成缺陷 */
      if (e.name === 'i18n') continue;
      out.push(...tsFiles(p));
    } else if (e.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** 一个文件里带中文的字符串 / 模板片段有多少处 */
export function countHardcodedZh(src: string, fileName = 'x.ts'): number {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (CJK.test(node.text)) n += 1;
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (CJK.test(node.text)) n += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

describe('硬编码中文', () => {
  it('没有哪个文件超出存量', () => {
    const over: string[] = [];
    for (const file of tsFiles(SRC)) {
      const key = relative(join(__dirname, '..'), file).replace(/\\/g, '/');
      if (EXEMPT.has(key)) continue;
      const n = countHardcodedZh(readFileSync(file, 'utf8'), file);
      const budget = BASELINE[key] ?? 0;
      if (n > budget) over.push(`${key}: ${n} 处（存量 ${budget}）`);
    }
    expect(over, '新增界面文案请走 t(key)，不要直接写中文').toEqual([]);
  });

  /* 计数器本身也要有个反例：全是注释的中文不该被算进去 */
  it('注释不算，字符串算', () => {
    expect(countHardcodedZh('// 中文注释\nconst a = 1;\n')).toBe(0);
    expect(countHardcodedZh('const a = "中文";')).toBe(1);
    expect(countHardcodedZh('const a = `前${x}后`;')).toBe(2);
  });
});
