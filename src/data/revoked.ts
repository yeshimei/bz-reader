/* ============================================================
 * bz-reader · 激活码停用名单（src/data/revoked.ts）
 *
 * 激活码是**离线签名**的：签名只证明「这枚码是作者发的」，证明不了
 * 「它现在还有效」。退款、公开分享、倒卖出去的码，签名全都合法。
 * 停用名单补的就是这一段——作者把码号写进公开的 docs/revoked.json，
 * 插件联网取回来，命中就降级。
 *
 * 三条硬约束：
 *   1. **只存码号，不存码原文**：名单是公开文件，贴原文等于把码公开。
 *      老码（BZR1，payload 里没有 id）退回存码的摘要。
 *   2. **必须验签**：否则代理 / 机场 / 公共 WiFi 能塞一份假名单，把所有
 *      付费用户打回基础版——那是比盗版更糟的事故。验签不过一律当「没拉到」。
 *   3. **拉不到就放行**：离线用户本来就不该被这道门卡住。代价是「屏蔽
 *      两个域名」就能绕过，这是离线授权的天花板，不假装能补。
 *
 * 本地只存两样东西：
 *   · `code`——当前已被判死的那枚码原文。断网重启也能立刻降级，并且
 *     它让这枚码「贴不回来」（激活入口先查这里，不必等网络）。
 *   · `at`——见过的最大名单版本。防重放：拿一份几天前的旧名单回来，
 *     被封的码会复活，所以旧名单直接丢掉。
 * 名单内容本身不落盘：每次启动重拉。
 * ============================================================ */
import { requestUrl } from 'obsidian';
import { locale } from '../i18n';
import { parseLicense, verifySignedBytes } from './license';
import { noteServerDateHeader } from './trusted-clock';

const GITHUB_RAW = 'https://raw.githubusercontent.com/yeshimei/bz-reader/master/docs/revoked.json';
const GITEE_RAW = 'https://gitee.com/ntbl/bz-reader/raw/master/docs/revoked.json';

/** 两条下载通道，顺序固定只为对外可见；实际拉取顺序看 revokedOrder() */
export const REVOKED_URLS: readonly string[] = [GITHUB_RAW, GITEE_RAW];

/**
 * 两源一起抓、谁先回用谁（2026-11-23）：这里只决定**谁先发起请求**——
 * 简中先码云（国内直连快），其余语言先 GitHub。发完就竞速，不比较两份
 * 名单的新旧（作者保证两处内容一致），先回且验签通过的那份立刻生效。
 */
export function revokedOrder(): readonly string[] {
  return locale() === 'zh' ? [GITEE_RAW, GITHUB_RAW] : [GITHUB_RAW, GITEE_RAW];
}

/** 本地状态键。带版本号：将来换结构时老状态自动作废 */
export const REVOKED_STATE_KEY = 'bz-reader:revoked:v1';

/**
 * 自动核对的间隔（2026-11-22 定）：只在启动时查一次，**24 小时内不重复**。
 *
 * 反复启停 Obsidian、切库、插件重载都不该把两个 CDN 当接口刷。用户想立刻
 * 生效就点设置页那枚「核对」——那条路 force，不走这个间隔。
 */
export const REVOKED_CHECK_GAP_MS = 24 * 60 * 60 * 1000;

/** 激活时等名单的上限。激活是用户主动等待，可以比后台宽 */
export const REVOKED_ACTIVATE_TIMEOUT_MS = 8_000;

/** 后台拉取的超时。拉不到不打扰任何人 */
const FETCH_TIMEOUT_MS = 4_000;

/** 老码摘要长度（sha256 十六进制前 16 位 = 64 bit，够防撞） */
const HASH_LEN = 16;

/** 名单结构。`sig` 覆盖固定拼接串，不签 JSON 原文（换行与键序都会漂） */
export interface RevokedDoc {
  v: 1;
  updatedAt: number;
  ids: string[];
  hashes: string[];
  sig: string;
}

export type RevokedHttp = (url: string, timeoutMs: number) => Promise<string | null>;

/** clear = 名单拉到了且没有这枚码；hit = 命中；unknown = 没拉到 / 验签不过 / 旧名单；skipped = 24 小时内已经查过 */
export type RevokedVerdict = 'clear' | 'hit' | 'unknown' | 'skipped';

interface State {
  /** 已被判死的码原文；空 = 没有 */
  code: string;
  /** 见过的最大名单版本（updatedAt） */
  at: number;
  /** 上次成功拉到名单的时刻（0 = 从没成功过）：24 小时节流用它 */
  checkedAt: number;
}

const EMPTY: State = { code: '', at: 0, checkedAt: 0 };

let cached: State | null = null;
let inflight: Promise<RevokedVerdict> | null = null;

/* ── 本地状态 ─────────────────────────────────────────────── */

function readState(): State {
  try {
    const raw = window.localStorage.getItem(REVOKED_STATE_KEY);
    if (!raw) return EMPTY;
    const o = JSON.parse(raw) as Partial<State> | null;
    return {
      code: typeof o?.code === 'string' ? o.code : '',
      at: typeof o?.at === 'number' && Number.isFinite(o.at) && o.at > 0 ? o.at : 0,
      checkedAt:
        typeof o?.checkedAt === 'number' && Number.isFinite(o.checkedAt) && o.checkedAt > 0
          ? o.checkedAt
          : 0,
    };
  } catch {
    return EMPTY;
  }
}

function writeState(s: State): void {
  try {
    window.localStorage.setItem(REVOKED_STATE_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式 / 无 localStorage：本次会话内存里还有，写不进去不算错误 */
  }
}

function st(): State {
  if (!cached) cached = readState();
  return cached;
}

/** 当前已被判死的码（同步，给 entitlement 的每帧判定用） */
export function revokedCode(): string {
  return st().code;
}

/** 见过的最大名单版本（0 = 从没拉到过） */
export function revokedSeenAt(): number {
  return st().at;
}

/** 上次成功核对名单的时刻（0 = 从没成功过） */
export function revokedCheckedAt(): number {
  return st().checkedAt;
}

/** 记下这枚码已停用。`at` 只往大里走，别被旧名单顶回去 */
export function markRevoked(code: string, at: number): void {
  const cur = st();
  const next: State = { code: code.trim(), at: Math.max(at, cur.at), checkedAt: cur.checkedAt };
  cached = next;
  writeState(next);
}

/** 解封（名单里已经没有这枚码了）：清掉码，但版本号留着防重放 */
export function clearRevoked(): void {
  const cur = st();
  if (!cur.code) return;
  const next: State = { code: '', at: cur.at, checkedAt: cur.checkedAt };
  cached = next;
  writeState(next);
}

/* ── 解析与验签 ───────────────────────────────────────────── */

/**
 * 签名覆盖的固定串。两端必须一字不差，所以**不用 JSON 原文**——
 * 键序、缩进、换行只要有一处不同，验签就会永远过不去。
 * 两份数组各排一次序：作者手改名单时顺序无关。
 */
export function revokedSignText(doc: Pick<RevokedDoc, 'v' | 'updatedAt' | 'ids' | 'hashes'>): string {
  /* 大小写也在这里抹平：作者手写名单时可能写小写，解析端会转成大写，
     两端各转一次才是同一个串——否则「名单写小写、签名照小写签」，
     验签时用大写重算就永远过不去。 */
  const ids = doc.ids.map((x) => x.trim().toUpperCase()).sort();
  const hashes = doc.hashes.map((x) => x.trim().toLowerCase()).sort();
  return ['bzr-revoked', String(doc.v), String(doc.updatedAt), ids.join(','), hashes.join(',')].join(
    '\n',
  );
}

const ID_RE = /^BZR-[A-Z0-9][A-Z0-9-]{2,39}$/;
const HASH_RE = /^[0-9a-f]{16,64}$/;

/**
 * 远端文本 → 名单。`null` = 整份不可用。
 *
 * 单条坏（码号格式不对 / 摘要不是十六进制）只丢那一条，不整份作废；
 * 空数组合法（真的没人被封）。`sig` 缺了整份不可用——没签名的名单
 * 一分钱都不值。
 */
export function parseRevoked(raw: unknown): RevokedDoc | null {
  let doc: unknown = raw;
  if (typeof raw === 'string') {
    try {
      doc = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const o = doc as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.updatedAt !== 'number' || !Number.isFinite(o.updatedAt) || o.updatedAt <= 0) return null;
  if (!Array.isArray(o.ids) || !Array.isArray(o.hashes)) return null;
  if (typeof o.sig !== 'string' || !o.sig) return null;

  const ids: string[] = [];
  for (const x of o.ids) {
    if (typeof x !== 'string') continue;
    const id = x.trim().toUpperCase();
    if (!ID_RE.test(id) || ids.includes(id)) continue;
    ids.push(id);
  }
  const hashes: string[] = [];
  for (const x of o.hashes) {
    if (typeof x !== 'string') continue;
    const h = x.trim().toLowerCase();
    if (!HASH_RE.test(h) || hashes.includes(h)) continue;
    hashes.push(h);
  }
  return { v: 1, updatedAt: o.updatedAt, ids, hashes, sig: o.sig };
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** 验签。任何异常都算「不过」，不能把「验不了」当成「验过了」 */
export async function verifyRevoked(doc: RevokedDoc): Promise<boolean> {
  try {
    const bytes = new TextEncoder().encode(revokedSignText(doc));
    return await verifySignedBytes(bytes, b64urlToBytes(doc.sig));
  } catch {
    return false;
  }
}

/** 码原文的 sha256 前 16 位：老码没有码号，只能按摘要封 */
export async function codeHash(code: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.trim()));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, HASH_LEN);
}

/**
 * 这枚码在不在名单里。
 *
 * 新码按码号比（大小写不敏感）；BZR1 老码没有 id，退回摘要。
 * 名单里两条都没写时直接 false，连摘要都不用算。
 */
export async function revokedHit(code: string, doc: RevokedDoc): Promise<boolean> {
  const payload = parseLicense(code)?.payload;
  const id = typeof payload?.id === 'string' ? payload.id.trim().toUpperCase() : '';
  if (id) return doc.ids.includes(id);
  if (doc.hashes.length === 0) return false;
  return doc.hashes.includes(await codeHash(code));
}

/* ── 拉取 ─────────────────────────────────────────────────── */

/** `?t=` 破缓存：两个域名各自会缓存一份，旧名单会把已封的码救活 */
function bust(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
}

async function requestText(url: string, timeoutMs: number): Promise<string | null> {
  let timer: number | null = null;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => resolve(null), timeoutMs);
    });
    const req = requestUrl({ url, method: 'GET', throw: false }).then((resp) => {
      if (!resp || resp.status < 200 || resp.status >= 300) return null;
      /* 顺手校时：停用名单是激活时必经的联网请求，响应头的 Date 是
         不受本地系统时钟影响的真实时间。拿它把高水位顶正，
         「激活前先把时间调早」就绕不过去了。拿不到也不影响名单判定。 */
      noteServerDateHeader(resp.headers);
      return resp.text;
    });
    return await Promise.race([req, timeout]);
  } catch {
    return null;
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

let http: RevokedHttp = requestText;

/**
 * 两源并发，谁先回一份**合法**名单就用谁（2026-11-23 加速）。
 *
 * 作者保证两个 CDN 的名单内容一致，所以不再等齐、也不比新旧——先回且
 * 验签通过的那份立刻生效，用户不必等慢的那个站。
 *
 * 「合法」仍卡两道，和速度无关，不能省：
 *   · 验签不过 → 当没拉到，继续等另一份（防代理 / 公共 WiFi 塞假名单）；
 *   · `updatedAt` 比本地见过的还旧 → 当没拉到（防旧名单把已封的码救活）。
 * 两份都不合法才返回 null（→ unknown，放行）。
 */
async function pull(timeoutMs: number): Promise<RevokedDoc | null> {
  const seen = revokedSeenAt();

  return await new Promise<RevokedDoc | null>((resolve) => {
    let settled = false;
    let left = revokedOrder().length;

    const finish = (doc: RevokedDoc | null): void => {
      if (settled) return;
      settled = true;
      resolve(doc);
    };
    /* 这一份不合法：等另一份；两份都用不上才 unknown */
    const drop = (): void => {
      left -= 1;
      if (left <= 0) finish(null);
    };

    for (const url of revokedOrder()) {
      void http(bust(url), timeoutMs)
        .then(async (text) => {
          if (settled) return;
          if (text == null) return drop();
          const doc = parseRevoked(text);
          if (!doc) return drop();
          /* 只有在「本地已经记着某枚码被停用」时才拒绝更旧的名单（防旧名单
             把已封的码救活）。作者回滚 / 重建名单时 updatedAt 会变小，本地没
             命中还照旧拒收的话，首次激活会永久卡在「需要联网」。 */
          if (doc.updatedAt < seen && revokedCode()) return drop();
          if (!(await verifyRevoked(doc))) return drop();
          finish(doc);
        })
        .catch(() => {
          if (!settled) drop();
        });
    }
  });
}

/* ── 对外 ─────────────────────────────────────────────────── */

/**
 * 拉一次名单并判定这枚码。**激活入口用它，不节流**。
 *
 * unknown 的语义是「这次没结论」，不是「这枚码有问题」：网络挂了、两个源
 * 都没回、验签不过、拿到的比本地见过的还旧——全都归这里。调用方按「必须
 * 联网」处理，但不要在界面上说「码无效」。
 */
export async function checkRevoked(
  code: string,
  timeoutMs = REVOKED_ACTIVATE_TIMEOUT_MS,
): Promise<RevokedVerdict> {
  const clean = code.trim();
  if (!clean) return 'unknown';

  const doc = await pull(timeoutMs);
  if (!doc) return 'unknown';

  const seen = revokedSeenAt();
  /* 旧名单：拿一份几天前的合法名单回来就能让已封的码复活，直接丢掉。
     本地没命中时没这层风险，照收——否则作者一回滚名单就永久卡死。 */
  if (doc.updatedAt < seen && revokedCode()) return 'unknown';

  /* 拉到可用的名单 = 这次核对成功：版本号与「上次核对时间」一起更新。
     24 小时节流只看 checkedAt，所以失败（网络/验签/旧名单）不会把下一次
     自动核对推迟一天。 */
  const next: State = {
    code: st().code,
    at: Math.max(seen, doc.updatedAt),
    checkedAt: Date.now(),
  };
  cached = next;
  writeState(next);

  if (await revokedHit(clean, doc)) {
    markRevoked(clean, doc.updatedAt);
    return 'hit';
  }
  /* 名单里已经没有它了（作者解封）：本地标记要跟着清，否则解封也回不来 */
  if (revokedCode() === clean) clearRevoked();
  return 'clear';
}

/**
 * 自动核对（启动时调一次）。**24 小时内不重复**：成功拉到过名单就把
 * checkedAt 写下来，插件反复加载、切库、重载都不会再打 CDN。
 *
 * `force` 给设置页那枚「核对」按钮用：用户主动要最新结果，跳过 24 小时。
 * 返回值里的 `skipped` = 这 24 小时内已经查过，不是失败。
 */
export async function refreshRevoked(
  code: string,
  opts: { force?: boolean } = {},
): Promise<RevokedVerdict> {
  if (inflight) return inflight;
  const clean = code.trim();
  if (!clean) return 'unknown';

  const now = Date.now();
  /* 已命中时缩短到 10 分钟：作者解封后用户不必等满 24 小时（重启即恢复） */
  const gap = revokedCode() ? Math.min(REVOKED_CHECK_GAP_MS, 10 * 60_000) : REVOKED_CHECK_GAP_MS;
  if (!opts.force && now - revokedCheckedAt() < gap) return 'skipped';

  inflight = (async () => {
    try {
      return await checkRevoked(clean, FETCH_TIMEOUT_MS);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/* ── 测试 ─────────────────────────────────────────────────── */

/** 清空会话状态（**不动** localStorage：持久化用例要用它） */
export function _resetRevokedForTests(): void {
  cached = null;
  inflight = null;
  http = requestText;
}

/** 换掉 HTTP 通道（传 null 恢复生产实现） */
export function _setRevokedHttpForTests(fn: RevokedHttp | null): void {
  http = fn || requestText;
}
