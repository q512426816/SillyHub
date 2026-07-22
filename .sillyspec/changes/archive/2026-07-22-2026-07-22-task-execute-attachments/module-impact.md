---
author: qinyi
created_at: 2026-07-23 00:46:25
---

# 模块影响分析（Module Impact）— 执行记录附件上传与回显（问题执行 + 计划任务执行）

> 本分析基于 `.sillyspec/changes/2026-07-22-task-execute-attachments/`（proposal.md / design.md / tasks.md），对照真实 `git diff`。
> **⚠️ `_module-map.yaml` 不存在**（`.sillyspec/docs/multi-agent-platform/modules/_module-map.yaml` 未生成）——按 archive step 2 规则，跳过模块路径 glob 匹配，改按「变更范围 + 文件路径前缀」人工归类。建议后续运行 scan 生成模块映射。

## 三重交叉验证

| 验证维度 | 来源 | 结论 |
|---|---|---|
| 声明范围 | proposal.md「变更范围」+ design.md「文件变更清单」(L112-130) | 15 文件（含 1 新建 migration + 1 新建前端 test） |
| 任务范围 | plan.md Wave1-4 / tasks/task-01~13 | 与声明范围一致 |
| 真实变更 | `git diff --name-only HEAD` + untracked | ✅ 本变更 15 文件全部出现在 git diff（含 task/model.py、problem/router.py、新建 migration、新建 task-detail-modal.test.tsx） |

**以 git diff 为准**：本变更声明的 15 文件**全部命中**真实变更。git diff 中**另有非本变更文件**（见下方「未匹配/其他变更」），属其他活跃变更，**不纳入本变更 module-impact**。

## 模块影响矩阵（本变更 task-execute-attachments）

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| PPM/task 后端 | 数据结构变更 | backend/app/modules/ppm/task/model.py | `TaskExecute` 加 `file_urls: list[str]` JSON 列（nullable=False, default_factory=list），位置在 attach_group_id 之后 | false |
| PPM/task 后端 | 数据结构变更（migration） | backend/migrations/versions/20260722220000_add_file_urls_to_task_execute.py（新建） | `ppm_task_execute` 加 `file_urls` 列（JSON, server_default='[]'；downgrade `drop_column`；down_revision=202607221500_create_file） | false |
| PPM/task 后端 | 接口变更 | backend/app/modules/ppm/task/schema.py | `ExecutePlanReq`/`TaskExecuteCreate`/`Update`/`Response` 加 `file_urls`（D-007：`list[str]\|None=None` + `is not None` 守卫） | false |
| PPM/task 后端 | 逻辑变更 | backend/app/modules/ppm/task/service.py | `execute_plan` 逐字段赋值段（L343-355）补 `if req.file_urls is not None: exc.file_urls = req.file_urls` | false |
| PPM/problem 后端 | 接口变更 | backend/app/modules/ppm/problem/schema.py | `ProblemExecuteReq` 加 `file_urls: list[str]\|None=None` | false |
| PPM/problem 后端 | 逻辑变更 | backend/app/modules/ppm/problem/service.py | `execute_problem` signature 加 `file_urls` 参数 + 赋值段补 `file_urls` 赋值 | false |
| PPM/problem 后端 | 调用关系变更（**最高风险 D-006**） | backend/app/modules/ppm/problem/router.py | L313-322 拆包层补 `file_urls=body.file_urls`（problem execute 走独立 kwargs，漏则附件落不进库且被单测遮蔽） | false |
| PPM/task 测试 | 新增 | backend/app/modules/ppm/task/tests/test_task.py | `execute_plan` 带 `file_urls` 落库单测（+2 用例） | false |
| PPM/problem 测试 | 新增 | backend/app/modules/ppm/problem/tests/test_problem_flow.py | execute_problem 带 `file_urls` 落库 + **router→service 透传 file_urls 断言**（防 D-006 遮蔽，+3 用例） | false |
| file-center 后端（**依赖，不改**） | 调用关系变更（复用） | backend/app/modules/file/model.py（仅引用，不改） | `TaskExecute.file_urls` 复用 file-center `owner_type=ppm_task_execute`（file/model.py:28 已预留）。本变更**不改 file 模块**（不改 /api/file、File 表、MinIO）。 | false |
| 前端 PPM 类型 | 接口变更 | frontend/src/lib/ppm/types.ts | `TaskExecute`/`ExecutePlanReq`/`ProblemExecuteReq`/`TaskExecuteCreate`/`Update` 加 `file_urls`（5 类型） | false |
| 前端 PPM 组件 | 逻辑变更 | frontend/src/app/(dashboard)/ppm/_components/task-detail-modal.tsx | `DetailDay.fileUrls` + 首天预填 + 填报区 `FileUpload`（owner_type=ppm_task_execute）+ `handleSubmit` 带 file_urls + 执行记录表附件列 `FileViewer` | false |
| 前端 PPM 组件 | 逻辑变更 | frontend/src/app/(dashboard)/ppm/_components/problem-detail-modal.tsx | `InflightLike.file_urls` + `buildDetailDays` 首天预填 + 填报区 `FileUpload` + `handleSubmit` + 执行记录表附件列 | false |
| 前端 PPM 测试 | 新增 | frontend/src/app/(dashboard)/ppm/_components/task-detail-modal.test.tsx（新建） | 组件渲染预填 + 附件列回显单测（6 用例，vi.mock FileUpload/FileViewer） | false |
| 前端 PPM 测试 | 新增 | frontend/src/app/(dashboard)/ppm/_components/problem-detail-modal.test.tsx | `buildDetailDays` 首天预填 file_urls 单测（+2 用例，7 fixture 补 file_urls:null） | false |
| 前端 PPM 测试 | 配置变更（fixture） | frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-task-detail-drawer.test.tsx | TaskExecute fixture 补 `file_urls:[]`（必填字段下游适配，非逻辑改） | false |

**needs_review 全 false**：本变更范围在 design.md / plan.md 明确闭环，13 任务全完成、测试全绿（后端 ppm task+problem 71 passed 含 router→service 透传断言；前端 980 passed 零回归），无不确定影响。

## 未匹配/其他变更（git diff 存在但**不属于** task-execute-attachments）

主仓库工作区当前**多变更混杂**（非本变更所致）。下列文件出现在 `git diff` 中，但归属其他活跃变更，**本变更 module-impact 不纳入**：

| 文件（示例） | 归属变更 | 说明 |
|---|---|---|
| backend/app/modules/ppm/{task,problem,project,plan}/model.py 的 `__table_args__` 索引部分；backend/app/modules/agent/{model,service}.py、daemon/{lease,session}/service.py、change/dispatch.py、ppm/workbench/service.py、runtime/service.py、admin/router.py、core/db.py；backend/migrations/versions/202607222330_add_perf_indexes.py（新建） | **2026-07-22 性能优化 Wave1**（高频查询路径补索引，与 file_urls 无关） | ⚠️ `task/model.py` 与 `problem/model.py` 被**两个变更共享**：本变更的 file_urls 列 + perf 变更的 __table_args__ 索引。本表上方只纳入 file_urls 部分。perf 索引归性能变更，需其独立 module-impact。 |
| .sillyspec/changes/2026-07-22-mobile-app-ui/*；frontend/next.config.mjs、frontend/src/app/globals.css、frontend/src/lib/query-client.ts、frontend/src/app/(dashboard)/loading.tsx（新建） | **2026-07-22-mobile-app-ui**（移动端 UI / 全局样式 / 路由 loading） | 与执行记录附件无关 |
| .claude/skills/sillyspec-*/SKILL.md、.codex/skills/sillyspec-*/SKILL.md | **SillySpec 工具自身更新** | skill 定义文件，非业务变更 |
| .sillyspec/changes/2026-07-22-task-execute-attachments/* | **本变更文档产物** | brainstorm/plan/execute/verify 文档 + verify-result.md + 本 module-impact.md |

> **归档后建议**：主仓库多变更混杂，部署前需按变更分别 commit（task-execute-attachments / perf-indexes / mobile-app-ui），避免一把 commit 混杂多变更。
