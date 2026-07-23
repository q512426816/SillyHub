---
author: qinyi
created_at: 2026-07-09T18:07:00+08:00
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 工作空间成员 | 可在变更详情页查看该变更的全部会话、新建会话、参与多轮对话 |
| 会话创建者 | 新建会话的成员，会话记录其作为作者 |

## 功能需求

### FR-01: AgentSession 持久化变更/工作空间绑定
覆盖决策：D-001@v1, D-003@v1
Given 一条交互会话在创建时携带 `change_id` 与 `workspace_id`
When `create_session` 写入 `AgentSession`
Then `AgentSession.change_id` / `workspace_id` 被持久化（可空）；`workspace_id` 非空时 `cwd` 写入该工作空间解析出的本地项目根目录。

Given 创建会话时未携带 `change_id`/`workspace_id`（runtimes 页面路径）
When `create_session` 执行
Then 两列为 NULL，行为与现状完全一致（零回归）。

### FR-02: 创建端点接收变更/工作空间字段
覆盖决策：D-001@v1
Given 前端调用 `POST /api/daemon/sessions`
When 请求体含可选 `change_id`/`workspace_id`
Then 后端接收并透传给 `create_session`；`AgentSessionRead` 响应回显这两字段。

### FR-03: 自动注入变更上下文前导
覆盖决策：D-004@v1, D-003@v1；Grill X-01/X-02
Given 会话绑定 `change_id`
When 创建会话首轮 dispatch
Then daemon 收到的 dispatch prompt = `【变更上下文】前导 + 用户消息`；前导含变更标题、当前阶段、工作目录、变更文档路径（design/plan/tasks）、已变更文件清单（复用 `list_change_files`）；`AgentRunLog(channel=user_input)` 仍只记干净用户消息（列表标题/回放不含前导）。

Given 会话未绑定 `change_id`
When 创建会话
Then 不注入前导，dispatch prompt = 用户消息（零回归）。

### FR-04: 变更级会话列表
覆盖决策：D-005@v1；Grill X-03
Given 工作空间成员访问变更详情页
When 调用 `GET /api/workspaces/{wid}/changes/{cid}/sessions`
Then 返回该变更下全部会话（跨成员，不过滤 user_id），按 `last_active_at` desc；每条含 `id/provider/status/turn_count/作者/last_active_at/标题(首条用户消息摘要)`；鉴权走 `require_permission(Permission.CHANGE_READ)`。

### FR-05: 变更详情页内嵌会话区块
覆盖决策：D-002@v1
Given 用户进入变更详情页
When 页面渲染
Then 在「Agent 执行日志」区块之后出现「会话」区块：左侧该变更会话历史列表 + 「新建会话」按钮，右侧复用 `InteractiveSessionPanel`（含 provider/model 手动选择）；新建会话时 `createSession` 带 `change_id`/`workspace_id`。

Given 用户切换历史会话
When 点击某条历史会话
Then 右侧加载该会话的轮次（复用现有 attach/恢复路径）。

## 非功能需求

- **兼容性**：未传新字段时所有既有路径行为不变；runtimes 页面会话零回归。
- **可回退**：Alembic 迁移 down 删列；前端新增 props 全可选。
- **可测试**：backend 单测覆盖 create_session 绑定/前导/列表过滤；frontend 组件测试覆盖 props 透传与区块渲染；既有 session/router 测试不回归。
- **跨平台**：路径解析兼容 Windows/Linux/macOS（复用既有 daemon-client 解析）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02 | AgentSession 加 change_id+workspace_id 列 |
| D-002@v1 | FR-05 | 会话能力复用现有 interactive 配置 |
| D-003@v1 | FR-01, FR-03 | 工作目录=workspace 本地根 |
| D-004@v1 | FR-03 | 上下文注入=后端拼前导 |
| D-005@v1 | FR-04 | 历史列表跨成员可见 |
