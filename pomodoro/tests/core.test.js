/*
 * 极客港 · 侧栏番茄钟核心测试（Node 内置 test，无第三方依赖）
 * 运行：node --test tests/
 * 覆盖纯函数核心：日期/时长/设置/迁移/状态机完成一轮
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../sidebar-pomodoro.js');

/* ---------- clamp ---------- */
test('clamp：合法值取自身，越界收敛，非法值回落默认', () => {
    assert.equal(C.clamp(25, 10, 1, 180), 25);
    assert.equal(C.clamp('25', 10, 1, 180), 25);      // 字符串数字
    assert.equal(C.clamp(0, 10, 1, 180), 1);          // 下界
    assert.equal(C.clamp(999, 10, 1, 180), 180);      // 上界
    assert.equal(C.clamp('abc', 10, 1, 180), 10);     // 非数字回落
    assert.equal(C.clamp(NaN, 10, 1, 180), 10);
    assert.equal(C.clamp(null, 10, 1, 180), 10);
});

/* ---------- dayKey / weekKeys ---------- */
test('dayKey：返回 YYYY-MM-DD，补零', () => {
    assert.equal(C.dayKey(new Date(2026, 0, 5, 8, 30)), '2026-01-05');
    assert.equal(C.dayKey(new Date(2026, 10, 18, 23, 59)), '2026-11-18');
});

test('weekKeys：恰好 7 天，日期连续、label 与真实星期一致', () => {
    const now = new Date(2026, 2, 8, 12, 0, 0);   // 3 月 8 日（部分时区是 DST 切换日）
    const keys = C.weekKeys(now);
    assert.equal(keys.length, 7);
    for (let i = 0; i < 7; i++) {
        const d = new Date(keys[i].t);
        assert.equal(C.dayKey(d), keys[i].key, 'key 与时间戳必须同源');
        assert.equal(d.getDate(), keys[i].day);
        assert.equal(keys[i].label, C.WEEK_LABELS[d.getDay()], 'label 必须与星期一致');
    }
    // 相邻两天差 1
    for (let i = 1; i < 7; i++) {
        assert.equal(keys[i].day, keys[i - 1].day + 1, '日期必须逐日递增');
    }
});

test('weekKeys：跨月时日期依然连续递增', () => {
    const now = new Date(2026, 0, 31, 10, 0, 0);   // 1 月 31 日
    const keys = C.weekKeys(now);
    const days = keys.map(k => k.day);
    assert.deepEqual(days, [25, 26, 27, 28, 29, 30, 31]);
});

test('weekKeys：同一天多次调用结果稳定（确定性）', () => {
    const now = new Date(2026, 5, 15, 7, 0, 0).getTime();
    const a = JSON.stringify(C.weekKeys(now));
    const b = JSON.stringify(C.weekKeys(now));
    assert.equal(a, b);
});

/* ---------- clock ---------- */
test('clock：秒→mm:ss，负数与非法值归零', () => {
    assert.equal(C.clock(0), '00:00');
    assert.equal(C.clock(65), '01:05');
    assert.equal(C.clock(1500), '25:00');
    assert.equal(C.clock(-5), '00:00');
    assert.equal(C.clock('x'), '00:00');
    assert.equal(C.clock(59.9), '00:59');
});

/* ---------- sumHistory / emptyRec ---------- */
test('sumHistory：只累加存在的记录，缺失字段按 0', () => {
    const h = {
        '2026-11-17': { m: 50, p: 2, b: 1 },
        '2026-11-18': { m: 25, p: 1, b: 0 }
    };
    assert.deepEqual(C.sumHistory(h), { m: 75, p: 3, b: 1 });
    assert.deepEqual(C.sumHistory({}), { m: 0, p: 0, b: 0 });
    assert.deepEqual(C.sumHistory({ '2026-11-18': {} }), { m: 0, p: 0, b: 0 });
});

/* ---------- normalizeSettings ---------- */
test('normalizeSettings：默认值与边界', () => {
    assert.deepEqual(C.normalizeSettings({}), {
        focus: 25, short: 5, long: 15, cycle: 4, sound: true, title: false, autobreak: false, notify: true
    });
    const s = C.normalizeSettings({ focus: '999', cycle: '1', sound: false, title: 1 });
    assert.equal(s.focus, 180);
    assert.equal(s.cycle, 2);
    assert.equal(s.sound, false);
    assert.equal(s.title, true);
    assert.equal(s.autobreak, false);
    assert.equal(s.notify, true);
    assert.equal(C.normalizeSettings({ notify: false }).notify, false);
    assert.equal(C.normalizeSettings({ notify: 0 }).notify, true);   // 与 sound 同款语义：只有显式 false 才关
    assert.equal(C.normalizeSettings({ notify: 'yes' }).notify, true);
});

/* ---------- migrateOld ---------- */
test('migrateOld：旧 v1 字段映射，缺失时返回空', () => {
    const mg = C.migrateOld({
        settings: { focus: 30, short: 10, sound: false },
        history: { '2026-11-18': { minutes: 60, pomodoros: 3, breaks: 1 } }
    });
    assert.deepEqual(mg.history, { '2026-11-18': { m: 60, p: 3, b: 1 } });
    assert.equal(mg.settings.focus, 30);
    assert.equal(mg.settings.sound, false);
    assert.deepEqual(C.migrateOld(null), {});
    assert.deepEqual(C.migrateOld({}), {});
});

/* ---------- normalize ---------- */
test('normalize：空数据回落默认，remaining 为整轮时长', () => {
    const s = C.normalize(null, null, new Date(2026, 10, 18, 9, 0, 0).getTime());
    assert.equal(s.mode, 'focus');
    assert.equal(s.remaining, 1500);
    assert.equal(s.running, false);
    assert.equal(s.done, 0);
    assert.deepEqual(s.history, {});
});

test('normalize：旧 v1 数据迁移保留时长设置（修复项）', () => {
    const old = {
        settings: { focus: 45, short: 8, long: 20, cycle: 6, sound: false, title: true, autobreak: true, notify: false },
        history: { '2026-11-18': { minutes: 45, pomodoros: 1, breaks: 0 } }
    };
    const s = C.normalize(null, old, new Date(2026, 10, 18, 9, 0, 0).getTime());
    assert.equal(s.settings.focus, 45);
    assert.equal(s.settings.short, 8);
    assert.equal(s.settings.long, 20);
    assert.equal(s.settings.cycle, 6);
    assert.equal(s.settings.sound, false);
    assert.equal(s.settings.title, true);
    assert.equal(s.settings.autobreak, true);
    assert.equal(s.settings.notify, false);
    // 旧数据不含剩余秒数，迁移后直接给一整轮新时长
    assert.equal(s.remaining, 45 * 60);
    assert.deepEqual(s.history, { '2026-11-18': { m: 45, p: 1, b: 0 } });
});

test('normalize：裁剪 30 天以前的历史', () => {
    const now = new Date(2026, 10, 18, 9, 0, 0).getTime();
    const raw = {
        history: {
            '2026-11-18': { m: 25, p: 1, b: 0 },
            '2026-10-20': { m: 25, p: 1, b: 0 },   // 29 天前，保留
            '2026-10-19': { m: 25, p: 1, b: 0 }    // 30 天前（早于切割点），剔除
        }
    };
    const s = C.normalize(raw, null, now);
    assert.ok(s.history['2026-11-18']);
    assert.ok(s.history['2026-10-20']);
    assert.equal(s.history['2026-10-19'], undefined);
});

test('normalize：暂停时 remaining 超过新时长会被夹回（修复项）', () => {
    const now = new Date(2026, 10, 18, 9, 0, 0).getTime();
    const raw = { settings: { focus: 10 }, remaining: 1500, running: false };
    const s = C.normalize(raw, null, now);
    assert.equal(s.remaining, 600);
});

test('normalize：非法 mode / 非法 remaining 归一', () => {
    const now = new Date(2026, 10, 18, 9, 0, 0).getTime();
    const s = C.normalize({ mode: 'bogus', remaining: 'abc' }, null, now);
    assert.equal(s.mode, 'focus');
    assert.equal(s.remaining, 1500);
});

test('normalize：运行中状态保留 endAt', () => {
    const now = new Date(2026, 10, 18, 9, 0, 0).getTime();
    const s = C.normalize({ running: true, endAt: now + 60000, remaining: 1 }, null, now);
    assert.equal(s.running, true);
    assert.equal(s.endAt, now + 60000);
    assert.equal(C.remaining(s, now), 60);
});

/* ---------- remaining / progress ---------- */
test('remaining/progress：运行中按绝对时间戳，暂停用 remaining', () => {
    const now = 1_000_000_000_000;
    const run = { mode: 'focus', remaining: 1500, running: true, endAt: now + 900000, settings: { focus: 25 } };
    assert.equal(C.remaining(run, now), 900);
    assert.ok(Math.abs(C.progress(run, now) - 0.4) < 1e-9);

    const idle = { mode: 'focus', remaining: 600, running: false, endAt: null, settings: { focus: 25 } };
    assert.equal(C.remaining(idle, now), 600);
    assert.ok(Math.abs(C.progress(idle, now) - 0.6) < 1e-9);

    const over = { mode: 'focus', remaining: 1500, running: true, endAt: now - 5000, settings: { focus: 25 } };
    assert.equal(C.remaining(over, now), 0);
    assert.equal(C.progress(over, now), 1);
});

/* ---------- nextMode ---------- */
test('nextMode：每 cycle 个番茄进长休（done 为已完成数）', () => {
    assert.equal(C.nextMode(1, 4), 'short');
    assert.equal(C.nextMode(2, 4), 'short');
    assert.equal(C.nextMode(4, 4), 'long');
    assert.equal(C.nextMode(7, 4), 'short');
    assert.equal(C.nextMode(8, 4), 'long');
    assert.equal(C.nextMode(8, 2), 'long');
});

/* ---------- applyComplete ---------- */
test('applyComplete：专注完成→短休，累计当日与总计', () => {
    const s = C.fresh();
    s.history = { '2026-11-18': { m: 25, p: 1, b: 0 } };
    const now = new Date(2026, 10, 18, 10, 0, 0).getTime();
    const r = C.applyComplete(s, now);
    assert.equal(r.state.mode, 'short');
    assert.equal(r.state.done, 1);
    assert.equal(r.state.remaining, 5 * 60);
    assert.equal(r.state.running, false);
    assert.equal(r.state.endAt, null);
    assert.deepEqual(r.state.history['2026-11-18'], { m: 50, p: 2, b: 0 });
    assert.deepEqual(r.record, { day: '2026-11-18', mode: 'focus', minutes: 25 });
});

test('applyComplete：第 cycle 个番茄→长休', () => {
    const s = C.fresh();
    s.done = 3;
    const now = new Date(2026, 10, 18, 10, 0, 0).getTime();
    const r = C.applyComplete(s, now);
    assert.equal(r.state.done, 4);
    assert.equal(r.state.mode, 'long');
    assert.equal(r.state.remaining, 15 * 60);
});

test('applyComplete：休息完成→专注，done 不变，记一次休息', () => {
    const s = C.fresh();
    s.mode = 'short';
    s.done = 2;
    const now = new Date(2026, 10, 18, 10, 0, 0).getTime();
    const r = C.applyComplete(s, now);
    assert.equal(r.state.mode, 'focus');
    assert.equal(r.state.done, 2);
    assert.equal(r.state.remaining, 25 * 60);
    assert.deepEqual(r.state.history['2026-11-18'], { m: 0, p: 0, b: 1 });
});

test('applyComplete：不改写入参 state', () => {
    const s = C.fresh();
    const snapshot = JSON.stringify(s);
    C.applyComplete(s, new Date(2026, 10, 18, 10, 0, 0).getTime());
    assert.equal(JSON.stringify(s), snapshot);
});

test('applyComplete：跨天写入新日期键', () => {
    const s = C.fresh();
    s.history = { '2026-11-17': { m: 25, p: 1, b: 0 } };
    const r = C.applyComplete(s, new Date(2026, 10, 18, 10, 0, 0).getTime());
    assert.ok(r.state.history['2026-11-17'], '旧记录应保留');
    assert.deepEqual(r.state.history['2026-11-18'], { m: 25, p: 1, b: 0 });
});

test('applyComplete：尊重自定义时长与 cycle', () => {
    const s = C.fresh();
    s.settings.focus = 50;
    s.settings.cycle = 2;
    const r = C.applyComplete(s, new Date(2026, 10, 18, 10, 0, 0).getTime());
    assert.equal(r.state.history['2026-11-18'].m, 50);
    assert.equal(r.state.done, 1);
    assert.equal(r.state.mode, 'short');          // 第 1 个后短休
    const r2 = C.applyComplete(r.state, new Date(2026, 10, 18, 11, 0, 0).getTime());
    assert.equal(r2.state.mode, 'focus');         // 休息结束回专注
    assert.equal(r2.state.remaining, 50 * 60);
    const r3 = C.applyComplete(r2.state, new Date(2026, 10, 18, 12, 0, 0).getTime());
    assert.equal(r3.state.done, 2);
    assert.equal(r3.state.mode, 'long');          // 第 2 个后长休
    assert.equal(r3.state.remaining, 15 * 60);
});
