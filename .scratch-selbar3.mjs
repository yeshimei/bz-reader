import fs from 'node:fs';
const p = 'D:/Obsidian/bz-reader/src/shell/styles/mobile.css';
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('.bzs-selbar .bzs-sbtn')) {
  s = s.replace(`  /* 选区工具条：桌面浮在选字上方，手机上改贴底，避开拇指遮挡 */
  .bzs-selbar {
    left: 50% !important;
    top: auto !important;
    bottom: calc(56px + env(safe-area-inset-bottom, 0px)) !important;
    transform: translateX(-50%);
    max-width: calc(100vw - 24px);
    flex-wrap: wrap;
    justify-content: center;
  }`, `  /* 选区工具条：跟着选区走（位置由 JS 算），这里只管尺寸与换行 */
  .bzs-selbar {
    max-width: calc(100vw - 24px);
    flex-wrap: nowrap;
    padding: 8px 10px;
    gap: 6px;
  }

  .bzs-selbar .bzs-sbtn {
    padding: 8px 10px;
    font-size: 12px;
  }

  .bzs-selbar .bzs-pendot {
    width: 26px;
    height: 26px;
  }`);
  fs.writeFileSync(p, s, 'utf8');
  console.log('css ok');
} else console.log('already');
