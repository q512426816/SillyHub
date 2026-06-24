---
id: task-03
title: migration add_session_rotated_at
priority: P1
depends_on: [task-02]
blocks: [task-05]
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/migrations/versions/202606241000_add_session_rotated_at.py
---

# task-03

为 `sessions` 表新增 `rotated_at` 列的 alembic migration,落库 task-02 在 ORM 层定义的 `Session.rotated_at` 字段,为 task-05 service grace 判定提供物理列。

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `backend/migrations/versions/202606241000_add_session_rotated_at.py` | `sessions` 加 `rotated_at TIMESTAMP WITH TIME ZONE NULL` |

仅此一个文件。不触碰 `model.py`(task-02 负责)、不触碰其它 migration、不触碰 service。

## 覆盖来源

- **需求**:FR-02(Session 新增 `rotated_at` 字段;`sessions` 物理列)
- **决策**:D-002@v1(grace=60s 配置 + rotated_at 列;§5 Phase1、§8 数据模型)
- **设计章节**:
  - design.md §5 Phase 1:"新增 alembic migration:`sessions` 加 `rotated_at` 列"
  - design.md §8 数据模型:`rotated_at TIMESTAMP WITH TIME ZONE NULL`,rotate 时刻;logout 不写;grace 判定用 `now - rotated_at < auth_refresh_grace_seconds`
  - design.md §9 兼容策略:项目未上线、数据可清空(CLAUDE.md 规则 8),migration 直接 `ADD COLUMN ... NULL`,无需回填
  - design.md §10 R-05:migration head 在多分支 merge 后需精确定位,execute 用 `alembic heads` 确认 head 再设 `down_revision`
- **plan.md**:Wave 1 / task-03 行,完成标准 "`sessions` 加 `rotated_at TIMESTAMP WITH TIME ZONE NULL`;`down_revision`=`alembic heads` 当前 head",验证命令 `cd backend && uv run alembic upgrade head`

## 实现要求

1. **新建 migration 文件**:`backend/migrations/versions/202606241000_add_session_rotated_at.py`。
2. **revision id**:`202606241000`(日期+序号,与 design.md §6 文件名一致,避免与 `202606240900_add_change_human_gate` 等既有 revision 冲突)。
3. **down_revision**:execute 开始时跑 `cd backend && uv run alembic heads` 确认当前唯一 head,把该 head 填入 `down_revision`。**禁止凭记忆/文档瞎填**(R-05 风险:多分支 merge 后 head 可能漂移)。若 `alembic heads` 报多 head(multiple heads),先在 execute 步骤里向用户报告,不要自行 merge。
4. **文件骨架**严格对齐现有 migration 风格(`202606240900_add_change_human_gate.py`):
   - 模块 docstring 写明用途 + Revision ID + Revises;
   - `from __future__ import annotations`;
   - `import sqlalchemy as sa` + `from alembic import op`;
   - 模块级 `revision / down_revision / branch_labels = None / depends_on = None`;
   - `upgrade()` 与 `downgrade()` 两个函数。
5. **upgrade()** 用 `op.add_column("sessions", sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True))`。**禁止**用幂等 `DO $$ ... EXCEPTION WHEN duplicate_column`(那是 `202606240900` 的特定做法,本项目未上线、数据可清空,无需幂等;保持 migration 干净可逆)。
6. **downgrade()** 用 `op.drop_column("sessions", "rotated_at")`,保证可逆。
7. **类型**:`sa.DateTime(timezone=True)` 对应 PostgreSQL `TIMESTAMP WITH TIME ZONE`(design.md §8 明确),与 `sessions.revoked_at` / `expires_at` 现有列类型一致(execute 时可 `grep -n "DateTime(timezone=True)" backend/app/modules/auth/model.py` 核对)。
8. **nullable=True**:design.md §8/§9 明确 NULL,旧行兼容,不回填。
9. **不加索引**:design.md §8 已论证 grace 查询走 `revoked_at IS NOT NULL` + 内存比对 `rotated_at`,单机 <1k session,无需新索引。
10. **不写业务数据**:upgrade 内只有 DDL,无 `UPDATE`/`INSERT`(对比 `202606240900` 有 `UPDATE changes SET ...` 迁移老 stage——本任务无历史数据迁移需求)。

## 接口定义

```python
"""Add rotated_at column to sessions table (grace window for refresh rotation).

Revision ID: 202606241000
Revises: <EXECUTE 时跑 `cd backend && uv run alembic heads` 填入当前 head>
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606241000"
down_revision = "<alembic heads 当前 head,execute 填>"  # noqa: E501  ← 占位,execute 替换
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sessions", "rotated_at")
```

- **upgrade 伪代码**:`op.add_column("sessions", Column("rotated_at", DateTime(timezone=True), nullable=True))`
- **downgrade 伪代码**:`op.drop_column("sessions", "rotated_at")`
- 形参与 `202606240900_add_change_human_gate.py:49` 的 `op.drop_column("changes", "human_gate")` 完全同构。

## 边界处理

1. **NULL 不回填**:项目未上线、数据可清空(CLAUDE.md 规则 8 + design.md §9),`nullable=True`,旧行 `rotated_at` 保持 NULL。grace 判定在 service 层用 `rotated_at IS NOT NULL` 短路(task-05 负责),migration 不操心。
2. **down_revision 必须动态确认**:多分支 merge 后 head 会漂移(design.md §10 R-05,P1)。execute 第一步跑 `cd backend && uv run alembic heads`,把输出的唯一 revision 填入 `down_revision`。**禁止**直接抄本文件占位符或凭文档猜。
3. **多 head 异常路径**:若 `alembic heads` 输出 >1 行(multiple heads),说明存在未 merge 的分支,**停止本任务**并向用户报告 head 列表,不要自行 `alembic merge`(超出 task-03 范围,属环境问题)。
4. **revision id 用 `202606241000`**:与 design.md §6 文件名、plan.md task-03 行一致;时间序在 `202606240900` 之后,避免与既有 revision 撞车。禁止改成 `add_session_rotated_at` 这类字符串 revision(项目约定全用 `YYYYMMDDhhmm` 数字串,见 `202606240900`/`202606230900`)。
5. **nullable 保证旧行兼容**:新增列 NULL,既有 active/revoked session 行不会被 NOT NULL 约束拒绝,upgrade 在已有数据的库上也能跑通(design.md §9)。
6. **downgrade 必须可逆**:`op.drop_column` 对称存在,`alembic downgrade -1` 能干净回退到上一 head,不留残留列。execute 验收时跑一次 downgrade + 再 upgrade 验证可逆性。
7. **不加索引/不加约束**:design.md §8 明确 grace 查询无需新索引;不加 `NOT NULL`、不加 `CHECK`、不加 `DEFAULT`——`rotated_at` 仅由 service 层 `_mark_session_rotated` 写入(task-05),DDL 层保持最小。
8. **不碰其它列/其它表**:只 `sessions.rotated_at` 一列。`revoked_at`/`expires_at`/`user_id` 等既有列不动;`changes`/`users` 等其它表不动。
9. **跨 DB 兼容**:`sa.DateTime(timezone=True)` 是 SQLAlchemy 跨方言抽象,在 PostgreSQL 落为 `TIMESTAMP WITH TIME ZONE`;项目主用 PG(design.md §8 写明 PG 类型),但保持用 `sa.DateTime(timezone=True)` 而非裸 `sa.text("TIMESTAMP WITH TIME ZONE")`,以兼容 SQLAlchemy 的 DDL 生成器(与 model.py task-02 的 `Column(DateTime(timezone=True))` 一致)。
10. **不依赖 task-02 的 ORM 改动能跑**:migration 是纯 DDL(`op.add_column`),不 import `model.py`,不依赖 task-02 的 `Session.rotated_at` 字段定义已生效——即使 task-02 的 ORM 改动未加载,migration 也能独立 `alembic upgrade head`。这保证 task-03 与 task-02 在 Wave 1 可严格按 "task-02 先行、task-03 跟随" 但互不阻塞执行(依赖关系是逻辑依赖:service 层 task-05 需要 ORM 字段 + 物理列同时存在)。

## 非目标

- **不**改 `sessions` 其它列(`revoked_at`/`expires_at`/`user_id`/`refresh_token_hash` 等)。
- **不**新增索引(含 `ix_sessions_user_revoked` 的任何调整)。
- **不**回填历史数据(`rotated_at` 对旧行保持 NULL)。
- **不**改 `model.py`(task-02 负责 ORM 字段定义)。
- **不**改 `service.py`(task-05 负责 grace 逻辑)。
- **不**做 alembic merge(多 head 场景交用户决策)。
- **不**加 `NOT NULL` / `DEFAULT` / `CHECK` 约束。

## 参考

- **现有 migration 风格**:`backend/migrations/versions/202606240900_add_change_human_gate.py`
  - docstring 三段式(用途 + Revision ID + Revises)
  - `from __future__ import annotations` + `import sqlalchemy as sa` + `from alembic import op`
  - 模块级四常量 `revision / down_revision / branch_labels / depends_on`
  - `upgrade()` / `downgrade()` 两函数
  - **差异点**:本任务 upgrade 用 `op.add_column`(标准 DDL),不抄 `202606240900` 的 `DO $$ ... EXCEPTION WHEN duplicate_column` 幂等块(那是该任务处理"历史 partial migration 残留"的特例,本任务无此场景);也不抄它的两条 `UPDATE changes SET ...` 业务数据迁移(本任务无历史数据迁移)。
- **既有列类型基准**:execute 时 `grep -n "DateTime(timezone=True)" backend/app/modules/auth/model.py` 确认 `revoked_at`/`expires_at` 用 `DateTime(timezone=True)`,本列保持一致。
- **alembic heads 命令**:`cd backend && uv run alembic heads`(design.md §10 R-05 应对策略)。

## TDD 步骤

本任务是纯 DDL migration,无单元测试可写(migration 不含业务逻辑)。TDD 形态转化为"先建表 → 跑 upgrade → 验证列存在"的集成验证闭环:

1. **Red(前置)**:`cd backend && uv run alembic current` 确认当前 head;`\d sessions`(或 `alembic inspect`/PG 客户端)确认 `sessions` 表**尚无** `rotated_at` 列——此为红态(目标列不存在)。
2. **写实现**:按"接口定义"创建 `backend/migrations/versions/202606241000_add_session_rotated_at.py`,`down_revision` 填 `alembic heads` 输出。
3. **Green(验证)**:`cd backend && uv run alembic upgrade head` 成功;再 `\d sessions`(PG:`\d sessions` / 通用:`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='sessions' AND column_name='rotated_at'`)确认 `rotated_at` 列存在、类型 `timestamp with time zone`、`is_nullable='YES'`——转绿。
4. **可逆性验证**:`cd backend && uv run alembic downgrade -1` → `\d sessions` 确认列消失;再 `alembic upgrade head` 恢复。确认 upgrade/downgrade 双向干净。
5. **回归**:跑既有 auth 测试 `cd backend && uv run pytest app/modules/auth -q` 确认 migration 不破坏现有 ORM 读写(Session 模型在 task-02 已加 `rotated_at` 字段,migration 后真实表有该列,读写应正常)。

## 验收标准

| 编号 | 验收项 | 验证方法 | 通过判据 |
|---|---|---|---|
| AC-1 | `alembic upgrade head` 成功 | `cd backend && uv run alembic upgrade head` | 退出码 0,无异常,输出含 `Running upgrade <old_head> -> 202606241000, Add rotated_at column to sessions table` |
| AC-2 | `sessions` 表存在 `rotated_at` 列 | `SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name='sessions' AND column_name='rotated_at'` | 返回一行:`data_type='timestamp with time zone'`(PG) 且 `is_nullable='YES'` |
| AC-3 | `downgrade` 可逆干净 | `cd backend && uv run alembic downgrade -1` 后再查 information_schema | `rotated_at` 列消失(查询返回 0 行);再 `alembic upgrade head` 列恢复 |
| AC-4 | `down_revision` 指向真实 head | `cd backend && uv run alembic history --verbose` | `202606241000` 的 down_revision 等于 execute 时 `alembic heads` 的输出,链路无断点 |
| AC-5 | 既有 auth 测试不回归 | `cd backend && uv run pytest app/modules/auth -q` | 全绿(依赖 task-02 ORM 字段已合入;若 task-02 未完成则本项跳过,由 task-05 兜底) |
| AC-6 | ruff 通过 | `cd backend && uv run ruff check migrations/versions/202606241000_add_session_rotated_at.py` | 无 lint 错误(line-length 100) |

> 完成全部 AC 后,在 plan.md task-03 行打勾,并把 `down_revision` 的实际值记录到本文件"接口定义"占位处(替换 `<alembic heads 当前 head,execute 填>` 注释),便于审计。
