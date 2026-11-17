/**
 * 浮框里流式补字（2026-11-16）。
 *
 * 侧栏那条是「节流改一行 DOM」，浮框这里同理，但有一个它没有的坑：
 * 消息区是整块 `innerHTML` 换的（见 `refreshAiFloat`），而换完会调
 * `renderAiMarkdown`，那一步是**异步**的（`MarkdownRenderer.render().then(...)`）。
 * 半截答案刚被渲染成 HTML，下一片字又把它覆盖成纯文本，显示就会来回跳。
 *
 * 所以流式期间这一行**不挂 `data-ai-md`**：气泡就是纯文本节点，只改
 * `textContent`；收尾时 `refreshAiFloat` 重画一次，Markdown 与来源都由
 * 那一次统一渲染。第一片字到时把等待气泡（三个点）就地换成文字气泡，
 * 不整块重画——重画会把用户正在看的上一轮往上顶。
 *
 * 账本由调用方写（首答进 `entry.text`，追问进最后一轮），这里只管
 * 「什么时候画、画到哪」。画之前每帧重新查 DOM：流式期间用户点图钉 /
 * 点卡片别处都会重画，缓存的节点会脱离文档。
 */

/** 两帧之间的最短间隔：一秒几十次改 DOM 会卡，80ms 肉眼已是连贯的 */
const PAINT_MS = 80;

export interface AiStream {
  /** 交给 `aiAsk` 的 `onDelta` */
  onDelta: (piece: string) => void;
  /** 收尾：清掉还没落地的节流（重绘由调用方负责） */
  stop: () => void;
  /**
   * 到现在为止收到的全文。失败时调用方据此判断「有没有流出半截」：
   * 有就接上原因保留，没有才换成一句报错。
   */
  text: () => string;
}

/**
 * @param append 把这一片写进账本，返回现在完整的文本。返回 `null` 表示
 *   这条卡已经不存在了（换档 / 关卡把它清了）——此时停止绘制，别往一个
 *   已经被丢弃的对话里继续写字。
 */
export function startAiStream(
  append: (piece: string) => string | null,
  /** 找气泡的范围。默认 `document`；测试注入一个假容器（真 DOM 在 node 里没有） */
  root: ParentNode = document,
): AiStream {
  let opened = false;
  let timer = 0;
  let text = '';
  let gone = false;

  const lastTx = (): HTMLElement | null => {
    const box = root.querySelector<HTMLElement>('[data-role="aimsgs"]');
    if (!box) return null;
    const list = box.querySelectorAll<HTMLElement>('.bzs-pm.is-ai .tx');
    return list[list.length - 1] ?? null;
  };

  const paint = (): void => {
    timer = 0;
    const el = lastTx();
    if (!el) return;
    /* 重画过的气泡带 data-ai-md，收尾那一次要留给 markdown 渲染；
       这里摘掉标记，保证流式期间是纯文本，渲染不会跟补字打架。 */
    el.removeAttribute('data-ai-md');
    delete el.dataset.aiRendered;
    el.textContent = text;
    const box = el.closest<HTMLElement>('[data-role="aimsgs"]');
    if (box) box.scrollTop = box.scrollHeight;
  };

  return {
    onDelta: (piece: string): void => {
      if (gone) return;
      const full = append(piece);
      if (full === null) {
        gone = true;
        if (timer) window.clearTimeout(timer);
        timer = 0;
        return;
      }
      text = full;
      if (!opened) {
        opened = true;
        paint();
        return;
      }
      if (!timer) timer = window.setTimeout(paint, PAINT_MS);
    },
    stop: (): void => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
    },
    text: (): string => text,
  };
}
