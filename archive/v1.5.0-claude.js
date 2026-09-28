// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: play-circle;

const VERSION = '1.5.0-scriptable';

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

  var VERSION = '${VERSION}';
  var previous = window.__ytClearScriptableTube;
  if (previous && previous.version === VERSION) return null;
  if (previous && typeof previous.destroy === 'function') {
    try { previous.destroy(); } catch (e) {}
  }

  /* ─── 原生方法只保存一次：重复注入时不会层层包装 ─── */
  var NATIVE = window.__ytClearNatives || (window.__ytClearNatives = {
    play: HTMLMediaElement.prototype.play,
    pause: HTMLMediaElement.prototype.pause,
    addEventListener: EventTarget.prototype.addEventListener
  });

  /* ─── 真实的页面可见性 ───
     patchVisibility() 会把 document.hidden 伪装成 false，
     这里直接调用 Document.prototype 上的原始 getter 读取真实值 */
  var nativeHiddenGetter = null;
  try {
    var hiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    nativeHiddenGetter = hiddenDesc && hiddenDesc.get;
  } catch (e) {}

  function isReallyHidden() {
    try { return nativeHiddenGetter ? !!nativeHiddenGetter.call(document) : false; }
    catch (e) { return false; }
  }

  /* 视频是否处于 iOS 原生全屏 / 画中画（此时网页收不到任何 touch 事件） */
  function inNativePlayer(v) {
    if (!v) return false;
    if (v.webkitDisplayingFullscreen) return true;
    var mode = v.webkitPresentationMode;
    return mode === 'fullscreen' || mode === 'picture-in-picture';
  }

  /* ─── 统一登记监听器，destroy() 时全部移除 ─── */
  var listeners = [];
  function listen(target, type, fn, opts) {
    NATIVE.addEventListener.call(target, type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }

  /* ─── 国际化 ─── */
  var lang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  var isCN = lang.indexOf('zh') === 0;
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
    '.yt-pb svg{width:22px!important;height:22px!important;display:block!important;}',

    /* 横屏隐藏顶栏和侧边面板：交给 CSS，不再用 JS 每 300ms 改样式 */
    '@media (orientation: landscape){',
      '#yt-top-bar,#yt-panel{display:none!important;}',
      'ytm-app{padding-top:0!important;}',
    '}'
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

  /* ─── 横屏自动全屏 ───
     只在「竖屏 → 横屏」那一刻触发一次。
     旧版每 300ms 都会调用，导致横屏时手动退出全屏会被立刻拉回去。 */
  var lastLandscape = window.innerWidth > window.innerHeight;

  function isWatchPage() {
    return location.pathname.indexOf('/watch') === 0;
  }

  function tryFullscreen() {
    var v = getVideo();
    if (!v || !isWatchPage()) return;                     // 首页的预览视频不全屏
    if (!(window.innerWidth > window.innerHeight)) return; // 这 200ms 内又转回了竖屏
    if (v.readyState < 1 || !(v.duration > 0)) return;
    if (inNativePlayer(v)) return;
    if (typeof v.webkitEnterFullscreen === 'function') {
      try { v.webkitEnterFullscreen(); } catch (e) { log('fs failed ' + (e && e.name)); }
    } else if (typeof v.requestFullscreen === 'function') {
      try { v.requestFullscreen(); } catch (e) {}
    }
  }

  function onOrientationChange() {
    var isLandscape = window.innerWidth > window.innerHeight;
    if (isLandscape === lastLandscape) return;
    lastLandscape = isLandscape;
    if (isLandscape) setTimeout(tryFullscreen, 200);
  }

  function scheduleOrientationCheck() {
    setTimeout(onOrientationChange, 150);
  }

  /* ─── 本地搜索历史 ─── */
  var HISTORY_KEY = 'yt_search_history';
  var MAX_HISTORY = 8;

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

  /* ─── 搜索建议 JSONP（带序号：晚到的旧结果不会覆盖新结果） ─── */
  var suggestTimer = null;
  var suggestSeq = 0;

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
      if (seq !== suggestSeq) return;   // 用户已经继续输入或关闭了弹窗
      var list = [];
      if (data && data[1]) {
        for (var i = 0; i < Math.min(data[1].length, 6); i++) list.push(data[1][i][0]);
      }
      callback(list);
    };
    sc.onerror = function () {
      cleanup();
      if (seq === suggestSeq) callback([]);
    };
    sc.src = 'https://suggestqueries.google.com/complete/search?client=youtube&q='
      + encodeURIComponent(query) + '&callback=' + cbName;
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
      item.addEventListener('touchend', function (e) { e.preventDefault(); e.stopPropagation(); onTap(text); }, { passive: false });
      return item;
    }

    function renderSuggestions(list) {
      listBox.innerHTML = '';
      if (!list || !list.length) { listBox.style.setProperty('display', 'none', 'important'); return; }
      listBox.style.setProperty('display', 'flex', 'important');
      list.forEach(function (text) { listBox.appendChild(makeRow(searchIconSm, text, doNavigate)); });
      if (listBox.lastChild) listBox.lastChild.style.removeProperty('border-bottom');
    }

    function renderHistory() {
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
        listBox.appendChild(makeRow(clockIconSm, text, function (t) { inp.value = t; doNavigate(t); }));
      });
      if (listBox.lastChild) listBox.lastChild.style.removeProperty('border-bottom');
    }

    inp.addEventListener('input', function () {
      clearTimeout(suggestTimer);
      var q = inp.value.trim();
      if (!q) { suggestSeq++; renderHistory(); return; }
      suggestTimer = setTimeout(function () { fetchSuggestions(q, renderSuggestions); }, 220);
    });

    inp.addEventListener('focus', function () {
      if (!inp.value.trim()) renderHistory();
    });

    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doNavigate(); }
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

  /* ─── 面板 UI（只负责创建，横竖屏交给 CSS） ─── */
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

      var btnSearch = document.createElement('div');
      btnSearch.className = 'yt-pb';
      btnSearch.innerHTML = SVG.search;
      btnSearch.addEventListener('touchend', function (e) {
        e.preventDefault(); e.stopPropagation(); doSearch();
      }, { passive: false });

      var btnBack = document.createElement('div');
      btnBack.className = 'yt-pb';
      btnBack.innerHTML = SVG.back;
      btnBack.addEventListener('touchend', function (e) {
        e.preventDefault(); e.stopPropagation(); window.history.back();
      }, { passive: false });

      var btnHome = document.createElement('div');
      btnHome.className = 'yt-pb';
      btnHome.innerHTML = SVG.home;
      btnHome.addEventListener('touchend', function (e) {
        e.preventDefault(); e.stopPropagation(); goHome();
      }, { passive: false });

      panel.appendChild(btnSearch);
      panel.appendChild(btnBack);
      panel.appendChild(btnHome);
      root.appendChild(panel);
    } else if (panel.parentNode !== root) {
      root.appendChild(panel);
    }
  }

  /* ─── 强制 HD：偏好写一次 + 每次开始播放时设一次（不再每 300ms 轮询） ─── */
  function writeQualityPref() {
    try {
      window.localStorage.setItem('yt-player-quality', JSON.stringify({
        data: 'hd1080', creation: Date.now(), expiration: Date.now() + 2592000000
      }));
    } catch (e) {}
  }

  function forceHD() {
    var now = Date.now();
    if (now - state.lastHD < 1500) return;
    state.lastHD = now;
    var p = getPlayer();
    if (p && typeof p.setPlaybackQualityRange === 'function') {
      try { p.setPlaybackQualityRange('hd1080', 'hd1080'); } catch (e) {}
    }
  }

  /* ─── 跳过广告 ─── */
  var skipCooldown = false;
  var adMode = false;
  var adSaved = null;   // 广告前用户自己的静音 / 倍速，广告后恢复

  function skipAd() {
    var btn = document.querySelector(
      '.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-container button'
    );
    if (btn && btn.offsetParent) {
      btn.click();
      skipCooldown = true;
      setTimeout(function () { skipCooldown = false; }, 2000);
      return true;
    }
    return false;
  }

  function adTick() {
    ensureStyle();
    ensureUI();
    if (skipCooldown) return;

    var hasAd = isTubeAdPlaying();
    state.inAd = hasAd;
    var v = getVideo();

    if (hasAd) {
      if (!adMode) {
        adMode = true;
        adSaved = v ? {
          muted: v.muted,
          rate: (v.playbackRate > 0 && v.playbackRate <= 4) ? v.playbackRate : 1
        } : null;
        log('ad start');
      }
      if (skipAd()) return;
      if (v) {
        v.muted = true;
        if (v.playbackRate < 16) v.playbackRate = 16;
      }
    } else if (adMode) {
      adMode = false;
      log('ad end');
      if (v) {
        // 只撤销我们自己改的 16 倍速；YouTube 已经自己恢复了倍速就不动
        if (v.playbackRate > 4) v.playbackRate = adSaved ? adSaved.rate : 1;
        v.muted = adSaved ? adSaved.muted : false;
      }
      adSaved = null;
    }
  }

  /* ══════════════════════════════════════════════════════════
     锁屏播放 + 媒体会话 (移植自 YT Music 脚本 v3.4)
     ══════════════════════════════════════════════════════════ */

  /* 全屏里记为“用户暂停”后，如果这么短时间内就切后台/锁屏，
     说明其实是系统造成的暂停，撤销掉，保证后台续播 */
  var BG_PAUSE_GRACE = 800;

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
    nativePauseAt: 0,
    lastHD: 0,
    lastStillCheck: 0,
    patchedPlayers: [],
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
      listen(document, type, swallowBackgroundEvent, true);
    });
    ['pagehide', 'blur', 'freeze'].forEach(function (type) {
      listen(window, type, swallowBackgroundEvent, true);
    });
    ['pageshow', 'focus', 'resume'].forEach(function (type) {
      listen(window, type, onForeground, true);
      listen(document, type, onForeground, true);
    });
  }

  function swallowBackgroundEvent(event) {
    var type = event && event.type;
    var hardBg = isReallyHidden() || type === 'pagehide' || type === 'freeze';
    log('bg ' + type + (hardBg ? ' (hidden)' : ''));
    state.realBackgrounded = true;

    if (hardBg && state.nativePauseAt && Date.now() - state.nativePauseAt < BG_PAUSE_GRACE) {
      log('native pause was bg, revert');
      state.nativePauseAt = 0;
      state.userPaused = false;
      state.shouldResume = true;
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
    if (event && typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  }

  function syncResume() {
    var video = state.video || getVideo();
    if (!video || state.userPaused || state.inAd || !state.nativePlay) return;
    if (!video.paused || video.ended) return;
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
    var blocked = {
      visibilitychange: true,
      webkitvisibilitychange: true,
      pagehide: true,
      freeze: true,
      resume: true,
      blur: true
    };
    // 始终包装 NATIVE 原版，重复注入不会叠加
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (type && blocked[type] && (this === document || this === window)) {
        log('blocked listener ' + type);
        return;
      }
      return NATIVE.addEventListener.call(this, type, listener, options);
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
    if (!window.HTMLMediaElement) return;
    state.nativePlay = NATIVE.play;
    state.nativePause = NATIVE.pause;

    HTMLMediaElement.prototype.play = function () {
      if (this && this.tagName === 'VIDEO') {
        state.shouldResume = true;
        state.userPaused = false;
        state.nativePauseAt = 0;
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
    state.patchedPlayers.push(player);

    ['pauseVideo', 'stopVideo'].forEach(function (name) {
      var key = '__ytClearNative_' + name;
      // 优先取之前存下的原版，避免包装旧版本的包装函数
      var nativeMethod = player[key] || player[name];
      if (typeof nativeMethod !== 'function') return;
      player[key] = nativeMethod;
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

  function findVideo() {
    return document.querySelector('video.html5-main-video') ||
           document.querySelector('#movie_player video') ||
           document.querySelector('video');
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
      }
    }
    return state.video;
  }

  function onNativeFullscreenBegin() {
    log('fs begin');
  }

  function onNativeFullscreenEnd() {
    log('fs end');
    // 进入全屏时可能触发过 blur，把 realBackgrounded 误设为 true，这里按真实状态校正
    state.realBackgrounded = isReallyHidden();
    rebindMediaSession();
  }

  function onVideoPlaying() {
    log('playing');
    state.transitionUntil = 0;
    state.shouldResume = true;
    state.userPaused = false;
    state.nativePauseAt = 0;
    state.mediaSessionBound = false;
    startAudioKeepAlive();
    forceHD();
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

  /* ─── 暂停事件（全屏无法暂停的修复在这里） ───
     iOS 原生全屏 / 画中画用的是系统播放器，点暂停时网页收不到 touch，
     markGesture 不会触发，旧逻辑就把它当成“后台自动暂停”立刻恢复播放。 */
  function onVideoPause(event) {
    var video = (event && event.target) || getVideo();
    if (!video || state.userPaused || state.inAd) return;
    if (video.ended) return;                        // 自然播完：交给 YouTube 切下一个
    if (Date.now() < state.transitionUntil) return;

    if (inNativePlayer(video)) {
      // 画中画小窗本身就是给后台用的，里面的暂停一定是用户点的
      var pip = video.webkitPresentationMode === 'picture-in-picture';
      if (pip || !isReallyHidden()) {
        log('pause (' + (pip ? 'pip' : 'fullscreen') + ') -> user');
        state.userPaused = true;
        state.shouldResume = false;
        state.nativePauseAt = pip ? 0 : Date.now();
        updateMediaSession();
        return;
      }
      log('pause (native player) while hidden -> resume');
    }

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
        state.nativePauseAt = 0;
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
      if (video.paused && !video.ended) attemptPlay(video);
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

  /* ─── “仍在观看？”弹窗 ───
     2 秒查一次；用 textContent（innerText 每次都会触发重排，费电）。
     弹窗按钮文字通常只是“是 / Yes”，所以先按弹窗文字匹配，再点里面的按钮。 */
  var STILL_WATCHING = /still watching|continue watching|video paused|继续观看|仍在观看|還在觀看|继续播放|繼續播放/i;

  function dismissStillWatching() {
    var now = Date.now();
    if (now - state.lastStillCheck < 2000) return;
    state.lastStillCheck = now;

    var dialogs = document.querySelectorAll(
      'ytm-confirm-dialog-renderer, yt-confirm-dialog-renderer, tp-yt-paper-dialog, [role="dialog"], [role="alertdialog"]'
    );
    for (var i = 0; i < dialogs.length; i++) {
      if (!STILL_WATCHING.test(dialogs[i].textContent || '')) continue;
      var btns = dialogs[i].querySelectorAll('button');
      for (var j = btns.length - 1; j >= 0; j--) {   // 确认键一般在最后
        if (isVisibleButton(btns[j])) {
          log('dismiss still-watching (dialog)');
          btns[j].click();
          softResume(150);
          return;
        }
      }
    }

    // 兜底：按钮自身文字匹配（原逻辑）
    var buttons = document.querySelectorAll('button');
    for (var k = 0; k < buttons.length; k++) {
      var b = buttons[k];
      var text = (b.textContent || b.getAttribute('aria-label') || '').trim();
      if (text && STILL_WATCHING.test(text) && isVisibleButton(b)) {
        log('dismiss still-watching (button)');
        b.click();
        softResume(150);
        return;
      }
    }
  }

  function mediaTick() {
    dismissStillWatching();
    getVideo();
    updateMediaSession();

    if (state.shouldResume && !state.userPaused && !state.inAd) {
      var video = getVideo();
      if (video && video.paused && !video.ended && Date.now() > state.transitionUntil) softResume(0);
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

  /* ─── 调试面板：左上角 1.6 秒内连点 4 下 ─── */
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
    panel.textContent = 'v' + VERSION +
      '  fs=' + inNativePlayer(getVideo()) +
      '  hidden=' + isReallyHidden() +
      '  userPaused=' + state.userPaused +
      '  inAd=' + state.inAd + '\\n' +
      state.logs.slice(-150).join('\\n');
    document.body.appendChild(panel);
  }

  /* ─── 销毁：新版本注入时彻底清理旧实例 ─── */
  function destroy() {
    if (state.timer) clearTimeout(state.timer);
    if (state.silenceTimer) clearInterval(state.silenceTimer);
    if (adInterval) clearInterval(adInterval);
    clearTimeout(suggestTimer);

    if (state.keepAliveOsc) {
      try { state.keepAliveOsc.stop(); } catch (error) {}
      state.keepAliveOsc = null;
    }
    if (state.audioCtx) {
      try {
        var closing = state.audioCtx.close();
        if (closing && closing.catch) closing.catch(function () {});
      } catch (error) {}
      state.audioCtx = null;
    }

    listeners.forEach(function (l) {
      try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (error) {}
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
      try { delete p.__ytClearTubePlayerPatch; } catch (error) {}
    });
    if (state.video) {
      try { delete state.video.__ytClearBound; } catch (error) {}
    }

    ['hidden', 'visibilityState', 'webkitHidden', 'webkitVisibilityState', 'hasFocus'].forEach(function (k) {
      try { delete document[k]; } catch (error) {}
    });

    ['yt-panel', 'yt-top-bar', 'yt-ios-css', 'yt-search-modal', 'ytm-debug-overlay'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });

    if (window.__ytClearScriptableTube && window.__ytClearScriptableTube.destroy === destroy) {
      delete window.__ytClearScriptableTube;
    }
  }

  /* ─── 启动 ─── */
  var adInterval = null;

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

  adInterval = setInterval(adTick, 300);

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
