---
author: WhaleFall
created_at: 2026-08-19T14:20:00
plan_level: full
---

# 实现计划（Plan）

变更：2026-08-19-sessions-workspace-selector（/sessions 新建会话工作区选择器）

## Spike 前置验证

不适用。所有技术路径已验证：listWorkspaces/fetchMyBindings API 现成、createSession 已支持 workspace_id、allowed_workspace_ids 校验范例已存在（workspace/router.py）。无技术不确定性。

## Wave 1（并行，无依赖）

- [x] task-01: 新建 WorkspaceSessionPicker 选择器组件（覆盖：FR-01, FR-02, D-004@v1）
- [x] task-02: create_session 补 workspace 归属校验 + DaemonSessionWorkspaceNotFound 异常（覆盖：FR-05, D-001@v1）

## Wave 2（依赖 Wave 1 task-01）

- [x] task-03: NewSessionForm 接入选择器 + 机器联动 + workspaceId state + 编号顺移（覆盖：FR-01, FR-02, FR-03, FR-04, FR-06, D-003@v1）

## Wave 3（依赖 Wave 1+2 全部完成）

- [x] task-04: WorkspaceSessionPicker 组件单测（覆盖：FR-01）
- [x] task-05: NewSessionForm 联动与提交测试 + 既有断言适配（覆盖：FR-02, FR-04, FR-06, R-04）
- [x] task-06: 后端归属校验单元测试（覆盖：FR-05, D-001@v1）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 新建 WorkspaceSessionPicker | W1 | P0 | — | FR-01, FR-02, D-004@v1 | 新文件；自治组件，listWorkspaces+fetchMyBindings 数据源；props: value/onChange/disabled |
| task-02 | create_session 归属校验 | W1 | P0 | — | FR-05, D-001@v1 | service.py 改动；allowed_workspace_ids 口径，404 同语义；新异常类 DaemonSessionWorkspaceNotFound |
| task-03 | NewSessionForm 接入 + 联动 | W2 | P0 | task-01 | FR-01/02/03/04/06, D-003@v1 | new-session-form.tsx 改动；workspaceId state+联动+提示条+提交体+编号顺移+Values 接口 |
| task-04 | WorkspaceSessionPicker 单测 | W3 | P1 | task-01 | FR-01 | vitest+msw；空态/禁用/onChange 含绑定机器/切换回 null |
| task-05 | NewSessionForm 测试 | W3 | P1 | task-01, task-03 | FR-02/04/06, R-04 | 联动/提交/不选零回归/编号文案断言更新 |
| task-06 | 后端校验测试 | W3 | P1 | task-02 | FR-05, D-001@v1 | pytest；有权限通过/无权限404/不存在404/不传零回归 |

## 关键路径

task-01 → task-03 → task-05（前端链路，最长路径）
task-02 → task-06（后端链路，可与前端并行）

前端关键路径 3 个 task，后端 2 个 task，Wave 1 前后端并行 → 最短交付周期 = max(前端 W1+W2+W3, 后端 W1+W3) = 3 轮。

## 全局验收标准

- [ ] 所有前端单元测试通过（`pnpm test` 无新增 fail）
- [ ] 所有后端单元测试通过（`pytest daemon/session/` 无新增 fail）
- [ ] TypeScript 编译无错误（`pnpm exec tsc --noEmit` 通过）
- [ ] 不选工作区时提交体行为与改前逐字节一致（零回归：请求体无 `workspace_id` 键）
- [ ] 选工作区后 AgentSession 创建带正确 workspace_id，agent cwd=该工作区项目根
- [ ] 传入无权限 workspace_id → 后端 404，无任何数据落库
- [ ] 编号顺移后既有测试断言全部适配通过（R-04 已关闭）

## 覆盖矩阵

| 决策 | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（归属校验口径 WORKSPACE_READ + 404） | task-02, task-06 | task-06 测试：有权限通过/无权限404；设计 §5 Phase C |
| D-002@v1（可选默认不选） | task-01, task-03 | task-01 组件首项"不使用工作区（默认）"；task-03 default value=null；全局验收"不选零回归" |
| D-003@v1（联动不锁定） | task-01, task-03, task-05 | task-05 测试：联动切机器/绑定离线不动/改回不清机器 |
| D-004@v1（方案 B 独立组件） | task-01 | 文件结构：workspace-session-picker.tsx 独立文件；prop 接口类型与 NewSessionForm 对接 |
