/**
 * 阅读页头栏「谁该露」的规则：纯判定 + 显隐计划，不碰布局、不碰事件。
 *
 * 为什么单独抽出来：这段以前写在视图里，靠「最右那颗就是 ⋮」猜位置。
 * 真机（iPhone）反馈过一次：别的插件往头栏塞了几颗图标（home / layout-grid），
 * 只要有一颗排在 ⋮ 后面，真 ⋮ 就被当成「别人的」藏掉、别人那颗被当成 ⋮ 留下；
 * 再叠上 styles.css 里那条 `:last-child { display: grid !important }`，
 * inline 的 display:none 压不过 !important，最右那颗谁也藏不掉。
 * 结果就是用户在截图里看到的：三个动作露出来了，别人的图标还在，⋮ 没了。
 *
 * 现在按**身份**分类，不按位置猜：
 *   ours  —— 我们自己挂的（.bzr-action），最多露 maxOurs 颗；
 *   more  —— 宿主的 ⋮（认图标，不认位置），永远露；
 *   other —— 别人的图标，一律收起来。
 */

export type HeaderRole = 'ours' | 'more' | 'other';

/**
 * 判定只需要这几个方法，所以参数用最小接口而不是 HTMLElement —
 * 项目没装 jsdom，node 里用假对象就能把这套规则测全。
 */
export interface HeaderElLike {
  classList: { contains(name: string): boolean };
  getAttribute(name: string): string | null;
  querySelector(selector: string): { classList: { contains(name: string): boolean } } | null;
}

/**
 * 宿主 ⋮ 的图标名。Obsidian 用 lucide，`setIcon` 出来的 svg 带
 * `lucide-<名>` 类，与界面语言无关——这是比 aria-label 更稳的判据。
 * 竖排 / 横排、新旧两套命名（more-* 与 ellipsis-*）都认。
 */
const MORE_ICON_CLASSES = [
  'lucide-more-vertical',
  'lucide-more-horizontal',
  'lucide-ellipsis-vertical',
  'lucide-ellipsis',
];

/**
 * 图标名认不出来时的第二判据。宿主 ⋮ 的 aria-label 是本地化文案，
 * 这里只列拉丁语系那几种：中/日的写法含汉字，会被「界面文案不许硬编码中文」
 * 那条门禁拦住，而这些串只是匹配宿主的文案、不是我们显示的文本，
 * 不值得为它开豁免。中文界面交给上面的图标判据与 trimHeaderActions 的兜底。
 */
const MORE_LABELS = [
  'more options',
  'weitere optionen',
  'plus d’options',
  "plus d'options",
  'más opciones',
  'mais opções',
];

/** 这是不是宿主的 ⋮（反过来：绝不是「最右那颗」） */
export function isMoreButton(el: HeaderElLike): boolean {
  if (el.classList.contains('bzr-more')) return true;
  const svg = el.querySelector('svg');
  if (svg && MORE_ICON_CLASSES.some((c) => svg.classList.contains(c))) return true;
  const label = (el.getAttribute('aria-label') ?? '').trim().toLowerCase();
  return !!label && MORE_LABELS.includes(label);
}

/** 一颗头栏图标的身份 */
export function roleOf(el: HeaderElLike): HeaderRole {
  if (el.classList.contains('bzr-action')) return 'ours';
  if (isMoreButton(el)) return 'more';
  return 'other';
}

/**
 * 按身份排出「每颗露不露」。
 *
 * 名额只从 ours 里扣：⋮ 不占名额（它是唯一入口），other 全部收起来。
 * 以前是先扣别人的、不够就裁自己的——别人藏不掉时，自己的三颗反倒被裁光，
 * 屏幕上只剩别人的图标。这个方向反了。
 *
 * @param hideOthers 不可判定时传 false：认不出哪颗是 ⋮ 就不要动别人的图标。
 *   宁可别人的多留两颗，也不能把 ⋮ 藏掉（阅读的全部分组动作都在它里面）。
 */
export function planHeaderVisibility(
  roles: HeaderRole[],
  maxOurs: number,
  hideOthers = true,
): boolean[] {
  let shown = 0;
  return roles.map((role) => {
    if (role === 'more') return true;
    if (role === 'other') return !hideOthers;
    shown += 1;
    return shown <= maxOurs;
  });
}
