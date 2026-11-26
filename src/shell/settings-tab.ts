/**
 * Obsidian 自带设置里的 bz Reader 页（src/shell/settings-tab.ts）
 *
 * 只放一行按钮：真正的设置全在书架「设置」页（shell/render/settings.ts）。
 * 为什么还要这层：关掉 Obsidian 设置后，用户在「第三方插件」里找不到本插件
 * 的设置入口，只能翻命令面板。这里补一个门牌，点了直接送到书架设置页。
 *
 * 2026-11-26：点按钮先收宿主设置 Modal，等它离场再开书架设置页——宿主 Modal
 * 不收起会攥着焦点，移动端设置页里的输入框全部失效（iPad 打字进设置搜索框，
 * iPhone / 安卓输不进）。交接逻辑在 core/ui/host-settings。
 */
import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import { afterHostSettingsClosed } from '../core/ui/host-settings';
import { t } from '../i18n';

/** 宿主插件需要的最小面：只用来开书架设置页 */
export interface SettingsEntryHost {
  openStudy(page: 'settings'): void;
}

export class BzReaderSettingTab extends PluginSettingTab {
  private readonly host: Plugin & SettingsEntryHost;

  constructor(app: App, host: Plugin & SettingsEntryHost) {
    super(app, host);
    this.host = host;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName(t('settings.tab.open'))
      .setDesc(t('settings.tab.openDesc'))
      .addButton((btn) =>
        btn
          .setButtonText(t('settings.tab.open'))
          .setCta()
          .onClick(() =>
            afterHostSettingsClosed(this.app, containerEl, () => this.host.openStudy('settings')),
          ),
      );
  }
}
