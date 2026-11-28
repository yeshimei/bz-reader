#!/usr/bin/env node
/* ============================================================
 * gen-revoked-builtin.mjs —— 把已吊销的码号烘焙进插件包
 *
 *   node scripts/gen-revoked-builtin.mjs
 *
 * 为什么要有这一层（2026-11-28）：
 *   撤销名单是联网拉的，拉不到就放行。于是「断网 + 清本地标记」就成了
 *   一条稳定的绕过路径；作者封了码之后也只能等用户下次联网才生效。
 *   把发版那一刻的名单直接写进包里，离线也有一个下限：
 *     · 断网启动，内置名单照样命中；
 *     · 清 localStorage 也没用，常量在代码里；
 *     · 跨插件漏封（赞助人码只封了一边）到下一个版本会被这次合并兜住。
 *
 * 为什么不是「永久」：
 *   内置名单是**发版快照**，只能加不能减。解封的码如果还在常量里，用户
 *   会被老版本永久锁死。所以运行时用 `updatedAt` 做闸门——设备一旦拿到过
 *   不早于这个版本的线上名单，就以联网结果为准（见 revoked.ts 的
 *   builtinRevokedHit）。解封后用户联网一次即恢复。
 *
 * 纪律：每次改完 docs/revoked.json、发版之前都要跑这一条。
 * `tests/revoked-builtin.test.ts` 会检查常量与名单是否同步，忘了跑就红。
 * ============================================================ */
import { createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const listPath = join(root, 'docs', 'revoked.json');
const licensePath = join(root, 'src', 'data', 'license.ts');
const outPath = join(root, 'src', 'data', 'revoked-builtin.ts');

/** 与 src/data/revoked.ts 的 revokedSignText 一字不差 */
function signText(doc) {
  const ids = [...(doc.ids || [])].map((x) => String(x).trim().toUpperCase()).sort();
  const hashes = [...(doc.hashes || [])].map((x) => String(x).trim().toLowerCase()).sort();
  return ['bzr-revoked', String(doc.v), String(doc.updatedAt), ids.join(','), hashes.join(',')].join('\n');
}

/** 公钥以内嵌常量为准：那份才是包里真正用来验签的 */
function embeddedPub() {
  const src = readFileSync(licensePath, 'utf8');
  const m = /PUBKEY_SPKI_B64\s*=\s*\n?\s*'([^']+)'/.exec(src);
  if (!m) throw new Error('src/data/license.ts 里找不到 PUBKEY_SPKI_B64');
  return m[1].trim();
}

function verified(doc, spki) {
  try {
    const key = createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' });
    const sig = Buffer.from(String(doc.sig || ''), 'base64url');
    if (sig.length !== 64) return false;
    return verify('sha256', Buffer.from(signText(doc), 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, sig);
  } catch {
    return false;
  }
}

let doc = { v: 1, updatedAt: 0, ids: [], hashes: [] };
if (existsSync(listPath)) {
  doc = JSON.parse(readFileSync(listPath, 'utf8'));
  if (!verified(doc, embeddedPub())) {
    console.error('✗ docs/revoked.json 验签失败 —— 拒绝把一份坏名单烘焙进包');
    process.exit(1);
  }
} else {
  console.error('! 没有 docs/revoked.json，生成空名单');
}

const ids = [...new Set((doc.ids || []).map((x) => String(x).trim().toUpperCase()).filter(Boolean))].sort();
const hashes = [...new Set((doc.hashes || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))].sort();
const updatedAt = Number(doc.updatedAt) || 0;

const arr = (name, type, values) => {
  if (!values.length) return `export const ${name}: readonly ${type}[] = [];`;
  const lines = values.map((v) => `  '${v}',`).join('\n');
  return `export const ${name}: readonly ${type}[] = [\n${lines}\n];`;
};

const body = `/* ============================================================
 * 已吊销码号（内置名单）—— 自动生成，别手改
 *
 * 由 \`npm run gen:revoked\` 从 docs/revoked.json 生成，随每个版本发布。
 * 作用：断网 / 清存储 / 屏蔽域名时，这些码仍然会被判停用。
 * 解封靠 updatedAt 闸门：设备拿到过不早于本版本的线上名单后，
 * 这份快照即失效（见 src/data/revoked.ts 的 builtinRevokedHit）。
 * ============================================================ */

/** 生成时名单的版本号；运行时拿它和设备见过的名单版本比 */
export const BUILTIN_REVOKED_UPDATED_AT = ${updatedAt};

${arr('BUILTIN_REVOKED_IDS', 'string', ids)}

${arr('BUILTIN_REVOKED_HASHES', 'string', hashes)}
`;

const old = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
if (old === body) {
  console.log(`✓ 内置名单已是最新（版本 ${updatedAt || '空'}，${ids.length} 个码号），不改文件`);
} else {
  writeFileSync(outPath, body, 'utf8');
  console.log(`✓ 已生成 src/data/revoked-builtin.ts（版本 ${updatedAt || '空'}，${ids.length} 个码号、${hashes.length} 条摘要）`);
}
