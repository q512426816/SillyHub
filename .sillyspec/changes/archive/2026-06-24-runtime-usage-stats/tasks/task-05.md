---
id: task-05
title: AgentRun 模型加 cache_read_tokens/cache_creation_tokens(int|None)
priority: P1
estimated_hours: 1
depends_on: [task-04]
blocks: [task-06, task-07, task-08]
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - backend/app/modules/agent/model.py
author: qinyi
created_at: 2026-06-24 10:55:18
---
# task-05: AgentRun 模型加 cache_read_tokens/cache_creation_tokens(int|None)

## 修改文件（必填）

- `backend/app/modules/agent/model.py`(仅 `AgentRun` 类,在 `output_tokens` 字段后新增两字段)

## 覆盖来源

- Requirements: FR-02(ORM 层暴露 cache 列,供 service/run_sync 读写)
- design.md §8 数据模型(SQLModel 字段)
- plan.md Wave 2 task-05

## 实现要求

1. 在 `AgentRun` 类的「Usage / cost tracking fields」区段(`input_tokens`/`output_tokens` 之后,`post_scan_status` 区段之前)新增两个字段。
2. 字段写法严格对齐 `input_tokens`/`output_tokens`(model.py:210-217):
   - 类型注解 `int | None`
   - `Field(default=None, sa_column=Column(Integer, nullable=True))`
3. 带注释说明语义:`cache_read_tokens` = 命中 prompt cache 读取的词元数;`cache_creation_tokens` = 写入 prompt cache 的词元数(Anthropic `cache_read_input_tokens`/`cache_creation_input_tokens` 映射)。nullable=True 对齐 task-04 迁移(codex 等无 cache 的 runtime 为 NULL,D-001@v1)。
4. 字段顺序与 task-04 migration 列顺序一致(`cache_read_tokens` 在前,`cache_creation_tokens` 在后),便于阅读时与 DDL 对照。
5. 不修改任何其他字段定义,不动 `__table_args__` 索引列表。

## 接口定义（代码类必填）

```python
# backend/app/modules/agent/model.py — AgentRun 类内(input_tokens/output_tokens 之后)

    input_tokens: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    output_tokens: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    # ── Cache token tracking (prompt cache read/creation; 2026-06-24-runtime-usage-stats) ──
    # Claude(Anthropic)有 cache_creation_input_tokens / cache_read_input_tokens;
    # codex/OpenAI 系无 cache,对应 NULL(D-001@v1)。nullable 对齐 task-04 迁移。
    cache_read_tokens: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    cache_creation_tokens: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
```

字段语义对照:
| 模型字段 | DB 列(task-04) | 上游来源 |
|---|---|---|
| `cache_read_tokens: int \| None` | `cache_read_tokens INTEGER NULL` | Claude `usage.cache_read_input_tokens` / ndjson `tokens.cache.read` |
| `cache_creation_tokens: int \| None` | `cache_creation_tokens INTEGER NULL` | Claude `usage.cache_creation_input_tokens` / ndjson `tokens.cache.write` |

## 边界处理（必填,至少5条）

1. **null 行为(老数据 NULL)**:`default=None` + `nullable=True`,新建的 AgentRun 不显式赋值时该字段为 None,与 DB NULL 一致。读取时聚合层用 `COALESCE`,本层不做默认 0。
2. **brownfield 兼容(老 daemon 不传 cache)**:模型层只声明字段,不强制要求 setter 写入。task-06/07 在 service/run_sync 中用 "取到非 None 才赋值" 守卫,不写则保持 None。模型本身对此透明。
3. **异常不静默**:字段类型 `int | None`,若上游误传字符串类型会在 commit 时由 SQLAlchemy 触发类型校验/DB 错误,模型层不吞异常。SQLModel 的 Field 校验在运行时也会 raise `ValidationError`。
4. **不改入参**:不修改 `input_tokens`/`output_tokens`/`total_cost_usd` 任何既有字段的类型/默认值/sa_column。仅新增两字段。
5. **迁移可回退**:模型字段与 task-04 migration 列 1:1 对应。若回退 task-04(downgrade drop 两列),需同步回退本任务(删除两 Field 定义),否则 SQLModel `table=True` 会因 DB 缺列在 select 时报错。模型↔DDL 强一致。
6. **字段顺序**:新增字段放在 `output_tokens` 之后(`post_scan_status` 区段之前),保持「usage/cost 字段聚集」可读性,不混入多 agent orchestration 区段。
7. **跨平台**:纯 ORM 字段声明,无平台差异(CLAUDE.md 规则 12)。

## 非目标

- 不写 migration(已由 task-04 完成)。
- 不写 service `_METADATA_FIELDS`(task-06 负责 batch 路径)。
- 不写 run_sync 解析(task-07 负责 interactive 路径)。
- 不动 `AgentRunResponse` schema 序列化字段(聚合接口走独立 schema,task-09 负责)。
- 不加索引(无按 cache 过滞性能需求)。

## 参考

- `backend/app/modules/agent/model.py:210-217`(input_tokens/output_tokens,1:1 复制 Field+sa_column 模式)
- `backend/app/modules/agent/model.py:174-217`(Usage / cost tracking fields 区段注释风格)
- task-04 migration(列名/类型/nullable 严格对应)
- design.md §8 数据模型、§9 兼容策略

## TDD 步骤

1. model 层字段声明无独立单测,以 mypy 类型检查 + 与 task-04 列一致性为验收。
2. 写实现前先确认 task-04 已 merge(否则 mypy 通过但运行时 select AgentRun 报缺列)。
3. 改完跑 `cd backend && uv run mypy app/modules/agent/model.py` 看类型通过。
4. 跑 `cd backend && uv run python -c "from app.modules.agent.model import AgentRun; r=AgentRun(agent_type='claude_code'); print(r.cache_read_tokens, r.cache_creation_tokens)"` 确认默认 None。
5. 赋值后确认可读:`r.cache_read_tokens = 100; assert r.cache_read_tokens == 100`。
6. 确认列定义:`uv run python -c "from app.modules.agent.model import AgentRun; c=AgentRun.__table__.c; print(c.cache_read_tokens.nullable, c.cache_creation_tokens.nullable)"` 输出 `True True`。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `cd backend && uv run mypy app/modules/agent/model.py` | 无错误,`int \| None` 类型校验通过 |
| 2 | `cd backend && uv run python -c "from app.modules.agent.model import AgentRun; r=AgentRun(agent_type='claude_code'); assert r.cache_read_tokens is None and r.cache_creation_tokens is None"` | 默认 None,无报错 |
| 3 | `cd backend && uv run python -c "from app.modules.agent.model import AgentRun; c=AgentRun.__table__.c; assert c.cache_read_tokens.nullable and c.cache_creation_tokens.nullable; assert 'cache_read_tokens' in AgentRun.model_fields"` | ORM 列 nullable=True,model_fields 包含两字段 |
| 4 | 对照 task-04 migration:列名/类型(Integer)/nullable(True) 一致 | 列名 `cache_read_tokens`/`cache_creation_tokens`,类型一致 |
| 5 | `cd backend && uv run pytest tests/modules/agent/ -q`(若已有 model 相关测试) | 现有测试不被破坏(无字段引用冲突) |
| 6 | 检查未误改其他字段:diff 仅新增两 Field 定义 | output_tokens 等既有字段无 diff |
