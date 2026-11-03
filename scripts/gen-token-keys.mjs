#!/usr/bin/env node
/* ============================================================
 * gen-token-keys.mjs —— 生成「设备令牌」签名密钥对
 *
 *   node scripts/gen-token-keys.mjs
 *
 * 为什么要跟发行密钥分开：
 *   scripts/keys/private.pem 是发行私钥，只离线签发 BZR3 激活码，绝不进服务器；
 *   这把是服务端私钥，放在 Worker 的 secret 里，用来签 BZRT 设备令牌。
 *   两把分开，服务器被拖库最多伪造 7 天试用令牌（换客户端公钥即可封），
 *   签不出买断码。
 *
 * 产出 scripts/keys/：
 *   token-private.pem       PKCS8 私钥（Worker secret，不进 git）
 *   token-public-spki.b64   SPKI DER 的 base64（粘进 src/data/license.ts 的
 *                           TOKEN_PUBKEY_SPKI_B64）
 * ============================================================ */
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const keysDir = join(here, 'keys');
const privPath = join(keysDir, 'token-private.pem');

if (existsSync(privPath)) {
  const pub = readFileSync(join(keysDir, 'token-public-spki.b64'), 'utf8').trim();
  const fp = createHash('sha256').update(Buffer.from(pub, 'base64')).digest('hex').slice(0, 16);
  console.error('scripts/keys/token-private.pem 已存在，不覆盖（覆盖会让所有已发出的试用令牌失效）。');
  console.error(`当前令牌公钥指纹 ${fp}…`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

mkdirSync(keysDir, { recursive: true });
writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
const spkiB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
writeFileSync(join(keysDir, 'token-public-spki.b64'), spkiB64 + '\n');

const fp = createHash('sha256').update(Buffer.from(spkiB64, 'base64')).digest('hex').slice(0, 16);
console.log('✓ 令牌密钥对已生成：scripts/keys/');
console.log(`  公钥指纹 ${fp}…`);
console.log('  下一步：把 token-public-spki.b64 粘进 src/data/license.ts 的 TOKEN_PUBKEY_SPKI_B64');
