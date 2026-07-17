---
author: WhaleFall
created_at: 2026-07-17T09:24:00
---

# 模块影响分析（Module Impact）— 计划节点模板模块结构改造

> 变更 `2026-07-16-plan-node-module-restructure` · base 30b30076..HEAD baf49476（5 commit：v1 三层 → v2 降记录 → v3 可编辑 → v4 排序 → 文档同步）

## 模块影响矩阵

| 模块 | 影响类型 | 影响范围 | 变更文件 |
|---|---|---|---|
| **ppm** | 数据结构变更 + 接口变更 + 逻辑变更 + 新增 | plan 子域模板簇（PlanNode / PlanNodeDetail / PlanNodeModule）| model.py / schema.py / service.py / router.py / tests/* / page.tsx / types.ts / plan.ts |

### ppm 模块影响详情

- **数据结构变更**：`PlanNode` + `has_module`（bool NOT NULL DEFAULT FALSE）；`PlanNodeDetail` + `module_id`（uuid|null）+ `ix_ppm_plan_node_detail_module` 索引；migration `20260716_pn_has_module` 加两列+索引。
- **接口变更**：`PlanNodeCreate.has_module` 必填；`PlanNodeUpdate` 含 `has_module`（v3 可编辑）；`PlanNodeDetailBase/Update` + `module_id`；`GET /plan-node/{id}/details` 加可选 `module_id` query。
- **逻辑变更**：`service._validate_detail_module` 防御性归属校验（v2 简化：module_id 非 null 时属同 plan_node）；`update_plan_node` 透传 has_module（v3）；`list_plan_node_details_by_node` 加可选 module_id 过滤。
- **新增**：前端 plan-nodes 页统一二层明细（v2 移除 ModulesSubTable/三层）+ NodeFormDrawer antd Form；`listPlanNodeDetails` 加 moduleId；列表按编号正序（v4）。
- **测试**：service `TestHasModuleAndDetailOwnership`（10 例）+ router `TestHasModuleAndDetailQuery`（5 例）。

### 零回归（ppm 模块内未动）

`PlanNodeModule` 表结构、importer、ps 簇（`PsPlanNodeDetail`）、`PpmSubTable` 组件、milestone-details 页均未改。

## 未匹配文件

以下文件不在 `_module-map.yaml` 任何模块 paths 下（非业务模块归属）：

| 文件 | 类型 | 说明 |
|---|---|---|
| `backend/migrations/versions/20260716_plan_node_has_module_detail_module_id.py` | DB 迁移 | 加 has_module/module_id 列+索引（alembic，跨模块基础设施）|
| `docs/sillyspec/execute-in-place-windows-pitfalls.md` | 工具文档 | SillySpec 工具坑 5（cwd 敏感），非业务模块 |

## 三重交叉验证

- **声明范围**（design §6 文件变更清单）：model/schema/service/router/migration/tests + types/page ✅
- **任务范围**（tasks.md task-01~09）：覆盖上述文件 ✅
- **真实变更**（git diff 30b30076..HEAD）：11 文件（排除 .sillyspec/changes/ 文档），与声明一致 ✅
- **以 git diff 为准**：三者一致，无遗漏/多余。

## 模块文档同步建议（供 doc-syncer 步骤）

- `modules/ppm.md`「变更索引」追加：`2026-07-16-plan-node-module-restructure | 计划节点模板模块结构改造（has_module 记录字段 + 统一二层明细 + 编号正序 + antd Drawer）`。
- `modules/ppm.md` 注意事项可补：has_module 为纯记录字段（不驱动展开）；明细 module_id 非 null 时后端防御性归属校验（跨模板违例 400）。
