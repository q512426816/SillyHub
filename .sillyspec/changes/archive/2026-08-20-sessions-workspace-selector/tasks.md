---
author: WhaleFall
created_at: 2026-08-19T14:10:00
scale: large
---

# 任务列表（Tasks）

变更：2026-08-19-sessions-workspace-selector（/sessions 新建会话工作区选择器）
规模：large（2 模块 frontend+backend，5+ 文件）
task 编号与 plan.md 一致（plan review 修正：task-02=后端 Wave 1，task-03=前端 Wave 2）。

---

## Wave 1（并行，无依赖）

### Task-01：新建 WorkspaceSessionPicker 选择器组件

- **文件**：`frontend/src/components/sessions/workspace-session-picker.tsx`（新文件）
- **内容**：
  - 自治受控组件，props: `{ value: string|null, onChange(wsId, boundMachineId), disabled? }`
  - `useQuery(["workspaces","sessions-form"], ()=>listWorkspaces({limit:100}))` 拉工作区列表
  - `useQuery(["myBindings","sessions-form"], fetchMyBindings)` 拉批量绑定映射
  - antd Select；首项「不使用工作区（默认）」；选项=工作区名（含类型 tag）
  - 空列表态：禁用 + 提示「你还未加入工作区，可在工作区页创建」
  - 加载失败：错误提示 + 重试按钮
  - onChange：`wsId` 非空时按 `bindings` 中该工作区的 `daemon_id`（稳定键）匹配 `machines`（通过 prop 传入的 machines 列表）→ 命中则 `boundMachineId` 带出；未匹配则 `null`
- **引用**：`lib/workspaces.ts:82` `listWorkspaces`、`lib/workspace-binding.ts:37` `fetchMyBindings`、`lib/daemon.ts:84` `DaemonMachineRead`
- **依据**：design.md §5 Phase A、FR-01、FR-02、D-004@v1

---

### Task-02：create_session 补 workspace 归属校验

- **文件**：`backend/app/modules/daemon/session/service.py`（修改 `create_session` 方法）
- **内容**：
  - `workspace_id` 非空时，调用 `allowed_workspace_ids(session, user_id=user_id, permission=Permission.WORKSPACE_READ)` 获取可见集合
  - `workspace_id not in allowed` → 抛 `DaemonSessionWorkspaceNotFound`（404）
  - 校验位置：在 `workspace_id` 读 `Workspace` 行**之前**（不在事务内，失败不落库）
  - 新异常类 `DaemonSessionWorkspaceNotFound(AppError)`：`code = "HTTP_404_DAEMON_SESSION_WORKSPACE_NOT_FOUND"`，`http_status = 404`
- **引用**：`workspace/router.py:246-248`（同款 allowed_workspace_ids 调用范例）
- **依据**：design.md §5 Phase C、FR-05、D-001@v1

---

## Wave 2（依赖 Wave 1 task-01）

### Task-03：NewSessionForm 接入工作区选择器 + 机器联动

- **文件**：`frontend/src/components/sessions/new-session-form.tsx`（修改）
- **内容**：
  - 新增 state `workspaceId: string|null`（默认 null）
  - 表单顶部插入 `<WorkspaceSessionPicker value={workspaceId} onChange={handleWsChange} machines={machines} disabled={submitting} />`
  - `handleWsChange(wsId, boundMachineId)`：清空 `workspaceId`；`boundMachineId` 非空且命中在线机器 → `setMachineId(boundMachineId)` + `setAgentId(null)`
  - `handleStart` 提交体：`workspaceId` 非空时加 `{ workspace_id: workspaceId }`
  - 编号顺移：⓪工作区 → ①机器 → ②智能体 → ③供应商 → ④档案
  - 选中工作区时显示绿色提示条：「会话将在 {wsName} 的项目目录中运行，自动加载其规范文档」
  - `NewSessionFormValues` 增加 `workspaceId: string|null` 字段
- **引用**：design.md §5 Phase B、FR-01/FR-02/FR-03/FR-04/FR-06、D-003@v1

---

## Wave 3（依赖 Wave 1+2 全部完成）

### Task-04：WorkspaceSessionPicker 组件单测

- **文件**：`frontend/src/components/sessions/workspace-session-picker.test.tsx`（新文件）
- **内容**（vitest + @testing-library/react + msw）：
  - 空态：无工作区时选择器禁用 + 提示文案
  - 加载失败：显示错误提示和重试按钮
  - 正常选择：onChange 第二参数正确传入绑定的 boundMachineId（命中场景）
  - 切换回「不使用工作区」→ onChange(null, null)
- **覆盖**：FR-01

---

### Task-05：NewSessionForm 联动与提交测试

- **文件**：`frontend/src/components/sessions/new-session-form.test.tsx`（如不存在则新建）
- **内容**：
  - 选工作区 → 机器选择器自动切换到绑定的在线机器
  - 选工作区 → 机器选择器不动（绑定机器离线/未绑定场景）
  - 改回「不使用工作区」→ 机器选择不回动
  - 提交含选中工作区 → 请求体含 `workspace_id`
  - 提交不含工作区 → 请求体无 `workspace_id` 字段
  - 编号文案断言更新（既有可能有 aria-label/textContent 断言）
- **覆盖**：FR-02/FR-04/FR-06、risk R-04

---

### Task-06：后端归属校验单元测试

- **文件**：`backend/app/modules/daemon/tests/test_change_session.py`（或同目录 session 测试文件，按现状定）
- **内容**（pytest + async）：
  - 有 WORKSPACE_READ 权限的用户传 workspace_id → 正常建会话（断言 session.workspace_id = 传入值）
  - 无权限用户（非成员）传 workspace_id → 404 `HTTP_404_DAEMON_SESSION_WORKSPACE_NOT_FOUND`
  - 工作区 ID 不存在（假 UUID）→ 404
  - 不传 workspace_id → session 建成功，cwd=None（零回归）
- **覆盖**：FR-05、D-001@v1
