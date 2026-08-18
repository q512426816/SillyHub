---
author: qinyi
created_at: 2026-08-17 13:55:00
---

# 需求规格（Requirements）— 扫描统一到会话

## 角色

| 角色 | 说明 |
|---|---|
| 业务/管理人员 | 无自有 daemon（可借用共享 daemon），在配置卡触发扫描，到会话页查看/干预扫描过程 |
| 开发者 | 绑定自有 daemon，触发扫描并跟进扫描会话、审批 AskUserQuestion |
| 工作区 owner | 拥有扫描按钮权限（isOwner 门禁不变） |

## 功能需求

### FR-01: 扫描会话绑定工作区
覆盖决策：D-001@v1
Given 用户在工作区触发 scan-generate
When `start_scan_dispatch` 创建 AgentSession
Then 该 AgentSession 的 `workspace_id` 等于目标工作区 id，出现在工作区会话列表

### FR-02: scan-generate 响应返回 session_id
覆盖决策：D-001@v1
Given 前端调用 `POST /api/workspaces/scan-generate`
When 后端完成派发（含 `_find_active_scan_run` 早返回分支）
Then 响应体含 `session_id`（早返回的老 run 无 agent_session_id 时为 null）

### FR-03: 配置卡触发扫描后进入会话页
覆盖决策：D-002@v1
Given 工作区配置卡用户点击「扫描」且确认重扫
When scanGenerate 成功返回
Then 前端跳转 `/workspaces/{id}/sessions?session=<session_id>`（session_id 为 null 时仅跳会话页不深链），不再内嵌展示运行面板

### FR-04: 会话页深链 attach scan 会话
Given 会话页 URL 带 `?session=<id>`
When 页面挂载且深链参数到达（可能早于列表异步加载）
Then 自动 attach 该会话（fetch logs → setActiveSessionId），未命中列表时直接按 id 加载不静默 no-op

### FR-05: 会话列表展示扫描徽标
Given 工作区会话列表（include_ended=true）
When 列表项 `mode === "scan"`
Then 渲染「扫描」徽标；非 scan 会话无徽标（runtimes/变更会话零回归）

### FR-06: 移除智能体控制台
Given 移除 `/workspaces/{id}/agent` 页面
When 完成页面/快捷导航/侧边栏菜单组/仅其使用模块的删除
Then 全仓 grep `href: "agent"` / `"/agent"`（指向控制台）为零死链；任务 run 在任务详情页、阶段 run 在变更详情页执行日志可见

### FR-07: 变更级会话列表同步 mode 字段
Given `GET /workspaces/{wid}/changes/{cid}/sessions`
When 后端组装 AgentSessionListItem
Then `mode` 字段与工作区级列表一致填充（config.mode）

## 非功能需求

- 兼容性：`AgentSession.workspace_id` 列已存在（nullable + ON DELETE SET NULL + 索引），零迁移；老 scan run（agent_session_id 为 NULL）session_id 返回 null，前端容忍。
- 可回退：删除的控制台页可从 git 恢复；菜单/导航删除为纯前端，无数据影响。
- 可测试：四项目标均有 Phase 3 验收断言（后端 workspace_id/session_id/mode 断言、前端 router.push/深链/徽标断言）。
- 类型同步：后端 schema 变更后同 change 内跑 `pnpm gen:types` 提交 api-types.ts + openapi.json（CLAUDE.md 规则 21）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02, FR-07 | 方案 A：会话收敛·最小侵入（用户确认） |
| D-002@v1 | FR-03, FR-04 | 扫描入口留在配置卡，触发后进入会话页（用户确认） |
| D-003@v1 | FR-06 | 智能体控制台完全移除（用户确认） |
