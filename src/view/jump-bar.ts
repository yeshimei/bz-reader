/* ============================================================
 * bz-reader · 跳到百分比（view/jump-bar.ts）
 *
 * EPUB / MOBI / AZW3 / FB2 / TXT 这些重排格式没有可靠的页码：第几页随字号、
 * 窗口宽度变，拿纸质书的页码对不上。所以只给百分比——0 到 100，一步到书首、
 * 书末或任何中间位置。
 *
 * PDF 与漫画不走这里：它们本身就是固定版式，右下角已有可拖的页码浮条，
 * 再给一个百分比入口就是两套说法。
 *
 * 入口有两处：点右下角页码（桌面在宿主状态栏那一段），以及 ⋮ 菜单——手机上
 * 页码小字默认不显示，菜单是唯一稳定的入口。
 * ============================================================ */
import { el } from '../ui/dom';
import { t } from '../i18n';
import { parseJumpInput, percentText } from './jump-input';

export interface JumpBarDeps {
  /** 挂载容器：阅读器根节点（绝对定位的浮层贴它右下 / 底部） */
  host: HTMLElement;
  /** 当前进度 0..1，输入框的初值 */
  percent: number;
  onJump: (fraction: number) => void;
}

let open: { close: () => void } | null = null;

/** 关掉当前浮层（重复打开 / 卸载 / 切书时调） */
export function closeJumpBar(): void {
  open?.close();
  open = null;
}

export function openJumpBar(deps: JumpBarDeps): void {
  closeJumpBar();

  const root = el('div', 'bzs-jump');
  root.setAttribute('role', 'dialog');
  root.dataset.bzrJump = '1';

  const label = el('span', 'bzs-jump-t', t('jump.title'));
  label.id = 'bzs-jump-label';

  const input = el('input', 'bzs-jump-in');
  input.type = 'text';
  input.setAttribute('inputmode', 'decimal');
  input.setAttribute('aria-labelledby', label.id);
  input.value = percentText(deps.percent);

  const unit = el('span', 'bzs-jump-unit', '%');
  const go = el('button', 'bzs-btn pri', t('jump.go'));
  go.type = 'button';
  const shut = el('button', 'bzs-jump-x', '×');
  shut.type = 'button';
  shut.appendChild(el('span', 'bzs-sr-only', t('common.close')));

  root.append(label, input, unit, go, shut);
  deps.host.appendChild(root);

  const onOutside = (ev: PointerEvent): void => {
    const t = ev.target;
    if (t instanceof Node && root.contains(t)) return;
    close();
  };

  const close = (): void => {
    window.removeEventListener('pointerdown', onOutside, true);
    root.remove();
    if (open && open.close === close) open = null;
  };
  open = { close };

  const submit = (): void => {
    const f = parseJumpInput(input.value);
    if (f === null) {
      root.addClass('is-bad');
      input.focus();
      input.select();
      return;
    }
    close();
    deps.onJump(f);
  };

  input.addEventListener('input', () => root.removeClass('is-bad'));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    /* 不让方向键、空格冒到阅读器：这两下在阅读页上会翻页 */
    e.stopPropagation();
  });
  go.addEventListener('click', submit);
  shut.addEventListener('click', close);
  window.addEventListener('pointerdown', onOutside, true);

  window.setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}
