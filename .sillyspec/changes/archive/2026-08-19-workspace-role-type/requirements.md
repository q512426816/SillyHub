---
author: qinyi
created_at: 2026-08-18 23:10:30
change: 2026-08-18-workspace-role-type
---

# 需求规格（Requirements）— 工作区角色类型

## FR-01 受控词表与校验

Workspace.type 收成 8 值受控词表：`frontend-code` / `backend-code` / `fullstack` / `business-doc` / `submodule` / `deploy-ops` / `design-asset` / `other`。后端 `constants.py` 单一事实源；WorkspaceCreate.type 必填（Literal 校验，OpenAPI required+enum）；WorkspaceUpdate.type 同 Literal（omit=不改/null=清空）。

**验收**：传非法 type 创建/更新返回 422；OpenAPI JSON 含 enum；api-types.ts 生成的类型为联合类型。

## FR-02 role 自由文本

role ≤100 字符自由文本（如"订单模块"），创建/更新可传，WorkspaceRead/WorkspaceBrief 返回。

## FR-03 description 字段

Workspace 新增 `description`（Text 可空，≤2000），创建/更新/读取全链路透传；列表/弹窗截断单行展示，全文在详情页。

**验收**：migration 升降级通过；PATCH omit/null 语义正确（不改/清空）。

## FR-04 列表筛选与徽标

列表页卡片渲染类型徽标（8 值配色 + NULL=未分类灰 + 未知非空值=原值灰）；类型筛选下拉 = 新词表 8 项 + 全部 + 未分类；"未分类"走 `?unclassified=true`（与 type 互斥同传 422）；移除 daemon-client 旧值项。

**验收**：选"前端代码"只出 frontend-code 工作区；选"未分类"只出 type 为空工作区。

## FR-05 创建与编辑入口

添加工作区弹窗：类型必选下拉（8 项中文标签）+ 描述选填 textarea，提交体带 type/description。详情页：基本信息编辑区（type/role/description），PATCH 保存。

**验收**：不选类型无法提交；编辑后徽标即时更新。

## FR-06 项目侧关联展示

PPM 项目"关联工作区"弹窗：已关联列表按词表渲染徽标 + title 带 role/description 摘要；可选工作区列表项补类型徽标。WorkspaceBrief 补 role/description。

## FR-07 yaml 拓扑展示层归一

parser 读 projects/*.yaml 时 type 经 YAML_TYPE_NORMALIZE_MAP 归一（仅明确映射，映射不上保留原值）、description 透传；归一结果只进组件目录只读展示（ComponentRead 补 description），不落 Workspace 表。

**验收**：yaml 写 `type: frontend` 时目录展示"前端代码"；写未知值展示原值。

## FR-08 破坏面收口

§5.6 清单调用点同 change 修齐：移动端 m/workspaces 筛选（删旧值项）+ 创建（提交体补 type）；桌面筛选；后端存量测试 test_workspace_admin_management.py 旧值断言改新词表。

## NFR

- 词表加值成本：改 constants.py + 前端词表镜像 + gen:types，单 change 内完成。
- Windows/Linux 兼容：无路径/换行敏感改动。
