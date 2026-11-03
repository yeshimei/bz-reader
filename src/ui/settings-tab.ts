/* ============================================================
 * bz-reader · 原生设置页（ui/settings-tab.ts）
 *
 * 这里只做两件事：激活码，和「把人送去真正的设置页」。
 *
 * 为什么不再放导出目录 / AI 配置：那些项在书架第四页都有一份，两处能改
 * 同一个值就会出现「在这边改了、那边还显示旧的」这类问题；而且用户要求
 * 设置项下面不要挂描述文字，原生页每题都带一行 setDesc，口径对不上。
 * 真正的配置只有一处——书架 · 设置。
 *
 * 激活码留在这里：它是「装好之后第一件事」，人会在插件设置里找它。
 * ============================================================ */
import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import type { ReaderStore } from '../data/store';
import { normalizeSettings, type ReaderSettings } from '../data/settings';

export interface SettingsTabDeps {
  app: App;
  plugin: Plugin;
  store: ReaderStore;
  /** 打开书架的设置页（真正的设置在那儿） */
  openSettings?: () => void;
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

    new Setting(containerEl)
      .setName('书架与设置')
      .addButton((b) =>
        b
          .setButtonText('打开')
          .onClick(() => {
            this.deps.openSettings?.();
          }),
      );

    this.renderLicense(containerEl);
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
      .addText((t) =>
        t
          .setPlaceholder('BZR3.…')
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
