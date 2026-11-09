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
  'src/data/ai.ts': 27,
  'src/data/backup.ts': 4,
  'src/data/book-scan.ts': 1,
  'src/data/deeplink.ts': 4,
  'src/data/entitlement.ts': 42,
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
     进语言包时再收。 */
  'src/engine/pdf/document.ts': 1,
  'src/engine/pdf/host.ts': 4,
  'src/engine/pdf/outline.ts': 6,
  'src/engine/pdf/view.ts': 15,
  'src/engine/theme.ts': 3,
  'src/engine/txt.ts': 4,
  'src/plugin.ts': 26,
  'src/shell/actions.ts': 16,
  'src/shell/adapt.ts': 9,
  /* 2026-11-08 +1：书卡菜单多一条「归入分类…」。这一列菜单本来就是
     硬编码中文（六条老条目都在），只给新条目单独走 i18n 会变成中英混排，
     所以整组留到以后一次性收。 */
  'src/shell/book-menu.ts': 10,
  'src/shell/card-image.ts': 4,
  'src/shell/card-template.ts': 8,
  'src/shell/changelog-note.ts': 17,
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
  'src/ui/cross-search-panel.ts': 20,
  'src/ui/dom.ts': 7,
  'src/ui/import-panel.ts': 24,
  'src/view/header-actions.ts': 29,
  'src/view/reader-fault.ts': 1,
  'src/view/reader-view.ts': 9,
  'src/view/side-view.ts': 1,
};

/** 纯文案数据文件：与 i18n 同口径豁免（见文件头） */
const EXEMPT = new Set(['src/shell/changelog.ts']);

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
