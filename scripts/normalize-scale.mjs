/* ============================================================
 * 尺度收敛脚本（scripts/normalize-scale.mjs）
 *
 * 一次性把散落的尺度值并到 tokens.css 定下的那几档上。
 * 为什么要写成脚本：涉及 17000 行 CSS、几百处声明，手改必然漏，
 * 而且**可以重复跑**——规范过的值再跑一次不会变，将来谁又写进裸数字，
 * 跑一遍就收回去。
 *
 * 用法：node scripts/normalize-scale.mjs [--dry]
 *
 * 只做三件不会破坏布局的事：
 *   1. 字号：< 11px 的提到 11px（中文在 Windows 上低于这个值就发虚），
 *      .5 档并入整数档（11.5→12、12.5→12、13.5→13），14px 并入 15px。
 *   2. 圆角：并到 2 / 4 / 6 / 10 / 999 五档。
 *   3. 字距：≥ .1em 的装饰性字距归零（中文是方块字，拉开就是散的）。
 *   4. 衬线：UI 控件（徽记、按钮、表头、元信息）改用无衬线，
 *      书名 / 引文 / 正文保留衬线。
 *
 * **不动间距**：padding / gap / margin 一旦改错就是挤压和溢出，
 * 必须看着界面调，脚本不做这种 blind edit。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FILES = [
  'src/styles.css',
  'src/core/ui/tokens.css',
  'src/shell/styles/tokens.css',
  'src/shell/styles/common.css',
  'src/shell/styles/sidebar.css',
  'src/shell/styles/study.css',
  'src/shell/styles/overlay.css',
  'src/shell/styles/reader.css',
  'src/shell/styles/mobile.css',
];

const DRY = process.argv.includes('--dry');

/* ── 字号 ── */
const FS_MAP = {
  '8px': '11px',
  '8.5px': '11px',
  '9px': '11px',
  '9.5px': '11px',
  '10px': '11px',
  '10.5px': '11px',
  '11.5px': '12px',
  '12.5px': '12px',
  '13.5px': '13px',
  '14px': '15px',
};

/* ── 圆角 ── */
function normRadius(raw) {
  return raw
    .trim()
    .split(/\s+/)
    .map((n) => {
      if (n === '0') return '0';
      if (n.endsWith('%')) return n; // 50% 是正圆，不动
      const x = parseFloat(n);
      if (!Number.isFinite(x)) return n; // 已是 var(...) 之类
      if (x <= 2) return 'var(--r-book)';
      if (x <= 5) return 'var(--r-chip)';
      if (x <= 8) return 'var(--r-ctl)';
      if (x <= 18) return 'var(--r-card)';
      return 'var(--r-pill)';
    })
    .join(' ');
}

/* ── 字距 ── */
function normTracking(raw) {
  const v = raw.trim();
  if (v === '0' || v === 'normal') return v;
  const x = parseFloat(v);
  if (!Number.isFinite(x)) return v;
  // em 单位按 em 判；其余（px）不动
  if (v.endsWith('em') && x >= 0.1) return '0';
  return v;
}

/* ── 衬线退出的 UI 选择器（命中任一即视为 UI，不是「书」） ── */
const UI_HINTS = [
  'bzs-badge',
  'bzs-mini',
  'bzs-sect-h',
  'bzs-stunav',
  'bzs-btn',
  'bzs-chip',
  'bzs-meta',
  'bzs-kv',
  'bzs-sbsec',
  'bzs-mhead',
  'bzs-setrow',
  'bzs-keyrow',
  'bzs-flag',
  'bzs-empty',
  'bzs-mfoot',
  'bzs-filter',
  'bzs-shelfline',
  'bzs-pct',
  'bzs-sub',
  '.pc',
  '.no',
  '.sub',
  '.meta',
  '.dt',
  'select',
  'input',
  'button',
  'label',
  'table',
  'th',
  'td',
];
/* 这些就算带上面的词也不动：它们是「书」的一部分 */
const SERIF_KEEP = ['bzs-cov', '.ct', 'bzs-quote', 'bzs-fntext', 'bzs-rd', 'bzs-bkcard .bi b', 'bzs-cont2 h2', 'h1', 'h2', 'bzs-detail h2'];

function isUiSelector(sel) {
  const s = sel.toLowerCase();
  for (const k of SERIF_KEEP) if (s.includes(k)) return false;
  return UI_HINTS.some((h) => s.includes(h));
}

const stats = { fontSize: 0, radius: 0, tracking: 0, serif: 0, files: 0 };

for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  let sel = '';
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const brace = line.indexOf('{');
    if (brace >= 0) {
      sel = line.slice(0, brace).trim();
      continue;
    }
    if (line.indexOf('}') >= 0) sel = '';

    let out = line;

    out = out.replace(/font-size:\s*([^;]+);/g, (m, v) => {
      const key = v.trim();
      const to = FS_MAP[key];
      if (!to) return m;
      stats.fontSize++;
      return `font-size: ${to};`;
    });

    out = out.replace(/border-radius:\s*([^;]+);/g, (m, v) => {
      const to = normRadius(v);
      if (to === v.trim()) return m;
      stats.radius++;
      return `border-radius: ${to};`;
    });

    out = out.replace(/letter-spacing:\s*([^;]+);/g, (m, v) => {
      const to = normTracking(v);
      if (to === v.trim()) return m;
      stats.tracking++;
      return `letter-spacing: ${to};`;
    });

    if (sel && isUiSelector(sel)) {
      out = out.replace(/font-family:\s*var\(--serif\);/g, () => {
        stats.serif++;
        return 'font-family: var(--ui);';
      });
    }

    if (out !== line) {
      lines[i] = out;
      changed = true;
    }
  }

  if (changed) {
    stats.files++;
    if (!DRY) fs.writeFileSync(file, lines.join('\n'), 'utf8');
    console.log(`✓ ${rel}`);
  }
}

/* 热力图两档硬编码铜色：换强调色主题时会留下一块脏黄 */
const heatFile = path.join(ROOT, 'src/shell/styles/study.css');
if (fs.existsSync(heatFile)) {
  let css = fs.readFileSync(heatFile, 'utf8');
  const before = css;
  css = css
    .replace(/rgba\(200,\s*164,\s*100,\s*\.32\)/g, 'color-mix(in srgb, var(--copper) 32%, transparent)')
    .replace(/rgba\(200,\s*164,\s*100,\s*\.58\)/g, 'color-mix(in srgb, var(--copper) 58%, transparent)');
  if (css !== before) {
    if (!DRY) fs.writeFileSync(heatFile, css, 'utf8');
    console.log('✓ 热力图色阶改为 color-mix');
  }
}

console.log(
  `\n字号 ${stats.fontSize} · 圆角 ${stats.radius} · 字距 ${stats.tracking} · 衬线 ${stats.serif} · 文件 ${stats.files}`,
);
if (DRY) console.log('（dry run，没有写盘）');
