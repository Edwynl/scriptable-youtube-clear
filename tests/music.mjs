// YouTube Music 脚本对比测试：在 jsdom 里模拟 iOS / WebKit 行为
//
// 用法：
//   node music.mjs                                  测试 ../music/YouTubeMusicClear.js
//   node music.mjs a.js b.js                        对比多个版本
//
// 按真机日志的发现：Scriptable 里后台时页面读不到隐藏状态（hidden 一直是 false），
// 只能靠 blur 事件判断切后台，所以这里的“锁屏 / 切后台”都只发 blur。
import { JSDOM } from 'jsdom';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractInjected, checkOuterSyntax } from './extract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = process.argv.slice(2).length
  ? process.argv.slice(2).map(f => path.resolve(f))
  : [path.join(here, '..', 'music', 'YouTubeMusicClear.js')];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function makePage(code) {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><ytmusic-app><ytmusic-app-layout>' +
    '<div id="movie_player" class="html5-video-player"><video></video></div>' +
    '<ytmusic-player-bar><tp-yt-paper-icon-button class="next-button" aria-label="Next"></tp-yt-paper-icon-button>' +
    '<tp-yt-paper-icon-button class="previous-button" aria-label="Previous"></tp-yt-paper-icon-button></ytmusic-player-bar>' +
    '<ytmusic-search-box><input id="search"></ytmusic-search-box>' +
    '<a id="browse-link" href="/browse/UC123">频道</a>' +
    '</ytmusic-app-layout></ytmusic-app></body></html>',
    { url: 'https://music.youtube.com/', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const w = dom.window;
  w.eval(`
    window.__fakeHidden = false;
    Object.defineProperty(Document.prototype, 'hidden', { get(){ return window.__fakeHidden; }, configurable: true });
    // jsdom 里所有元素的尺寸都是 0，这里给个非零尺寸，“是否可见”的判断才能工作
    Element.prototype.getBoundingClientRect = function () { return { width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }; };

    var P = HTMLMediaElement.prototype;
    Object.defineProperty(P, 'paused',       { get(){ return this.__p !== false; }, configurable: true });
    Object.defineProperty(P, 'ended',        { get(){ return false; }, configurable: true });
    Object.defineProperty(P, 'readyState',   { get(){ return 4; }, configurable: true });
    Object.defineProperty(P, 'duration',     { get(){ return this.__dur !== undefined ? this.__dur : 200; }, configurable: true });
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
    window.__sysPause = P.pause;   // 系统造成的暂停：不经过网页 JS
    window.__sysPlay = P.play;     // 系统自动恢复 / 系统控件的播放
    window.__origPlay = P.play;
    window.__origAdd = EventTarget.prototype.addEventListener;

    window.__ctxs = [];
    window.AudioContext = function () {
      var et = new EventTarget();
      et.state = 'suspended'; et.destination = {}; et.__resumeCalls = 0;
      et.resume = function () {
        et.__resumeCalls++;
        if (window.__blockResume) {   // 后台时音频会话激活失败：iOS 会把它标成 interrupted
          if (et.state !== 'interrupted') { et.state = 'interrupted'; et.dispatchEvent(new Event('statechange')); }
        } else if (et.state !== 'running') { et.state = 'running'; et.dispatchEvent(new Event('statechange')); }
        return Promise.resolve();
      };
      et.suspend = function () { if (et.state !== 'interrupted') et.state = 'suspended'; return Promise.resolve(); };
      et.close = function () { return Promise.resolve(); };
      et.createGain = function () { return { gain: { value: 1 }, connect(){}, disconnect(){} }; };
      et.createOscillator = function () { return { frequency: { value: 0 }, connect(){}, disconnect(){}, start(){}, stop(){} }; };
      window.__ctxs.push(et);
      return et;
    };
    // 模拟 iOS 的 navigator.audioSession：被别的 App 打断时 state 为 interrupted
    navigator.audioSession = (function () { var et = new EventTarget(); et.type = 'auto'; et.state = 'active'; return et; })();
    window.__handlers = {};
    navigator.mediaSession = { setActionHandler(n, f){ window.__handlers[n] = f; }, setPositionState(){}, playbackState: 'none' };

    document.elementFromPoint = function () { return null; };   // jsdom 没有这个函数
    window.__qsa = 0;
    var qsa = Document.prototype.querySelectorAll, qs = Document.prototype.querySelector;
    Document.prototype.querySelectorAll = function () { window.__qsa++; return qsa.apply(this, arguments); };
    Document.prototype.querySelector = function () { window.__qsa++; return qs.apply(this, arguments); };
  `);
  const errors = [];
  w.addEventListener('error', e => errors.push(e.message));
  w.eval(code);
  return { w, v: w.document.querySelector('video'), errors };
}

const A = {
  touch:    w => w.document.dispatchEvent(new w.Event('touchstart')),
  blur:     w => w.dispatchEvent(new w.FocusEvent('blur')),
  focus:    w => w.dispatchEvent(new w.FocusEvent('focus')),
  sysPause: (w, v) => w.__sysPause.call(v),
  sysPlay:  (w, v) => w.__sysPlay.call(v),
  pagePlay: (w, v) => w.HTMLMediaElement.prototype.play.call(v),
  pagePause:(w, v) => w.HTMLMediaElement.prototype.pause.call(v),
};
const st = v => (v.paused ? '暂停' : '播放');
const ctxOf = w => w.__ctxs[w.__ctxs.length - 1];
const ctxOn = w => { const c = ctxOf(w); return c && c.state === 'running'; };
const setAudio = (w, s) => { const c = ctxOf(w); if (!c) return; c.state = s; c.dispatchEvent(new w.Event('statechange')); };
async function interruptFor(w, v, ms, withCtx) {
  A.sysPause(w, v); await sleep(100);
  if (withCtx) setAudio(w, 'interrupted');
  const c = ctxOf(w); const r0 = c ? c.__resumeCalls : 0; const p0 = w.__plays;
  await sleep(ms);
  return { grabbed: (c ? c.__resumeCalls - r0 : 0) + (w.__plays - p0), paused: v.paused };
}
const setSession = (w, s) => { w.navigator.audioSession.state = s; w.navigator.audioSession.dispatchEvent(new w.Event('statechange')); };
const grabText = r => (r.paused ? '暂停' : '播放') + '，抢 ' + r.grabbed + ' 次';

const SCENARIOS = [
  { name: '播放器上点暂停，之后切到后台', expect: '暂停', run: async (w, v) => {
      A.touch(w); A.pagePause(w, v); await sleep(1500); A.blur(w); await sleep(2500); return st(v); } },
  { name: '切后台：先 blur，再被系统暂停', expect: '播放', run: async (w, v) => {
      A.blur(w); await sleep(50); A.sysPause(w, v); await sleep(1500); return st(v); } },
  { name: '切后台：系统暂停先到，50ms 后才 blur', expect: '播放', run: async (w, v) => {
      A.sysPause(w, v); await sleep(50); A.blur(w); await sleep(1500); return st(v); } },
  { name: '后台时 YT Music 自己调用 pause()', expect: '播放', run: async (w, v) => {
      A.blur(w); await sleep(2000); A.pagePause(w, v); await sleep(1500); return st(v); } },
  { name: '前台拔耳机', expect: '暂停', run: async (w, v) => {
      A.sysPause(w, v); await sleep(2000); return st(v); } },
  { name: '前台拔耳机，2 秒后锁屏', expect: '暂停', run: async (w, v) => {
      A.sysPause(w, v); await sleep(2000); A.blur(w); await sleep(2500); return st(v); } },
  { name: '搜索框失焦后，前台拔耳机', expect: '暂停', run: async (w, v) => {
      const s = w.document.getElementById('search');
      s.dispatchEvent(new w.FocusEvent('focus')); s.dispatchEvent(new w.FocusEvent('blur'));
      await sleep(100); A.sysPause(w, v); await sleep(2000); return st(v); } },
  { name: '后台拔耳机（没有打断信号）', expect: '暂停', run: async (w, v) => {
      A.blur(w); await sleep(2500); A.sysPause(w, v); await sleep(2500); return st(v); } },

  { name: '后台听微信语音：期间不抢声音', expect: '暂停，抢 0 次', run: async (w, v) => {
      A.blur(w); await sleep(2500); return grabText(await interruptFor(w, v, 3000, false)); } },
  { name: '微信语音期间保活音频停掉', expect: '已停', run: async (w, v) => {
      A.blur(w); await sleep(2500); await interruptFor(w, v, 2000, false); return ctxOn(w) ? '运行中' : '已停'; } },
  { name: '微信语音期间 YT Music 自己 play()', expect: '暂停', run: async (w, v) => {
      A.blur(w); await sleep(2500); A.sysPause(w, v); await sleep(900); A.pagePlay(w, v); await sleep(1000); return st(v); } },
  { name: '连续两条微信语音（第一条结束系统自动恢复）', expect: '暂停，抢 0 次', run: async (w, v) => {
      A.blur(w); await sleep(6000);                       // 已在后台一阵子
      await interruptFor(w, v, 1500, false); A.sysPlay(w, v); await sleep(2500);   // 第一条
      return grabText(await interruptFor(w, v, 3000, false)); } },                    // 第二条
  { name: '后台稳定播放时不占用音频会话', expect: '已停', run: async (w, v) => {
      A.blur(w); await sleep(7500); return ctxOn(w) ? '运行中' : '已停'; } },
  { name: '后台切歌间隙启动保活音频', expect: '运行中', run: async (w, v) => {
      A.blur(w); await sleep(7500); v.dispatchEvent(new w.Event('waiting')); await sleep(300); return ctxOn(w) ? '运行中' : '已停'; } },
  { name: '前台来电：通话中暂停，挂断后继续', expect: '暂停→播放', run: async (w, v) => {
      const r = await interruptFor(w, v, 2000, true); setAudio(w, 'running'); await sleep(2000);
      return (r.paused ? '暂停' : '播放') + '→' + st(v); } },
  { name: '后台一首歌播完，自动播下一首', expect: '播放', run: async (w, v) => {
      A.blur(w); await sleep(2500);
      v.__t = 199.5; A.sysPause(w, v); await sleep(100);
      v.dispatchEvent(new w.Event('loadstart')); v.__t = 0; await sleep(100); A.pagePlay(w, v); await sleep(1500); return st(v); } },

  { name: '微信语音结束（音频会话交还）后自动继续播放', expect: '暂停→播放', run: async (w, v) => {
      A.blur(w); await sleep(6000);
      A.sysPause(w, v); await sleep(50); setSession(w, 'interrupted');   // 打断期间一直是 interrupted
      await sleep(5000); const mid = st(v);
      setSession(w, 'inactive'); await sleep(2000);                        // 语音放完，交还声音（规范：结束后变 inactive）
      return mid + '→' + st(v); } },
  { name: '来电挂断恢复后，YT Music 立刻自己 pause() 不会再停掉', expect: '播放', run: async (w, v) => {
      await interruptFor(w, v, 1500, true); setAudio(w, 'running'); await sleep(300);
      A.pagePause(w, v); await sleep(1500); return st(v); } },
  { name: '打断期间记录心跳日志（判断 App 是否被挂起）', expect: '有', run: async (w, v) => {
      A.blur(w); await sleep(2500); A.sysPause(w, v); await sleep(4800);
      const logs = (w.__ytClearScriptableMusic && w.__ytClearScriptableMusic.logs) || [];
      return logs.some(l => l.indexOf('still interrupted') >= 0) ? '有' : '无'; } },
  { name: '真机日志复现：切后台时保活音频被标 interrupted，不当成被打断', expect: '播放，未误判', run: async (w, v) => {
      A.blur(w); w.__fakeHidden = true; w.document.dispatchEvent(new w.Event('visibilitychange'));
      setAudio(w, 'interrupted');                                   // 切后台那一刻（音乐还在放）
      await sleep(6000);
      A.sysPause(w, v); await sleep(3000);                          // 微信语音
      A.sysPlay(w, v); await sleep(20); setAudio(w, 'interrupted'); // 语音结束，系统恢复；随即又被标 interrupted
      await sleep(1500);
      const s = w.__ytClearScriptableMusic.state;
      return st(v) + '，' + (s.interrupted ? '误判为打断' : '未误判'); } },
  { name: '真机日志复现：系统恢复后再听第二条语音，结束后仍自动继续', expect: '暂停，抢 0 次→播放', run: async (w, v) => {
      A.blur(w); w.__fakeHidden = true; w.document.dispatchEvent(new w.Event('visibilitychange'));
      setAudio(w, 'interrupted'); await sleep(6000);
      A.sysPause(w, v); await sleep(2500); A.sysPlay(w, v); await sleep(20); setAudio(w, 'interrupted'); await sleep(2000);
      const r = await interruptFor(w, v, 2500, false);             // 第二条语音
      A.sysPlay(w, v); await sleep(1500);                           // 系统恢复
      return grabText(r) + '→' + st(v); } },
  { name: '前台来电：先报 audio interrupted 再暂停，挂断后继续', expect: '暂停→播放', run: async (w, v) => {
      setAudio(w, 'interrupted'); await sleep(50); A.sysPause(w, v); await sleep(2000);
      const mid = st(v); setAudio(w, 'running'); await sleep(2000); return mid + '→' + st(v); } },
  { name: '点播放页里的按钮（喜欢 / 暂停）不会被补点第二次', expect: '1 次', run: async (w, v) => {
      const page = w.document.createElement('ytmusic-player-page');
      page.innerHTML = '<ytmusic-like-button-renderer><button aria-label="Like">👍</button></ytmusic-like-button-renderer>';
      w.document.body.appendChild(page);
      const b = page.querySelector('button'); let n = 0; b.addEventListener('click', () => n++);
      b.dispatchEvent(new w.Event('touchend', { bubbles: true })); b.click(); await sleep(1000); return n + ' 次'; } },
  { name: '列表里的歌曲卡片点了没反应时，补点一次', expect: '补点 1 次', run: async (w, v) => {
      const item = w.document.createElement('ytmusic-two-row-item-renderer');
      item.innerHTML = '<a class="thumb" href="/playlist?list=PL1"></a><div class="title">歌单</div>';
      w.document.body.appendChild(item);
      let n = 0; item.querySelector('a').addEventListener('click', e => { n++; e.preventDefault(); });
      item.querySelector('.title').dispatchEvent(new w.Event('touchend', { bubbles: true })); await sleep(1000);
      return '补点 ' + n + ' 次'; } },
  { name: '真机日志复现：语音放完系统恢复播放但没声音，几秒后接回声音', expect: '无声→有声', run: async (w, v) => {
      A.blur(w); w.__fakeHidden = true; w.document.dispatchEvent(new w.Event('visibilitychange'));
      await sleep(6000);
      A.sysPause(w, v); await sleep(2500);                         // 微信语音
      w.__blockResume = true;                                       // 微信还占着音频会话：后台激活失败
      A.sysPlay(w, v); await sleep(3000);                           // 系统恢复成“播放中”，但无声
      const mid = ctxOn(w) ? '有声' : '无声';
      w.__blockResume = false; await sleep(2500);                   // 微信释放会话
      // 接回后保活音频会按规则关掉（音乐自己占着会话），所以看“接回声音”的记录 + 音乐仍在播
      const restored = (w.__ytClearScriptableMusic.logs || []).some(l => l.indexOf('audio restored') >= 0);
      return mid + '→' + (restored && !v.paused ? '有声' : '无声'); } },
  { name: '点列表里的歌曲链接，不会再被补点一次', expect: '1 次', run: async (w, v) => {
      const item = w.document.createElement('ytmusic-responsive-list-item-renderer');
      item.innerHTML = '<a href="/watch?v=abc"><span class="t">歌</span></a>';
      w.document.body.appendChild(item);
      let n = 0; item.querySelector('a').addEventListener('click', e => { n++; e.preventDefault(); });
      const t = item.querySelector('.t');
      t.dispatchEvent(new w.Event('touchend', { bubbles: true }));
      t.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(1200); return n + ' 次'; } },
  { name: '锁屏“下一首”只切一首', expect: '1 次', run: async (w, v) => {
      let n = 0; w.document.querySelector('.next-button').addEventListener('click', () => n++);
      await sleep(300); w.__handlers.nexttrack && w.__handlers.nexttrack(); await sleep(300); return n + ' 次'; } },
  { name: '暂停时点开频道页，音乐不会自己响起来', expect: '暂停', run: async (w, v) => {
      A.touch(w); A.pagePause(w, v); await sleep(1500);
      w.document.getElementById('browse-link').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(3500); return st(v); } },
  { name: '广告后恢复 1.25 倍速和静音', expect: '1.25x 静音', run: async (w, v) => {
      v.playbackRate = 1.25; v.muted = true; await sleep(900);
      const p = w.document.getElementById('movie_player');
      p.classList.add('ad-showing'); await sleep(900); p.classList.remove('ad-showing'); await sleep(1500);
      return v.playbackRate + 'x ' + (v.muted ? '静音' : '有声'); } },
  { name: '只有残留的广告容器时，不快进正常歌曲', expect: '正常', run: async (w, v) => {
      v.__dur = 60; v.__t = 10; await sleep(300);
      const r = w.document.createElement('ytmusic-ad-instream-ads-renderer');
      r.appendChild(w.document.createElement('div')); w.document.body.appendChild(r);
      await sleep(1500);
      return (v.playbackRate === 1 && !v.muted && v.currentTime === 10) ? '正常' : ('被改了 ' + v.playbackRate + 'x ' + (v.muted ? '静音' : '') + ' 进度' + v.currentTime); } },
  { name: '“还在听吗？”弹窗自动点掉并继续播放', expect: '已点，播放', run: async (w, v) => {
      await sleep(300);
      const d = w.document.createElement('ytmusic-you-there-renderer');
      d.innerHTML = '<div>Are you still there? Music paused.</div><button>Yes</button>';
      let clicked = 0; d.querySelector('button').addEventListener('click', () => { clicked++; A.sysPlay(w, v); });
      w.document.body.appendChild(d);
      A.pagePause(w, v);                                   // YT Music 弹窗时自己暂停
      await sleep(2500); return (clicked ? '已点' : '未点') + '，' + st(v); } },
  { name: '页面频繁变化时的负载（2 秒内 DOM 查询次数）', expect: '正常', run: async (w, v) => {
      await sleep(500); const q0 = w.__qsa;
      const iv = setInterval(() => w.document.body.appendChild(w.document.createElement('span')), 16);
      await sleep(2000); clearInterval(iv);
      const n = w.__qsa - q0; return n < 600 ? '正常' : ('过高 ' + n + ' 次'); } },
  { name: '三根手指点屏幕打开调试面板', expect: '已打开', run: async (w, v) => {
      await sleep(300);
      const ev = new w.Event('touchstart', { bubbles: true });
      Object.defineProperty(ev, 'touches', { value: [{}, {}, {}] });
      w.document.body.dispatchEvent(ev); await sleep(200);
      return w.document.getElementById('ytm-debug-overlay') ? '已打开' : '未打开'; } },
  { name: 'destroy() 还原所有补丁', expect: '已还原', run: async (w, v) => {
      await sleep(200); w.__ytClearScriptableMusic.destroy();
      return (w.HTMLMediaElement.prototype.play === w.__origPlay && w.EventTarget.prototype.addEventListener === w.__origAdd &&
        !Object.prototype.hasOwnProperty.call(w.document, 'hidden')) ? '已还原' : '未还原'; } },
];

// 调试：ONLY=关键字 只跑名字包含关键字的场景；DEBUG=1 打印每个场景最后 30 行脚本日志
const ACTIVE = process.env.ONLY ? SCENARIOS.filter(x => x.name.indexOf(process.env.ONLY) >= 0) : SCENARIOS;

async function runFile(file) {
  checkOuterSyntax(file);
  const code = extractInjected(file);
  new Function(code);
  return Promise.all(ACTIVE.map(async s => {
    const { w, v, errors } = await makePage(code);
    w.dispatchEvent(new w.Event('load'));   // 真机上 load 在注入前就已触发；这里提前发，并等过渡期结束
    v.play();
    await sleep(1800);
    let got;
    try { got = await s.run(w, v); } catch (e) { got = '出错 ' + e.message; }
    if (errors.length) got += '（报错）';
    if (process.env.DEBUG && w.__ytClearScriptableMusic) console.log('--- ' + s.name + '\n' + w.__ytClearScriptableMusic.logs.slice(-30).join('\n'));
    try { w.__ytClearScriptableMusic && w.__ytClearScriptableMusic.destroy(); } catch (e) {}
    w.close();
    return got;
  }));
}

const results = [];
for (const f of files) results.push(await runFile(f));
const names = files.map(f => path.basename(f, '.js'));
console.log('| 场景 | 期望 | ' + names.join(' | ') + ' |');
console.log('|' + ['', '', ...names].map(() => '---').join('|') + '|');
ACTIVE.forEach((s, i) => console.log('| ' + [s.name, s.expect, ...results.map(r => (r[i] === s.expect ? '✅ ' : '❌ ') + r[i])].join(' | ') + ' |'));
console.log('');
results.forEach((r, i) => console.log(`${names[i]}: ${r.filter((x, j) => x === ACTIVE[j].expect).length}/${ACTIVE.length} 通过`));
const last = results[results.length - 1];
process.exit(last.every((x, j) => x === ACTIVE[j].expect) ? 0 : 1);
