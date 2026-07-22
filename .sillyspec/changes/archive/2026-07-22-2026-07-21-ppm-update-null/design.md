---
author: WhaleFall
created_at: 2026-07-21T12:00:00
scale: large
---

# 设计文档（Design）— ppm update 清空字段修复

## 背景

ppm 模块编辑保存时，若把原本有值的字段清空，库里旧值保留、清空不生效（系统所有 ppm 编辑页通用现象）。

根因：ppm 的 `_Crud.update`（`plan/service.py`、`problem/service.py`）与 `PlanService.update_detail` 写成：

```python
for k, v in data.items():
    if v is not None:
        setattr(obj, k, v)
```

而所有 PUT 路由用 `body.model_dump(exclude_unset=True)`——`exclude_unset` 会把「用户显式设为 null 的字段」包含进 data。两者语义打架：路由把 null 放进来表示「清空」，service 又把 null 当「不要改」跳过，最终清空无效。

对照 `project/service.py`、`task/service.py` 的 update（直接 `setattr`，不过滤 null），清空行为正确——说明 ppm 早期写的 `_Crud.update` 是偏离统一模式的实现 bug。

## 设计目标

- 编辑时清空字段，保存后库中正确落 `null`，前端回显空。
- 保留部分更新语义：未传的字段不动（仍由路由 `exclude_unset=True` 保证）。
- 修复覆盖 ppm 所有 update 路径（plan/problem/task/project 子域）。

## 非目标

- 不改 `change_process`（`plan/service.py:951`）：它是「复制旧版本 + overrides 覆盖」语义，`null = 不覆盖`是正确的，改了会破坏版本链。
- 不改 `agent` 模块同类写法（`agent/service.py:59`，有测试守卫明确「None 不覆盖是有意设计」）。
- 不抽 common update helper（用户选方案 A，直接改 3 处，不扩大为重构）。
- 不做全量前端排查（按需核，已知 MasterDrawer / 明细表单清空发 `null`）。

## 拆分判断

单一根因（`if v is not None`）、统一修复模式、影响面集中在 ppm update。不满足拆分条件（非 3+ 模块/角色/审批流），不走批量模式。一次变更完成。

## 决策/方案选择

### D-1: 修复策略 —— 去 `if v is not None`（方案 A）

**决策**：去掉 plan/problem `_Crud.update` + plan `update_detail` 的 `if v is not None`，改直接 `setattr`。

**备选**：
- 方案 B：抽 `common/crud.py` `apply_partial_update` helper，plan/problem/task/project 统一复用——消除重复但重构范围大（含本无 bug 的 task/project）。
- 方案 C：仅改 `_Crud.update` 两处不动 `update_detail`——不完整（明细清空仍 bug）。

**理由**：方案 A 最小改动、行为正确、风险低；task/project 已用直接 setattr 且清空正确，证明该模式可行，无需重构统一。用户确认选 A。

**trade-off**：plan/problem 两份 `_Crud.update` 仍重复（不抽 helper），后续可重构统一，本次聚焦 bug 修复。

### D-2: 不改 `change_process` / `agent`

**决策**：`change_process`（plan/service.py:951，复制+覆盖语义）和 `agent`（service.py:59，有测试守卫）的同类 `if v is not None` 不改。

**理由**：`change_process` 是版本链复制 + overrides 覆盖，`null = 不覆盖`是正确语义（改了会破坏版本链、丢失旧版本字段）；`agent` 有测试明确守卫「None 不覆盖是有意设计」。二者与 update 的清空语义不同。

## 总体方案

**方案 A：去掉 `if v is not None`，直接 setattr**（路由 `exclude_unset=True` 已保证「未传不动」）。

修改点（3 处逻辑 + 1 处注释）：

1. `backend/app/modules/ppm/plan/service.py` `_Crud.update`（约 174 行）：
   ```python
   for k, v in data.items():
       setattr(obj, k, v)
   ```
2. `backend/app/modules/ppm/problem/service.py` `_Crud.update`（约 174 行）：同上。
3. `backend/app/modules/ppm/plan/service.py` `PlanService.update_detail`（约 657 行）：同上。
4. `backend/app/modules/ppm/task/service.py` `update`（约 139 行）：注释「仅写入非 None 字段」与代码（直接 setattr）不符，顺手修正注释，逻辑不动。

不改：`change_process`（951）、`agent`（59）、`task/project` update 逻辑（已正确）。

### 行为对照

| 场景 | 改前 | 改后 |
|---|---|---|
| 字段未传（前端 omit） | exclude_unset 不含 → 不动 | 同（不变） |
| 字段清空（前端发 null） | exclude_unset 含 null → service 跳过 → 旧值保留（bug） | exclude_unset 含 null → setattr(null) → 清空生效 |
| 字段改新值 | setattr 新值 | 同（不变） |

### 测试策略

补单测（pytest，`asyncio_mode=auto`）：
- 清空字段：update 传 `field=None` → 断言库里 `field is None`。
- 未传字段：update 不含 field → 断言库里 field 保持原值（部分更新语义不变）。
- 覆盖 `_Crud.update`（plan/problem 各一）+ `PlanService.update_detail`。

实测（CONVENTIONS 教训）：后端改完 curl 验证 PUT 清空生效（登录有效账号后）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 改 | backend/app/modules/ppm/plan/service.py | `_Crud.update` 去 `if v is not None`；`update_detail` 同 |
| 改 | backend/app/modules/ppm/problem/service.py | `_Crud.update` 去 `if v is not None` |
| 改 | backend/app/modules/ppm/task/service.py | 修正 update 注释（逻辑不动） |
| 加 | backend/app/modules/ppm/plan/tests/test_service.py | 补「清空 + 部分更新」单测（_Crud.update / update_detail） |
| 加 | backend/app/modules/ppm/problem/tests/test_problem_flow.py | 补「清空 + 部分更新」单测（_Crud.update） |

## 风险与回滚

- **DB 字段 nullable**：update schema 字段均 `xxx | None`，对应列 nullable；清空 null 不会 IntegrityError（测试覆盖确认）。
- **前端清空发 null**：已知 ppm 主要表单清空发 `null`（`|| null`），实现时按需核其余表单；若某表单清空发 `undefined`（omit），exclude_unset 不含，清空仍不生效——需逐一核。
- **兼容**：若有调用方依赖「清空不生效」（理论上不该有，这是 bug），会受影响——属期望行为修正。
- **回滚**：纯 service 行为变更，git revert 即可。

## 自审

- **章节齐全**：背景 / 目标 / 非目标 / 拆分判断 / 总体方案 / 文件变更清单 / 风险，符合 design 模板。
- **方案自洽**：去 `if v is not None` + `exclude_unset` 配合，三场景（未传/清空/改值）行为正确（见行为对照表）。
- **代码事实**：经 Design Grill 独立审查逐条核验（plan/problem `_Crud.update`、`update_detail`、`change_process`、task/project update、PUT 路由 exclude_unset），行号与语义全部属实，`specVerdict/qualityVerdict` 均 pass。
- **非阻断 gap**：`update_detail` 去守卫与 `_sync_task_fields` 耦合（源码 plan/service.py:1645 已有 `uid is not None` 守卫保护 `PlanTask.user_id` 非空，执行复查）——已记入 tasks T3。
- **边界明确**：`change_process` / `agent` 不改（语义不同/有意），`task/project` 不改逻辑（仅修 task 注释）。
