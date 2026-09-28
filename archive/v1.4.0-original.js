// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: play-circle;

if (!config.runsInApp) {
  const alert = new Alert();
  alert.title = '需要在 Scriptable App 内运行';
  alert.message = [
    '这个脚本要先配置 WebView 再注入去广告代码。',
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
(function() {

  var VERSION = '1.4.0-scriptable';
  var previous = window.__ytClearScriptableTube;
  if (previous && previous.version === VERSION) return null;
  if (previous && typeof previous.destroy === 'function') previous.destroy();

  /* ─── 国际化 ─── */
  var lang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  var isCN = lang.startsWith('zh');
  var I18N = {
    title:       isCN ? '搜索 YouTube'    : 'Search YouTube',
    placeholder: isCN ? '输入搜索内容...' : 'Search...',
    cancel:      isCN ? '取消'            : 'Cancel',
    search:      isCN ? '搜索'            : 'Search',
    recent:      isCN ? '最近搜索'        : 'Recent',
    clearAll:    isCN ? '清除'            : 'Clear'
  };

  /* ─── CSS ─── */
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
      'user-select:none!important;-webkit-tap-highlight-color:transparent!important;',
      'touch-action:manipulation!important;cursor:pointer!important;',
      'pointer-events:auto!important;',
      'border-bottom:1px solid rgba(255,255,255,0.12)!important;',
    '}',
    '.yt-pb:first-child{border-radius:0 12px 0 0!important;}',
    '.yt-pb:last-child{border-radius:0 0 12px 0!important;border-bottom:none!important;}',
    '.yt-pb:active{background:rgba(255,255,255,0.25)!important;}',
    '.yt-pb svg{width:22px!important;height:22px!important;display:block!important;}'
  ].join('');

  /* ─── SVG 图标 ─── */
  var SVG = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>',
    back:   '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    home:   '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12L12 3l9 9"/><path d="M9 21V12h6v9"/><path d="M3 12v9h18V12"/></svg>'
  };

  function ensureStyle() {
    if (document.getElementById('yt-ios-css')) return;
    var s = document.createElement('style');
    s.id = 'yt-ios-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ─── 横屏自动全屏 ─── */
  function tryFullscreen() {
    var v = document.querySelector('video');
    if (!v) return;
    // 仅在有视频内容播放时触发（避免主页横屏误触发）
    if (v.readyState < 1 || v.duration === 0) return;
    if (v.webkitDisplayingFullscreen) return; // 已经全屏则跳过
    if (typeof v.webkitEnterFullscreen === 'function') {
      try { v.webkitEnterFullscreen(); } catch(e) {}
    } else if (typeof v.requestFullscreen === 'function') {
      try { v.requestFullscreen(); } catch(e) {}
    }
  }

  function applyOrientation() {
    var isLandscape = window.innerWidth > window.innerHeight;
    var bar   = document.getElementById('yt-top-bar');
    var panel = document.getElementById('yt-panel');
    var app   = document.querySelector('ytm-app');
    if (isLandscape) {
      if (bar)   bar.style.setProperty('display','none','important');
      if (panel) panel.style.setProperty('display','none','important');
      if (app)   app.style.setProperty('padding-top','0','important');
      // 延迟一帧等视频元素稳定
      setTimeout(tryFullscreen, 200);
    } else {
      if (bar)   bar.style.removeProperty('display');
      if (panel) panel.style.removeProperty('display');
      if (app)   app.style.setProperty('padding-top','90px','important');
    }
  }

  window.addEventListener('resize', applyOrientation);
  window.addEventListener('orientationchange', function() {
    setTimeout(applyOrientation, 150);
  });

  /* ─── 本地搜索历史 ─── */
  var HISTORY_KEY = 'yt_search_history';
  var MAX_HISTORY = 8;

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch(e) { return []; }
  }
  function saveHistory(q) {
    try {
      var list = getHistory().filter(function(x) { return x !== q; });
      list.unshift(q);
      if (list.length > MAX_HISTORY) list = list.slice(0, MAX_HISTORY);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch(e) {}
  }
  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch(e) {}
  }

  /* ─── 搜索建议 JSONP ─── */
  var suggestTimer = null;
  function fetchSuggestions(query, callback) {
    if (!query) { callback([]); return; }
    var cbName = 'ytSugCb_' + Date.now();
    var old = document.getElementById('yt-sug-script');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    window[cbName] = function(data) {
      try { delete window[cbName]; } catch(e) {}
      var el = document.getElementById('yt-sug-script');
      if (el && el.parentNode) el.parentNode.removeChild(el);
      var list = [];
      if (data && data[1]) {
        for (var i = 0; i < Math.min(data[1].length, 6); i++) list.push(data[1][i][0]);
      }
      callback(list);
    };
    var sc = document.createElement('script');
    sc.id = 'yt-sug-script';
    sc.src = 'https://suggestqueries.google.com/complete/search?client=youtube&q='
      + encodeURIComponent(query) + '&callback=' + cbName;
    sc.onerror = function() { callback([]); };
    (document.head || document.documentElement).appendChild(sc);
  }

  /* ─── 搜索弹窗 ─── */
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
      } catch(e) {
        window.location.href = 'https://m.youtube.com' + path;
      }
    }

    var searchIconSm = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>';
    var clockIconSm  = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>';

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
      item.addEventListener('touchend', function(e) { e.preventDefault(); e.stopPropagation(); onTap(text); }, { passive: false });
      return item;
    }

    function renderSuggestions(list) {
      listBox.innerHTML = '';
      if (!list || !list.length) { listBox.style.setProperty('display','none','important'); return; }
      listBox.style.setProperty('display','flex','important');
      list.forEach(function(text) { listBox.appendChild(makeRow(searchIconSm, text, doNavigate)); });
      if (listBox.lastChild) listBox.lastChild.style.removeProperty('border-bottom');
    }

    function renderHistory() {
      listBox.innerHTML = '';
      var hist = getHistory();
      if (!hist.length) { listBox.style.setProperty('display','none','important'); return; }
      listBox.style.setProperty('display','flex','important');

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
      clearBtn.addEventListener('touchend', function(e) {
        e.preventDefault(); clearHistory();
        listBox.innerHTML = '';
        listBox.style.setProperty('display','none','important');
      }, { passive: false });
      hdr.appendChild(hdrLabel);
      hdr.appendChild(clearBtn);
      listBox.appendChild(hdr);

      hist.forEach(function(text) {
        listBox.appendChild(makeRow(clockIconSm, text, function(t) { inp.value = t; doNavigate(t); }));
      });
      if (listBox.lastChild) listBox.lastChild.style.removeProperty('border-bottom');
    }

    inp.addEventListener('input', function() {
      clearTimeout(suggestTimer);
      var q = inp.value.trim();
      if (!q) { renderHistory(); return; }
      suggestTimer = setTimeout(function() { fetchSuggestions(q, renderSuggestions); }, 220);
    });

    inp.addEventListener('focus', function() {
      if (!inp.value.trim()) renderHistory();
    });

    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); doNavigate(); }
    });

    cancelBtn.addEventListener('touchend', function(e) { e.preventDefault(); closeModal(); }, { passive: false });
    confirmBtn.addEventListener('touchend', function(e) { e.preventDefault(); doNavigate(); }, { passive: false });
    overlay.addEventListener('touchend', function(e) {
      if (e.target === overlay) { e.preventDefault(); closeModal(); }
    }, { passive: false });

    box.appendChild(titleRow);
    box.appendChild(inputRow);
    box.appendChild(listBox);
    box.appendChild(confirmBtn);
    overlay.appendChild(box);
    document.documentElement.appendChild(overlay);

    setTimeout(function() { inp.focus(); renderHistory(); }, 120);
  }

  /* ─── 首页 ─── */
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
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  /* ─── 面板 UI ─── */
  function ensureUI() {
    var root = document.documentElement;

    if (!document.getElementById('yt-top-bar')) {
      var bar = document.createElement('div');
      bar.id = 'yt-top-bar';
      root.appendChild(bar);
    }

    if (!document.getElementById('yt-panel')) {
      var panel = document.createElement('div');
      panel.id = 'yt-panel';

      var btnSearch = document.createElement('div');
      btnSearch.className = 'yt-pb';
      btnSearch.innerHTML = SVG.search;
      btnSearch.addEventListener('touchend', function(e) {
        e.preventDefault(); e.stopPropagation(); doSearch();
      }, { passive: false });

      var btnBack = document.createElement('div');
      btnBack.className = 'yt-pb';
      btnBack.innerHTML = SVG.back;
      btnBack.addEventListener('touchend', function(e) {
        e.preventDefault(); e.stopPropagation(); window.history.back();
      }, { passive: false });

      var btnHome = document.createElement('div');
      btnHome.className = 'yt-pb';
      btnHome.innerHTML = SVG.home;
      btnHome.addEventListener('touchend', function(e) {
        e.preventDefault(); e.stopPropagation(); goHome();
      }, { passive: false });

      panel.appendChild(btnSearch);
      panel.appendChild(btnBack);
      panel.appendChild(btnHome);
      root.appendChild(panel);
    } else {
      var p = document.getElementById('yt-panel');
      if (p.parentNode !== root) root.appendChild(p);
    }

    applyOrientation();
  }

  /* ─── MutationObserver ─── */
  var uiTimer = null;
  var obs = new MutationObserver(function() {
    clearTimeout(uiTimer);
    uiTimer = setTimeout(function() { ensureStyle(); ensureUI(); }, 80);
  });
  function startObs() {
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
  if (document.body) startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  /* ─── 强制 HD ─── */
  function forceHD() {
    try {
      window.localStorage.setItem('yt-player-quality', JSON.stringify({
        data: 'hd1080', creation: Date.now(), expiration: Date.now() + 2592000000
      }));
    } catch(e) {}
    var p = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (p && p.setPlaybackQualityRange) p.setPlaybackQualityRange('hd1080', 'hd1080');
  }

  /* ─── 跳过广告 ─── */
  var skipCooldown = false;
  var adMode = false;

  function skipAd() {
    var btn = document.querySelector(
      '.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-container button'
    );
    if (btn && btn.offsetParent) {
      btn.click();
      skipCooldown = true;
      setTimeout(function() { skipCooldown = false; }, 2000);
      return true;
    }
    return false;
  }

  var adInterval = setInterval(function() {
    ensureStyle(); ensureUI(); forceHD();
    if (skipCooldown) return;
    var hasAd = isTubeAdPlaying();
    var v = document.querySelector('video');
    if (hasAd) {
      adMode = true;
      if (skipAd()) return;
      if (v) { v.muted = true; if (v.playbackRate < 16) v.playbackRate = 16; }
    } else if (adMode) {
      adMode = false;
      if (v) { v.playbackRate = 1; v.muted = false; }
    }
  }, 300);

  ensureStyle();
  ensureUI();

  /* ══════════════════════════════════════════════════════════
     锁屏播放 + 媒体会话 (移植自 YT Music 脚本 v3.4)
     ══════════════════════════════════════════════════════════ */

  var state = {
    timer: null,
    audioCtx: null,
    silenceTimer: null,
    keepAliveOsc: null,
    video: null,
    player: null,
    inAd: false,
    burstUntil: 0,
    lastMediaSessionRefresh: 0,
    mediaSessionBound: false,
    shouldResume: false,
    userPaused: false,
    recentGestureUntil: 0,
    allowPauseUntil: 0,
    transitionUntil: 0,
    realBackgrounded: false,
    mediaPatched: false,
    nativePlay: null,
    nativePause: null,
    pendingUnmute: false,
    debugTaps: [],
    logs: []
  };

  function log(message) {
    try {
      var t = new Date();
      state.logs.push(t.toTimeString().slice(0, 8) + '.' + ('00' + t.getMilliseconds()).slice(-3) + ' ' + message);
      if (state.logs.length > 300) state.logs.splice(0, 100);
    } catch (error) {}
  }

  function patchVisibility() {
    try {
      Object.defineProperty(document, 'hidden', {
        get: function () { return false; },
        configurable: true
      });
      Object.defineProperty(document, 'visibilityState', {
        get: function () { return 'visible'; },
        configurable: true
      });
      Object.defineProperty(document, 'webkitHidden', {
        get: function () { return false; },
        configurable: true
      });
      Object.defineProperty(document, 'webkitVisibilityState', {
        get: function () { return 'visible'; },
        configurable: true
      });
      document.hasFocus = function () { return true; };
    } catch (error) {}

    ['visibilitychange', 'webkitvisibilitychange', 'freeze'].forEach(function (type) {
      document.addEventListener(type, swallowBackgroundEvent, true);
    });
    ['pagehide', 'blur', 'freeze'].forEach(function (type) {
      window.addEventListener(type, swallowBackgroundEvent, true);
    });
    ['pageshow', 'focus', 'resume'].forEach(function (type) {
      window.addEventListener(type, onForeground, true);
      document.addEventListener(type, onForeground, true);
    });
  }

  function swallowBackgroundEvent(event) {
    log('bg ' + (event && event.type));
    state.realBackgrounded = true;
    rebindMediaSession();
    setTimeout(rebindMediaSession, 450);
    setTimeout(rebindMediaSession, 1600);
    if (state.shouldResume && !state.userPaused) {
      syncResume();
      softResume(120);
      softResume(700);
      softResume(1800);
    }
    if (event && typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  }

  function syncResume() {
    var video = state.video || getVideo();
    if (!video || state.userPaused || state.inAd || !state.nativePlay) return;
    if (!video.paused) return;
    try {
      var promise = state.nativePlay.call(video);
      if (promise && promise.catch) {
        promise.catch(function (error) {
          log('sync resume blocked ' + (error && error.name));
        });
      }
    } catch (error) {}
  }

  function patchBackgroundEventRegistration() {
    if (window.__ytClearTubeEventPatch === VERSION) return;
    window.__ytClearTubeEventPatch = VERSION;

    var blockedTargets = {
      visibilitychange: true,
      webkitvisibilitychange: true,
      pagehide: true,
      freeze: true,
      resume: true
    };
    var softBlockedTargets = {
      blur: true
    };
    var nativeAdd = EventTarget.prototype.addEventListener;

    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (
        type &&
        (blockedTargets[type] || softBlockedTargets[type]) &&
        (this === document || this === window)
      ) {
        log('blocked listener ' + type);
        return;
      }
      return nativeAdd.call(this, type, listener, options);
    };
  }

  function onForeground() {
    log('fg');
    state.realBackgrounded = false;
    startAudioKeepAlive();
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

  function patchMedia() {
    if (state.mediaPatched || !window.HTMLMediaElement) return;
    state.mediaPatched = true;
    state.nativePlay = HTMLMediaElement.prototype.play;
    state.nativePause = HTMLMediaElement.prototype.pause;

    HTMLMediaElement.prototype.play = function () {
      if (this && this.tagName === 'VIDEO') {
        state.shouldResume = true;
        state.userPaused = false;
      }
      return state.nativePlay.apply(this, arguments);
    };

    HTMLMediaElement.prototype.pause = function () {
      if (this && this.tagName === 'VIDEO') {
        var now = Date.now();

        if (now < state.transitionUntil) {
          log('pause ok (transition)');
          return state.nativePause.apply(this, arguments);
        }

        var userIntent = now < state.recentGestureUntil || now < state.allowPauseUntil;
        var autoPause = state.realBackgrounded || state.shouldResume;

        if (!userIntent && autoPause && !state.userPaused) {
          log('pause blocked');
          softResume(80);
          return undefined;
        }

        if (userIntent) {
          state.userPaused = true;
          state.shouldResume = false;
        }
      }
      return state.nativePause.apply(this, arguments);
    };
  }

  function markGesture() {
    state.recentGestureUntil = Date.now() + 1300;
    startAudioKeepAlive();
  }

  function getPlayer() {
    if (!state.player || !document.contains(state.player)) {
      state.player = document.querySelector('#movie_player, .html5-video-player');
      if (state.player) patchPlayerMethods(state.player);
    }
    return state.player;
  }

  function patchPlayerMethods(player) {
    if (!player || player.__ytClearTubePlayerPatch === VERSION) return;
    player.__ytClearTubePlayerPatch = VERSION;

    ['pauseVideo', 'stopVideo'].forEach(function (name) {
      if (typeof player[name] !== 'function') return;
      var nativeMethod = player[name];
      player['__ytClearNative_' + name] = nativeMethod;
      player[name] = function () {
        var now = Date.now();
        var userIntent = now < state.recentGestureUntil || now < state.allowPauseUntil;
        var transition = now < state.transitionUntil;
        var autoPause = state.realBackgrounded || state.shouldResume;

        if (!userIntent && !transition && autoPause && !state.userPaused) {
          log(name + ' blocked');
          softResume(80);
          return undefined;
        }

        if (userIntent) {
          state.userPaused = true;
          state.shouldResume = false;
        }

        return nativeMethod.apply(player, arguments);
      };
    });
  }

  function getVideo() {
    if (!state.video || !document.contains(state.video)) {
      state.video = document.querySelector('video');
      if (state.video && state.video.__ytClearScriptableTubeListeners !== VERSION) {
        state.video.__ytClearScriptableTubeListeners = VERSION;
        log('video bound');
        state.video.setAttribute('playsinline', '');
        state.video.setAttribute('webkit-playsinline', '');
        state.video.addEventListener('playing', onVideoPlaying, { passive: true });
        state.video.addEventListener('play', onVideoPlaying, { passive: true });
        state.video.addEventListener('pause', onVideoPause, true);
        state.video.addEventListener('loadstart', markTransition, { passive: true });
        state.video.addEventListener('emptied', markTransition, { passive: true });
        state.video.addEventListener('canplay', onVideoCanPlay, { passive: true });
        state.video.addEventListener('seeked', onVideoSeeked, { passive: true });
        state.video.addEventListener('durationchange', scheduleBurst, { passive: true });
      }
    }
    return state.video;
  }

  function onVideoPlaying() {
    log('playing');
    state.transitionUntil = 0;
    state.shouldResume = true;
    state.userPaused = false;
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
    scheduleBurst();
    updateMediaSession();
  }

  function onVideoPause() {
    if (state.userPaused || state.inAd) return;
    if (Date.now() < state.transitionUntil) return;
    if (state.shouldResume || state.realBackgrounded) {
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

  function updateMediaSession() {
    if (!navigator.mediaSession) return;

    try {
      var mediaVideo = getVideo();
      navigator.mediaSession.playbackState =
        (mediaVideo && !mediaVideo.paused && !mediaVideo.ended) ? 'playing' : 'paused';
      if (state.mediaSessionBound && Date.now() - state.lastMediaSessionRefresh < 3000) return;
      state.mediaSessionBound = true;
      state.lastMediaSessionRefresh = Date.now();

      navigator.mediaSession.setActionHandler('play', function () {
        log('ms play');
        state.userPaused = false;
        state.shouldResume = true;
        startAudioKeepAlive();
        var video = getVideo();
        if (video && video.muted && !state.inAd) {
          state.pendingUnmute = false;
          video.muted = false;
        }
        blessGesture();
        softResume(150);
      });
      navigator.mediaSession.setActionHandler('pause', function () {
        log('ms pause');
        var video = getVideo();
        state.allowPauseUntil = Date.now() + 1200;
        state.userPaused = true;
        state.shouldResume = false;
        if (video && state.nativePause) state.nativePause.call(video);
      });
      navigator.mediaSession.setActionHandler('previoustrack', function () {
        previousTrack();
      });
      navigator.mediaSession.setActionHandler('nexttrack', function () {
        nextTrack();
      });
      navigator.mediaSession.setActionHandler('seekbackward', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
      navigator.mediaSession.setActionHandler('seekto', function (details) {
        if (!details || typeof details.seekTime !== 'number') return;
        log('ms seekto');
        seekTo(details.seekTime);
      });
      updatePositionState(mediaVideo);
    } catch (error) {}
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
    } catch (error) {}
  }

  function nextTrack() {
    log('ms next');
    state.userPaused = false;
    state.shouldResume = true;
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
    state.userPaused = false;
    state.shouldResume = true;
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

  function seekRelative(seconds) {
    var video = getVideo();
    state.shouldResume = true;
    startAudioKeepAlive();

    if (callPlayerMethod(['seekBy'], [seconds])) {
      afterMediaCommand();
      return;
    }

    if (video && Number.isFinite(video.currentTime)) {
      seekTo(Math.max(0, video.currentTime + seconds));
      return;
    }

    sendShortcut(seconds > 0 ? 'L' : 'J', false);
    afterMediaCommand();
  }

  function seekTo(seconds) {
    var video = getVideo();
    state.shouldResume = true;
    startAudioKeepAlive();

    if (callPlayerMethod(['seekTo'], [seconds, true])) {
      afterMediaCommand();
      return;
    }

    if (video && Number.isFinite(video.duration)) {
      try {
        video.currentTime = Math.max(0, Math.min(video.duration || seconds, seconds));
      } catch (error) {}
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
      var name = methods[i];
      if (typeof player[name] === 'function') {
        try {
          player[name].apply(player, args);
          return true;
        } catch (error) {}
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

  function fireClick(target) {
    try {
      target.click();
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (type) {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch (error) {}
  }

  function sendShortcut(key, shiftKey) {
    var target = document.activeElement || document.body || document.documentElement;
    var code = 'Key' + key.toUpperCase();
    try {
      ['keydown', 'keyup'].forEach(function (type) {
        target.dispatchEvent(new KeyboardEvent(type, {
          key: key,
          code: code,
          keyCode: key.toUpperCase().charCodeAt(0),
          which: key.toUpperCase().charCodeAt(0),
          shiftKey: !!shiftKey,
          bubbles: true,
          cancelable: true
        }));
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  function blessGesture() {
    var video = getVideo();
    if (!video || !state.nativePlay) return;
    try {
      var promise = state.nativePlay.call(video);
      if (promise && promise.catch) promise.catch(function () {});
    } catch (error) {}
  }

  function attemptPlay(video) {
    var promise;
    try {
      promise = state.nativePlay.call(video);
    } catch (error) {
      return;
    }
    if (!promise || !promise.catch) return;
    promise.catch(function (error) {
      log('play blocked ' + (error && error.name) + (state.realBackgrounded ? ' (bg)' : ''));
      if (state.realBackgrounded) return;
      if (video.muted || state.inAd || state.userPaused) return;
      state.pendingUnmute = true;
      video.muted = true;
      var retry;
      try {
        retry = state.nativePlay.call(video);
      } catch (retryError) {
        retry = null;
      }
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
      if (video.paused) attemptPlay(video);
      updateMediaSession();
    }, delay || 0);
  }

  function startAudioKeepAlive() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    if (!state.audioCtx) {
      try {
        state.audioCtx = new AC();
      } catch (error) {
        return;
      }
    }

    if (state.audioCtx.state !== 'running') {
      try {
        state.audioCtx.resume().catch(function () {});
      } catch (error) {}
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
      } catch (error) {}
    }

    if (!state.silenceTimer) {
      state.silenceTimer = setInterval(function () {
        if (state.audioCtx && state.audioCtx.state !== 'running') {
          try {
            state.audioCtx.resume().catch(function () {});
          } catch (error) {}
        }
      }, 1500);
    }
  }

  function isVisibleButton(button) {
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    var rect = button.getBoundingClientRect();
    var style = window.getComputedStyle(button);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function isTubeAdPlaying() {
    var player = getPlayer();
    if (player && (
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting')
    )) return true;

    var skip = document.querySelector(
      '.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-container button'
    );
    return isVisibleButton(skip);
  }

  function dismissStillWatching() {
    var patterns = /still watching|continue watching|video paused|继续观看|仍在观看|還在觀看|继续播放|繼續播放/i;
    var containers = ['ytm-confirm-dialog-renderer button', 'tp-yt-paper-dialog button', 'yt-button-renderer button', 'button'];
    for (var i = 0; i < containers.length; i++) {
      var buttons = document.querySelectorAll(containers[i]);
      for (var j = 0; j < buttons.length; j++) {
        var button = buttons[j];
        var text = (button.innerText || button.textContent || button.getAttribute('aria-label') || '').trim();
        if (patterns.test(text) && isVisibleButton(button)) {
          log('dismiss still-watching');
          button.click();
          softResume(150);
          return;
        }
      }
    }
  }

  function mediaTick() {
    state.inAd = isTubeAdPlaying();
    dismissStillWatching();
    getVideo();
    updateMediaSession();

    if (state.shouldResume && !state.userPaused && !state.inAd) {
      var video = getVideo();
      if (video && video.paused && Date.now() > state.transitionUntil) softResume(0);
    }
  }

  function scheduleBurst() {
    state.burstUntil = Date.now() + 2500;
  }

  function startLoop() {
    if (state.timer) clearTimeout(state.timer);

    var loop = function () {
      mediaTick();
      var delay = state.inAd || Date.now() < state.burstUntil ? 120 : 700;
      state.timer = setTimeout(loop, delay);
    };

    loop();
  }

  function onNavigate() {
    state.video = null;
    state.player = null;
    state.mediaSessionBound = false;
    state.transitionUntil = Date.now() + 1500;
    scheduleBurst();
    mediaTick();
  }

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
    var panel = document.createElement('div');
    panel.id = 'ytm-debug-overlay';
    panel.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:55%;overflow:auto;background:rgba(0,0,0,0.92);color:#7CFC00;font:10px/1.5 monospace;z-index:2147483647;padding:10px;white-space:pre-wrap;-webkit-overflow-scrolling:touch;';
    panel.textContent = 'v' + VERSION + '\\n' + state.logs.slice(-150).join('\\n');
    document.body.appendChild(panel);
  }

  function destroy() {
    if (state.timer) clearTimeout(state.timer);
    if (state.silenceTimer) clearInterval(state.silenceTimer);
    if (adInterval) clearInterval(adInterval);
    if (obs) obs.disconnect();
    if (state.keepAliveOsc) {
      try { state.keepAliveOsc.stop(); } catch (error) {}
      state.keepAliveOsc = null;
    }
    if (state.video && state.video.__ytClearScriptableTubeListeners === VERSION) {
      state.video.removeEventListener('playing', onVideoPlaying);
      state.video.removeEventListener('play', onVideoPlaying);
      state.video.removeEventListener('pause', onVideoPause, true);
      state.video.removeEventListener('loadstart', markTransition);
      state.video.removeEventListener('emptied', markTransition);
      state.video.removeEventListener('canplay', onVideoCanPlay);
      state.video.removeEventListener('seeked', onVideoSeeked);
      state.video.removeEventListener('durationchange', scheduleBurst);
      delete state.video.__ytClearScriptableTubeListeners;
    }
    window.removeEventListener('popstate', onNavigate);
    window.removeEventListener('yt-navigate-finish', onNavigate);
    document.removeEventListener('touchstart', markGesture);
    document.removeEventListener('touchend', markGesture);
    document.removeEventListener('touchend', onDebugTap);
    document.removeEventListener('click', markGesture, true);
    document.removeEventListener('keydown', markGesture, true);
  }

  window.__ytClearScriptableTube = { version: VERSION, destroy: destroy, logs: state.logs };

  patchVisibility();
  patchBackgroundEventRegistration();
  patchMedia();
  updateMediaSession();

  document.addEventListener('touchstart', markGesture, { passive: true });
  document.addEventListener('touchend', markGesture, { passive: true });
  document.addEventListener('touchend', onDebugTap, { passive: true });
  document.addEventListener('click', markGesture, true);
  document.addEventListener('keydown', markGesture, true);

  window.addEventListener('popstate', onNavigate);
  window.addEventListener('yt-navigate-finish', onNavigate);

  getVideo();
  getPlayer();
  scheduleBurst();
  startLoop();

  return null;
})();
null;
`;

await webView.evaluateJavaScript(magicScript);
await webView.present(true);

}