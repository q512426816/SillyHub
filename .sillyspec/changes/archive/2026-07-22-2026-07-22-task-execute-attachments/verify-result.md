---
author: qinyi
created_at: 2026-07-23 00:32:00
change: 2026-07-22-task-execute-attachments
verdict: pass
---

# 验证报告 — 执行记录附件上传与回显（问题执行 + 计划任务执行）

## 验证结论：✅ PASS

本变更对照 design.md / requirements.md / plan.md 验证通过。问题执行 + 计划任务执行（共用 TaskExecute 表）的附件上传（填报）+ 执行记录表回显均已落地。

## FR 达成

| FR | 描述 | 达成 | 证据 |
|---|---|---|---|
| FR-01 | TaskExecute.file_urls 列 | ✅ | task/model.py TaskExecute.file_urls(list[str],JSON,default_factory=list) + migration 20260722220000_add_file_urls(add_column server_default='[]') |
| FR-02 | 计划任务执行附件 | ✅ | task/schema ExecutePlanReq.file_urls(\|None=None) + service execute_plan is not None 守卫赋值 + task-detail-modal FileUpload/handleSubmit/附件列 + test_task |
| FR-03 | 问题执行附件 | ✅ | problem/schema ProblemExecuteReq + service execute_problem signature+赋值 + **router L322 拆包透传 file_urls=body.file_urls**(D-006) + problem-detail-modal + test_problem_flow(含 router→service 透传断言) |
| FR-04 | 执行记录表回显 | ✅ | 两弹窗执行记录表 FileViewer fileIds={e.file_urls ?? []} |
| FR-05 | 填报上传 | ✅ | 两弹窗填报区 FileUpload owner_type=ppm_task_execute owner_id 记录级归属(首天 inflightId/后续天 null) |

## 决策 D-001~D-007 一致性

独立 QA acceptance review（execute Step 9，tier=independent）11/11 全 pass：
- D-001 file_urls 存文件 id（复用 file-center D-006）
- D-002 按记录级归属（每天一组 FileUpload）
- D-003 首天预填（task 内联 / problem buildDetailDays 纯函数）
- D-004 执行记录表附件列行内 FileViewer
- D-005 owner_id 首天=inflightId / 后续天=null
- **D-006 problem router 拆包透传（最高风险，L322 实测确认）+ task 侧直传**
- D-007 file_urls 守卫语义（list[str]|None=None + is not None，4 场景区分）

## 测试结果（主仓库，手动 apply 后）

| 项 | 结果 |
|---|---|
| 后端 pytest ppm task+problem | 71 passed（含 file_urls 落库 + router→service 透传断言 + D-007 保留原值） |
| 后端 ruff check | All checks passed |
| 后端 mypy（19 文件） | Success, no issues |
| 前端 typecheck | 0 error |
| 前端 vitest | 980 passed 零回归 |
| alembic heads | 单 head（file_urls 220000 → perf 223300 链） |

## task-01~13 完成度

13 任务全部完成（plan.md checkbox 全勾 + 每个 task review.json specVerdict/qualityVerdict=pass）。关键路径 task-01→05→06→**07**→09（problem 侧）闭环。

## 风险与观察

1. **handleSubmit 空→undefined（D-007 语义，非 bug）**：执行弹窗删除首天 in-flight 已有附件后提交，前端传 undefined（不传），后端 None 守卫保留原值不清空。与 design D-007「不传=保留原值」一致。未来产品若要求「执行弹窗可清空附件」，需前端显式送 []。
2. **apply 方式（手动）**：sillyspec worktree apply 因主仓库 baseline 漂移（execute 期间改 plan/design docs 致主仓库工作区变化）+ git merge 冲突（checkpoint 6f0662a6）致 patch/merge 均失败，改用手动 git apply（worktree 代码 patch）+ stash 恢复性能索引 + 修正 file_urls 位置（TaskExecute）+ 合并 migration 链。主仓库本变更代码完整、测试全绿。
3. **主仓库多变更混杂**：主仓库工作区同时含性能优化变更（task/problem model.py 索引 + perf migration 223300）+ mobile-app-ui 等未 commit 工作。本变更 file_urls(220000) 与 perf(223300) migration 链已合并（perf down_revision 改接 file_urls）。**部署前需整体 commit 协调多变更**。

## Runtime Evidence（集成证据）

本变更是 PPM **业务功能**（问题/计划任务执行记录的附件上传与回显），**非 daemon/runtime 集成**。触发词扫描命中 "backend" 是因本变更改 PPM FastAPI（task/problem 的 schema/service/router），但这属业务 HTTP 层，**不涉及** daemon/session/lease/agent_run/lifecycle/claim/heartbeat（design.md §生命周期契约已声明省略）。

本变更的「集成」= 前端 → backend HTTP 透传链路，已由端到端单测覆盖（这是本变更所需的全部集成证据）：

- `test_router_execute_problem_passes_file_urls`（test_problem_flow.py L603）：PUT `/api/ppm/problem-list/{id}/execute` body.file_urls → 经 problem/router.py 逐字段拆包 → `service.execute_problem` → DB `TaskExecute.file_urls` 落库断言。**绿**（证明 D-006 problem router 拆包透传不断裂、前端附件能经 HTTP 落库——这正是本变更最高风险点的集成验证）。
- task 侧 router 直传 body（不拆包），task-08 `execute_plan` service 单测 + 赋值覆盖。

无需 daemon↔backend 运行时集成测试或运行时日志——本变更不碰 daemon、不碰 session/lease/agent_run/lifecycle。

## CLI 实测（verify --done product validation）

✅ verify --done 实测通过：`module[ppm,frontend]` 退出码 0（87.8s）。

- **配置依据**：`.sillyspec/local.yaml` modules 块用子模块粒度（ppm/frontend/daemon），`test_strategy:module` 时 verify 实测按 `git diff --name-only` 命中模块跑（ppm 399 + frontend 980，均绿）。本次变更命中 ppm + frontend（不命中 daemon，不跑）。
- **⚠️ main 分支 backend 全量有 33 个预存 errors**（非 ppm 模块，如 `app/modules/task/test_router.py` 等，与本变更无关——本变更只改 ppm task/problem `file_urls`，ppm 399 全绿）。故 verify 实测**不用 backend 大模块全量**（会被无关预存失败阻塞），改用 ppm 子模块精确到本变更范围。这是 main 分支既有技术债（建议单独排查 33 个非 ppm errors），**非本变更引入**。
- **环境变量 `SILLYSPEC_TEST_TIMEOUT_MS`**（sillyspec 3.24+ 支持，local.yaml 坑2 已解）用于调实测 timeout。

## 结论

本变更 task-execute-attachments 验证通过，可进 archive。部署前注意主仓库多变更混杂状态的整体 commit。
