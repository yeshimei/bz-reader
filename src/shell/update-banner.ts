/* ============================================================
 * bz-reader · 更新提示条（src/shell/update-banner.ts）
 *
 * 2026-11-26 作者定稿：不再用全屏遮罩弹窗，改成书架头栏下面一条细提示。
 * 三个人手一句就能走完：去市场下载 / 去 GitHub 下载 / 忽略这一版——
 * 前两颗与设置页「插件」组用**同一套文案**（settings.plugin.review.*），
 * 不另起新词，免得同一个动作在两个地方叫两个名字。
 *
 * 为什么不是弹窗（这条别再改回去）：
 *   · 遮罩会把正在翻页 / 整理书架的人按停，更新本来就不该按停用户；
 *   · 老弹窗只有一个出口，用户想更新还得自己摸到设置页找「检查更新」。
 *
 * 出现条件只有一条：线上比本机新，且这一版还没被「忽略」过。
 * 判重记录在 `bz-reader:update-check:v1` 的 notified 里（见 data/plugin-update），
 * 忽略 1.9.0 之后 1.9.1 发布仍会出现——那是另一个新版本。
 *
 * 文案与结构都是纯字符串，便于单测；转义一律走 esc()，版本号来自网络。
 * ============================================================ */
import { t } from '../i18n';
import { esc } from './render/html';
import { getShellSource } from './source';
import { hasUpdate, readUpdateState, shouldNotify, writeUpdateState, type UpdateState } from '../data/plugin-update';

/**
 * 这一版该不该提示。
 *
 * 三件事缺一不可：本机版本非空、线上比本机新、这一版还没记进 notified。
 * 已激活的试用码判定也读同一份缓存，两边不会出现「一个说有新版、一个说没有」。
 */
export function shouldShowUpdateBanner(current: string, state: UpdateState): boolean {
  return hasUpdate(current, state.latest) && shouldNotify(state, state.latest);
}

/** 按当前壳层状态算一次：没有可提示的更新时返回 null */
export function liveUpdateBanner(): { current: string; latest: string } | null {
  const current = String(getShellSource()?.version() || '').trim();
  const state = readUpdateState();
  if (!shouldShowUpdateBanner(current, state)) return null;
  return { current, latest: state.latest.trim() };
}

/**
 * 提示条正文。
 *
 * 只有两句话：线上是几版、现在是几版。不搬更新内容——本地包里只有
 * 已装版本的日志，拿它冒充新版会撒谎（与 2026-11-22 同一条口径）。
 */
export function updateBannerHtml(current: string, latest: string): string {
  return `<div class="bzs-updbar">
      <span class="bzs-updbar-txt"><b>${esc(t('update.banner', { latest }))}</b><span class="bzs-updbar-now">${esc(
        t('update.current', { now: current }),
      )}</span></span>
      <span class="bzs-updbar-acts">
        <button type="button" class="bzs-btn sm pri" data-act="updstore">${esc(
          t('settings.plugin.review.market'),
        )}</button>
        <button type="button" class="bzs-btn sm" data-act="updgithub">${esc(
          t('settings.plugin.review.github'),
        )}</button>
        <button type="button" class="bzs-btn sm bzs-updbar-ignore" data-act="updignore">${esc(
          t('update.ignore'),
        )}</button>
      </span>
    </div>`;
}

/**
 * 「忽略这一版」：把线上版本记进 notified。
 *
 * 只改 notified，checkedAt / latest 原样留着——它们还被试用码判定用着，
 * 顺手清掉会让已激活的试用码在下次联网前变成「需要联网确认」。
 * 从没查到过线上版本时什么都不写，不制造一条空记录。
 */
export function dismissUpdateBanner(): void {
  const state = readUpdateState();
  const latest = state.latest.trim();
  if (!latest) return;
  writeUpdateState({ checkedAt: state.checkedAt, notified: latest, latest });
}
