// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: music;

if (!config.runsInApp) {
  const alert = new Alert();
  alert.title = '需要在 Scriptable App 内运行';
  alert.message = [
    '这个脚本要先配置 WebView 再注入去广告代码。',
    '',
    '请在快捷指令的 Scriptable 动作里打开 Run In App / 在 App 中运行，然后再添加到桌面。',
    '',
    '不要使用普通的 Run Scriptable Script 扩展模式，也不要用 WebView.loadURL 的快捷指令小窗。'
  ].join('\\n');
  alert.addAction('知道了');
  await alert.presentAlert();
  Script.complete();
} else {

const url = 'https://music.youtube.com';
const webView = new WebView();

await webView.loadURL(url);

const magicScript = `
(function () {
  'use strict';

  var VERSION = '3.5.4-scriptable';
  var previous = window.__ytClearScriptableMusic;
  if (previous && previous.version === VERSION) return null;
  if (previous && typeof previous.destroy === 'function') previous.destroy();

  var state = {
    timer: null,
    observer: null,
    audioCtx: null,
    silenceTimer: null,
    video: null,
    player: null,
    inAd: false,
    burstUntil: 0,
    cooldownUntil: 0,
    lastSkipClick: 0,
    originalRate: 1,
    originalMuted: false,
    touchedRate: false,
    touchedMute: false,
    shouldResume: false,
    userPaused: false,
    recentGestureUntil: 0,
    allowPauseUntil: 0,
    transitionUntil: 0,
    realBackgrounded: false,
    mediaPatched: false,
    mediaSessionBound: false,
    lastMediaSessionRefresh: 0,
    nativePlay: null,
    nativePause: null,
    keepAliveOsc: null,
    pendingUnmute: false,
    lastTapPoint: null,
    debugTaps: [],
    logs: []
  };

  var css = [
    'html,body{touch-action:manipulation!important;-webkit-tap-highlight-color:transparent!important;}',
    '*{-webkit-tap-highlight-color:transparent!important;}',
    [
      'ytmusic-ad-instream-ads-renderer',
      'ytmusic-mealbar-promo-renderer',
      'ytmusic-statement-banner-renderer',
      'ytmusic-you-there-renderer',
      '.ytmusic-player-ad-overlay',
      '.ytmusic-mealbar-promo-renderer',
      '.video-ads',
      '.ytp-ad-overlay-container',
      '.ytp-ad-text-overlay',
      '.ytp-ad-overlay-slot',
      '.ytp-ad-overlay-close-container',
      '.ytp-ad-player-overlay',
      '.ytp-ad-player-overlay-instream-info',
      '.ytp-ad-module',
      '#player-ads',
      '#masthead-ad',
      'ytd-ad-slot-renderer',
      'ytd-in-feed-ad-layout-renderer',
      'ytd-action-companion-ad-renderer',
      'ytd-display-ad-renderer',
      'ytd-companion-slot-renderer',
      'ytd-promoted-sparkles-web-renderer',
      'ytd-promoted-video-renderer',
      'ytd-video-masthead-ad-v3-renderer',
      'ytd-mealbar-promo-renderer',
      'ytd-survey-renderer',
      'ytm-promoted-video-renderer',
      'ytm-companion-ad-renderer',
      'ytm-companion-slot'
    ].join(',') + '{display:none!important;visibility:hidden!important;opacity:0!important;height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;pointer-events:none!important;margin:0!important;padding:0!important;}',
    [
      '.open-app-button',
      'a[href*="itunes.apple.com"]',
      'a[href*="apps.apple.com"]',
      'a[href*="music.apple.com"]',
      'button[aria-label*="Open app" i]',
      'button[aria-label*="打开应用"]',
      '[aria-label*="Open app" i]',
      '[aria-label*="打开应用"]',
      'ytmusic-app-header-renderer .cta-button',
      'ytmusic-app-header-renderer [href*="itunes"]',
      'ytmusic-app-header-renderer [href*="apps.apple"]',
      'ytmusic-app-header-renderer [href*="youtubemusic"]',
      '[data-redirect*="app"]'
    ].join(',') + '{display:none!important;}'
  ].join('\\n');

  var adElementSelectors = [
    'ytmusic-ad-instream-ads-renderer',
    '.ytmusic-player-ad-overlay',
    '.video-ads',
    '.ytp-ad-overlay-container',
    '.ytp-ad-text-overlay',
    '.ytp-ad-overlay-slot',
    '.ytp-ad-player-overlay',
    '#player-ads'
  ];

  var skipSelectors = [
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-container button',
    'button.ytp-ad-skip-button',
    'button[aria-label*="Skip"]',
    'button[aria-label*="skip"]',
    'button[aria-label*="跳过"]',
    'button[aria-label*="略過"]',
    'button[aria-label*="スキップ"]'
  ];

  var resumeButtonSelectors = [
    'ytmusic-you-there-renderer button',
    'tp-yt-paper-dialog button',
    'yt-confirm-dialog-renderer button'
  ];

  function log(message) {
    try {
      var t = new Date();
      state.logs.push(t.toTimeString().slice(0, 8) + '.' + ('00' + t.getMilliseconds()).slice(-3) + ' ' + message);
      if (state.logs.length > 300) state.logs.splice(0, 100);
    } catch (error) {}
  }

  function injectCSS() {
    var id = 'yt-clear-scriptable-music-css';
    if (document.getElementById(id)) return;
    var style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
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
      softResume(120);
      softResume(700);
      softResume(1800);
    }
    if (event && typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  }

  function onForeground() {
    log('fg');
    state.realBackgrounded = false;
    startAudioKeepAlive();
    state.mediaSessionBound = false;
    updateMediaSession();
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

  function webEquivalent(href) {
    href = String(href || '');
    var watch = href.match(/watch\\?[^#]*/i);
    if (watch) return '/' + watch[0];
    var playlist = href.match(/playlist\\?[^#]*/i);
    if (playlist) return '/' + playlist[0];
    var channel = href.match(/(channel|browse)\\/[^#?]*/i);
    if (channel) return '/' + channel[0];
    return null;
  }

  function samePageState() {
    var video = getVideo();
    return [
      location.href,
      video && (video.currentSrc || video.src || ''),
      video && Math.floor((video.currentTime || 0) * 10)
    ].join('|');
  }

  function navigateToWebPath(path) {
    if (!path) return false;
    var target = 'https://music.youtube.com' + path;
    log('reload web: ' + path.slice(0, 80));
    state.userPaused = false;
    state.shouldResume = true;
    markTransition();
    try {
      window.location.href = target;
      return true;
    } catch (error) {}
    try {
      window.location.assign(target);
      return true;
    } catch (error2) {}
    return false;
  }

  function isNativeAppHref(href) {
    return /^(youtubemusic|itms-apps|itms|com\\.google\\.ios\\.youtubemusic):\\/\\//i.test(String(href || '')) ||
      /itunes\\.apple\\.com|apps\\.apple\\.com|music\\.apple\\.com/i.test(String(href || ''));
  }

  function activateWebPathFromElement(element, path) {
    if (!element || !path) return false;
    var hrefNode = closestHrefNode(element) || element;
    if (!hrefNode || !hrefNode.setAttribute) return false;

    var originalHref = hrefNode.getAttribute('href');
    var originalTarget = hrefNode.getAttribute('target');
    var url = path.indexOf('http') === 0 ? path : path;

    log('spa click: ' + url.slice(0, 80));
    state.userPaused = false;
    state.shouldResume = true;
    markTransition();

    try {
      hrefNode.setAttribute('href', url);
      hrefNode.removeAttribute('target');
      fireClick(hrefNode);
      setTimeout(function () {
        try {
          if (originalHref === null) hrefNode.removeAttribute('href');
          else hrefNode.setAttribute('href', originalHref);
          if (originalTarget === null) hrefNode.removeAttribute('target');
          else hrefNode.setAttribute('target', originalTarget);
        } catch (error) {}
      }, 1500);
      return true;
    } catch (error2) {
      try {
        if (originalHref === null) hrefNode.removeAttribute('href');
        else hrefNode.setAttribute('href', originalHref);
        if (originalTarget === null) hrefNode.removeAttribute('target');
        else hrefNode.setAttribute('target', originalTarget);
      } catch (error3) {}
      return false;
    }
  }

  function routeWebPathWithoutReload(path) {
    if (!path) return false;
    log('spa route: ' + path.slice(0, 80));
    state.userPaused = false;
    state.shouldResume = true;
    markTransition();
    try {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      onNavigate();
      return true;
    } catch (error) {
      return false;
    }
  }

  function handleNativeAppTarget(target) {
    var href = String(target || '');
    var web = webEquivalent(href);
    if (web) {
      navigateToWebPath(web);
      return true;
    }
    return false;
  }

  function blockAppRedirects() {
    var appRe = /itunes\\.apple\\.com|apps\\.apple\\.com|youtubemusic:\\/\\/|music\\.apple\\.com/i;
    var schemeRe = /^(youtubemusic|itms-apps|itms|com\\.google\\.ios\\.youtubemusic):\\/\\//i;
    var originalOpen = window.open;

    window.open = function (target, name, features) {
      if (target && (appRe.test(String(target)) || schemeRe.test(String(target)))) {
        handleNativeAppTarget(target);
        return null;
      }
      return originalOpen ? originalOpen.call(window, target, name, features) : null;
    };

    document.addEventListener('click', function (event) {
      var node = event.target;
      while (node && node !== document) {
        var href = node.getAttribute && node.getAttribute('href');
        if (href && (appRe.test(href) || schemeRe.test(href))) {
          event.preventDefault();
          event.stopPropagation();
          log('app link blocked: ' + href.slice(0, 80));
          var web = webEquivalent(href);
          if (web) activateWebPathFromElement(node, web) || routeWebPathWithoutReload(web);
          return;
        }
        node = node.parentElement;
      }
    }, true);

    try {
      var originalAssign = window.location.assign.bind(window.location);
      var originalReplace = window.location.replace.bind(window.location);
      window.location.assign = function (target) {
        if (schemeRe.test(String(target))) {
          handleNativeAppTarget(target);
          return;
        }
        originalAssign(target);
      };
      window.location.replace = function (target) {
        if (schemeRe.test(String(target))) {
          handleNativeAppTarget(target);
          return;
        }
        originalReplace(target);
      };
    } catch (error) {}
  }

  function hideAppPrompts() {
    var selectors = [
      '.open-app-button',
      'a[href*="itunes.apple.com"]',
      'a[href*="apps.apple.com"]',
      'a[href*="music.apple.com"]',
      'button[aria-label*="Open app" i]',
      'button[aria-label*="打开应用"]',
      '[aria-label*="Open app" i]',
      '[aria-label*="打开应用"]'
    ];

    selectors.forEach(function (selector) {
      try {
        var nodes = document.querySelectorAll(selector);
        for (var i = 0; i < nodes.length; i++) {
          nodes[i].style.setProperty('display', 'none', 'important');
          nodes[i].style.setProperty('pointer-events', 'none', 'important');
        }
      } catch (error) {}
    });

    var buttons = document.querySelectorAll('a,button,tp-yt-paper-button,yt-button-renderer');
    for (var j = 0; j < buttons.length; j++) {
      var text = (buttons[j].innerText || buttons[j].textContent || buttons[j].getAttribute('aria-label') || '').trim();
      if (/^(open app|打开应用|開啟應用程式|アプリを開く)$/i.test(text)) {
        buttons[j].style.setProperty('display', 'none', 'important');
        buttons[j].style.setProperty('pointer-events', 'none', 'important');
      }
    }
  }

  function bindMobileTapFix() {
    ['touchstart', 'pointerdown'].forEach(function (type) {
      window.addEventListener(type, rememberTapPoint, true);
      document.addEventListener(type, rememberTapPoint, true);
    });
    ['touchend', 'pointerup', 'click'].forEach(function (type) {
      window.addEventListener(type, onMobileTap, true);
      document.addEventListener(type, onMobileTap, true);
    });
  }

  function rememberTapPoint(event) {
    var point = getEventPoint(event);
    if (!point) return;
    state.lastTapPoint = {
      x: point.clientX,
      y: point.clientY,
      time: Date.now()
    };
  }

  function onMobileTap(event) {
    if (!event || event.__ytClearScriptableMusicTapFix || event.__ytClearScriptableMusicTapSeen) return;
    event.__ytClearScriptableMusicTapSeen = true;

    var point = getEventPoint(event);
    var target = point ? document.elementFromPoint(point.clientX, point.clientY) : null;
    target = target || event.target;
    if (!target || target === document || isPlayerControlTap(target)) return;

    var link = closestHrefNode(target);
    if (link) {
      var href = link.getAttribute('href') || '';
      var web = webEquivalent(href);
      if (web && isNativeAppHref(href)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        log('tap native link: ' + href.slice(0, 80));
        activateWebPathFromElement(link, web) || routeWebPathWithoutReload(web);
        return;
      }
      if (web) {
        log('tap web link: ' + href.slice(0, 80));
        state.userPaused = false;
        state.shouldResume = true;
        markTransition();
        return;
      }
    }

    if (event.type !== 'touchend' && event.type !== 'pointerup') return;
    var item = closestMusicItem(target) || nearestActionContainer(target);
    if (!item || item.__ytClearTapFixUntil > Date.now()) return;

    var before = samePageState();
    item.__ytClearTapFixUntil = Date.now() + 900;
    setTimeout(function () {
      if (!document.contains(item) || samePageState() !== before) return;
      var action = findItemAction(item) || item;
      if (!action || isPlayerControlTap(action)) return;
      log('tap fallback: ' + item.tagName.toLowerCase());
      var href = action.getAttribute && action.getAttribute('href');
      var web = webEquivalent(href);
      if (web) {
        activateWebPathFromElement(action, web) || routeWebPathWithoutReload(web);
        return;
      }
      try {
        var synthetic = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        synthetic.__ytClearScriptableMusicTapFix = true;
        action.dispatchEvent(synthetic);
      } catch (error) {
        try { action.click(); } catch (error2) {}
      }
    }, 180);
  }

  function getEventPoint(event) {
    var touch = event.changedTouches && event.changedTouches[0];
    if (touch) return touch;
    if (typeof event.clientX === 'number' && typeof event.clientY === 'number') return event;
    if (state.lastTapPoint && Date.now() - state.lastTapPoint.time < 1200) {
      return state.lastTapPoint;
    }
    return null;
  }

  function closestHrefNode(node) {
    while (node && node !== document) {
      if (node.getAttribute && node.getAttribute('href')) return node;
      node = node.parentElement || node.parentNode;
    }
    return null;
  }

  function closestMusicItem(node) {
    while (node && node !== document) {
      if (node.matches && node.matches([
        'ytmusic-responsive-list-item-renderer',
        'ytmusic-two-row-item-renderer',
        'ytmusic-carousel-shelf-basic-header-renderer',
        'ytmusic-grid-renderer ytmusic-card-shelf-renderer',
        'ytmusic-card-shelf-renderer',
        'ytmusic-playlist-shelf-renderer ytmusic-responsive-list-item-renderer',
        '[role="listitem"]',
        '[data-testid*="song"]',
        '[data-testid*="playlist"]'
      ].join(','))) return node;
      node = node.parentElement || node.parentNode;
    }
    return null;
  }

  function nearestActionContainer(node) {
    var current = node;
    var depth = 0;
    while (current && current !== document && depth < 8) {
      if (findItemAction(current)) return current;
      if (current.getAttribute && (
        current.getAttribute('role') === 'button' ||
        current.getAttribute('role') === 'listitem' ||
        current.getAttribute('aria-label')
      )) return current;
      current = current.parentElement || current.parentNode;
      depth++;
    }
    return null;
  }

  function findItemAction(item) {
    var selectors = [
      'a[href^="youtubemusic://"]',
      'a[href*="watch"]',
      'a[href*="playlist"]',
      'a[href*="browse"]',
      'a[href]',
      'ytmusic-play-button-renderer',
      '.play-button',
      '#play-button',
      '#thumbnail',
      '.title',
      '[role="button"]',
      'button'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var node = item.querySelector && item.querySelector(selectors[i]);
      if (node && !isOverflowMenu(node)) return node;
    }
    return null;
  }

  function isPlayerControlTap(node) {
    var current = node;
    while (current && current !== document) {
      if (current.matches && current.matches([
        'ytmusic-player-bar',
        'ytmusic-app-layout > [slot="player-bar"]',
        'input',
        'textarea',
        'select',
        'ytmusic-menu-renderer',
        'ytmusic-search-box',
        'ytmusic-pivot-bar-renderer',
        'ytmusic-nav-bar'
      ].join(','))) return true;
      current = current.parentElement || current.parentNode;
    }
    return false;
  }

  function isOverflowMenu(node) {
    var label = (node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title'))) || '';
    return /more|menu|更多|选项|選項/i.test(label);
  }

  function getPlayer() {
    if (!state.player || !document.contains(state.player)) {
      state.player = document.querySelector('.html5-video-player, #movie_player');
      if (state.player) patchPlayerMethods(state.player);
    }
    return state.player;
  }

  function patchPlayerMethods(player) {
    if (!player || player.__ytClearScriptableMusicPlayerPatch === VERSION) return;
    player.__ytClearScriptableMusicPlayerPatch = VERSION;

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

    [
      'loadVideoById',
      'loadVideoByUrl',
      'loadPlaylist',
      'nextVideo',
      'previousVideo',
      'playVideo'
    ].forEach(function (name) {
      if (typeof player[name] !== 'function') return;
      var nativeMethod = player[name];
      player['__ytClearNative_' + name] = nativeMethod;
      player[name] = function () {
        state.userPaused = false;
        state.shouldResume = true;
        markTransition();
        return nativeMethod.apply(player, arguments);
      };
    });
  }

  function getVideo() {
    if (!state.video || !document.contains(state.video)) {
      state.video = document.querySelector('video');
      if (state.video && state.video.__ytClearScriptableMusicListeners !== VERSION) {
        state.video.__ytClearScriptableMusicListeners = VERSION;
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
        state.video.addEventListener('ratechange', rememberPlayback, { passive: true });
        state.video.addEventListener('volumechange', rememberPlayback, { passive: true });
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
      state.pendingUnmute = false;
      setTimeout(function () {
        var video = getVideo();
        if (video && !state.inAd && !state.touchedMute) video.muted = false;
      }, 250);
    }
    scheduleBurst();
    updateMediaSession();
  }

  function onVideoPause() {
    if (state.userPaused || state.inAd) return;
    if (Date.now() < state.transitionUntil) return;
    if (state.shouldResume || state.realBackgrounded) {
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

  function rememberPlayback() {
    var video = getVideo();
    if (!video || state.inAd || state.touchedRate || state.touchedMute) return;
    state.originalRate = video.playbackRate || 1;
    state.originalMuted = video.muted;
  }

  function updateMediaSession() {
    if (!navigator.mediaSession) return;

    try {
      var mediaVideo = state.video;
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
      clickFirst([
        'ytmusic-player-bar .next-button',
        'ytmusic-player-bar tp-yt-paper-icon-button.next-button',
        'ytmusic-player-bar button.next-button',
        'ytmusic-player-bar [aria-label*="Next" i]',
        'ytmusic-player-bar [title*="Next" i]',
        'ytmusic-player-bar [aria-label*="下一"]',
        'ytmusic-player-bar [title*="下一"]',
        '.next-button',
        '[aria-label*="Next song" i]',
        '[aria-label*="Next track" i]'
      ]) ||
      callPlayerMethod(['nextVideo', 'nextTrack', 'next']) ||
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
      clickFirst([
        'ytmusic-player-bar .previous-button',
        'ytmusic-player-bar tp-yt-paper-icon-button.previous-button',
        'ytmusic-player-bar button.previous-button',
        'ytmusic-player-bar [aria-label*="Previous" i]',
        'ytmusic-player-bar [title*="Previous" i]',
        'ytmusic-player-bar [aria-label*="上一"]',
        'ytmusic-player-bar [title*="上一"]',
        '.previous-button',
        '[aria-label*="Previous song" i]',
        '[aria-label*="Previous track" i]'
      ]) ||
      callPlayerMethod(['previousVideo', 'previousTrack', 'previous']) ||
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
    state.mediaSessionBound = false;
    updateMediaSession();
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
      log('play blocked ' + (error && error.name));
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

  function isAdPlaying() {
    var player = getPlayer();
    if (findSkipButton()) return true;
    if (player && (
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting')
    )) return true;

    return !!document.querySelector('ytmusic-ad-instream-ads-renderer,.ytp-ad-player-overlay,.ytp-ad-preview-container');
  }

  function findSkipButton() {
    for (var i = 0; i < skipSelectors.length; i++) {
      var button = document.querySelector(skipSelectors[i]);
      if (isVisibleButton(button)) return button;
    }
    return null;
  }

  function isVisibleButton(button) {
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    var rect = button.getBoundingClientRect();
    var style = window.getComputedStyle(button);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function tick() {
    injectCSS();
    hideAppPrompts();
    dismissStillWatching();
    updateMediaSession();

    if (isAdPlaying()) {
      if (!state.inAd) enterAdMode();
      handleAd();
      scheduleBurst();
    } else if (state.inAd && Date.now() > state.cooldownUntil) {
      exitAdMode();
    }

    if (state.shouldResume && !state.userPaused && !state.inAd) {
      var video = getVideo();
      if (video && video.paused && Date.now() > state.transitionUntil) softResume(0);
    }
  }

  function enterAdMode() {
    var video = getVideo();
    state.inAd = true;
    if (video) {
      state.originalRate = video.playbackRate || 1;
      state.originalMuted = video.muted;
    }
  }

  function handleAd() {
    if (clickSkip()) return;
    if (Date.now() < state.cooldownUntil) return;
    finishShortAd();
    muteAd();
    speedUpAd();
    hideAdElements();
  }

  function clickSkip() {
    var now = Date.now();
    if (now - state.lastSkipClick < 350) return false;

    var button = findSkipButton();
    if (!button) return false;

    state.lastSkipClick = now;
    state.cooldownUntil = now + 700;
    button.click();
    return true;
  }

  function finishShortAd() {
    var video = getVideo();
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 90 || video.ended) return;

    var remaining = video.duration - video.currentTime;
    if (remaining > 0.35) {
      try {
        video.currentTime = Math.max(0, video.duration - 0.1);
        state.cooldownUntil = Date.now() + 500;
      } catch (error) {}
    }
  }

  function muteAd() {
    var video = getVideo();
    if (video && !video.muted) {
      state.touchedMute = true;
      video.muted = true;
    }
  }

  function speedUpAd() {
    var video = getVideo();
    if (video && video.playbackRate < 16) {
      state.touchedRate = true;
      video.playbackRate = 16;
    }
  }

  function hideAdElements() {
    for (var i = 0; i < adElementSelectors.length; i++) {
      var nodes = document.querySelectorAll(adElementSelectors[i]);
      for (var j = 0; j < nodes.length; j++) {
        nodes[j].style.setProperty('display', 'none', 'important');
        nodes[j].style.setProperty('visibility', 'hidden', 'important');
        nodes[j].style.setProperty('opacity', '0', 'important');
      }
    }
  }

  function exitAdMode() {
    state.inAd = false;
    restorePlayback();
    softResume(120);
  }

  function restorePlayback() {
    var video = getVideo();
    if (!video) return;

    if (state.touchedRate && video.playbackRate !== state.originalRate) {
      video.playbackRate = state.originalRate || 1;
    }
    if (state.touchedMute && video.muted !== state.originalMuted) {
      video.muted = state.originalMuted;
    }

    state.touchedRate = false;
    state.touchedMute = false;
  }

  function dismissStillWatching() {
    var patterns = /still watching|continue watching|video paused|仍在观看|還在觀看|继续观看|繼續觀看|继续播放|繼續播放|继续收听|繼續收聽/i;
    for (var i = 0; i < resumeButtonSelectors.length; i++) {
      var buttons = document.querySelectorAll(resumeButtonSelectors[i]);
      for (var j = 0; j < buttons.length; j++) {
        var button = buttons[j];
        var text = (button.innerText || button.textContent || button.getAttribute('aria-label') || '').trim();
        if (patterns.test(text) && isVisibleButton(button)) {
          log('dismiss dialog: ' + text.slice(0, 30));
          button.click();
          softResume(150);
          return;
        }
      }
    }
  }

  function scheduleBurst() {
    state.burstUntil = Date.now() + 2500;
  }

  function startLoop() {
    if (state.timer) clearTimeout(state.timer);

    var loop = function () {
      tick();
      var delay = state.inAd || Date.now() < state.burstUntil ? 120 : 700;
      state.timer = setTimeout(loop, delay);
    };

    loop();
  }

  function onNavigate() {
    restorePlayback();
    state.video = null;
    state.player = null;
    state.inAd = false;
    state.cooldownUntil = 0;
    state.mediaSessionBound = false;
    state.transitionUntil = Date.now() + 1500;
    scheduleBurst();
    tick();
  }

  function startObserver() {
    if (!document.body || state.observer) return;

    state.observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length) {
          scheduleBurst();
          tick();
          break;
        }
      }
    });

    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  function destroy() {
    if (state.timer) clearTimeout(state.timer);
    if (state.observer) state.observer.disconnect();
    if (state.silenceTimer) clearInterval(state.silenceTimer);
    if (state.keepAliveOsc) {
      try { state.keepAliveOsc.stop(); } catch (error) {}
      state.keepAliveOsc = null;
    }
    if (state.video && state.video.__ytClearScriptableMusicListeners === VERSION) {
      state.video.removeEventListener('playing', onVideoPlaying);
      state.video.removeEventListener('play', onVideoPlaying);
      state.video.removeEventListener('pause', onVideoPause, true);
      state.video.removeEventListener('loadstart', markTransition);
      state.video.removeEventListener('emptied', markTransition);
      state.video.removeEventListener('canplay', onVideoCanPlay);
      state.video.removeEventListener('seeked', onVideoSeeked);
      state.video.removeEventListener('durationchange', scheduleBurst);
      state.video.removeEventListener('ratechange', rememberPlayback);
      state.video.removeEventListener('volumechange', rememberPlayback);
      delete state.video.__ytClearScriptableMusicListeners;
    }
    window.removeEventListener('yt-navigate-finish', onNavigate);
    window.removeEventListener('yt-page-data-updated', onNavigate);
    window.removeEventListener('load', onNavigate);
    document.removeEventListener('touchstart', markGesture);
    document.removeEventListener('touchend', markGesture);
    document.removeEventListener('touchend', onDebugTap);
    document.removeEventListener('click', markGesture, true);
    document.removeEventListener('keydown', markGesture, true);
    window.removeEventListener('touchstart', rememberTapPoint, true);
    document.removeEventListener('touchstart', rememberTapPoint, true);
    window.removeEventListener('pointerdown', rememberTapPoint, true);
    document.removeEventListener('pointerdown', rememberTapPoint, true);
    window.removeEventListener('touchend', onMobileTap, true);
    document.removeEventListener('touchend', onMobileTap, true);
    window.removeEventListener('pointerup', onMobileTap, true);
    document.removeEventListener('pointerup', onMobileTap, true);
    window.removeEventListener('click', onMobileTap, true);
    document.removeEventListener('click', onMobileTap, true);
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

  window.__ytClearScriptableMusic = { version: VERSION, destroy: destroy, logs: state.logs };

  patchVisibility();
  patchMedia();
  blockAppRedirects();
  bindMobileTapFix();
  injectCSS();
  hideAppPrompts();
  updateMediaSession();

  document.addEventListener('touchstart', markGesture, { passive: true });
  document.addEventListener('touchend', markGesture, { passive: true });
  document.addEventListener('touchend', onDebugTap, { passive: true });
  document.addEventListener('click', markGesture, true);
  document.addEventListener('keydown', markGesture, true);

  window.addEventListener('yt-navigate-finish', onNavigate);
  window.addEventListener('yt-page-data-updated', onNavigate);
  window.addEventListener('load', onNavigate);

  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true });

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