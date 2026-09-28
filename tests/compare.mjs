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
async function makePage(code, url = 'https://m.youtube.com/watch?v=test', before) {
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
    Object.defineProperty(P, 'readyState',   { get(){ return this.__notReady ? 0 : 4; }, configurable: true });
    Object.defineProperty(P, 'duration',     { get(){ return this.__dur !== undefined ? this.__dur : 300; }, configurable: true });
    Object.defineProperty(P, 'currentTime',  { get(){ return this.__t || 0; }, set(v){ this.__t = v; }, configurable: true });
    Object.defineProperty(P, 'muted',        { get(){ return !!this.__m; }, set(v){ this.__m = !!v; }, configurable: true });
    Object.defineProperty(P, 'playbackRate', { get(){ return this.__r || 1; }, set(v){ this.__r = v; }, configurable: true });
    window.__plays = 0;
    P.play = function () {
      window.__plays++;
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
      this.webkitPresentationMode = 'fullscreen';
      this.dispatchEvent(new Event('webkitbeginfullscreen'));
    };
    HTMLVideoElement.prototype.webkitSetPresentationMode = function (mode) {
      this.webkitPresentationMode = mode;
      this.webkitDisplayingFullscreen = mode !== 'inline';
      this.dispatchEvent(new Event('webkitpresentationmodechanged'));
    };
    // 模拟 iOS 的 AudioContext：被别的 App 打断时 state 变成 'interrupted'
    window.__ctxs = [];
    window.AudioContext = function () {
      var et = new EventTarget();
      et.state = 'suspended'; et.destination = {}; et.__resumeCalls = 0;
      et.resume = function () { et.__resumeCalls++; if (et.state !== 'interrupted') et.state = 'running'; return Promise.resolve(); };
      et.suspend = function () { et.state = 'suspended'; return Promise.resolve(); };
      et.close = function () { return Promise.resolve(); };
      et.createGain = function () { return { gain: { value: 1 }, connect(){}, disconnect(){} }; };
      et.createOscillator = function () { return { frequency: { value: 0 }, connect(){}, disconnect(){}, start(){}, stop(){} }; };
      window.__ctxs.push(et);
      return et;
    };
    navigator.mediaSession = {
      setActionHandler(n, f){ window.__handlers[n] = f; },
      setPositionState(){}, playbackState: 'none'
    };
  `);
  if (before) before(w);
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
  enterFS: (w, v) => { v.webkitDisplayingFullscreen = true; v.webkitPresentationMode = 'fullscreen'; v.dispatchEvent(new w.Event('webkitbeginfullscreen')); },
  exitFS:  (w, v) => { v.webkitDisplayingFullscreen = false; v.webkitPresentationMode = 'inline'; v.dispatchEvent(new w.Event('webkitendfullscreen')); },
  toPiP:   (w, v, withEnd) => {
    v.webkitDisplayingFullscreen = false; v.webkitPresentationMode = 'picture-in-picture';
    if (withEnd) v.dispatchEvent(new w.Event('webkitendfullscreen'));
    v.dispatchEvent(new w.Event('webkitpresentationmodechanged'));
  },
  pipBackInline: (w, v) => { v.webkitPresentationMode = 'inline'; v.dispatchEvent(new w.Event('webkitpresentationmodechanged')); },
  portrait: w => { w.__vw = 430; w.__vh = 932; w.dispatchEvent(new w.Event('resize')); },
  sysPause:(w, v) => w.__sysPause.call(v),
  userPlay:(w, v) => w.HTMLMediaElement.prototype.play.call(v),
  landscape: w => { w.__vw = 932; w.__vh = 430; w.dispatchEvent(new w.Event('resize')); },
};
const state = v => (v.paused ? '暂停' : '播放');
const ctxOf = w => w.__ctxs[w.__ctxs.length - 1];
const setAudio = (w, st) => { const c = ctxOf(w); if (!c) return; c.state = st; c.dispatchEvent(new w.Event('statechange')); };
// 其他 App 抢走声音：系统暂停视频 + AudioContext 进入 interrupted；过程中统计我们去抢音频的次数
async function interruptFor(w, v, ms) {
  A.sysPause(w, v); await sleep(100); setAudio(w, 'interrupted');
  const c = ctxOf(w); const before = c ? c.__resumeCalls : 0;
  const playsBefore = w.__plays; await sleep(ms);
  return { grabbed: (c ? c.__resumeCalls - before : 0) + (w.__plays - playsBefore), paused: v.paused };
}

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
      A.toPiP(w, v, false); A.lock(w); await sleep(2500); A.sysPause(w, v); await sleep(1500); return state(v); } },
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
  { group: '横屏全屏', name: '先横屏再打开视频，自动全屏', expect: '1 次',
    before: w => { w.__vw = 932; w.__vh = 430; },
    run: async (w, v) => { await sleep(1500); return w.__fsCalls + ' 次'; } },
  { group: '横屏全屏', name: '视频没加载好就转横屏，加载好后自动全屏', expect: '1 次', run: async (w, v) => {
      v.__notReady = true; await sleep(200); A.landscape(w); await sleep(900);
      v.__notReady = false; await sleep(1800); return w.__fsCalls + ' 次'; } },
  { group: '横屏全屏', name: '直播（时长无限）转横屏自动全屏', expect: '1 次', run: async (w, v) => {
      v.__dur = Infinity; await sleep(200); A.landscape(w); await sleep(1200); return w.__fsCalls + ' 次'; } },
  { group: '横屏全屏', name: '手动退出后转回竖屏再横屏，重新全屏', expect: '2 次', run: async (w, v) => {
      await sleep(200); A.landscape(w); await sleep(800);
      A.exitFS(w, v); await sleep(1000); A.portrait(w); await sleep(600); A.landscape(w); await sleep(1200);
      return w.__fsCalls + ' 次'; } },
  { group: '画中画', name: '横屏全屏 → 画中画 → 回到页面，自动回到全屏', expect: '2 次', run: async (w, v) => {
      await sleep(200); A.landscape(w); await sleep(800);
      A.toPiP(w, v, true); await sleep(1000); A.pipBackInline(w, v); await sleep(3200);
      return w.__fsCalls + ' 次'; } },
  { group: '画中画', name: '同上，但系统没发 endfullscreen 事件', expect: '2 次', run: async (w, v) => {
      await sleep(200); A.landscape(w); await sleep(800);
      A.toPiP(w, v, false); await sleep(1000); A.pipBackInline(w, v); await sleep(3200);
      return w.__fsCalls + ' 次'; } },
  { group: '画中画', name: '全屏最小化进入画中画时，YouTube 调用 pause()', expect: '播放', run: async (w, v) => {
      await sleep(200); A.landscape(w); await sleep(800);
      A.blur(w); A.toPiP(w, v, true); await sleep(50);
      w.HTMLMediaElement.prototype.pause.call(v); await sleep(300); A.hide(w); await sleep(1500); return state(v); } },
  { group: '画中画', name: '切换到画中画时，系统先暂停再切换', expect: '播放', run: async (w, v) => {
      await sleep(200); A.landscape(w); await sleep(800);
      A.blur(w); A.sysPause(w, v); await sleep(50); A.toPiP(w, v, true); await sleep(1500); return state(v); } },
  { group: '画中画', name: '切换到画中画后，系统立刻暂停', expect: '播放', run: async (w, v) => {
      await sleep(200); A.landscape(w); await sleep(800);
      A.blur(w); A.toPiP(w, v, true); await sleep(100); A.sysPause(w, v); await sleep(1500); return state(v); } },
  { group: '画中画', name: '画中画里网页 JS 想切回内联', expect: '画中画', run: async (w, v) => {
      A.toPiP(w, v, false); await sleep(300);
      w.HTMLVideoElement.prototype.webkitSetPresentationMode.call(v, 'inline'); await sleep(300);
      return v.webkitPresentationMode === 'picture-in-picture' ? '画中画' : v.webkitPresentationMode; } },
  { group: '画中画', name: '画中画里网页 JS 调用 webkitEnterFullscreen', expect: '画中画', run: async (w, v) => {
      A.toPiP(w, v, false); await sleep(300);
      w.HTMLVideoElement.prototype.webkitEnterFullscreen.call(v); await sleep(300);
      return v.webkitPresentationMode === 'picture-in-picture' ? '画中画' : v.webkitPresentationMode; } },
  { group: '画中画', name: '刚进画中画就在锁屏点暂停', expect: '暂停', run: async (w, v) => {
      A.toPiP(w, v, false); A.lock(w); await sleep(300);
      w.__handlers.pause && w.__handlers.pause(); await sleep(1500); return state(v); } },
  { group: '画中画', name: '去掉 YouTube 加的 disablepictureinpicture', expect: '已移除', run: async (w, v) => {
      v.setAttribute('disablepictureinpicture', ''); await sleep(1000);
      return v.hasAttribute('disablepictureinpicture') ? '仍存在' : '已移除'; } },
  { group: '被打断', name: '后台播放时听微信语音：期间不抢声音', expect: '暂停，抢 0 次', run: async (w, v) => {
      A.lock(w); await sleep(2000);
      const r = await interruptFor(w, v, 3000);
      return (r.paused ? '暂停' : '播放') + '，抢 ' + r.grabbed + ' 次'; } },
  { group: '被打断', name: '微信语音结束后自动继续播放', expect: '播放', run: async (w, v) => {
      A.lock(w); await sleep(2000); await interruptFor(w, v, 1500);
      setAudio(w, 'running'); await sleep(2000); return state(v); } },
  { group: '被打断', name: '画中画时听微信语音：期间不抢，结束后继续', expect: '暂停→播放', run: async (w, v) => {
      A.toPiP(w, v, false); A.lock(w); await sleep(2500);
      const r = await interruptFor(w, v, 2000);
      setAudio(w, 'running'); await sleep(2000);
      return (r.paused && r.grabbed === 0 ? '暂停' : '抢了') + '→' + state(v); } },
  { group: '被打断', name: '前台看视频时来电：通话中暂停，挂断后继续', expect: '暂停→播放', run: async (w, v) => {
      const r = await interruptFor(w, v, 2000);
      setAudio(w, 'running'); await sleep(2000);
      return (r.paused ? '暂停' : '播放') + '→' + state(v); } },
  { group: '被打断', name: '后台来电，挂断后回到 App（没收到结束信号）', expect: '暂停→播放', run: async (w, v) => {
      A.lock(w); await sleep(2000);
      const r = await interruptFor(w, v, 2000);
      w.__fakeHidden = false; w.document.dispatchEvent(new w.Event('visibilitychange')); await sleep(2000);
      return (r.paused ? '暂停' : '播放') + '→' + state(v); } },
  { group: '被打断', name: '连续听两条微信语音（中间页面被系统唤醒）', expect: '暂停，抢 0 次→播放', run: async (w, v) => {
      A.lock(w); await sleep(2000);
      await interruptFor(w, v, 1000); setAudio(w, 'running'); await sleep(1500);   // 第一条
      // 视频恢复播放时，系统唤醒后台页面：发出 resume / focus，但页面仍在后台
      w.document.dispatchEvent(new w.Event('resume')); w.dispatchEvent(new w.FocusEvent('focus')); await sleep(300);
      const r = await interruptFor(w, v, 2000);                                     // 第二条
      setAudio(w, 'running'); await sleep(2000);
      return (r.paused ? '暂停' : '播放') + '，抢 ' + r.grabbed + ' 次→' + state(v); } },
  { group: '被打断', name: '连续听两条微信语音（画中画）', expect: '暂停，抢 0 次→播放', run: async (w, v) => {
      A.toPiP(w, v, false); A.lock(w); await sleep(2500);
      await interruptFor(w, v, 1000); setAudio(w, 'running'); await sleep(1500);
      w.document.dispatchEvent(new w.Event('resume')); w.dispatchEvent(new w.FocusEvent('focus')); await sleep(2500);
      const r = await interruptFor(w, v, 2000);
      setAudio(w, 'running'); await sleep(2000);
      return (r.paused ? '暂停' : '播放') + '，抢 ' + r.grabbed + ' 次→' + state(v); } },
  { group: '被打断', name: '微信语音期间 YouTube 自己调用 play()', expect: '暂停→播放', run: async (w, v) => {
      A.lock(w); await sleep(2000);
      A.sysPause(w, v); await sleep(100); setAudio(w, 'interrupted'); await sleep(300);
      w.HTMLMediaElement.prototype.play.call(v); await sleep(800);     // YouTube 播放器自己恢复
      const mid = state(v);
      setAudio(w, 'running'); await sleep(2000);
      return mid + '→' + state(v); } },
  { group: '被打断', name: '读不到页面隐藏状态时，微信语音期间不抢', expect: '暂停，抢 0 次', run: async (w, v) => {
      A.blur(w); await sleep(2000);                                   // 只有 blur，没有 hidden
      const r = await interruptFor(w, v, 2500);
      return (r.paused ? '暂停' : '播放') + '，抢 ' + r.grabbed + ' 次'; } },
  { group: '被打断', name: '后台拔耳机（没有打断信号）：保持暂停', expect: '暂停', run: async (w, v) => {
      A.lock(w); await sleep(2000); A.sysPause(w, v); await sleep(2500); return state(v); } },
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
    const { w, v, errors } = await makePage(code, s.url, s.before);
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
