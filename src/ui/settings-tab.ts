/* ============================================================
 * bz-reader · 设置页（ui/settings-tab.ts）
 *
 * 只有三类东西值得出现在这里：
 *   1. 影响落盘位置的（书摘目录）；
 *   2. 需要外部凭据的（AI 接口）；
 *   3. 需要用户手动输入的凭证（激活码）。
 * 字号、主题、行距不在这里——那些是阅读时随时要调的东西，放在阅读界面的
 * 排版面板里，改完立刻看得见效果。设置页是「配置」，不是「控制台」。
 *
 * 每一项都即时写盘：Obsidian 的设置页没有「保存」按钮，用户改完就关，
 * 指望他再点一次保存是不现实的。
 * ============================================================ */
import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import type { ReaderStore } from '../data/store';
import { DEFAULT_SETTINGS, normalizeSettings, type ReaderSettings } from '../data/settings';

export interface SettingsTabDeps {
  app: App;
  plugin: Plugin;
  store: ReaderStore;
  /** 激活码变化后要让阅读视图重算 pro 能力 */
  onLicenseChange?: () => void;
  /** 检查激活码：返回一段说明文字（成功/失败原因） */
  activate?: (code: string) => Promise<{ ok: boolean; message: string }>;
  /** 当前授权说明（激活后显示到期与机型） */
  licenseInfo?: () => string;
}

export class ReaderSettingTab extends PluginSettingTab {
  private deps: SettingsTabDeps;

  constructor(deps: SettingsTabDeps) {
    super(deps.app, deps.plugin);
    this.deps = deps;
  }

  private get current(): ReaderSettings {
    return normalizeSettings(this.deps.store.get().settings ?? undefined);
  }

  private save(patch: Partial<ReaderSettings>): void {
    const next = normalizeSettings({ ...this.current, ...patch });
    this.deps.store.get().settings = next;
    this.deps.store.touch();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'bz 阅读' });

    /* ── 导出 ── */
    new Setting(containerEl)
      .setName('书摘目录')
      .setDesc('导出的划线笔记写到这里（vault 相对路径，不存在会自动建）')
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.exportDir)
          .setValue(this.current.exportDir)
          .onChange((v) => this.save({ exportDir: v })),
      );

    new Setting(containerEl)
      .setName('导出时带上想法')
      .setDesc('关掉就只导原文引用')
      .addToggle((tg) =>
        tg.setValue(this.current.exportComments).onChange((v) => this.save({ exportComments: v })),
      );

    if (__BZ_READER_PRO__) {
      containerEl.createEl('h3', { text: 'AI' });
      containerEl.createEl('p', {
        cls: 'setting-item-description',
        text: '摘要、名词解释、翻译都走这个接口。填 OpenAI 兼容的服务即可（地址留空则相关功能不出现）。',
      });

      const ai = this.current.ai;
      new Setting(containerEl)
        .setName('接口地址')
        .setDesc('例如 https://api.openai.com/v1，不带结尾斜杠')
        .addText((t) =>
          t
            .setPlaceholder('https://api.openai.com/v1')
            .setValue(ai.baseUrl)
            .onChange((v) => this.save({ ai: { ...this.current.ai, baseUrl: v } })),
        );

      new Setting(containerEl)
        .setName('API Key')
        .setDesc('只存在本地这份数据里，不会上传到别处')
        .addText((t) => {
          t.inputEl.type = 'password';
          t.setPlaceholder('sk-…')
            .setValue(ai.apiKey)
            .onChange((v) => this.save({ ai: { ...this.current.ai, apiKey: v } }));
        });

      new Setting(containerEl)
        .setName('模型')
        .setDesc('例如 gpt-4o-mini / deepseek-chat')
        .addText((t) =>
          t
            .setPlaceholder('gpt-4o-mini')
            .setValue(ai.model)
            .onChange((v) => this.save({ ai: { ...this.current.ai, model: v } })),
        );

      this.renderLicense(containerEl);
    }
  }

  private renderLicense(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: '授权' });
    const info = this.deps.licenseInfo?.() ?? '';
    const status = containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: info || '当前未激活，高级功能不可用。',
    });

    let input = '';
    new Setting(containerEl)
      .setName('激活码')
      .setDesc('粘贴后点激活。换机时把同一个码复用即可')
      .addText((t) =>
        t
          .setPlaceholder('BZR1.…')
          .setValue(this.current.license)
          .onChange((v) => {
            input = v.trim();
          }),
      )
      .addButton((b) =>
        b.setButtonText('激活').onClick(async () => {
          if (!this.deps.activate) return;
          const code = input || this.current.license;
          const res = await this.deps.activate(code);
          status.setText(res.message);
          status.style.color = res.ok ? 'var(--text-success)' : 'var(--text-error)';
          if (res.ok) {
            this.save({ license: code });
            this.deps.onLicenseChange?.();
          }
        }),
      );
  }
}
