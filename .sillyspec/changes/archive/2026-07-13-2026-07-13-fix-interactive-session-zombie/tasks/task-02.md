---
id: task-02
title: alembic data migration 清历史僵尸 + 单测
title_zh: 新增 alembic data migration 清理历史僵尸会话 + 映射单测
author: qinyi
created_at: 2026-07-13 20:56:24
priority: P0
depends_on: []
blocks: [task-06]
requirement_ids: [FR-3]
decision_ids: [D-004]
allowed_paths:
  - backend/migrations/versions/20260713_fix_session_zombie.py
  - backend/tests/test_session_zombie_migration.py
---

# task-02: alembic data migration 清历史僵尸 + 单测

## goal

新建 alembic **data** migration（仅改数据不改表结构），按 D-004@v1 映射规则把历史 `status='pending'` 僵尸会话按背后 run 终态一次性更新为 `ended`/`failed`，清掉存量 7 类僵尸（3 completed / 3 failed / 1 killed + 孤儿）。对应 design §5 Wave3、§8 数据模型、D-004、R-04。

## 修改文件（必填）

- **新增** `backend/migrations/versions/20260713_fix_session_zombie.py` — data migration，revision id 唯一化，down_revision 接真实单 head
- **新增** `backend/tests/test_session_zombie_migration.py` — 4 类 pending 僵尸 fixture + apply upgrade 断言映射正确

无其他文件修改。本 task 不碰源码、不动表结构、不改 daemon。

## implementation

### 0. execute 前置实测（R-04，防并行变更偏移）

```bash
cd backend && uv run alembic heads
```

确认当前**单 head = `20260712_team_orch`**（decisions.md D-004 已官方核实，子代理误报 13 head 经此命令推翻）。若 head 偏移（并行变更新增 migration）→ 先 `alembic merge` 合并多 head，再以新 head 为 down_revision；若仍是单 head 则直接 down_revision='20260712_team_orch'。

### 1. 新建 migration 文件

- 路径：`backend/migrations/versions/20260713_fix_session_zombie.py`
- 模板参照 `20260706_component_readonly_cleanup.py`（现有 data migration + op.execute raw SQL + downgrade raise NotImplementedError 范式）
- import 惯例参照 `20260712_team_orch.py`：`from typing import Sequence`（per-file-ignores 放宽 UP035）+ `from alembic import op`
- revision 常量：

```python
revision: str = "20260713_fix_session_zombie"
down_revision: str | None = "20260712_team_orch"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None
```

### 2. upgrade() — 4 条 UPDATE（D-004 映射）

全部 `WHERE s.status='pending' AND s.deleted_at IS NULL`（仅清活跃僵尸，不动已软删行）。用 `op.execute` raw SQL，JOIN `agent_runs r ON r.agent_session_id = s.agent_session_id`：

| run 终态 | session 映射 | ended_at |
|---|---|---|
| `r.status='completed'` | `s.status='ended'` | `COALESCE(r.finished_at, now)` |
| `r.status='killed'` | `s.status='ended'`（对齐 D-003，kill=正常终止） | `COALESCE(r.finished_at, now)` |
| `r.status='failed'` | `s.status='failed'` | `COALESCE(r.finished_at, now)` |
| 无关联 run 的孤儿 / run 仍 pending | `s.status='ended'` | `now()` |

控制流伪代码（raw SQL）：

```
-- 1. completed / killed → ended（D-003 kill 对齐）
UPDATE agent_sessions s
SET status='ended', ended_at=COALESCE(r.finished_at, NOW())
FROM agent_runs r
WHERE r.agent_session_id = s.agent_session_id
  AND r.status IN ('completed','killed')
  AND s.status='pending' AND s.deleted_at IS NULL;

-- 2. failed → failed
UPDATE agent_sessions s
SET status='failed', ended_at=COALESCE(r.finished_at, NOW())
FROM agent_runs r
WHERE r.agent_session_id = s.agent_session_id
  AND r.status='failed'
  AND s.status='pending' AND s.deleted_at IS NULL;

-- 3. 孤儿（无关联 run 或关联 run 仍 pending/running）→ ended
UPDATE agent_sessions s
SET status='ended', ended_at=NOW()
WHERE s.status='pending' AND s.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM agent_runs r
    WHERE r.agent_session_id = s.agent_session_id
      AND r.status IN ('completed','killed','failed')
  );
```

> 注：3 条 UPDATE 顺序执行；第 3 条 NOT EXISTS 兜底所有未在前两条命中的 pending（含无 run 孤儿 + run 仍 running/pending 的会话）。所有 status='active'/'reconnecting' 的会话**不在本迁移范围**（本任务仅清 pending 孤魂）。

### 3. downgrade() — 不可逆

```python
def downgrade() -> None:
    # 不可逆：pending→ended/failed 是基于 run 终态的一次性映射，
    # 原 pending 已无法区分"真在跑"还是"僵尸"（本项目允许重置数据，CLAUDE.md 规则 11）。
    raise NotImplementedError(
        "fix_session_zombie is an irreversible data migration (D-004@v1)"
    )
```

不写回滚 SQL。附 status 快照注释说明迁移不可逆（参照 20260706_component_readonly_cleanup 范式）。

### 4. 先写测试 test_session_zombie_migration.py

文件路径：`backend/tests/test_session_zombie_migration.py`（注意是 `backend/tests/` 顶层，非 `app/modules/daemon/tests/`）。参照现有 alembic migration 测试范式（构造 fixture → apply upgrade → 断言行映射）。

构造 4 类 pending 僵尸 fixture（均 deleted_at IS NULL）：

| fixture | session 初始 | 关联 run | upgrade 后期望 |
|---|---|---|---|
| `completed_run` | status=pending | run.status=completed, finished_at=T1 | s.status=ended, ended_at=T1 |
| `failed_run` | status=pending | run.status=failed, finished_at=T2 | s.status=failed, ended_at=T2 |
| `killed_run` | status=pending | run.status=killed, finished_at=T3 | s.status=ended（D-003）, ended_at=T3 |
| `orphan_no_run` | status=pending | 无关联 run | s.status=ended, ended_at≈now() |

加守护 case：`active_session`（status=active）+ `deleted_pending`（pending + deleted_at 非空）upgrade 后**不变**。

### TDD 步骤

1. 写 `test_session_zombie_migration.py`（4 类映射 + 孤儿 + 守护）
2. 确认测试失败（migration 文件尚不存在）
3. 写 `20260713_fix_session_zombie.py` 实现
4. 确认所有测试通过
5. 回归：`uv run alembic upgrade head` 本地空库验证不报错 + 其他 migration 测试无回归

## 验收标准

| # | 验证点 | 通过标准 |
|---|---|---|
| AC-01 | revision id 唯一化，down_revision 接真实单 head | `alembic heads` 输出唯一 head='20260713_fix_session_zombie'，无多 head 报错 |
| AC-02 | completed/killed run → session=ended | fixture upgrade 后 s.status='ended'，ended_at=run.finished_at |
| AC-03 | failed run → session=failed | fixture upgrade 后 s.status='failed'，ended_at=run.finished_at |
| AC-04 | 孤儿（无关联 run）→ session=ended | fixture upgrade 后 s.status='ended'，ended_at≈now() |
| AC-05 | 仅清 pending，不动 active / 软删行 | active_session / deleted_pending upgrade 后 status 不变 |
| AC-06 | ended_at = COALESCE(run.finished_at, now) | 有 run 用 run.finished_at，孤儿用 now() |
| AC-07 | downgrade 标注不可逆 | 调 downgrade 抛 NotImplementedError，无回滚 SQL |
| AC-08 | 4 类映射 + 孤儿 + 守护测试全绿 | `pytest tests/test_session_zombie_migration.py -q` 全通过 |

## verify

```bash
# 1. 确认单 head + 新 migration 接链（R-04）
cd backend && uv run alembic heads
# 期望：唯一 head = 20260713_fix_session_zombie

# 2. 本地空库验证 upgrade 不报错
cd backend && uv run alembic upgrade head

# 3. 映射正确性单测
cd backend && uv run pytest tests/test_session_zombie_migration.py -q
```

## constraints

- **仅改数据不改表结构**（纯 data migration，D-002@v1 零结构变更；无 add_column/drop_column/create_index）
- **revision id 唯一化**（`20260713_fix_session_zombie`，≤32 字符满足 alembic_version.version_num varchar(32)），down_revision 接实测单 head
- 遵循现有 migration 文件模板：`op.execute` raw SQL + `from typing import Sequence`（UP035 per-file-ignores 放行）+ `from alembic import op`
- **只处理 `status='pending' AND deleted_at IS NULL`**，不动 active/reconnecting/ended/failed 及已软删行
- down 不可逆（raise NotImplementedError，附 status 快照注释），不写回滚 SQL
- 不碰 sillyhub-daemon（D-006）、不改 AgentSession model schema（D-002）、不接线 idle sweep（D-007）
- 关联记忆：[[migration-chain-fragmentation-pattern]]（并行变更撞 revision id / down_revision 分叉多 head → execute 前 alembic heads 实测）
