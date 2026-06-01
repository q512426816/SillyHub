---
author: hermes
created_at: "2026-05-31T16:05:00Z"
---

# 设计方案：Stage-Driven Agent Dispatch

## 1. 架构概述

在 `ChangeService.transition()` 方法中插入一个异步 hook，transition 成功后根据目标阶段查找 Agent 派发配置，异步启动 Claude Code Agent。

```
transition() → update DB → commit → async dispatch_agent_if_needed()
                                       ├─ find config for target_stage
                                       ├─ check no active run exists
                                       ├─ auto-create worktree lease
                                       └─ AgentService.start_run() → background
```

## 2. 阶段→Agent 配置表

```python
STAGE_AGENT_CONFIG: dict[str, StageAgentConfig] = {
    "clarifying": StageAgentConfig(
        enabled=True,
        prompt_template="clarifying",
        phase="clarify",
        requires_worktree=False,  # 只读操作
    ),
    "design_review": StageAgentConfig(
        enabled=True,
        prompt_template="design_review",
        phase="design",
        requires_worktree=False,
    ),
    "ready_for_dev": StageAgentConfig(
        enabled=True,
        prompt_template="plan_tasks",
        phase="plan",
        requires_worktree=False,
    ),
    "in_dev": StageAgentConfig(
        enabled=True,
        prompt_template="execute_task",
        phase="execute",
        requires_worktree=True,
    ),
    "technical_verification": StageAgentConfig(
        enabled=True,
        prompt_template="verify",
        phase="verify",
        requires_worktree=True,
    ),
    "business_review": StageAgentConfig(
        enabled=True,
        prompt_template="review",
        phase="review",
        requires_worktree=False,
    ),
}
```

## 3. 核心组件

### 3.1 StageAgentConfig 数据类

```python
@dataclass
class StageAgentConfig:
    enabled: bool
    prompt_template: str       # 对应 prompts/ 下的模板文件名
    phase: str                # Agent 工作的阶段标识
    requires_worktree: bool   # 是否需要创建 worktree lease（写操作需要）
```

### 3.2 AgentDispatchService

新服务，负责：
- 检查 change 是否有正在运行的 agent（防重复派发）
- 根据 target_stage 查找配置
- 如果需要 worktree，自动创建 lease
- 调用 `AgentService.start_run()`
- 记录 dispatch 事件

### 3.3 Prompt 模板

每个阶段的 prompt 模板存放在 `backend/app/modules/change/prompts/` 目录：
- `clarifying.md` — 分析需求，生成澄清问题
- `design_review.md` — 生成设计评审文档
- `plan_tasks.md` — 拆分 task 列表
- `execute_task.md` — 执行单个 task
- `verify.md` — 运行测试验证
- `review.md` — 生成验收报告

## 4. 不触发 Agent 的阶段

- `draft` — 初始阶段
- `rework_required` — 等待人工处理
- `accepted` — 终态
- `archived` — 已归档

## 5. 并发控制

- 同一 change 同一时间只允许一个 agent run
- 检查 `AgentRun` 表中 `status in ("pending", "running")` 的记录
- 如果已有运行中的 agent，transition 成功但不派发，返回警告

## 6. 错误处理

- Agent 派发失败（lease 创建失败、agent 启动失败）不影响 transition 结果
- 记录错误日志，通过 SSE 通知前端
- 前端显示 "Agent 启动失败" 状态，允许手动重试

## 7. 前端变化

- Change 详情页显示当前 Agent 运行状态（pending/running/done/failed）
- 利用已有的 `EventSource` 订阅 agent run 日志流
- 新增 "重新派发 Agent" 按钮用于手动重试

## 8. 文件结构

```
backend/app/modules/change/
├── dispatch.py          # NEW: AgentDispatchService
├── prompts/             # NEW: prompt 模板目录
│   ├── clarifying.md
│   ├── design_review.md
│   ├── plan_tasks.md
│   ├── execute_task.md
│   ├── verify.md
│   └── review.md
├── service.py           # MODIFY: transition() 后调用 dispatch
└── router.py            # MODIFY: 新增手动 dispatch API
```

## 9. 与现有 AgentService 的集成

当前 `AgentService.start_run()` 需要 `task_id` + `lease_id`。对于只读阶段（clarifying/design_review/plan_tasks/business_review），我们有两种选择：

**方案 A（推荐）**：扩展现有接口，添加 `change_dispatch` 模式
- 新增 `start_stage_dispatch()` 方法，接受 change_id + stage，不需要 task_id
- 内部自动处理 lease 创建（或跳过只读阶段）
- Prompt 基于 change 上下文 + stage 模板构建

**方案 B**：每个阶段自动创建对应的 task 记录
- transition 后创建 "stage-<name>" 类型的 task
- 复用现有 `start_run()` 流程
- 缺点：增加大量临时 task 记录，污染 task 列表

选择 **方案 A**，更干净。
