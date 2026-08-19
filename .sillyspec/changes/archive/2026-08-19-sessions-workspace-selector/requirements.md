---
author: WhaleFall
created_at: 2026-08-19T14:10:00
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 开发者/用户 | 在 `/sessions` 页面点击"开始会话"的平台使用者 |

## 功能需求

### FR-01: 新建会话表单新增工作区选择器

覆盖决策：D-002@v1

- **Given** 用户打开 `/sessions` 页面，点击"新建会话"
- **When** 表单加载完成（机器列表就绪）
- **Then** 表单顶部显示「工作区（可选）」下拉选择器，首项为「不使用工作区（默认）」，选项列表来自 `GET /api/workspaces`（已按权限过滤）

边界条件：
- 工作区列表加载失败 → 选择器禁用 + 显示错误提示及重试按钮
- 用户未加入任何工作区 → 选择器禁用 + 提示「你还未加入工作区，可在工作区页创建」
- 选择器为 antd Select 组件，与其他选择器视觉一致

### FR-02: 选工作区后自动联动机器选择器

覆盖决策：D-003@v1

- **Given** 用户在工作区选择器中选中某工作区
- **When** 该工作区的 member binding 中当前用户有绑定的 daemon 实体（`fetchMyBindings` 返回 `daemon_id`），且该 daemon 实体对应的机器在线
- **Then** 机器选择器自动切换到绑定的在线机器

边界条件：
- 绑定的 daemon 实体对应的机器离线 → 机器选择不动，用户自行选择
- 当前用户在该工作区无 binding（`daemon_id=null`）→ 机器选择不动
- 改回「不使用工作区」→ 只清 `workspaceId`，不回动机器选择（尊重用户手动选择）

### FR-03: 选工作区后表单显示上下文提示

- **Given** 用户选中某工作区
- **When** 提示条渲染
- **Then** 表单顶部显示绿色提示条，内容为「会话将在〈工作区名〉的项目目录中运行，自动加载其规范文档」；工作区名取自选中的 `Workspace.name`

### FR-04: 提交体携带 workspace_id

- **Given** 用户选中了工作区
- **When** 点击「开始会话」提交
- **Then** `createSession()` 请求体含 `workspace_id: <选中的工作区 ID>`

边界条件：
- 不选工作区（`workspaceId=null`）→ 请求体不含 `workspace_id` 字段（`daemon.ts:671` 对 `undefined` 不下发）→ 后端行为与改前完全一致（零回归）
- `workspace_id` 为无效格式（非 UUID）→ 后端校验失败返回 404

### FR-05: 后端 workspace 归属校验

覆盖决策：D-001@v1

- **Given** `create_session` 收到非空 `workspace_id`
- **When** 校验调用者对该工作区有 `WORKSPACE_READ` 权限
- **Then** 校验通过，继续建会话流程

边界条件：
- 工作区不存在（ID 无效）→ 404 `HTTP_404_DAEMON_SESSION_WORKSPACE_NOT_FOUND`
- 工作区存在但调用者无 `WORKSPACE_READ` 权限（非成员）→ 404（与不存在同语义，不泄露存在性）
- 校验失败时无任何数据落库（异常在 `session.add` 前抛出）

### FR-06: NewSessionFormValues 增加 workspaceId 字段

- **Given** `onCreated` 回调触发
- **When** 回调参数 `values` 暴露给父层
- **Then** `values.workspaceId` 为选中的工作区 ID 或 `null`

## 非功能需求

- 兼容性：现有 `NewSessionForm` 不选工作区时行为不变（提交体、默认机器选择、SSE 流、页面跳转均无差异）
- 可维护性：工作区选择器为独立自治组件（`workspace-session-picker.tsx`），数据获取逻辑内聚，不膨胀 `NewSessionForm` 组件
- 测试覆盖：前端组件测试覆盖空态/禁用/联动回调/提交含 workspace_id；后端归属校验测试覆盖有权限/无权限/不传三种情况
