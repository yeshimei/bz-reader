import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { speak } from '../src/core/speak';

const g = globalThis as unknown as Record<string, unknown>;

let synth: { cancel: ReturnType<typeof vi.fn>; speak: ReturnType<typeof vi.fn> };
let spoken: string[];

beforeEach(() => {
  vi.useFakeTimers();
  spoken = [];
  synth = {
    cancel: vi.fn(),
    speak: vi.fn((u: { text: string }) => spoken.push(u.text)),
  };
  g.window = { speechSynthesis: synth, setTimeout };
  g.SpeechSynthesisUtterance = class {
    text: string;
    lang = '';
    rate = 1;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  };
});

afterEach(() => {
  vi.useRealTimers();
  delete g.window;
  delete g.SpeechSynthesisUtterance;
});

describe('朗读首句延后（A-31）', () => {
  it('synth.cancel() 之后首句进下一个宏任务，别让 iOS/WKWebView 吞掉', () => {
    speak('第一句。');

    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(spoken).toEqual(['第一句。']);
  });

  it('还没轮到首句就 stop()：一句都不念', () => {
    const handle = speak('第一句。第二句。');
    handle?.stop();

    vi.runAllTimers();

    expect(synth.speak).not.toHaveBeenCalled();
  });
});
