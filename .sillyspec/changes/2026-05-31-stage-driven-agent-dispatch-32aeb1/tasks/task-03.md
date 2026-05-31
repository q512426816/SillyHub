---
author: hermes
created_at: "2026-05-31T16:30:00Z"
---

# Task 03: 扩展 AgentRun + AgentService.start_stage_dispatch()

## 目标

让 AgentService 支持 change-level 的 agent 派发（不需要 task_id）。

## 实现细节

### 3.1 AgentRun 模型新增 change_id 字段

在 `backend/app/modules/agent/model.py` 的 AgentRun 类中添加:
```python
change_id: uuid.UUID | None = Field(
    default=None,
    sa_column=Column(
        Uuid(as_uuid=True),
        ForeignKey("changes.id", ondelete="CASCADE"),
        nullable=True,
    ),
)
```

### 3.2 Alembic Migration

创建迁移 `xxxx_add_agent_run_change_id.py`:
- `op.add_column("agent_runs", sa.Column("change_id", ...))`
- 添加索引 `ix_agent_runs_change`

### 3.3 AgentService.start_stage_dispatch()

在 `backend/app/modules/agent/service.py` 新增方法:
```python
async def start_stage_dispatch(
    self,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    user_id: uuid.UUID,
    stage: str,
    prompt_template: str,
    *,
    requires_worktree: bool = False,
) -> AgentRun:
```

逻辑:
1. 如果 `requires_worktree=True`:
   - 通过 WorktreeService 创建 lease
   - branch name: `sillyspec/<change_key>-agent-<stage>`
   - 使用 workspace 的 spec_root 作为基础
2. 加载 prompt 模板，渲染 change 上下文
3. 创建 AgentRun 记录（change_id 填充，task_id 为 None）
4. 写入 CLAUDE.md 到 lease 路径（或使用临时目录）
5. 启动 agent 执行

### 3.4 更新并发检查

`AgentDispatchService.has_active_run()` 改为直接查询 AgentRun 表:
```python
stmt = select(AgentRun).where(
    col(AgentRun.change_id) == change_id,
    col(AgentRun.status).in_(["pending", "running"]),
)
```

## 验证

- Migration 正常应用
- AgentRun 可以不关联 task，直接关联 change
- start_stage_dispatch() 可以创建无 task 的 agent run
- 并发检查通过 change_id 直接查询
