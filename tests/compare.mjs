// 在 jsdom 里模拟 iOS / WebKit 的播放器行为，对一个或多个版本跑同一组场景
//
// 用法：
//   node compare.mjs                      测试 ../YouTubeClear.js
//   node compare.mjs a.js b.js c.js       对比多个版本，输出表格
//
// 注意：这是模拟，不能代替 iPhone 真机测试。
import { JSDOM } from 'jsdom';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractInjected, checkOuterSyntax } from './extract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = process.argv.slice(2).length
  ? process.argv.slice(2).map(f => path.resolve(f))
  : [path.join(here, '..', 'YouTubeClear.js')];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ─── 模拟环境 ─── */
async function makePage(code, url = 'https://m.youtube.com/watch?v=test') {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><ytm-app>' +
    '<div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video></div>' +
    '<input id="yt-search-box"></ytm-app></body></html>',
    { url, runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const w = dom.window;
  w.eval(`
    window.__fakeHidden = false;
    window.__vw = 430; window.__vh = 932;          // iPhone 14 Pro Max 竖屏
    window.__fsCalls = 0;
    window.__handlers = {};
    Object.defineProperty(Document.prototype, 'hidden', { get(){ return window.__fakeHidden; }, configurable: true });
    Object.defineProperty(window, 'innerWidth',  { get(){ return window.__vw; }, configurable: true });
    Object.defineProperty(window, 'innerHeight', { get(){ return window.__vh; }, configurable: true });

    var P = HTMLMediaElement.prototype;
    Object.defineProperty(P, 'paused',       { get(){ return this.__p !== false; }, configurable: true });
    Object.defineProperty(P, 'ended',        { get(){ return false; }, configurable: true });
    Object.defineProperty(P, 'readyState',   { get(){ return 4; }, configurable: true });
    Object.defineProperty(P, 'duration',     { get(){ return 300; }, configurable: true });
    Object.defineProperty(P, 'currentTime',  { get(){ return this.__t || 0; }, set(v){ this.__t = v; }, configurable: true });
    Object.defineProperty(P, 'muted',        { get(){ return !!this.__m; }, set(v){ this.__m = !!v; }, configurable: true });
    Object.defineProperty(P, 'playbackRate', { get(){ return this.__r || 1; }, set(v){ this.__r = v; }, configurable: true });
    P.play = function () {
      var was = this.paused; this.__p = false;
      if (was) { this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); }
      return Promise.resolve();
    };
    P.pause = function () {
      var was = !this.paused; this.__p = true;
      if (was) this.dispatchEvent(new Event('pause'));
    };
    // iOS 原生控件 / 系统造成的暂停：直接走原生 pause，不经过网页 JS
    window.__sysPause = P.pause;
    window.__origPlay = P.play;
    window.__origAdd = EventTarget.prototype.addEventListener;
    HTMLVideoElement.prototype.webkitEnterFullscreen = function () {
      window.__fsCalls++;
      this.webkitDisplayingFullscreen = true;
      this.dispatchEvent(new Event('webkitbeginfullscreen'));
    };
    navigator.mediaSession = {
      setActionHandler(n, f){ window.__handlers[n] = f; },
      setPositionState(){}, playbackState: 'none'
    };
  `);
  const errors = [];
  w.addEventListener('error', e => errors.push(e.message));
  w.eval(code);
  const v = w.document.querySelector('video');
  return { w, v, errors };
}

/* ─── 常用动作 ─── */
const A = {
  touch:   w => w.document.dispatchEvent(new w.Event('touchstart')),
  blur:    w => w.dispatchEvent(new w.FocusEvent('blur')),
  hide:    w => { w.__fakeHidden = true; w.document.dispatchEvent(new w.Event('visibilitychange')); },
  lock:    w => { A.blur(w); A.hide(w); },
  enterFS: (w, v) => { v.webkitDisplayingFullscreen = true; v.dispatchEvent(new w.Event('webkitbeginfullscreen')); },
  exitFS:  (w, v) => { v.webkitDisplayingFullscreen = false; v.dispatchEvent(new w.Event('webkitendfullscreen')); },
  sysPause:(w, v) => w.__sysPause.call(v),
  userPlay:(w, v) => w.HTMLMediaElement.prototype.play.call(v),
  landscape: w => { w.__vw = 932; w.__vh = 430; w.dispatchEvent(new w.Event('resize')); },
};
const state = v => (v.paused ? '暂停' : '播放');

/* ─── 场景 ─── */
const SCENARIOS = [
  // 暂停 / 续播
  { group: '暂停与续播', name: '内联播放器点暂停，之后锁屏', expect: '暂停', run: async (w, v) => {
      A.touch(w); w.HTMLMediaElement.prototype.pause.call(v); await sleep(1500); A.lock(w); await sleep(1200); return state(v); } },
  { group: '暂停与续播', name: '全屏里点暂停', expect: '暂停', run: async (w, v) => {
      A.enterFS(w, v); A.sysPause(w, v); await sleep(1500); return state(v); } },
  { group: '暂停与续播', name: '进入全屏时触发 blur，再在全屏里点暂停', expect: '暂停', run: async (w, v) => {
      A.blur(w); A.enterFS(w, v); A.sysPause(w, v); await sleep(1500); return state(v); } },
  { group: '暂停与续播', name: '全屏暂停后再点播放', expect: '播放', run: async (w, v) => {
      A.enterFS(w, v); A.sysPause(w, v); await sleep(1000); A.userPlay(w, v); await sleep(500); return state(v); } },
  { group: '暂停与续播', name: '全屏暂停 2 秒后锁屏', expect: '暂停', run: async (w, v) => {
      A.enterFS(w, v); A.sysPause(w, v); await sleep(2000); A.lock(w); await sleep(1500); return state(v); } },
  { group: '暂停与续播', name: '画中画里点暂停（App 在后台）', expect: '暂停', run: async (w, v) => {
      A.lock(w); v.webkitPresentationMode = 'picture-in-picture'; await sleep(200); A.sysPause(w, v); await sleep(1500); return state(v); } },
  { group: '后台播放', name: '切后台：先 blur，再被系统暂停', expect: '播放', run: async (w, v) => {
      A.blur(w); await sleep(50); A.sysPause(w, v); await sleep(1500); return state(v); } },
  { group: '后台播放', name: '切后台：系统暂停先到，50ms 后才进后台', expect: '播放', run: async (w, v) => {
      A.sysPause(w, v); await sleep(50); A.lock(w); await sleep(1500); return state(v); } },
  { group: '后台播放', name: '全屏时锁屏（系统暂停先到）', expect: '播放', run: async (w, v) => {
      A.enterFS(w, v); A.sysPause(w, v); await sleep(50); A.lock(w); await sleep(1500); return state(v); } },
  { group: '后台播放', name: '后台时 YouTube 自己调用 pause()', expect: '播放', run: async (w, v) => {
      A.lock(w); await sleep(100); w.HTMLMediaElement.prototype.pause.call(v); await sleep(1500); return state(v); } },
  { group: '前台系统暂停', name: '前台被系统暂停（拔耳机 / 来电）', expect: '暂停', run: async (w, v) => {
      A.sysPause(w, v); await sleep(2000); return state(v); } },
  { group: '前台系统暂停', name: '前台被系统暂停，2 秒后锁屏', expect: '暂停', run: async (w, v) => {
      A.sysPause(w, v); await sleep(2000); A.lock(w); await sleep(1500); return state(v); } },
  { group: '前台系统暂停', name: '输入框失焦后，前台被系统暂停', expect: '暂停', run: async (w, v) => {
      const box = w.document.getElementById('yt-search-box');
      box.dispatchEvent(new w.FocusEvent('focus')); box.dispatchEvent(new w.FocusEvent('blur'));
      await sleep(100); A.sysPause(w, v); await sleep(2000); return state(v); } },

  // 广告
  { group: '广告', name: '广告后恢复 1.5 倍速和静音', expect: '1.5x 静音', run: async (w, v) => {
      v.playbackRate = 1.5; v.muted = true; await sleep(900);
      const p = w.document.getElementById('movie_player');
      p.classList.add('ad-showing'); await sleep(900); p.classList.remove('ad-showing'); await sleep(1000);
      return v.playbackRate + 'x ' + (v.muted ? '静音' : '有声'); } },
  { group: '广告', name: '广告中途切换视频，下个视频有声音', expect: '1x 有声', run: async (w, v) => {
      await sleep(900);
      const p = w.document.getElementById('movie_player');
      p.classList.add('ad-showing'); await sleep(900);
      w.dispatchEvent(new w.PopStateEvent('popstate')); p.classList.remove('ad-showing');
      v.playbackRate = 1;   // 换源时浏览器会把倍速重置为默认值
      await sleep(1200);
      return v.playbackRate + 'x ' + (v.muted ? '静音' : '有声'); } },

  // 其他
  { group: '其他', name: '锁屏“下一个”只点击一次', expect: '1 次', run: async (w, v) => {
      const b = w.document.createElement('button'); b.className = 'ytp-next-button';
      let n = 0; b.addEventListener('click', () => n++); w.document.body.appendChild(b);
      await sleep(300); w.__handlers.nexttrack && w.__handlers.nexttrack(); await sleep(300); return n + ' 次'; } },
  { group: '其他', name: '横屏自动全屏，手动退出后不会被拉回', expect: '1 次', run: async (w, v) => {
      await sleep(200); A.landscape(w); await sleep(800);
      A.exitFS(w, v); w.dispatchEvent(new w.Event('resize')); await sleep(1500);
      return w.__fsCalls + ' 次'; } },
  { group: '其他', name: '首页横屏不全屏（预览视频）', url: 'https://m.youtube.com/', expect: '0 次', run: async (w, v) => {
      await sleep(200); A.landscape(w); await sleep(1200); return w.__fsCalls + ' 次'; } },
  { group: '其他', name: 'destroy() 还原所有补丁', expect: '已还原', run: async (w, v) => {
      await sleep(200); w.__ytClearScriptableTube.destroy();
      const ok = w.HTMLMediaElement.prototype.play === w.__origPlay &&
        w.EventTarget.prototype.addEventListener === w.__origAdd &&
        !Object.prototype.hasOwnProperty.call(w.document, 'hidden');
      return ok ? '已还原' : '未还原'; } },
];

/* ─── 运行 ─── */
async function runFile(file) {
  checkOuterSyntax(file);
  const code = extractInjected(file);
  new Function(code);
  return Promise.all(SCENARIOS.map(async s => {
    const { w, v, errors } = await makePage(code, s.url);
    v.play();
    await sleep(300);
    let got;
    try { got = await s.run(w, v); } catch (e) { got = '出错 ' + e.message; }
    if (errors.length) got += '（报错）';
    try { w.__ytClearScriptableTube && w.__ytClearScriptableTube.destroy(); } catch (e) {}
    w.close();
    return got;
  }));
}

const results = [];
for (const f of files) results.push(await runFile(f));

const names = files.map(f => path.basename(f, '.js'));
const header = ['场景', '期望', ...names];
const rows = SCENARIOS.map((s, i) => [
  s.name, s.expect,
  ...results.map(r => (r[i] === s.expect ? '✅ ' : '❌ ') + r[i])
]);
console.log('| ' + header.join(' | ') + ' |');
console.log('|' + header.map(() => '---').join('|') + '|');
rows.forEach(r => console.log('| ' + r.join(' | ') + ' |'));
console.log('');
results.forEach((r, i) => {
  const pass = r.filter((x, j) => x === SCENARIOS[j].expect).length;
  console.log(`${names[i]}: ${pass}/${SCENARIOS.length} 通过`);
});

const last = results[results.length - 1];
process.exit(last.every((x, j) => x === SCENARIOS[j].expect) ? 0 : 1);
