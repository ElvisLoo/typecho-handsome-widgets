/*
 * Handsome Pomodoro Widget — 右下角番茄钟
 * 纯前端 / 零依赖 / 零网络请求 / localStorage 持久化
 *
 * 本文件同时导出可测试的纯函数核心：
 *   浏览器：window.JGPomodoroCore
 *   Node  ：require('./pomodoro.js')
 * 在 Node 环境下不会初始化 UI，方便跑单元测试。
 */
(function () {
    'use strict';

    /* ============================================================
     * 1. 纯函数核心（不碰 DOM，可独立测试）
     * ============================================================ */
    var VERSION = '1.0.0';

    var DEFAULTS = {
        focus: 25,          // 专注分钟
        short: 5,           // 短休分钟
        long: 15,           // 长休分钟
        cycle: 4,           // 每几个番茄进一次长休
        sound: true,        // 完成时提示音
        autoBreak: false,   // 完成后自动开始休息
        autoFocus: false,   // 休息结束后自动开始专注
        title: true,        // 标题栏倒计时
        notify: true         // 完成时桌面通知
    };

    function clampInt(v, def, min, max) {
        var n = parseInt(v, 10);
        if (!isFinite(n) || isNaN(n)) return def;
        return Math.min(max, Math.max(min, n));
    }

    function normalizeSettings(raw) {
        raw = raw || {};
        return {
            focus: clampInt(raw.focus, DEFAULTS.focus, 1, 180),
            short: clampInt(raw.short, DEFAULTS.short, 1, 60),
            long: clampInt(raw.long, DEFAULTS.long, 1, 120),
            cycle: clampInt(raw.cycle, DEFAULTS.cycle, 2, 12),
            sound: raw.sound !== false,
            autoBreak: raw.autoBreak === true,
            autoFocus: raw.autoFocus === true,
            title: raw.title !== false,
            notify: raw.notify !== false
        };
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    function formatClock(sec) {
        sec = Math.max(0, Math.floor(Number(sec) || 0));
        var m = Math.floor(sec / 60), s = sec % 60;
        return pad2(m) + ':' + pad2(s);
    }

    function dayKey(ts) {
        var d = (ts instanceof Date) ? ts : new Date(ts == null ? Date.now() : ts);
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    var WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

    function weekKeys(ts) {
        var now = (ts instanceof Date) ? new Date(ts.getTime()) : new Date(ts == null ? Date.now() : ts);
        var out = [];
        for (var i = 6; i >= 0; i--) {
            var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
            out.push({ key: dayKey(d), label: WEEK_LABELS[d.getDay()], day: d.getDate() });
        }
        return out;
    }

    function totalForMode(mode, settings) {
        settings = normalizeSettings(settings);
        if (mode === 'short') return settings.short * 60;
        if (mode === 'long') return settings.long * 60;
        return settings.focus * 60;
    }

    function modeLabel(mode) {
        return mode === 'short' ? '短休息' : (mode === 'long' ? '长休息' : '专注中');
    }

    function blankState(settings) {
        return {
            mode: 'focus', running: false, endAt: 0,
            remaining: totalForMode('focus', settings),
            completed: 0, startedAt: 0
        };
    }

    function normalizeState(raw, settings) {
        var base = blankState(settings);
        if (!raw || typeof raw !== 'object') return base;
        var mode = (raw.mode === 'short' || raw.mode === 'long') ? raw.mode : 'focus';
        var total = totalForMode(mode, settings);
        var remaining = clampInt(raw.remaining, total, 0, total);
        var endAt = Number(raw.endAt) || 0;
        return {
            mode: mode,
            running: raw.running === true && endAt > 0,
            endAt: endAt,
            remaining: remaining,
            completed: clampInt(raw.completed, 0, 0, 9999),
            startedAt: Number(raw.startedAt) || 0
        };
    }

    function remaining(state, now) {
        now = now == null ? Date.now() : now;
        if (state.running && state.endAt > 0) {
            return Math.max(0, Math.ceil((state.endAt - now) / 1000));
        }
        return Math.max(0, Math.floor(state.remaining || 0));
    }

    function progress(state, settings, now) {
        var total = totalForMode(state.mode, settings);
        if (total <= 0) return 0;
        var p = 1 - remaining(state, now) / total;
        return Math.min(1, Math.max(0, p));
    }

    function nextMode(state, settings) {
        settings = normalizeSettings(settings);
        if (state.mode !== 'focus') return 'focus';
        var n = (state.completed || 0) + 1;
        return (n % settings.cycle === 0) ? 'long' : 'short';
    }

    function emptyRecord() { return { minutes: 0, pomodoros: 0, breaks: 0 }; }

    /* 完成一轮：返回新的 state / history / 本次记录。纯函数，不修改入参。 */
    function complete(state, settings, history, now) {
        settings = normalizeSettings(settings);
        now = now == null ? Date.now() : now;
        var key = dayKey(now);
        var rec = Object.assign({}, (history && history[key]) || emptyRecord());
        var minutes = state.mode === 'focus' ? settings.focus
            : (state.mode === 'short' ? settings.short : settings.long);
        if (state.mode === 'focus') { rec.minutes += minutes; rec.pomodoros += 1; }
        else { rec.breaks += 1; }

        var h = Object.assign({}, history || {});
        h[key] = rec;

        var mode = nextMode(state, settings);
        var auto = (mode === 'focus') ? settings.autoFocus : settings.autoBreak;
        var ns = {
            mode: mode,
            running: !!auto,
            endAt: auto ? now + totalForMode(mode, settings) * 1000 : 0,
            remaining: totalForMode(mode, settings),
            completed: state.mode === 'focus' ? (state.completed || 0) + 1 : (state.completed || 0),
            startedAt: auto ? now : 0
        };
        return {
            state: ns,
            history: h,
            record: { day: key, mode: state.mode, minutes: minutes }
        };
    }

    function normalizeStore(raw) {
        raw = (raw && typeof raw === 'object') ? raw : {};
        var settings = normalizeSettings(raw.settings);
        return {
            v: 1,
            settings: settings,
            state: normalizeState(raw.state, settings),
            history: (raw.history && typeof raw.history === 'object') ? raw.history : {},
            ui: { dark: !!(raw.ui && raw.ui.dark), open: !!(raw.ui && raw.ui.open), view: (raw.ui && raw.ui.view) === 'week' ? 'week' : 'day' }
        };
    }

    var Core = {
        VERSION: VERSION, DEFAULTS: DEFAULTS,
        normalizeSettings: normalizeSettings, normalizeState: normalizeState,
        normalizeStore: normalizeStore, formatClock: formatClock,
        dayKey: dayKey, weekKeys: weekKeys, totalForMode: totalForMode,
        modeLabel: modeLabel, blankState: blankState,
        remaining: remaining, progress: progress,
        nextMode: nextMode, complete: complete, emptyRecord: emptyRecord
    };

    if (typeof module === 'object' && module.exports) { module.exports = Core; return; }
    if (typeof document === 'undefined') return;
    window.JGPomodoroCore = Core;

    /* ============================================================
     * 2. 浏览器 UI
     * ============================================================ */
    if (window.__jgPomodoroMounted) return;
    window.__jgPomodoroMounted = true;

    var OPTS = window.JG_POMODORO_OPTS || {};
    var KEY = OPTS.storageKey || 'jgPomodoro.v1';
    var RING_LEN = 2 * Math.PI * 52;             // r=52

    function load() {
        try { return Core.normalizeStore(JSON.parse(localStorage.getItem(KEY))); }
        catch (e) { return Core.normalizeStore(null); }
    }
    var S = load();
    var saveTimer = null;
    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
    }
    function saveSoon() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 120);
    }

    function $(id) { return document.getElementById(id); }

    /** 「允许浏览器通知」按钮的显隐 */
    function syncNotifyUI() {
        var btn = $('jgpm-notify-btn');
        if (!btn) return;
        btn.hidden = !(S.settings.notify && notifyPerm() !== 'granted');
    }

    /* ---------- DOM ---------- */
    var root = document.createElement('div');
    root.id = 'jgpm-root';
    root.className = 'jgpm' + (S.ui.dark ? ' jgpm-dark' : '');
    root.innerHTML = [
        '<button id="jgpm-fab" class="jgpm-fab" type="button" aria-label="打开番茄钟" title="番茄钟">',
        '  <svg class="jgpm-fab-ring" viewBox="0 0 120 120" aria-hidden="true">',
        '    <circle class="jgpm-fab-ring-bg" cx="60" cy="60" r="52"></circle>',
        '    <circle class="jgpm-fab-ring-fg" id="jgpm-fab-ring-fg" cx="60" cy="60" r="52"></circle>',
        '  </svg>',
        '  <span class="jgpm-fab-face" id="jgpm-fab-face">🍅</span>',
        '  <span class="jgpm-fab-time" id="jgpm-fab-time"></span>',
        '</button>',
        '<section id="jgpm-panel" class="jgpm-panel" aria-label="番茄钟" hidden>',
        '  <header class="jgpm-head">',
        '    <span class="jgpm-title">番茄钟</span>',
        '    <div class="jgpm-tabs" role="tablist">',
        '      <button type="button" data-view="day" class="jgpm-tab">日视图</button>',
        '      <button type="button" data-view="week" class="jgpm-tab">周视图</button>',
        '    </div>',
        '    <button type="button" id="jgpm-theme" class="jgpm-icon" title="切换深浅">◐</button>',
        '    <button type="button" id="jgpm-close" class="jgpm-icon" title="收起">×</button>',
        '  </header>',
        '  <div class="jgpm-view" id="jgpm-view-day">',
        '    <div class="jgpm-timer">',
        '      <svg class="jgpm-dial" viewBox="0 0 120 120" aria-hidden="true">',
        '        <circle class="jgpm-dial-bg" cx="60" cy="60" r="52"></circle>',
        '        <circle class="jgpm-dial-fg" id="jgpm-dial-fg" cx="60" cy="60" r="52"></circle>',
        '      </svg>',
        '      <div class="jgpm-timer-center">',
        '        <div class="jgpm-mode" id="jgpm-mode">专注中</div>',
        '        <div class="jgpm-clock" id="jgpm-clock">25:00</div>',
        '        <div class="jgpm-sub" id="jgpm-sub"></div>',
        '      </div>',
        '    </div>',
        '    <div class="jgpm-actions">',
        '      <button type="button" id="jgpm-start" class="jgpm-primary">开始</button>',
        '      <button type="button" id="jgpm-reset">重置</button>',
        '      <button type="button" id="jgpm-skip">跳过</button>',
        '    </div>',
        '    <div class="jgpm-metrics">',
        '      <div class="jgpm-metric"><span>⏳ 总时间</span><b id="jgpm-m-min">0min</b></div>',
        '      <div class="jgpm-metric"><span>🍅 总番茄</span><b id="jgpm-m-pomo">0个</b></div>',
        '      <div class="jgpm-metric"><span>☕ 休息次数</span><b id="jgpm-m-break">0次</b></div>',
        '    </div>',
        '  </div>',
        '  <div class="jgpm-view" id="jgpm-view-week" hidden>',
        '    <div class="jgpm-week-head">近 7 天专注 <b id="jgpm-week-total">0min</b></div>',
        '    <div class="jgpm-bars" id="jgpm-bars"></div>',
        '    <div class="jgpm-week-foot">数据只保存在这台设备的浏览器里</div>',
        '  </div>',
        '  <footer class="jgpm-foot">',
        '    <span id="jgpm-hint"></span>',
        '    <button type="button" id="jgpm-settings" class="jgpm-link">设置</button>',
        '  </footer>',
        '  <div class="jgpm-settings" id="jgpm-settings-box" hidden>',
        '    <label>专注 <input type="number" id="jgpm-s-focus" min="1" max="180"> 分</label>',
        '    <label>短休 <input type="number" id="jgpm-s-short" min="1" max="60"> 分</label>',
        '    <label>长休 <input type="number" id="jgpm-s-long" min="1" max="120"> 分</label>',
        '    <label>每 <input type="number" id="jgpm-s-cycle" min="2" max="12"> 个番茄长休</label>',
        '    <label class="jgpm-check"><input type="checkbox" id="jgpm-s-sound"> 完成提示音</label>',
        '    <label class="jgpm-check"><input type="checkbox" id="jgpm-s-title"> 标题栏倒计时</label>',
        '    <label class="jgpm-check"><input type="checkbox" id="jgpm-s-autobreak"> 自动开始休息</label>',
        '    <label class="jgpm-check"><input type="checkbox" id="jgpm-s-autofocus"> 休息后自动开始专注</label>',
        '    <label class="jgpm-check" id="jgpm-notify-row"><input type="checkbox" id="jgpm-s-notify"> 桌面通知</label>',
        '    <button type="button" id="jgpm-notify-btn" class="jgpm-link" hidden>允许浏览器通知</button>',
        '    <button type="button" id="jgpm-s-save" class="jgpm-primary">保存</button>',
        '  </div>',
        '</section>'
    ].join('\n');
    document.body.appendChild(root);

    var fab = $('jgpm-fab'), panel = $('jgpm-panel');
    var baseTitle = document.title;

    /* ---------- 提示音（复用同一个 AudioContext，避免反复完成时堆积句柄） ---------- */
    var audioCtx = null;
    function beep(times) {
        if (!S.settings.sound) return;
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!audioCtx) audioCtx = new AC();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            var ctx = audioCtx;
            for (var i = 0; i < times; i++) {
                var o = ctx.createOscillator(), g = ctx.createGain();
                o.type = 'sine'; o.frequency.value = i % 2 ? 659.25 : 880;
                var t = ctx.currentTime + i * 0.24;
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
                o.connect(g); g.connect(ctx.destination);
                o.start(t); o.stop(t + 0.22);
            }
        } catch (e) {}
    }

    /* ---------- 桌面通知（与侧栏版 v2.2.0 同逻辑） ---------- */
    function notifySupported() {
        try { return typeof window.Notification !== 'undefined'; } catch (e) { return false; }
    }
    function notifyPerm() {
        if (!notifySupported()) return 'unsupported';
        try { return window.Notification.permission; } catch (e) { return 'denied'; }
    }
    function askNotify(cb) {
        if (!notifySupported()) { if (cb) cb('denied'); return; }
        try {
            var p = window.Notification.requestPermission(function (r) { if (cb) cb(r); });
            if (p && typeof p.then === 'function') p.then(function (r) { if (cb) cb(r); });
        } catch (e) { if (cb) cb('denied'); }
    }
    function pushNotify(title, body) {
        if (!S.settings.notify || !notifySupported()) return;
        try {
            if (window.Notification.permission !== 'granted') return;
            var n = new window.Notification(title, { body: body, tag: 'jgpm-' + Date.now() });
            n.onclick = function () { try { window.focus(); } catch (e) {} };
        } catch (e) {}
    }
    function notifyFinish(finished) {
        var st = S.settings;
        var label = (finished === 'short' ? '短休息' : (finished === 'long' ? '长休息' : '专注'));
        var body = (finished === 'focus')
            ? (S.state.mode === 'long' ? '专注结束，长休 ' + st.long + ' 分钟' : '专注结束，休息 ' + st.short + ' 分钟')
            : '休息结束，开始 ' + st.focus + ' 分钟专注';
        pushNotify(label + '完成', body);
    }

    /* ---------- 头像状态联动（Handsome 小头像模式） ---------- */
    function syncAvatar() {
        var el = $('status_emoji');
        var des = document.querySelector('.avatar-emoji-des');
        if (!el && !des) return;
        var emoji = S.state.running ? (S.state.mode === 'focus' ? '🍅' : '☕') : '🏃';
        var text = S.state.running ? (S.state.mode === 'focus' ? '专注中' : '休息中') : '折腾中';
        if (el) { el.textContent = emoji; el.setAttribute('title', text); el.setAttribute('data-original-title', text); }
        if (des) des.textContent = text;
    }

    /* ---------- 渲染 ---------- */
    function render() {
        var st = S.state, set = S.settings;
        var sec = Core.remaining(st, Date.now());
        var p = Core.progress(st, set, Date.now());
        var clock = Core.formatClock(sec);

        $('jgpm-clock').textContent = clock;
        $('jgpm-mode').textContent = st.running ? Core.modeLabel(st.mode) : (st.mode === 'focus' ? '准备专注' : Core.modeLabel(st.mode));
        $('jgpm-sub').textContent = st.mode === 'focus'
            ? ('第 ' + ((st.completed || 0) + 1) + ' 个番茄 · ' + set.focus + ' 分钟')
            : (set[st.mode] + ' 分钟后继续');
        $('jgpm-start').textContent = st.running ? '暂停' : '开始';
        $('jgpm-dial-fg').style.strokeDasharray = RING_LEN;
        $('jgpm-dial-fg').style.strokeDashoffset = RING_LEN * (1 - p);
        $('jgpm-fab-ring-fg').style.strokeDasharray = RING_LEN;
        $('jgpm-fab-ring-fg').style.strokeDashoffset = RING_LEN * (1 - p);
        root.classList.toggle('jgpm-running', !!st.running);
        root.classList.toggle('jgpm-break', st.mode !== 'focus');
        $('jgpm-fab-face').textContent = st.mode === 'focus' ? '🍅' : '☕';
        $('jgpm-fab-time').textContent = st.running ? clock.slice(0, 2) : '';

        var rec = S.history[Core.dayKey()] || Core.emptyRecord();
        $('jgpm-m-min').textContent = rec.minutes >= 60
            ? (Math.floor(rec.minutes / 60) + 'h' + (rec.minutes % 60) + 'min')
            : (rec.minutes + 'min');
        $('jgpm-m-pomo').textContent = rec.pomodoros + '个';
        $('jgpm-m-break').textContent = rec.breaks + '次';
        $('jgpm-hint').textContent = set.focus + ' / ' + set.short + ' / ' + set.long + ' 分钟 · 本地保存';

        panel.hidden = !S.ui.open;
        fab.setAttribute('aria-expanded', S.ui.open ? 'true' : 'false');
        $('jgpm-view-day').hidden = S.ui.view !== 'day';
        $('jgpm-view-week').hidden = S.ui.view !== 'week';
        var tabs = document.querySelectorAll('.jgpm-tab');
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-view') === S.ui.view);
        root.classList.toggle('jgpm-dark', !!S.ui.dark);

        if (S.ui.view === 'week') renderWeek();
        syncAvatar();

        if (set.title) {
            var plain = document.title.replace(/^\[\d{2}:\d{2}\][^·]*·\s*/, '');
            document.title = st.running ? ('[' + clock + '] ' + Core.modeLabel(st.mode) + ' · ' + plain) : plain;
        }
    }

    function renderWeek() {
        var keys = Core.weekKeys(), max = 1, total = 0, i;
        var vals = keys.map(function (k) {
            var r = S.history[k.key] || Core.emptyRecord();
            total += r.minutes;
            if (r.minutes > max) max = r.minutes;
            return r.minutes;
        });
        $('jgpm-week-total').textContent = total >= 60
            ? (Math.floor(total / 60) + 'h' + (total % 60) + 'min') : (total + 'min');
        var html = '';
        for (i = 0; i < keys.length; i++) {
            var h = Math.max(3, Math.round(vals[i] / max * 74));
            var today = keys[i].key === Core.dayKey();
            html += '<div class="jgpm-bar-col' + (today ? ' today' : '') + '">'
                + '<span class="jgpm-bar-val">' + (vals[i] || '') + '</span>'
                + '<div class="jgpm-bar" style="height:' + h + 'px"></div>'
                + '<span class="jgpm-bar-lab">' + keys[i].label + '</span></div>';
        }
        $('jgpm-bars').innerHTML = html;
    }

    /* ---------- 状态操作 ---------- */
    function start() {
        var st = S.state;
        if (st.running) return;
        var sec = Core.remaining(st, Date.now());
        st.running = true;
        st.endAt = Date.now() + sec * 1000;
        st.startedAt = Date.now();
        save(); render();
    }
    function pause() {
        var st = S.state;
        if (!st.running) return;
        st.remaining = Core.remaining(st, Date.now());
        st.running = false; st.endAt = 0;
        save(); render();
    }
    function reset() {
        S.state = Core.blankState(S.settings);
        save(); render();
    }
    function skip() {
        // 跳过不等于完成：只切到下一阶段，不记番茄、不记休息
        var st = S.state;
        st.mode = (st.mode === 'focus') ? 'short' : 'focus';
        st.running = false; st.endAt = 0; st.startedAt = 0;
        st.remaining = Core.totalForMode(st.mode, S.settings);
        save(); render();
    }
    function finish() {
        var r = Core.complete(S.state, S.settings, S.history, Date.now());
        var finished = r.record.mode;
        S.state = r.state; S.history = r.history;
        beep(finished === 'focus' ? 2 : 1);
        notifyFinish(finished);
        save(); render();
    }

    /* ---------- 每秒 tick（基于结束时间戳，切后台不漂移） ---------- */
    function tick() {
        if (S.state.running && Date.now() >= S.state.endAt) finish();
        else render();
    }
    setInterval(tick, 1000);

    /* ---------- 事件 ---------- */
    fab.addEventListener('click', function () {
        S.ui.open = !S.ui.open; saveSoon(); render();
    });
    $('jgpm-close').addEventListener('click', function () {
        S.ui.open = false; saveSoon(); render();
    });
    $('jgpm-start').addEventListener('click', function () {
        S.state.running ? pause() : start();
    });
    $('jgpm-reset').addEventListener('click', reset);
    $('jgpm-skip').addEventListener('click', skip);
    $('jgpm-theme').addEventListener('click', function () {
        S.ui.dark = !S.ui.dark; saveSoon(); render();
    });
    var tabs = document.querySelectorAll('.jgpm-tab');
    for (var i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener('click', function () {
            S.ui.view = this.getAttribute('data-view'); saveSoon(); render();
        });
    }
    $('jgpm-settings').addEventListener('click', function () {
        var box = $('jgpm-settings-box');
        box.hidden = !box.hidden;
        if (!box.hidden) {
            $('jgpm-s-focus').value = S.settings.focus;
            $('jgpm-s-short').value = S.settings.short;
            $('jgpm-s-long').value = S.settings.long;
            $('jgpm-s-cycle').value = S.settings.cycle;
            $('jgpm-s-sound').checked = S.settings.sound;
            $('jgpm-s-title').checked = S.settings.title;
            $('jgpm-s-autobreak').checked = S.settings.autoBreak;
            $('jgpm-s-autofocus').checked = S.settings.autoFocus;
            $('jgpm-s-notify').checked = S.settings.notify;
            syncNotifyUI();
            if (!notifySupported()) $('jgpm-notify-row').style.display = 'none';
        }
    });
    $('jgpm-notify-btn').addEventListener('click', function () {
        askNotify(function () { syncNotifyUI(); });
    });
    $('jgpm-s-save').addEventListener('click', function () {
        var wantNotify = $('jgpm-s-notify').checked;
        var done = function (ok) {
            S.settings = Core.normalizeSettings({
                focus: $('jgpm-s-focus').value, short: $('jgpm-s-short').value,
                long: $('jgpm-s-long').value, cycle: $('jgpm-s-cycle').value,
                sound: $('jgpm-s-sound').checked, title: $('jgpm-s-title').checked,
                autoBreak: $('jgpm-s-autobreak').checked, autoFocus: $('jgpm-s-autofocus').checked,
                notify: ok
            });
            if (!S.state.running) S.state = Core.blankState(S.settings);
            if (!S.settings.title) document.title = baseTitle;
            $('jgpm-settings-box').hidden = true;
            save(); render(); syncNotifyUI();
        };
        if (!wantNotify) done(false);
        else if (notifyPerm() === 'granted') done(true);
        else if (notifyPerm() === 'default') askNotify(function (r) { done(r === 'granted'); });
        else done(false);
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && S.ui.open) { S.ui.open = false; saveSoon(); render(); }
    });
    window.addEventListener('storage', function (e) {
        if (e.key !== KEY || !e.newValue) return;
        try { S = Core.normalizeStore(JSON.parse(e.newValue)); render(); } catch (err) {}
    });
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) render();
    });

    window.JGPomodoro = {
        version: Core.VERSION,
        getState: function () { return JSON.parse(JSON.stringify(S)); },
        start: start, pause: pause, reset: reset, skip: skip, render: render
    };

    render();
})();

