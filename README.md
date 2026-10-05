# covid-atlas · 疫情地图 · 时间轴

把约翰斯·霍普金斯大学（JHU CSSE）三年疫情数据画成一张**会动的世界地图 + 折线对比**。
纯前端，**零运行时依赖**——没有框架、没有 d3、没有 Leaflet：TopoJSON 解码、等距圆柱投影、
canvas 分级着色、折线绘制、命中测试全部手写，一共 2280 行。

![地图与折线](qa-shots/verify/01-%E5%9C%B0%E5%9B%BE%E4%B8%8E%E6%8A%98%E7%BA%BF.png)

## 快速开始

```bash
node tools/serve.mjs          # 默认 4182，可 node tools/serve.mjs 8080
# 浏览器打开 http://127.0.0.1:4182/
```

> ES Module 必须走 HTTP。直接双击 `index.html` 会白屏（`file://` 下模块被 CORS 拦），这不是 bug。

## 能做什么

| 能力 | 说明 |
|---|---|
| 时间轴 | 165 周，2020-01-22 → 2023-03-09；播放/暂停、慢·中·快三档、拖动、`←/→` 走一周 |
| 5 个指标 | 累计确诊 / 累计死亡 / 每周新增确诊 / 每周新增死亡 / 病死率，`1–5` 切换 |
| 世界地图 | 分级着色（choropleth），鼠标滚过看数值，**点国家加入对比** |
| 对数刻度 | `L` 一键切换。确诊数跨 6 个数量级，线性刻度下 2020 上半年几乎是全黑 |
| 折线对比 | 默认美/中/印/巴/法 5 国，最多 12 条序列；搜索框支持中文名与英文名 |
| 双主题 | 暖色编辑风（默认）/ 夜色，`T` 切换 |
| 排行榜 | 当前周的全球 Top 8 + 全球合计，随滑块实时变化 |

快捷键：`空格` 播放/暂停 · `←/→` 前后一周 · `1–5` 指标 · `L` 对数 · `T` 主题。

## 目录

```
index.html                 74    单页骨架（无障碍标注齐全）
css/style.css             186    两套主题变量 + 栅格布局
js/lib/topojson.js         75    TopoJSON 解码（delta 整数 → 经纬度多边形）
js/lib/projection.js       89    等距圆柱投影 + 反投影 + 视口缩放
js/lib/dataset.js         102    指标定义 + 各国序列聚合 + 排名 + 全球合计
js/lib/color.js            69    多段色带插值 + 两套主题色带 + 对数色标
js/render/map.js          122    canvas 世界地图分级着色 + 命中测试
js/render/chart.js        170    多序列折线图（对数轴、面积、悬浮读数）
js/main.js                457    状态机：时间轴播放器、指标、主题、点选、搜索、键盘
tools/prepare-data.mjs    266    JHU CSV → 周频聚合 → 与国界 TopoJSON 合并
tools/core.test.mjs       399    纯函数单测（52 条）
tools/verify.mjs          190    无头浏览器硬验证（46 条断言 + 实况截图）
tools/serve.mjs            35    零依赖静态服务
```

## 数据

`data/` 下两个文件都由 `node tools/prepare-data.mjs` 生成，**不是手写的**，完整出处与口径见
[`data/SOURCES.md`](data/SOURCES.md)。三条要点：

1. JHU 原始表按省份拆行、国名带脏值（`Korea, South`、`Taiwan*`、`US`…）→ **按国家累加**，
   统一映射到 **ISO-3166 数字码**。ISO 码是与国界数据做键的唯一依据：JHU 写 `US`，
   Natural Earth 写 `United States of America`，靠名字匹配必然对不上。
2. 1146 天日频 → **抽成 165 周**：340 KB 而不是 4 MB，趋势信息没有损失。
3. JHU 于 2023-03-10 停止更新全球时间序列，所以末几周曲线走平 —— 是数据到站，不是渲染 bug。

## 怎么证明它是对的

不靠"看起来对"，跑三段真命令：

```bash
node tools/core.test.mjs      # 纯函数单测
node tools/serve.mjs &        # 另开一个终端（或后台）
node tools/verify.mjs         # 无头浏览器：断言 + 截图
```

| 命令 | 结果 | 判据 |
|---|---|---|
| `core.test.mjs` | **52 / 52 通过** | TopoJSON 解码、反投影、聚合、色带插值、格式化的边界与非边界用例 |
| `verify.mjs` | **46 / 46 通过** | ① 断言全绿 ② 0 条 console 错误 ③ 截图**非空白**（对像素做统计，肉眼不看） |

真值锚点（写死在断言里，任何一处渲染错位都会红）：末周全球累计确诊 **676,456,135**、累计死亡
**6,881,344**；点击美国本土命中 `iso=840`；播放 1.5 s 后 `index` 确实前进；地图 canvas 尺寸
>= 1000×360 且存在非背景像素。

四张实况截图落在 `qa-shots/verify/`：`01-地图与折线` `02-窄屏960` `03-夜色-每周新增` `04-播放中-病死率`。

> `verify.mjs` 复用同目录 `gods-eye-view` 已装好的 puppeteer（避免重复下载 Chromium）。
> 换机器：`ATLAS_PPTR=<某个已装 puppeteer 的 package.json 绝对路径> node tools/verify.mjs`。

## 设计取舍

- **不引库**。d3/Leaflet 能省掉 ~260 行解码+投影+命中，但会带来 100 KB+ 体积和一层黑盒。
  这里选择手写，换取"每一像素都是自己算的"和零依赖。
- **TopoJSON 而非 GeoJSON**：同一份 Natural Earth 1:50m，TopoJSON 740 KB，GeoJSON 约 2.4 MB。
- **1:50m 精度**：1:110m 小国直接消失，1:10m 要 4 MB+，50m 是单屏仪表盘的平衡点（解码约 40 ms）。
- **等距圆柱投影**：一屏装下全球、结论可读；墨卡托会把高纬面积撑大，正射投影看不全。
- **暖色编辑风**：疫情别做成红色恐怖热力图，暖色系更好读，也和夜色主题配套。

## 已知局限

- 数据到 2023-03-09 为止（上游停更）。
- 极小的岛国在 1:50m 精度下点不中，用搜索框选中。
- 未做移动端手势专门适配（960 px 窄屏重排已在回归里）。
- 无构建步骤 = 无类型检查，纯函数层靠单测兜底。

## 许可

代码 MIT（见 `LICENSE`）。数据：JHU CSSE 数据仓库 MIT；Natural Earth 公有领域。
引用请保留 JHU CSSE 署名。
