/* ============================================================
 * bz-reader · 本地语音自部署提示词（2026-11-14）
 *
 * 这段文字是给 AI 看的，不给人读；但它要能独立把事情交代完：
 * 接口形状、跨域、自检、回填哪几个字段。少一条，AI 装完插件照样连不上。
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import { ttsDeployPrompt } from '../src/core/tts-deploy-prompt';

const p = ttsDeployPrompt();

describe('提示词交代清楚接口', () => {
  it('两条端点都写明：合成与音色列表', () => {
    expect(p).toContain('/v1/audio/speech');
    expect(p).toContain('/v1/audio/voices');
  });

  it('请求体字段与插件实际发的一致', () => {
    for (const field of ['model', 'input', 'voice', 'response_format']) {
      expect(p).toContain(`"${field}"`);
    }
    expect(p).toContain('mp3');
  });

  it('点明要带跨域头：少了它插件必被浏览器拦', () => {
    expect(p).toContain('Access-Control-Allow-Origin');
  });

  it('给默认端口，并要求端口被占时回报实际端口', () => {
    expect(p).toContain('127.0.0.1:8880');
    expect(p).toMatch(/端口/);
  });
});

describe('提示词要求回填设置', () => {
  it('四个字段都点名，还说清不要动别的', () => {
    expect(p).toContain('settings.ttsLocal.url');
    expect(p).toContain('settings.ttsLocal.model');
    expect(p).toContain('prefs.ttsVoiceLocal');
    expect(p).toContain('prefs.ttsEngine');
    expect(p).toMatch(/其它字段一律不要改/);
  });

  it('知道库路径就写成绝对路径，省得 AI 猜', () => {
    const withPath = ttsDeployPrompt({ vaultPath: 'D:\\Obsidian\\叫我包仔' });
    expect(withPath).toContain('D:\\Obsidian\\叫我包仔/.obsidian/plugins/bz-reader/data.json');
  });

  it('不知道库路径时留占位，不编一个假目录', () => {
    expect(p).toContain('<你的库路径>/.obsidian/plugins/bz-reader/data.json');
  });

  it('尾斜杠不会拼出双斜杠', () => {
    expect(ttsDeployPrompt({ vaultPath: 'D:\\vault\\' })).toContain('D:\\vault/.obsidian');
  });
});

describe('提示词的边界', () => {
  it('要求自检跑通再回填，不是装完就写', () => {
    expect(p).toContain('curl');
    expect(p).toMatch(/自检/);
  });

  it('不许把书稿发出去、不许写密钥', () => {
    expect(p).toMatch(/不要把书稿或正文发到外网/);
    expect(p).toMatch(/不要写入任何密钥/);
  });

  it('不写死某个云端地址：这套东西是给本地服务的', () => {
    expect(p).not.toContain('api.deepseek.com');
  });
});
