/* ============================================================
 * bz-reader · 模型选择弹窗（ui/model-picker.ts）
 *
 * AI 组「获取模型」拉回一串模型名之后，用它弹出来让用户点一行。
 * 复用 core/ui/modal 的居中模态（遮罩 / ESC / 焦点还原都由它兜住），
 * 这里只负责：当前值置顶、一行一个名字、点中即回填并关闭。
 *
 * 为什么不做成下拉：模型名有的很长（`deepseek-v4.1-flash-2026-09`），
 * 手机上原生下拉会截断；一屏能滚的列表 + 当前值高亮更好认。
 * 同插件恒只有一个：连点两次「获取模型」不该叠两层遮罩。
 * ============================================================ */
import { uiModal } from '../core/ui/modal';

export interface ModelPickerOptions {
  /** 弹窗标题（「选择模型」） */
  title: string;
  /** 当前生效的模型名（置顶 + 高亮；留空则不高亮） */
  current: string;
  /** 当前模型说明行的前缀（「当前模型」） */
  currentLabel: string;
  /** 模型列表（已去重） */
  models: string[];
  /** 选中回调（点中即关闭弹窗，再回填） */
  onPick: (model: string) => void;
}

let live: { close: () => void } | null = null;

/** 关闭当前选择器（没有就什么也不做） */
export function closeModelPicker(): void {
  const m = live;
  live = null;
  m?.close();
}

/** 打开模型选择器（幂等：已开先关） */
export function openModelPicker(opts: ModelPickerOptions): void {
  closeModelPicker();

  const body = document.createElement('div');
  body.className = 'bzr-model-picker';

  const cur = document.createElement('div');
  cur.className = 'bzr-model-picker-cur';
  cur.textContent = `${opts.currentLabel}：${opts.current || '—'}`;
  body.appendChild(cur);

  /* 当前值置顶：列表一长，用户最想先看到的就是「我现在用的是哪个」 */
  const ordered = [...opts.models].sort((a, b) => Number(b === opts.current) - Number(a === opts.current));
  const list = document.createElement('div');
  list.className = 'bzr-model-picker-list';
  for (const id of ordered) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'bzr-btn bzr-model-picker-row' + (id === opts.current ? ' is-current' : '');
    row.textContent = id;
    row.title = id;
    row.addEventListener('click', () => {
      opts.onPick(id);
      closeModelPicker();
    });
    list.appendChild(row);
  }
  body.appendChild(list);

  const modal = uiModal({
    content: body,
    head: true,
    title: opts.title,
    maxWidth: 420,
    onClose: () => {
      if (live === modal) live = null;
    },
  });
  live = modal;
}
