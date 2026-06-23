---
author: qinyi
created_at: 2026-06-24T01:50:01
source_commit: ba87eec
---

# SillySpec 变更工作流

## 目标
文档驱动的完整变更生命周期：草稿 → SillySpec 主线（scan/brainstorm/propose/plan/execute/verify）→ 归档。

## 参与模块
- **backend/change**：状态机（`StageEnum` + `TRANSITION` map，`app/modules/change/model.py`）
- **backend/workflow**：转换权限（agent/reviewer/system）、`spec_guardian` 文档校验、审计
- **backend/agent**：阶段转换后自动触发 AgentRun
- **backend/change_writer / task**：文档写入、Wave/Task 追踪
- **backend/knowledge / archive**：归档时知识库沉淀
- **sillyspec (CLI)**：`brainstorm/plan/execute/verify/quick/archive` 触发与进度同步
- **frontend**：变更详情、阶段按钮、`useSillySpec` 流程驱动

## 流程摘要
```text
[backend/change]          [sillyspec CLI]
    DRAFT ────────────  propose / scan / brainstorm 入口
      │ transition: DRAFT→{SCAN,BRAINSTORM}  [agent]
      ▼
    SCAN ──agent──► BRAINSTORM ──agent──► PROPOSE
                                         │ reviewer/agent 通过→PLAN
                                         │ reviewer 否决→BRAINSTORM
                                         ▼
    PLAN ──reviewer/agent──► EXECUTE ──agent──► VERIFY
      ▲ (reviewer 回退)                       │ agent 通过→ARCHIVE
      │                                       │ reviewer 否决→PROPOSE (doc_mismatch)
      │                                       │ agent 阻塞→BLOCKED
      └──────── BLOCKED ◄─────────────────────┘
                       │ reviewer 解封→{PROPOSE,PLAN,EXECUTE}
    ARCHIVE ──system──► ARCHIVED (终态)

  QUICK 旁路入口: ─► VERIFY ─► {QUICK,BLOCKED} (SillySpec 快速通道)
```

## 各阶段产物
| 阶段 | 产物 | 转换触发角色 |
|------|------|--------------|
| SCAN | ARCHITECTURE.md / CONVENTIONS.md / module-map | agent |
| BRAINSTORM | proposal.md（初稿） | agent |
| PROPOSE | proposal.md（终稿） | reviewer/agent |
| PLAN | plan.md（Wave+Task） | reviewer/agent |
| EXECUTE | 代码实现、task 进度 | agent |
| VERIFY | 验收报告 | reviewer/agent |
| ARCHIVE | module-impact、知识库条目 | system |

## 失败回滚
| 失败点 | 处理 |
|--------|------|
| 文档不完整 | workflow.spec_guardian 拦截转换 |
| propose/plan 审核不通过 | reviewer 回退（PROPOSE→BRAINSTORM / PLAN→PROPOSE） |
| verify 验收失败 | VERIFY → BLOCKED，reviewer 决定回退阶段 |
| doc_mismatch | VERIFY → PROPOSE（人工测试回退） |
| Agent 崩溃 | AgentRun failed，手动重新调度 |

## 关键术语
- **StageEnum**：DRAFT/SCAN/BRAINSTORM/PROPOSE/PLAN/EXECUTE/VERIFY/ARCHIVE/QUICK/BLOCKED/ARCHIVED
- **TRANSITION map**：阶段→{目标阶段:[允许角色]} 的转换表
- **spec_guardian**：转换前校验目标阶段所需文档是否齐备
