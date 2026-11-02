/* 把拆分源文件拼成可直接打开的单文件 index.html（内联 CSS/JS）。
   打磨时改 app.css / core.js / ui.js / shell.html，再跑一次本脚本。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const css = read('app.css');
const core = read('core.js');
const ui = read('ui.js');
const shell = read('shell.html');
const bundle = core + '\n' + ui;

const html = shell
  .replace('<link rel="stylesheet" href="app.css">', () => '<style>\n' + css + '\n</style>')
  .replace('<script src="core.js"></script>\n<script src="ui.js"></script>', () => '<script>\n' + bundle + '\n</script>');

fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
fs.writeFileSync(path.join(dir, '.bundle-check.js'), bundle, 'utf8');
console.log('index.html', html.length, 'bytes | bundle', bundle.length, 'bytes');
