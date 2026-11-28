/* ============================================================
 * 可信时间（src/data/trusted-clock.ts）
 *
 * 离线授权最便宜的一道防线：**时间只增不减**。
 * 判断激活码到期时不能用系统时间直接比——用户把系统时钟往回拨，
 * 到期日就永远「还没到」。这里记住每次见过的最晚时刻（高水位），
 * 到期判定用「高水位与当前时间的较大者」，往回拨时间不起作用。
 *
 * 三层来源，取最可信的那个：
 *   1. `seenAt`  本地高水位：每次启动 / 到期判定时把当前时间顶上去，只增不减；
 *   2. `serverAt` 服务器时间：停用名单、更新检查的响应头里有 Date，拿到就
 *      把高水位顶到真实时刻——这样「激活前先把时间调早」也躲不过；
 *   3. localStorage + data.json（entitlement.lastSeenTs）双写：删掉一处还有另一处。
 *
 * 边界（不假装能补）：用户同时清掉两处存储、断网、再重装，本地就回到
 * 没有历史的状态；但重新激活本来要求联网，联网那一步会拿服务器时间校准。
 * 真正要绝对防，只能做在线激活，那是另一个成本量级。
 *
 * 与 bz Review 的 data/trusted-clock 同构，键名与文案各自独立。
 * ============================================================ */

/** 本地存储键。带版本号：将来换结构时老状态自动作废 */
export const CLOCK_STORAGE_KEY = 'bz-reader:clock:v1';

/**
 * 容差：系统时间小幅回拨不算异常。
 * NTP 校时、时区切换、虚拟机恢复快照通常都在几分钟内；30 分钟足够宽，
 * 又远小于「把时间拨回去年」这种绕过。
 */
export const CLOCK_TOLERANCE_MS = 30 * 60 * 1000;

export interface ClockState {
  /** 见过的最大可信时间（毫秒）。只增不减 */
  seenAt: number;
  /** 最近一次拿到的服务器时间（毫秒） */
  serverAt: number;
  /** 拿到服务器时间那一刻的本地时间（毫秒），用来判断本地时钟漂移 */
  serverLocalAt: number;
  /** 最近一次判定「本地时间明显落后」的时刻（0 = 没判过） */
  suspectAt: number;
}

export const EMPTY_CLOCK: ClockState = { seenAt: 0, serverAt: 0, serverLocalAt: 0, suspectAt: 0 };

/** 只需要这三个方法的窄接口，便于测试用内存 mock，也便于 WebView 里退化成 null */
export interface ClockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let storage: ClockStorage | null = null;
let cache: ClockState = { ...EMPTY_CLOCK };
let loaded = false;
/** 上次落盘的时刻：trustedNow 每次重绘都会调，不能每次都写 localStorage */
let lastPersistAt = 0;

/** 进程内落盘节流：高水位前进不足一分钟时不重复写 */
const PERSIST_GAP_MS = 60 * 1000;

/**
 * 实际用的存储：测试注入的优先，否则取宿主 WebView 的 localStorage。
 * 拿不到就退化成「只在内存里记」——本次会话仍能挡住回拨，只是重启后失效；
 * 隐私模式下本来就没有更稳的落点，不该因此让授权判定抛错。
 */
function activeStorage(): ClockStorage | null {
  if (storage) return storage;
  try {
    const ls = (globalThis as { localStorage?: ClockStorage }).localStorage;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch {
    return null;
  }
}

function ms(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

function load(): ClockState {
  if (loaded) return cache;
  loaded = true;
  const state: ClockState = { ...EMPTY_CLOCK };
  try {
    const raw = activeStorage()?.getItem(CLOCK_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ClockState> | null;
      if (p && typeof p === 'object') {
        state.seenAt = ms(p.seenAt);
        state.serverAt = ms(p.serverAt);
        state.serverLocalAt = ms(p.serverLocalAt);
        state.suspectAt = ms(p.suspectAt);
      }
    }
  } catch {
    /* 坏 JSON 当没记录：宁可少一层防护，也不能让授权判定抛错 */
  }
  cache = state;
  return cache;
}

function save(): void {
  try {
    activeStorage()?.setItem(CLOCK_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* 隐私模式 / 移动端 WebView 可能禁 localStorage：存不下不影响本次会话 */
  }
}

/** 换存储后端（也用来在测试里隔离）；传 null 退回只读内存 */
export function setClockStorage(s: ClockStorage | null): void {
  storage = s;
  cache = { ...EMPTY_CLOCK };
  loaded = false;
  lastPersistAt = 0;
}

export function _resetClockForTests(): void {
  cache = { ...EMPTY_CLOCK };
  loaded = true;
  lastPersistAt = 0;
  try {
    activeStorage()?.removeItem(CLOCK_STORAGE_KEY);
  } catch {
    /* 测试清理失败不影响断言 */
  }
}

/**
 * 从 entitlement 记录的 `lastSeenTs` 灌入高水位（load 时调）。
 * 只增：data.json 可能是一年前备份恢复的旧值，不能把 localStorage 里
 * 更晚的记录拉回去。
 */
export function seedClock(seenAt: number): void {
  const v = ms(seenAt);
  if (!v) return;
  const s = load();
  if (v > s.seenAt) {
    s.seenAt = v;
    save();
  }
}

/** 记一次「此刻我在」：启动与活跃日记录时调，把高水位顶到当前时间 */
export function noteSeen(now: number): void {
  const v = ms(now);
  if (!v) return;
  const s = load();
  if (v > s.seenAt) {
    s.seenAt = v;
    save();
    lastPersistAt = Date.now();
  }
}

/**
 * 判断到期时该用的「现在」。
 *
 * 系统时间正常时就是当前时间；被往回拨过就是高水位。只增不减——
 * 不能因为用户把时间调回来就把高水位降下去，否则「调快再调回」就能洗掉记录。
 */
export function trustedNow(localNow = Date.now()): number {
  const now = ms(localNow) || Date.now();
  const s = load();
  if (now > s.seenAt) {
    s.seenAt = now;
    /* 节流：正常使用时每分钟最多写一次，别在重绘里反复落盘 */
    if (now - lastPersistAt >= PERSIST_GAP_MS) {
      save();
      lastPersistAt = now;
    }
  }
  return Math.max(now, s.seenAt);
}

/**
 * 记一次服务器时间（响应头的 Date）。
 *
 * 服务器是权威锚点：**只把高水位往上顶**，不往下拉。往下拉等于给
 * 「伪造一个过去的 Date 头」开口子——过期码会被「校准」回有效。
 * 用户误把时间调到未来、想恢复，只能重新激活一次（那是显式操作，
 * 激活本身要求联网且验签通过，不构成绕过）。
 */
export function noteServerTime(serverNow: number, localNow: number): void {
  const real = ms(serverNow);
  if (!real) return;
  const local = ms(localNow) || Date.now();
  const s = load();
  s.serverAt = real;
  s.serverLocalAt = local;
  /* 本地时间明显落后于服务器：记一笔「系统时间被调过」。
     本地时间比服务器快不记——那种情况只会让码提前过期，是自伤。 */
  if (real - local > CLOCK_TOLERANCE_MS) s.suspectAt = local;
  if (real > s.seenAt) s.seenAt = real;
  save();
  lastPersistAt = Date.now();
}

/**
 * 从 HTTP 响应头里取服务器时间。
 *
 * Obsidian 的 requestUrl 返回 `headers: Record<string, string>`，不同平台
 * 大小写不一致（Node 是小写、Capacitor 可能保留原样），所以遍历键名。
 * 拿不到 / 不是合法日期时什么都不做，绝不让一次失败拖垮授权判定。
 */
export function noteServerDateHeader(headers: unknown, localNow = Date.now()): void {
  if (!headers || typeof headers !== 'object') return;
  let raw = '';
  for (const key of Object.keys(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== 'date') continue;
    const v = (headers as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim()) raw = v.trim();
  }
  if (!raw) return;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed) && parsed > 0) noteServerTime(parsed, localNow);
}

/**
 * 本地时间是否明显落后于「见过的最晚时刻」。
 *
 * 只用于界面提示与排查（「系统时间似乎被调过」），**不参与门控**——
 * 门控永远用 trustedNow()，这样即使不显示提示，绕过也已经失效。
 */
export function clockSuspect(localNow = Date.now()): boolean {
  const s = load();
  if (!s.seenAt) return false;
  return localNow + CLOCK_TOLERANCE_MS < s.seenAt;
}

/** 当前高水位（毫秒，0 = 从没记过）。给 entitlement.lastSeenTs 双写用 */
export function clockSeenAt(): number {
  return load().seenAt;
}

/** 当前完整状态（测试与排查用，只读副本） */
export function clockState(): ClockState {
  return { ...load() };
}
