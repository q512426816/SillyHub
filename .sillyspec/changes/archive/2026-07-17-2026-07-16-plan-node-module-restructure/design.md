---
author: WhaleFall
created_at: 2026-07-16T11:25:00
scale: large
---

# 设计文档（Design）— 计划节点模板模块结构改造

> 变更 `2026-07-16-plan-node-module-restructure` · 方案 A（复用 PpmSubTable editable + antd Table 三层 expand + 抽屉 antd Form）
> 原型 `prototype-plan-node-module-restructure.html`

## 1. 背景

`/ppm/plan-nodes`（计划节点模板）当前结构：模板（PlanNode）展开行内**并列**两个子表——模板明细（PlanNodeDetail）与执行模块（PlanNodeModule），两者都直接挂 `plan_node_id`，无相互外键（`PlanNodeDetail` 无 `module_id`）。

用户反馈的问题与新需求：
1. **模块子表不应每个模板都有**：不同模板有的需要按模块拆分、有的不需要，现状强制每个模板都显示模块子表不合理。
2. **有模块时层级错**：用户期望「有模块时，模板明细应是模块的子表」即 模板 → 模块 → 明细（三层），而非当前的 模板 → {明细、模块}（并列二层）。
3. **UI 未统一 antd**：`NodeFormDrawer` / `ModuleFormDrawer` 仍用原生 `<input>` + tailwind（`inputCls`），与搜索区/其他页 antd 风格不一致。

数据层现状（Explore 梳理结论）：
- `PlanNodeDetail` 挂 `plan_node_id`，**无 `module_id`**；`PlanNodeModule` 挂 `plan_node_id`。
- ps 簇 `PsPlanNodeDetail` 已有 `module_id`（挂模块），但模板簇没有。
- **模板簇与 ps 簇无生成关系**，两簇独立 CRUD；`importer` 只建 `PsPlanNodeDetail` 不建 `PlanNodeDetail`。
- `PlanNodeModule` 被 plan-nodes 页与 milestone-details 页**共用**（按 `plan_node_id` 查）。

## 2. 设计目标

1. `PlanNode` 加 `has_module` 标志，**新建模板时选**，保存后**不可改**。
2. 有模块时：模板 → 模块 → 明细（**三层**），明细挂 `module_id`。
3. 无模块时：模板 → 明细（**二层**，现状），明细挂 `plan_node_id`。
4. plan-nodes 页所有原生输入控件改 antd（Form / Input / InputNumber / DatePicker / Switch）。
5. 不破坏 `PlanNodeModule` 与 milestone-details 的共用关系（零回归）。

## 3. 非目标

- ❌ 不改 `PlanNodeModule` 模块表结构（共用方 milestone-details 不受影响）。
- ❌ 不改 ps 簇（`PsPlanNodeDetail` 已有 module_id，不动）。
- ❌ 不改 importer（不建 `PlanNodeDetail`，与本次无关）。
- ❌ 不做「模板 → 项目计划」生成（现状不存在该逻辑）。
- ❌ 不允许 `has_module` 创建后再切换（D-001，避免归属混乱）。
- ❌ 不改其他 ppm 页面（milestone-details / 项目计划详情）。

## 4. 拆分判断

单功能域（模板管理）的中大型变更，但后端模型 + 前端结构 + UI 化强耦合，不满足「3+ 独立交付模块/多角色/跨页面状态流转」拆分条件，非批量模式。单变更，`plan` 阶段分 2 个 Wave（W1 后端模型+迁移+API+测试，W2 前端 types+页面重写+antd 化）。

## 5. 总体方案（方案 A）

### 5.1 数据模型

- **PlanNode** 加 `has_module: bool`（default=false）。`PlanNodeCreate` 必填；`PlanNodeUpdate` **不含** `has_module`（不可改，service 层强制忽略/拒绝）。
- **PlanNodeDetail** 加 `module_id: uuid.UUID | None`（可选）：
  - 模板 `has_module=false`：明细挂 `plan_node_id`，`module_id=null`。
  - 模板 `has_module=true`：明细挂 `module_id`（指向同模板下某 `PlanNodeModule`），`plan_node_id` 仍填（便于反查模板）。
- **归属一致性校验**（service 层）：明细的 `module_id` 必须属于同一 `plan_node_id` 下的模块，否则 400。

### 5.2 查询

- `list_plan_node_details_by_node(plan_node_id, module_id=None)` 加可选 `module_id` 过滤：
  - 无模块模板：前端拉 `module_id=None`（或全部）的明细。
  - 有模块模板：每个模块展开时拉 `module_id=<该模块>` 的明细（按需查询，避免一次拉全量）。

### 5.3 前端结构（plan-nodes 重写）

- **母表**（antd Table）：编号 | 总阶段 | 项目类型 | **是否有模块**（Tag 是/否）| 操作。
- **展开行**：统一渲染 `<DetailsSubTable planNodeId={n.id} />`（明细挂 plan_node_id，二层）。**has_module 仅作记录字段，不驱动展开结构**（需求变更 v2，见 §13）——无论是否有模块，计划节点模板页展开都只显示模板明细一个子表，模块子表不在该页显示。
- **明细子表**：复用 `PpmSubTable` editable 模式（内部已 antd Form），`DETAIL_COLUMNS` 列宽压缩 + 固定 `scroll.x`（沿用 ql-008 教训），批量行内编辑 + 保存。
- **NodeFormDrawer**（antd Form）：总阶段 / 项目类型（PpmDictSelect）/ 编号 + **是否有模块 Switch**（编辑态 disabled，仅记录用）。

### 5.4 antd 化范围

| 原控件 | 改为 |
|---|---|
| NodeFormDrawer 原生 `<input>` + `inputCls` | antd `Form` + `Input` / `InputNumber` + `Switch`（has_module）|
| ModuleFormDrawer 原生 `<input>` | ~~antd `Form` + `Input` + `DatePicker`~~（v2：模块子表从计划节点模板页移除，该抽屉已删）|
| 母表 / 模块表 | antd `Table`（母表保持；v2 模块表从该页移除）|
| 明细子表 | `PpmSubTable` editable（已 antd Form，保持）|

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/ppm/plan/model.py` | `PlanNode` + `has_module`；`PlanNodeDetail` + `module_id` |
| 修改 | `backend/app/modules/ppm/plan/schema.py` | `PlanNodeCreate` + has_module（必填）、`PlanNodeResp` + has_module、`PlanNodeUpdate` 不含；`PlanNodeDetailBase/Create/Update/Resp` + module_id |
| 修改 | `backend/app/modules/ppm/plan/service.py` | `list_plan_node_details_by_node` 加可选 module_id 过滤；create/update 明细透传 + module_id 归属校验；update_plan_node 忽略 has_module |
| 修改 | `backend/app/modules/ppm/plan/router.py` | `GET /plan-node/{id}/details` 加 `module_id` query（可选）；其余端点签名不变（body schema 变）|
| 新增 | `backend/migrations/versions/<ts>_plan_node_has_module_detail_module_id.py` | ALTER `ppm_plan_node` ADD `has_module`；ALTER `ppm_plan_node_detail` ADD `module_id` |
| 修改 | `backend/app/modules/ppm/plan/tests/test_service.py` / `test_router.py` | has_module 不可改、明细归属校验、按 module_id 过滤等用例 |
| 修改 | `frontend/src/lib/ppm/types.ts` | `PlanNode` + has_module；`PlanNodeDetail/Create/Update` + module_id |
| 重写 | `frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx` | 母表加列、条件展开（二/三层）、两个 Drawer antd Form 化、明细复用 PpmSubTable |

## 7. 接口定义

### 7.1 后端 schema 变更（Pydantic，`schema.py`）

```python
class PlanNodeBase:
    overall_stage: str
    project_type: str | None = None
    no: int | None = None
    has_module: bool = False              # 新增

class PlanNodeCreate(PlanNodeBase):
    has_module: bool                      # 新增，必填

class PlanNodeUpdate:                     # 不含 has_module（不可改）
    overall_stage: str | None = None
    project_type: str | None = None
    no: int | None = None

class PlanNodeResp(PlanNodeBase):
    id: uuid.UUID
    has_module: bool                      # 新增

class PlanNodeDetailBase:
    plan_node_id: uuid.UUID | None = None
    module_id: uuid.UUID | None = None    # 新增（有模块时挂模块）
    detailed_stage: str | None = None
    # ...其余字段不变
# Create/Update/Resp 继承，均带 module_id
```

### 7.2 端点变更（`router.py`）

- `GET /api/ppm/plan-node/{plan_node_id}/details?module_id=<uuid>` —— 加可选 `module_id` query。
- 其余模板/明细/模块端点签名不变（body schema 变更自动生效）。

### 7.3 前端类型（`types.ts`）

```ts
interface PlanNode { id; overall_stage; project_type; no; has_module: boolean; ... }
interface PlanNodeCreate { overall_stage; project_type?; no?; has_module: boolean }
interface PlanNodeUpdate { overall_stage?; project_type?; no? }   // 无 has_module
interface PlanNodeDetail { id; plan_node_id?; module_id?: string | null; detailed_stage?; ... }
```

## 8. 数据模型（表结构变更）

| 表 | 操作 | 列 | 类型 | 说明 |
|---|---|---|---|---|
| `ppm_plan_node` | ADD | `has_module` | BOOLEAN NOT NULL DEFAULT FALSE | 是否有模块子表 |
| `ppm_plan_node_detail` | ADD | `module_id` | UUID | 可空，有模块时指向 `ppm_plan_node_module.id`（不加 FK 约束，对齐本表既有 plan_node_id 无 FK 的风格）|

索引：`module_id` 查询频繁，加 `Index("ix_ppm_plan_node_detail_module", "module_id")`。

现有数据：项目未上线（CLAUDE.md 规则 11 允许重置），`has_module` 默认 false、`module_id` 默认 null（现有明细视为挂模板），无需复杂回填。

## 9. 兼容策略（brownfield）

- **未升级的客户端**：旧前端不传 `has_module` → 后端 default false（无模块，现状）；不传 `module_id` → null（挂模板）。行为不变。
- **PlanNodeModule 共用方**（milestone-details）：模块表结构未变，按 `plan_node_id` 查模块的逻辑完全不变，零回归。
- **回退**：迁移可逆向（alembic downgrade 删两列）；前端页面可回退到重写前版本（git revert）。
- **不改的 API/表**：ps 簇、importer、PlanNodeModule 表、PpmSubTable 组件。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 三层嵌套（模板→模块→明细）+ 明细行内编辑的横向滚动 / 性能（参考 plan-node-subtable-style 的 R-02 教训） | P2 | 明细子表固定 `scroll.x`（列宽总和）；三层展开按模块按需拉明细（不全量）；实现阶段多分辨率实测 |
| R-02 | `has_module` 不可改约束被绕过（前端 disabled 可被绕；update 直接传 has_module） | P1 | service.update_plan_node 强制忽略 has_module 字段（不透传）；后端测试覆盖 |
| R-03 | 明细 `module_id` 归属不一致（指向别的模板的模块，或模板无模块却传 module_id） | P1 | service create/update 校验：has_module=true 时 module_id 必填且属于同 plan_node；has_module=false 时 module_id 必须为 null；违例 400 |
| R-04 | 现有数据 has_module 全 false、明细全挂模板，与新建「有模块」模板混用 | P2 | 项目未上线可重置；查询按 module_id 过滤天然区分；无需数据迁移 |
| R-05 | 重写 plan-nodes 页面覆盖 plan-node-subtable-style 的样式成果（固定宽度/列宽） | P2 | 重写时保留 DETAIL_COLUMNS 列宽压缩 + 固定 scroll.x；plan-node-subtable-style 仍在活跃，实现 W2 前需先归档（其列宽/scroll.x 成果由本次继承） |

## 11. 决策追踪

- **D-001@v1→v3**：~~`has_module` 新建时定，保存后不可改~~。**v3 取消**：has_module 编辑时可改（纯记录字段，随时可改，见 §13）。
- **D-002@v1→v2**：~~有模块时明细挂 `module_id`（三层）~~。**v2 取消三层**：has_module 降为纯记录字段，计划节点模板页 UI 统一二层明细（见 §13）。module_id 字段保留作防御。
- **D-003@v1**：明细子表复用 `PpmSubTable` editable（方案 A），不在本页新写行内编辑。→ §5.3，R-01。
- **D-004@v1→v2**：明细 `module_id` 归属后端校验。**v2 简化**：has_module 不再参与校验，仅保留 module_id 非 null 时属同 plan_node 的防御校验（见 §13）。

需求变更（v2）见 §13。

## 12. 自审

- ✅ 需求覆盖：has_module 标志（§2/§5.1）、三层/二层（§5.3）、antd 化（§5.4）均覆盖。
- ✅ Grill 覆盖：D-001~D-004 全映射 design 章节。
- ✅ 约束一致性：后端 ruff/mypy/pytest + 前端 tsc/vitest/pnpm lint（CONVENTIONS）；中文 UI；跨平台。
- ✅ 真实性：表名/字段/函数/端点来自 Explore 梳理（model.py / schema.py / service.py / router.py 行号）。
- ✅ YAGNI：不做模板→项目计划生成、不改 ps 簇/importer/模块表（§3）。
- ✅ 验收标准：has_module 不可改（R-02 测试）、三层/二层条件展开、归属校验（R-03 测试）、antd 控件统一——具体可测。
- ✅ 非目标清晰（§3）。
- ✅ 兼容策略（§9）：未升级客户端 default 行为不变、共用方零回归。
- ✅ 风险识别（§10 R-01~R-05）。
- N/A 生命周期契约表：不涉及 session/lease/agent_run/daemon/lifecycle/claim/heartbeat 关键词。

## 13. 需求变更（v2，2026-07-16）

> execute 完成后的需求调整。has_module 从「驱动展开结构」降级为「纯记录字段」。

**变更内容**：
1. 计划节点模板页（`plan-nodes`）展开行**统一只显示模板明细一个子表**（二层，明细挂 plan_node_id），不论 has_module 取值。模块子表从该页移除。
2. `has_module` 字段**仅作记录**：新建模板时 Switch 可选，保存后不可改（D-001 保留），母表「是否有模块」列展示，但**不驱动 UI 展开结构、不参与明细归属校验**。

**对应实现调整**：
- 前端 `plan-nodes/page.tsx`：`PlanNodeChildren` 移除 has_module 条件渲染与 `ModulesSubTable`，统一渲染 `DetailsSubTable`（不传 moduleId）；`NodeFormDrawer` 的 has_module Switch 保留（记录）；母表列保留。`ModulesSubTable`/`ModuleFormDrawer` 从该页删除。
- 后端 `service.py`：`_validate_detail_module` 简化——has_module 不参与，仅保留「module_id 非 null 时必须属同 plan_node」的防御性校验（避免脏数据），module_id=null 一律放行（UI 统一二层）。
- 测试：更新归属校验用例（has_module=true/false 均允许 module_id=null；module_id 非 null 跨模板仍 400）。
- migration / has_module 字段 / module_id 字段：**保留**（DDL 已落地，回退无意义；module_id 留作防御性归属约束的承载）。

**保留不变**：
- D-001（has_module 新建定不可改）、D-003（明细复用 PpmSubTable）、antd 化（NodeFormDrawer）。
- PlanNodeModule 表、importer、ps 簇、PpmSubTable 组件、milestone-details 页零回归。

**为何保留 has_module/module_id 字段**：has_module 作业务记录（区分模板是否按模块组织，供后续可能恢复三层或统计用）；module_id 字段留作防御性归属约束的承载，且 ps 簇早有同名字段，保持模型一致性。

**v3（2026-07-16，进一步）**：D-001 取消——has_module **编辑时可改**（不再「新建定不可改」）。
- `PlanNodeUpdate` 加 `has_module` 字段（可选）；`service.update_plan_node` 移除「强制 pop/忽略 has_module」逻辑，允许透传更新。
- 前端 `NodeFormDrawer` 的 has_module Switch 移除 edit 态 `disabled`；`handleSaveNode` edit 模式把 has_module 传给 update。
- 测试：原 `test_update_plan_node_ignores_has_module`（service+router）改为「可改」（update 传 has_module=true 后 DB 反映 true）。
- D-001 由「has_module 新建定不可改」**降级为无约束**（纯用户可选记录字段，随时可改）。
