# 数据来源与口径

本目录下两个文件都不是手写的，全部由 `node tools/prepare-data.mjs` 从公开源抓取、抽样、生成。

| 文件 | 大小 | 来源 | 抓取日期 |
|---|---|---|---|
| `covid.json` | 340 KB | JHU CSSE COVID-19 每日累计确诊/死亡 CSV（见下） | 2026-10-05 |
| `countries-50m.json` | 740 KB | Natural Earth 1:50m 国界，经 `world-atlas@2` 打包为 TopoJSON | 2026-10-05 |

## 一、疫情数据（数值）

- 数据集：*COVID-19 Data Repository by the Center for Systems Science and Engineering (CSSE) at Johns Hopkins University*
- 确诊：`https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/time_series_covid19_confirmed_global.csv`
- 死亡：`https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/time_series_covid19_deaths_global.csv`
- 许可：数据仓库为 MIT，公开可再分发；引用请保留 JHU CSSE 署名（页面页脚已标注）。

**口径（重要）**

1. 原始表是**每日累计值**，且按 `Province/State` 分行 —— 中国、美国、澳大利亚、加拿大等会拆成几十行。
   本项目**按国家累加**（省/州行相加），得到每国一条序列。
2. 有脏值需要清洗：`Korea, South`、`Taiwan*`、`US`、`Diamond Princess` 这类名字/占位符，统一映射到
   ISO-3166 数字码（三位字符串，如 `840` = 美国）与中文名。ISO 码是与国界 TopoJSON 做键的**唯一依据**
   —— 靠国名匹配必然对不上（JHU 用 `US`，Natural Earth 用 `United States of America`）。
3. 原始是 1146 天（2020-01-22 → 2023-03-09）。**按 7 天采样成 165 周**：
   周频足以表达趋势，体积从约 4 MB 降到 340 KB；「每周新增」指标由相邻两期累计值相减得到，
   因此在周频下即「近 7 天新增」。
4. 累计值在末期出现平台（JHU 于 2023-03-10 停止更新全球时间序列），故最后一周数据基本不再增长。

## 二、国界几何（图形）

- 打包地址：`https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json`
- 上游：Natural Earth 1:50m Admin 0 – Countries（公有领域），TopoJSON 由 Mike Bostock 的 `world-atlas` 提供。
- 1:50m 精度是刻意的：整文件 740 KB，浏览器端解码约 40 ms；1:110m 太糙（小国消失），1:10m 要 4 MB+，对单屏仪表盘不划算。
- 本项目的 TopoJSON 解码器（`js/lib/topojson.js`，75 行）把 delta 编码的整数坐标还原成经纬度多边形，
  与 `countries.properties` 里的 ISO 数字码对齐 —— 这就是「点地图上的国家」能命中正确国家的根据。

## 三、复现方式

```bash
node tools/prepare-data.mjs          # 重新抓取并生成 data/ 下两个文件（需能访问 raw.githubusercontent.com）
```

脚本默认走 `https_proxy=http://127.0.0.1:33210`（本地代理），直连可 `https_proxy= node tools/prepare-data.mjs`。
