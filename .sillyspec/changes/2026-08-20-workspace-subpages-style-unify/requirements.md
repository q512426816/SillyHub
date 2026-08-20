---
author: qinyi
created_at: 2026-08-20T22:10:00
---

# 需求规格（Requirements）— 工作区子页面样式统一

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 8 个子页面观感与概览页/主题系统一致 |
| 开发者 | 新页面直接复用 ErrorBanner/EmptyState/返回链接规范，不再复制模式 |

## 功能需求

### FR-01: 统一错误条
覆盖决策：D-301
Given 任一子页面加载失败
Then 渲染公共 ErrorBanner（destructive 主题色+可选重试按钮），8 处（含 explorer:124-131 与 shared-daemon-manager:124）手写红条清零

### FR-02: 返回链接规范化
Given components/skills/mcp/mcp-tokens 页头
Then 无 title 内 hack；PageHeader actions 统一"← 工作区"链接，目标一致 /workspaces/${id}

### FR-03: 空态与列表卡质感
Given skills/mcp/members/components 无数据
Then 渲染现成 EmptyState；skills/mcp 列表卡 SectionCard hover="lift"

### FR-04: 语义色主题化
Given changes/explorer/mcp/mcp-tokens 的 tone 卡与提示文字
Then amber/emerald/red/blue 硬编码（5 处）改 warning/success/error/info 语义色+透明度修饰，双主题跟随

### FR-05: 表格/按钮/文案规格统一
Given members 与 mcp-tokens 手写表、3 页 h-7 小按钮、members 英文文案
Then 两表表头规格逐字段一致（px-4 py-3 bg-muted/40/行 hover）；小按钮换 shadcn Button size=sm（components NAV Link 用 buttonVariants）；members 全中文（含 Actions 列与 subtitle）

### FR-06: 容器与锚修正
Given sessions 右侧面板与 explorer 布局
Then session-section 自写容器换 SectionCard；explorer 高度锚 56px→64px、antd Button（2 处）换 shadcn

## 非功能需求

- 行为等价：纯展示层，零业务逻辑/API 变更；断言同步后全量测试绿
- 回退：单 commit revert
- 验收依据：§0.5+概览页基线（D-304；旧 antd 条款不适用本范围）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-301 | FR-01~03 | 抽公共组件策略 |
| D-302 | 全部 | 不重做原型，模式套用 |
| D-303 | FR-05 | 手写表统一规格不换 DataTable |
| D-304 | 全部 | 验收依据适用范围 |
