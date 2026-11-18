# Typecho Handsome 主题插件集

极客港（www.jikegang.com）在用的三个 Handsome 主题增强插件，都走「主题 `customCss` / `customJs` 注入、零模板改动」的路子，主题升级不会覆盖，删掉标记块即可卸载。

| 目录 | 插件 | 作用 |
| --- | --- | --- |
| [`weather/`](weather/) | 天气控件 | 按访客 IP 定位（Open-Meteo，零 API Key），右侧栏天气卡：未来 3 天预报、逐小时温度、AQI、天气粒子动效 |
| [`pomodoro/`](pomodoro/) | 番茄钟 | 右侧栏番茄钟：专注 / 休息计时、桌面通知、统计 |
| [`tagcloud3d/`](tagcloud3d/) | 3D 标签云 | 右侧栏 3D 标签球：拖拽惯性、自转、热度分级、挂载入场动效 |

## 安装

每个插件都是独立目录，直接看各自 README：

- [weather/README.md](weather/README.md)
- [pomodoro/README.md](pomodoro/README.md)
- [tagcloud3d/README.md](tagcloud3d/README.md)

通用前置：Typecho 1.3.0 + Handsome 10.1.0（主题目录名为 `handsome`），PHP 7.4+。

## 独立仓库

三个插件原先各自开源，仓库保留、仍可单独 clone：

- https://github.com/ElvisLoo/typecho-handsome-weather
- https://github.com/ElvisLoo/handsome-pomodoro-widget
- https://github.com/ElvisLoo/handsome-tagcloud-3d

## License

各目录自带 LICENSE（MIT）。
