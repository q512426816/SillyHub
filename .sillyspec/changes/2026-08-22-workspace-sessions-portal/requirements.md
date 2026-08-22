---
author: qinyi
created_at: 2026-08-22 16:56:30
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在三个入口使用会话工作台的最终用户（观感/交互一致性受益方） |
| 前端开发者 | 维护门户与面板的开发者（一处组件三处复用） |

## 功能需求

### FR-01: 共享门户组件
Given /sessions 页现有外壳（列表+两态+page 面板+页级数据）
When 提取为 SessionsPortal
Then 组件接受可选 scope（WorkspaceScope{kind,workspaceId} | ChangeScope{kind,workspaceId,changeId} 判别联合），缺省=全局；PageContainer/PageHeader 进组件，标题「智能体会话」+ 范围后缀；/sessions 页薄壳化渲染 `<SessionsPortal />`。

### FR-02: 工作区入口
Given /workspaces/[id]/sessions 页
When 本变更后
Then 整页渲染 `<SessionsPortal scope={kind:workspace, workspaceId}>`——列表仅该工作区、创建锁定绑定 workspace_id（隐藏工作区选择器）、观感与 /sessions 一致（§4.B 降级矩阵口径）。

### FR-03: 变更级入口
Given 变更详情侧边窄卡与无专属会话页
When 本变更后
Then 侧卡变入口（listChangeSessions 仅本人过滤取前 3 条预览 + 打开工作台按钮）；新路由 /workspaces/[id]/changes/[cid]/sessions 整页渲染门户（change 级列表 + 创建绑定 change_id 与 workspace_id 双传）。

### FR-04: 列表 scope 化
Given SessionListPanel 现仅支持全局真分页
When 加可选 scope
Then workspace/change 模式切 listWorkspaceAgentSessions(include_ended)/listChangeSessions 整列合成单页（加载更多隐藏，虚拟滚动复用）；客户端按 author 仅本人过滤（迁移旧语义）；隐藏服务端筛选条、保留本地标题搜索；瘦字段降级（chips 缺字段不渲染、时间回退 last_active_at）；全局模式行为零变化。

### FR-05: 深链恢复
Given 旧工作区页有 ?session= 初始选中
When 门户化后
Then SessionsPortal 统一支持 ?session=<id> 挂载时解析初始选中（无效/无参静默忽略），三入口通用；变更入口卡直达经此链路。

### FR-06: 退役清理
Given workspace-session-section 与 change-session-section 两组件及其测试
When 消费面重组完成后
Then 两组件与两测试文件删除，全仓无 dangling import；语义迁移四项（仅本人过滤/创建绑定/ended 恢复/深链）均有新测试落点；ended 会话恢复改为 page 模式手动重开（有意变更，以 /sessions 为准）。

### FR-07: 回归与实证
Given 全部改动
When 收尾
Then 全量 vitest/tsc/lint 零失败；受影响测试（sessions 页 18 用例、list-panel、new-session-form、change-sessions-card）语义保留适配；3001 重建部署后三入口浏览器对照实证。

## 非功能需求

- 兼容性：全局入口（/sessions）行为零变化（scope 缺省路径不动）。
- 可回退：纯前端单变更，git revert 整体回退。
- 可测试：三 scope 渲染/过滤/深链/绑定均有断言；用例对账（退役 4+? 迁移不减语义）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01~04 | 以 /sessions 为准统一一个组件（用户拍板） |
| D-002@v1 | FR-03 | 变更承载=专属路由门户（用户选方案A） |
| D-003@v1 | FR-04 | 仅本人过滤迁移（Grill P0-1 裁决） |
| D-004@v1 | FR-05 | ?session= 升级为门户统一能力（Grill P0-2 裁决） |
| D-005@v1 | FR-06 | ended 恢复自动→手动（以 /sessions 行为为准，Grill 明示） |
