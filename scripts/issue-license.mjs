#!/usr/bin/env node
/* ============================================================
 * issue-license.mjs —— 签发 bz-reader 激活码
 *
 * 通用码（QQ 群福利，激活后 N 天，可撤回）：
 *   node scripts/issue-license.mjs --kind universal --days 7 --redeem-by 2026-12-03
 *
 * 付费码（永久，最多激活 N 台）：
 *   node scripts/issue-license.mjs --kind paid --max-act 5 --name 张三
 *
 * 老格式（BZR2，纯离线、不核销，仅留给已发出的码）：
 *   node scripts/issue-license.mjs --legacy --days 365
 *
 * 输出形如 BZR3.<payload>.<sig>，粘贴到 设置 → 授权。
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
const has = (name) => args.includes(`--${name}`);

const kind = arg('kind') || 'paid';
if (kind !== 'universal' && kind !== 'paid') {
  console.error('--kind 只能是 universal 或 paid');
  process.exit(1);
}

const legacy = has('legacy');
const name = arg('name');
const note = arg('note');

/** 码号用本地日期（UTC 会在凌晨差一天，给客服对账添麻烦） */
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

const prefix = kind === 'universal' ? 'U' : 'P';
const id = arg('id') || `${prefix}-${stamp()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

/* ── 天数：通用码默认 7，付费码默认 0（永久） ── */
const daysRaw = arg('days');
const days = daysRaw === undefined ? (kind === 'universal' ? 7 : 0) : Number(daysRaw);
if (!Number.isFinite(days) || days < 0) {
  console.error('--days 要是一个非负整数');
  process.exit(1);
}
if (kind === 'universal' && days < 1) {
  console.error('通用码必须 --days >= 1（激活后有效天数）');
  process.exit(1);
}

/* ── 激活次数：只有付费码有 ── */
const maxActRaw = arg('max-act');
const maxAct = maxActRaw === undefined ? (kind === 'paid' ? 5 : undefined) : Number(maxActRaw);
if (kind === 'paid') {
  if (!Number.isInteger(maxAct) || maxAct < 1) {
    console.error('--max-act 要是一个 >= 1 的整数');
    process.exit(1);
  }
}

/* ── 兑换截止：通用码默认发码后 30 天，付费码不设 ── */
function endOfDay(ymd) {
  const ms = new Date(`${ymd}T23:59:59`).getTime();
  if (Number.isNaN(ms)) {
    console.error(`--redeem-by 的日期看不懂：「${ymd}」，要 YYYY-MM-DD`);
    process.exit(1);
  }
  return ms;
}
let redeemBy;
if (arg('redeem-by')) redeemBy = endOfDay(arg('redeem-by'));
else if (kind === 'universal') redeemBy = Date.now() + 30 * 86_400_000;

/* ── payload ──
 * v3：带 kind / days / maxAct / redeemBy，客户端必须先联网核销一次。
 * v2：老格式，纯离线，不核销——只留给已经发出去的码。 */
const payload = legacy
  ? {
      v: 2,
      id,
      ...(name ? { name } : {}),
      plan: days > 0 ? 'year' : 'lifetime',
      ...(days > 0 ? { exp: Date.now() + days * 86_400_000 } : {}),
    }
  : {
      v: 3,
      kind,
      id,
      ...(name ? { name } : {}),
      days,
      ...(kind === 'paid' ? { maxAct } : {}),
      ...(redeemBy ? { redeemBy } : {}),
      ...(note ? { note } : {}),
    };

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
const tag = legacy ? 'BZR2' : 'BZR3';
const code = `${tag}.${b64url(payloadBytes)}.${b64url(sig)}`;

console.log(code);

const bits = [
  legacy ? '老格式 BZR2（离线，不核销）' : kind === 'universal' ? '通用码' : '付费码',
  id,
  days > 0 ? `${days} 天` : '永久',
  ...(kind === 'paid' && !legacy ? [`最多 ${maxAct} 次激活`] : []),
  ...(redeemBy ? [`兑换截止 ${new Date(redeemBy).toLocaleDateString()}`] : []),
  ...(name ? [`署名 ${name}`] : []),
  ...(note ? [note] : []),
];
console.error(`--- ${bits.join(' · ')}`);
