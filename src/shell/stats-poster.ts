/* ============================================================
 * bz-reader · 统计页图片周报（shell/stats-poster.ts）
 *
 * 原型 drawPoster 的 1:1 复刻：800×1040、2 倍像素、Canvas 直出 PNG，
 * 跟随宿主明暗主题。没有外部依赖，也不往库里写文件——点一下就下载。
 * ============================================================ */
import { t, type MsgKey, type MsgParams } from '../i18n';
import { HOUR_KEYS, clock, dayLabel, shortTime, statsSeries, type FullStats } from '../data/stats-full';

/** 周报上「节律」四档的文案键：顺序与 HOUR_KEYS 一致，只是换成了周报措辞 */
const POSTER_HOUR_KEYS: readonly MsgKey[] = [
  'stats.f.poster.hour0',
  'stats.f.poster.hour1',
  'stats.f.poster.hour2',
  'stats.f.poster.hour3',
];

/** 参数就是 `MsgKey`：不再把任意字符串强转进来，打错键会编译报错 */
const T = (key: MsgKey, params?: MsgParams): string => t(key, params);

interface Palette {
  bg: string; card: string; t1: string; t2: string; t3: string;
  line: string; cu: string; soft: string;
}

const DARK: Palette = {
  bg: '#1f2023', card: '#25262a', t1: '#d8dade', t2: '#a2a7ae', t3: '#6d727a',
  line: '#34363b', cu: '#c8a464', soft: 'rgba(200,164,100,.16)',
};
const LIGHT: Palette = {
  bg: '#ffffff', card: '#f7f7f8', t1: '#2b2f33', t2: '#6a6f76', t3: '#9aa0a6',
  line: '#e2e3e7', cu: '#8a6a34', soft: 'rgba(138,106,52,.14)',
};

/** 画一张周报，返回 PNG data URL（测试里可以直接检查前缀） */
export function drawStatsPoster(a: FullStats): string {
  const ser = statsSeries(a);
  const W = 800;
  const H = 1040;
  const dpr = 2;
  const cv = document.createElement('canvas');
  cv.width = W * dpr;
  cv.height = H * dpr;
  const x = cv.getContext('2d');
  if (!x) return '';
  x.scale(dpr, dpr);
  const dark = document.body.classList.contains('theme-dark');
  const C = dark ? DARK : LIGHT;
  const serif = 'Georgia,"STZhongsong","SimSun",serif';
  const sans = '"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
  const line = (y: number): void => {
    x.strokeStyle = C.line;
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(56, y);
    x.lineTo(W - 56, y);
    x.stroke();
  };
  const label = (s: string, px: number, y: number, color: string, align?: CanvasTextAlign): void => {
    x.fillStyle = color || C.t3;
    x.font = `12px ${sans}`;
    x.textAlign = align || 'left';
    x.fillText(s, px, y);
  };

  x.fillStyle = C.bg;
  x.fillRect(0, 0, W, H);
  x.fillStyle = C.cu;
  x.fillRect(56, 58, 28, 2);
  x.fillStyle = C.t1;
  x.font = `400 36px ${serif}`;
  x.textAlign = 'left';
  x.fillText(T('stats.f.poster.title'), 56, 108);
  label(`${a.todayK.slice(0, 10)} — ${a.todayK}`, 56, 134, C.t2);
  label(
    T('stats.f.report.line3', {
      day: dayLabel(a.peakKey), peak: clock(a.peakSec), hour: T(HOUR_KEYS[a.bestHour]),
      hourSec: clock(a.bestHourSec), idle: a.idleCount,
    }),
    W - 56, 134, C.t2, 'right',
  );
  line(158);

  x.fillStyle = C.cu;
  x.font = `400 76px ${serif}`;
  x.fillText(clock(a.total), 56, 246);
  label(T('stats.f.poster.total'), 56, 272, C.t3);

  const four = [
    [T('stats.f.poster.today'), clock(a.today)],
    [T('stats.f.poster.active'), T('stats.f.daysCount', { n: a.activeDays })],
    [T('stats.f.poster.sessions'), T('stats.f.segments', { n: a.sessionCount })],
    [T('stats.f.poster.streak'), T('stats.f.daysCount', { n: a.streak })],
  ];
  four.forEach((it, i) => {
    const px = 56 + i * 174;
    x.fillStyle = C.t1;
    x.font = `400 26px ${serif}`;
    x.textAlign = 'left';
    x.fillText(it[1], px, 326);
    label(it[0], px, 348, C.t3);
  });
  line(378);

  label(T('stats.f.poster.daily'), 56, 410, C.t2);
  label(T('stats.f.chart.goal', { n: a.dailyGoal }), W - 56, 410, C.cu, 'right');
  const bx = 56;
  const bw = W - 112;
  const bh = 118;
  const by = 430;
  const max = Math.max(a.dailyGoal * 60, ...ser.items.map((i) => i.sec), 1);
  const gy = by + bh - (a.dailyGoal * 60 / max) * bh;
  x.strokeStyle = C.cu;
  x.setLineDash([4, 4]);
  x.globalAlpha = 0.55;
  x.beginPath();
  x.moveTo(bx, gy);
  x.lineTo(bx + bw, gy);
  x.stroke();
  x.setLineDash([]);
  x.globalAlpha = 1;
  const n = ser.items.length;
  const cw = Math.min(56, bw / n - 10);
  ser.items.forEach((it, i) => {
    const px = bx + (bw / n) * i + (bw / n - cw) / 2;
    const h = Math.max(2, it.sec / max * bh);
    const g = x.createLinearGradient(0, by + bh - h, 0, by + bh);
    g.addColorStop(0, C.cu);
    g.addColorStop(1, C.soft);
    x.fillStyle = g;
    x.fillRect(px, by + bh - h, cw, h);
    label(it.label, px + cw / 2, by + bh + 18, C.t3, 'center');
    if (it.sec) label(clock(it.sec), px + cw / 2, by + bh - h - 6, C.t2, 'center');
  });
  line(586);

  label(T('stats.f.poster.invest'), 56, 620, C.t2);
  const ranked = a.books.filter((b) => b.eff > 0).sort((p, q) => q.eff - p.eff).slice(0, 4);
  const rmax = Math.max(1, ...ranked.map((b) => b.eff));
  ranked.forEach((b, i) => {
    const y = 650 + i * 44;
    label(b.title, 56, y, C.t1);
    x.fillStyle = C.card;
    x.fillRect(200, y - 11, 420, 8);
    x.fillStyle = C.cu;
    x.fillRect(200, y - 11, Math.max(2, b.eff / rmax * 420), 8);
    label(clock(b.eff), W - 56, y, C.t2, 'right');
  });
  line(844);

  label(T('stats.f.poster.period'), 56, 878, C.t2);
  const hm = Math.max(1, ...a.hour);
  [0, 1, 2, 3].forEach((i) => {
    const y = 908 + i * 30;
    label(T(POSTER_HOUR_KEYS[i]), 56, y, C.t3);
    x.fillStyle = C.card;
    x.fillRect(170, y - 9, 380, 7);
    x.fillStyle = C.cu;
    x.fillRect(170, y - 9, a.hour[i] / hm * 380, 7);
    label(clock(a.hour[i]), W - 56, y, C.t2, 'right');
  });
  line(1010);
  label(T('stats.f.source'), 56, 1030, C.t3);
  label(shortTime(a.now), W - 56, 1030, C.t3, 'right');
  return cv.toDataURL('image/png');
}

/** 触发浏览器下载，文件名带当天日期 */
export function downloadStatsPoster(a: FullStats): void {
  const url = drawStatsPoster(a);
  if (!url) return;
  const el = document.createElement('a');
  el.href = url;
  el.download = `bz-reader-report-${a.todayK}.png`;
  document.body.appendChild(el);
  el.click();
  document.body.removeChild(el);
}
