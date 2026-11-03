/* ============================================================
 * bz-reader · 朗读（core/speak.ts）
 *
 * 抽成独立模块只有一个目的：**基础版的包里不能出现朗读代码**。
 * 之前 speechSynthesis 直接写在阅读视图里，base 与 pro 是同一份 bundle，
 * 「基础版不含高级功能」就只剩一句运行时 if，包里照样能翻出 speechSynthesis。
 *
 * esbuild 在 base 构建时把这个文件换成空实现（见 esbuild.config.mjs 的
 * stubProModules），所以调用方拿到的 null 就是「这个包没有朗读」，
 * 不需要再判构建档位。
 *
 * 能力门槛（can('tts')）在调用方判，这里只管念。
 * ============================================================ */

export interface SpeakHandle {
  stop(): void;
}

/**
 * 念一段文字。环境不支持朗读时返回 null（调用方据此提示）。
 * 超过 4000 字截断：系统语音合成喂太长会卡住，也不是朗读该干的事。
 */
export function speak(text: string, onDone: () => void): SpeakHandle | null {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return null;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text.slice(0, 4000));
  u.lang = 'zh-CN';
  u.rate = 1;
  u.onend = onDone;
  u.onerror = onDone;
  synth.speak(u);
  return {
    stop(): void {
      try {
        synth.cancel();
      } catch {
        /* 系统语音不可用时不该把翻页一起带崩 */
      }
      onDone();
    },
  };
}

export function stopSpeaking(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* 同上 */
  }
}
