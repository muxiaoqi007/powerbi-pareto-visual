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
src/visual.ts       数据转换、绘图、Tooltip 和分段加载
src/settings.ts     格式窗格设置
style/visual.less   视觉样式
capabilities.json   字段槽、DataView 和能力声明
pbiviz.json         视觉对象元数据
```

## 数据流程

视觉对象使用 table DataView mapping，保证文本型工具提示字段和度量与主实体出现在同一行。

1. 找到角色为 `category` 的实体列。
2. 找到角色为 `measure` 的第一个指标列。
3. 收集所有角色为 `tooltips` 的辅助列。
4. 过滤非正数指标。
5. 按指标降序、实体名称升序排序。
6. 计算排名和累计占比。

## 分段加载

`capabilities.json` 使用 `window.count = 30000`。当 `dataView.metadata.segment` 存在时，视觉对象调用 `host.fetchMoreData(true)`，让 Power BI 返回聚合后的后续窗口。

## 绘图优化

完整点集用于排名、累计和 Tooltip。实际 SVG 曲线路径按横向像素桶保留每桶首尾点，避免为大量记录生成同等数量的路径段。

## 命令

```powershell
npm ci
npm run lint
npm run package
```

## 发布

1. 同步更新 `package.json`、`pbiviz.json` 中的四段版本号。
2. 运行 lint 和 package。
3. 提交代码并创建 Git tag，例如 `v1.1.1`。
4. 将 `dist/*.pbiviz` 上传到对应 GitHub Release。
