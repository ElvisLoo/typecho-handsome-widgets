/*
 * 极客港 · 悬浮番茄钟（v1）核心测试
 * 运行：node --test tests/
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../pomodoro.js');

/* ---------- 设置 ---------- */
test('normalizeSettings：默认值与边界', () => {
    assert.deepEqual(C.normalizeSettings({}), {
        focus: 25, short: 5, long: 15, cycle: 4,
        sound: true, autoBreak: false, autoFocus: false, title: true, notify: true
    });
    const s = C.normalizeSettings({ focus: '999', cycle: '1', sound: false, autoBreak: true, title: false });
    assert.equal(s.focus, 180);
    assert.equal(s.cycle, 2);
    assert.equal(s.sound, false);
    assert.equal(s.autoBreak, true);
    assert.equal(s.title, false);
    assert.equal(s.notify, true);
    assert.equal(C.normalizeSettings({ notify: false }).notify, false);
});

/* ---------- 状态归一 ---------- */
test('normalizeState：非法输入回落整轮', () => {
    const s = C.normalizeState(null, { focus: 25 });
    assert.equal(s.mode, 'focus');
    assert.equal(s.remaining, 1500);
    assert.equal(s.running, false);
    assert.equal(s.completed, 0);
});

test('normalizeState：remaining 被夹到当前模式时长内', () => {
    const s = C.normalizeState({ mode: 'short', remaining: 9999, running: false }, { short: 5 });
    assert.equal(s.remaining, 300);
    const s2 = C.normalizeState({ mode: 'short', remaining: '120', running: false }, { short: 5 });
    assert.equal(s2.remaining, 120);
});

test('normalizeState：running 必须带合法 endAt 才成立', () => {
    assert.equal(C.normalizeState({ running: true, endAt: 0 }, {}).running, false);
    assert.equal(C.normalizeState({ running: true, endAt: 12345 }, {}).running, true);
});

/* ---------- 日期 ---------- */
test('dayKey / weekKeys：格式与近 7 天连续', () => {
    assert.equal(C.dayKey(new Date(2026, 0, 5, 8)), '2026-01-05');
    const keys = C.weekKeys(new Date(2026, 2, 8, 12));
    assert.equal(keys.length, 7);
    for (let i = 1; i < 7; i++) assert.equal(keys[i].day, keys[i - 1].day + 1);
    const labels = ['日', '一', '二', '三', '四', '五', '六'];
    assert.equal(keys[6].label, labels[new Date(2026, 2, 8).getDay()]);
});

/* ---------- 时钟与时长 ---------- */
test('formatClock / totalForMode', () => {
    assert.equal(C.formatClock(0), '00:00');
    assert.equal(C.formatClock(65), '01:05');
    assert.equal(C.formatClock(-1), '00:00');
    assert.equal(C.totalForMode('focus', { focus: 25 }), 1500);
    assert.equal(C.totalForMode('short', { short: 5 }), 300);
    assert.equal(C.totalForMode('long', { long: 15 }), 900);
    assert.equal(C.totalForMode('bogus', { focus: 25 }), 1500);
});

/* ---------- remaining / progress ---------- */
test('remaining / progress：运行中按时间戳，否则用 remaining', () => {
    const now = 1_000_000_000_000;
    const run = { mode: 'focus', running: true, endAt: now + 600000, remaining: 1500 };
    assert.equal(C.remaining(run, now), 600);
    assert.ok(Math.abs(C.progress(run, { focus: 25 }, now) - 0.6) < 1e-9);

    const idle = { mode: 'focus', running: false, endAt: 0, remaining: 600 };
    assert.equal(C.remaining(idle, now), 600);
    assert.ok(Math.abs(C.progress(idle, { focus: 25 }, now) - 0.6) < 1e-9);
});

/* ---------- nextMode ---------- */
test('nextMode：每 cycle 个番茄进长休，休息后回专注', () => {
    assert.equal(C.nextMode({ mode: 'focus', completed: 0 }, { cycle: 4 }), 'short');
    assert.equal(C.nextMode({ mode: 'focus', completed: 3 }, { cycle: 4 }), 'long');
    assert.equal(C.nextMode({ mode: 'focus', completed: 4 }, { cycle: 4 }), 'short');
    assert.equal(C.nextMode({ mode: 'short', completed: 2 }, {}), 'focus');
    assert.equal(C.nextMode({ mode: 'long', completed: 2 }, {}), 'focus');
});

/* ---------- complete ---------- */
test('complete：专注完成→短休，记录分钟与番茄', () => {
    const r = C.complete(
        { mode: 'focus', completed: 0, running: true, endAt: 1, remaining: 1, startedAt: 1 },
        { focus: 25, short: 5, long: 15, cycle: 4, autoBreak: false, autoFocus: false },
        { '2026-11-18': { minutes: 25, pomodoros: 1, breaks: 0 } },
        new Date(2026, 10, 18, 10, 0, 0).getTime()
    );
    assert.equal(r.state.mode, 'short');
    assert.equal(r.state.completed, 1);
    assert.equal(r.state.running, false);
    assert.equal(r.state.endAt, 0);
    assert.deepEqual(r.history['2026-11-18'], { minutes: 50, pomodoros: 2, breaks: 0 });
    assert.deepEqual(r.record, { day: '2026-11-18', mode: 'focus', minutes: 25 });
});

test('complete：第 cycle 个番茄→长休', () => {
    const r = C.complete(
        { mode: 'focus', completed: 3, running: true, endAt: 1, remaining: 1, startedAt: 1 },
        { cycle: 4, long: 15, autoBreak: false },
        {},
        new Date(2026, 10, 18, 10, 0, 0).getTime()
    );
    assert.equal(r.state.mode, 'long');
    assert.equal(r.state.remaining, 900);
});

test('complete：休息完成→专注，done 不变，记一次休息', () => {
    const r = C.complete(
        { mode: 'short', completed: 2, running: true, endAt: 1, remaining: 1, startedAt: 1 },
        { focus: 25, short: 5, autoFocus: false },
        {},
        new Date(2026, 10, 18, 10, 0, 0).getTime()
    );
    assert.equal(r.state.mode, 'focus');
    assert.equal(r.state.completed, 2);
    assert.deepEqual(r.history['2026-11-18'], { minutes: 0, pomodoros: 0, breaks: 1 });
});

test('complete：autoBreak / autoFocus 会直接起下一轮', () => {
    const now = new Date(2026, 10, 18, 10, 0, 0).getTime();
    const r1 = C.complete(
        { mode: 'focus', completed: 0, running: true, endAt: 1, remaining: 1, startedAt: 1 },
        { focus: 25, short: 5, cycle: 4, autoBreak: true },
        {}, now
    );
    assert.equal(r1.state.mode, 'short');
    assert.equal(r1.state.running, true);
    assert.equal(r1.state.endAt, now + 300000);

    const r2 = C.complete(
        { mode: 'short', completed: 1, running: true, endAt: 1, remaining: 1, startedAt: 1 },
        { focus: 25, short: 5, cycle: 4, autoFocus: true },
        {}, now
    );
    assert.equal(r2.state.mode, 'focus');
    assert.equal(r2.state.running, true);
    assert.equal(r2.state.endAt, now + 1500000);
});

test('complete：不改写入参', () => {
    const state = { mode: 'focus', completed: 0, running: true, endAt: 1, remaining: 1, startedAt: 1 };
    const history = {};
    const snap = JSON.stringify([state, history]);
    C.complete(state, {}, history, new Date(2026, 10, 18, 10, 0, 0).getTime());
    assert.equal(JSON.stringify([state, history]), snap);
});

/* ---------- normalizeStore ---------- */
test('normalizeStore：透传历史与 ui，空值回落', () => {
    const s = C.normalizeStore({
        settings: { focus: 30 },
        state: { mode: 'short', remaining: 100, completed: 2 },
        history: { '2026-11-18': { minutes: 30, pomodoros: 1, breaks: 0 } },
        ui: { dark: true, open: true, view: 'week' }
    });
    assert.equal(s.settings.focus, 30);
    assert.equal(s.state.mode, 'short');
    assert.equal(s.state.remaining, 100);
    assert.equal(s.state.completed, 2);
    assert.deepEqual(s.history['2026-11-18'], { minutes: 30, pomodoros: 1, breaks: 0 });
    assert.deepEqual(s.ui, { dark: true, open: true, view: 'week' });
    assert.equal(C.normalizeStore(null).v, 1);
});
