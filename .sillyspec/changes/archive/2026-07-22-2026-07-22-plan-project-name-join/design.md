---
author: WhaleFall
created_at: 2026-07-22T09:20:00
scale: large
---

# 设计文档（Design）— 项目计划 project_name join 改造

## 背景

`ppm_ps_project_plan.project_name` 是**冗余字段**（从项目表复制）。list/get/export/筛选 都直接取它，靠三条链路维护一致：
- create 兜底（ql-20260716-006：project_name 空→按 project_id 查项目表名）
- update 前端发值（ql-014/015 修了表单丢值）
- **项目改名同步**（project/service.py:213-222：项目改名→UPDATE 所有相关项目计划的 project_name）

今天因此连修 4 个 bug（ql-014/015/016 + 旧数据修复）：表单没绑 Form.Item→丢值→发 null；onProjectChange 用 id 回退→写 uuid；列表 render 用 p.id 兜底→显示 id；旧数据坏。**根因都是"冗余字段被写坏"**。

## 设计目标

- list/get/export/筛选 的 project_name 改为通过 `project_id` 实时 **outerjoin `ppm_project_maintenance`** 取真名（单一可信源）。
- 项目改名自动反映到项目计划列表（无需同步逻辑）。
- 消除冗余字段被写坏的风险。

## 非目标

- **不删** `ppm_ps_project_plan.project_name` 列（保留，避免 DB 迁移；只是不再作为显示源）。
- 不改前端（API 契约不变，project_name 仍返回字符串）。
- 不改 create/update 写入逻辑（冗余字段继续写，无害、兼容旧代码）。

## 决策/方案选择

### D-1: 冗余列处理 —— 保留列（用户确认）

**决策**：保留 `ppm_ps_project_plan.project_name` 列，不改 schema。

**备选**：删除列（ALTER TABLE DROP COLUMN）——彻底单一可信源，但需 DB 迁移 + 检查别处引用，风险高。

**理由**：保留列无迁移风险；list/get 改 join 后不依赖该列；create/update 继续写它（无害）。

### D-2: 改名同步逻辑 —— 删除（用户确认）

**决策**：删 `project/service.py:213-222`（项目改名同步刷新项目计划 project_name）。

**理由**：join 后 list 实时取项目表真名，项目改名自动反映，同步逻辑不再需要；该逻辑是今天 bug 链路的一环（维护冗余），删除减少维护负担。

### D-3: join 实现 —— 显式 outerjoin（用户确认方案 A）

**决策**：list/get/export 显式 outerjoin `PpmProjectMaintenance` 取 project_name。

**备选**：
- B：SQLModel `column_property`（模型层 join 表达式）——SQL 复杂度高、排序/筛选别名易踩坑。
- C：冗余 + join fallback（混合）——两套逻辑并存，维护负担重。

**理由**：显式 join 清晰可控；复用 `common/crud` 的 `apply_pagination`/`apply_sort`/`count_total` 处理分页排序计数。

## 总体方案

### list_ps_project_plans（plan/service.py:391）

不再用 `_Crud.list_paged`（取冗余），改自己写 query：

```python
real_name = PpmProjectMaintenance.project_name
stmt = (
    select(PsProjectPlan, real_name.label("real_project_name"))
    .outerjoin(PpmProjectMaintenance, PsProjectPlan.project_id == PpmProjectMaintenance.id)
)
# 筛选 req.project_name → real_name.ilike（不再用 PsProjectPlan.project_name）
# 排序 order_by=project_name → real_name（allowed_sort 别名映射）
# 分页/计数 复用 common apply_pagination/count_total
# 构造 response 时 project_name 用 real_project_name（覆盖冗余）
```

### get_ps_project_plan（540）

同样 outerjoin 取 project_name，response 用 join 值。

### list_ps_project_plans_for_export（1022）

同样 outerjoin 取 project_name（导出列用真名）。

### 筛选/排序字段映射

- `req.project_name`（筛选）→ `PpmProjectMaintenance.project_name.ilike`
- `order_by=project_name`（排序）→ `PpmProjectMaintenance.project_name`（allowed_sort 别名映射，其余字段仍按 PsProjectPlan）

### 删改名同步

`project/service.py:213-222` 的「项目改名→UPDATE PsProjectPlan.project_name」块整体删除（含 old_project_name 辅助变量）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 改 | backend/app/modules/ppm/plan/service.py | list/get/export outerjoin 取 project_name；筛选/排序改 join 字段 |
| 改 | backend/app/modules/ppm/project/service.py | 删改名同步（213-222） |
| 加 | backend/app/modules/ppm/plan/tests/ | 补测试（list/get 返回真名、改名后 list 反映、筛选/排序基于 join） |

## 风险与回滚

- **outerjoin 性能**：项目计划数据量小（几十条），outerjoin 可接受；大数据量可加索引（project_id 已是外键）。
- **list 不再用 `_Crud.list_paged`**：自己写 query，需正确处理分页/排序/计数（复用 common helper，不重复造轮子）。
- **冗余字段不再更新**（删同步后）：不影响显示（join 取真名）；create/update 仍写它（兼容）。
- **回滚**：git revert（纯 service 改动）。

## 自审

- **章节齐全**：背景/目标/非目标/决策/方案/文件清单/风险，符合 design 模板。
- **方案自洽**：显式 join + 删同步 + 保留列，逻辑闭环；单一名源（项目表）。
- **边界**：create/update 不动（冗余写入保留，无害）；前端不动（API 契约不变）。
- **测试**：list/get 返回真名、项目改名后 list 自动反映（验证无需同步）、筛选/排序基于 join 字段。
