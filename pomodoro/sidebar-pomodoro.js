/*
 * 极客港 · Handsome 侧栏番茄钟控件 v2.3.0
 * 位置：#sidebar 内、天气卡片 #jg-weather 的正下方
 * 特性：零依赖 / 零网络请求 / localStorage 持久化 / 绝对时间戳计时（切后台不漂移）
 *       PJAX 换页自动重挂 / 与天气控件同款白底绿系 widget 外观
 * v2.0.0：补齐旧悬浮版功能——周视图柱状图、累计指标、每 N 番茄长休、
 *         标题栏倒计时、自动开始休息；自动迁移旧版 jgPomodoro.v1 数据
 * v2.1.0：补氛围动效层——呼吸光晕、扫光、运行中向上飘的专注粒子、进度环呼吸光、
 *         完成时粒子爆开；全部是卡片内部图层，控件本体不做任何位移
 * v2.1.3：修近 7 天日期在夏令时地区算错、总时长单位不一致、旧版数据迁移丢失时长设置；
 *         提示音复用 AudioContext；补齐减少动态效果下的粒子开关
 * v2.1.3 内部重构：状态与日期逻辑抽成纯函数核心（下方 Core），UI 层只负责 DOM/音效，
 *         核心可在 Node 中直接 require 测试（tests/core.test.js），行为不变。
 * v2.2.0：新增桌面通知。一轮结束时按设置推送系统通知（专注完成 / 休息完成），
 *         未授权时在设置面板给出「允许浏览器通知」入口；浏览器不支持则整行隐藏。
 * v2.3.0：动效打磨——进度环颜色随模式平滑过渡；主/次按钮加按压缩放反馈。
 */
(function () {
    'use strict';

    var ID = 'jg-sidebar-pomo';
    var KEY = 'jgSidebarPomo.v2';
    var OLD_KEY = 'jgPomodoro.v1';   // 旧悬浮按钮版的存储键
    var VERSION = '2.3.0';

    /* =====================================================================
     * 1. 纯函数核心：不碰 DOM / localStorage，浏览器与 Node 通用
     * ===================================================================== */
    var DEF = { focus: 25, short: 5, long: 15, cycle: 4, sound: true, title: false, autobreak: false, notify: true };
    var MODE = { focus: '专注', short: '短休', long: '长休' };
    var WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
    var HISTORY_DAYS = 30;

    function clamp(v, d, lo, hi) {
        var n = parseInt(v, 10);
        return (isFinite(n) && !isNaN(n)) ? Math.min(hi, Math.max(lo, n)) : d;
    }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function dayKey(ts) {
        var d = new Date(ts == null ? Date.now() : ts);
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    /** 近 7 天的日期键。用本地日历回退，避免夏令时地区「今天 0 点减 N×86400000」落到 23:00/01:00 */
    function weekKeys(now) {
        var t = now == null ? new Date() : new Date(now);
        var out = [];
        for (var i = 6; i >= 0; i--) {
            var d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - i);
            out.push({ key: dayKey(d), t: d.getTime(), day: d.getDate(), label: WEEK_LABELS[d.getDay()] });
        }
        return out;
    }
    function clock(sec) {
        sec = Math.max(0, Math.floor(Number(sec) || 0));
        return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60);
    }
    function emptyRec() { return { m: 0, p: 0, b: 0 }; }
    function sumHistory(h) {
        var m = 0, p = 0, b = 0, k;
        for (k in h) { if (h[k]) { m += h[k].m || 0; p += h[k].p || 0; b += h[k].b || 0; } }
        return { m: m, p: p, b: b };
    }
    function duration(s) { return (s.settings[s.mode] || DEF.focus) * 60; }
    function normalizeSettings(st) {
        st = st || {};
        return {
            focus: clamp(st.focus, DEF.focus, 1, 180),
            short: clamp(st.short, DEF.short, 1, 60),
            long: clamp(st.long, DEF.long, 1, 120),
            cycle: clamp(st.cycle, DEF.cycle, 2, 12),
            sound: st.sound !== false,
            title: !!st.title,
            autobreak: !!st.autobreak,
            notify: st.notify !== false
        };
    }
    /** 迁移旧悬浮版 jgPomodoro.v1：{state, settings, history:{day:{minutes,pomodoros,breaks}}} */
    function migrateOld(raw) {
        if (!raw || typeof raw !== 'object' || !raw.history) return {};
        var h = {}, k;
        for (k in raw.history) {
            var r = raw.history[k] || {};
            h[k] = { m: r.minutes || 0, p: r.pomodoros || 0, b: r.breaks || 0 };
        }
        var st = raw.settings || {};
        return {
            history: h,
            settings: {
                focus: st.focus, short: st.short, long: st.long, cycle: st.cycle,
                sound: st.sound, title: st.title, autobreak: st.autobreak, notify: st.notify
            }
        };
    }
    function fresh() {
        return {
            settings: normalizeSettings({}),
            mode: 'focus', remaining: DEF.focus * 60, endAt: null, running: false,
            done: 0, day: dayKey(), history: {}
        };
    }
    /** 归一化（原 load 的存储解析逻辑）。now 可注入，便于测试。 */
    function normalize(raw, oldRaw, now) {
        now = now == null ? Date.now() : now;
        var f = fresh(), s, st, hist, migrated = false;
        s = (raw && typeof raw === 'object') ? raw : f;
        st = s.settings || {};
        hist = (s.history && typeof s.history === 'object') ? s.history : null;
        // 只有新键没有有效历史、且旧键存在时才迁移。
        // 注意：fresh().history 是空对象，不能用它判断「有没有历史」，否则旧数据永远迁不进来。
        if ((!hist || Object.keys(hist).length === 0) && oldRaw) {
            var mg = migrateOld(oldRaw);
            if (mg.history && Object.keys(mg.history).length) {
                hist = mg.history;
                migrated = true;
            }
            if (mg.settings) {
                ['focus', 'short', 'long', 'cycle', 'sound', 'title', 'autobreak', 'notify'].forEach(function (k) {
                    if (mg.settings[k] != null) st[k] = mg.settings[k];
                });
                migrated = true;
            }
        }
        if (!hist) hist = {};
        s.settings = normalizeSettings(st);
        // 清洗历史（只留近 30 天，防止无限膨胀）
        var clean = {}, cut = now - HISTORY_DAYS * 86400000;
        for (var k in hist) {
            var t = new Date(k + 'T00:00:00').getTime();
            if (isFinite(t) && t >= cut) clean[k] = { m: hist[k].m | 0, p: hist[k].p | 0, b: hist[k].b | 0 };
        }
        s.history = clean;
        if (!MODE[s.mode]) s.mode = 'focus';
        s.remaining = Math.max(0, Math.floor(Number(s.remaining) || 0));
        // 改了时长设置后，旧的剩余时间可能比新时长还长（例如 25 分改 10 分）
        if (!s.running && s.remaining > duration(s)) s.remaining = duration(s);
        // 迁移来的旧数据没有剩余秒数，直接按新时长给一整轮
        if (migrated && !s.running) s.remaining = duration(s);
        s.endAt = s.endAt ? Number(s.endAt) : null;
        s.running = !!s.running;
        s.done = Math.max(0, parseInt(s.done, 10) || 0);
        if (!s.remaining) s.remaining = duration(s);
        return s;
    }
    /** 剩余秒数。运行中按绝对时间戳算，暂停时用存储的 remaining。 */
    function remaining(s, now) {
        now = now == null ? Date.now() : now;
        if (s.running && s.endAt) return Math.max(0, Math.ceil((s.endAt - now) / 1000));
        return Math.max(0, Math.floor(s.remaining || 0));
    }
    function progress(s, now) {
        var total = duration(s);
        if (total <= 0) return 0;
        return Math.min(1, Math.max(0, 1 - remaining(s, now) / total));
    }
    /** 已完成 done 个番茄后进入哪种模式（与线上 v2.1.2 一致：每 cycle 个进长休） */
    function nextMode(done, cycle) {
        return (done % cycle === 0) ? 'long' : 'short';
    }
    /** 纯函数完成一轮：不改入参，返回 {state, history, record}。 */
    function applyComplete(s, now) {
        now = now == null ? Date.now() : now;
        var st = s.settings;
        var key = dayKey(now);
        var hist = {}, k;
        for (k in (s.history || {})) {
            var r = s.history[k] || {};
            hist[k] = { m: r.m | 0, p: r.p | 0, b: r.b | 0 };
        }
        var rec = hist[key] ? { m: hist[key].m, p: hist[key].p, b: hist[key].b } : emptyRec();
        if (s.mode === 'focus') { rec.m += st.focus; rec.p += 1; }
        else { rec.b += 1; }
        hist[key] = rec;
        var done = (s.mode === 'focus') ? (s.done || 0) + 1 : (s.done || 0);
        var mode = (s.mode === 'focus') ? nextMode(done, st.cycle) : 'focus';
        var ns = {
            settings: st,
            mode: mode,
            remaining: duration({ settings: st, mode: mode }),
            endAt: null,
            running: false,
            done: done,
            history: hist,
            day: key
        };
        return { state: ns, history: hist, record: { day: key, mode: s.mode, minutes: st[s.mode] } };
    }

    var Core = {
        DEF: DEF, MODE: MODE, WEEK_LABELS: WEEK_LABELS, HISTORY_DAYS: HISTORY_DAYS,
        clamp: clamp, pad: pad, dayKey: dayKey, weekKeys: weekKeys, clock: clock,
        emptyRec: emptyRec, sumHistory: sumHistory, duration: duration,
        normalizeSettings: normalizeSettings, migrateOld: migrateOld, fresh: fresh,
        normalize: normalize, remaining: remaining, progress: progress,
        nextMode: nextMode, applyComplete: applyComplete
    };

    /* Node 环境：导出核心后直接返回，不执行任何 UI 初始化 */
    if (typeof module === 'object' && module.exports) { module.exports = Core; return; }
    if (typeof document === 'undefined') return;
    window.JGPomodoroCoreV2 = Core;

    /* =====================================================================
     * 2. UI 层：存储 / 音效 / DOM
     * ===================================================================== */
    function load() {
        var raw = null, old = null;
        try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
        try { old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null'); } catch (e) {}
        return Core.normalize(raw, old);
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

    var S = load();
    var box = null, timer = null, ui = { week: false, settings: false };

    /* ---------- 提示音（复用同一个 AudioContext，避免反复完成时堆积句柄） ---------- */
    var audioCtx = null;
    function beep() {
        if (!S.settings.sound) return;
        try {
            var C = window.AudioContext || window.webkitAudioContext;
            if (!C) return;
            if (!audioCtx) audioCtx = new C();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            var ctx = audioCtx;
            [0, .18, .36].forEach(function (t, i) {
                var o = ctx.createOscillator(), g = ctx.createGain();
                o.frequency.value = i === 2 ? 880 : 660;
                o.type = 'sine';
                g.gain.setValueAtTime(.0001, ctx.currentTime + t);
                g.gain.exponentialRampToValueAtTime(.14, ctx.currentTime + t + .02);
                g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + t + .15);
                o.connect(g); g.connect(ctx.destination);
                o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + .16);
            });
        } catch (e) {}
    }

    /* ---------- 桌面通知 ----------
     * 只在「设置里开了 notify」且「浏览器已授权」时才发；不支持 Notification 的浏览器整行隐藏。
     * 权限是异步拿的，所以保存设置时若还没授权，先弹系统授权框，拿到结果再落库。
     */
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
            // 老 Safari 只返回 Promise，新浏览器两种都给；两者都接，回调只关心最终值
            if (p && typeof p.then === 'function') p.then(function (r) { if (cb) cb(r); });
        } catch (e) { if (cb) cb('denied'); }
    }
    function pushNotify(title, body) {
        if (!S.settings.notify || !notifySupported()) return;
        try {
            if (window.Notification.permission !== 'granted') return;
            var n = new window.Notification(title, { body: body, tag: 'jg-pomo-' + Date.now() });
            n.onclick = function () { try { window.focus(); } catch (e) {} };
        } catch (e) {}
    }
    /** finished 是刚结束的那一轮（focus/short/long）；S.mode 已经是下一阶段 */
    function notifyFinish(finished) {
        var st = S.settings;
        var body = (finished === 'focus')
            ? (S.mode === 'long' ? '专注结束，长休 ' + st.long + ' 分钟' : '专注结束，休息 ' + st.short + ' 分钟')
            : '休息结束，开始 ' + st.focus + ' 分钟专注';
        pushNotify(Core.MODE[finished] + '完成', body);
    }

    /* ---------- 状态机 ---------- */
    function settle() {
        // 页面在后台/关闭期间计时可能已经走完，回来时补结算（最多补一轮）
        if (!S.running || !S.endAt) return;
        var left = Core.remaining(S);
        if (left <= 0) complete();
        else S.remaining = left;
    }
    function complete() {
        var r = Core.applyComplete(S, Date.now());
        var finished = r.record.mode;
        S = r.state;
        beep();
        notifyFinish(finished);
        save();
        if (box) {
            box.classList.add('jgsp-finished');
            burst();
            setTimeout(function () { box && box.classList.remove('jgsp-finished'); }, 1600);
        }
        if (S.settings.autobreak) start();   // 自动开始下一阶段（休息或专注）
    }
    function start() {
        if (S.running) return;
        if (!S.remaining) S.remaining = Core.duration(S);
        S.endAt = Date.now() + S.remaining * 1000;
        S.running = true;
        save(); render();
    }
    function pause() {
        if (!S.running) return;
        S.remaining = Math.max(0, Math.ceil((S.endAt - Date.now()) / 1000));
        S.running = false; S.endAt = null;
        save(); render();
    }
    function reset() {
        S.remaining = Core.duration(S);
        S.running = false; S.endAt = null;
        save(); render();
    }
    function skip() {
        S.running = false; S.endAt = null;
        S.mode = (S.mode === 'focus') ? 'short' : 'focus';
        S.remaining = Core.duration(S);
        save(); render();
    }

    /* ---------- DOM ---------- */
    var RING = 2 * Math.PI * 52;
    function build() {
        var sec = document.createElement('section');
        sec.id = ID;
        sec.className = 'widget widget_categories wrapper-md padder-v-none clear box-shadow-wrap-normal';
        sec.innerHTML =
            '<h5 class="widget-title m-t-none">番茄钟' +
                '<span class="jgsp-badge" id="jgsp-badge">今日 0 个</span>' +
                '<button type="button" class="jgsp-cog" id="jgsp-week" title="周视图" aria-label="周视图">📊</button>' +
                '<button type="button" class="jgsp-cog" id="jgsp-cog" title="设置" aria-label="设置">⚙</button>' +
            '</h5>' +
            '<div class="jgsp-fx" id="jgsp-fx" aria-hidden="true"></div>' +
            '<div class="jgsp-body">' +
                '<div class="jgsp-ring">' +
                    '<svg viewBox="0 0 120 120" aria-hidden="true">' +
                        '<circle class="jgsp-ring-bg" cx="60" cy="60" r="52"></circle>' +
                        '<circle class="jgsp-ring-fg" id="jgsp-ring-fg" cx="60" cy="60" r="52"></circle>' +
                    '</svg>' +
                    '<div class="jgsp-center">' +
                        '<div class="jgsp-mode" id="jgsp-mode">专注</div>' +
                        '<div class="jgsp-clock" id="jgsp-clock">25:00</div>' +
                    '</div>' +
                '</div>' +
                '<div class="jgsp-actions">' +
                    '<button type="button" class="jgsp-primary" id="jgsp-start">开始</button>' +
                    '<button type="button" class="jgsp-ghost" id="jgsp-reset" title="重置本轮" aria-label="重置本轮">↺</button>' +
                    '<button type="button" class="jgsp-ghost" id="jgsp-skip" title="跳到下一阶段" aria-label="跳到下一阶段">⏭</button>' +
                '</div>' +
                '<div class="jgsp-foot" id="jgsp-foot">今日专注 0 分钟 · 第 1 轮</div>' +
                '<div class="jgsp-metrics">' +
                    '<div><span>⏳ 总时间</span><b id="jgsp-m-min">0min</b></div>' +
                    '<div><span>🍅 总番茄</span><b id="jgsp-m-pomo">0个</b></div>' +
                    '<div><span>☕ 休息</span><b id="jgsp-m-break">0次</b></div>' +
                '</div>' +
            '</div>' +
            '<div class="jgsp-week" id="jgsp-weekbox" hidden>' +
                '<div class="jgsp-week-head">近 7 天专注 <b id="jgsp-week-total">0min</b></div>' +
                '<div class="jgsp-bars" id="jgsp-bars"></div>' +
                '<div class="jgsp-week-foot">数据只保存在这台设备的浏览器里</div>' +
            '</div>' +
            '<div class="jgsp-settings" id="jgsp-settings" hidden>' +
                '<label>专注 <input type="number" id="jgsp-s-focus" min="1" max="180"> 分</label>' +
                '<label>短休 <input type="number" id="jgsp-s-short" min="1" max="60"> 分</label>' +
                '<label>长休 <input type="number" id="jgsp-s-long" min="1" max="120"> 分</label>' +
                '<label>每 <input type="number" id="jgsp-s-cycle" min="2" max="12"> 个番茄长休</label>' +
                '<label class="jgsp-check"><input type="checkbox" id="jgsp-s-sound"> 完成提示音</label>' +
                '<label class="jgsp-check"><input type="checkbox" id="jgsp-s-title"> 标题栏倒计时</label>' +
                '<label class="jgsp-check"><input type="checkbox" id="jgsp-s-autobreak"> 自动开始休息</label>' +
                '<label class="jgsp-check" id="jgsp-notify-row"><input type="checkbox" id="jgsp-s-notify"> 桌面通知</label>' +
                '<button type="button" class="jgsp-notify-btn" id="jgsp-notify-btn" hidden>允许浏览器通知</button>' +
                '<button type="button" class="jgsp-save" id="jgsp-save">保存</button>' +
            '</div>';
        return sec;
    }
    /* ---------- 动效层：向上飘的专注粒子（确定性伪随机，刷新不乱跳） ---------- */
    function buildFx() {
        var fx = q('jgsp-fx');
        if (!fx) return;
        var html = '', i;
        for (i = 0; i < 12; i++) {
            var r1 = (i * 37 % 23) / 23,
                r2 = (i * 53 % 17) / 17,
                r3 = (i * 29 % 13) / 13;
            var left = 8 + Math.round(r1 * 82);
            var size = 3 + Math.round(r2 * 2);
            var dur = (7 + r3 * 6).toFixed(1);
            var delay = (-(r2 * 9)).toFixed(1);
            html += '<i style="left:' + left + '%;width:' + size + 'px;height:' + size + 'px;' +
                '--dur:' + dur + 's;animation-delay:' + delay + 's"></i>';
        }
        fx.innerHTML = html;
    }

    /* ---------- 完成瞬间：一圈粒子向外散开 ---------- */
    function burst() {
        var fx = q('jgsp-fx');
        if (!fx) return;
        for (var i = 0; i < 8; i++) {
            var a = (Math.PI * 2 * i) / 8;
            var d = document.createElement('i');
            d.className = 'jgsp-burst';
            d.style.left = '50%';
            d.style.bottom = '50%';
            d.style.width = '3px';
            d.style.height = '3px';
            d.style.setProperty('--bx', Math.round(Math.cos(a) * 46) + 'px');
            d.style.setProperty('--by', Math.round(Math.sin(a) * 46) + 'px');
            fx.appendChild(d);
            (function (el) { setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1050); })(d);
        }
    }

    function mount() {
        var sb = document.getElementById('sidebar');
        if (!sb || document.getElementById(ID)) return;
        box = build();
        buildFx();
        var weather = document.getElementById('jg-weather');
        // 天气总是插到 #sidebar 最前；番茄钟插它后面，或（天气还没挂载时）插最前
        var ref = weather ? weather.nextSibling : sb.firstChild;
        sb.insertBefore(box, ref);
        bind();
        settle();
        render();
        renderWeek();
        startTimer();
    }
    function q(id) { return box ? box.querySelector('#' + id) : null; }
    function bind() {
        if (!box) return;
        q('jgsp-start').onclick = function () { S.running ? pause() : start(); };
        q('jgsp-reset').onclick = reset;
        q('jgsp-skip').onclick = skip;
        q('jgsp-week').onclick = function () {
            ui.week = !ui.week; ui.settings = false;
            syncPanels(); if (ui.week) renderWeek();
        };
        q('jgsp-cog').onclick = function () {
            ui.settings = !ui.settings; ui.week = false;
            syncPanels();
        };
        q('jgsp-save').onclick = function () {
            S.settings.focus = Core.clamp(q('jgsp-s-focus').value, Core.DEF.focus, 1, 180);
            S.settings.short = Core.clamp(q('jgsp-s-short').value, Core.DEF.short, 1, 60);
            S.settings.long = Core.clamp(q('jgsp-s-long').value, Core.DEF.long, 1, 120);
            S.settings.cycle = Core.clamp(q('jgsp-s-cycle').value, Core.DEF.cycle, 2, 12);
            S.settings.sound = q('jgsp-s-sound').checked;
            S.settings.title = q('jgsp-s-title').checked;
            S.settings.autobreak = q('jgsp-s-autobreak').checked;
            var wantNotify = q('jgsp-s-notify').checked;
            var done = function (ok) {
                S.settings.notify = ok;
                if (!S.running) { S.endAt = null; S.remaining = Core.duration(S); }
                save(); render(); syncNotifyUI();
            };
            if (!wantNotify) done(false);
            else if (notifyPerm() === 'granted') done(true);
            else if (notifyPerm() === 'default') askNotify(function (r) { done(r === 'granted'); });
            else done(false);   // 被拒或浏览器不支持：存 true 只会让人以为通知在响
        };
        q('jgsp-notify-btn').onclick = function () { askNotify(function () { syncNotifyUI(); }); };
        if (!notifySupported()) {
            var row = q('jgsp-notify-row');
            if (row) row.style.display = 'none';
        }
    }
    /** 设置面板里「允许浏览器通知」按钮的显隐 */
    function syncNotifyUI() {
        var btn = q('jgsp-notify-btn');
        if (!btn) return;
        btn.hidden = !(S.settings.notify && notifyPerm() !== 'granted');
    }
    function syncPanels() {
        var w = q('jgsp-weekbox'), p = q('jgsp-settings');
        w.hidden = !ui.week;
        p.hidden = !ui.settings;
        q('jgsp-week').classList.toggle('is-on', ui.week);
        q('jgsp-cog').classList.toggle('is-on', ui.settings);
        if (ui.settings) {
            ['focus', 'short', 'long', 'cycle'].forEach(function (k) { q('jgsp-s-' + k).value = S.settings[k]; });
            q('jgsp-s-sound').checked = !!S.settings.sound;
            q('jgsp-s-title').checked = !!S.settings.title;
            q('jgsp-s-autobreak').checked = !!S.settings.autobreak;
            q('jgsp-s-notify').checked = !!S.settings.notify;
        }
        syncNotifyUI();
    }
    function renderWeek() {
        if (!box || !ui.week) return;
        var keys = Core.weekKeys(), max = 1, total = 0;
        var html = '';
        for (var i = 0; i < keys.length; i++) {
            var r = S.history[keys[i].key] || Core.emptyRec();
            total += r.m;
            if (r.m > max) max = r.m;
        }
        for (var i = 0; i < keys.length; i++) {
            var r = S.history[keys[i].key] || Core.emptyRec();
            var h = Math.round(4 + 46 * (r.m / max));
            var isToday = i === keys.length - 1;
            html += '<div class="jgsp-bar-col' + (isToday ? ' is-today' : '') + '" title="' + keys[i].key.slice(5) + ' 专注 ' + r.m + ' 分钟 · ' + r.p + ' 个">' +
                '<i style="height:' + h + 'px"></i><em>' + keys[i].label + '</em></div>';
        }
        q('jgsp-bars').innerHTML = html;
        q('jgsp-week-total').textContent = total >= 60 ? Math.floor(total / 60) + 'h' + (total % 60 ? (total % 60) + 'm' : '') : total + 'min';
    }
    function render() {
        if (!box) return;
        var left = Core.remaining(S);
        var rec = S.history[Core.dayKey()] || Core.emptyRec();
        var tot = Core.sumHistory(S.history);
        q('jgsp-clock').textContent = Core.clock(left);
        q('jgsp-mode').textContent = Core.MODE[S.mode] + (S.running ? '中' : '');
        q('jgsp-start').textContent = S.running ? '暂停' : (left < Core.duration(S) ? '继续' : '开始');
        q('jgsp-badge').textContent = '今日 ' + rec.p + ' 个';
        q('jgsp-foot').textContent = '今日专注 ' + rec.m + ' 分钟 · 第 ' + (S.done + 1) + ' 轮';
        q('jgsp-m-min').textContent = tot.m >= 60
            ? (Math.floor(tot.m / 60) + 'h' + (tot.m % 60 ? (tot.m % 60) + 'min' : ''))
            : (tot.m + 'min');
        q('jgsp-m-pomo').textContent = tot.p + '个';
        q('jgsp-m-break').textContent = tot.b + '次';
        var total = Core.duration(S);
        var ratio = total ? Math.min(1, Math.max(0, left / total)) : 0;
        var fg = q('jgsp-ring-fg');
        fg.style.strokeDasharray = RING.toFixed(2);
        fg.style.strokeDashoffset = (RING * (1 - ratio)).toFixed(2);
        box.classList.toggle('jgsp-running', S.running);
        box.setAttribute('data-mode', S.mode);
        // 标题栏倒计时（沿用旧版的前缀剥离方式，PJAX 换页也安全）
        try {
            var plain = document.title.replace(/^\[\d{2}:\d{2}\][^·]*·\s*/, '');
            document.title = (S.settings.title && S.running) ? ('[' + Core.clock(left) + '] ' + Core.MODE[S.mode] + ' · ' + plain) : plain;
        } catch (e) {}
    }
    function startTimer() {
        if (timer) return;
        timer = setInterval(function () {
            if (!box || !document.body.contains(box)) return;
            settle();
            render();
            if (ui.week) renderWeek();
        }, 1000);
    }

    /* ---------- PJAX / 主题换页重挂 ---------- */
    function init() {
        mount();
        ['pjax:end', 'pjax:complete'].forEach(function (ev) {
            document.addEventListener(ev, function () { setTimeout(function () { box = document.getElementById(ID); mount(); }, 90); });
        });
        window.addEventListener('load', mount);
        if (window.MutationObserver) {
            var t = null;
            new MutationObserver(function () {
                if (box && document.body.contains(box)) return;
                box = null;
                clearTimeout(t);
                t = setTimeout(mount, 140);
            }).observe(document.body, { childList: true, subtree: true });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.JGSidebarPomodoro = {
        version: VERSION,
        getState: function () { return JSON.parse(JSON.stringify(S)); },
        start: start, pause: pause, reset: reset
    };
})();
