/* ============================================================
 * bz-reader · 选一个本地文件（core/file-pick.ts）
 *
 * 恢复备份要用户从磁盘上挑一个 `.json`。Obsidian 没有公开的「打开文件
 * 对话框」，所以用一个隐藏的 `<input type="file">`——桌面与移动端
 * （iOS / Android 的 WKWebView、Capacitor）都认，会弹系统自己的选择器。
 *
 * 用户取消时 `change` 不会触发（各家实现不一致），所以同时挂 `cancel`；
 * 两个都没来就一直挂着——但那个 Promise 没人 await 也不会泄漏什么，
 * 下一次调用会新建一个 input。
 * ============================================================ */

export interface PickedFile {
  name: string;
  text: () => Promise<string>;
}

export function pickJsonFile(): Promise<PickedFile | null> {
  return new Promise<PickedFile | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    let settled = false;
    const done = (v: PickedFile | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        done(null);
        return;
      }
      done({ name: file.name, text: () => file.text() });
    });
    // Chrome / Safari 支持 cancel；不支持的环境里这个监听不生效，无副作用
    input.addEventListener('cancel', () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}
