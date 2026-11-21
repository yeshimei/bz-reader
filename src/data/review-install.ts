/* ============================================================
 * bz-reader · bz review 一键安装（data/review-install.ts）
 *
 * 2026-11-21 起「下载安装」不再跳浏览器：点一下就在后台把三件套写到
 * `<配置目录>/plugins/bz-review/` 并让宿主启用。用户不用自己找下载页、
 * 解压、建目录、重启。
 *
 * 三条边界：
 *   1. 先下载齐、校验过 manfiest，再写盘——绝不把半套文件留在插件目录；
 *   2. GitHub 连不上自动切码云（码云的 latest 要先查一次 release JSON）；
 *   3. 写盘 / 启用失败都返回错误码，由壳层翻成人话，不在数据层弹通知。
 * ============================================================ */
import { requestUrl, type App } from 'obsidian';
import { REVIEW_PLUGIN_ID } from './review-bridge';

/** 三件套的下载地址 */
export interface ReviewReleaseAssets {
  main: string;
  manifest: string;
  styles: string;
}

/** 下载并校验过的三件套 */
export interface ReviewReleaseFiles {
  manifest: string;
  main: ArrayBuffer;
  styles: string;
}

export type ReviewInstallError = 'network' | 'write' | 'enable';
export type ReviewInstallResult = { ok: true } | { ok: false; error: ReviewInstallError };

const REVIEW_GITHUB_BASE = 'https://github.com/yeshimei/bz-review/releases/latest/download';
const REVIEW_GITEE_API = 'https://gitee.com/api/v5/repos/ntbl/bz-review/releases/latest';

/** GitHub 的 latest 直链：版本随 Release 自动跟进 */
export function reviewGithubAssets(): ReviewReleaseAssets {
  return {
    main: `${REVIEW_GITHUB_BASE}/main.js`,
    manifest: `${REVIEW_GITHUB_BASE}/manifest.json`,
    styles: `${REVIEW_GITHUB_BASE}/styles.css`,
  };
}

/**
 * 从码云的 release JSON 里挑三件套。
 *
 * 码云没有 `latest/download` 这种固定路径，得先拿到当前 tag 再拼；
 * 这里只认 assets 列表里的真实下载地址，缺一件就整批不装。
 */
export function reviewGiteeAssets(json: unknown): ReviewReleaseAssets | null {
  const assets = (json as { assets?: unknown } | null)?.assets;
  if (!Array.isArray(assets)) return null;
  const pick = (name: string): string => {
    const hit = (assets as Array<{ name?: unknown; browser_download_url?: unknown }>).find((a) => a?.name === name);
    return typeof hit?.browser_download_url === 'string' ? hit.browser_download_url : '';
  };
  const main = pick('main.js');
  const manifest = pick('manifest.json');
  const styles = pick('styles.css');
  return main && manifest && styles ? { main, manifest, styles } : null;
}

/** 下载回来的清单是不是 bz review 的：不是就停，别把别的插件装进来 */
export function isReviewManifest(text: string): boolean {
  try {
    const m = JSON.parse(text) as { id?: unknown; version?: unknown };
    return m?.id === REVIEW_PLUGIN_ID && typeof m.version === 'string' && m.version.trim().length > 0;
  } catch {
    return false;
  }
}

/* ─────────── 下载 ─────────── */

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await requestUrl({ url, throw: false });
    return res.status >= 200 && res.status < 300 ? res.text : null;
  } catch {
    return null;
  }
}

async function fetchBinary(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await requestUrl({ url, throw: false });
    return res.status >= 200 && res.status < 300 ? res.arrayBuffer : null;
  } catch {
    return null;
  }
}

async function fetchFrom(assets: ReviewReleaseAssets): Promise<ReviewReleaseFiles | null> {
  const manifest = await fetchText(assets.manifest);
  /* 清单先过校验：主文件都有几 MB，清单不对就不必再下一遍 */
  if (!manifest || !isReviewManifest(manifest)) return null;
  const [main, styles] = await Promise.all([fetchBinary(assets.main), fetchText(assets.styles)]);
  if (!main || !styles) return null;
  return { manifest, main, styles };
}

/**
 * 取三件套：GitHub 优先，失败切码云。
 *
 * 不做「先探测再下载」：探测本身也是一次请求，直接下清单更快，
 * 清单拿不到就换源。两条都不通才算失败。
 */
export async function fetchReviewRelease(): Promise<ReviewReleaseFiles | null> {
  const gh = await fetchFrom(reviewGithubAssets());
  if (gh) return gh;
  const release = await fetchText(REVIEW_GITEE_API);
  if (!release) return null;
  let json: unknown;
  try {
    json = JSON.parse(release);
  } catch {
    return null;
  }
  const assets = reviewGiteeAssets(json);
  return assets ? fetchFrom(assets) : null;
}

/* ─────────── 写盘与启用 ─────────── */

interface HostPlugins {
  loadManifests?: () => Promise<void>;
  loadManifest?: (id: string) => unknown;
  enablePluginAndSave?: (id: string) => Promise<void>;
  enablePlugin?: (id: string) => Promise<void>;
}

function hostPlugins(app: App): HostPlugins | undefined {
  return (app as unknown as { plugins?: HostPlugins })?.plugins;
}

/** 写三个文件到插件目录（先确保目录存在，已存在就直接覆盖） */
async function writeFiles(app: App, files: ReviewReleaseFiles): Promise<boolean> {
  const adapter = app.vault.adapter;
  const pluginsDir = `${app.vault.configDir}/plugins`;
  const dir = `${pluginsDir}/${REVIEW_PLUGIN_ID}`;
  try {
    if (!(await adapter.exists(pluginsDir))) await adapter.mkdir(pluginsDir);
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    await adapter.writeBinary(`${dir}/main.js`, files.main);
    await adapter.write(`${dir}/manifest.json`, files.manifest);
    await adapter.write(`${dir}/styles.css`, files.styles);
    return true;
  } catch {
    return false;
  }
}

/**
 * 让宿主认识并启用刚写进去的插件（设置页「启用」按钮也走它）。
 *
 * 顺序不能反：loadManifests 把新目录扫进 manifest 表，enablePluginAndSave
 * 才找得到它；后者同时把 id 写进 community-plugins.json，重启后仍启用。
 * 老版本没有 loadManifests 时退回 loadManifest（单条）。
 *
 * 失败重试一次：真机（2026-11-21）第一次点「安装」时文件已落盘，启用却
 * 失败了，手动再点一次就好——宿主对「刚出现的插件目录」的扫描有时晚一拍。
 * 停半秒重扫再试，第二次仍失败才算真失败。
 */
export async function enableInstalledReview(app: App): Promise<boolean> {
  const plugins = hostPlugins(app);
  if (!plugins) return false;
  const run = async (): Promise<boolean> => {
    if (plugins.loadManifests) await plugins.loadManifests();
    else if (plugins.loadManifest) plugins.loadManifest(REVIEW_PLUGIN_ID);
    if (plugins.enablePluginAndSave) await plugins.enablePluginAndSave(REVIEW_PLUGIN_ID);
    else if (plugins.enablePlugin) await plugins.enablePlugin(REVIEW_PLUGIN_ID);
    else return false;
    return true;
  };
  try {
    return await run();
  } catch {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
    try {
      return await run();
    } catch {
      return false;
    }
  }
}

/**
 * 一键安装并启用。
 *
 * 全部在内存里先备齐：下载失败、清单不对都停在写盘之前；写盘失败也不会
 * 只留 main.js 留在目录里冒充「装好了」。
 */
export async function installReview(app: App): Promise<ReviewInstallResult> {
  const files = await fetchReviewRelease();
  if (!files) return { ok: false, error: 'network' };
  if (!(await writeFiles(app, files))) return { ok: false, error: 'write' };
  if (!(await enableInstalledReview(app))) return { ok: false, error: 'enable' };
  return { ok: true };
}
