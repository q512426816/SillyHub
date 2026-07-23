---
id: task-04
title: AgentRun 加 gate_result JSON + gate_status str 列 + Alembic migration（down_revision=419d34f8e33f）
title_zh: AgentRun gate 列与 migration
author: qinyi
created_at: 2026-07-10 14:49:30
priority: P0
depends_on: []
blocks: [task-05, task-07, task-08, task-10, task-12]
requirement_ids: [FR-1, FR-2]
decision_ids: []
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/
provides:
  - contract: AgentRun.gate_fields
    fields: [gate_result, gate_status, exit_code, errors, raw_envelope]
expects_from: {}
---

## 目标（design §5.4 / §8）

为 AgentRun 增加两个可空列承载客观 gate 核验结果，供 task-07 写入、task-08 读取决策。Wave 1 基础设施，无前置依赖，可与 task-01/02/03 并行。

## 改动一：model.py 加两列（参照 checkpoint_data:148 / post_scan_status:233 现有模式）

在 `agent/model.py` AgentRun 类内（建议置于 `post_scan_status` 区块附近，与 stage 验证语义聚集）新增：

```python
# ── Driver Gate (P3 pilot) ── gate 客观核验结果与状态（design §8）
gate_status: str | None = Field(
    default=None,
    sa_column=Column(String(20), nullable=True),
)  # pending / running / decided / failed
gate_result: dict | None = Field(
    default=None,
    sa_column=Column(JSON, nullable=True),
)  # {exit_code: int, errors: list[str], raw_envelope: dict}
```

照现有 `Field(sa_column=Column(...))` + `default=None` + nullable=True 模式，与 checkpoint_data / conversation_events 完全对齐。不改 AgentRun 其他列、不动 `__table_args__` 索引（gate 列无查询索引需求，task-08 走主键取行）。

## 改动二：新 migration 文件

新建 `backend/migrations/versions/<新 uuid revision>.py`，风格对齐 `419d34f8e33f_add_change_workspace_to_agent_sessions.py`（顶部 docstring + author/created_at + `revision/down_revision/branch_labels/depends_on` 模块级变量）：

- `revision` = 新生成 uuid（`python -c "import uuid;print(uuid.uuid4().hex[:12])"`）
- `down_revision = "419d34f8e33f"`（plan 前置条件已确认 main 唯一 head；开工仍跑 `alembic heads` 复核，R8 应对）
- `upgrade()`：`op.add_column("agent_runs", sa.Column("gate_status", sa.String(20), nullable=True))` + `op.add_column("agent_runs", sa.Column("gate_result", sa.JSON(), nullable=True))`
- `downgrade()`：反向 `op.drop_column`（先 gate_result 后 gate_status，顺序无关但保持一致）

docstring 说明：P3 driver gate pilot，两列 nullable 保证老 agent_run 行兼容（brownfield，design §9）。author: qinyi，created_at: 2026-07-10。

## 实现要点

- 两列都 `nullable=True` 默认 None —— 老 agent_run 无值（design §9 兼容策略）；非 verify stage task-08 fallback 当前声明态，verify stage 强制 gate（task-08 实现）
- `gate_result` 用 JSON 列存 dict（结构 `{exit_code:int, errors:list[str], raw_envelope:dict}`，由 task-06 `_read_gate_result` 产出）；model 层只定义容器不约束内部 schema
- `gate_status` String(20)：pending(7)/running(7)/decided(7)/failed(6) 最长 7 字符，20 够用且留余量
- 纯增量、可独立回退：删两列 / `alembic downgrade` 即恢复原状
- 复核 main 当前无其他并行 migration 抢 419d34f8e33f 作 down_revision（避免 [[migration-chain-fragmentation-pattern]] 再现）

## acceptance

- [ ] 两列 nullable 默认 None，老 agent_run 行无值（select 不报错）
- [ ] `alembic upgrade head` 本地 SQLite 干净（无报错，新列出现在 PRAGMA）
- [ ] `alembic downgrade -1` 干净（两列消失）
- [ ] 生产 PG 兼容（JSON → jsonb 隐式，String(20) → VARCHAR(20)，dialect 无关 add_column）
- [ ] 不改动 AgentRun 其他列定义

## verify

```bash
cd backend
uv run alembic heads          # 复核唯一 head=419d34f8e33f（R8）
uv run alembic upgrade head   # 含新 migration
uv run pytest -k agent_run    # 不破坏现有 AgentRun 测试
uv run mypy app               # 类型绿
```

## constraints

brownfield 兼容：列可空、老行无值；纯增量可独立回退（migration down）；不改动 AgentRun 其他列。

## 关联

design §5.4 决策+数据模型、§8 数据模型（列定义表）、§9 兼容策略（brownfield）、§10 R8（migration 多 head）。blocks task-05（close 写 gate_status=pending）、task-07（写 gate_result/decided）、task-08（读 gate_result 决策）、task-10（reconcile 重置孤儿）、task-12（前端读 gate_status）。
