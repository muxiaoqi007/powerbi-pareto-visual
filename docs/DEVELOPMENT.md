# 开发说明

## 技术栈

- Power BI Visual API 5.11
- TypeScript 5
- D3 7
- Power BI Formatting Model
- Power BI Formatting Utils

## 项目结构

```text
assets/             图标资源
docs/               使用与开发文档
src/visual.ts       数据转换、双轴绘图、Tooltip 和分段加载
src/settings.ts     格式窗格设置
style/visual.less   视觉样式
capabilities.json   字段槽、DataView 和能力声明
pbiviz.json         视觉对象元数据
```

## 数据流程

视觉对象使用两种有条件的 DataView mapping：未添加辅助 Tooltip 字段时使用 categorical mapping，以接收 Power BI 高亮数据；添加辅助 Tooltip 字段后使用 table mapping，保证文本字段和度量与主实体出现在同一行。

1. 找到角色为 `category` 的实体列。
2. 找到角色为 `measure` 的第一个指标列。
3. 收集所有角色为 `tooltips` 的辅助列。
4. 过滤非正数指标。
5. 按指标降序、实体名称升序排序。
6. 计算当前值占比 `value / total`、排名和累计占比。

table mapping 下如果辅助分组字段使同一个分类标签产生多行，视觉对象会给出粒度警告。建议优先在工具提示槽中使用度量；必须使用文本字段时，应确认它与主分类是一对一关系。

## 分段加载

`capabilities.json` 使用 `window.count = 30000`。当 `dataView.metadata.segment` 存在时，视觉对象调用 `host.fetchMoreData(true)`，让 Power BI 返回聚合后的后续窗口。加载期间只更新状态并请求下一段；完整数据到达后才执行排序、累计计算和正式绘图，避免对不断增长的聚合 DataView 重复做全量工作。如果达到 Power BI 取数内存上限，则绘制已取得的数据并明确提示结果可能不完整。

## 绘图优化

完整点集用于排名、当前值占比、累计占比和 Tooltip。实际 SVG 曲线路径按横向像素桶保留每桶首尾点；销售额柱子按像素桶选取该桶最高值，避免为大量记录生成同等数量的 SVG 节点。柱子使用独立的销售额比例尺和可配置数值轴，累计曲线继续使用 0~100% 占比轴。像素抽样不会参与任何占比计算。

视觉对象会缓存转换后的点集。连续 Resize 事件只更新 SVG viewport，在 ResizeEnd 才使用缓存点集重新计算布局，不会重新创建 SelectionId、格式化辅助字段或排序原始数据。

categorical mapping 收到 `highlights` 时，原始柱形降低透明度，叠加高亮值柱形，并按原始排名绘制高亮子集的累计占比曲线。高亮曲线的分母是当前高亮子集总值。

## 平台交互与可访问性

- 单击数据位置可跨视觉选择，Ctrl/Command + 单击可多选。
- 右键数据位置调用 Power BI 上下文菜单。
- 图表交互层支持 Tab 聚焦、左右方向键浏览、Home/End 跳转及 Enter/空格选择。
- 默认数据色来自 Power BI 色板；高对比度模式使用宿主提供的前景、背景和选中颜色。
- `stringResources/zh-CN` 和 `stringResources/en-US` 提供字段槽、格式面板、图内提示、Tooltip 与无障碍文本资源。

## 命令

```powershell
npm ci
npm run typecheck
npm run lint
npm run package
```

## 发布

1. 同步更新 `package.json`、`pbiviz.json` 中的四段版本号。
2. 运行 lint 和 package。
3. 提交代码并创建 Git tag，例如 `v1.1.1`。
4. 将 `dist/*.pbiviz` 上传到对应 GitHub Release。
