// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: play-circle;

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

  var VERSION = '1.5.0-scriptable';
  var previous = window.__ytClearScriptableTube;
  if (previous && previous.version === VERSION) return null;
  if (previous && typeof previous.destroy === 'function') {
    try { previous.destroy(); } catch (e) {}
  }

  /* =========================================================
     Internationalisation
     ========================================================= */
  var lang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  var isCN = lang.indexOf('zh') === 0;
  var I18N = {
    title:       isCN ? '搜索 YouTube' : 'Search YouTube',
    placeholder: isCN ? '输入搜索内容...' : 'Search...',
    cancel:      isCN ? '取消' : 'Cancel',
    search:      isCN ? '搜索' : 'Search',
    recent:      isCN ? '最近搜索' : 'Recent',
    clearAll:    isCN ? '清除' : 'Clear'
  };

  /* =========================================================
     CSS / UI
     ========================================================= */
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
    '.yt-pb svg{width:22px!important;height:22px!important;display:block!important;}'
  ].join('');

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

  function tryFullscreen() {
    var v = document.querySelector('video');
    if (!v) return;
    if (v.readyState < 1 || !Number.isFinite(v.duration) || v.duration <= 0) return;
    if (v.webkitDisplayingFullscreen) return;

    if (typeof v.webkitEnterFullscreen === 'function') {
      try { v.webkitEnterFullscreen(); } catch (e) {}
    } else if (typeof v.requestFullscreen === 'function') {
      try {
        var promise = v.requestFullscreen();
        if (promise && promise.catch) promise.catch(function () {});
      } catch (e) {}
    }
  }

  function applyOrientation() {
    var isLandscape = window.innerWidth > window.innerHeight;
    var bar = document.getElementById('yt-top-bar');
    var panel = document.getElementById('yt-panel');
    var app = document.querySelector('ytm-app');

    if (isLandscape) {
      if (bar) bar.style.setProperty('display', 'none', 'important');
      if (panel) panel.style.setProperty('display', 'none', 'important');
      if (app) app.style.setProperty('padding-top', '0', 'important');
      setTimeout(tryFullscreen, 220);
    } else {
      if (bar) bar.style.removeProperty('display');
      if (panel) panel.style.removeProperty('display');
      if (app) app.style.setProperty('padding-top', '90px', 'important');
    }
  }

  function onOrientationChange() {
    setTimeout(applyOrientation, 160);
  }

  window.addEventListener('resize', applyOrientation);
  window.addEventListener('orientationchange', onOrientationChange);

  /* =========================================================
     Search history and suggestions
     ========================================================= */
  var HISTORY_KEY = 'yt_search_history';
  var MAX_HISTORY = 8;
  var suggestTimer = null;
  var suggestSerial = 0;

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch (e) { return []; }
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

  function fetchSuggestions(query, callback) {
    if (!query) {
      suggestSerial += 1;
      callback([]);
      return;
    }

    var serial = ++suggestSerial;
    var cbName = 'ytSugCb_' + Date.now() + '_' + serial;
    var scriptId = 'yt-sug-script-' + serial;

    function cleanup() {
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      var el = document.getElementById(scriptId);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    window[cbName] = function (data) {
      cleanup();
      if (serial !== suggestSerial) return;

      var list = [];
      if (data && data[1]) {
        for (var i = 0; i < Math.min(data[1].length, 6); i++) {
          if (data[1][i] && data[1][i][0]) list.push(data[1][i][0]);
        }
      }
      callback(list);
    };

    var sc = document.createElement('script');
    sc.id = scriptId;
    sc.setAttribute('data-yt-clear-suggest', '1');
    sc.src = 'https://suggestqueries.google.com/complete/search?client=youtube&q=' +
      encodeURIComponent(query) + '&callback=' + cbName;
    sc.onerror = function () {
      cleanup();
      if (serial === suggestSerial) callback([]);
    };
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
    inp.autocapitalize = 'none';
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
      suggestSerial += 1;
      clearTimeout(suggestTimer);
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

    var searchIconSm = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>';
    var clockIconSm = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>';

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
      item.addEventListener('touchend', function (e) {
        e.preventDefault();
        e.stopPropagation();
        onTap(text);
      }, { passive: false });
      return item;
    }

    function renderSuggestions(list) {
      listBox.innerHTML = '';
      if (!list || !list.length) {
        listBox.style.setProperty('display', 'none', 'important');
        return;
      }

      listBox.style.setProperty('display', 'flex', 'important');
      list.forEach(function (text) {
        listBox.appendChild(makeRow(searchIconSm, text, doNavigate));
      });
      if (listBox.lastChild) listBox.lastChild.style.removeProperty('border-bottom');
    }

    function renderHistory() {
      suggestSerial += 1;
      listBox.innerHTML = '';
      var hist = getHistory();

      if (!hist.length) {
        listBox.style.setProperty('display', 'none', 'important');
        return;
      }

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
        e.preventDefault();
        clearHistory();
        listBox.innerHTML = '';
        listBox.style.setProperty('display', 'none', 'important');
      }, { passive: false });

      hdr.appendChild(hdrLabel);
      hdr.appendChild(clearBtn);
      listBox.appendChild(hdr);

      hist.forEach(function (text) {
        listBox.appendChild(makeRow(clockIconSm, text, function (t) {
          inp.value = t;
          doNavigate(t);
        }));
      });
      if (listBox.lastChild) listBox.lastChild.style.removeProperty('border-bottom');
    }

    inp.addEventListener('input', function () {
      clearTimeout(suggestTimer);
      var q = inp.value.trim();

      if (!q) {
        renderHistory();
        return;
      }

      suggestTimer = setTimeout(function () {
        fetchSuggestions(q, renderSuggestions);
      }, 250);
    });

    inp.addEventListener('focus', function () {
      if (!inp.value.trim()) renderHistory();
    });

    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        doNavigate();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
    });

    cancelBtn.addEventListener('touchend', function (e) {
      e.preventDefault();
      closeModal();
    }, { passive: false });

    confirmBtn.addEventListener('touchend', function (e) {
      e.preventDefault();
      doNavigate();
    }, { passive: false });

    overlay.addEventListener('touchend', function (e) {
      if (e.target === overlay) {
        e.preventDefault();
        closeModal();
      }
    }, { passive: false });

    box.appendChild(titleRow);
    box.appendChild(inputRow);
    box.appendChild(listBox);
    box.appendChild(confirmBtn);
    overlay.appendChild(box);
    document.documentElement.appendChild(overlay);

    setTimeout(function () {
      inp.focus();
      renderHistory();
    }, 120);
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
      if (el) {
        el.click();
        return;
      }
    }

    try {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    } catch (e) {
      window.location.href = 'https://m.youtube.com/';
    }
  }

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
      btnSearch.setAttribute('role', 'button');
      btnSearch.setAttribute('aria-label', I18N.search);
      btnSearch.addEventListener('touchend', function (e) {
        e.preventDefault();
        e.stopPropagation();
        doSearch();
      }, { passive: false });

      var btnBack = document.createElement('div');
      btnBack.className = 'yt-pb';
      btnBack.innerHTML = SVG.back;
      btnBack.setAttribute('role', 'button');
      btnBack.setAttribute('aria-label', 'Back');
      btnBack.addEventListener('touchend', function (e) {
        e.preventDefault();
        e.stopPropagation();
        window.history.back();
      }, { passive: false });

      var btnHome = document.createElement('div');
      btnHome.className = 'yt-pb';
      btnHome.innerHTML = SVG.home;
      btnHome.setAttribute('role', 'button');
      btnHome.setAttribute('aria-label', 'Home');
      btnHome.addEventListener('touchend', function (e) {
        e.preventDefault();
        e.stopPropagation();
        goHome();
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

  /* =========================================================
     DOM observer - only repairs our UI when needed
     ========================================================= */
  var uiTimer = null;
  var obs = new MutationObserver(function () {
    var uiExists =
      document.getElementById('yt-ios-css') &&
      document.getElementById('yt-top-bar') &&
      document.getElementById('yt-panel');

    if (uiExists) return;

    clearTimeout(uiTimer);
    uiTimer = setTimeout(function () {
      ensureStyle();
      ensureUI();
    }, 150);
  });

  function startObs() {
    try {
      obs.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
    } catch (e) {}
  }

  if (document.body) startObs();
  else document.addEventListener('DOMContentLoaded', startObs, { once: true });

  /* =========================================================
     Media state
     ========================================================= */
  var state = {
    timer: null,
    audioCtx: null,
    silenceTimer: null,
    keepAliveOsc: null,
    keepAliveGain: null,

    video: null,
    player: null,

    inAd: false,
    adRestorePending: false,
    preAdPlaybackRate: 1,
    preAdMuted: false,
    skipCooldownUntil: 0,

    burstUntil: 0,
    lastMediaSessionRefresh: 0,
    mediaSessionBound: false,

    shouldResume: false,
    userPaused: false,
    recentGestureUntil: 0,
    allowPauseUntil: 0,
    transitionUntil: 0,
    realBackgrounded: false,
    nativeFullscreen: false,

    mediaPatched: false,
    nativePlay: null,
    nativePause: null,
    patchedPlay: null,
    patchedPause: null,

    eventRegistrationPatched: false,
    nativeAddEventListener: null,
    patchedAddEventListener: null,

    ownDocumentDescriptors: {},
    nativeHiddenDescriptor: null,
    hadOwnHasFocus: false,
    nativeHasFocus: null,

    pendingUnmute: false,
    debugTaps: [],
    logs: []
  };

  function log(message) {
    try {
      var t = new Date();
      state.logs.push(
        t.toTimeString().slice(0, 8) + '.' +
        ('00' + t.getMilliseconds()).slice(-3) + ' ' + message
      );
      if (state.logs.length > 300) state.logs.splice(0, 100);
    } catch (e) {}
  }

  function findDescriptor(object, prop) {
    var current = object;
    while (current) {
      var descriptor = Object.getOwnPropertyDescriptor(current, prop);
      if (descriptor) return descriptor;
      current = Object.getPrototypeOf(current);
    }
    return null;
  }

  function readNativeHidden() {
    try {
      var d = state.nativeHiddenDescriptor;
      if (!d) return false;
      if (typeof d.get === 'function') return !!d.get.call(document);
      return !!d.value;
    } catch (e) {
      return false;
    }
  }

  function isNativeFullscreen(video) {
    video = video || state.video;
    if (!video) return !!state.nativeFullscreen;

    try {
      return !!(
        state.nativeFullscreen ||
        video.webkitDisplayingFullscreen === true
      );
    } catch (e) {
      return !!state.nativeFullscreen;
    }
  }

  function patchVisibility() {
    state.nativeHiddenDescriptor = findDescriptor(document, 'hidden');
    state.hadOwnHasFocus = Object.prototype.hasOwnProperty.call(document, 'hasFocus');
    state.nativeHasFocus = document.hasFocus;

    ['hidden', 'visibilityState', 'webkitHidden', 'webkitVisibilityState'].forEach(function (prop) {
      try {
        state.ownDocumentDescriptors[prop] = Object.getOwnPropertyDescriptor(document, prop) || null;
      } catch (e) {
        state.ownDocumentDescriptors[prop] = null;
      }
    });

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
    } catch (e) {
      log('visibility patch partial');
    }

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

  function restoreVisibilityPatch() {
    ['hidden', 'visibilityState', 'webkitHidden', 'webkitVisibilityState'].forEach(function (prop) {
      try {
        var descriptor = state.ownDocumentDescriptors[prop];
        if (descriptor) Object.defineProperty(document, prop, descriptor);
        else delete document[prop];
      } catch (e) {}
    });

    try {
      if (state.hadOwnHasFocus) document.hasFocus = state.nativeHasFocus;
      else delete document.hasFocus;
    } catch (e) {}
  }

  function swallowBackgroundEvent(event) {
    var type = event && event.type ? event.type : 'unknown';
    var video = state.video || document.querySelector('video');
    var nativeHidden = readNativeHidden();

    /*
       iOS native fullscreen can emit blur/visibility-like transitions while
       the system video controller takes over. That must NOT be treated as an
       app-background event, otherwise a user's fullscreen Pause gets resumed.
    */
    if (
      isNativeFullscreen(video) &&
      !nativeHidden &&
      (type === 'blur' || type === 'visibilitychange' || type === 'webkitvisibilitychange')
    ) {
      log(type + ' ignored (native fullscreen)');
      return;
    }

    log('bg ' + type);
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
    } catch (e) {}
  }

  function patchBackgroundEventRegistration() {
    if (state.eventRegistrationPatched) return;
    state.eventRegistrationPatched = true;

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

    state.nativeAddEventListener = EventTarget.prototype.addEventListener;

    state.patchedAddEventListener = function (type, listener, options) {
      if (
        type &&
        (blockedTargets[type] || softBlockedTargets[type]) &&
        (this === document || this === window)
      ) {
        log('blocked listener ' + type);
        return;
      }
      return state.nativeAddEventListener.call(this, type, listener, options);
    };

    EventTarget.prototype.addEventListener = state.patchedAddEventListener;
  }

  function restoreBackgroundEventRegistration() {
    try {
      if (
        state.eventRegistrationPatched &&
        state.nativeAddEventListener &&
        EventTarget.prototype.addEventListener === state.patchedAddEventListener
      ) {
        EventTarget.prototype.addEventListener = state.nativeAddEventListener;
      }
    } catch (e) {}
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

    state.patchedPlay = function () {
      if (this && this.tagName === 'VIDEO') {
        state.shouldResume = true;
        state.userPaused = false;
      }
      return state.nativePlay.apply(this, arguments);
    };

    state.patchedPause = function () {
      if (this && this.tagName === 'VIDEO') {
        var now = Date.now();

        if (now < state.transitionUntil) {
          log('pause ok (transition)');
          return state.nativePause.apply(this, arguments);
        }

        var fullscreenPause =
          isNativeFullscreen(this) &&
          !state.realBackgrounded;

        var userIntent =
          now < state.recentGestureUntil ||
          now < state.allowPauseUntil ||
          fullscreenPause;

        /*
           v1.5.0 key fix:
           "shouldResume" only describes desired playback state.
           It is NOT evidence that a pause is automatic.
           We block pause only when the app is genuinely backgrounded.
        */
        var autoPause =
          state.realBackgrounded &&
          state.shouldResume;

        if (!userIntent && autoPause && !state.userPaused) {
          log('pause blocked (background)');
          softResume(80);
          return undefined;
        }

        if (userIntent) {
          state.userPaused = true;
          state.shouldResume = false;
          stopAudioKeepAlive();

          if (fullscreenPause) log('pause ok (native fullscreen)');
          else log('pause ok (user)');
        }
      }

      return state.nativePause.apply(this, arguments);
    };

    HTMLMediaElement.prototype.play = state.patchedPlay;
    HTMLMediaElement.prototype.pause = state.patchedPause;
  }

  function restoreMediaPatch() {
    try {
      if (
        state.nativePlay &&
        HTMLMediaElement.prototype.play === state.patchedPlay
      ) {
        HTMLMediaElement.prototype.play = state.nativePlay;
      }
    } catch (e) {}

    try {
      if (
        state.nativePause &&
        HTMLMediaElement.prototype.pause === state.patchedPause
      ) {
        HTMLMediaElement.prototype.pause = state.nativePause;
      }
    } catch (e) {}
  }

  function markGesture() {
    state.recentGestureUntil = Date.now() + 1300;
    if (!state.userPaused) startAudioKeepAlive();
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
        var fullscreenPause =
          isNativeFullscreen(state.video) &&
          !state.realBackgrounded;

        var userIntent =
          now < state.recentGestureUntil ||
          now < state.allowPauseUntil ||
          fullscreenPause;

        var transition = now < state.transitionUntil;

        /* Same state-machine correction as HTMLMediaElement.pause(). */
        var autoPause =
          state.realBackgrounded &&
          state.shouldResume;

        if (!userIntent && !transition && autoPause && !state.userPaused) {
          log(name + ' blocked (background)');
          softResume(80);
          return undefined;
        }

        if (userIntent) {
          state.userPaused = true;
          state.shouldResume = false;
          stopAudioKeepAlive();
        }

        return nativeMethod.apply(player, arguments);
      };
    });
  }

  function restorePlayerMethods(player) {
    if (!player) return;

    ['pauseVideo', 'stopVideo'].forEach(function (name) {
      var nativeMethod = player['__ytClearNative_' + name];
      if (typeof nativeMethod === 'function') {
        try { player[name] = nativeMethod; } catch (e) {}
        try { delete player['__ytClearNative_' + name]; } catch (e) {}
      }
    });

    try { delete player.__ytClearTubePlayerPatch; } catch (e) {}
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
        state.video.addEventListener('webkitbeginfullscreen', onBeginFullscreen, { passive: true });
        state.video.addEventListener('webkitendfullscreen', onEndFullscreen, { passive: true });
      }
    }

    return state.video;
  }

  function onBeginFullscreen() {
    state.nativeFullscreen = true;
    state.realBackgrounded = false;
    log('fullscreen begin');
    rebindMediaSession();
  }

  function onEndFullscreen() {
    state.nativeFullscreen = false;
    log('fullscreen end');
    rebindMediaSession();

    var video = state.video || document.querySelector('video');
    if (video && !video.paused) {
      state.userPaused = false;
      state.shouldResume = true;
    }
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

    setTimeout(function () {
      if (!state.inAd) forceHD();
    }, 350);

    scheduleBurst();
    updateMediaSession();
  }

  function onVideoPause() {
    var video = state.video || getVideo();

    if (state.inAd) return;
    if (Date.now() < state.transitionUntil) return;

    /*
       Native iOS fullscreen controls may pause the AV player without a
       DOM touch event reaching the page. Treat that pause as user intent.
    */
    if (!state.realBackgrounded && isNativeFullscreen(video)) {
      state.userPaused = true;
      state.shouldResume = false;
      stopAudioKeepAlive();
      log('pause accepted (native fullscreen)');
      updateMediaSession();
      return;
    }

    if (state.userPaused) {
      stopAudioKeepAlive();
      updateMediaSession();
      return;
    }

    /* Only recover an unsolicited pause when truly backgrounded. */
    if (state.realBackgrounded && state.shouldResume) {
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

  /* =========================================================
     Media Session
     ========================================================= */
  function setMediaAction(name, handler) {
    if (!navigator.mediaSession) return;
    try {
      navigator.mediaSession.setActionHandler(name, handler);
    } catch (e) {
      log('ms unsupported ' + name);
    }
  }

  function updateMediaSession() {
    if (!navigator.mediaSession) return;

    try {
      var mediaVideo = getVideo();
      navigator.mediaSession.playbackState =
        (mediaVideo && !mediaVideo.paused && !mediaVideo.ended) ? 'playing' : 'paused';

      updatePositionState(mediaVideo);

      if (
        state.mediaSessionBound &&
        Date.now() - state.lastMediaSessionRefresh < 3000
      ) {
        return;
      }

      state.mediaSessionBound = true;
      state.lastMediaSessionRefresh = Date.now();

      setMediaAction('play', function () {
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

      setMediaAction('pause', function () {
        log('ms pause');
        var video = getVideo();
        state.allowPauseUntil = Date.now() + 1500;
        state.userPaused = true;
        state.shouldResume = false;
        stopAudioKeepAlive();

        if (video && state.nativePause) {
          try { state.nativePause.call(video); } catch (e) {}
        }
        updateMediaSession();
      });

      setMediaAction('previoustrack', function () {
        previousTrack();
      });

      setMediaAction('nexttrack', function () {
        nextTrack();
      });

      setMediaAction('seekbackward', function (details) {
        var amount =
          details && typeof details.seekOffset === 'number'
            ? details.seekOffset
            : 10;
        seekRelative(-Math.abs(amount));
      });

      setMediaAction('seekforward', function (details) {
        var amount =
          details && typeof details.seekOffset === 'number'
            ? details.seekOffset
            : 10;
        seekRelative(Math.abs(amount));
      });

      setMediaAction('seekto', function (details) {
        if (!details || typeof details.seekTime !== 'number') return;
        log('ms seekto');
        seekTo(details.seekTime);
      });
    } catch (e) {
      log('media session error');
    }
  }

  function rebindMediaSession() {
    state.mediaSessionBound = false;
    updateMediaSession();
  }

  function updatePositionState(video) {
    if (
      !navigator.mediaSession ||
      typeof navigator.mediaSession.setPositionState !== 'function'
    ) return;
    if (!video || state.inAd) return;

    var duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;

    var position = Math.min(
      Math.max(video.currentTime || 0, 0),
      duration
    );

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
    state.userPaused = false;
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
    state.userPaused = false;
    state.shouldResume = true;
    startAudioKeepAlive();

    if (callPlayerMethod(['seekTo'], [seconds, true])) {
      afterMediaCommand();
      return;
    }

    if (video && Number.isFinite(video.duration)) {
      try {
        video.currentTime = Math.max(
          0,
          Math.min(video.duration || seconds, seconds)
        );
      } catch (e) {}
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
        } catch (e) {}
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
    if (!button) return false;
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    if (button.matches && button.matches('[disabled]')) return false;
    return true;
  }

  function fireClick(target) {
    if (!target) return;

    try {
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (type) {
        try {
          target.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window
          }));
        } catch (e) {}
      });

      /* One real click only. The old implementation could click twice. */
      target.click();
    } catch (e) {}
  }

  function sendShortcut(key, shiftKey) {
    var target = document.activeElement || document.body || document.documentElement;
    var upper = key.toUpperCase();
    var code = 'Key' + upper;

    try {
      ['keydown', 'keyup'].forEach(function (type) {
        target.dispatchEvent(new KeyboardEvent(type, {
          key: key,
          code: code,
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

  function blessGesture() {
    var video = getVideo();
    if (!video || !state.nativePlay) return;

    try {
      var promise = state.nativePlay.call(video);
      if (promise && promise.catch) promise.catch(function () {});
    } catch (e) {}
  }

  function attemptPlay(video) {
    if (!video || !state.nativePlay) return;

    var promise;
    try {
      promise = state.nativePlay.call(video);
    } catch (e) {
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

  /* =========================================================
     Audio keep-alive
     ========================================================= */
  function startAudioKeepAlive() {
    if (state.userPaused) return;

    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    if (!state.audioCtx) {
      try {
        state.audioCtx = new AC();
      } catch (e) {
        return;
      }
    }

    if (state.audioCtx.state !== 'running') {
      try {
        var resumePromise = state.audioCtx.resume();
        if (resumePromise && resumePromise.catch) resumePromise.catch(function () {});
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

        state.keepAliveGain = gain;
        state.keepAliveOsc = osc;
      } catch (e) {}
    }

    if (!state.silenceTimer) {
      state.silenceTimer = setInterval(function () {
        if (state.userPaused) return;
        if (state.audioCtx && state.audioCtx.state !== 'running') {
          try {
            var p = state.audioCtx.resume();
            if (p && p.catch) p.catch(function () {});
          } catch (e) {}
        }
      }, 1500);
    }
  }

  function stopAudioKeepAlive() {
    if (state.silenceTimer) {
      clearInterval(state.silenceTimer);
      state.silenceTimer = null;
    }

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

  /* =========================================================
     HD preference and ad handling
     ========================================================= */
  function forceHD() {
    try {
      window.localStorage.setItem('yt-player-quality', JSON.stringify({
        data: 'hd1080',
        creation: Date.now(),
        expiration: Date.now() + 2592000000
      }));
    } catch (e) {}

    var p = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (p && typeof p.setPlaybackQualityRange === 'function') {
      try { p.setPlaybackQualityRange('hd1080', 'hd1080'); } catch (e) {}
    }
  }

  function isVisibleButton(button) {
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;

    try {
      var rect = button.getBoundingClientRect();
      var style = window.getComputedStyle(button);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      );
    } catch (e) {
      return false;
    }
  }

  function isTubeAdPlaying() {
    var player = getPlayer();

    if (
      player &&
      (
        player.classList.contains('ad-showing') ||
        player.classList.contains('ad-interrupting')
      )
    ) return true;

    var skip = document.querySelector(
      '.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-container button'
    );

    return isVisibleButton(skip);
  }

  function skipAd() {
    if (Date.now() < state.skipCooldownUntil) return false;

    var btn = document.querySelector(
      '.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-container button'
    );

    if (isVisibleButton(btn)) {
      try { btn.click(); } catch (e) { return false; }
      state.skipCooldownUntil = Date.now() + 1800;
      log('ad skip');
      return true;
    }

    return false;
  }

  function handleAdState() {
    var hasAd = isTubeAdPlaying();
    var video = getVideo();

    if (hasAd) {
      if (!state.inAd) {
        state.inAd = true;
        state.adRestorePending = true;

        if (video) {
          state.preAdPlaybackRate =
            Number.isFinite(video.playbackRate) && video.playbackRate > 0
              ? video.playbackRate
              : 1;

          state.preAdMuted = !!video.muted;
        }

        log('ad begin rate=' + state.preAdPlaybackRate + ' muted=' + state.preAdMuted);
      }

      if (skipAd()) return;

      if (video) {
        try { video.muted = true; } catch (e) {}

        try {
          if (video.playbackRate < 16) {
            video.playbackRate = 16;
          }
        } catch (e) {}
      }

      return;
    }

    if (state.inAd) {
      state.inAd = false;
      log('ad end');

      if (video && state.adRestorePending) {
        try {
          video.playbackRate = state.preAdPlaybackRate || 1;
        } catch (e) {}

        try {
          video.muted = !!state.preAdMuted;
        } catch (e) {}
      }

      state.adRestorePending = false;
      state.skipCooldownUntil = 0;
      rebindMediaSession();
    }
  }

  function dismissStillWatching() {
    var patterns = /still watching|continue watching|video paused|继续观看|仍在观看|還在觀看|继续播放|繼續播放/i;

    var containers = [
      'ytm-confirm-dialog-renderer button',
      'tp-yt-paper-dialog button',
      'yt-button-renderer button',
      'button'
    ];

    for (var i = 0; i < containers.length; i++) {
      var buttons = document.querySelectorAll(containers[i]);

      for (var j = 0; j < buttons.length; j++) {
        var button = buttons[j];

        var text = (
          button.innerText ||
          button.textContent ||
          button.getAttribute('aria-label') ||
          ''
        ).trim();

        if (patterns.test(text) && isVisibleButton(button)) {
          log('dismiss still-watching');

          try {
            button.click();
          } catch (e) {}

          softResume(150);
          return;
        }
      }
    }
  }

  /* =========================================================
     Main media loop
     ========================================================= */
  function mediaTick() {
    getVideo();
    getPlayer();
    handleAdState();
    dismissStillWatching();
    updateMediaSession();

    if (
      state.shouldResume &&
      !state.userPaused &&
      !state.inAd
    ) {
      var video = getVideo();

      if (
        video &&
        video.paused &&
        Date.now() > state.transitionUntil &&
        state.realBackgrounded
      ) {
        softResume(0);
      }
    }
  }

  function scheduleBurst() {
    state.burstUntil = Date.now() + 2500;
  }

  function startLoop() {
    if (state.timer) {
      clearTimeout(state.timer);
    }

    var loop = function () {
      mediaTick();

      var delay =
        state.inAd ||
        Date.now() < state.burstUntil
          ? 120
          : 700;

      state.timer = setTimeout(loop, delay);
    };

    loop();
  }

  function onNavigate() {
    if (state.player) {
      restorePlayerMethods(state.player);
    }

    state.video = null;
    state.player = null;
    state.mediaSessionBound = false;
    state.nativeFullscreen = false;
    state.transitionUntil = Date.now() + 1500;
    state.inAd = false;
    state.adRestorePending = false;

    scheduleBurst();
    ensureStyle();
    ensureUI();
    mediaTick();

    setTimeout(function () {
      forceHD();
    }, 700);
  }

  /* =========================================================
     Debug overlay: tap top-left four times quickly
     ========================================================= */
  function onDebugTap(event) {
    var touch =
      event.changedTouches &&
      event.changedTouches[0];

    if (
      !touch ||
      touch.clientX > 90 ||
      touch.clientY > 110
    ) {
      return;
    }

    var now = Date.now();

    state.debugTaps =
      state.debugTaps.filter(function (t) {
        return now - t < 1600;
      });

    state.debugTaps.push(now);

    if (state.debugTaps.length >= 4) {
      state.debugTaps = [];
      toggleDebugOverlay();
    }
  }

  function toggleDebugOverlay() {
    var existing =
      document.getElementById('ytm-debug-overlay');

    if (existing) {
      existing.parentNode.removeChild(existing);
      return;
    }

    var panel = document.createElement('div');
    panel.id = 'ytm-debug-overlay';

    panel.style.cssText = [
      'position:fixed;',
      'left:0;',
      'right:0;',
      'bottom:0;',
      'max-height:55%;',
      'overflow:auto;',
      'background:rgba(0,0,0,0.92);',
      'color:#7CFC00;',
      'font:10px/1.5 monospace;',
      'z-index:2147483647;',
      'padding:10px;',
      'white-space:pre-wrap;',
      '-webkit-overflow-scrolling:touch;'
    ].join('');

    panel.textContent =
      'v' +
      VERSION +
      '\\n' +
      state.logs.slice(-150).join('\\n');

    document.body.appendChild(panel);
  }

  /* =========================================================
     Clean teardown for future versions
     ========================================================= */
  function removeVideoListeners(video) {
    if (
      !video ||
      video.__ytClearScriptableTubeListeners !== VERSION
    ) {
      return;
    }

    try {
      video.removeEventListener(
        'playing',
        onVideoPlaying
      );
    } catch (e) {}

    try {
      video.removeEventListener(
        'play',
        onVideoPlaying
      );
    } catch (e) {}

    try {
      video.removeEventListener(
        'pause',
        onVideoPause,
        true
      );
    } catch (e) {}

    try {
      video.removeEventListener(
        'loadstart',
        markTransition
      );
    } catch (e) {}

    try {
      video.removeEventListener(
        'emptied',
        markTransition
      );
    } catch (e) {}

    try {
      video.removeEventListener(
        'canplay',
        onVideoCanPlay
      );
    } catch (e) {}

    try {
      video.removeEventListener(
        'seeked',
        onVideoSeeked
      );
    } catch (e) {}

    try {
      video.removeEventListener(
        'durationchange',
        scheduleBurst
      );
    } catch (e) {}

    try {
      video.removeEventListener(
        'webkitbeginfullscreen',
        onBeginFullscreen
      );
    } catch (e) {}

    try {
      video.removeEventListener(
        'webkitendfullscreen',
        onEndFullscreen
      );
    } catch (e) {}

    try {
      delete video.__ytClearScriptableTubeListeners;
    } catch (e) {}
  }

  function destroy() {
    log('destroy');

    clearTimeout(uiTimer);
    clearTimeout(suggestTimer);

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (obs) {
      try {
        obs.disconnect();
      } catch (e) {}
    }

    stopAudioKeepAlive();

    if (state.audioCtx) {
      try {
        var closePromise = state.audioCtx.close();

        if (
          closePromise &&
          closePromise.catch
        ) {
          closePromise.catch(function () {});
        }
      } catch (e) {}

      state.audioCtx = null;
    }

    removeVideoListeners(state.video);
    restorePlayerMethods(state.player);

    window.removeEventListener(
      'resize',
      applyOrientation
    );

    window.removeEventListener(
      'orientationchange',
      onOrientationChange
    );

    window.removeEventListener(
      'popstate',
      onNavigate
    );

    window.removeEventListener(
      'yt-navigate-finish',
      onNavigate
    );

    document.removeEventListener(
      'touchstart',
      markGesture
    );

    document.removeEventListener(
      'touchend',
      markGesture
    );

    document.removeEventListener(
      'touchend',
      onDebugTap
    );

    document.removeEventListener(
      'click',
      markGesture,
      true
    );

    document.removeEventListener(
      'keydown',
      markGesture,
      true
    );

    [
      'visibilitychange',
      'webkitvisibilitychange',
      'freeze'
    ].forEach(function (type) {
      document.removeEventListener(
        type,
        swallowBackgroundEvent,
        true
      );
    });

    [
      'pagehide',
      'blur',
      'freeze'
    ].forEach(function (type) {
      window.removeEventListener(
        type,
        swallowBackgroundEvent,
        true
      );
    });

    [
      'pageshow',
      'focus',
      'resume'
    ].forEach(function (type) {
      window.removeEventListener(
        type,
        onForeground,
        true
      );

      document.removeEventListener(
        type,
        onForeground,
        true
      );
    });

    var suggestScripts =
      document.querySelectorAll(
        'script[data-yt-clear-suggest="1"]'
      );

    for (
      var i = 0;
      i < suggestScripts.length;
      i++
    ) {
      if (suggestScripts[i].parentNode) {
        suggestScripts[i].parentNode.removeChild(
          suggestScripts[i]
        );
      }
    }

    var debugOverlay =
      document.getElementById(
        'ytm-debug-overlay'
      );

    if (
      debugOverlay &&
      debugOverlay.parentNode
    ) {
      debugOverlay.parentNode.removeChild(
        debugOverlay
      );
    }

    restoreMediaPatch();
    restoreBackgroundEventRegistration();
    restoreVisibilityPatch();
  }

  /* =========================================================
     Install
     ========================================================= */
  window.__ytClearScriptableTube = {
    version: VERSION,
    destroy: destroy,
    logs: state.logs
  };

  patchVisibility();
  patchBackgroundEventRegistration();
  patchMedia();
  updateMediaSession();

  document.addEventListener(
    'touchstart',
    markGesture,
    { passive: true }
  );

  document.addEventListener(
    'touchend',
    markGesture,
    { passive: true }
  );

  document.addEventListener(
    'touchend',
    onDebugTap,
    { passive: true }
  );

  document.addEventListener(
    'click',
    markGesture,
    true
  );

  document.addEventListener(
    'keydown',
    markGesture,
    true
  );

  window.addEventListener(
    'popstate',
    onNavigate
  );

  window.addEventListener(
    'yt-navigate-finish',
    onNavigate
  );

  ensureStyle();
  ensureUI();
  getVideo();
  getPlayer();
  scheduleBurst();
  startLoop();

  setTimeout(
    forceHD,
    800
  );

  return null;
})();
null;
`;

  await webView.evaluateJavaScript(magicScript);
  await webView.present(true);
}