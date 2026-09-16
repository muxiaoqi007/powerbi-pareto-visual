# 高性能帕累托图 for Power BI

<img src="assets/icon-source.png" alt="Pareto Visual icon" width="96">

[![Power BI Visual API](https://img.shields.io/badge/Power%20BI%20Visual%20API-5.11.1-F2C811)](https://learn.microsoft.com/power-bi/developer/visuals/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一个面向大规模分类数据的 Power BI 自定义视觉对象。Power BI 只需按门店、客户、商品等实体聚合一次指标，视觉对象在前端完成降序排序、排名与累计占比计算，避免使用断开连接的 X 轴和按每个 X 值重复执行的 DAX `WINDOW` 计算。

## 功能

- 按指标降序绘制帕累托累计曲线
- 可选显示具体销售额柱子，并在右侧使用销售额数值轴
- 可选显示销售额柱顶标签，沿用 Power BI 度量格式并支持字体样式
- X 轴为实体数量/排名，Y 轴为累计占比
- 原生 Tooltip 显示实体、指标值、排名和累计占比
- “工具提示”字段槽支持多个文本字段、日期字段和度量
- 支持默认、现代及报表页 Tooltip
- X 轴固定在底部；副 Y 轴和累计占比轴可独立设置显示、左右位置、标题、字体和颜色
- 副 Y 轴支持显示单位、小数位、自动/自定义范围和刻度密度
- Tooltip 和累计占比标签同时显示当前值占比与累计占比
- 可配置累计占比横向参考线和数量纵向参考线
- 自动响应日期、地区及其他报表筛选器
- 通过 `fetchMoreData(true)` 分段加载超过 30,000 行的数据
- 绘图阶段按屏幕像素采样，Tooltip 仍保留完整数据精度
- 销售额柱子按屏幕像素桶选取代表值，避免大数据量下创建过多 SVG 节点

## 安装

1. 从 [Releases](https://github.com/muxiaoqi007/powerbi-pareto-visual/releases) 下载最新 `.pbiviz`。
2. 在 Power BI Desktop 的“可视化”窗格选择“从文件导入视觉对象”。
3. 选择下载的 `.pbiviz` 文件。



## 性能设计

传统做法通常使用断开连接的 `X_axis` 表，并为每个 X 值重新构造、排序和累计实体集合。这个视觉对象改为：

1. Power BI 返回每个实体一行的聚合结果。
2. 浏览器端执行一次 `O(n log n)` 排序。
3. 单次线性扫描计算累计占比。
4. 曲线按屏幕像素压缩绘制，悬停定位仍使用完整数据。

单个 Power BI 数据窗口最多 30,000 行。视觉对象会自动请求后续数据段；聚合分段模式仍受 Power BI 100 MB DataView 内存限制。

## 本地开发

要求 Node.js 18 或更高版本。

```powershell
npm install
npm run lint
npm run package
```

打包文件生成在 `dist/`。开发环境和项目结构详见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 限制

- 指标值为零、负数或非数值的实体不会参与累计计算。
- 工具提示中的分类字段应当与主实体保持一对一或多对一关系；一对多字段可能使 Power BI 生成多行实体数据。
- 分段聚合超过 Power BI 的 DataView 内存上限时，视觉对象会显示数据可能不完整的提示。

## 贡献

欢迎提交 Issue 和 Pull Request。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
