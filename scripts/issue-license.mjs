#!/usr/bin/env node
/* ============================================================
 * issue-license.mjs —— 签发 bz-reader 激活码
 *
 *   node scripts/issue-license.mjs --name 包仔 [--days 365]
 *   node scripts/issue-license.mjs --name 包仔 --until 2027-12-31
 *
 * 输出形如 BZR1.<payload>.<sig> 的激活码，粘贴到 设置 → bz 阅读 → 授权。
 * 需要 scripts/keys/private.pem（gen-keys.mjs 生成）。
 *
 * 签名 = ECDSA P-256 + SHA-256，**IEEE-P1363 裸格式（r||s 各 32 字节）**：
 * node crypto.sign 默认出 DER，WebCrypto 的 subtle.verify 只认裸格式，
 * 这里做一次 DER→裸 的转换（解析 SEQUENCE 里的两个 INTEGER）。
 * ============================================================ */
import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const keyPath = join(here, 'keys', 'private.pem');
if (!existsSync(keyPath)) {
  console.error('找不到 scripts/keys/private.pem —— 先跑 node scripts/gen-keys.mjs');
  process.exit(1);
}

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const name = arg('name');
const days = Number(arg('days') || 0);
const until = arg('until');

let exp = 0;
if (until) exp = new Date(`${until}T23:59:59`).getTime();
else if (days > 0) exp = Date.now() + days * 86_400_000;
if (Number.isNaN(exp)) {
  console.error('--until 的日期看不懂，要 YYYY-MM-DD');
  process.exit(1);
}

const payload = { v: 1, ...(name ? { name } : {}), ...(exp ? { exp } : {}) };
const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');

/** DER 签名（SEQUENCE{r INTEGER, s INTEGER}）→ IEEE-P1363 裸 r||s，各 32 字节 */
function derToP1363(der) {
  if (der[0] !== 0x30) throw new Error('签名不是 DER SEQUENCE');
  let at = 2;
  const readInt = () => {
    // at 指向 INTEGER tag；跳 tag(len) 拿内容
    if (der[at] !== 0x02) throw new Error('DER 里不是 INTEGER');
    const len = der[at + 1];
    const val = der.subarray(at + 2, at + 2 + len);
    at += 2 + len;
    const out = Buffer.alloc(32);
    // 正数前面如果补了 0x00，跳掉；不足 32 字节左填充
    let start = 0;
    while (start < val.length && val[start] === 0) start += 1;
    if (val.length - start > 32) throw new Error('INTEGER 比 32 字节还长');
    val.copy(out, 32 - (val.length - start), start);
    return out;
  };
  const r = readInt();
  const s = readInt();
  return Buffer.concat([r, s]);
}

const signer = createSign('sha256');
signer.update(payloadBytes);
const privateKeyPem = readFileSync(keyPath);
const der = signer.sign({ key: privateKeyPem, dsaEncoding: 'der' });
const sig = derToP1363(der);

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const code = `BZR1.${b64url(payloadBytes)}.${b64url(sig)}`;

console.log(code);
console.error(`--- ${name || '未署名'} · ${exp ? new Date(exp).toLocaleDateString() : '永久'}`);
