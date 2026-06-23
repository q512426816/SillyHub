---
author: qinyi
created_at: 2026-06-24T01:50:01
source_commit: ba87eec
---

# change-lifecycle

## 目标
管理 SillySpec 变更从草稿到归档的完整生命周期，驱动文档与代码一致演进。

## 参与模块
- **backend/change**：变更主实体、阶段枚举、状态转换表（`app/modules/change/model.py` 的 `StageEnum` / 转换 map）
- **backend/workflow**：转换校验、`spec_guardian` 文档完整性检查、审计日志
- **backend/task**：变更下任务（Wave/Task）追踪
- **backend/agent**：各阶段 AgentRun 调度（brainstorm/plan/execute/verify/archive）
- **backend/change_writer**：Agent 驱动的文档/代码写入
- **frontend**：变更详情页、阶段按钮、进度展示
- **sillyspec**：CLI 触发、进度同步、知识库沉淀

## 流程摘要
```text
用户创建变更 (status=DRAFT)
  [backend/change]
        │ transition: DRAFT → SCAN / BRAINSTORM (agent)
        ▼
  SCAN          ← 扫描项目生成架构文档
  BRAINSTORM    ← Agent 生成 proposal.md
  PROPOSE       ← reviewer/agent 审核；不通过回 BRAINSTORM
  PLAN          ← Agent 生成 plan.md（Wave+Task）
  EXECUTE       ← Agent 按 plan 写代码，task: pending→in_progress→completed
  VERIFY        ← 对照 design/plan 验收
        │ 通过: → ARCHIVE   不通过: → BLOCKED (回 PROPOSE/PLAN/EXECUTE)
        ▼
  ARCHIVE       ← reviewer/agent 触发；模块影响分析 + 知识库沉淀
        │ system
        ▼
  ARCHIVED (终态)
```
> 转换表见 `change/model.py:85` 的 `TRANSITION`；`QUICK` 是 SillySpec 快速通道入口（VERIFY ↔ QUICK/BLOCKED）。
> `BLOCKED` 可被 reviewer 解封到 PROPOSE/PLAN/EXECUTE。

## 失败回滚
| 失败点 | 处理 |
|--------|------|
| brainstorm/plan 文档缺失 | workflow.spec_guardian 拦截，阻断转换 |
| propose 审核 (need_plan_review) 不通过 | reviewer 回退到 BRAINSTORM |
| execute 任务失败 | task 标记 failed，保留已完成项 |
| verify 不通过 | VERIFY → BLOCKED，reviewer 决定回退阶段 |
| Agent 执行崩溃 | AgentRun failed，可重新调度 |
