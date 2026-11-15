import { describe, expect, it } from 'vitest';
import { pdfOcrDeployPrompt } from '../src/core/pdf-ocr-deploy-prompt';

const prompt = pdfOcrDeployPrompt({
  vaultPath: 'E:/Obsidian/bz reader',
  configDir: '.obsidian',
});

describe('扫描页识别 · 自部署提示词', () => {
  it('把「装哪个、开什么端口、回什么形状」都写死，AI 自由发挥最容易漏', () => {
    expect(prompt).toContain('Umi-OCR');
    expect(prompt).toContain('127.0.0.1:1224');
    expect(prompt).toContain('/api/ocr');
    /* 不传 dict 就只回整页文本，能搜不能划——这是最容易装完还不对的一条 */
    expect(prompt).toContain('data.format');
    expect(prompt).toContain('dict');
    expect(prompt).toContain('Access-Control-Allow-Origin');
  });

  it('要求 AI 把地址回填进这本书的 data.json，并把引擎切到外部服务', () => {
    expect(prompt).toContain('E:/Obsidian/bz reader/.obsidian/plugins/bz-reader/data.json');
    expect(prompt).toContain('pdfOcrUrl');
    expect(prompt).toContain('pdfOcrEngine');
  });

  it('拿不到库路径时用占位符，不写半截路径', () => {
    const bare = pdfOcrDeployPrompt();
    expect(bare).toContain('<你的库路径>');
    expect(bare).not.toContain('undefined');
  });
});
