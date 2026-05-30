---
author: qinyi
created_at: 2026-05-30T23:17:00
---

# Design — Execution Coordinator 执行可靠性保证

## 架构决策

### AD-1: AgentRun 字段扩展（轻量方案）
- **决策**：在 AgentRun 模型上新增 6 个可 NULL 字段，不新建独立表
- **理由**：6 个能力点高度内聚，共享同一模型；所有字段可 NULL，向后兼容；checkpoint 数据量小（JSONB 快照 < 64KB），不需要独立表
- **Trade-off**：AgentRun 模型变宽，但新增字段都是轻量类型（str/int），影响可忽略

### AD-2: ExecutionCoordinatorService 分层
- **决策**：新建 `ExecutionCoordinatorService` 封装所有可靠性逻辑，现有 `AgentService` 调用它
- **理由**：单一职责；AgentService 专注执行流程，Coordinator 专注可靠性保证；便于测试
- **Trade-off**：多一层调用，但逻辑清晰度大幅提升

### AD-3: Optimistic Lock 基于 version 字段
- **决策**：使用 SQLModel 的 `version` 整数字段 + UPDATE WHERE version = expected 模式
- **理由**：实现简单、无额外依赖、与 SQLModel/SQLAlchemy 兼容
- **Trade-off**：需要在每次 UPDATE 时手动检查 affected_rows == 1

### AD-4: Checkpoint 数据存储在 AgentRun JSON 列
- **决策**：AgentRun 新增 `checkpoint_data: dict | None = Field(default=None, sa_column=Column(JSONB))` 存储快照
- **理由**：checkpoint 与 AgentRun 1:1 关系（最新快照），不需要独立表；JSONB 支持灵活结构
- **Trade-off**：只保留最新快照，历史快照不保留（符合"未上线，数据可清"原则）

### AD-5: Context Fingerprint 使用 SHA-256
- **决策**：对 AgentSpecBundle 的关键字段（proposal + design + plan + task_content）计算 SHA-256 哈希
- **理由**：SHA-256 碰撞概率可忽略、计算快速、输出固定 64 字符
- **Trade-off**：文档微小改动也会导致 fingerprint 变化，但这是期望行为（提示用户上下文已变更）

### AD-6: Approval Token 流程
- **决策**：AgentRun 进入 `pending_approval` 状态时生成 approval_token，前端需回传 token 才能继续执行
- **理由**：token 是一次性的，使用后失效；与现有 FSM 兼容
- **Trade-off**：需要前端配合实现审批 UI，但后端逻辑先行

## 文件变更清单

### 新增文件
| 文件 | 说明 |
|------|------|
| `app/modules/agent/coordinator.py` | ExecutionCoordinatorService 可靠性保证服务 |
| `app/modules/agent/coordinator_schema.py` | Coordinator API schemas（ResumeRequest, ApproveRequest 等） |
| `migrations/versions/xxx_add_execution_coordinator_fields.py` | Alembic 迁移 |
| `tests/modules/agent/test_coordinator.py` | Coordinator 测试套件 |

### 修改文件
| 文件 | 变更 |
|------|------|
| `app/modules/agent/model.py` | AgentRun 新增 6 个字段 + checkpoint_data JSONB |
| `app/modules/agent/schema.py` | AgentRunCreate 新增 idempotency_key 参数 |
| `app/modules/agent/router.py` | 新增 resume / approve 端点 |
| `app/modules/agent/service.py` | start_run 集成幂等检查 + context fingerprint + coordinator 调用 |
| `app/modules/agent/context_builder.py` | 新增 fingerprint 计算方法 |

## 数据模型

### 修改表: agent_runs

```sql
ALTER TABLE agent_runs ADD COLUMN idempotency_key VARCHAR(64);
ALTER TABLE agent_runs ADD COLUMN resume_token VARCHAR(64);
ALTER TABLE agent_runs ADD COLUMN checkpoint_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agent_runs ADD COLUMN approval_token VARCHAR(64);
ALTER TABLE agent_runs ADD COLUMN context_fingerprint VARCHAR(64);
ALTER TABLE agent_runs ADD COLUMN checkpoint_data JSONB;
ALTER TABLE agent_runs ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3;
ALTER TABLE agent_runs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX ix_agent_runs_idempotency_key ON agent_runs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_agent_runs_resume_token ON agent_runs(resume_token) WHERE resume_token IS NOT NULL;
CREATE INDEX ix_agent_runs_context_fingerprint ON agent_runs(context_fingerprint) WHERE context_fingerprint IS NOT NULL;
```

## API 设计

### 现有端点扩展

```
POST /api/workspaces/{ws_id}/agent/runs
  Request: { ..., idempotency_key?: string }
  → 如果 idempotency_key 已存在，返回已有 AgentRun（200）
  → 如果不存在，正常创建（201）
```

### 新增端点

```
POST /api/workspaces/{ws_id}/agent/runs/{run_id}/resume
  Request: { resume_token: string, context_fingerprint?: string }
  Response: AgentRunRead（状态恢复为 pending → running）
  → 校验 resume_token 匹配
  → 可选校验 context_fingerprint

POST /api/workspaces/{ws_id}/agent/runs/{run_id}/approve
  Request: { approval_token: string }
  Response: AgentRunRead（状态从 pending_approval → running）
  → 校验 approval_token 匹配
  → token 使用后置 NULL（一次性）

GET /api/workspaces/{ws_id}/agent/runs/{run_id}/checkpoint
  Response: { version: int, data: dict, created_at: datetime }
  → 返回最新 checkpoint 数据

POST /api/workspaces/{ws_id}/agent/runs/{run_id}/checkpoint
  Request: { data: dict }
  Response: { version: int, created_at: datetime }
  → 保存 checkpoint（递增 version）
```

## ExecutionCoordinatorService 设计

```python
class ExecutionCoordinatorService:
    """执行可靠性保证服务 — 封装 6 个能力点"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def check_idempotency(self, key: str) -> AgentRun | None:
        """幂等检查：相同 key 返回已有 AgentRun"""

    async def compute_fingerprint(self, bundle: AgentSpecBundle) -> str:
        """计算上下文 SHA-256 指纹"""

    async def validate_fingerprint(self, run_id: UUID, fingerprint: str) -> bool:
        """校验上下文指纹是否匹配"""

    async def generate_resume_token(self, run: AgentRun) -> str:
        """生成 resume_token 并保存"""

    async def resume_run(self, run_id: UUID, resume_token: str) -> AgentRun:
        """恢复中断的执行"""

    async def save_checkpoint(self, run_id: UUID, data: dict, expected_version: int) -> int:
        """保存 checkpoint（带 optimistic lock）"""

    async def load_checkpoint(self, run_id: UUID) -> dict | None:
        """加载最新 checkpoint"""

    async def update_with_lock(self, run_id: UUID, expected_version: int, **updates) -> AgentRun:
        """乐观锁更新 AgentRun"""

    async def request_approval(self, run_id: UUID) -> str:
        """生成 approval_token，将 AgentRun 设为 pending_approval"""

    async def approve(self, run_id: UUID, token: str) -> AgentRun:
        """校验 approval_token，恢复执行"""
```

## 与现有模块的交互

```
AgentService.start_run()
  ├── → coordinator.check_idempotency()    # 幂等检查
  ├── → context_builder.compute_fingerprint()  # 计算指纹
  ├── → coordinator.generate_resume_token()    # 生成恢复令牌
  └── → 正常执行流程（adapter.run_with_bundle）

AgentService.kill_run()
  └── → coordinator.save_checkpoint()     # 终止前保存快照

Workflow Hooks (可选)
  └── → coordinator.validate_fingerprint()  # 审计时校验上下文一致性
```

## 兼容策略

- 所有新字段均可 NULL / 有默认值 → 现有 AgentRun 无需数据迁移
- 现有 API 不变更，只新增参数和端点
- idempotency_key 为可选参数，不传时跳过幂等检查
- resume_token 仅在执行中断（failed/killed）后生成
- approval_token 仅在高风险操作时生成（由 tool_gateway policy 触发）

## 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Optimistic lock 冲突频繁 | 低 | 中 | 冲突时返回 409 + 当前版本，让客户端重试 |
| Checkpoint 数据过大 | 低 | 低 | 限制 JSONB < 64KB，超限截断 |
| Fingerprint 误报（微小改动） | 中 | 低 | 提供强制跳过指纹校验的参数 |
| Resume 后上下文已变 | 中 | 中 | resume 时可选校验 fingerprint |

## 自审

- ✅ 不修改 workflow FSM 定义（保持 Change/Task 状态机不变）
- ✅ 不修改 tool_gateway 模块（审批 token 由 coordinator 管理）
- ✅ 所有新字段可 NULL → 向后兼容
- ✅ 遵循 feature-slice 约定（coordinator 在 agent 模块内）
- ✅ 测试覆盖 6 个能力点的正向 + 异常场景
