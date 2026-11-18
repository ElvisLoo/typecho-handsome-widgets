/**
 * 极客港 · 侧栏「标签」3D 球挂件 v2.2.1
 *
 * 位置：#sidebar 内、番茄钟 #jg-sidebar-pomo 的正下方
 * 数据：就地读取主题输出的 #tag_cloud / #tag_cloud-post 里的 a.label（不动数据库、不碰主题模板）
 *
 * v2.1.0 相对 v2.0.1：
 *   1. CSS 由 GBK 字节 + UTF-8 BOM 改为 UTF-8（原先注释在浏览器里是乱码）
 *   2. 拖拽松手带惯性滑行（速度指数衰减），暂停自转后仍可滑行
 *   3. 补间加令牌：连续点两个标签不会叠两个动画
 *   4. 换页重建时移除 window 上的 pointermove / pointerup，不再泄漏监听
 *   5. 抽出纯函数核心（球面分布 / 热度分档 / 步长）挂 window.JGTagCloudCore，Node 下可测
 *
 * v2.2.0 相对 v2.1.0：
 *   1. 挂载入场：舞台容器淡入 + 轻微放大（标签自身 transform/opacity 由 JS 逐帧写，不能加动画）
 *   2. 减少动态效果下关掉入场动画（原来只关了顶部色条与标签变色）
 *
 * v2.2.1：
 *   1. 修入场动画声明缺右括号（cubic-bezier(... both）导致整条 animation 被丢弃、动画不生效
 *
 * v2 相对 v1：
 *   1. 标签溢出被硬裁 → 半径按「实测最宽标签」收缩，球心居中，宽标签 max-width + 省略号兜底
 *   2. 球体下方大片留白 → 舞台高度 = 2×半径 + 固定余量
 *   3. 控制条收进标题栏一个自转开关，双击舞台也能暂停
 *   4. 标题栏「标签」+ 标签总数徽标
 *   5. 按热度深浅三级（主题标签云按 count 降序输出，取位次作为热度）
 *   6. 暗色模式（跟随 Handsome 的 html.theme-dark）
 *
 * 零依赖 / 拖拽旋转 / 点击标签平滑转到正面再跳转 / pjax 自愈 / 尊重 prefers-reduced-motion
 */
(function () {
    'use strict';

    var VERSION = '2.2.1';
    var ROOT = 'jgtagcloud-3d';      // v1 遗留容器前缀（用于清理）
    var CLS = 'jg-tagcloud';
    var MIN = 5;                     // 标签太少就不做球（如文章页没有标签）

    var CFG = {
        speed: 0.0032,               // 每帧自转角（≈ 每 5.2s 转一圈）
        radiusFactor: 0.40,          // 球半径 ≈ 舞台宽 × 系数
        minRadius: 58,
        maxRadius: 104,
        frontScale: 1.06,
        backScale: 0.48,
        backAlpha: 0.10,
        inertia: 0.94,               // 松手后的角速度衰减（每 16.7ms）
        inertiaMin: 0.00004          // 低于该角速度视为停止
    };
    var HOT = 0.72, WARM = 0.38;     // 热度分档阈值（0 冷 … 1 热）

    /* ================= 纯函数核心（不碰 DOM，可独立测试） ================= */

    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

    /** 斐波那契球面均匀分布：n 个点 → 单位向量 {x,y,z} */
    function spherePoints(n) {
        var out = [], i, golden = Math.PI * (3 - Math.sqrt(5));
        for (i = 0; i < n; i++) {
            var t = n === 1 ? 0.5 : i / (n - 1);
            var y = 1 - t * 2;
            var r = Math.sqrt(Math.max(0, 1 - y * y));
            var th = golden * i;
            out.push({ x: Math.cos(th) * r, y: y, z: Math.sin(th) * r });
        }
        return out;
    }

    function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }

    /**
     * 错位步长：把「标签次序」打散到整个球面。
     * 主题按 count 降序输出，热度最高的标签本会落在球面极点附近而挤成一团，
     * 用与 n 互质的步长做映射即可错开。
     */
    function strideOf(n) {
        var s;
        for (s = 7; s < n; s += 2) { if (n % s && gcd(s, n) === 1) return s; }
        return 1;
    }

    /** 位次 → 热度档（0 冷 … 1 热） */
    function tierOf(i, n) {
        var h = n <= 1 ? 1 : 1 - i / (n - 1);
        return h >= HOT ? 'hot' : (h >= WARM ? 'warm' : 'cool');
    }

    var Core = {
        VERSION: VERSION, MIN: MIN, CFG: CFG, HOT: HOT, WARM: WARM,
        clamp: clamp, spherePoints: spherePoints, gcd: gcd,
        strideOf: strideOf, tierOf: tierOf
    };

    if (typeof module === 'object' && module.exports) { module.exports = Core; return; }
    if (typeof document === 'undefined') return;
    window.JGTagCloudCore = Core;

    /* ================= DOM 层 ================= */

    /* 从主题输出的标签段里读标签 */
    function collect(sec) {
        var as = sec.querySelectorAll('.tags a, a.label, a.badge'), out = [], i;
        for (i = 0; i < as.length; i++) {
            var a = as[i];
            var t = (a.textContent || '').trim();
            if (!t) continue;
            out.push({ text: t, href: a.href || a.getAttribute('href') });
        }
        return out;
    }

    /* ---------- 每个挂件实例的状态 ---------- */
    function Ctx(section, labels) {
        this.sec = section;
        this.labels = labels;
        this.stage = null;
        this.ball = null;
        this.r = 60; this.cx = 100; this.cy = 90;
        this.rx = -0.22; this.ry = 0.62;
        this.vx = 0;                  // 惯性角速度
        this.running = true;
        this.dragging = false;
        this.tweening = false;
        this.tween = 0;               // 补间令牌
        this.raf = 0; this.last = 0;
        this.ro = null;
        this._winMove = null; this._winUp = null;
    }

    Ctx.prototype.apply = function () {
        var labels = this.labels, r = this.r;
        var cY = Math.cos(this.ry), sY = Math.sin(this.ry);
        var cX = Math.cos(this.rx), sX = Math.sin(this.rx);
        for (var i = 0; i < labels.length; i++) {
            var l = labels[i], v = l.p;
            var x1 = v.x * cY - v.z * sY;
            var z1 = v.x * sY + v.z * cY;
            var y1 = v.y * cX - z1 * sX;
            var z2 = v.y * sX + z1 * cX;
            var t = (z2 + 1) / 2;                       // 0 背面 … 1 正面
            var sc = CFG.backScale + (CFG.frontScale - CFG.backScale) * t;
            var op = CFG.backAlpha + (1 - CFG.backAlpha) * t;
            var sx = x1 * r, sy = -y1 * r, sz = z2 * r;
            var el = l.el;
            el.style.transform = 'translate(-50%,-50%) translate3d(' +
                sx.toFixed(2) + 'px,' + sy.toFixed(2) + 'px,' + sz.toFixed(2) + 'px) scale(' + sc.toFixed(3) + ')';
            el.style.zIndex = String(Math.round((z2 + 1) * 1000));
            el.style.opacity = op.toFixed(3);
            el.style.pointerEvents = t > 0.55 ? 'auto' : 'none';
            l.z = z2;
        }
    };

    /* 依据舞台宽度算出半径并定位（纯文字球：靠边缘柔化，不裁切） */
    Ctx.prototype.fit = function () {
        var stage = this.stage;
        if (!stage) return;
        var W = stage.clientWidth || stage.offsetWidth || 0;
        if (W < 120) return;
        var r = clamp(W * CFG.radiusFactor, CFG.minRadius, CFG.maxRadius);
        this.r = r;
        this.cx = W / 2;
        var H = Math.round(2 * r + 30);
        this.cy = H / 2;
        stage.style.height = H + 'px';
        this.apply();
    };

    Ctx.prototype.focus = function (i) {
        var self = this, l = this.labels[i];
        if (!l || !l.href) return;
        var v = l.p;
        var trx = Math.asin(clamp(v.y, -1, 1));
        var tryy = Math.atan2(v.x, v.z);
        var fromRx = this.rx, fromRy = this.ry;
        var d = tryy - fromRy;
        d = Math.atan2(Math.sin(d), Math.cos(d));      // 取最短转向
        var t0 = performance.now(), dur = 340;
        var id = ++this.tween;                          // 令牌：后一次点击作废旧补间
        this.tweening = true;
        (function tw() {
            if (!self.sec || id !== self.tween) return;
            var k = Math.min(1, (performance.now() - t0) / dur);
            var e = 1 - Math.pow(1 - k, 3);
            self.rx = fromRx + (trx - fromRx) * e;
            self.ry = fromRy + d * e;
            self.apply();
            if (k < 1) requestAnimationFrame(tw);
            else { self.tweening = false; location.href = l.href; }
        })();
    };

    function reduced() {
        try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
        catch (e) { return false; }
    }

    Ctx.prototype.start = function () {
        if (this.raf) return;
        var self = this;
        this.last = performance.now();
        (function loop(now) {
            var dt = now - self.last; self.last = now;
            if (dt > 120) dt = 120;
            if (self.running && !self.dragging && !self.tweening && !document.hidden) {
                self.ry += CFG.speed * (dt / 16.7);
            }
            // 惯性：松手后按最后的角速度滑行，指数衰减到停止
            if (!self.dragging && !self.tweening && Math.abs(self.vx) > CFG.inertiaMin) {
                self.ry += self.vx * (dt / 16.7);
                self.vx *= Math.pow(CFG.inertia, dt / 16.7);
                if (Math.abs(self.vx) <= CFG.inertiaMin) self.vx = 0;
            }
            self.apply();
            self.raf = requestAnimationFrame(loop);
        })(this.last);
    };

    Ctx.prototype.bind = function () {
        var self = this;
        var wrap = this.stage;
        var px = 0, py = 0, moved = false;

        function down(e) {
            if (e.target.closest && e.target.closest('.jgtc-rot')) return;
            self.dragging = true; moved = false; self.vx = 0;
            var t = e.touches ? e.touches[0] : e;
            px = t.clientX; py = t.clientY;
            wrap.classList.add('is-grabbing');
        }
        function move(e) {
            if (!self.dragging) return;
            var t = e.touches ? e.touches[0] : e;
            var dx = t.clientX - px, dy = t.clientY - py;
            if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
            self.ry += dx * 0.008;
            self.rx = clamp(self.rx + dy * 0.008, -1.2, 1.2);
            self.vx = dx * 0.008;                       // 记录最近角速度，供松手滑行
            px = t.clientX; py = t.clientY;
            self.apply();
        }
        function up() { self.dragging = false; wrap.classList.remove('is-grabbing'); }

        if (window.PointerEvent) {
            wrap.addEventListener('pointerdown', down);
            window.addEventListener('pointermove', move, { passive: true });
            window.addEventListener('pointerup', up);
            this._winMove = move; this._winUp = up;
        } else {
            wrap.addEventListener('touchstart', down, { passive: true });
            wrap.addEventListener('touchmove', move, { passive: true });
            wrap.addEventListener('touchend', up);
        }

        // 双击空白处：暂停 / 继续
        wrap.addEventListener('dblclick', function () {
            if (moved) return;
            self.setRunning(!self.running);
        });

        // 点击标签：先转到正面再跳转
        for (var i = 0; i < this.labels.length; i++) {
            (function (idx) {
                var el = self.labels[idx].el;
                el.addEventListener('click', function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (ev.detail === 0) return;           // 键盘激活直接跳
                    if (self.labels[idx].z > 0.86) { location.href = self.labels[idx].href; return; }
                    self.focus(idx);
                });
            })(i);
        }

        // 容器宽度变化时重算半径
        if (typeof ResizeObserver === 'function') {
            var t = null;
            this.ro = new ResizeObserver(function () {
                if (t) clearTimeout(t);
                t = setTimeout(function () { self.fit(); }, 150);
            });
            this.ro.observe(this.stage);
        }
    };

    Ctx.prototype.setRunning = function (on) {
        this.running = !!on;
        var btn = this.sec && this.sec.querySelector('.jgtc-rot');
        if (btn) {
            btn.classList.toggle('is-paused', !this.running);
            btn.setAttribute('title', this.running ? '暂停自转' : '开始自转');
            btn.setAttribute('aria-label', btn.getAttribute('title'));
        }
    };

    /* 卸载：停 rAF、断观察者、摘掉 window 上的监听，避免换页后泄漏 */
    Ctx.prototype.destroy = function () {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
        if (this.ro) { try { this.ro.disconnect(); } catch (e) {} this.ro = null; }
        if (this._winMove) window.removeEventListener('pointermove', this._winMove);
        if (this._winUp) window.removeEventListener('pointerup', this._winUp);
        this._winMove = this._winUp = null;
        this.sec = null;
    };

    /* ---------- 构建挂件 DOM ---------- */
    function build(section, labels) {
        var n = labels.length;
        section.classList.add(CLS);
        section.classList.add('box-shadow-wrap-normal');
        section.innerHTML =
            '<h5 class="widget-title m-t-none">标签云' +
                '<span class="jgtc-count" title="标签总数">' + n + '</span>' +
                '<button type="button" class="jgtc-rot" title="暂停自转" aria-label="暂停自转">' +
                    '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
                        '<path class="jgtc-ic-pause" d="M8 6h3v12H8zM13 6h3v12h-3z"/>' +
                        '<path class="jgtc-ic-play" d="M9 6l10 6-10 6z"/>' +
                    '</svg>' +
                '</button>' +
            '</h5>' +
            '<div class="jgtc-stage"><div class="jgtc-ball"></div></div>';

        var ball = section.querySelector('.jgtc-ball');
        var stage = section.querySelector('.jgtc-stage');
        var pts = spherePoints(n);
        var stride = strideOf(n);
        for (var i = 0; i < n; i++) {
            var a = document.createElement('a');
            a.className = 'jgtc-label jgtc-' + tierOf(i, n);
            a.href = labels[i].href || '';
            a.textContent = labels[i].text;
            a.title = labels[i].text;
            a.setAttribute('data-i', i);
            ball.appendChild(a);
            labels[i].el = a;
            labels[i].p = pts[(i * stride) % n];
        }
        return { stage: stage, ball: ball };
    }

    /* ---------- 挂载 / 定位 ---------- */
    var ctx = null;

    function ensurePosition(sec) {
        var pomo = document.getElementById('jg-sidebar-pomo');
        if (!pomo || !pomo.parentNode) return;
        if (pomo.nextSibling === sec) return;              // 已在番茄钟正下方
        pomo.parentNode.insertBefore(sec, pomo.nextSibling);
    }

    function boot() {
        var sb = document.getElementById('sidebar');
        if (!sb) return;

        // 清理 v1 遗留容器
        var old = document.querySelectorAll('[id^="' + ROOT + '"]');
        for (var o = 0; o < old.length; o++) if (old[o].parentNode) old[o].parentNode.removeChild(old[o]);

        var sec = document.getElementById('tag_cloud') || document.getElementById('tag_cloud-post');
        if (!sec) return;

        if (sec.classList.contains(CLS)) {                 // 已构建：只校正位置
            ensurePosition(sec);
            return;
        }

        if (ctx) {                                          // 上一轮实例（pjax 换页）先停掉
            ctx.destroy();
            ctx = null;
        }

        var labels = collect(sec);
        if (labels.length < MIN) { sec.style.display = 'none'; return; }

        var dom = build(sec, labels);
        ctx = new Ctx(sec, labels);
        ctx.stage = dom.stage;
        ctx.ball = dom.ball;

        ensurePosition(sec);

        // 挂载入场：只给舞台加淡入，标签本身的 transform/opacity 归 JS 逐帧管
        sec.classList.add('jgtc-enter');
        setTimeout(function () { sec.classList.remove('jgtc-enter'); }, 900);

        // 等一帧拿到真实宽度再定位
        requestAnimationFrame(function () {
            if (!ctx) return;
            ctx.fit();
            ctx.apply();
            if (!reduced()) ctx.start(); else ctx.setRunning(false);
            var btn = sec.querySelector('.jgtc-rot');
            if (btn) btn.addEventListener('click', function (ev) {
                ev.preventDefault(); ev.stopPropagation();
                ctx.setRunning(!ctx.running);
            });
            ctx.bind();
            if (reduced()) ctx.setRunning(false);
        });
    }

    function init() {
        boot();
        ['pjax:end', 'pjax:complete'].forEach(function (ev) {
            document.addEventListener(ev, function () { setTimeout(boot, 120); });
        });
        window.addEventListener('load', function () { setTimeout(boot, 60); });
        if (window.MutationObserver) {
            var t = null;
            new MutationObserver(function () {
                var sec = document.getElementById('tag_cloud') || document.getElementById('tag_cloud-post');
                if (sec && sec.classList.contains(CLS) && document.getElementById('jg-sidebar-pomo')) return;
                if (t) clearTimeout(t);
                t = setTimeout(boot, 180);
            }).observe(document.body, { childList: true, subtree: true });
        }
        // 页面切到后台时停转，省电
        document.addEventListener('visibilitychange', function () {
            if (!ctx) return;
            if (document.hidden) { if (ctx.raf) { cancelAnimationFrame(ctx.raf); ctx.raf = 0; } }
            else if (ctx.running && !reduced()) ctx.start();
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.JGTagCloud3D = { version: VERSION, boot: boot };
})();
