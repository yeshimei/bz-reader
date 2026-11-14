/**
 * 开发期多语言占位（scripts/i18n-placeholders.mjs）
 *
 * 规矩见 AGENTS.md「核心原则」第 5 条：日常开发新增文案**只写 zh.ts 的中文**，
 * 不给任何外语包写翻译。中文包是 MsgKey 的类型真源，其余七包缺 key 会让
 * tsc 红，所以加完中文跑一次这条命令，由脚本补 [TODO] 占位顶住门禁。
 * 正式翻译、术语统一、润色统一放到上架流程一次做完。
 *
 *   node scripts/i18n-placeholders.mjs          给缺失的 key 补占位
 *   node scripts/i18n-placeholders.mjs --check  上架前查：有占位或漏 key 就退出码 1
 *
 * 只补缺失的 key，绝不覆盖已有译文；占位符从中文原句逐条抄过来，
 * tests/i18n-packs.test.ts 的「占位符与中文一致」才不会红。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n');
const PACKS = {
  'zh-TW': 'zh-tw.ts',
  en: 'en.ts',
  ja: 'ja.ts',
  de: 'de.ts',
  fr: 'fr.ts',
  es: 'es.ts',
  pt: 'pt.ts',
};
const TODO = '[TODO]';

const read = (file) => readFileSync(join(DIR, file), 'utf8');

/** 行首 'key': 就算这个 key 存在（值跨行 / 含转义引号都不影响判断） */
function keysOf(src) {
  return new Set([...src.matchAll(/^\s*'([A-Za-z0-9._-]+)':/gm)].map((m) => m[1]));
}

/** 中文原句里的占位符，按出现顺序取出来 */
function placeholdersOf(zhSrc, key) {
  const line = zhSrc.split(/\r?\n/).find((l) => l.match(/^\s*'([A-Za-z0-9._-]+)':/)?.[1] === key) ?? '';
  return [...line.matchAll(/\{(\w+)\}/g)].map((m) => `{${m[1]}}`);
}

/** 顶层对象闭合前的位置；认不出来宁可停，也不往文件里乱插 */
function insertAt(src) {
  const hits = [...src.matchAll(/\r?\n\}(?: as const)?;/g)];
  return hits.length ? hits[hits.length - 1].index : null;
}

const zh = read('zh.ts');
const zhKeys = keysOf(zh);
const check = process.argv.includes('--check');
let changed = 0;
const pending = [];

for (const [loc, file] of Object.entries(PACKS)) {
  const src = read(file);
  const have = keysOf(src);
  const missing = [...zhKeys].filter((k) => !have.has(k));
  const todos = src.split(/\r?\n/).filter((l) => l.includes(TODO)).length;
  if (missing.length || todos) pending.push(`${loc}: 缺 ${missing.length} 个 key / ${todos} 条待翻译`);

  if (check || !missing.length) continue;

  const at = insertAt(src);
  if (at === null) {
    console.error(`找不到 ${file} 的对象结尾，未改动`);
    process.exit(1);
  }
  const nl = src.startsWith('\r\n', at) ? '\r\n' : '\n';
  const lines = missing.map((k) => {
    const ph = placeholdersOf(zh, k).join(' ');
    return `  '${k}': '${TODO} ${k}${ph ? ` ${ph}` : ''}',`;
  });
  writeFileSync(join(DIR, file), src.slice(0, at) + nl + lines.join(nl) + src.slice(at), 'utf8');
  changed += missing.length;
  console.log(`${loc}: 补 ${missing.length} 条占位`);
}

/* tts.ts 一个文件里装着 TTS_ZH / TTS_ZH_TW / TTS_EN_BASE 三块，按上面的
   按文件统计查不到它——朗读那批文案曾经因此带着 92 条 [TODO] 走到发版门口。
   单列一条，宁可多查一次也别再漏。 */
const ttsTodo = read('tts.ts')
  .split(/\r?\n/)
  .filter((l) => l.includes(TODO)).length;
if (ttsTodo) pending.push(`tts.ts: ${ttsTodo} 条待翻译`);

if (check) {
  if (pending.length) {
    console.error(`还有未补齐的多语言：\n  ${pending.join('\n  ')}`);
    process.exit(1);
  }
  console.log('七种外语已全部补齐，没有 [TODO] 占位');
} else {
  console.log(`共补 ${changed} 条占位；正式翻译留到上架流程一次做完`);
}
