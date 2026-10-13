---
plan_level: full
execution_mode: main
---

# 实现计划（Plan）— 2026-10-13-session-change-files-hover

## Wave 1（backend，无依赖）
- task-01

## Wave 2（frontend 基础层；task-03 依赖 task-01 的后端端点；task-02 与 task-03 文件正交）
- task-02
- task-03

> batch: task-02+task-03（execution_mode=main 下顺序执行，并批仅作上下文分组）

## Wave 3（悬浮组件，依赖 task-02 的 autoRefreshMs prop 与 task-03 的 hook）
- task-04

## Wave 4（挂载 + 收口验收，依赖全部）
- task-05

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端会话关联变更端点 | W1 | P0 | — | FR-01, D-001@v2, D-003@v1 | `list_changes_for_session`（link JOIN、deleted 排除、enrich 复用、未归档优先/created_at desc、limit 100）+ 端点（404 中文）+ pytest 同卡 |
| task-02 | ChangeFileTree 可选 autoRefreshMs | W2 | P1 | — | FR-05, D-004@v1 | 可选 prop（默认 undefined 不轮询）+ effect interval 调 refreshTree/refreshPending + 卸载清除 + fake timers/回归测试 |
| task-03 | gen:types + 前端数据层 | W2 | P0 | task-01 | FR-01, FR-05 | `pnpm gen:types` + `listSessionChanges`/`useSessionChanges`（打开时 15s refetchInterval）+ queryKeys 注册 |
| task-04 | 悬浮变更文件组件 | W3 | P0 | task-02, task-03 | FR-02, FR-03, FR-04 | 胶囊入口（显隐/徽标/呼吸）+ hover 下拉分组（归档折叠）+ 大弹窗（Select 切换 + ChangeFileTree key 重挂载 + autoRefreshMs=15000）+ vitest 同卡 |
| task-05 | 挂载与收口验收 | W4 | P0 | task-04 | FR-02, 验收 | session-panel-page 挂载（workspaceId/sessionId/running）+ 聚焦测试全绿 + lint/tsc 过门 + 对照 design 文件清单核验 |

## 关键路径

task-01 → task-03 → task-04 → task-05（后端端点先行为前端类型与数据层供给前提）；task-02 独立链并入 Wave 3 汇合。

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）

- 零 migration：不新增数据库表/列，全部复用 `change_session_links` + `changes` 既有结构。
- 前端 api-types.ts MUST 走 `pnpm gen:types` 生成，禁止手写（CLAUDE.md 规则 21）；同批提交 api-types.ts + backend/openapi.json。
- ChangeFileTree MUST 只加可选 `autoRefreshMs` prop（默认 undefined 行为逐字节不变），禁止重构组件；不传时 MUST 无新增定时器（回归测试守护）。
- 不改会话 DTO（AgentSessionRead / AgentSessionListItem）。
- 注释与用户可见文案一律中文（CLAUDE.md 规则 12）；日期格式化 `toLocaleString("zh-CN", …)`；端点 404 文案中文（l10n 守护）。
- 测试规则 0：仅跑改动模块相关测试（backend pytest 按 change 模块 / frontend vitest 相关文件），禁止全量（proposal 可回退节 + CLAUDE.md 规则 0）。
- 不做 SSE 推送式刷新、不动移动端路由（design 非目标）。

## 全局验收标准

1. 聚焦测试全绿：backend `pytest app/modules/change/tests/test_session_changes_endpoint.py` + frontend `vitest run` 相关测试文件（autoRefreshMs 回归/悬浮组件），ruff+mypy（backend）、eslint+tsc（frontend）过门。
2. FR-01 排序/软删排除/404/工作空间隔离/空列表语义有 pytest 断言；FR-02~04 显隐/分组/折叠/切换/重挂载有 vitest 断言。
3. brownfield 零回归：不传 autoRefreshMs 的既有消费方（ChangeFilesCard/移动端）行为不变；无关联变更的会话页面与现状一致（入口不渲染）。
4. gen:types 产物同批提交（api-types.ts + backend/openapi.json），CI `gen:types:check` 无漂移。
5. 对照 design.md 文件变更清单逐项核验（NEW: 3 个新文件存在；修改文件改动符合说明）。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v2 | task-01..task-05 | 四件套 FR 全交付 + verify 对照 |
| D-002@v1 (rejected) | 非目标 | 详情列内嵌形态不出现在任何实现（防复潮） |
| D-003@v1 (rejected) | task-01 | 反向端点存在性（纯前端拼凑被否决的证据性对立面） |
| D-004@v1 | task-02, task-04 | autoRefreshMs 默认行为回归测试 + 弹窗内 15s 刷新用例 |
