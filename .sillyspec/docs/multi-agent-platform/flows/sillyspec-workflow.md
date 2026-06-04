---
author: qinyi
created_at: 2026-06-04T10:00:00+08:00
---

# SillySpec 变更工作流

## 目标
文档驱动的完整变更生命周期，从需求到归档的全流程管理。

## 参与模块
- **backend/change**：变更状态机、阶段转换、文档管理
- **backend/workflow**：状态转换验证、审计日志
- **backend/agent**：各阶段 Agent 自动调度
- **backend/change_writer**：文档写入操作
- **frontend**：变更详情、阶段按钮、进度展示
- **sillyspec**：CLI 触发、进度同步、知识库沉淀

## 流程摘要

```text
┌──────────────┐
│    DRAFT      │ ← Hub 业务阶段（手动创建）
│   (草稿)      │
└──────┬───────┘
       │
       ├─→ PROPOSE ─┐
       │  (提案)     │
       │            │
       └─→ QUICK ───┤  ← SillySpec 入口
                   (快速通道)    │
       ┌─→ SCAN ────┘   (扫描)
       │  (扫描)
       ▼
┌──────────────┐
│  BRAINSTORM  │
│  (头脑风暴)  │
└──────┬───────┘
       │ Agent 生成 proposal.md
       ▼
┌──────────────┐
│   PROPOSE    │
│   (提案)      │
└──────┬───────┘
       │ 人工审核 / Agent 审核通过
       ▼
┌──────────────┐
│    PLAN      │
│   (计划)      │
└──────┬───────┘
       │ Agent 生成 plan.md (Wave + Task)
       ▼
┌──────────────┐
│   EXECUTE    │
│   (执行)      │
└──────┬───────┘
       │ Agent 按 plan 逐步实现
       │ (可能多次 progress updates)
       ▼
┌──────────────┐
│   VERIFY     │
│   (验证)      │
└──────┬───────┘
       │ 对照 design/plan 验收
       ▼
┌──────────────┐      ┌─────────────────┐
│   ACCEPTED   │ ←─── │  REWORK_REQUIRED │
│   (已接受)    │      │   (需返工)        │
└──────┬───────┘      └────────┬─────────┘
       │                        │ (返工后回到 EXECUTE)
       ▼
┌──────────────┐
│   ARCHIVE    │
│   (归档)      │
└──────┬───────┘
       │ 模块影响分析 + 知识库沉淀
       ▼
    ┌─────────┐
    │  DONE   │
    └─────────┘
```

## 各阶段产物

| 阶段 | 产物文档 | Agent 角色 |
|------|----------|------------|
| SCAN | ARCHITECTURE.md, CONVENTIONS.md, _module-map.yaml | 扫描项目 |
| BRAINSTORM | proposal.md（初始） | 分析需求、提出方案 |
| PROPOSE | proposal.md（最终） | 审核补充方案 |
| PLAN | plan.md（Wave + Task 列表） | 拆解任务 |
| EXECUTE | 代码实现、进度更新 | 执行编码 |
| VERIFY | 验收报告 | 对照文档检查 |
| ARCHIVE | module-impact.md, 知识库条目 | 影响分析、沉淀知识 |

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| PROPOSE 审核不通过 | → BRAINSTORM（补充方案） |
| PLAN 审核不通过 | → PROPOSE（方案调整） |
| VERIFY 验收失败 | → REWORK_REQUIRED → EXECUTE（返工） |
| Agent 执行崩溃 | 手动介入，可继续当前阶段或回退 |

## 关键术语
- **Change**：变更实体，包含阶段、文档、任务
- **Stage**：工作流阶段（SillySpec 8 主阶段 + Hub 3 扩展）
- **Worktree**：Git 工作树，隔离式分支开发
- **AgentDispatch**：阶段转换后自动触发 Agent 执行
