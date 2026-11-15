/* ============================================================
 * PDF 入口与按钮审查的回归测试（tests/pdf-audit.test.ts）
 *
 * 这次全修守的是四件事：认过的页重认先问一句、手机上找得到识别、
 * 失败原因看得见、走不通的按钮别露出来。都是「状态 → 界面」的纯函数，
 * 不碰真实 DOM，直接比字符串。
 * ============================================================ */
import { describe, expect, it } from 'vitest';
import { ocrBarHtml } from '../src/view/ocr-bar';
import { ttsBarHtml } from '../src/view/tts-bar';
import { KEY_COMMANDS } from '../src/shell/render/settings';
import { headerActionsFor } from '../src/view/header-actions';
import { ocrEngineChoices } from '../src/data/settings';
import { ocrRedoNeedsConfirm } from '../src/shell/pdf-ocr';

describe('认过的页重认要先问一句', () => {
  it('只有这一页确实认过才需要确认', () => {
    expect(ocrRedoNeedsConfirm(new Set([3, 5]), 3)).toBe(true);
    expect(ocrRedoNeedsConfirm(new Set([3, 5]), 4)).toBe(false);
    expect(ocrRedoNeedsConfirm(new Set(), 0)).toBe(false);
  });
});

describe('手机上找得到 PDF 识别', () => {
  it('手机头栏把识别排进前三颗', () => {
    expect(headerActionsFor(true, null, true).slice(0, 3)).toContain('ocr');
  });

  it('手机上不列要连电脑的外部 OCR 服务', () => {
    expect(ocrEngineChoices(true)).toEqual(['deepseek']);
    expect(ocrEngineChoices(false)).toEqual(['deepseek', 'http']);
  });
});

describe('识别条把失败原因摆出来', () => {
  it('失败原因不再只塞进 title', () => {
    const html = ocrBarHtml({ stage: { kind: 'page-failed', page: 4 }, why: '连不上服务' });
    expect(html).toContain('bzr-ocrwhy');
    expect(html).toContain('连不上服务');
  });

  it('手动停止但留下失败页时给重试按钮', () => {
    const html = ocrBarHtml({ stage: { kind: 'stopped', pages: 2, failed: [5, 6] } });
    expect(html).toContain('data-act="ocrretry"');
  });
});

describe('PDF 上不露走不通的朗读按钮', () => {
  it('PDF 不画预生成与导出，主按钮还在', () => {
    const html = ttsBarHtml({ paused: false, pdf: true });
    expect(html).not.toContain('data-act="ttsprefetch"');
    expect(html).not.toContain('data-act="ttsexport"');
    expect(html).toContain('data-act="ttstoggle"');
  });

  it('EPUB 照旧两颗都在', () => {
    const html = ttsBarHtml({ paused: false });
    expect(html).toContain('data-act="ttsprefetch"');
    expect(html).toContain('data-act="ttsexport"');
  });
});

describe('快捷键表把 PDF 命令列齐', () => {
  it('五条 OCR 命令与区域存图都在表上', () => {
    const ids = KEY_COMMANDS.map((c) => c.id);
    for (const id of ['pdf-ocr-page', 'pdf-ocr-batch', 'pdf-ocr-stop', 'pdf-ocr-clear', 'pdf-region-card']) {
      expect(ids).toContain(`bz-reader:${id}`);
    }
  });
});
