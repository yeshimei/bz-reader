#!/usr/bin/env node
/**
 * bz-reader · 上架前 CSS 检查（scripts/lint-css.mjs）
 *
 * 为什么要有这一份：`lint-obsidian.mjs` 跑的是 eslint，只看 `src/**\/*.ts`；
 * 社区目录的自动审核还会扫样式，报的是另一套规则。1.1.0 送审时就栽在这：
 * 本地 0/0，网页上却是一屏 `!important`、`:has`、重复属性。
 *
 * 这里把审核会挑的几条本地化，规则宁窄勿宽——误报会让人开始无视它：
 *   1. `!important`：官方明确要求避免（覆盖宿主请用特异性或 CSS 变量）；
 *   2. `:has()`：会触发整棵子树的选择器失效，按性能问题报；
 *   3. 同一条规则里同名属性写两遍（常见于 `vh` + `dvh` 的渐进增强）；
 *   4. `text-indent`：Obsidian 1.7.4 对它的支持只算部分。
 *
 * 注释里的字样不算数：先把块注释剥掉再查。
 *
 * 用法：`node scripts/lint-css.mjs`；退出码 0 = 干净，非 0 = 有问题。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const RULES = [
  { test: /!\s*important/g, msg: '不要用 !important：提高选择器特异性，或覆盖 CSS 变量' },
  { test: /:has\s*\(/g, msg: '不要用 :has()：会给选择器失效带来整棵子树的代价' },
  { test: /\btext-indent\s*:/g, msg: 'text-indent 在 Obsidian 1.7.4 上只算部分支持' },
];

/** 递归收集 .css */
function cssFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

/** 把块注释换成等长空白，保留换行——这样行号不会漂 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** 1-based 行号 */
function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/**
 * 同一条规则里的重复属性。
 *
 * 只扫 `{ … }` 之间、且不含嵌套（本项目没有 CSS 嵌套），按 `;` 切声明。
 * 出现两次以上就报，同一行写两遍（`margin: 0; margin: 1px`）也算。
 */
function duplicateProps(text) {
  const out = [];
  const ruleRe = /\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(text))) {
    const body = m[1];
    const base = m.index + 1;
    const seen = new Map();
    const decls = body.split(';');
    let cursor = 0;
    for (const raw of decls) {
      const decl = raw.trim();
      const at = body.indexOf(raw, cursor);
      cursor = at + raw.length;
      if (!decl) continue;
      const colon = decl.indexOf(':');
      if (colon <= 0) continue;
      const name = decl.slice(0, colon).trim().toLowerCase();
      if (!/^[-a-z]+$/.test(name)) continue; /* 变量与自定义属性不查 */
      const offset = base + Math.max(0, at);
      const prev = seen.get(name);
      if (prev !== undefined) {
        out.push({
          line: lineOf(text, offset),
          msg: `同一条规则里 "${name}" 写了两次（上一次在第 ${prev} 行）`,
        });
      } else {
        seen.set(name, lineOf(text, offset));
      }
    }
  }
  return out;
}

let problems = 0;
for (const file of cssFiles(SRC)) {
  const raw = fs.readFileSync(file, 'utf8');
  const text = stripComments(raw);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const list = [];

  for (const rule of RULES) {
    rule.test.lastIndex = 0;
    let m;
    while ((m = rule.test.exec(text))) list.push({ line: lineOf(text, m.index), msg: rule.msg });
  }
  list.push(...duplicateProps(text));

  if (!list.length) continue;
  list.sort((a, b) => a.line - b.line);
  for (const item of list) console.log(`${rel}:${item.line}  ${item.msg}`);
  problems += list.length;
}

if (problems) {
  console.error(`[css] 有 ${problems} 处需要处理，上架前必须清零`);
  process.exit(1);
}
console.log('[css] 干净：0 error / 0 warning');
