#!/usr/bin/env node
/* ============================================================
 * license-admin.mjs —— 本地激活库的查看 / 撤回 / 加次数
 *
 *   node scripts/license-admin.mjs --list
 *   node scripts/license-admin.mjs --revoke U-20261103-01
 *   node scripts/license-admin.mjs --unrevoke U-20261103-01
 *   node scripts/license-admin.mjs --set-max P-20261103-0001 10
 *   node scripts/license-admin.mjs --stats P-20261103-0001
 *
 * 只改 server/dev-server.mjs 用的 JSON 库（默认 .scratch/license-store.json）。
 * 线上 D1 用 wrangler d1 execute，见 server/README.md。
 * ============================================================ */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const storePath = resolve(arg('store') || join(root, '.scratch', 'license-store.json'));

if (!existsSync(storePath)) {
  console.error(`没有找到激活库：${storePath}\n先跑 node server/dev-server.mjs 并核销一次，或手动建空文件。`);
  process.exit(1);
}

/** @type {{codes: any[], activations: any[]}} */
const data = JSON.parse(readFileSync(storePath, 'utf8'));
if (!Array.isArray(data.codes)) data.codes = [];
if (!Array.isArray(data.activations)) data.activations = [];

function save() {
  writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf8');
}

function usedOf(id) {
  return data.activations.filter((a) => a.code_id === id).length;
}

function fmt(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

if (args.includes('--list')) {
  if (!data.codes.length) {
    console.log('（空库）');
  } else {
    for (const c of data.codes) {
      const used = usedOf(c.id);
      const limit = c.max_act ?? '∞';
      console.log(
        [
          c.revoked ? '⛔' : '  ',
          c.id.padEnd(22),
          String(c.kind).padEnd(10),
          `${used}/${limit}`.padEnd(8),
          c.days > 0 ? `${c.days} 天` : '永久',
          c.redeem_by ? `兑换至 ${fmt(c.redeem_by)}` : '',
          c.note || '',
        ]
          .filter(Boolean)
          .join('  '),
      );
    }
  }
  process.exit(0);
}

const id = arg('revoke') || arg('unrevoke') || arg('stats') || arg('set-max');
if (!id) {
  console.error('用法：--list | --revoke <id> | --unrevoke <id> | --set-max <id> <n> | --stats <id>');
  process.exit(1);
}

const row = data.codes.find((c) => c.id === id);
if (!row) {
  console.error(`库里没有这枚码：${id}`);
  process.exit(1);
}

if (args.includes('--revoke')) {
  row.revoked = 1;
  save();
  console.log(`⛔ 已停用 ${id}（只拦新激活；已发出的令牌不受影响）`);
} else if (args.includes('--unrevoke')) {
  row.revoked = 0;
  save();
  console.log(`✓ 已恢复 ${id}`);
} else if (args.includes('--set-max')) {
  const i = args.indexOf('--set-max');
  const n = Number(args[i + 2]);
  if (!Number.isInteger(n) || n < 1) {
    console.error('--set-max 的次数要 >= 1');
    process.exit(1);
  }
  row.max_act = n;
  save();
  console.log(`✓ ${id} 的激活上限改为 ${n}（当前已用 ${usedOf(id)}）`);
} else if (args.includes('--stats')) {
  const acts = data.activations.filter((a) => a.code_id === id);
  console.log(`${id}  ${row.kind}  ${row.revoked ? '已停用' : '有效'}`);
  console.log(`激活 ${acts.length} 次${row.max_act ? ` / 上限 ${row.max_act}` : '（不限）'}`);
  for (const a of acts) {
    console.log(`  · ${String(a.install_id).slice(0, 8)}…  首次 ${fmt(a.first_at)}`);
  }
}
