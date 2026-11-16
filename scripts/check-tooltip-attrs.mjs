/* ============================================================
 * 禁止悬停气泡属性（scripts/check-tooltip-attrs.mjs）
 *
 * Obsidian 会把 aria-label / title / setTooltip 变成悬停气泡——指针一移入就冒，
 * 用户看着像「莫名其妙的小弹窗」。本脚本扫 src/ 下所有 TS，发现这些属性写到
 * DOM 上就报错退出；读屏名字一律改用视觉隐藏文本（srText / .bzrv-sr-only）。
 *
 * 数据对象的 .title 字段（book.title / meta.title 等）不算，只拦 DOM 写法：
 *   · 模板字符串里的 aria-label="..." / title="..."
 *   · el.setAttribute('aria-label'|'title', ...)
 *   · el.title = ... / el.setAttribute('title', ...)
 *   · .setTooltip(...)
 * 用法：node scripts/check-tooltip-attrs.mjs   （退出码 0=干净，1=有违规）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'src');

/** 给定源码文本，返回违规行号与命中片段。纯函数，供测试直接调用。 */
export function findTooltipAttrs(code) {
  const hits = [];
  const lines = code.split('\n');
  // DOM 元素变量命名习惯：以 el / btn / node / input / title 等结尾的接收者。
  // 为避免误伤 book.title / meta.title 等数据字段，只在明确的 DOM 写法上下手。
  const rules = [
    { re: /\bsetAttribute\(\s*['"](?:aria-label|title)['"]\s*,/, why: 'setAttribute tooltip attr' },
    { re: /\.setTooltip\s*\(/, why: 'setTooltip' },
    { re: /['"]aria-label['"]\s*:/, why: 'aria-label object key' },
    // 前面不是点号/连字符，且等号后紧跟引号：只认 HTML 属性写法，
    // 避免误伤 book.title = 'x' 和 data-title="..." 这类数据字段。
    { re: /(?<![\w-])(?:aria-label|title)=["'`]/, why: 'HTML tooltip attr' },
  ];
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    for (const r of rules) {
      if (r.re.test(line)) hits.push({ line: idx + 1, why: r.why, text: trimmed });
    }
  });
  return hits;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const violations = [];
for (const f of walk(SRC)) {
  const hits = findTooltipAttrs(fs.readFileSync(f, 'utf8'));
  for (const h of hits) violations.push({ file: path.relative(process.cwd(), f).replace(/\\/g, '/'), ...h });
}

if (violations.length) {
  console.error(`发现 ${violations.length} 处悬停气泡属性（aria-label / title / setTooltip）：`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}  [${v.why}]  ${v.text}`);
  console.error('改用视觉隐藏文本（srText / .bzrv-sr-only），不要给 DOM 挂这些属性。');
  process.exit(1);
}
console.log('悬停气泡属性检查通过：src/ 下无 aria-label / title / setTooltip 的 DOM 写法。');
