// 检查 destroy() 能还原所有补丁，并且可以重复注入新版本
import { JSDOM } from 'jsdom';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractInjected } from './extract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(process.argv[2] || path.join(here, '..', 'YouTubeClear.js'));

const dom = new JSDOM(
  '<!doctype html><html><head></head><body><div id="movie_player"><video></video></div></body></html>',
  { url: 'https://m.youtube.com/', runScripts: 'outside-only', pretendToBeVisual: true }
);
const w = dom.window;
w.eval(`
  navigator.mediaSession = { setActionHandler(){}, playbackState: 'none' };
  window.__origPlay = HTMLMediaElement.prototype.play;
  window.__origPause = HTMLMediaElement.prototype.pause;
  window.__origAdd = EventTarget.prototype.addEventListener;
`);

const code = extractInjected(file);
w.eval(code);

const checks = [];
const check = (name, ok) => { checks.push(ok); console.log(`${ok ? '✅' : '❌'} ${name}`); };

check('注入后创建了侧边面板', !!w.document.getElementById('yt-panel'));
w.__ytClearScriptableTube.destroy();
check('destroy 后 play 已还原', w.HTMLMediaElement.prototype.play === w.__origPlay);
check('destroy 后 pause 已还原', w.HTMLMediaElement.prototype.pause === w.__origPause);
check('destroy 后 addEventListener 已还原', w.EventTarget.prototype.addEventListener === w.__origAdd);
check('destroy 后面板已移除', !w.document.getElementById('yt-panel'));
check('destroy 后 document.hidden 伪装已移除', !Object.prototype.hasOwnProperty.call(w.document, 'hidden'));

w.eval(code.replace(/var VERSION = '[^']+'/, "var VERSION = 'reinject-test'"));
check('可以再次注入新版本', w.__ytClearScriptableTube.version === 'reinject-test');

process.exit(checks.every(Boolean) ? 0 : 1);
