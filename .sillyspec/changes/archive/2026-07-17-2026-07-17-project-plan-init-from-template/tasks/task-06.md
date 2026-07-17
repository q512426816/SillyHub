---
id: task-06
title: types — PsPlanNode 加 template_plan_node_id + has_module
phase: W2
author: WhaleFall
created_at: 2026-07-17 11:02:17
priority: P0
status: draft
requirement_ids:
  - FR-005
decision_ids:
  - D-005@v1
depends_on: []
blocks:
  - task-07
allowed_paths:
  - frontend/src/lib/ppm/types.ts
---

## 1. 目标

前端 `PsPlanNode` interface 加两个透传字段，对齐后端 schema（task-02 落地的 `PsPlanNodeResp` / `PsPlanNodeWithDetail`），为 task-07（milestone-details 模块层条件改 `has_module`）提供类型支撑。

## 2. 依据

- design.md §5.1 / §7.1：`PsPlanNode` 加 `template_plan_node_id: uuid | None` + `has_module: bool`，透传、向后兼容。
- design.md §11 D-005@v1：冗余两字段（model + schema + types 三处），本任务负责 types。
- plan.md task-06 / 覆盖矩阵：D-005 覆盖 task-01 / task-02 / task-06。
- 现状（`frontend/src/lib/ppm/types.ts:428-441`）：`PsPlanNode` 现无两字段；`PlanNode`（模板）已有 `has_module: boolean`（:244），命名/类型对齐。

## 3. 实现

修改 `frontend/src/lib/ppm/types.ts` 的 `PsPlanNode` interface（:428），在现有字段块末尾（`updated_at` 前/后均可，按逻辑分组置于 `ps_project_plan_id` 附近更贴语义）追加：

```ts
  /** 来源 PlanNode 模板 id（新建项目计划时写入；手动建为 null）。D-005@v1 */
  template_plan_node_id: string | null;
  /** 是否有模块子表（冗余自模板，milestone-details 模块层判断用）。D-005@v1 */
  has_module: boolean;
```

- `template_plan_node_id`：后端 `UUID | None` 序列化为字符串或 null → `string | null`。
- `has_module`：后端 `bool`（NOT NULL DEFAULT FALSE）→ `boolean`（必填，非可空）。
- `PsPlanNodeWithDetail extends PsPlanNode`（:602）自动继承两字段，无需额外改。
- `PsPlanNodeCreate` / `PsPlanNodeUpdate` **不改**：两字段由后端在 `create_ps_project_plan` 内部写入，前端创建/更新里程碑不传（design §5.2、§9 端点签名不变）。

## 4. 验收

| # | 标准 |
|---|---|
| AC-01 | `PsPlanNode` 含 `template_plan_node_id: string \| null` + `has_module: boolean`。 |
| AC-02 | `cd frontend && pnpm exec tsc --noEmit` 无错误（含 milestone-details page.tsx 引用处）。 |
| AC-03 | 字段名/类型与后端 `PsPlanNodeResp`（task-02）一致：snake_case、uuid→string、bool→boolean。 |
| AC-04 | 向后兼容：新字段非必填场景（Create/Update）未引入，现有调用点不破坏。 |

## 5. 约束

- 仅改 `frontend/src/lib/ppm/types.ts`，不动 Create/Update DTO、不动其它子域类型。
- 字段命名严格对齐后端 schema（snake_case），不转 camelCase。
- `has_module` 必填（后端 NOT NULL），不用 `boolean | null`。

## 6. 验证命令

```bash
cd frontend && pnpm exec tsc --noEmit
```

## 7. 完成定义

- [ ] `PsPlanNode` 加两字段。
- [ ] tsc --noEmit 过。
- [ ] 不影响现有引用（grep `PsPlanNode` 调用点编译通过）。
