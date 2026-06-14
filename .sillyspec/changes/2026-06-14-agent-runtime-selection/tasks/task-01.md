---
author: qinyi
created_at: 2026-06-14T22:04:34
id: task-01
title: 数据模型 + Alembic 迁移：Workspace.default_agent 列
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-03, task-04]
allowed_paths:
  - backend/app/modules/workspace/model.py
  - backend/app/migrations/versions/202606141200_add_workspace_default_agent.py
---

# task-01: 数据模型 + Alembic 迁移：Workspace.default_agent 列

## 上下文
本变更为 `Workspace` 增加工作空间级默认 agent（provider 名），让分发链路在用户未显式指定时有一个可复现的选择。本任务是所有后端解析逻辑的基石——service 三入口要读这个列（task-03），schema 要暴露它（task-04）。

## 修改文件（必填）
- `backend/app/modules/workspace/model.py` — `Workspace` 类增 `default_agent` 列
- `backend/app/migrations/versions/202606141200_add_workspace_default_agent.py` — 新增 Alembic 迁移

## 实现要求
1. **model.py**：在 `Workspace` 类内（参考现有 `default_branch` 字段风格，约 model.py 中 `default_branch: str | None = Field(default="main", sa_column=Column(String(100), nullable=True))`）新增：
   ```python
   default_agent: str | None = Field(
       default=None, sa_column=Column(String(64), nullable=True)
   )
   ```
   放在 `default_branch` 附近，保持字段聚类（component/git 元数据区）。
2. **迁移文件** `202606141200_add_workspace_default_agent.py`：
   - `revision = "202606141200"`（若该 revision id 已被占用，execute 时改为不冲突的值；命名前缀 `202606141200_` 保留）。
   - `down_revision` = 当前 alembic head（**execute 时先 `cd backend && uv run alembic heads` 确认实际 head**，调研显示最新文件为 `202606270900_create_daemon_tables`，但以实际 head revision id 为准）。
   - `upgrade()`：`op.add_column("workspaces", sa.Column("default_agent", sa.String(length=64), nullable=True))`
   - `downgrade()`：`op.drop_column("workspaces", "default_agent")`
   - 无默认值、无回填、无索引（点查 by workspace id）。
3. 不引入外键约束（provider 是 runtime 动态属性，无独立 provider 表）。

## 接口定义（代码类任务必填）
```python
# model.py — 新增字段
class Workspace(BaseModel, table=True):
    # ... 既有字段 ...
    default_branch: str | None = Field(default="main", sa_column=Column(String(100), nullable=True))
    default_agent: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))  # 新增
    # ...
```
```python
# 迁移文件骨架
"""add workspace.default_agent

Revision ID: 202606141200
Revises: <当前 head>
Create Date: 2026-06-14 22:04:34
"""
from alembic import op
import sa  # sqlalchemy as sa

revision = "202606141200"
down_revision = "<alembic heads 实际值>"

def upgrade() -> None:
    op.add_column("workspaces", sa.Column("default_agent", sa.String(length=64), nullable=True))

def downgrade() -> None:
    op.drop_column("workspaces", "default_agent")
```

## 边界处理（必填）
- **null 行为**：`default_agent=None` 表示未设默认，解析链路透传 `provider=None`（task-03），维持变更前行为（成功标准 1）。
- **brownfield 兼容**：列 nullable、无默认值，现有 workspace 行无需回填，`alembic upgrade head` 对存量数据零影响。
- **未知 provider 容忍**：本字段不做格式校验（R-06）；拼写错误由 placement 回退兜底（task-02）+ 前端下拉限制输入（task-10）。
- **字符串长度**：64 字符足够覆盖 provider 名（claude/codex/hermes/gemini 等），与 `Column(String(64))` 一致。
- **迁移幂等**：标准 add/drop column，重复 upgrade 由 alembic version 表保护。
- **不修改既有字段**：只新增，不动 repo_url/default_branch 等。

## 非目标（本任务不做的事）
- 不回填历史 workspace 的 default_agent。
- 不加索引、外键、唯一约束。
- 不改 schema（task-04 负责）。
- 不改 service 读取逻辑（task-03 负责）。

## 参考
- 既有风格：`Workspace.default_branch`（model.py）、`Workspace.repo_url`。
- 迁移命名约定：`YYYYMMDDHHMI_<desc>.py`，参考 `202606270900_create_daemon_tables.py`。

## TDD 步骤
1. 写测试：`backend/app/modules/workspace/tests/test_model_default_agent.py` — 构造 `Workspace(default_agent="claude")` 与 `Workspace()`（默认 None），断言字段值与 nullable 行为。
2. 确认失败（字段不存在 → AttributeError / 测试报错）。
3. 加 model 字段 + 写迁移。
4. `cd backend && uv run alembic upgrade head` → 确认表结构；`uv run pytest -q tests/test_model_default_agent.py` 通过。
5. `cd backend && uv run alembic downgrade -1` → 确认可回退（列消失），再 upgrade 恢复。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `cd backend && uv run alembic upgrade head` | 成功，无报错 |
| AC-02 | `sqlite3 ... "PRAGMA table_info(workspaces)"` 或 DB 查询 | 出现 `default_agent` 列，type=VARCHAR(64)，nullable=YES |
| AC-03 | `cd backend && uv run alembic downgrade -1` | 成功，列被 DROP |
| AC-04 | `cd backend && uv run alembic upgrade head` 再次 | 成功（幂等） |
| AC-05 | model.py 中 `default_agent` 注解为 `str \| None` | 与既有可选字段风格一致 |
| AC-06 | task-01 单测（model 构造）通过 | `Workspace(default_agent="claude").default_agent == "claude"` 且默认 None |
