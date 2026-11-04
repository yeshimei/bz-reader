/* ============================================================
 * bz-reader · 上架前 lint（scripts/lint-obsidian.mjs）
 *
 * 跑 Obsidian 官方的 `eslint-plugin-obsidianmd`（recommended 配置）。
 * 社区目录的自动审核和这套规则同源，上架前必须清零：error 会直接卡审，
 * warning 是审核意见的高频来源。
 *
 * 依赖为什么不装进项目：主仓 `node_modules` 是历史 pnpm 链接（依赖 symlink
 * 指到另一个 worktree 的虚拟 store），任何 `pnpm add` 都会报
 * UNEXPECTED_VIRTUAL_STORE。所以工具装在仓库外的固定目录，复用缓存：
 *
 *   %LOCALAPPDATA%\bz-reader-lint\
 *
 * 用法：
 *   node scripts/lint-obsidian.mjs             # 全量 src
 *   node scripts/lint-obsidian.mjs --fix       # 自动修可修的
 *
 * 退出码直接透传：0 = 干净，非 0 = 有问题（上架流程据此中断）。
 * ============================================================ */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TOOLS = path.join(process.env.LOCALAPPDATA || os.homedir(), 'bz-reader-lint');
const PLUGIN_DIR = path.join(TOOLS, 'node_modules', 'eslint-plugin-obsidianmd');
const ESLINT_BIN = path.join(TOOLS, 'node_modules', 'eslint', 'bin', 'eslint.js');
const CONFIG = path.join(process.cwd(), 'eslint.config.mjs');

const PKGS = [
  'eslint@9',
  '@eslint/js@9',
  '@eslint/json@0.14',
  'typescript-eslint@8',
  'eslint-plugin-obsidianmd@0.4.2',
];

function ensureTools() {
  if (fs.existsSync(PLUGIN_DIR) && fs.existsSync(ESLINT_BIN)) return;
  console.log(`[lint] 首次运行，安装工具到 ${TOOLS} …`);
  fs.mkdirSync(TOOLS, { recursive: true });
  if (!fs.existsSync(path.join(TOOLS, 'package.json'))) {
    fs.writeFileSync(path.join(TOOLS, 'package.json'), JSON.stringify({ name: 'bz-reader-lint', private: true }, null, 2));
  }
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--legacy-peer-deps', ...PKGS], {
    cwd: TOOLS,
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) {
    console.error('[lint] 安装失败，检查网络后重试');
    process.exit(r.status ?? 1);
  }
}

/**
 * 配置必须落在项目根：ESLint 9 的 base path 跟着配置文件走，
 * 配置放在别的目录，`src/**` 会被判成「在 base path 之外」而整批忽略。
 */
function writeConfig() {
  const pluginUrl = pathToFileURL(path.join(PLUGIN_DIR, 'dist', 'lib', 'index.js')).href;
  fs.writeFileSync(
    CONFIG,
    [
      `import obsidianmd from ${JSON.stringify(pluginUrl)};`,
      '',
      'export default [',
      '  ...obsidianmd.configs.recommended,',
      '  {',
      '    languageOptions: {',
      '      /* esbuild define 注入的两个常量（types/globals.d.ts 里给 TS 声明过） */',
      '      globals: {',
      "        __BZ_READER_PRO__: 'readonly',",
      "        __BZ_BUILD_TAG__: 'readonly',",
      '      },',
      '      parserOptions: {',
      '        projectService: { allowDefaultProject: [\'eslint.config.*\'] },',
      '        tsconfigRootDir: ' + JSON.stringify(process.cwd().replace(/\\/g, '/')) + ',',
      '      },',
      '    },',
      '    rules: {',
      '      /*',
      '       * 这条规则报的全是「没有替代品」的弃用：',
      '       *  - caretRangeFromPoint：Chromium 只认它，caretPositionFromPoint 还没落地；',
      '       *  - Workspace.activeLeaf：getLeaf(false) 在无活动 leaf 时会退回主 leaf，',
      '       *    语义和「只认当前活动 leaf」不同。',
      '       * 两条都在 minAppVersion 1.7.2 上可用，换 API 等于改行为或功能退化。',
      '       */',
      "      '@typescript-eslint/no-deprecated': 'off',",
      '    },',
      '  },',
      '];',
      '',
    ].join('\n'),
  );
}

function cleanup() {
  try {
    if (fs.existsSync(CONFIG)) fs.rmSync(CONFIG, { force: true });
  } catch {
    /* 清理失败不影响结论 */
  }
}

ensureTools();
writeConfig();
try {
  const fix = process.argv.includes('--fix');
  const args = [ESLINT_BIN, '--config', 'eslint.config.mjs', 'src/**/*.ts', '-f', 'stylish'];
  if (fix) args.push('--fix');
  const r = spawnSync(process.execPath, args, { cwd: process.cwd(), stdio: 'inherit' });
  const code = r.status ?? 1;
  if (code === 0) console.log('[lint] 干净：0 error / 0 warning');
  else console.error('[lint] 有问题，上架前必须修完（或按 AGENTS.md 的例外说明处理）');
  process.exit(code);
} finally {
  cleanup();
}
