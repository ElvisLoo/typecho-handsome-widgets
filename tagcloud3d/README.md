# Typecho Handsome 标签云 3D 球挂件

给 Typecho 的 Handsome 主题加一个侧栏 3D 标签球：**零模板改动、零依赖、零数据库写入**。就地读取主题已经输出的标签段（`#tag_cloud` / `#tag_cloud-post` 里的 `a.label`），把标签铺到球面上自转；拖拽可旋转、松手带惯性，点标签先平滑转到正面再跳转。

挂在 `#sidebar` 内、番茄钟 `#jg-sidebar-pomo` 的正下方。暗色模式跟随 Handsome 的 `html.theme-dark`，并尊重系统的「减少动态效果」。

---

## 功能

- **3D 词球**：标签按斐波那契球面均匀分布，正面大、背面小且淡出，重叠时读作词云而不是卡片堆叠。
- **拖拽 + 惯性**：按住拖动直接转，松手按最近角速度指数衰减滑行；暂停自转后仍可滑行。
- **点击标签**：先平滑转到正面（取最短转向）再跳转；已在正面的标签直接跳。
- **自转开关**：标题栏一个按钮，双击舞台空白处也能暂停 / 继续。
- **热度三级**：主题标签云按 count 降序输出，取位次作热度，分深 / 中 / 浅三档字号与颜色。
- **半径自适应**：按舞台实测宽度算半径（有上下限），最宽标签参与收缩，宽标签 `max-width` + 省略号兜底；`ResizeObserver` 监听宽度变化。
- **挂载入场**：舞台容器淡入 + 轻微放大（0.65s），只动容器，不动标签自身的 `transform` / `opacity`。
- **pjax 自愈**：换页后自动重建；卸载时停 `requestAnimationFrame`、断观察者、摘掉 `window` 上的 `pointermove` / `pointerup`，不泄漏监听。
- **零依赖**：原生 JS + CSS，无框架、无构建步骤。

---

## 文件

| 文件 | 作用 | 去向 |
| --- | --- | --- |
| `tagcloud3d.js` | 球面分布 / 自转 / 拖拽 / 补间 / 构建与卸载 | 站点根 `/tagcloud3d/`，由 loader 注入 |
| `tagcloud3d.css` | 卡片与球体样式、暗色、入场动画、reduced-motion | 同上 |
| `install.php` | 幂等安装器：复制静态文件 + 插入 / 替换 customJs 里的 loader 块 | 仅安装时用，可删 |
| `tests/core.test.js` | Node 测试（纯函数核心，13 例） | 开发用，不上线 |

---

## 安装

前置：Typecho + Handsome 主题（主题目录名默认 `handsome`，可传第二个参数覆盖）。

1. 把 `tagcloud3d.js` / `tagcloud3d.css` / `install.php` 放到站点根 `/tagcloud3d/`。
2. 命令行执行：

   ```bash
   php /path/to/site/tagcloud3d/install.php /path/to/site
   ```

   脚本会：复制静态文件到 `<站点根>/tagcloud3d/`（已存在则跳过）→ 备份主题配置到 `/www/backup/jikegang/` → 在 `customJs` 里替换 `/* JG-TAGCLOUD3D-START */` 标记块 → 回读校验字段数与其余注入块。
3. 若前台仍显示旧版本，清一次 CDN / 浏览器缓存（loader 的 `?v=` 会变）。

卸载：删掉 `customJs` 里的 `JG-TAGCLOUD3D` 标记块，并删除 `/tagcloud3d/` 目录。

---

## 测试

```bash
node tests/core.test.js
```

覆盖纯函数核心：球面分布、错位步长（与 n 互质）、热度分档、版本与最小标签数。

---

## 实现里几个踩过的点

- **主题按 count 降序输出，热度高的标签会挤在球面极点附近**。用与 n 互质的错位步长把「标签次序」打散到整个球面（`strideOf` + `gcd`），否则球的一面全是热门词。
- **半径不能写死**。标签宽度差异大，按舞台宽度算半径后，还要按实测最宽标签收缩，球心居中；否则宽标签会溢出卡片。
- **标签的 `transform` / `opacity` 由 JS 逐帧写**，CSS 不能再给标签加入场动画，否则每帧被覆盖。入场只动舞台容器。
- **入场动画的声明写错括号会让整条 `animation` 被丢弃**（`cubic-bezier(... both`），浏览器静默忽略，动画像没做一样——这类错误不会报错，只能靠 computed style 核对。
- **减少动态效果下要显式关掉入场动画**，否则 `jgtc-enter` 类被摘掉后容器没有过渡态。
- **换页重建会泄漏 `window` 上的监听**。卸载时把 `pointermove` / `pointerup` 一并 `removeEventListener`。
- **连续点两个标签会叠两个补间动画**。补间加令牌，后一次点击作废旧的。

---

## 已验证环境

Typecho 1.3.0 + Handsome 10.1.0，桌面与移动宽度、浅色与暗色模式、首页 / 文章页 / PJAX 换页。其他 Typecho / Handsome 版本未逐个验证。

---

## 许可

MIT，详见 [LICENSE](LICENSE)。
