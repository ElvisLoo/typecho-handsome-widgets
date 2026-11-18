/*
 * 极客港 · 侧栏 3D 标签云核心测试（Node 内置 test，无第三方依赖）
 * 运行：node --test tests/
 * 覆盖纯函数核心：clamp / 球面分布 / 互质步长 / 热度分档
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../tagcloud3d.js');

/* ---------- clamp ---------- */
test('clamp：越界收敛，合法值取自身', () => {
    assert.equal(C.clamp(0.5, -1, 1), 0.5);
    assert.equal(C.clamp(-2, -1, 1), -1);
    assert.equal(C.clamp(2, -1, 1), 1);
});

/* ---------- spherePoints ---------- */
test('spherePoints：n=1 退化为赤道上的一点（t=0.5）', () => {
    const p = C.spherePoints(1);
    assert.equal(p.length, 1);
    assert.ok(Math.abs(p[0].y) < 1e-9);
    assert.ok(Math.abs(Math.hypot(p[0].x, p[0].y, p[0].z) - 1) < 1e-9);
});

test('spherePoints：数量正确且全部为单位向量', () => {
    for (const n of [5, 12, 30, 100]) {
        const pts = C.spherePoints(n);
        assert.equal(pts.length, n);
        for (const v of pts) {
            const len = Math.hypot(v.x, v.y, v.z);
            assert.ok(Math.abs(len - 1) < 1e-9, `n=${n} 点不在单位球面上: ${len}`);
        }
    }
});

test('spherePoints：确定性，同输入同输出', () => {
    assert.deepEqual(C.spherePoints(30), C.spherePoints(30));
});

test('spherePoints：y 单调覆盖整个球面（无空洞）', () => {
    const ys = C.spherePoints(30).map(p => p.y);
    assert.equal(Math.max(...ys), 1);          // 首点 y=1
    assert.equal(Math.min(...ys), -1);         // 末点 y=-1
});

/* ---------- gcd / strideOf ---------- */
test('gcd：最大公约数', () => {
    assert.equal(C.gcd(12, 18), 6);
    assert.equal(C.gcd(7, 30), 1);
    assert.equal(C.gcd(0, 5), 5);
});

test('strideOf：步长必与 n 互质（映射是 1..n 的置换）', () => {
    for (const n of [5, 6, 7, 8, 12, 30, 49]) {
        const s = C.strideOf(n);
        assert.equal(C.gcd(s, n), 1, `n=${n} 的步长 ${s} 不互质`);
    }
});

test('strideOf：n 足够大时取到 >1 的错位步长', () => {
    assert.equal(C.strideOf(30), 7);
    assert.equal(C.strideOf(1), 1);
    assert.equal(C.strideOf(4), 1);            // 7 > 4，循环不进入
});

test('strideOf：映射不重复（错位真的错开了）', () => {
    const n = 30, s = C.strideOf(n);
    const seen = new Set();
    for (let i = 0; i < n; i++) seen.add((i * s) % n);
    assert.equal(seen.size, n);
});

/* ---------- tierOf ---------- */
test('tierOf：热度按位次分档', () => {
    assert.equal(C.tierOf(0, 30), 'hot');      // 最热
    assert.equal(C.tierOf(8, 30), 'hot');      // h=0.724
    assert.equal(C.tierOf(9, 30), 'warm');     // h=0.690
    assert.equal(C.tierOf(17, 30), 'warm');    // h=0.414
    assert.equal(C.tierOf(18, 30), 'cool');    // h=0.379
    assert.equal(C.tierOf(29, 30), 'cool');    // 最冷
});

test('tierOf：边界 n=1 归 hot，非法位次不抛错', () => {
    assert.equal(C.tierOf(0, 1), 'hot');
    assert.equal(C.tierOf(0, 0), 'hot');
    assert.equal(C.tierOf(99, 30), 'cool');
});

test('tierOf：三档比例合理（30 个标签时 hot/warm/cool = 9/9/12）', () => {
    const n = 30;
    const count = { hot: 0, warm: 0, cool: 0 };
    for (let i = 0; i < n; i++) count[C.tierOf(i, n)]++;
    assert.equal(count.hot, 9);
    assert.equal(count.warm, 9);
    assert.equal(count.cool, 12);
    assert.equal(count.hot + count.warm + count.cool, n);
});

/* ---------- 常量 ---------- */
test('版本与最小标签数', () => {
    assert.equal(C.VERSION, '2.2.1');
    assert.equal(C.MIN, 5);
});
