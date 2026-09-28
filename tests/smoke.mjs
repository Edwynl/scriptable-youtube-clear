// 冒烟测试：保活音频、搜索弹窗、重复注入（用法：node smoke.mjs [脚本路径]）
import { JSDOM } from 'jsdom';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractInjected } from './extract.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const code = extractInjected(process.argv[2] || path.join(here, '..', 'YouTubeClear.js'));
const dom = new JSDOM('<!doctype html><html><head></head><body><ytm-app><div id="movie_player"><video></video></div></ytm-app></body></html>',
  { url: 'https://m.youtube.com/watch?v=x', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.eval(`
  var P = HTMLMediaElement.prototype;
  Object.defineProperty(P,'paused',{get(){return this.__p!==false},configurable:true});
  P.play=function(){var was=this.paused;this.__p=false;if(was){this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));}return Promise.resolve();};
  P.pause=function(){var was=!this.paused;this.__p=true;if(was)this.dispatchEvent(new Event('pause'));};
  navigator.mediaSession={setActionHandler(){},playbackState:'none'};
  window.__osc=0;
  window.AudioContext=function(){this.state='suspended';this.destination={};};
  AudioContext.prototype.resume=function(){this.state='running';return Promise.resolve();};
  AudioContext.prototype.suspend=function(){this.state='suspended';return Promise.resolve();};
  AudioContext.prototype.close=function(){return Promise.resolve();};
  AudioContext.prototype.createGain=function(){return{gain:{value:1},connect(){},disconnect(){}}};
  AudioContext.prototype.createOscillator=function(){window.__osc++;return{frequency:{value:0},connect(){},disconnect(){},start(){},stop(){}}};
`);
const errs=[]; w.addEventListener('error',e=>errs.push(e.message));
w.eval(code);
const S = () => w.__ytClearScriptableTube.state;
const v = w.document.querySelector('video');
const results=[]; const ok=(n,c)=>{results.push(!!c); console.log((c?'✅ ':'❌ ')+n);};

// keep-alive
w.HTMLMediaElement.prototype.play.call(v); await sleep(200);
ok('播放时启动保活音频', !!S().keepAliveOsc);
w.document.dispatchEvent(new w.Event('touchstart')); w.HTMLMediaElement.prototype.pause.call(v); await sleep(200);
ok('刚暂停时保活仍在（可从锁屏直接继续）', !!S().keepAliveOsc);
S().userPausedAt = Date.now() - 11*60*1000; await sleep(1000);
ok('暂停超过 10 分钟后停止保活', !S().keepAliveOsc && S().audioCtx.state==='suspended');
w.document.dispatchEvent(new w.Event('touchstart')); await sleep(100);
ok('暂停中随便点屏幕不会重启保活', !S().keepAliveOsc);
w.HTMLMediaElement.prototype.play.call(v); await sleep(200);
ok('再次播放时重启保活', !!S().keepAliveOsc);

// UI + search
const btns = w.document.querySelectorAll('#yt-panel .yt-pb');
ok('侧边面板 3 个按钮且带 aria-label', btns.length===3 && [...btns].every(b=>b.getAttribute('aria-label')));
btns[0].dispatchEvent(new w.Event('touchend',{cancelable:true})); await sleep(200);
const modal = w.document.getElementById('yt-search-modal');
const inp = modal && modal.querySelector('input');
ok('点搜索打开弹窗，输入框关闭自动大写', !!modal && inp.getAttribute('autocapitalize')==='none' && inp.spellcheck===false);
inp.value='lofi'; inp.dispatchEvent(new w.Event('input')); await sleep(300);
ok('输入后发出建议请求', !!w.document.querySelector('script[data-yt-clear-suggest]'));
inp.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'})); await sleep(50);
ok('Esc 关闭弹窗', !w.document.getElementById('yt-search-modal'));

// re-inject
w.eval(code.replace(/var VERSION = '[^']+'/, "var VERSION = 'reinject-test'")); await sleep(300);
ok('重复注入新版本：旧实例被清理，面板仍只有一个', w.__ytClearScriptableTube.version==='reinject-test' && w.document.querySelectorAll('#yt-panel').length===1);
w.HTMLMediaElement.prototype.pause.call(v); // no gesture, fg
ok('重复注入后原型只包一层', w.HTMLMediaElement.prototype.play.toString().includes('clearUserPaused'));
ok('全程无 JS 报错', errs.length===0);
process.exit(results.every(Boolean) && errs.length === 0 ? 0 : 1);
