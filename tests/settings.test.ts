import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/data/settings';

/**
 * exportDir / importDir 是自由文本框。以前只收首尾斜杠，`../x` 会让导出写到
 * 数据目录（甚至库）之外；这里与 normalizeDataDir 同口径：按段过滤。
 */
describe('目录设置收口', () => {
  it('上跳段被丢弃', () => {
    expect(normalizeSettings({ exportDir: '../外面' }).exportDir).toBe('外面');
    expect(normalizeSettings({ exportDir: '书摘/../../外面' }).exportDir).toBe('书摘/外面');
  });

  it('. 段与点开头的隐藏目录被丢弃', () => {
    expect(normalizeSettings({ exportDir: './书摘' }).exportDir).toBe('书摘');
    expect(normalizeSettings({ exportDir: '.obsidian/plugins/x' }).exportDir).toBe('plugins/x');
  });

  it('正常多级目录原样保留，反斜杠转正斜杠', () => {
    expect(normalizeSettings({ exportDir: '阅读\\书摘' }).exportDir).toBe('阅读/书摘');
  });

  it("'/' 仍然表示库根目录（不是空值）", () => {
    expect(normalizeSettings({ exportDir: '/' }).exportDir).toBe('/');
  });

  it('空串回落到默认目录', () => {
    expect(normalizeSettings({ exportDir: '   ' }).exportDir).toBe(DEFAULT_SETTINGS.exportDir);
    expect(normalizeSettings({ exportDir: '..' }).exportDir).toBe(DEFAULT_SETTINGS.exportDir);
  });

  it('importDir 用同一套规则，但回落到自己的默认值', () => {
    expect(normalizeSettings({ importDir: '../x' }).importDir).toBe('x');
    expect(normalizeSettings({ importDir: '' }).importDir).toBe(DEFAULT_SETTINGS.importDir);
  });
});

/**
 * 在线语音组（2026-11-14）：以前朗读借 AI 组的地址与密钥，现在自带一份。
 * 升级时若这份配置根本不存在，必须从 AI 组搬一次，否则老用户点朗读
 * 直接变「没配置」——这是事故。
 */
describe('在线语音设置', () => {
  it('老数据没有 ttsOnline：把 AI 组的地址与密钥搬过来', () => {
    const s = normalizeSettings({ ai: { baseUrl: 'https://proxy.example.com', apiKey: 'sk-old' } });
    expect(s.ttsOnline).toEqual({ url: 'https://proxy.example.com', model: '', apiKey: 'sk-old', format: 'mp3' });
  });

  it('AI 组也没配：预填官方地址，密钥留空', () => {
    const s = normalizeSettings({});
    expect(s.ttsOnline.url).toBe('https://api.deepseek.com');
    expect(s.ttsOnline.apiKey).toBe('');
  });

  it('本地地址预填本机默认端口，用户照着改即可', () => {
    expect(normalizeSettings({}).ttsLocal.url).toBe('http://127.0.0.1:8880');
  });

  it('用户自己清空本地地址：保持空，不再填回来', () => {
    expect(normalizeSettings({ ttsLocal: { url: '', model: '', apiKey: '', format: 'mp3' } }).ttsLocal.url).toBe('');
  });

  it('已经有 ttsOnline：用户清空就保持空，不再回填 AI 组的值', () => {
    const s = normalizeSettings({
      ai: { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-ai' },
      ttsOnline: { url: '', model: '', apiKey: '', format: 'mp3' },
    });
    expect(s.ttsOnline.url).toBe('');
    expect(s.ttsOnline.apiKey).toBe('');
  });

  it('地址按云端口径补协议：本机 / 内网补 http，域名补 https', () => {
    const withUrl = (url: string): string => normalizeSettings({ ttsOnline: { url, model: '', apiKey: '' } }).ttsOnline.url;
    expect(withUrl('127.0.0.1:8880')).toBe('http://127.0.0.1:8880');
    expect(withUrl('localhost:8880')).toBe('http://localhost:8880');
    expect(withUrl('192.168.1.9:9000')).toBe('http://192.168.1.9:9000');
    expect(withUrl('api.deepseek.com')).toBe('https://api.deepseek.com');
    expect(withUrl('https://tts.example.com/')).toBe('https://tts.example.com');
  });

  it('模型名去掉首尾空格：粘进来常带', () => {
    const s = normalizeSettings({ ttsOnline: { url: '', model: '  cosyvoice-2 ', apiKey: '' } });
    expect(s.ttsOnline.model).toBe('cosyvoice-2');
  });
});
