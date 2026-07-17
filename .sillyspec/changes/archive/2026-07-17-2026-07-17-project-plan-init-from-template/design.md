---
author: WhaleFall
created_at: 2026-07-17T09:50:00
scale: large
---

# 设计文档（Design）— 项目计划初始化从模板

> 变更 `2026-07-17-project-plan-init-from-template` · 方案 A（后端 service 自动）
> 原型 `prototype-2026-07-17-project-plan-init-from-template.html`

## 1. 背景

【计划节点模板】（PlanNode）与【项目计划】（PsProjectPlan）、【里程碑】（PsPlanNode）、【里程碑明细】（PsPlanNodeDetail）关联。现状（Explore 调研）：
- `create_ps_project_plan`（service.py:412-422）只建主表，**不建里程碑**。
- PsPlanNode 与 PlanNode 模板**无外键/生成关系**，里程碑字段全手填。
- 里程碑只能在 milestone-details 页手动逐条新建。

用户需求：新建项目计划时，**按计划节点模板自动初始化里程碑**，减少手工录入、保证结构一致。

## 2. 设计目标

1. 新建项目计划时，按**所有 PlanNode 模板**（按 no 正序）批量生成 PsPlanNode。
2. has_module=**false** 模板：里程碑 + 复制模板明细 PlanNodeDetail → PsPlanNodeDetail（**status=draft**, module_id=null）。
3. has_module=**true** 模板：只建里程碑（空，不建明细）。
4. 实施阶段（has_module=true）里程碑用户新建模块时，**复制模板全部明细**到该模块下（PsPlanNodeDetail, module_id=新模块, **status=draft**）。
5. PsPlanNode 加 `template_plan_node_id` + `has_module`（冗余）字段。
6. milestone-details 模块层展示条件改为按 `has_module`（替代 overall_stage="实施阶段"）。

## 3. 非目标

- ❌ 不改模板表（PlanNode/PlanNodeDetail/PlanNodeModule）。
- ❌ 不改现有项目计划/里程碑（只对新建项目计划生效）。
- ❌ 不做 project_type 筛选（所有模板都生成）。
- ❌ 不改 importer、ps 簇其他逻辑、PlanTask 联动。
- ❌ 不恢复模板的模块管理（模板不分模块，has_module 仅标记）。
- ❌ 不改项目计划创建前端流程（后端自动，零改动）。

## 4. 拆分判断

单功能域（项目计划初始化），不满足拆分/批量条件。单变更，plan 阶段分 2 Wave（W1 后端 model+schema+service+migration+测试，W2 前端 types+milestone-details 模块层条件+测试）。

## 5. 总体方案（方案 A：后端 service 自动）

### 5.1 数据模型

PsPlanNode 加 2 字段：
- `template_plan_node_id: uuid | None`（可空，来源 PlanNode 模板；新建项目计划时写入，手动建为 null）。
- `has_module: bool`（default false，冗余自模板，milestone-details 模块层判断用，避免每次反查模板）。
- migration：ALTER `ppm_ps_plan_node` ADD 两列。

### 5.2 后端逻辑

**`create_ps_project_plan` 扩展**（service.py，同事务）：
1. 建 PsProjectPlan（现状，含 project_name 兜底）。
2. 查所有 PlanNode 模板（按 no asc，order_by=no, order=asc）。
3. 遍历模板，每个建 PsPlanNode：
   - overall_stage / no 从模板复制；ps_project_plan_id=新计划；template_plan_node_id=模板.id；has_module=模板.has_module；task_theme=null。
   - has_module=**false**：复制模板 PlanNodeDetail → PsPlanNodeDetail（plan_node_id=新node.id, module_id=null, **status=draft**）。
   - has_module=**true**：不建明细（空里程碑）。

**`create_module` 扩展**（service.py，同事务）：
1. 建 PlanNodeModule（现状，挂 PsPlanNode）。
2. 反查 PsPlanNode.template_plan_node_id → PlanNode 模板。
3. 若有模板：复制模板 PlanNodeDetail → PsPlanNodeDetail（plan_node_id=里程碑.id, module_id=新模块.id, **status=draft**）。
4. 若无模板（手动里程碑 template_plan_node_id=null）：空模块，不复制。

### 5.3 前端

- milestone-details 模块层展示条件：`overall_stage==="实施阶段"` → `PsPlanNode.has_module===true`。
- 项目计划创建流程零改动（后端自动）。

## 6. 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/ppm/plan/model.py | PsPlanNode + template_plan_node_id + has_module |
| 修改 | backend/app/modules/ppm/plan/schema.py | PsPlanNodeResp / PsPlanNodeWithDetail 加两字段 |
| 修改 | backend/app/modules/ppm/plan/service.py | create_ps_project_plan 批量建里程碑+明细；create_module 复制模板明细 |
| 新增 | backend/migrations/versions/<ts>_ps_plan_node_template_fields.py | ALTER ppm_ps_plan_node ADD 两列 |
| 修改 | backend/app/modules/ppm/plan/tests/test_service.py | create_ps_project_plan 批量建 + create_module 复制 |
| 修改 | frontend/src/lib/ppm/types.ts | PsPlanNode + template_plan_node_id + has_module |
| 修改 | frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx | 模块层条件 overall_stage → has_module |

## 7. 接口定义

### 7.1 PsPlanNode schema 加字段（透传，向后兼容）
- `template_plan_node_id: uuid | None`
- `has_module: bool`

### 7.2 端点签名不变
- `POST /api/ppm/project-plan`（body 不变；内部自动建里程碑）
- `POST /api/ppm/plan-node-module`（body 不变；内部自动复制明细）

## 8. 数据模型（表结构变更）

| 表 | 操作 | 列 | 类型 | 说明 |
|---|---|---|---|---|
| ppm_ps_plan_node | ADD | template_plan_node_id | UUID | nullable，来源 PlanNode 模板 |
| ppm_ps_plan_node | ADD | has_module | BOOLEAN NOT NULL DEFAULT FALSE | 冗余自模板，模块层判断 |

## 9. 兼容策略

- 现有 PsPlanNode（手动建）：template_plan_node_id=null, has_module=false（default）。模块层 has_module=false → 二级展示（与现状非"实施阶段"里程碑一致）。
- 端点签名不变，客户端无感。
- 项目未上线可重置数据（CLAUDE.md 规则 11）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | create_ps_project_plan 批量建（N 模板 × M 明细）事务较大/慢 | P2 | 同事务保证一致；模板数量有限（通常 <10）；实测 |
| R-02 | 模块层条件改 has_module，现有"实施阶段"里程碑（手动建，has_module=false default）丢失模块层展示 | P1 | 项目未上线可重置；若有现有"实施阶段"+模块数据需保留，migration 回填 `UPDATE ppm_ps_plan_node SET has_module=true WHERE overall_stage='实施阶段'`（plan 阶段确认是否需要） |
| R-03 | create_module 复制模板明细，多次建模块则明细重复 | P3 | 设计明确：每次建模块都复制（用户决定建几个模块，每个有模板明细副本） |
| R-04 | 模板无数据（无 PlanNode）时，项目计划建成功但里程碑空 | P3 | 边界，接受 |

## 11. 决策追踪

- D-001@v1：方案 A（后端 service 自动，同事务）。→ §5.2。
- D-002@v1：所有模板生成（不筛选 project_type）。→ §2。
- D-003@v1：has_module=无复制明细 / 有只建空里程碑。→ §5.2。
- D-004@v1：create_module 复制模板明细（模板不分模块）。→ §5.2。
- D-005@v1：PsPlanNode 加 template_plan_node_id + has_module 冗余。→ §5.1。
- D-006@v1：模块层条件改 has_module（替代 overall_stage）。→ §5.3。

## 12. 自审

- ✅ 需求覆盖（§2 全部目标）。
- ✅ 非目标清晰（§3）。
- ✅ 兼容策略（§9）：现有数据 default + 端点不变。
- ✅ 风险识别（§10 R-01~R-04）。
- ⚠️ R-02 需在 plan 阶段确认：现有"实施阶段"里程碑是否回填 has_module=true（否则丢失模块层）。
- N/A 生命周期契约表。
