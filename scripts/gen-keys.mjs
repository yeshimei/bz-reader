#!/usr/bin/env node
/* ============================================================
 * gen-keys.mjs —— 生成 bz-reader 的发行密钥对
 *
 *   node scripts/gen-keys.mjs
 *
 * 产出 scripts/keys/：
 *   private.pem       PKCS8 私钥（issue-license.mjs 用，绝不进 git）
 *   public-spki.b64   SPKI DER 的 base64（粘进 src/data/license.ts 的
 *                     PUBKEY_SPKI_B64 常量）
 * ============================================================ */
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const keysDir = join(here, 'keys');

if (existsSync(join(keysDir, 'private.pem'))) {
  const pub = readFileSync(join(keysDir, 'public-spki.b64'), 'utf8').trim();
  const fp = createHash('sha256').update(Buffer.from(pub, 'base64')).digest('hex').slice(0, 16);
  console.error('scripts/keys/private.pem 已存在，不覆盖（覆盖会让所有已发激活码作废）。');
  console.error(`当前公钥指纹 ${fp}…`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

mkdirSync(keysDir, { recursive: true });
writeFileSync(join(keysDir, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
const spkiB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
writeFileSync(join(keysDir, 'public-spki.b64'), spkiB64 + '\n');
writeFileSync(join(keysDir, 'README.txt'), [
  '这个目录是发行密钥，private.pem 泄露 = 任何人都能自己签激活码。',
  'private.pem 不进 git（.gitignore 已配），备份到密码管理器或离线介质。',
  'public-spki.b64 的内容粘进 src/data/license.ts 的 PUBKEY_SPKI_B64。',
].join('\n'));

const fp = createHash('sha256').update(Buffer.from(spkiB64, 'base64')).digest('hex').slice(0, 16);
console.log('✓ 密钥对已生成：scripts/keys/');
console.log(`  公钥指纹 ${fp}…`);
console.log('  下一步：把 public-spki.b64 的内容粘进 src/data/license.ts');
