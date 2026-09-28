// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: music;

const VERSION = '4.0.10-scriptable';

// 关闭脚本后弹窗显示日志、可一键复制（排查问题用；不需要时改成 false）
const SHOW_LOG_ON_CLOSE = true;

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

const url = 'https://music.youtube.com';
const webView = new WebView();

await webView.loadURL(url);

const magicScript = `
(function () {
  'use strict';

  var VERSION = '${VERSION}';
  var previous = window.__ytClearScriptableMusic;
  if (previous && previous.version === VERSION) return null;
  if (previous && typeof previous.destroy === 'function') {
    try { previous.destroy(); } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════
     基础：原生方法 / 真实可见性 / 监听器登记 / 状态
     ══════════════════════════════════════════════════════════ */

  // 原生方法只保存一次：重复注入时不会层层包装
  var NATIVE = window.__ytClearMusicNatives || (window.__ytClearMusicNatives = {
    play: HTMLMediaElement.prototype.play,
    pause: HTMLMediaElement.prototype.pause,
    addEventListener: EventTarget.prototype.addEventListener,
    open: window.open
  });

  // 真实的 document.hidden（下面会把它伪装成 false）
  // 注意：Scriptable 里后台时它也常常读到 false，所以后台判断主要靠 blur 事件
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

  var BG_PAUSE_GRACE = 1000;                 // 前台暂停后这么短时间内切到后台 → 其实是切后台造成的
  var BG_SETTLED = 300;                      // 进后台后出现的暂停 → 被别的 App 打断（微信语音、来电）
                                             // 真机：切后台时系统从不主动暂停音乐；切到微信点开语音可能只要 1 秒多
  var BG_KEEPALIVE_WINDOW = 5000;            // 刚进后台的这段时间保持保活音频，防止 App 被挂起
  var KEEPALIVE_PLAYING_OFF = 1500;          // 后台稳定播放这么久后，停掉保活音频
  var KEEPALIVE_IDLE_STOP = 10 * 60 * 1000;  // 用户暂停超过 10 分钟，停掉保活音频省电
  var TAP_FALLBACK_DELAY = 450;              // 点了列表项多久没反应，才补点一次
  var INTERRUPT_BEAT = 4000;                 // 打断期间多久记一次心跳 / 检查一次是否结束
  var RESUME_PROTECT = 3000;                 // 打断结束恢复播放后，这么久内不让 YT Music 自己再暂停
  var STALL_MS = 2500;                       // “播放中”但进度这么久不动 → 判定卡死

  var state = {
    loopTimer: null,
    observer: null,
    observerTimer: null,

    audioCtx: null,
    keepAliveOsc: null,
    keepAliveGain: null,
    silenceTimer: null,

    video: null,
    player: null,
    patchedPlayers: [],

    inAd: false,
    burstUntil: 0,
    cooldownUntil: 0,
    lastSkipClick: 0,
    contentRate: 1,            // 正片（非广告）时用户自己的倍速 / 静音，广告结束后恢复
    contentMuted: false,
    touchedRate: false,
    touchedMute: false,

    shouldResume: false,       // 希望保持播放
    userPaused: false,         // 已被认定为暂停（用户或前台系统），不自动恢复
    userPausedAt: 0,
    userPausedReason: '',
    fgPauseAt: 0,              // 最近一次“前台非手势暂停”，切后台时可撤销
    fgPauseNative: false,

    recentGestureUntil: 0,
    allowPauseUntil: 0,
    transitionUntil: 0,

    realBackgrounded: false,
    bgSince: 0,                // 第一次收到后台事件的时间
    hiddenSince: 0,            // 页面真正隐藏的时间（能读到时）

    interrupted: false,        // 被别的 App 打断中（微信语音、来电、Siri）
    interruptedAt: 0,
    resumeAfterInterruption: false,
    playBlockLogged: false,
    playingSince: 0,           // 这一段连续播放开始的时间
    interruptBeat: null,
    sessionState: '',          // navigator.audioSession 上一次的状态
    protectPlayUntil: 0,
    lastProgressAt: 0,         // 播放进度最近一次前进的时间
    lastProgressPos: 0,
    stalledSince: 0,           // 卡死开始的时间
    repairCooldownUntil: 0,
    yieldedInBg: false,        // 后台让出过声音：回到 App 或用户点播放之前，后台不再启动保活音频
    lastLinkTapAt: 0,

    mediaSessionBound: false,
    lastMediaSessionRefresh: 0,
    pendingUnmute: false,

    lastTapPoint: null,
    touchMoved: false,         // 这次触摸有没有滑动（滑动松手不算点击，不补点）
    ignorePlayEvents: 0,       // 手势“授权”时自己 play() / pause() 产生的事件，忽略
    ignorePauseEvents: 0,
    ignoreBlessUntil: 0,
    lastMediaEventAt: 0,       // 最近一次播放 / 暂停 / 切歌事件（判断点击有没有生效）
    lastPromptScan: 0,
    lastDialogCheck: 0,

    debugTaps: [],
    logSeq: 0,
    logs: []
  };

  function log(message) {
    try {
      var t = new Date();
      state.logs.push(t.toTimeString().slice(0, 8) + '.' + ('00' + t.getMilliseconds()).slice(-3) + ' ' + message);
      state.logSeq++;
      if (state.logs.length > 800) state.logs.splice(0, 200);
    } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════
     CSS：隐藏广告和“打开 App”提示
     （“还在听吗？”弹窗不再隐藏，否则脚本看不见它，也就点不掉）
     ══════════════════════════════════════════════════════════ */

  var css = [
    'html,body{touch-action:manipulation!important;-webkit-tap-highlight-color:transparent!important;}',
    '*{-webkit-tap-highlight-color:transparent!important;}',
    [
      'ytmusic-ad-instream-ads-renderer',
      'ytmusic-mealbar-promo-renderer',
      'ytmusic-statement-banner-renderer',
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

  function injectCSS() {
    var id = 'yt-clear-scriptable-music-css';
    if (document.getElementById(id)) return;
    var style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  /* ══════════════════════════════════════════════════════════
     暂停状态机
     ══════════════════════════════════════════════════════════ */

  function setUserPaused(reason) {
    if (!state.userPaused) log('paused: ' + reason);
    state.userPaused = true;
    state.shouldResume = false;
    state.userPausedAt = Date.now();
    state.userPausedReason = reason;
    state.fgPauseAt = 0;
  }

  function clearUserPaused() {
    state.userPaused = false;
    state.shouldResume = true;
    state.userPausedAt = 0;
    state.userPausedReason = '';
    state.fgPauseAt = 0;
  }

  // 前台出现、但网页没收到触摸的暂停（拔耳机、来电、YT Music 自己暂停）：先当作暂停；
  // 如果 BG_PAUSE_GRACE 内真的切到后台，说明是切后台造成的，再撤销。
  function acceptForegroundPause(reason, native) {
    setUserPaused(reason);
    state.fgPauseAt = Date.now();
    state.fgPauseNative = !!native;
  }

  // 真的是用户亲手暂停的（点了按钮 / 锁屏 / 原生播放器）
  function isGenuineUserPause() {
    var r = state.userPausedReason;
    return state.userPaused && (r.indexOf('(user)') >= 0 || r === 'lock screen' || r === 'native player');
  }

  function isBackground() {
    return state.realBackgrounded || isReallyHidden();
  }

  function backgroundFor() {
    var start = state.hiddenSince || state.bgSince;
    return start ? Date.now() - start : 0;
  }

  function recentGesture() {
    var now = Date.now();
    return now < state.recentGestureUntil || now < state.allowPauseUntil;
  }

  function isWindowLevelEvent(event) {
    // window 上的捕获监听也会收到输入框等元素的 focus/blur，要排除掉
    return !event || !event.target || event.target === window || event.target === document;
  }

  /* ─── 被别的 App 打断（微信语音、来电、Siri）───
     打断期间：不恢复播放、不让 YT Music 自己恢复、停掉保活音频，把声音让给对方；
     系统恢复播放 / 锁屏点播放 / 回到 App 时再继续。 */
  function beginInterruption(reason) {
    var now = Date.now();
    if (!state.interrupted) {
      state.interrupted = true;
      state.interruptedAt = now;
      state.playBlockLogged = false;
      state.resumeAfterInterruption = state.shouldResume && !state.userPaused;
      // 刚才那次暂停被当成了“前台系统暂停”，其实是打断
      if (state.userPaused && now - state.userPausedAt < 1500 && !isGenuineUserPause()) {
        state.userPaused = false;
        state.resumeAfterInterruption = true;
      }
      log('interrupted: ' + reason + (state.resumeAfterInterruption ? ' (will resume)' : '') +
        ' [audio=' + (state.audioCtx ? state.audioCtx.state : '-') + ' session=' + (audioSessionState() || '-') + ']');
      startInterruptBeat();
    }
    if (isBackground()) state.yieldedInBg = true;
    state.shouldResume = false;
    applyKeepAlivePolicy('interrupted');
  }

  // 打断期间定时记一行心跳：从日志能看出 App 在语音期间有没有被 iOS 挂起；
  // 同时检查音频会话是否已经不再“被打断”（以防状态变化事件漏发）
  function startInterruptBeat() {
    stopInterruptBeat();
    state.interruptBeat = setInterval(function () {
      if (!state.interrupted) { stopInterruptBeat(); return; }
      var v = state.video;
      var sess = audioSessionState();
      log('still interrupted ' + Math.round((Date.now() - state.interruptedAt) / 1000) + 's' +
        ' [audio=' + (state.audioCtx ? state.audioCtx.state : '-') + ' session=' + (sess || '-') +
        ' video=' + (v && !v.paused ? 'playing' : 'paused') + ']');
      if (state.sessionState === 'interrupted' && sess && sess !== 'interrupted') {
        state.sessionState = sess;
        endInterruption('audioSession ' + sess + ' (poll)');
      }
    }, INTERRUPT_BEAT);
  }

  function stopInterruptBeat() {
    if (state.interruptBeat) { clearInterval(state.interruptBeat); state.interruptBeat = null; }
  }

  /* ─── iOS 的音频会话状态（Safari / WKWebView 支持时）───
     被别的 App 打断时是 interrupted，对方放完、交还声音后离开 interrupted —— 这是“语音结束”最直接的信号 */
  function audioSessionState() {
    try { return navigator.audioSession ? String(navigator.audioSession.state || '') : ''; } catch (e) { return ''; }
  }

  function watchAudioSession() {
    var as = navigator.audioSession;
    if (!as) { log('audioSession: not supported'); return; }
    state.sessionState = audioSessionState();
    log('audioSession: type=' + as.type + ' state=' + state.sessionState);
    try { listen(as, 'statechange', onAudioSessionChange); } catch (e) { log('audioSession: no statechange'); }
  }

  function onAudioSessionChange() {
    var prev = state.sessionState;
    var now = audioSessionState();
    state.sessionState = now;
    if (!prev && !now) { log('audioSession event (state not supported)'); return; }
    log('audioSession ' + prev + ' -> ' + now);
    if (now === 'interrupted') beginInterruption('audioSession');
    // 只认“从 interrupted 离开”才是结束；刚被打断时会话变成 inactive 不算
    else if (prev === 'interrupted' && state.interrupted) endInterruption('audioSession ' + now);
  }

  /* ─── 播放卡死检测与修复 ───
     真机日志：微信语音打断后，系统会把音乐恢复成“播放中”，但进度一直是 +0.0s —— YT Music 的播放器卡死了，
     在后台重新激活声音、暂停再播放都没用；回到 App 后要等 YT Music 自己十几秒后重建播放器才恢复。
     现在：状态是“播放中”但进度 2.5 秒不动 → 立刻修复（先跳到当前位置重新缓冲，还不行就在原位置重新载入这首歌）。
     后台只记录不修（修复会重新占用声音，可能打断下一条语音），回到 App 或点锁屏播放时马上修。 */
  function watchProgress() {
    var v = state.video;
    var now = Date.now();
    if (!v || v.paused || v.ended || state.inAd || now < state.transitionUntil) {
      state.lastProgressAt = now;
      state.lastProgressPos = v ? v.currentTime : 0;
      return;
    }
    if (Math.abs(v.currentTime - state.lastProgressPos) > 0.2) {
      if (state.stalledSince) log('progress resumed after ' + ((now - state.stalledSince) / 1000).toFixed(1) + 's stall');
      state.lastProgressPos = v.currentTime;
      state.lastProgressAt = now;
      state.stalledSince = 0;
      return;
    }
    var stuckFor = now - state.lastProgressAt;
    if (stuckFor < STALL_MS) return;
    if (!state.stalledSince) {
      state.stalledSince = state.lastProgressAt;
      log('stalled at ' + v.currentTime.toFixed(1) + 's (playing but no progress' + (isBackground() ? ', in background: repair when back / on play' : '') + ')');
    }
    if (!isBackground()) repairStall('stuck ' + (stuckFor / 1000).toFixed(1) + 's');
  }

  function repairStall(reason) {
    var now = Date.now();
    if (now < state.repairCooldownUntil) return;
    state.repairCooldownUntil = now + 8000;
    var v = state.video;
    var p = getPlayer();
    if (!v) return;
    var t0 = v.currentTime;
    log('repair: seek to ' + t0.toFixed(1) + 's (' + reason + ')');
    state.lastProgressAt = now;
    state.lastProgressPos = t0;
    try {
      if (p && typeof p.seekTo === 'function') p.seekTo(t0, true);
      else v.currentTime = t0;
    } catch (e) {}
    try { var pr = NATIVE.play.call(v); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
    setTimeout(function () {
      var vv = state.video;
      if (vv && (vv !== v || Math.abs(vv.currentTime - t0) > 0.3)) { log('repair ok (seek)'); state.stalledSince = 0; return; }
      var data = null;
      try { data = p && typeof p.getVideoData === 'function' ? p.getVideoData() : null; } catch (e) {}
      var id = data && data.video_id;
      var load = p && (p.__ytClearNative_loadVideoById || p.loadVideoById);
      if (id && typeof load === 'function') {
        log('repair: reload ' + id + ' at ' + t0.toFixed(1) + 's');
        clearUserPaused();
        markTransition();
        try { load.call(p, { videoId: id, startSeconds: t0 }); } catch (e) { try { load.call(p, id, t0); } catch (e2) {} }
      } else {
        log('repair: seek did not help, no player API to reload');
      }
    }, 1800);
  }

  // 回到 App / 点锁屏播放时：如果卡住了，马上修，不用等 2.5 秒
  function repairIfStalledSoon(reason) {
    var v0 = state.video;
    var p0 = v0 ? v0.currentTime : 0;
    setTimeout(function () {
      var v = state.video;
      if (!v || v !== v0 || v.paused || v.ended) return;
      if (Math.abs(v.currentTime - p0) < 0.2) repairStall(reason);
    }, 1200);
  }

  // 恢复播放：通过 YT Music 自己的 playVideo，播放器界面和状态才会同步（否则它可能马上又暂停）
  function resumeAfterInterruptionNow(reason) {
    var p = getPlayer();
    var nativePlayVideo = p && (p.__ytClearNative_playVideo || p.playVideo);
    log('resume after interruption (' + reason + ')');
    state.protectPlayUntil = Date.now() + RESUME_PROTECT;
    applyKeepAlivePolicy('resume');
    try { if (nativePlayVideo) nativePlayVideo.call(p); } catch (e) {}
    softResume(400);
    softResume(1200);
    softResume(2500);
    setTimeout(function () {
      var v = state.video;
      log('after resume: video ' + (v && !v.paused ? 'playing' : 'still paused') +
        ' [audio=' + (state.audioCtx ? state.audioCtx.state : '-') + ' session=' + (audioSessionState() || '-') + ']');
    }, 3000);
  }

  function endInterruption(reason) {
    if (!state.interrupted) return;
    state.interrupted = false;
    stopInterruptBeat();
    log('interruption ended: ' + reason);
    if (state.resumeAfterInterruption && !state.userPaused) {
      clearUserPaused();
      resumeAfterInterruptionNow(reason);
    }
    state.resumeAfterInterruption = false;
  }

  function onAudioStateChange() {
    var ctx = state.audioCtx;
    if (!ctx) return;
    var v = state.video;
    // 真机日志：切到后台那一刻、以及系统刚恢复音乐时，保活音频都会被标成 interrupted，
    // 但音乐还在放 —— 这不是被别的 App 打断，不能据此停掉恢复逻辑
    if (ctx.state === 'interrupted' && v && !v.paused) {
      log('audio interrupted while music playing -> ignored (backgrounding)');
      return;
    }
    log('audio ' + ctx.state);
    if (ctx.state === 'interrupted') beginInterruption('audio session');
    else if (ctx.state === 'running' && state.interrupted) endInterruption('audio running');
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
    var v = state.video || findVideo();
    log('bg ' + type + (hardBg ? ' (hidden)' : '') + (v && !v.paused ? ' playing' : ' paused'));
    state.realBackgrounded = true;
    if (!state.bgSince) state.bgSince = Date.now();
    if (hardBg && !state.hiddenSince) state.hiddenSince = Date.now();

    // 刚被当作暂停的前台暂停，其实是切后台造成的 → 撤销
    if (state.fgPauseAt && Date.now() - state.fgPauseAt < BG_PAUSE_GRACE && (hardBg || !state.fgPauseNative)) {
      log('pause was caused by backgrounding -> revert');
      clearUserPaused();
    }

    applyKeepAlivePolicy('bg');
    rebindMediaSession();
    setTimeout(rebindMediaSession, 450);
    setTimeout(rebindMediaSession, 1600);
    if (state.shouldResume && !state.userPaused && !state.interrupted) {
      syncResume();
      softResume(120);
      softResume(700);
      softResume(1800);
    }
  }

  function onForeground(event) {
    if (!isWindowLevelEvent(event)) return;
    // 页面在后台被系统唤醒时也可能发 resume / focus / pageshow，这不是回到 App
    if (isReallyHidden()) {
      log('fg ' + ((event && event.type) || '') + ' ignored (still hidden)');
      return;
    }
    log('fg' + (event && event.type ? ' ' + event.type : ''));
    state.realBackgrounded = false;
    state.bgSince = 0;
    state.hiddenSince = 0;
    state.yieldedInBg = false;
    endInterruption('back to app');
    repairIfStalledSoon('back to app');
    applyKeepAlivePolicy('fg');
    rebindMediaSession();
    if (state.pendingUnmute) {
      state.pendingUnmute = false;
      var video = getVideo();
      if (video && !state.inAd && !state.touchedMute) video.muted = false;
    }
    if (state.shouldResume && !state.userPaused && !state.inAd) {
      softResume(120);
      softResume(700);
    }
  }

  // 按页面真实可见性补记“进入后台的时间”（能读到时）
  function trackHidden() {
    if (isReallyHidden()) {
      if (!state.hiddenSince) state.hiddenSince = Date.now();
    } else if (state.hiddenSince) {
      state.hiddenSince = 0;
    }
  }

  // 阻止 YT Music 注册 visibilitychange / blur 等监听（它靠这些在后台暂停）
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
     网页发起的暂停 / 播放
     ══════════════════════════════════════════════════════════ */

  // video.pause() / player.pauseVideo()：只在真的在后台时拦截；前台一律放行，由 onVideoPause 判断
  function shouldAllowPause(source, el) {
    var now = Date.now();
    if (recentGesture()) {
      setUserPaused(source + ' (user)');
      return true;
    }
    if (now < state.transitionUntil) return true;
    if (now < state.protectPlayUntil && !state.userPaused && !state.interrupted) {
      log(source + ' blocked (just resumed after interruption)');
      return false;
    }
    if (state.interrupted || state.userPaused || !state.shouldResume) return true;
    if (inNativePlayer(el || state.video || findVideo())) {
      log(source + ' blocked (native player)');
      return false;
    }
    if (isBackground()) {
      log(source + ' blocked (background)');
      return false;
    }
    return true;
  }

  // video.play() / player.playVideo()：被打断期间、在后台时，不许 YT Music 自己把声音抢回来
  function shouldAllowPagePlay(source) {
    if (state.interrupted && isBackground() && !recentGesture() && Date.now() >= state.transitionUntil) {
      if (!state.playBlockLogged) { log(source + ' blocked (interrupted)'); state.playBlockLogged = true; }
      return false;
    }
    if (isBackground()) log(source + ' in background');
    return true;
  }

  function patchMedia() {
    HTMLMediaElement.prototype.play = function () {
      if (this && this.tagName === 'VIDEO') {
        if (!shouldAllowPagePlay('page play()')) return Promise.resolve();
        if (recentGesture()) { state.yieldedInBg = false; repairIfStalledSoon('user play'); }
        clearUserPaused();
        startAudioKeepAlive();   // 在用户手势的调用栈里启动，iOS 才允许
      }
      return NATIVE.play.apply(this, arguments);
    };

    HTMLMediaElement.prototype.pause = function () {
      if (this && this.tagName === 'VIDEO' && !shouldAllowPause('pause()', this)) {
        softResume(80);
        return undefined;
      }
      return NATIVE.pause.apply(this, arguments);
    };
  }

  function markGesture(event) {
    state.recentGestureUntil = Date.now() + 1300;
    if (!state.userPaused) startAudioKeepAlive();
    if (event && (event.type === 'touchend' || event.type === 'click')) blessMediaInGesture();
  }

  /* ─── 让锁屏 / 控制中心的“正在播放”在暂停后保留 ───
     WebKit 规定：媒体至少要有一次在“用户手势”里被 play()，暂停后才继续留在锁屏 / 控制中心。
     从链接点歌时 YT Music 是异步开始播放的，不算手势 → 第一次在控制中心暂停后，“正在播放”
     就退回成系统“音乐”App，点播放没反应；在 App 里亲手点过一次播放后才正常。
     所以在用户的点击里，对“正在播放”的媒体调一次 play()（本来就在放，不影响声音）。 */
  // 必须在点击的同一时刻同步调用：v4.0.9 用定时器（1 秒内）补，真机证明不算数
  function blessMediaInGesture() {
    var v = state.video || findVideo();
    if (!v || v.__ytClearBlessed === VERSION) return;   // 每个播放器元素只需要一次
    var wasPaused = v.paused || v.ended;
    try {
      if (!wasPaused) {
        // 本来就在放：再 play() 一次，不影响声音
        var p = NATIVE.play.call(v);
        if (p && p.catch) p.catch(function () {});
      } else {
        // 还没开始播（比如刚点歌，YT Music 稍后才异步开始）：play() 再立刻 pause()，
        // 同一时刻完成，不会出声，只为让 WebKit 记下“用户手势播放过”；这对事件脚本自己忽略
        state.ignorePlayEvents = 2;     // play + playing（可能不会有 playing）
        state.ignorePauseEvents = 1;
        state.ignoreBlessUntil = Date.now() + 1000;
        var p2 = NATIVE.play.call(v);
        if (p2 && p2.catch) p2.catch(function () {});
        NATIVE.pause.call(v);
      }
    } catch (e) { return; }
    v.__ytClearBlessed = VERSION;
    log('media blessed in user gesture (' + (wasPaused ? 'play+pause' : 'play') + ') - keeps lock screen / Control Center after pause');
  }

  function isBlessEvent(kind) {
    if (Date.now() > state.ignoreBlessUntil) { state.ignorePlayEvents = 0; state.ignorePauseEvents = 0; return false; }
    if (kind === 'play' && state.ignorePlayEvents > 0) { state.ignorePlayEvents--; return true; }
    if (kind === 'pause' && state.ignorePauseEvents > 0) { state.ignorePauseEvents--; return true; }
    return false;
  }

  /* ══════════════════════════════════════════════════════════
     “打开 App”链接：改成在网页里打开
     ══════════════════════════════════════════════════════════ */

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

  // 只有点歌（watch）才是“要开始播放”；点歌单 / 频道只是打开页面，暂停中的音乐不该自己响起来
  function isPlayPath(path) {
    return String(path || '').indexOf('/watch') === 0;
  }

  function prepareNavigation(path) {
    markTransition();
    if (isPlayPath(path)) clearUserPaused();
  }

  function isNativeAppHref(href) {
    return /^(youtubemusic|itms-apps|itms|com\\.google\\.ios\\.youtubemusic):\\/\\//i.test(String(href || '')) ||
      /itunes\\.apple\\.com|apps\\.apple\\.com|music\\.apple\\.com/i.test(String(href || ''));
  }

  function navigateToWebPath(path) {
    if (!path) return false;
    var target = 'https://music.youtube.com' + path;
    log('reload web: ' + path.slice(0, 80));
    prepareNavigation(path);
    try { window.location.href = target; return true; } catch (e) {}
    return false;
  }

  function restoreHref(node, href, target) {
    try {
      if (href === null) node.removeAttribute('href'); else node.setAttribute('href', href);
      if (target === null) node.removeAttribute('target'); else node.setAttribute('target', target);
    } catch (e) {}
  }

  function activateWebPathFromElement(element, path) {
    if (!element || !path) return false;
    var hrefNode = closestHrefNode(element) || element;
    if (!hrefNode || !hrefNode.setAttribute) return false;

    var originalHref = hrefNode.getAttribute('href');
    var originalTarget = hrefNode.getAttribute('target');
    log('spa click: ' + path.slice(0, 80));
    prepareNavigation(path);

    try {
      hrefNode.setAttribute('href', path);
      hrefNode.removeAttribute('target');
      fireClick(hrefNode);
      setTimeout(function () { restoreHref(hrefNode, originalHref, originalTarget); }, 1500);
      return true;
    } catch (e) {
      restoreHref(hrefNode, originalHref, originalTarget);
      return false;
    }
  }

  function routeWebPathWithoutReload(path) {
    if (!path) return false;
    log('spa route: ' + path.slice(0, 80));
    prepareNavigation(path);
    try {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      onNavigate();
      return true;
    } catch (e) {
      return false;
    }
  }

  var APP_RE = /itunes\\.apple\\.com|apps\\.apple\\.com|youtubemusic:\\/\\/|music\\.apple\\.com/i;
  var SCHEME_RE = /^(youtubemusic|itms-apps|itms|com\\.google\\.ios\\.youtubemusic):\\/\\//i;

  function onAppLinkClick(event) {
    var node = event.target;
    while (node && node !== document) {
      var href = node.getAttribute && node.getAttribute('href');
      if (href && (APP_RE.test(href) || SCHEME_RE.test(href))) {
        event.preventDefault();
        event.stopPropagation();
        log('app link blocked: ' + href.slice(0, 80));
        var web = webEquivalent(href);
        if (web) activateWebPathFromElement(node, web) || routeWebPathWithoutReload(web);
        return;
      }
      node = node.parentElement;
    }
  }

  // location.assign / replace 在 WebKit 里不可改写（旧版对它们的改写实际不生效，已删除）
  function blockAppRedirects() {
    window.open = function (target, name, features) {
      if (target && (APP_RE.test(String(target)) || SCHEME_RE.test(String(target)))) {
        var web = webEquivalent(target);
        if (web) navigateToWebPath(web);
        return null;
      }
      return NATIVE.open ? NATIVE.open.call(window, target, name, features) : null;
    };
    listen(document, 'click', onAppLinkClick, true);
  }

  // 按文字隐藏“打开应用”按钮（按选择器的已由 CSS 处理）。
  // 2 秒一次、用 textContent：旧版每轮都对所有按钮读 innerText，会反复触发重排，很耗电
  var OPEN_APP_TEXT = /^(open app|打开应用|開啟應用程式|アプリを開く)$/i;
  function hideAppPrompts() {
    var now = Date.now();
    if (now - state.lastPromptScan < 2000) return;
    state.lastPromptScan = now;
    var buttons = document.querySelectorAll('a,button,tp-yt-paper-button,yt-button-renderer');
    for (var j = 0; j < buttons.length; j++) {
      var b = buttons[j];
      var text = (b.textContent || b.getAttribute('aria-label') || '').trim();
      if (text.length < 20 && OPEN_APP_TEXT.test(text)) {
        b.style.setProperty('display', 'none', 'important');
        b.style.setProperty('pointer-events', 'none', 'important');
      }
    }
  }

  /* ══════════════════════════════════════════════════════════
     点击修复：有些列表项在 WebView 里点了没反应，隔一会儿补点一次
     ══════════════════════════════════════════════════════════ */

  function bindMobileTapFix() {
    ['touchstart', 'pointerdown'].forEach(function (type) {
      listen(window, type, rememberTapPoint, true);
    });
    listen(window, 'touchmove', onTouchMove, { capture: true, passive: true });
    listen(window, 'scroll', onAnyScroll, { capture: true, passive: true });
    ['touchend', 'pointerup', 'click'].forEach(function (type) {
      listen(window, type, onMobileTap, true);
    });
  }

  function rememberTapPoint(event) {
    var point = getEventPoint(event);
    if (!point) return;
    if (event.type === 'touchstart' || !state.lastTapPoint || Date.now() - state.lastTapPoint.time > 800) {
      state.touchMoved = false;   // 新的一次触摸
    }
    state.lastTapPoint = { x: point.clientX, y: point.clientY, clientX: point.clientX, clientY: point.clientY, time: Date.now() };
  }

  // 手指移动超过 10 像素、或页面滚动过：这是滑动，不是点击
  function onTouchMove(event) {
    var t = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]);
    var s0 = state.lastTapPoint;
    if (!t || !s0) { state.touchMoved = true; return; }
    if (Math.abs(t.clientX - s0.x) > 10 || Math.abs(t.clientY - s0.y) > 10) state.touchMoved = true;
  }

  function onAnyScroll() {
    if (state.lastTapPoint && Date.now() - state.lastTapPoint.time < 1500) state.touchMoved = true;
  }

  // 刚才那次触摸是不是一次干净的点击（没滑动、没长按）
  function wasCleanTap() {
    var s0 = state.lastTapPoint;
    if (!s0 || state.touchMoved) return false;
    return Date.now() - s0.time < 700;
  }

  // 用来判断“补点”前页面有没有反应：地址、音源、页面结构。
  // 旧版包含播放进度，播放中进度一直在变，导致补点永远不会触发。
  function samePageState() {
    var video = getVideo();
    return [
      location.href,
      video && (video.currentSrc || video.src || ''),
      document.querySelectorAll('tp-yt-paper-dialog, ytmusic-menu-popup-renderer, tp-yt-iron-dropdown').length
    ].join('|');
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
        state.lastLinkTapAt = Date.now();
        prepareNavigation(web);
        return;
      }
    }

    if (event.type !== 'touchend' && event.type !== 'pointerup') return;
    // 滑动列表后松手、长按：不是点击，不补点
    // （v4.0.0 起补点在播放中也会触发，滑动时松手停在某一行上就会被“补点”，跳到专辑页、打断正在放的歌）
    if (!wasCleanTap()) return;
    if (target.closest && target.closest(NO_FALLBACK_SEL)) return;   // 评论区、弹窗、标签栏
    // 只对歌曲 / 歌单卡片补点。普通按钮（播放、暂停、喜欢、标签页）点了不会跳转，
    // 如果也补点，会把刚才的操作再做一次（例如刚暂停又被点回播放）
    var item = closestMusicItem(target);
    if (!item || item.__ytClearTapFixUntil > Date.now()) return;
    var innerButton = target.closest && target.closest(
      'button, tp-yt-paper-icon-button, yt-button-renderer, ytmusic-menu-renderer, ytmusic-like-button-renderer, ytmusic-toggle-button-renderer');
    if (innerButton && innerButton !== item && item.contains(innerButton)) return;   // 点的是卡片里的按钮（喜欢、菜单……）

    var before = samePageState();
    var tappedAt = Date.now();
    item.__ytClearTapFixUntil = tappedAt + TAP_FALLBACK_DELAY + 700;
    setTimeout(function () {
      if (!document.contains(item) || samePageState() !== before) return;
      if (state.lastMediaEventAt > tappedAt) return;   // 已经开始播放 / 切歌，说明点击生效了
      if (state.lastLinkTapAt > tappedAt - 1000) return; // 同一次点击已经点到了链接
      var action = fallbackActionFor(item);
      if (!action || isPlayerControlTap(action)) return;
      log('tap fallback: ' + item.tagName.toLowerCase());
      var actionHref = action.getAttribute && action.getAttribute('href');
      var actionWeb = webEquivalent(actionHref);
      if (actionWeb) {
        activateWebPathFromElement(action, actionWeb) || routeWebPathWithoutReload(actionWeb);
        return;
      }
      try {
        var synthetic = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        synthetic.__ytClearScriptableMusicTapFix = true;
        action.dispatchEvent(synthetic);
      } catch (e) {
        try { action.click(); } catch (e2) {}
      }
    }, TAP_FALLBACK_DELAY);
  }

  function getEventPoint(event) {
    var touch = event.changedTouches && event.changedTouches[0];
    if (touch) return touch;
    if (typeof event.clientX === 'number' && typeof event.clientY === 'number' && (event.clientX || event.clientY)) return event;
    if (state.lastTapPoint && Date.now() - state.lastTapPoint.time < 1200) return state.lastTapPoint;
    return null;
  }

  function closestHrefNode(node) {
    while (node && node !== document) {
      if (node.getAttribute && node.getAttribute('href')) return node;
      node = node.parentElement || node.parentNode;
    }
    return null;
  }

  // 只对歌曲行、歌单 / 专辑卡片补点。
  // 旧版还包括所有 [role="listitem"]，评论也属于这一类：点评论（展开全文）不会跳转，
  // 补点就会点到评论者主页或评论时间链接，跳到别的页面、切掉正在放的歌
  var MUSIC_ITEM_SEL = [
    'ytmusic-responsive-list-item-renderer',
    'ytmusic-two-row-item-renderer'
  ].join(',');

  // 这些区域里的点击一律不补点
  var NO_FALLBACK_SEL = [
    'ytd-comments', 'ytd-comment-thread-renderer', 'ytd-comment-renderer', 'ytd-comment-view-model',
    'ytm-comment-thread-renderer', 'ytm-comment-renderer', 'ytmusic-comment-section-renderer',
    '#comments', '[id*="comment"]', '[class*="comment"]',
    'ytmusic-player-page tp-yt-paper-tabs', 'tp-yt-paper-dialog', 'ytmusic-menu-popup-renderer'
  ].join(',');

  function closestMusicItem(node) {
    while (node && node !== document) {
      if (node.matches && node.matches(MUSIC_ITEM_SEL)) return node;
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

  var ITEM_ACTION_SEL = [
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

  // 补点时点哪里：歌曲行只点歌名链接或播放按钮，绝不点行里的歌手 / 专辑链接（否则会跳到专辑页）
  function fallbackActionFor(item) {
    var tag = item.tagName ? item.tagName.toLowerCase() : '';
    if (tag === 'ytmusic-responsive-list-item-renderer') {
      return item.querySelector('a[href*="watch"]') ||
             item.querySelector('ytmusic-play-button-renderer, .play-button, #play-button') || null;
    }
    // 卡片：点封面 / 标题的主链接
    return item.querySelector('a.yt-simple-endpoint[href], a.thumbnail[href]') || findItemAction(item) || null;
  }

  function findItemAction(item) {
    for (var i = 0; i < ITEM_ACTION_SEL.length; i++) {
      var node = item.querySelector && item.querySelector(ITEM_ACTION_SEL[i]);
      if (node && !isOverflowMenu(node)) return node;
    }
    return null;
  }

  var PLAYER_CONTROL_SEL = [
    'ytmusic-player-bar',
    'ytmusic-app-layout > [slot="player-bar"]',
    'input',
    'textarea',
    'select',
    'ytmusic-menu-renderer',
    'ytmusic-search-box',
    'ytmusic-pivot-bar-renderer',
    'ytmusic-nav-bar',
    '#ytm-debug-overlay'
  ].join(',');

  function isPlayerControlTap(node) {
    var current = node;
    while (current && current !== document) {
      if (current.matches && current.matches(PLAYER_CONTROL_SEL)) return true;
      current = current.parentElement || current.parentNode;
    }
    return false;
  }

  function isOverflowMenu(node) {
    var label = (node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title'))) || '';
    return /more|menu|更多|选项|選項/i.test(label);
  }

  /* ══════════════════════════════════════════════════════════
     播放器 / 音频元素
     ══════════════════════════════════════════════════════════ */

  function getPlayer() {
    if (!state.player || !document.contains(state.player)) {
      state.player = document.querySelector('#movie_player, .html5-video-player');
      if (state.player) patchPlayerMethods(state.player);
    }
    return state.player;
  }

  function patchPlayerMethods(player) {
    if (!player || player.__ytClearScriptableMusicPlayerPatch === VERSION) return;
    player.__ytClearScriptableMusicPlayerPatch = VERSION;
    state.patchedPlayers.push(player);

    function wrap(name, make) {
      var key = '__ytClearNative_' + name;
      var nativeMethod = player[key] || player[name];   // 取原版，避免包装旧版本的包装
      if (typeof nativeMethod !== 'function') return;
      player[key] = nativeMethod;
      player[name] = make(nativeMethod);
    }

    ['pauseVideo', 'stopVideo'].forEach(function (name) {
      wrap(name, function (nativeMethod) {
        return function () {
          if (!shouldAllowPause(name)) { softResume(80); return undefined; }
          return nativeMethod.apply(player, arguments);
        };
      });
    });

    wrap('playVideo', function (nativeMethod) {
      return function () {
        if (!shouldAllowPagePlay('playVideo')) return undefined;
        clearUserPaused();
        return nativeMethod.apply(player, arguments);
      };
    });

    // 切歌：属于正常的播放过渡
    ['loadVideoById', 'loadVideoByUrl', 'loadPlaylist', 'nextVideo', 'previousVideo'].forEach(function (name) {
      wrap(name, function (nativeMethod) {
        return function () {
          clearUserPaused();
          state.interrupted = false;
          markTransition();
          return nativeMethod.apply(player, arguments);
        };
      });
    });
  }

  function findVideo() {
    return document.querySelector('#movie_player video') ||
           document.querySelector('.html5-video-player video') ||
           document.querySelector('video');
  }

  function getVideo() {
    if (!state.video || !document.contains(state.video)) {
      state.video = findVideo();
      var v = state.video;
      if (v && v.__ytClearMusicBound !== VERSION) {
        v.__ytClearMusicBound = VERSION;
        log('video bound');
        v.setAttribute('playsinline', '');
        v.setAttribute('webkit-playsinline', '');
        listen(v, 'playing', onVideoPlaying, { passive: true });
        listen(v, 'play', onVideoPlaying, { passive: true });
        listen(v, 'pause', onVideoPause, true);
        listen(v, 'loadstart', onVideoLoadStart, { passive: true });
        listen(v, 'emptied', onVideoLoadStart, { passive: true });
        listen(v, 'waiting', onVideoGap, { passive: true });
        listen(v, 'ended', onVideoGap, { passive: true });
        listen(v, 'canplay', onVideoCanPlay, { passive: true });
        listen(v, 'seeked', onVideoSeeked, { passive: true });
        listen(v, 'durationchange', scheduleBurst, { passive: true });
        listen(v, 'ratechange', trackContentState, { passive: true });
        listen(v, 'volumechange', trackContentState, { passive: true });
        listen(v, 'webkitpresentationmodechanged', onPresentationModeChanged, { passive: true });
      }
    }
    return state.video;
  }

  function inNativePlayer(v) {
    if (!v) return false;
    if (v.webkitDisplayingFullscreen) return true;
    var mode = v.webkitPresentationMode;
    return mode === 'fullscreen' || mode === 'picture-in-picture';
  }

  function isInPiP(v) {
    return !!v && v.webkitPresentationMode === 'picture-in-picture';
  }

  function onPresentationModeChanged(event) {
    var v = event && event.target;
    log('presentation ' + (v && v.webkitPresentationMode));
    applyKeepAlivePolicy('presentation');
  }

  function onVideoPlaying(event) {
    if (isBlessEvent('play')) return;
    log('playing');
    state.lastMediaEventAt = Date.now();
    if (state.interrupted) {
      state.interrupted = false;
      state.resumeAfterInterruption = false;
      stopInterruptBeat();
      log('interruption ended: playing (resumed by system)');
      // 系统自己恢复了播放：同步 YT Music 的状态，并防止它随即又暂停
      state.protectPlayUntil = Date.now() + RESUME_PROTECT;
      var p = getPlayer();
      var nativePlayVideo = p && (p.__ytClearNative_playVideo || p.playVideo);
      try { if (nativePlayVideo) nativePlayVideo.call(p); } catch (e) {}
      if (isBackground()) {
        var vv = state.video, tStart = vv ? vv.currentTime : 0;
        setTimeout(function () {
          if (vv) log('progress 3s after system resume: +' + (vv.currentTime - tStart).toFixed(1) + 's (' + (vv.paused ? 'paused' : 'playing') + ')');
        }, 3000);
      }
    }
    if (!state.playingSince) state.playingSince = Date.now();
    state.transitionUntil = 0;
    clearUserPaused();
    state.mediaSessionBound = false;
    applyKeepAlivePolicy('playing');
    if (state.pendingUnmute) {
      setTimeout(function () {
        if (isBackground()) return;
        state.pendingUnmute = false;
        var video = getVideo();
        if (video && !state.inAd && !state.touchedMute) video.muted = false;
      }, 250);
    }
    scheduleBurst();
    updateMediaSession();
  }

  function isNearEnd(v) {
    return v && Number.isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - 1.5;
  }

  /* ─── 暂停事件：所有暂停都会到这里（包括系统造成的） ─── */
  function onVideoPause(event) {
    if (isBlessEvent('pause')) return;
    var video = (event && event.target) || getVideo();
    state.playingSince = 0;
    state.lastMediaEventAt = Date.now();
    if (!video || video.ended || isNearEnd(video)) { log('pause: track end'); applyKeepAlivePolicy('track end'); return; }  // 一首播完，交给 YT Music 切歌
    if (state.inAd) { log('pause: ad'); return; }
    if (Date.now() < state.transitionUntil) { log('pause: transition'); return; }
    if (state.userPaused || state.interrupted) {
      log('pause: ' + (state.interrupted ? 'while interrupted' : 'user paused (' + state.userPausedReason + ')'));
      updateMediaSession();
      applyKeepAlivePolicy('pause');
      return;
    }
    var ctxInterrupted = !!(state.audioCtx && state.audioCtx.state === 'interrupted');

    // 1) 原生全屏 / 画中画里：网页收不到触摸，暂停来自系统控件
    if (inNativePlayer(video)) {
      setUserPaused('native player');
      updateMediaSession();
      return;
    }

    // 2) 前台、非手势
    if (!isBackground()) {
      // 保活音频同时被打断 → 来电等真正的打断：挂断后自动继续
      if (ctxInterrupted) {
        beginInterruption('pause + audio interrupted (foreground)');
        updateMediaSession();
        return;
      }
      // 否则：拔耳机、YT Music 自己暂停……尊重它
      acceptForegroundPause('system (foreground)', false);
      updateMediaSession();
      applyKeepAlivePolicy('pause');
      return;
    }

    // 3) 在后台待了一会儿才出现的暂停：被别的 App 打断（微信语音、来电）→ 让出声音
    if (backgroundFor() > BG_SETTLED) {
      beginInterruption('pause in background');
      updateMediaSession();
      return;
    }

    // 4) 刚切到后台时系统造成的暂停 → 恢复
    log('pause while backgrounded -> resume');
    applyKeepAlivePolicy('bg pause');
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

  function onVideoLoadStart() {
    state.lastMediaEventAt = Date.now();
    markTransition();
    onVideoGap();
  }

  // 切歌间隙 / 缓冲：音乐暂时没声音，需要保活音频撑住，免得 App 在后台被挂起
  function onVideoGap() {
    state.playingSince = 0;
    applyKeepAlivePolicy('gap');
  }

  function onVideoCanPlay() {
    state.transitionUntil = 0;
    if (state.shouldResume && !state.userPaused && !state.inAd && !state.interrupted) softResume(0);
  }

  function onVideoSeeked() {
    updatePositionState(getVideo());
  }

  /* ══════════════════════════════════════════════════════════
     恢复播放
     ══════════════════════════════════════════════════════════ */

  function canAutoResume() {
    return !state.userPaused && !state.inAd && !state.interrupted;
  }

  function syncResume() {
    var video = state.video || getVideo();
    if (!video || !canAutoResume()) return;
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
    if (isBackground()) log('resume attempt (background)');
    var promise;
    try { promise = NATIVE.play.call(video); } catch (e) { return; }
    if (!promise || !promise.catch) return;
    promise.catch(function (error) {
      log('play blocked ' + (error && error.name) + (isBackground() ? ' (bg)' : ''));
      if (isBackground()) return;
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
      if (!video || !canAutoResume()) return;
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
    var mediaVideo = state.video;
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
      state.yieldedInBg = false;
      repairIfStalledSoon('lock screen play');
      stopInterruptBeat();
      state.interrupted = false;
      state.resumeAfterInterruption = false;
      clearUserPaused();
      startAudioKeepAlive();
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
    // 保持为 null：设置了快退/快进，iOS 锁屏会把“上一首/下一首”换成 ±10 秒按钮
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

  function startTrackChange() {
    state.interrupted = false;
    state.resumeAfterInterruption = false;
    clearUserPaused();
    markTransition();
    startAudioKeepAlive();
    blessGesture();
  }

  function nextTrack() {
    log('ms next');
    startTrackChange();
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
    startTrackChange();
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

  // 拖动锁屏进度条：暂停中拖动保持暂停，播放中拖动继续播放
  function seekTo(seconds) {
    var video = getVideo();
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
      var button = null;
      try { button = document.querySelector(selectors[i]); } catch (e) {}
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

  // 只点一次：旧版 click() 之后又派发了一个 click 事件，锁屏“下一首”会连跳两首
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
     保活音频：几乎无声的振荡器，让 App 在后台不被挂起
     只在需要时运行：
       · 前台、刚进后台、切歌间隙、缓冲中、用户暂停（10 分钟内，方便从锁屏继续）→ 运行
       · 后台稳定播放中、被打断中、画中画中 → 停掉
     后台播放时一直占着音频会话，会让 iOS 在微信语音开始后很快把音乐恢复、打断语音。
     ══════════════════════════════════════════════════════════ */

  function keepAliveWanted() {
    var v = state.video;
    if (state.interrupted) return false;
    if (isInPiP(v)) return false;
    if (state.yieldedInBg && isBackground()) return false;   // 后台让出过声音：不再抢
    if (state.userPaused) return Date.now() - state.userPausedAt < KEEPALIVE_IDLE_STOP;
    if (!isBackground()) return true;
    if (backgroundFor() < BG_KEEPALIVE_WINDOW) return true;
    var playingSteadily = v && !v.paused && !v.ended && state.playingSince &&
      Date.now() - state.playingSince > KEEPALIVE_PLAYING_OFF;
    return !playingSteadily;
  }

  function applyKeepAlivePolicy(reason) {
    var want = keepAliveWanted();
    if (want && !state.keepAliveOsc) {
      startAudioKeepAlive();
      if (state.keepAliveOsc) log('keep-alive on (' + reason + ')');
    } else if (!want && state.keepAliveOsc) {
      stopAudioKeepAlive();
      log('keep-alive off (' + reason + ')');
    }
  }

  function startAudioKeepAlive() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!state.audioCtx) {
      try { state.audioCtx = new AC(); } catch (e) { return; }
      try { listen(state.audioCtx, 'statechange', onAudioStateChange); } catch (e) {}
    }
    if (!keepAliveWanted()) return;

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
        if (!keepAliveWanted()) return;   // 被打断时不去抢音频会话
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

  /* ══════════════════════════════════════════════════════════
     广告
     强信号（播放器 ad-showing / 可见的跳过按钮）才会静音、快进、拖到结尾；
     弱信号（页面里有广告容器）只隐藏元素 —— 容器残留时不会误伤正常歌曲
     ══════════════════════════════════════════════════════════ */

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

  function findSkipButton() {
    for (var i = 0; i < skipSelectors.length; i++) {
      var button = null;
      try { button = document.querySelector(skipSelectors[i]); } catch (e) {}
      if (isVisibleButton(button)) return button;
    }
    return null;
  }

  function adSignal() {
    var player = getPlayer();
    if (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) return 'strong';
    if (findSkipButton()) return 'strong';
    var container = document.querySelector('ytmusic-ad-instream-ads-renderer,.ytp-ad-player-overlay,.ytp-ad-preview-container');
    if (container && container.childElementCount > 0) return 'weak';
    return '';
  }

  function handleAds() {
    var signal = adSignal();
    if (signal) {
      if (!state.inAd) {
        state.inAd = true;
        log('ad start (' + signal + ', restore to ' + state.contentRate + 'x' + (state.contentMuted ? ' muted' : '') + ')');
      }
      hideAdElements();
      if (signal === 'strong') {
        if (!clickSkip() && Date.now() >= state.cooldownUntil) {
          finishShortAd();
          muteAd();
          speedUpAd();
        }
      }
      scheduleBurst();
    } else if (state.inAd && Date.now() > state.cooldownUntil) {
      state.inAd = false;
      log('ad end');
      restorePlayback();
      rebindMediaSession();
      softResume(120);
    }
  }

  function clickSkip() {
    var now = Date.now();
    if (now - state.lastSkipClick < 350) return false;
    var button = findSkipButton();
    if (!button) return false;
    state.lastSkipClick = now;
    state.cooldownUntil = now + 700;
    try { button.click(); } catch (e) {}
    log('ad skip');
    return true;
  }

  function finishShortAd() {
    var video = getVideo();
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 90 || video.ended) return;
    if (video.duration - video.currentTime > 0.35) {
      try {
        video.currentTime = Math.max(0, video.duration - 0.1);
        state.cooldownUntil = Date.now() + 500;
      } catch (e) {}
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
      try { video.playbackRate = 16; } catch (e) {}
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

  // 只撤销我们自己改的：16 倍速恢复成正片时的倍速，静音恢复成正片时的状态
  function restorePlayback() {
    var video = getVideo();
    if (video) {
      try { if (state.touchedRate && video.playbackRate > 4) video.playbackRate = state.contentRate || 1; } catch (e) {}
      try { if (state.touchedMute) video.muted = state.contentMuted; } catch (e) {}
    }
    state.touchedRate = false;
    state.touchedMute = false;
  }

  // 记住正片时用户自己的倍速和静音（广告期间、我们改过时不更新）
  function trackContentState() {
    var v = state.video;
    if (!v || state.inAd || state.touchedRate || state.touchedMute) return;
    if (v.playbackRate > 0 && v.playbackRate <= 4) state.contentRate = v.playbackRate;
    if (!state.pendingUnmute) state.contentMuted = !!v.muted;
  }

  /* ══════════════════════════════════════════════════════════
     “还在听吗？”等确认弹窗
     按钮一般只写“是 / Yes”，所以按弹窗整体的文字匹配，再点里面最后一个可见按钮
     ══════════════════════════════════════════════════════════ */

  var STILL_LISTENING = /still watching|still listening|still there|continue watching|continue listening|video paused|music paused|仍在观看|還在觀看|继续观看|繼續觀看|继续播放|繼續播放|继续收听|繼續收聽|还在听|還在聽|还在吗|還在嗎/i;

  function dismissDialogs() {
    var now = Date.now();
    if (now - state.lastDialogCheck < 1500) return;
    state.lastDialogCheck = now;

    var dialogs = document.querySelectorAll(
      'ytmusic-you-there-renderer, tp-yt-paper-dialog, yt-confirm-dialog-renderer, [role="dialog"], [role="alertdialog"]'
    );
    for (var i = 0; i < dialogs.length; i++) {
      var d = dialogs[i];
      if (!STILL_LISTENING.test(d.textContent || '')) continue;
      var btns = d.querySelectorAll('button, tp-yt-paper-button, yt-button-renderer');
      for (var j = btns.length - 1; j >= 0; j--) {
        if (isVisibleButton(btns[j])) {
          log('dismiss dialog: ' + (d.textContent || '').trim().slice(0, 30));
          try { btns[j].click(); } catch (e) {}
          if (!isGenuineUserPause()) {
            clearUserPaused();
            softResume(200);
          }
          return;
        }
      }
    }
  }

  /* ══════════════════════════════════════════════════════════
     主循环：广告时 / 切歌后 120ms 一次，平时 700ms 一次
     DOM 变化只会“提前”触发一次（150ms 合并），不再每次变化都立刻跑一遍
     ══════════════════════════════════════════════════════════ */

  function tick() {
    injectCSS();
    trackHidden();
    getVideo();
    getPlayer();
    hideAppPrompts();
    dismissDialogs();
    handleAds();
    trackContentState();
    updateMediaSession();
    applyKeepAlivePolicy('tick');
    watchProgress();

    if (state.shouldResume && canAutoResume()) {
      var video = getVideo();
      if (video && video.paused && !video.ended && Date.now() > state.transitionUntil) softResume(0);
    }
  }

  function safeTick() {
    try { tick(); } catch (e) { log('tick error ' + (e && e.message)); }
  }

  function scheduleBurst() {
    state.burstUntil = Date.now() + 2500;
  }

  function startLoop() {
    if (state.loopTimer) clearTimeout(state.loopTimer);
    var loop = function () {
      safeTick();
      var delay = state.inAd || Date.now() < state.burstUntil ? 120 : 700;
      state.loopTimer = setTimeout(loop, delay);
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
    safeTick();
  }

  function startObserver() {
    if (!document.body || state.observer) return;
    state.observer = new MutationObserver(function (mutations) {
      if (state.observerTimer) return;
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length) {
          state.observerTimer = setTimeout(function () {
            state.observerTimer = null;
            safeTick();
          }, 150);
          return;
        }
      }
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ══════════════════════════════════════════════════════════
     调试面板：三根手指同时点屏幕，或屏幕左上角 1.6 秒内连点 4 下
     关闭脚本后，Scriptable 还会弹窗提供“复制日志”
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

  // 三根手指同时点屏幕：打开 / 关闭调试面板（不会和 YT Music 的操作冲突）
  var lastThreeFinger = 0;
  function onThreeFingerTap(event) {
    if (!event.touches || event.touches.length !== 3) return;
    var now = Date.now();
    if (now - lastThreeFinger < 800) return;
    lastThreeFinger = now;
    toggleDebugOverlay();
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
    panel.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:60%;overflow:auto;background:rgba(0,0,0,0.94);color:#7CFC00;font:10px/1.5 monospace;z-index:2147483647;padding:10px;white-space:pre-wrap;-webkit-overflow-scrolling:touch;';

    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;position:sticky;top:0;';
    function btn(text, fn) {
      var x = document.createElement('button');
      x.textContent = text;
      x.style.cssText = 'flex:1;padding:8px;border:none;border-radius:8px;background:#333;color:#fff;font-size:13px;';
      x.addEventListener('touchend', function (e) { e.preventDefault(); e.stopPropagation(); fn(x); }, { passive: false });
      return x;
    }
    var pre = document.createElement('div');
    bar.appendChild(btn('复制日志', function (x) {
      var text = pre.textContent;
      function done(ok) { x.textContent = ok ? '已复制' : '复制失败，请截图'; }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
          return;
        }
      } catch (e) {}
      done(false);
    }));
    bar.appendChild(btn('关闭', function () { if (panel.parentNode) panel.parentNode.removeChild(panel); }));
    panel.appendChild(bar);
    panel.appendChild(pre);

    pre.textContent = 'v' + VERSION +
      '  hidden=' + isReallyHidden() +
      '  bg=' + state.realBackgrounded +
      '  userPaused=' + state.userPaused +
      '  interrupted=' + state.interrupted +
      '  inAd=' + state.inAd +
      '  keepAlive=' + !!state.keepAliveOsc +
      '  audio=' + (state.audioCtx ? state.audioCtx.state : '-') +
      '  stalled=' + !!state.stalledSince +
      '  yielded=' + state.yieldedInBg +
      '  session=' + (audioSessionState() || '-') +
      '  mode=' + ((v && v.webkitPresentationMode) || 'inline') + '\\n' +
      state.logs.slice(-400).join('\\n');
    document.body.appendChild(panel);
  }

  /* ══════════════════════════════════════════════════════════
     销毁：新版本注入时彻底清理旧实例
     ══════════════════════════════════════════════════════════ */

  function destroy() {
    if (state.loopTimer) clearTimeout(state.loopTimer);
    if (state.observerTimer) clearTimeout(state.observerTimer);
    if (state.observer) state.observer.disconnect();
    stopInterruptBeat();

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
    window.open = NATIVE.open;

    state.patchedPlayers.forEach(function (p) {
      ['pauseVideo', 'stopVideo', 'playVideo', 'loadVideoById', 'loadVideoByUrl', 'loadPlaylist', 'nextVideo', 'previousVideo']
        .forEach(function (name) {
          var original = p['__ytClearNative_' + name];
          if (original) p[name] = original;
        });
      try { delete p.__ytClearScriptableMusicPlayerPatch; } catch (e) {}
    });
    if (state.video) {
      try { delete state.video.__ytClearMusicBound; } catch (e) {}
    }

    ['hidden', 'visibilityState', 'webkitHidden', 'webkitVisibilityState', 'hasFocus'].forEach(function (k) {
      try { delete document[k]; } catch (e) {}
    });

    ['yt-clear-scriptable-music-css', 'ytm-debug-overlay'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });

    if (window.__ytClearScriptableMusic && window.__ytClearScriptableMusic.destroy === destroy) {
      delete window.__ytClearScriptableMusic;
    }
  }

  /* ══════════════════════════════════════════════════════════
     启动
     ══════════════════════════════════════════════════════════ */

  window.__ytClearScriptableMusic = { version: VERSION, destroy: destroy, logs: state.logs, state: state };

  patchVisibility();
  patchBackgroundEventRegistration();
  patchMedia();
  watchAudioSession();
  blockAppRedirects();
  bindMobileTapFix();
  injectCSS();
  hideAppPrompts();
  updateMediaSession();

  listen(document, 'touchstart', markGesture, { passive: true });
  listen(document, 'touchend', markGesture, { passive: true });
  listen(window, 'touchend', onDebugTap, { capture: true, passive: true });
  listen(window, 'touchstart', onThreeFingerTap, { capture: true, passive: true });
  listen(document, 'click', markGesture, true);
  listen(document, 'keydown', markGesture, true);

  listen(window, 'yt-navigate-finish', onNavigate);
  listen(window, 'yt-page-data-updated', onNavigate);
  listen(window, 'load', onNavigate);

  if (document.body) startObserver();
  else listen(document, 'DOMContentLoaded', startObserver, { once: true });

  getVideo();
  getPlayer();
  scheduleBurst();
  startLoop();

  return null;
})();
null;
`;

await webView.evaluateJavaScript(magicScript);

// 页面整页刷新（例如“打开 App”链接改成网页打开）后，注入的代码会丢失。
// 每 3 秒检查一次，没有就补注入；已经存在时只是一次很小的查询。
const aliveCheck = "!!(window.__ytClearScriptableMusic && window.__ytClearScriptableMusic.version === '" + VERSION + "')";

// 日志镜像：每 3 秒把网页里新增的日志取回 Scriptable 这边保存，
// 这样即使关闭后网页已经取不到，也能拿到日志
const mirror = [];
let lastSeq = 0;
async function pullLogs() {
  const js = "(function(){var t=window.__ytClearScriptableMusic;if(!t||!t.state)return null;" +
    "var s=t.state.logSeq,n=s>=" + lastSeq + "?Math.min(t.logs.length,s-" + lastSeq + "):t.logs.length;" +
    "return JSON.stringify({seq:s,lines:n>0?t.logs.slice(-n):[]});})()";
  const raw = await webView.evaluateJavaScript(js);
  if (!raw) return;
  const r = JSON.parse(raw);
  if (r.seq < lastSeq) mirror.push('--- 页面重新加载 ---');
  for (const line of r.lines) mirror.push(line);
  if (mirror.length > 1500) mirror.splice(0, mirror.length - 1500);
  lastSeq = r.seq;
}

let busy = false;
const reinjectTimer = Timer.schedule(3000, true, async () => {
  if (busy) return;
  busy = true;
  try {
    const alive = await webView.evaluateJavaScript(aliveCheck);
    if (!alive) await webView.evaluateJavaScript(magicScript);
    await pullLogs();
  } catch (e) {}
  busy = false;
});

await webView.present(true);
reinjectTimer.invalidate();

// 关闭后：取回最后的日志，存文件，并弹窗让你一键复制
try { await pullLogs(); } catch (e) {}
if (mirror.length) {
  let status = '';
  try {
    status = await webView.evaluateJavaScript(
      "(function(){var t=window.__ytClearScriptableMusic;if(!t)return '';var s=t.state,v=s.video;" +
      "return 'userPaused='+s.userPaused+' interrupted='+s.interrupted+' keepAlive='+!!s.keepAliveOsc+" +
      "' audio='+(s.audioCtx?s.audioCtx.state:'-')+' session='+(navigator.audioSession?navigator.audioSession.state:'n/a')+" +
      "' video='+(v&&!v.paused?'playing':'paused');})()"
    );
  } catch (e) {}
  const text = 'v' + VERSION + '  ' + new Date().toString() + '\n' + (status || '') + '\n' + mirror.join('\n');

  // 存文件：先试 iCloud，失败再存本机（文件 App → Scriptable → yt-music-clear-log.txt）
  let savedTo = '';
  const targets = [['iCloud 云盘', () => FileManager.iCloud()], ['我的 iPhone', () => FileManager.local()]];
  for (const [label, make] of targets) {
    try {
      const fm = make();
      fm.writeString(fm.joinPath(fm.documentsDirectory(), 'yt-music-clear-log.txt'), text);
      savedTo = label;
      break;
    } catch (e) {}
  }

  if (SHOW_LOG_ON_CLOSE) {
    const a = new Alert();
    a.title = '本次运行日志（' + mirror.length + ' 行）';
    a.message = (status ? status + '\n\n' : '') + '最后几行：\n' + mirror.slice(-6).join('\n') +
      (savedTo ? '\n\n已保存到 文件 App → ' + savedTo + ' → Scriptable → yt-music-clear-log.txt' : '');
    a.addAction('复制日志');
    a.addCancelAction('不用');
    const choice = await a.presentAlert();
    if (choice === 0) Pasteboard.copy(text);
  }
}
Script.complete();

}
