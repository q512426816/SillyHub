---
author: WhaleFall
created_at: 2026-07-15 19:07:21
---

# 需求规格（Requirements）— 里程碑明细提交自动创建任务计划

## 角色
| 角色 | 说明 |
|---|---|
| 项目经理 / 明细提交人 | 在 milestone-details 页新建/编辑/提交明细，期望提交后自动有任务 |
| 任务执行人 | 明细的 execute_user_id，自动建出的任务挂在其名下，到任务页/看板可见 |
| 系统管理员 | 关注联动是否产生重复/孤儿任务、事务一致性 |

## 功能需求

### FR-01: 明细变完成时自动创建关联任务
覆盖决策：D-002@v1, D-003@v1
Given 一条里程碑明细 `execute_user_id` 已填写
When 该明细经 `create_detail(status=done)`（前端「提交」新建）或 `save_process` 推进至 `DONE`（编辑后「提交」）
Then 系统创建一条 `PlanTask`，字段按 D-002 映射（user_id←execute_user_id、content←task_theme、start/end_time←plan_begin/complete_time、work_load←plan_workload、ps_plan_node_detail_id←detail.id、project_id/project_name←回溯 PsProjectPlan、module_id←detail.module_id、status="未开始"、kanban_order←该 user max+1）

Given 明细 `execute_user_id` 为空
When 触发建任务
Then 跳过不建（返回 None），不落无主任务

### FR-02: Excel 导入即完成的明细批量建任务
覆盖决策：D-005@v1
Given import_commit 中某行必填字段齐全（required_filled=true → 落 done）
When 导入提交
Then 为每个 done 明细各建一条任务（按 FR-01 映射），与明细入库在同一事务内

Given 导入行必填缺失（→ draft）或 valid=false
When 导入提交
Then 该行不建任务（draft 明细不触发）

Given 联动建任务过程中任一异常
When 异常冒泡
Then 整批导入（明细 + 任务）回滚，无脏数据

### FR-03: 编辑已完成明细同步更新关联任务
覆盖决策：D-007@v1, D-002@v1
Given 一条明细已有 `ps_plan_node_detail_id` 关联任务
When `update_detail` 修改了执行人 / 计划开始 / 计划完成 / 任务主题 / 工作量 / 所属模块
Then 关联任务对应字段同步更新；`task.status` **不**被覆盖（保留任务自身推进）

Given 明细无关联任务（如 draft 明细被编辑）
When `update_detail`
Then 不新建任务（仅变 done 才建）

### FR-04: 明细变更时任务迁移到新版本
覆盖决策：D-001@v1
Given 一条 done 明细已有任务
When `change_process`（旧 done→archived + 新建 draft 版本）
Then 关联任务的 `ps_plan_node_detail_id` 迁移到新版本 draft.id（同事务）

Given 变更后的新版本 draft 随后被提交变 done
When `_transition`→DONE
Then 命中已迁移的任务并更新字段（不新建第二条）

### FR-05: 删除明细解关联、保留任务
覆盖决策：D-004@v1
Given 一条明细有关联任务
When `delete_detail`
Then 关联任务 `ps_plan_node_detail_id` 置 null，任务行及其执行/工时记录保留

### FR-06: 强一致事务
覆盖决策：方案 A（用户确认）
Given 联动任一步（建/同步/迁移/解关联）失败
When 异常冒泡
Then 明细操作整体回滚（明细与任务同事务，要么都成功要么都回滚）

### FR-07: 历史数据不补建
覆盖决策：D-006@v1
Given 上线前已存在的 done 明细
When 无新的提交/编辑/变更/删除/导入操作
Then 不产生任何任务（联动仅在实时触发时生效，无回填脚本）

## 非功能需求
- 兼容性：无表结构变更、无 API 契约变更；既有明细 CRUD 路径行为不变。
- 可回退：移除 6 个触发点的 helper 调用即可完全回退到解耦现状，无 schema/数据依赖。
- 可测试：每个 FR 的 GWT 边界均有单测（`test_detail_task_link.py`）。
- 性能：导入批量联动同事务，量级与导入明细数一致；单条联动为简单 insert/update + 至多 2 条查询（查重、回溯项目、反查姓名），可接受。
- 约束一致：平台级无 workspace_id；姓名反查用 `PpmProjectMember.user_name`（与 kanban 同口径）。

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-04 | 变更迁移、版本链一对一 |
| D-002@v1 | FR-01, FR-03 | 字段映射 |
| D-003@v1 | FR-01 | 执行人为空跳过 |
| D-004@v1 | FR-05 | 删除解关联 |
| D-005@v1 | FR-02 | 导入批量建 |
| D-006@v1 | FR-07 | 历史不补建 |
| D-007@v1 | FR-03 | 编辑同步 |

无未覆盖决策、无剩余风险。
