---
author: WhaleFall
created_at: 2026-07-15 19:07:21
plan_level: full
---

# 实现计划（Plan）— 里程碑明细提交自动创建任务计划

## Spike 前置验证
无。本次为纯业务逻辑联动，技术方案确定（复用 `import_commit` 同事务批量范式 + ORM 直接操作 `PlanTask`），无新技术栈/未经验证集成，不设 Spike。

## Wave 1（基础，无依赖）
- [ ] task-01: `plan/service.py` 新增联动 helper 方法集（`_ensure_task_for_detail` / `_sync_task_fields` / `_migrate_task_to_version` / `_unlink_task` / `_resolve_project_context` / `_lookup_user_name`，复用 `self._session`、不单独 commit）（覆盖：FR-01 基础设施, D-002@v1）

## Wave 2（六触发点接入，依赖 Wave 1）
> 同改 `plan/service.py`，execute 阶段内顺序执行（避免同文件并发冲突）。
- [ ] task-02: `create_detail` 重构为原子事务（session.add + 统一 commit），`status=done` 时触发 `_ensure_task_for_detail`（覆盖：FR-01, D-003@v1）
- [ ] task-03: `_transition`（save_process→DONE）在统一 commit 前接入 `_ensure_task_for_detail`（覆盖：FR-01）
- [ ] task-04: `import_commit` 在末尾统一 commit 前对每个 done 明细批量建任务（覆盖：FR-02, D-005@v1）
- [ ] task-05: `update_detail` 重构为原子事务 + 接入 `_sync_task_fields`；`delete_detail` 重构 + 接入 `_unlink_task`（覆盖：FR-03, FR-05, D-007@v1, D-004@v1）
- [ ] task-06: `change_process` 在统一 commit 前接入 `_migrate_task_to_version`（覆盖：FR-04, D-001@v1）

## Wave 3（测试，依赖 Wave 2）
- [ ] task-07: 新增 `backend/app/modules/ppm/plan/tests/test_detail_task_link.py`，覆盖 FR-01~FR-07 全部 GWT 边界（建/导入批量/编辑同步/变更迁移/删除解关联/执行人空跳过/版本链查重/强一致回滚）（覆盖：FR-01~FR-07）

## Wave 4（收尾，依赖 Wave 3）
- [ ] task-08: （可选 P2）`milestone-details/page.tsx` 提交成功 toast 加「已自动创建任务」文案（覆盖：体验优化）
- [ ] task-09: 后端 curl 实测 create / save / import / update / change / delete 六路径联动 + grep 确认 import + 重建 backend Docker 部署验证（覆盖：部署验收）

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 联动 helper 方法集 | W1 | P0 | — | FR-01 基础, D-002@v1 | 6 个私有方法，复用 self._session |
| task-02 | create_detail 重构 + done 触发 | W2 | P0 | task-01 | FR-01, D-003@v1 | 原子事务 |
| task-03 | _transition(DONE) 接入 | W2 | P0 | task-01 | FR-01 | save_process 提交路径 |
| task-04 | import_commit 批量建 | W2 | P0 | task-01 | FR-02, D-005@v1 | 同事务批量 |
| task-05 | update 同步 + delete 解关联 | W2 | P0 | task-01 | FR-03, FR-05, D-007@v1, D-004@v1 | 两方法重构 |
| task-06 | change_process 任务迁移 | W2 | P0 | task-01 | FR-04, D-001@v1 | 版本链迁移 |
| task-07 | 联动单测 | W3 | P0 | task-02~06 | FR-01~FR-07 | 全 GWT 边界 |
| task-08 | 前端 toast 文案 | W4 | P2 | — | 体验 | 可选，纯文案 |
| task-09 | curl 实测 + 部署 | W4 | P0 | task-07 | 部署验收 | 六路径 + Docker |

## 关键路径
task-01 → task-02~06（六触发点）→ task-07（单测）→ task-09（实测部署）

## 全局验收标准
- [ ] `test_detail_task_link.py` 全部通过（FR-01~FR-07 边界）
- [ ] **FR-06 强一致**：联动任一步（建/同步/迁移/解关联）失败时，明细操作整体回滚，无半成品（task-07 含强一致回滚用例；task-02~06 同事务实现）
- [ ] 既有 `plan`/`task` 子域测试无回归（test_router / test_importer / test_three_level_query / test_task 等）
- [ ] （brownfield）未触发联动的明细 CRUD 路径行为不变
- [ ] `ruff check` + `mypy app` 通过
- [ ] curl 实测六路径联动结果正确（建/同步/迁移/解关联/批量/执行人空）
- [ ] backend Docker 重建部署 healthy
- [ ] 前端 typecheck + milestone-details 既有测试通过（task-08 若做）

## 调用点搜索（重构影响面）
`grep '\.(create_detail|update_detail|delete_detail)\(' backend/` 结果：
- `plan/router.py:568/623/633` — HTTP 入口（POST/PUT/DELETE `/plan-node-detail`）
- `plan/tests/test_plan_submit_detail.py:23`、`plan/tests/test_service.py:136` — 测试夹具调 `create_detail`

结论：**`router.py` 无需改动**（联动在 service 内部触发，HTTP 契约不变；design 文件清单 router 行「若需」判定为「不需」）。`create_detail`/`update_detail`/`delete_detail` 重构保持签名与返回类型不变，仅改内部事务组织；既有测试夹具建 draft 明细不受影响，建 done 明细的夹具由 task-07 验证无回归。

文件覆盖：`plan/service.py`（task-01~06）/ `test_detail_task_link.py`（task-07）/ `milestone-details/page.tsx`（task-08，可选）均被对应 task 覆盖；`router.py` 确认不改。

## 覆盖矩阵（decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-06 | AC：变更后任务迁移到新版本，不产生第二条（FR-04 单测） |
| D-002@v1 | task-01 | AC：字段映射正确（FR-01 单测断言各字段） |
| D-003@v1 | task-02 | AC：execute_user_id 为空时不建任务（FR-01 边界单测） |
| D-004@v1 | task-05 | AC：删明细后任务保留且 ps_plan_node_detail_id=null（FR-05 单测） |
| D-005@v1 | task-04 | AC：导入 N 条 done 明细生成 N 条任务，失败整批回滚（FR-02 单测） |
| D-006@v1 | task-07（负向） | AC：历史 done 明细不补建（无回填脚本，仅实时触发） |
| D-007@v1 | task-05 | AC：编辑后任务字段同步且 status 不变（FR-03 单测） |

无 P0/P1 unresolved blocker。
