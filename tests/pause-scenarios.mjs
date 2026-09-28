// 模拟 iOS 播放器行为，检查全屏暂停 / 后台续播逻辑
// 用法：node pause-scenarios.mjs [脚本路径]   默认 ../YouTubeClear.js
//
// 注意：这是在 jsdom 里模拟，不能代替 iPhone 真机测试。
import { JSDOM } from 'jsdom';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractInjected, checkOuterSyntax } from './extract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(process.argv[2] || path.join(here, '..', 'YouTubeClear.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

checkOuterSyntax(file);
const injected = extractInjected(file);
new Function(injected); // 注入代码语法检查

async function scenario(name, expect, steps) {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><ytm-app><div id="movie_player" class="html5-video-player">' +
    '<video class="html5-main-video"></video></div></ytm-app></body></html>',
    { url: 'https://m.youtube.com/watch?v=test', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const w = dom.window;

  // 可控的“真实可见性” + 模拟 WebKit 的 <video>
  w.eval(`
    window.__fakeHidden = false;
    Object.defineProperty(Document.prototype, 'hidden', { get(){ return window.__fakeHidden; }, configurable: true });
    var P = HTMLMediaElement.prototype;
    Object.defineProperty(P, 'paused',     { get(){ return this.__p !== false; }, configurable: true });
    Object.defineProperty(P, 'ended',      { get(){ return false; }, configurable: true });
    Object.defineProperty(P, 'readyState', { get(){ return 4; }, configurable: true });
    Object.defineProperty(P, 'duration',   { get(){ return 300; }, configurable: true });
    P.play = function () {
      var was = this.paused; this.__p = false;
      if (was) { this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); }
      return Promise.resolve();
    };
    P.pause = function () {
      var was = !this.paused; this.__p = true;
      if (was) this.dispatchEvent(new Event('pause'));
    };
    // iOS 原生全屏控件 / 系统暂停：直接走原生 pause，不经过网页 JS
    window.__sysPause = P.pause;
    navigator.mediaSession = { setActionHandler(){}, setPositionState(){}, playbackState: 'none' };
  `);

  const errors = [];
  w.addEventListener('error', e => errors.push(e.message));
  w.eval(injected);

  const v = w.document.querySelector('video');
  v.play();
  await sleep(300);
  await steps(w, v);

  const got = v.paused ? 'PAUSED' : 'PLAYING';
  const ok = got === expect && errors.length === 0;
  try { w.__ytClearScriptableTube.destroy(); } catch (e) {}
  w.close();
  console.log(`${ok ? '✅' : '❌'} ${name}：期望 ${expect}，实际 ${got}${errors.length ? '  错误: ' + errors.join('; ') : ''}`);
  return ok;
}

const hide = w => { w.__fakeHidden = true; w.document.dispatchEvent(new w.Event('visibilitychange')); };

const results = [];
results.push(await scenario('1 全屏里点暂停', 'PAUSED', async (w, v) => {
  v.webkitDisplayingFullscreen = true; w.__sysPause.call(v); await sleep(1500);
}));
results.push(await scenario('2 非全屏时被系统暂停（切后台）', 'PLAYING', async (w, v) => {
  w.__sysPause.call(v); await sleep(1500);
}));
results.push(await scenario('3 全屏时锁屏', 'PLAYING', async (w, v) => {
  v.webkitDisplayingFullscreen = true; w.__sysPause.call(v); await sleep(50); hide(w); await sleep(1500);
}));
results.push(await scenario('4 全屏暂停后再点播放', 'PLAYING', async (w, v) => {
  v.webkitDisplayingFullscreen = true; w.__sysPause.call(v); await sleep(1000);
  w.HTMLMediaElement.prototype.play.call(v); await sleep(500);
}));
results.push(await scenario('5 全屏暂停一会儿后再锁屏', 'PAUSED', async (w, v) => {
  v.webkitDisplayingFullscreen = true; w.__sysPause.call(v); await sleep(2000); hide(w); await sleep(1500);
}));
results.push(await scenario('6 画中画里点暂停（App 在后台）', 'PAUSED', async (w, v) => {
  v.webkitPresentationMode = 'picture-in-picture'; w.__fakeHidden = true; w.__sysPause.call(v); await sleep(1500);
}));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} 通过  (${path.basename(file)})`);
process.exit(passed === results.length ? 0 : 1);
