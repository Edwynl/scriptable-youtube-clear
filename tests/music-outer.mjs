// 外层 Scriptable 脚本的模拟测试：用 jsdom 页面代替 WebView，其余 Scriptable 接口用假对象，
// 检查“运行 → 注入 → 日志镜像 → 关闭后弹窗复制日志 / 保存文件”整个流程
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(process.argv[2] || path.join(here, '..', 'music', 'YouTubeMusicClear.js'));
const src = fs.readFileSync(file, 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="movie_player" class="html5-video-player"><video></video></div></body></html>',
  { url: 'https://music.youtube.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.eval(`document.elementFromPoint = function(){return null;};
  navigator.mediaSession = { setActionHandler(){}, setPositionState(){}, playbackState: 'none' };`);

const record = { alerts: [], copied: null, files: {}, presented: false };
class WebView {
  async loadURL() {}
  async evaluateJavaScript(code) { return w.eval(code); }
  async present() {
    record.presented = true;
    w.eval("window.__ytClearScriptableMusic.state.logs.push('test: 用户在用'); window.__ytClearScriptableMusic.state.logSeq++;");
    await sleep(3500);                                   // 让日志镜像跑一次
    w.eval("for (var i=0;i<5;i++){window.__ytClearScriptableMusic.state.logs.push('test: 关闭前 '+i); window.__ytClearScriptableMusic.state.logSeq++;}");
  }
}
const Timer = { schedule(ms, repeat, fn) { const id = setInterval(fn, ms); return { invalidate() { clearInterval(id); } }; } };
class Alert {
  constructor() { this.actions = []; }
  addAction(t) { this.actions.push(t); }
  addCancelAction(t) { this.cancel = t; }
  async presentAlert() { record.alerts.push({ title: this.title, message: this.message, actions: this.actions }); return 0; }
}
const Pasteboard = { copy(t) { record.copied = t; } };
const mkFM = (name, fail) => ({
  documentsDirectory: () => '/' + name, joinPath: (a, b) => a + '/' + b,
  writeString(p, t) { if (fail) throw new Error('no iCloud'); record.files[p] = t; }
});
const FileManager = { iCloud: () => mkFM('icloud', true), local: () => mkFM('local', false) };   // 模拟 iCloud 不可用
const config = { runsInApp: true };
const Script = { complete() {} };

const run = new Function('WebView', 'Timer', 'Alert', 'Pasteboard', 'FileManager', 'config', 'Script',
  'return (async () => {' + src + '\n})()');
await run(WebView, Timer, Alert, Pasteboard, FileManager, config, Script);

const ok = [];
const check = (name, cond) => { ok.push(!!cond); console.log((cond ? '✅ ' : '❌ ') + name); };
check('WebView 已显示', record.presented);
check('关闭后弹出日志窗口', record.alerts.length === 1 && record.alerts[0].actions[0] === '复制日志');
check('日志已复制到剪贴板，包含版本号和关闭前的日志', record.copied && record.copied.indexOf('4.0.') > 0 && record.copied.indexOf('关闭前 4') > 0);
check('iCloud 不可用时存到本机', !!record.files['/local/yt-music-clear-log.txt']);
check('弹窗里写明保存位置', record.alerts[0] && record.alerts[0].message.indexOf('我的 iPhone') >= 0);
check('日志里有启动信息（audioSession 检测）', record.copied && record.copied.indexOf('audioSession') >= 0);
console.log('\n弹窗内容预览：\n' + (record.alerts[0] ? record.alerts[0].title + '\n' + record.alerts[0].message : '(无)'));
process.exit(ok.every(Boolean) ? 0 : 1);
