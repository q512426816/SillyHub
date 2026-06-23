---
author: qinyi
created_at: 2026-06-24T01:47:08
source_commit: ba87eec
---

# SillySpec 变更生命周期流程

## 目标
驱动一个变更（change）从 scan → brainstorm → propose → plan → execute → verify → archive 的完整工作流，含人工审批关卡。

## 参与模块
- **backend/change**：变更目录解析与 CRUD（`change.service` / `parser` / `router`）
- **backend/change.model**：`StageEnum` + `ChangeStatus`（need_* 等待态）+ `TRANSITIONS`
- **backend/workflow**：FSM 迁移与审计（`workflow.service` / `fsm.FSM` / `spec_guardian` / `router`）
- **backend/change_writer**：proposal/design/tasks/plan 的 markdown 生成（`ChangeWriterService`）
- **backend/task**：变更下任务解析与看板（`task.service` / `parser`）
- **backend/runtime**：阶段进度/用户输入/产出物（`runtime.service`）
- **backend/archive**：归档与知识沉淀（`ArchiveService`）
- **frontend**：变更详情页/看板/runtime 进度/审批按钮

## 流程摘要

```text
(frontend)  scan 完成后创建变更 → POST /changes  或  brainstorm 启动
     │
(backend)   ChangeService 创建 changes 行（stage=brainstorm, status=draft）
     │        目录 .sillyspec/changes/<change_key>/{proposal,design,tasks,plan}.md
     ▼
(back/fe)   stage 流转由 workflow.transition_change 驱动：
            brainstorm → propose → plan → execute → verify → archive
     │        每次迁移：spec_guardian 校验产出物存在 + 写 audit_logs
     ▼
(backend)   等待态切换（ChangeStatus）：
            need_requirement_input / need_proposal_review
            need_plan_review / need_human_test / need_archive_confirm
     │        前端弹卡 → 用户答复 → runtime.user-inputs 落库 → 自动迁移
     ▼
(backend)   execute 阶段：task.parser 解析 tasks.md → 任务行
     │        派发 agent run（见 agent-run 流程）逐任务执行
     ▼
(backend)   verify：对照 design.md + 模块文档验收（spec_guardian）
     ▼
(backend)   archive：ArchiveService 归档 + distill-knowledge（沉淀到 knowledge 模块）
            目录 changes/<key>/ → changes/archive/<key>/，stage=archived
```

quick 变更（`StageEnum.QUICK`）走精简路径：跳过 brainstorm/plan，直接 execute + verify。

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| 缺产出物（如 plan.md） | spec_guardian 拒迁移，返回缺哪些文件 |
| 非法迁移（跳阶段） | FSM TransitionError，409 |
| 自动修复超限 | status=blocked，需人工介入后人工迁移 |
| 执行阶段任务失败 | 任务状态 failed，变更停留 execute，不自动归档 |
| 归档冲突 | archive 拒覆盖，需用户确认 |

## 关键术语
- **StageEnum**：scan/brainstorm/propose/plan/execute/verify/archive/quick
- **ChangeStatus**：draft + need_* 等待态 + blocked
- **TRANSITIONS**：合法阶段迁移邻接表（`change.model`）
- **spec_guardian**：迁移前产出物存在性/一致性校验器
