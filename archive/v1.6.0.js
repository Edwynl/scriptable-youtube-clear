// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: play-circle;

const VERSION = '1.6.0-scriptable';

if (!config.runsInApp) {
  const alert = new Alert();
  alert.title = '需要在 Scriptable App 内运行';
  alert.message = [
    '这个脚本要先配置 WebView 再注入增强代码。',
    '',
    '请在快捷指令的 Scriptable 动作里打开 Run In App / 在 App 中运行，然后再添加到桌面。',
    '',
    '不要使用普通的 Run Scriptable Script 扩展模式，也不要用 WebView.loadURL 的快捷指令小窗。'
  ].join('\n');
  alert.addAction('知道了');
  await alert.presentAlert();
  Script.complete();
} else {

const url = 'https://m.youtube.com';
const webView = new WebView();

await webView.loadURL(url);

const magicScript = `
(function () {
  'use strict';

  var VERSION = '${VERSION}';
  var previous = window.__ytClearScriptableTube;
  if (previous && previous.version === VERSION) return null;
  if (previous && typeof previous.destroy === 'function') {
    try { previous.destroy(); } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════
     基础：原生方法 / 真实可见性 / 监听器登记 / 状态
     ══════════════════════════════════════════════════════════ */

  // 原生方法只保存一次：重复注入时不会层层包装
  var NATIVE = window.__ytClearNatives || (window.__ytClearNatives = {
    play: HTMLMediaElement.prototype.play,
    pause: HTMLMediaElement.prototype.pause,
    addEventListener: EventTarget.prototype.addEventListener
  });

  // 真实的 document.hidden：下面 patchVisibility() 会把它伪装成 false，
  // 所以从原型链上取原始 getter 来读真实值
  var nativeHiddenGetter = (function () {
    var proto = Object.getPrototypeOf(document);
    while (proto) {
      var d = Object.getOwnPropertyDescriptor(proto, 'hidden');
      if (d) return typeof d.get === 'function' ? d.get : null;
      proto = Object.getPrototypeOf(proto);
    }
    return null;
  })();

  function isReallyHidden() {
    try { return nativeHiddenGetter ? !!nativeHiddenGetter.call(document) : false; }
    catch (e) { return false; }
  }

  // 统一登记监听器，destroy() 时全部移除
  var listeners = [];
  function listen(target, type, fn, opts) {
    NATIVE.addEventListener.call(target, type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }

  var BG_PAUSE_GRACE = 1000;               // 前台暂停后这么短时间内进入后台 → 其实是切后台造成的
  var KEEPALIVE_IDLE_STOP = 10 * 60 * 1000; // 用户暂停超过 10 分钟 → 停掉保活音频省电
  var AD_SKIP_SEL = '.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-container button';

  var state = {
    loopTimer: null,

    audioCtx: null,
    keepAliveOsc: null,
    keepAliveGain: null,
    silenceTimer: null,

    video: null,
    player: null,
    patchedPlayers: [],

    inAd: false,
    skipCooldownUntil: 0,
    lastContentRate: 1,        // 正片（非广告）时最近的倍速 / 静音，广告结束后恢复
    lastContentMuted: false,

    burstUntil: 0,
    mediaSessionBound: false,
    lastMediaSessionRefresh: 0,

    shouldResume: false,       // 希望保持播放
    userPaused: false,         // 已被认定为用户（或前台系统）暂停，不自动恢复
    userPausedAt: 0,
    fgPauseAt: 0,              // 最近一次“前台非手势暂停”的时间，用于撤销
    fgPauseNative: false,

    recentGestureUntil: 0,
    allowPauseUntil: 0,
    transitionUntil: 0,
    realBackgrounded: false,
    nativeFullscreen: false,
    pendingUnmute: false,

    lastHD: 0,
    lastStillCheck: 0,
    lastLandscape: window.innerWidth > window.innerHeight,

    debugTaps: [],
    logs: []
  };

  function log(message) {
    try {
      var t = new Date();
      state.logs.push(t.toTimeString().slice(0, 8) + '.' + ('00' + t.getMilliseconds()).slice(-3) + ' ' + message);
      if (state.logs.length > 300) state.logs.splice(0, 100);
    } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════
     国际化 / CSS / 图标
     ══════════════════════════════════════════════════════════ */

  var lang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  var isCN = lang.indexOf('zh') === 0;
  var I18N = {
    title:       isCN ? '搜索 YouTube'    : 'Search YouTube',
    placeholder: isCN ? '输入搜索内容...' : 'Search...',
    cancel:      isCN ? '取消'            : 'Cancel',
    search:      isCN ? '搜索'            : 'Search',
    recent:      isCN ? '最近搜索'        : 'Recent',
    clearAll:    isCN ? '清除'            : 'Clear',
    back:        isCN ? '返回'            : 'Back',
    home:        isCN ? '首页'            : 'Home'
  };

  var CSS = [
    '.ytp-ad-overlay-container,.ytp-ad-text-overlay,.ytp-ad-overlay-slot,',
    '.ytp-ad-overlay-close-container,.ytp-ad-player-overlay,',
    '.ytp-ad-module,.video-ads.ytp-iv-player-content,#player-ads,',
    '#masthead-ad,ytm-promoted-video-renderer,ytm-companion-ad-renderer,',
    'ytm-companion-slot,.YtdAdSlotRenderer,ytd-survey-renderer,',
    'ytd-mealbar-promo-renderer{display:none!important;height:0!important;pointer-events:none!important;}',
    'html,body{background:#0f0f0f!important;overflow-x:hidden!important;}',

    '#yt-top-bar{',
      'position:fixed!important;top:0!important;left:0!important;right:0!important;',
      'height:90px!important;background:#0f0f0f!important;',
      'z-index:2147483644!important;pointer-events:none!important;',
    '}',

    'ytm-app{',
      'padding-top:90px!important;box-sizing:border-box!important;background:#0f0f0f!important;',
    '}',

    '#yt-panel{',
      'position:fixed!important;left:0!important;top:50%!important;',
      'transform:translateY(-50%)!important;',
      'display:flex!important;flex-direction:column!important;',
      'z-index:2147483647!important;pointer-events:none!important;',
    '}',

    '.yt-pb{',
      'width:48px!important;height:60px!important;',
      'background:rgba(0,0,0,0.75)!important;color:#fff!important;',
      'display:flex!important;align-items:center!important;justify-content:center!important;',
      'backdrop-filter:blur(12px)!important;-webkit-backdrop-filter:blur(12px)!important;',
      'box-shadow:2px 0 10px rgba(0,0,0,0.5)!important;',
      'user-select:none!important;-webkit-user-select:none!important;',
      '-webkit-tap-highlight-color:transparent!important;',
      'touch-action:manipulation!important;cursor:pointer!important;',
      'pointer-events:auto!important;',
      'border-bottom:1px solid rgba(255,255,255,0.12)!important;',
    '}',
    '.yt-pb:first-child{border-radius:0 12px 0 0!important;}',
    '.yt-pb:last-child{border-radius:0 0 12px 0!important;border-bottom:none!important;}',
    '.yt-pb:active{background:rgba(255,255,255,0.25)!important;}',
    '.yt-pb svg{width:22px!important;height:22px!important;display:block!important;}',

    /* 横屏隐藏顶栏和侧边面板：交给 CSS，不用 JS 反复改样式 */
    '@media (orientation: landscape){',
      '#yt-top-bar,#yt-panel{display:none!important;}',
      'ytm-app{padding-top:0!important;}',
    '}'
  ].join('');

  var SVG = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>',
    back:   '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    home:   '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12L12 3l9 9"/><path d="M9 21V12h6v9"/><path d="M3 12v9h18V12"/></svg>',
    clock:  '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>'
  };

  function ensureStyle() {
    if (document.getElementById('yt-ios-css')) return;
    var s = document.createElement('style');
    s.id = 'yt-ios-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════
     横屏自动全屏：只在“竖屏 → 横屏”那一刻触发一次，且只在播放页
     ══════════════════════════════════════════════════════════ */

  function isWatchPage() {
    return location.pathname.indexOf('/watch') === 0;
  }

  // 视频是否在 iOS 原生全屏 / 画中画里（此时网页收不到触摸事件）
  function inNativePlayer(v) {
    if (state.nativeFullscreen) return true;
    if (!v) return false;
    if (v.webkitDisplayingFullscreen) return true;
    var mode = v.webkitPresentationMode;
    return mode === 'fullscreen' || mode === 'picture-in-picture';
  }

  function tryFullscreen() {
    var v = getVideo();
    if (!v || !isWatchPage()) return;
    if (!(window.innerWidth > window.innerHeight)) return;   // 这段时间里又转回竖屏了
    if (v.readyState < 1 || !Number.isFinite(v.duration) || v.duration <= 0) return;
    if (inNativePlayer(v)) return;

    if (typeof v.webkitEnterFullscreen === 'function') {
      try { v.webkitEnterFullscreen(); } catch (e) { log('fullscreen failed ' + (e && e.name)); }
    } else if (typeof v.requestFullscreen === 'function') {
      try {
        var p = v.requestFullscreen();
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }
  }

  function onOrientationChange() {
    var isLandscape = window.innerWidth > window.innerHeight;
    if (isLandscape === state.lastLandscape) return;
    state.lastLandscape = isLandscape;
    if (isLandscape) setTimeout(tryFullscreen, 200);
  }

  function scheduleOrientationCheck() {
    setTimeout(onOrientationChange, 150);
  }

  /* ══════════════════════════════════════════════════════════
     搜索：历史记录 + 建议（JSONP）+ 弹窗
     ══════════════════════════════════════════════════════════ */

  var HISTORY_KEY = 'yt_search_history';
  var MAX_HISTORY = 8;
  var suggestTimer = null;
  var suggestSeq = 0;

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveHistory(q) {
    try {
      var list = getHistory().filter(function (x) { return x !== q; });
      list.unshift(q);
      if (list.length > MAX_HISTORY) list = list.slice(0, MAX_HISTORY);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch (e) {}
  }
  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
  }

  // 每个请求带序号：晚到的旧结果直接丢弃
  function fetchSuggestions(query, callback) {
    var seq = ++suggestSeq;
    if (!query) { callback([]); return; }

    var cbName = 'ytSugCb_' + seq + '_' + Date.now();
    var sc = document.createElement('script');

    function cleanup() {
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      if (sc.parentNode) sc.parentNode.removeChild(sc);
    }

    window[cbName] = function (data) {
      cleanup();
      if (seq !== suggestSeq) return;
      var list = [];
      if (data && data[1]) {
        for (var i = 0; i < data[1].length && list.length < 6; i++) {
          if (data[1][i] && data[1][i][0]) list.push(data[1][i][0]);
        }
      }
      callback(list);
    };
    sc.onerror = function () {
      cleanup();
      if (seq === suggestSeq) callback([]);
    };
    sc.setAttribute('data-yt-clear-suggest', '1');
    sc.src = 'https://suggestqueries.google.com/complete/search?client=youtube&q=' +
      encodeURIComponent(query) + '&callback=' + cbName;
    (document.head || document.documentElement).appendChild(sc);
  }

  function doSearch() {
    if (document.getElementById('yt-search-modal')) return;

    var overlay = document.createElement('div');
    overlay.id = 'yt-search-modal';
    overlay.style.cssText = [
      'position:fixed!important;top:0!important;left:0!important;',
      'width:100%!important;height:100%!important;',
      'background:rgba(0,0,0,0.65)!important;',
      'z-index:2147483646!important;',
      'display:flex!important;align-items:flex-start!important;justify-content:center!important;',
      'padding-top:80px!important;box-sizing:border-box!important;',
      'backdrop-filter:blur(6px)!important;-webkit-backdrop-filter:blur(6px)!important;'
    ].join('');

    var box = document.createElement('div');
    box.style.cssText = [
      'background:#1e1e1e!important;border-radius:16px!important;',
      'padding:16px!important;width:88%!important;max-width:380px!important;',
      'box-shadow:0 8px 32px rgba(0,0,0,0.9)!important;',
      'display:flex!important;flex-direction:column!important;gap:10px!important;'
    ].join('');

    var titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex!important;align-items:center!important;justify-content:center!important;';
    var title = document.createElement('div');
    title.textContent = I18N.title;
    title.style.cssText = 'color:#fff!important;font-size:15px!important;font-weight:600!important;';
    titleRow.appendChild(title);

    var inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex!important;gap:8px!important;align-items:center!important;';

    var inp = document.createElement('input');
    inp.type = 'search';
    inp.placeholder = I18N.placeholder;
    inp.autocomplete = 'off';
    inp.setAttribute('autocapitalize', 'none');   // 英文搜索不自动大写首字母
    inp.setAttribute('autocorrect', 'off');
    inp.spellcheck = false;
    inp.style.cssText = [
      'flex:1!important;padding:11px 12px!important;border-radius:10px!important;',
      'border:1px solid rgba(255,255,255,0.2)!important;',
      'background:#2c2c2c!important;color:#fff!important;',
      'font-size:16px!important;outline:none!important;box-sizing:border-box!important;'
    ].join('');

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = I18N.cancel;
    cancelBtn.style.cssText = [
      'padding:11px 12px!important;border-radius:10px!important;white-space:nowrap!important;',
      'background:rgba(255,255,255,0.1)!important;color:#fff!important;',
      'border:none!important;font-size:14px!important;cursor:pointer!important;flex-shrink:0!important;'
    ].join('');

    inputRow.appendChild(inp);
    inputRow.appendChild(cancelBtn);

    var listBox = document.createElement('div');
    listBox.style.cssText = [
      'display:none!important;flex-direction:column!important;',
      'background:#2a2a2a!important;border-radius:10px!important;overflow:hidden!important;'
    ].join('');

    var confirmBtn = document.createElement('button');
    confirmBtn.textContent = I18N.search;
    confirmBtn.style.cssText = [
      'width:100%!important;padding:13px!important;border-radius:10px!important;',
      'background:#ff0000!important;color:#fff!important;',
      'border:none!important;font-size:15px!important;font-weight:700!important;cursor:pointer!important;'
    ].join('');

    function closeModal() {
      clearTimeout(suggestTimer);
      suggestSeq++;   // 作废还没返回的建议请求
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    function doNavigate(q) {
      q = (q !== undefined ? q : inp.value).trim();
      if (!q) return;
      saveHistory(q);
      closeModal();
      var path = '/results?search_query=' + encodeURIComponent(q);
      try {
        window.history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
      } catch (e) {
        window.location.href = 'https://m.youtube.com' + path;
      }
    }

    function makeRow(iconSvg, text, onTap) {
      var item = document.createElement('div');
      item.style.cssText = [
        'padding:12px 14px!important;color:#eee!important;font-size:15px!important;',
        'cursor:pointer!important;display:flex!important;align-items:center!important;gap:10px!important;',
        'border-bottom:1px solid rgba(255,255,255,0.07)!important;'
      ].join('');
      var icon = document.createElement('span');
      icon.style.cssText = 'flex-shrink:0!important;width:16px!important;height:16px!important;opacity:0.55!important;display:flex!important;align-items:center!important;';
      icon.innerHTML = iconSvg;
      var label = document.createElement('span');
      label.style.cssText = 'flex:1!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;';
      label.textContent = text;
      item.appendChild(icon);
      item.appendChild(label);
      item.addEventListener('touchend', function (e) { e.preventDefault(); e.stopPropagation(); onTap(text); }, { passive: false });
      return item;
    }

    function renderSuggestions(list) {
      listBox.innerHTML = '';
      if (!list || !list.length) { listBox.style.setProperty('display', 'none', 'important'); return; }
      listBox.style.setProperty('display', 'flex', 'important');
      list.forEach(function (text) { listBox.appendChild(makeRow(SVG.search, text, doNavigate)); });
      if (listBox.lastChild) listBox.lastChild.style.removeProperty('border-bottom');
    }

    function renderHistory() {
      suggestSeq++;   // 显示历史时，丢弃还在路上的建议
      listBox.innerHTML = '';
      var hist = getHistory();
      if (!hist.length) { listBox.style.setProperty('display', 'none', 'important'); return; }
      listBox.style.setProperty('display', 'flex', 'important');

      var hdr = document.createElement('div');
      hdr.style.cssText = [
        'padding:8px 14px!important;display:flex!important;justify-content:space-between!important;',
        'align-items:center!important;border-bottom:1px solid rgba(255,255,255,0.07)!important;'
      ].join('');
      var hdrLabel = document.createElement('span');
      hdrLabel.textContent = I18N.recent;
      hdrLabel.style.cssText = 'color:rgba(255,255,255,0.45)!important;font-size:12px!important;';
      var clearBtn = document.createElement('span');
      clearBtn.textContent = I18N.clearAll;
      clearBtn.style.cssText = 'color:#ff5555!important;font-size:12px!important;cursor:pointer!important;padding:2px 6px!important;';
      clearBtn.addEventListener('touchend', function (e) {
        e.preventDefault(); clearHistory();
        listBox.innerHTML = '';
        listBox.style.setProperty('display', 'none', 'important');
      }, { passive: false });
      hdr.appendChild(hdrLabel);
      hdr.appendChild(clearBtn);
      listBox.appendChild(hdr);

      hist.forEach(function (text) {
        listBox.appendChild(makeRow(SVG.clock, text, function (t) { inp.value = t; doNavigate(t); }));
      });
      if (listBox.lastChild) listBox.lastChild.style.removeProperty('border-bottom');
    }

    inp.addEventListener('input', function () {
      clearTimeout(suggestTimer);
      var q = inp.value.trim();
      if (!q) { renderHistory(); return; }
      suggestTimer = setTimeout(function () { fetchSuggestions(q, renderSuggestions); }, 220);
    });
    inp.addEventListener('focus', function () {
      if (!inp.value.trim()) renderHistory();
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doNavigate(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeModal(); }   // 外接键盘
    });

    cancelBtn.addEventListener('touchend', function (e) { e.preventDefault(); closeModal(); }, { passive: false });
    confirmBtn.addEventListener('touchend', function (e) { e.preventDefault(); doNavigate(); }, { passive: false });
    overlay.addEventListener('touchend', function (e) {
      if (e.target === overlay) { e.preventDefault(); closeModal(); }
    }, { passive: false });

    box.appendChild(titleRow);
    box.appendChild(inputRow);
    box.appendChild(listBox);
    box.appendChild(confirmBtn);
    overlay.appendChild(box);
    document.documentElement.appendChild(overlay);

    setTimeout(function () { inp.focus(); renderHistory(); }, 120);
  }

  function goHome() {
    var sels = [
      'ytm-pivot-bar-item-renderer[tab-identifier="FEwhat_to_watch"]',
      'ytm-pivot-bar-item-renderer:first-of-type',
      '[aria-label="Home"]',
      '.pivot-bar-item-tab:first-child'
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el) { el.click(); return; }
    }
    try {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    } catch (e) {
      window.location.href = 'https://m.youtube.com/';
    }
  }

  /* ─── 侧边面板（只负责创建；横竖屏交给 CSS） ─── */
  function makePanelButton(svg, label, onTap) {
    var b = document.createElement('div');
    b.className = 'yt-pb';
    b.innerHTML = svg;
    b.setAttribute('role', 'button');          // 旁白（VoiceOver）可读
    b.setAttribute('aria-label', label);
    b.addEventListener('touchend', function (e) {
      e.preventDefault(); e.stopPropagation(); onTap();
    }, { passive: false });
    return b;
  }

  function ensureUI() {
    var root = document.documentElement;

    if (!document.getElementById('yt-top-bar')) {
      var bar = document.createElement('div');
      bar.id = 'yt-top-bar';
      root.appendChild(bar);
    }

    var panel = document.getElementById('yt-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'yt-panel';
      panel.appendChild(makePanelButton(SVG.search, I18N.search, doSearch));
      panel.appendChild(makePanelButton(SVG.back, I18N.back, function () { window.history.back(); }));
      panel.appendChild(makePanelButton(SVG.home, I18N.home, goHome));
      root.appendChild(panel);
    } else if (panel.parentNode !== root) {
      root.appendChild(panel);
    }
  }

  /* ══════════════════════════════════════════════════════════
     暂停状态机
     ══════════════════════════════════════════════════════════ */

  function setUserPaused(reason) {
    if (!state.userPaused) log('paused: ' + reason);
    state.userPaused = true;
    state.shouldResume = false;
    state.userPausedAt = Date.now();
    state.fgPauseAt = 0;
  }

  function clearUserPaused() {
    state.userPaused = false;
    state.shouldResume = true;
    state.userPausedAt = 0;
    state.fgPauseAt = 0;
  }

  // 前台出现、但网页没收到触摸的暂停：
  // 可能是原生全屏里点的、拔耳机、来电……也可能是切后台的系统暂停比后台事件早到了一点。
  // 先当作暂停；如果 BG_PAUSE_GRACE 内真的进入后台，再撤销并恢复播放。
  function acceptForegroundPause(reason, native) {
    setUserPaused(reason);
    state.fgPauseAt = Date.now();
    state.fgPauseNative = !!native;
  }

  function isBackground() {
    return state.realBackgrounded || isReallyHidden();
  }

  function isWindowLevelEvent(event) {
    // window 上的捕获监听也会收到输入框等元素的 focus/blur，要排除掉
    return !event || !event.target || event.target === window || event.target === document;
  }

  /* ══════════════════════════════════════════════════════════
     后台 / 前台
     ══════════════════════════════════════════════════════════ */

  function patchVisibility() {
    try {
      Object.defineProperty(document, 'hidden', { get: function () { return false; }, configurable: true });
      Object.defineProperty(document, 'visibilityState', { get: function () { return 'visible'; }, configurable: true });
      Object.defineProperty(document, 'webkitHidden', { get: function () { return false; }, configurable: true });
      Object.defineProperty(document, 'webkitVisibilityState', { get: function () { return 'visible'; }, configurable: true });
      document.hasFocus = function () { return true; };
    } catch (e) {
      log('visibility patch partial');
    }

    ['visibilitychange', 'webkitvisibilitychange', 'freeze'].forEach(function (type) {
      listen(document, type, onBackgroundEvent, true);
    });
    ['pagehide', 'blur', 'freeze'].forEach(function (type) {
      listen(window, type, onBackgroundEvent, true);
    });
    ['pageshow', 'focus', 'resume'].forEach(function (type) {
      listen(window, type, onForeground, true);
      listen(document, type, onForeground, true);
    });
  }

  function onBackgroundEvent(event) {
    if (!isWindowLevelEvent(event)) return;   // 元素失焦：不拦截、不当成切后台

    var type = (event && event.type) || 'unknown';
    var hidden = isReallyHidden();
    if (event && typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

    // visibilitychange 回到前台时也会触发
    if ((type === 'visibilitychange' || type === 'webkitvisibilitychange') && !hidden) {
      onForeground();
      return;
    }

    // 进入原生全屏时 iOS 会发 blur，这不是切后台
    if (!hidden && type === 'blur' && inNativePlayer(state.video || findVideo())) {
      log('blur ignored (native player)');
      return;
    }

    var hardBg = hidden || type === 'pagehide' || type === 'freeze';
    log('bg ' + type + (hardBg ? ' (hidden)' : ''));
    state.realBackgrounded = true;

    // 刚被当作暂停的前台暂停，其实是切后台造成的 → 撤销
    // （原生播放器里的暂停只认真正的 hidden，因为进入全屏本身也会 blur）
    if (state.fgPauseAt && Date.now() - state.fgPauseAt < BG_PAUSE_GRACE && (hardBg || !state.fgPauseNative)) {
      log('pause was caused by backgrounding -> revert');
      clearUserPaused();
    }

    rebindMediaSession();
    setTimeout(rebindMediaSession, 450);
    setTimeout(rebindMediaSession, 1600);
    if (state.shouldResume && !state.userPaused) {
      syncResume();
      softResume(120);
      softResume(700);
      softResume(1800);
    }
  }

  function onForeground(event) {
    if (!isWindowLevelEvent(event)) return;
    log('fg' + (event && event.type ? ' ' + event.type : ''));
    state.realBackgrounded = false;
    if (!state.userPaused) startAudioKeepAlive();
    rebindMediaSession();
    if (state.pendingUnmute) {
      state.pendingUnmute = false;
      var video = getVideo();
      if (video && !state.inAd) video.muted = false;
    }
    if (state.shouldResume && !state.userPaused && !state.inAd) {
      softResume(120);
      softResume(700);
    }
  }

  // 阻止 YouTube 注册 visibilitychange / blur 等监听（它靠这些在后台暂停）
  function patchBackgroundEventRegistration() {
    var blocked = {
      visibilitychange: true, webkitvisibilitychange: true,
      pagehide: true, freeze: true, resume: true, blur: true
    };
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (type && blocked[type] && (this === document || this === window)) {
        log('blocked listener ' + type);
        return;
      }
      return NATIVE.addEventListener.call(this, type, listener, options);
    };
  }

  /* ══════════════════════════════════════════════════════════
     拦截网页 JS 发起的暂停：video.pause() / player.pauseVideo()
     只在“真的在后台”时拦截；前台一律放行，由 onVideoPause 判断
     ══════════════════════════════════════════════════════════ */

  function shouldAllowPause(source) {
    var now = Date.now();
    if (now < state.recentGestureUntil || now < state.allowPauseUntil) {
      setUserPaused(source + ' (user)');
      return true;
    }
    if (now < state.transitionUntil) return true;
    if (state.userPaused || !state.shouldResume) return true;
    if (isBackground()) {
      log(source + ' blocked (background)');
      return false;
    }
    return true;
  }

  function patchMedia() {
    HTMLMediaElement.prototype.play = function () {
      if (this && this.tagName === 'VIDEO') {
        clearUserPaused();
        startAudioKeepAlive();   // 在用户手势的调用栈里启动，iOS 才允许
      }
      return NATIVE.play.apply(this, arguments);
    };

    HTMLMediaElement.prototype.pause = function () {
      if (this && this.tagName === 'VIDEO' && !shouldAllowPause('pause()')) {
        softResume(80);
        return undefined;
      }
      return NATIVE.pause.apply(this, arguments);
    };
  }

  function patchPlayerMethods(player) {
    if (!player || player.__ytClearTubePlayerPatch === VERSION) return;
    player.__ytClearTubePlayerPatch = VERSION;
    state.patchedPlayers.push(player);

    ['pauseVideo', 'stopVideo'].forEach(function (name) {
      var key = '__ytClearNative_' + name;
      var nativeMethod = player[key] || player[name];   // 取原版，避免包装旧版本的包装
      if (typeof nativeMethod !== 'function') return;
      player[key] = nativeMethod;
      player[name] = function () {
        if (!shouldAllowPause(name)) {
          softResume(80);
          return undefined;
        }
        return nativeMethod.apply(player, arguments);
      };
    });
  }

  function markGesture() {
    state.recentGestureUntil = Date.now() + 1300;
    if (!state.userPaused) startAudioKeepAlive();
  }

  /* ══════════════════════════════════════════════════════════
     视频元素
     ══════════════════════════════════════════════════════════ */

  function findVideo() {
    return document.querySelector('video.html5-main-video') ||
           document.querySelector('#movie_player video') ||
           document.querySelector('video');
  }

  function getPlayer() {
    if (!state.player || !document.contains(state.player)) {
      state.player = document.querySelector('#movie_player, .html5-video-player');
      if (state.player) patchPlayerMethods(state.player);
    }
    return state.player;
  }

  function getVideo() {
    if (!state.video || !document.contains(state.video)) {
      state.video = findVideo();
      var v = state.video;
      if (v && v.__ytClearBound !== VERSION) {
        v.__ytClearBound = VERSION;
        log('video bound');
        v.setAttribute('playsinline', '');
        v.setAttribute('webkit-playsinline', '');
        listen(v, 'playing', onVideoPlaying, { passive: true });
        listen(v, 'play', onVideoPlaying, { passive: true });
        listen(v, 'pause', onVideoPause, true);
        listen(v, 'loadstart', markTransition, { passive: true });
        listen(v, 'emptied', markTransition, { passive: true });
        listen(v, 'canplay', onVideoCanPlay, { passive: true });
        listen(v, 'seeked', onVideoSeeked, { passive: true });
        listen(v, 'durationchange', scheduleBurst, { passive: true });
        listen(v, 'webkitbeginfullscreen', onNativeFullscreenBegin, { passive: true });
        listen(v, 'webkitendfullscreen', onNativeFullscreenEnd, { passive: true });
        listen(v, 'webkitpresentationmodechanged', onPresentationModeChanged, { passive: true });
      }
    }
    return state.video;
  }

  function onNativeFullscreenBegin() {
    state.nativeFullscreen = true;
    // 进入全屏时的 blur 可能刚把 realBackgrounded 设成 true，按真实状态校正
    state.realBackgrounded = isReallyHidden();
    log('fullscreen begin');
    rebindMediaSession();
  }

  function onNativeFullscreenEnd() {
    state.nativeFullscreen = false;
    state.realBackgrounded = isReallyHidden();
    log('fullscreen end');
    var v = state.video || findVideo();
    if (v && !v.paused) clearUserPaused();
    rebindMediaSession();
  }

  function onPresentationModeChanged(event) {
    var v = event && event.target;
    log('presentation ' + (v && v.webkitPresentationMode));
  }

  function onVideoPlaying() {
    log('playing');
    state.transitionUntil = 0;
    clearUserPaused();
    state.mediaSessionBound = false;
    startAudioKeepAlive();
    if (state.pendingUnmute) {
      setTimeout(function () {
        if (state.realBackgrounded) return;
        state.pendingUnmute = false;
        var video = getVideo();
        if (video && !state.inAd) video.muted = false;
      }, 250);
    }
    setTimeout(forceHD, 350);
    scheduleBurst();
    updateMediaSession();
  }

  /* ─── 暂停事件：所有暂停都会到这里（包括 iOS 原生播放器里的暂停） ─── */
  function onVideoPause(event) {
    var video = (event && event.target) || getVideo();
    if (!video || video.ended) return;           // 自然播完：交给 YouTube 切下一个
    if (state.inAd) return;
    if (Date.now() < state.transitionUntil) return;
    if (state.userPaused) { updateMediaSession(); return; }

    // 1) iOS 原生全屏 / 画中画：网页收不到触摸，所以没有手势记录
    if (inNativePlayer(video)) {
      var pip = video.webkitPresentationMode === 'picture-in-picture';
      if (pip) {
        // 画中画小窗本来就是给后台用的，里面的暂停一定是用户点的
        setUserPaused('picture-in-picture');
        updateMediaSession();
        return;
      }
      if (!isReallyHidden()) {
        acceptForegroundPause('native fullscreen', true);
        updateMediaSession();
        return;
      }
    } else if (!isBackground()) {
      // 2) 前台、非手势：拔耳机、来电、YouTube 自己暂停……尊重它
      acceptForegroundPause('system (foreground)', false);
      updateMediaSession();
      return;
    }

    // 3) 已在后台：系统造成的暂停 → 恢复
    log('pause while backgrounded -> resume');
    if (state.shouldResume) {
      syncResume();
      softResume(120);
      softResume(800);
    }
  }

  function markTransition() {
    state.transitionUntil = Date.now() + 2500;
    state.mediaSessionBound = false;
    scheduleBurst();
  }

  function onVideoCanPlay() {
    state.transitionUntil = 0;
    if (state.shouldResume && !state.userPaused && !state.inAd) softResume(0);
  }

  function onVideoSeeked() {
    updatePositionState(getVideo());
  }

  /* ══════════════════════════════════════════════════════════
     恢复播放
     ══════════════════════════════════════════════════════════ */

  function syncResume() {
    var video = state.video || getVideo();
    if (!video || state.userPaused || state.inAd) return;
    if (!video.paused || video.ended) return;
    try {
      var promise = NATIVE.play.call(video);
      if (promise && promise.catch) {
        promise.catch(function (error) { log('sync resume blocked ' + (error && error.name)); });
      }
    } catch (e) {}
  }

  function blessGesture() {
    var video = getVideo();
    if (!video) return;
    try {
      var promise = NATIVE.play.call(video);
      if (promise && promise.catch) promise.catch(function () {});
    } catch (e) {}
  }

  function attemptPlay(video) {
    var promise;
    try { promise = NATIVE.play.call(video); } catch (e) { return; }
    if (!promise || !promise.catch) return;
    promise.catch(function (error) {
      log('play blocked ' + (error && error.name) + (state.realBackgrounded ? ' (bg)' : ''));
      if (state.realBackgrounded) return;
      if (video.muted || state.inAd || state.userPaused) return;
      // 自动播放被拦：先静音播放，回到前台后再取消静音
      state.pendingUnmute = true;
      video.muted = true;
      var retry;
      try { retry = NATIVE.play.call(video); } catch (e) { retry = null; }
      if (retry && retry.catch) {
        retry.catch(function () {
          state.pendingUnmute = false;
          video.muted = false;
        });
      }
    });
  }

  function softResume(delay) {
    setTimeout(function () {
      var video = getVideo();
      if (!video || state.userPaused || state.inAd) return;
      if (Date.now() < state.transitionUntil) return;
      if (video.paused && !video.ended) attemptPlay(video);
      updateMediaSession();
    }, delay || 0);
  }

  /* ══════════════════════════════════════════════════════════
     锁屏 / 控制中心（Media Session）
     ══════════════════════════════════════════════════════════ */

  // 每个动作单独 try：某个动作不被支持时，不影响其他动作注册
  function setMediaAction(name, handler) {
    try { navigator.mediaSession.setActionHandler(name, handler); }
    catch (e) { log('ms unsupported ' + name); }
  }

  function updateMediaSession() {
    if (!navigator.mediaSession) return;
    var mediaVideo = getVideo();
    try {
      navigator.mediaSession.playbackState =
        (mediaVideo && !mediaVideo.paused && !mediaVideo.ended) ? 'playing' : 'paused';
    } catch (e) {}
    updatePositionState(mediaVideo);

    if (state.mediaSessionBound && Date.now() - state.lastMediaSessionRefresh < 3000) return;
    state.mediaSessionBound = true;
    state.lastMediaSessionRefresh = Date.now();

    setMediaAction('play', function () {
      log('ms play');
      clearUserPaused();
      startAudioKeepAlive();
      var video = getVideo();
      if (video && video.muted && !state.inAd) {
        state.pendingUnmute = false;
        video.muted = false;
      }
      blessGesture();
      softResume(150);
    });
    setMediaAction('pause', function () {
      log('ms pause');
      var video = getVideo();
      state.allowPauseUntil = Date.now() + 1500;
      setUserPaused('lock screen');
      if (video) { try { NATIVE.pause.call(video); } catch (e) {} }
      updateMediaSession();
    });
    setMediaAction('previoustrack', previousTrack);
    setMediaAction('nexttrack', nextTrack);
    // 保持为 null：设置了快退/快进，iOS 锁屏会把“上一个/下一个”换成 ±10 秒按钮
    setMediaAction('seekbackward', null);
    setMediaAction('seekforward', null);
    setMediaAction('seekto', function (details) {
      if (!details || typeof details.seekTime !== 'number') return;
      log('ms seekto');
      seekTo(details.seekTime);
    });
  }

  function rebindMediaSession() {
    state.mediaSessionBound = false;
    updateMediaSession();
  }

  function updatePositionState(video) {
    if (!navigator.mediaSession || typeof navigator.mediaSession.setPositionState !== 'function') return;
    if (!video || state.inAd) return;
    var duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    var position = Math.min(Math.max(video.currentTime || 0, 0), duration);
    try {
      navigator.mediaSession.setPositionState({
        duration: duration,
        playbackRate: video.playbackRate || 1,
        position: position
      });
    } catch (e) {}
  }

  function nextTrack() {
    log('ms next');
    clearUserPaused();
    markTransition();
    startAudioKeepAlive();
    blessGesture();
    if (
      callPlayerMethod(['nextVideo', 'nextTrack', 'next']) ||
      clickFirst([
        '.ytp-next-button',
        'button.player-control-next-button',
        '#player [aria-label*="Next" i]',
        '#player [aria-label*="下一"]',
        '[aria-label*="Next video" i]',
        '[aria-label*="下一个" i]',
        '[aria-label*="下一個" i]'
      ]) ||
      sendShortcut('N', true)
    ) {
      afterMediaCommand();
    }
  }

  function previousTrack() {
    log('ms prev');
    clearUserPaused();
    markTransition();
    startAudioKeepAlive();
    blessGesture();
    if (
      callPlayerMethod(['previousVideo', 'previousTrack', 'previous']) ||
      clickFirst([
        '.ytp-prev-button',
        'button.player-control-prev-button',
        '#player [aria-label*="Previous" i]',
        '#player [aria-label*="上一"]',
        '[aria-label*="Previous video" i]',
        '[aria-label*="上一个" i]',
        '[aria-label*="上一個" i]'
      ]) ||
      sendShortcut('P', true)
    ) {
      afterMediaCommand();
    }
  }

  // 拖动锁屏进度条：暂停中拖动保持暂停，播放中拖动继续播放
  function seekTo(seconds) {
    var video = getVideo();
    if (!state.userPaused) startAudioKeepAlive();
    if (callPlayerMethod(['seekTo'], [seconds, true])) {
      afterMediaCommand();
      return;
    }
    if (video && Number.isFinite(video.duration)) {
      try { video.currentTime = Math.max(0, Math.min(video.duration, seconds)); } catch (e) {}
    }
    afterMediaCommand();
  }

  function afterMediaCommand() {
    rebindMediaSession();
    softResume(120);
    softResume(900);
    scheduleBurst();
  }

  function callPlayerMethod(methods, args) {
    var player = getPlayer();
    if (!player) return false;
    args = args || [];
    for (var i = 0; i < methods.length; i++) {
      if (typeof player[methods[i]] === 'function') {
        try { player[methods[i]].apply(player, args); return true; } catch (e) {}
      }
    }
    return false;
  }

  function clickFirst(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var button = document.querySelector(selectors[i]);
      if (isUsableControl(button)) {
        fireClick(button);
        return true;
      }
    }
    return false;
  }

  function isUsableControl(button) {
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    if (button.matches && button.matches('[disabled]')) return false;
    return true;
  }

  // 只点一次：旧版 click() 后又派发了一个 click 事件，会连跳两个视频
  function fireClick(target) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (type) {
      try { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    });
    try { target.click(); } catch (e) {}
  }

  function sendShortcut(key, shiftKey) {
    var target = document.activeElement || document.body || document.documentElement;
    var upper = key.toUpperCase();
    try {
      ['keydown', 'keyup'].forEach(function (type) {
        target.dispatchEvent(new KeyboardEvent(type, {
          key: key,
          code: 'Key' + upper,
          keyCode: upper.charCodeAt(0),
          which: upper.charCodeAt(0),
          shiftKey: !!shiftKey,
          bubbles: true,
          cancelable: true
        }));
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ══════════════════════════════════════════════════════════
     保活音频：几乎无声的振荡器，让 App 在后台保持音频会话
     ══════════════════════════════════════════════════════════ */

  function startAudioKeepAlive() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    if (!state.audioCtx) {
      try { state.audioCtx = new AC(); } catch (e) { return; }
    }
    if (state.audioCtx.state !== 'running') {
      try {
        var p = state.audioCtx.resume();
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }
    if (!state.keepAliveOsc) {
      try {
        var gain = state.audioCtx.createGain();
        gain.gain.value = 0.0001;
        var osc = state.audioCtx.createOscillator();
        osc.frequency.value = 30;
        osc.connect(gain);
        gain.connect(state.audioCtx.destination);
        osc.start();
        state.keepAliveOsc = osc;
        state.keepAliveGain = gain;
      } catch (e) {}
    }
    if (!state.silenceTimer) {
      state.silenceTimer = setInterval(function () {
        if (state.audioCtx && state.audioCtx.state !== 'running') {
          try {
            var p2 = state.audioCtx.resume();
            if (p2 && p2.catch) p2.catch(function () {});
          } catch (e) {}
        }
      }, 1500);
    }
  }

  function stopAudioKeepAlive() {
    if (state.silenceTimer) { clearInterval(state.silenceTimer); state.silenceTimer = null; }
    if (state.keepAliveOsc) {
      try { state.keepAliveOsc.stop(); } catch (e) {}
      try { state.keepAliveOsc.disconnect(); } catch (e) {}
      state.keepAliveOsc = null;
    }
    if (state.keepAliveGain) {
      try { state.keepAliveGain.disconnect(); } catch (e) {}
      state.keepAliveGain = null;
    }
    if (state.audioCtx && state.audioCtx.state === 'running') {
      try {
        var p = state.audioCtx.suspend();
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }
  }

  // 暂停很久才停保活：短暂停时仍能从锁屏直接继续，长时间暂停不再耗电
  function maybeStopKeepAlive() {
    if (!state.keepAliveOsc || !state.userPaused || !state.userPausedAt) return;
    if (Date.now() - state.userPausedAt < KEEPALIVE_IDLE_STOP) return;
    log('keep-alive stopped (long pause)');
    stopAudioKeepAlive();
  }

  /* ══════════════════════════════════════════════════════════
     画质 / 广告 / “仍在观看？”
     ══════════════════════════════════════════════════════════ */

  function writeQualityPref() {
    try {
      window.localStorage.setItem('yt-player-quality', JSON.stringify({
        data: 'hd1080', creation: Date.now(), expiration: Date.now() + 2592000000
      }));
    } catch (e) {}
  }

  function forceHD() {
    if (state.inAd) return;                        // 广告不用设画质
    var now = Date.now();
    if (now - state.lastHD < 1500) return;
    state.lastHD = now;
    var p = getPlayer();
    if (p && typeof p.setPlaybackQualityRange === 'function') {
      try { p.setPlaybackQualityRange('hd1080', 'hd1080'); } catch (e) {}
    }
  }

  function isVisibleButton(button) {
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    try {
      var rect = button.getBoundingClientRect();
      var style = window.getComputedStyle(button);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && style.opacity !== '0';
    } catch (e) {
      return false;
    }
  }

  function isTubeAdPlaying() {
    var player = getPlayer();
    if (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) return true;
    return isVisibleButton(document.querySelector(AD_SKIP_SEL));
  }

  function skipAd() {
    if (Date.now() < state.skipCooldownUntil) return false;
    var btn = document.querySelector(AD_SKIP_SEL);
    if (!isVisibleButton(btn)) return false;
    try { btn.click(); } catch (e) { return false; }
    state.skipCooldownUntil = Date.now() + 1800;
    log('ad skip');
    return true;
  }

  function handleAd() {
    var hasAd = isTubeAdPlaying();
    var v = getVideo();

    if (hasAd) {
      if (!state.inAd) {
        state.inAd = true;
        log('ad start (restore to ' + state.lastContentRate + 'x' + (state.lastContentMuted ? ' muted' : '') + ')');
      }
      if (skipAd()) return;
      if (v) {
        try { v.muted = true; } catch (e) {}
        try { if (v.playbackRate < 16) v.playbackRate = 16; } catch (e) {}
      }
      return;
    }

    if (state.inAd) {
      state.inAd = false;
      log('ad end');
      if (v) {
        // 只撤销我们自己改的 16 倍速；YouTube 已经恢复了倍速就不动
        try { if (v.playbackRate > 4) v.playbackRate = state.lastContentRate || 1; } catch (e) {}
        try { v.muted = state.lastContentMuted; } catch (e) {}
      }
      state.skipCooldownUntil = 0;
      rebindMediaSession();
    }
  }

  // 记住正片时用户自己的倍速和静音（广告期间不更新）
  function trackContentState() {
    if (state.inAd) return;
    var v = state.video;
    if (!v) return;
    if (v.playbackRate > 0 && v.playbackRate <= 4) state.lastContentRate = v.playbackRate;
    if (!state.pendingUnmute) state.lastContentMuted = !!v.muted;
  }

  // “仍在观看？”弹窗：按钮一般只写“是 / Yes”，所以先按弹窗文字匹配，再点里面的按钮
  var STILL_WATCHING = /still watching|continue watching|video paused|继续观看|仍在观看|還在觀看|继续播放|繼續播放/i;

  function dismissStillWatching() {
    var now = Date.now();
    if (now - state.lastStillCheck < 2000) return;   // 2 秒查一次就够
    state.lastStillCheck = now;

    function confirm(button, how) {
      log('dismiss still-watching (' + how + ')');
      try { button.click(); } catch (e) {}
      clearUserPaused();
      softResume(150);
    }

    var dialogs = document.querySelectorAll(
      'ytm-confirm-dialog-renderer, yt-confirm-dialog-renderer, tp-yt-paper-dialog, [role="dialog"], [role="alertdialog"]'
    );
    for (var i = 0; i < dialogs.length; i++) {
      if (!STILL_WATCHING.test(dialogs[i].textContent || '')) continue;
      var btns = dialogs[i].querySelectorAll('button');
      for (var j = btns.length - 1; j >= 0; j--) {   // 确认键一般在最后
        if (isVisibleButton(btns[j])) { confirm(btns[j], 'dialog'); return; }
      }
    }

    // 兜底：按钮自身文字匹配（textContent 不触发重排，比 innerText 省电）
    var buttons = document.querySelectorAll('button');
    for (var k = 0; k < buttons.length; k++) {
      var b = buttons[k];
      var text = (b.textContent || b.getAttribute('aria-label') || '').trim();
      if (text && STILL_WATCHING.test(text) && isVisibleButton(b)) { confirm(b, 'button'); return; }
    }
  }

  /* ══════════════════════════════════════════════════════════
     主循环：UI 修复 / 广告 / 续播 全在这一个循环里
     广告或切换视频时 120ms 一次，平时 700ms 一次
     ══════════════════════════════════════════════════════════ */

  function mediaTick() {
    ensureStyle();
    ensureUI();
    getVideo();
    getPlayer();
    handleAd();
    trackContentState();
    dismissStillWatching();
    updateMediaSession();
    maybeStopKeepAlive();

    if (state.shouldResume && !state.userPaused && !state.inAd) {
      var video = getVideo();
      if (video && video.paused && !video.ended && Date.now() > state.transitionUntil) softResume(0);
    }
  }

  function scheduleBurst() {
    state.burstUntil = Date.now() + 2500;
  }

  function startLoop() {
    if (state.loopTimer) clearTimeout(state.loopTimer);
    var loop = function () {
      try { mediaTick(); } catch (e) { log('tick error ' + (e && e.message)); }
      var delay = state.inAd || Date.now() < state.burstUntil ? 120 : 700;
      state.loopTimer = setTimeout(loop, delay);
    };
    loop();
  }

  function onNavigate() {
    state.video = null;
    state.player = null;
    state.nativeFullscreen = false;
    state.mediaSessionBound = false;
    state.transitionUntil = Date.now() + 1500;
    // 不重置 inAd：广告中途切走时，下一轮循环还要恢复静音和倍速
    scheduleBurst();
    mediaTick();
  }

  /* ══════════════════════════════════════════════════════════
     调试面板：左上角 1.6 秒内连点 4 下
     ══════════════════════════════════════════════════════════ */

  function onDebugTap(event) {
    var touch = event.changedTouches && event.changedTouches[0];
    if (!touch || touch.clientX > 90 || touch.clientY > 110) return;
    var now = Date.now();
    state.debugTaps = state.debugTaps.filter(function (t) { return now - t < 1600; });
    state.debugTaps.push(now);
    if (state.debugTaps.length >= 4) {
      state.debugTaps = [];
      toggleDebugOverlay();
    }
  }

  function toggleDebugOverlay() {
    var existing = document.getElementById('ytm-debug-overlay');
    if (existing) {
      existing.parentNode.removeChild(existing);
      return;
    }
    var v = getVideo();
    var panel = document.createElement('div');
    panel.id = 'ytm-debug-overlay';
    panel.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:55%;overflow:auto;background:rgba(0,0,0,0.92);color:#7CFC00;font:10px/1.5 monospace;z-index:2147483647;padding:10px;white-space:pre-wrap;-webkit-overflow-scrolling:touch;';
    panel.textContent = 'v' + VERSION +
      '  fs=' + inNativePlayer(v) +
      '  hidden=' + isReallyHidden() +
      '  bg=' + state.realBackgrounded +
      '  userPaused=' + state.userPaused +
      '  inAd=' + state.inAd +
      '  keepAlive=' + !!state.keepAliveOsc + '\\n' +
      state.logs.slice(-150).join('\\n');
    document.body.appendChild(panel);
  }

  /* ══════════════════════════════════════════════════════════
     销毁：新版本注入时彻底清理旧实例
     ══════════════════════════════════════════════════════════ */

  function destroy() {
    if (state.loopTimer) clearTimeout(state.loopTimer);
    clearTimeout(suggestTimer);
    suggestSeq++;

    stopAudioKeepAlive();
    if (state.audioCtx) {
      try {
        var closing = state.audioCtx.close();
        if (closing && closing.catch) closing.catch(function () {});
      } catch (e) {}
      state.audioCtx = null;
    }

    listeners.forEach(function (l) {
      try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (e) {}
    });
    listeners.length = 0;

    HTMLMediaElement.prototype.play = NATIVE.play;
    HTMLMediaElement.prototype.pause = NATIVE.pause;
    EventTarget.prototype.addEventListener = NATIVE.addEventListener;

    state.patchedPlayers.forEach(function (p) {
      ['pauseVideo', 'stopVideo'].forEach(function (name) {
        var original = p['__ytClearNative_' + name];
        if (original) p[name] = original;
      });
      try { delete p.__ytClearTubePlayerPatch; } catch (e) {}
    });
    if (state.video) {
      try { delete state.video.__ytClearBound; } catch (e) {}
    }

    ['hidden', 'visibilityState', 'webkitHidden', 'webkitVisibilityState', 'hasFocus'].forEach(function (k) {
      try { delete document[k]; } catch (e) {}
    });

    ['yt-panel', 'yt-top-bar', 'yt-ios-css', 'yt-search-modal', 'ytm-debug-overlay'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    var pending = document.querySelectorAll('script[data-yt-clear-suggest]');
    for (var i = 0; i < pending.length; i++) {
      if (pending[i].parentNode) pending[i].parentNode.removeChild(pending[i]);
    }

    if (window.__ytClearScriptableTube && window.__ytClearScriptableTube.destroy === destroy) {
      delete window.__ytClearScriptableTube;
    }
  }

  /* ══════════════════════════════════════════════════════════
     启动
     ══════════════════════════════════════════════════════════ */

  window.__ytClearScriptableTube = { version: VERSION, destroy: destroy, logs: state.logs, state: state };

  patchVisibility();
  patchBackgroundEventRegistration();
  patchMedia();
  writeQualityPref();
  ensureStyle();
  ensureUI();
  updateMediaSession();

  listen(document, 'touchstart', markGesture, { passive: true });
  listen(document, 'touchend', markGesture, { passive: true });
  listen(document, 'touchend', onDebugTap, { passive: true });
  listen(document, 'click', markGesture, true);
  listen(document, 'keydown', markGesture, true);
  listen(window, 'popstate', onNavigate);
  listen(window, 'yt-navigate-finish', onNavigate);
  listen(window, 'resize', scheduleOrientationCheck);
  listen(window, 'orientationchange', scheduleOrientationCheck);

  getVideo();
  getPlayer();
  scheduleBurst();
  startLoop();

  return null;
})();
null;
`;

await webView.evaluateJavaScript(magicScript);

// YouTube 偶尔会整页刷新（例如搜索的兜底跳转），注入的代码会随之丢失。
// 每 3 秒检查一次，没有就补注入；已经存在时只是一次很小的查询。
const aliveCheck = "!!(window.__ytClearScriptableTube && window.__ytClearScriptableTube.version === '" + VERSION + "')";
let reinjecting = false;
const reinjectTimer = Timer.schedule(3000, true, async () => {
  if (reinjecting) return;
  reinjecting = true;
  try {
    const alive = await webView.evaluateJavaScript(aliveCheck);
    if (!alive) await webView.evaluateJavaScript(magicScript);
  } catch (e) {}
  reinjecting = false;
});

await webView.present(true);
reinjectTimer.invalidate();
Script.complete();

}
