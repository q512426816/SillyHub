"""对齐旧版 DDL 建出的 platform_change_events（2026-09-26-migration-chain-dedupe）

Revision ID: 20260926234000
Revises: 20260926083000
Create Date: 2026-09-26 23:40:00

20260923040000 初版 DDL（ts timestamptz / severity·rule 可空 / severity(32) /
detail varchar(2000) / 含 stage 列）已被生产等库应用并写入数据（生产 166 行）；
同变更把 040000 重写为 ORM 对齐版（ts varchar(64) / severity(16) NOT NULL
default 'info' / rule NOT NULL / provisional server_default true / detail
text / 无 stage），但重写只对**全新库**生效——已应用库的记号使 040000 不再
执行。本迁移对旧结构库幂等对齐到 ORM 结构：

- ``ts`` timestamptz → varchar(64)：数据经 ``to_char(ts AT TIME ZONE 'UTC',
  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`` 转 ISO 8601 UTC 串（ORM 语义：字符串
  存储与字典序比较，禁时区/精度转换——service 层写入即此格式，历史数据
  统一到同一形态）；
- ``severity``：NULL → 'info'（生产 166 行中 157 NULL），varchar(32) →
  varchar(16)，加 NOT NULL 与 DEFAULT 'info'；
- ``rule``：NULL → ''（service 层归一后非空，历史 NULL 以空串保真），
  加 NOT NULL；
- ``provisional``：补 server_default true；
- ``detail`` varchar(2000) → text；
- ``stage`` 列存在则 DROP（063000/ORM 语义无此列；生产 119/166 行非空值
  随列废弃——旁路观测数据不迁移，丢弃口径已在本变更 design 记录）。

每步按 information_schema 探测执行条件：已是目标结构的库（如本地 dogfood
库由 20260926063000 建表、结构即目标）全 no-op；SQLite（测试库）无
information_schema，探测恒 False 整体 no-op——测试库从零 upgrade 即目标
结构。downgrade no-op：结构对齐不可逆（旧结构的 timestamptz 精度与 stage
值已不可恢复），回退走部署回滚而非数据反向转换。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "20260926234000"
down_revision: str | None = "20260926083000"
branch_labels: str | None = None
depends_on: str | None = None

_TABLE = "platform_change_events"


def _column_meta(bind: sa.Connection, column: str) -> dict[str, str] | None:
    """PG information_schema.columns 单列探测（缺失返回 None）。

    返回 data_type / is_nullable / character_maximum_length /
    column_default——各对齐步骤的条件判据。
    """
    row = bind.execute(
        sa.text(
            "SELECT data_type, is_nullable, character_maximum_length, column_default "
            "FROM information_schema.columns "
            "WHERE table_name = :t AND column_name = :c"
        ),
        {"t": _TABLE, "c": column},
    ).first()
    if row is None:
        return None
    return {
        "data_type": str(row[0]),
        "is_nullable": str(row[1]),
        "max_len": "" if row[2] is None else str(row[2]),
        "default": "" if row[3] is None else str(row[3]),
    }


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        # SQLite 测试库从零 upgrade 即目标结构（040000 重写版），无对齐面。
        return

    # ts：timestamptz → varchar(64)，数据转 ISO 8601 UTC 串（timestamp without
    # time zone 不在探测面：该形态下 AT TIME ZONE 语义按会话时区反转，历史上
    # 也不存在此形态的库——评审 P3 收窄）。
    ts_meta = _column_meta(bind, "ts")
    if ts_meta is not None and ts_meta["data_type"] == "timestamp with time zone":
        bind.execute(
            sa.text(
                f"ALTER TABLE {_TABLE} ALTER COLUMN ts TYPE varchar(64) "
                "USING to_char(ts AT TIME ZONE 'UTC', "
                '\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\')'
            )
        )

    # severity：NULL 回填 → 超长截断 → varchar(16) → NOT NULL + DEFAULT 'info'。
    sev_meta = _column_meta(bind, "severity")
    if sev_meta is not None:
        bind.execute(sa.text(f"UPDATE {_TABLE} SET severity = 'info' WHERE severity IS NULL"))
        # 收窄防护（评审 P2）：severity 是短枚举观测值（info/warn/...），历史脏
        # 值超 16 字符会让 varchar(32)→(16) 收窄 ALTER 报 value too long 整单回
        # 滚——left() 先行截断，保证收窄恒可执行。
        bind.execute(
            sa.text(
                f"UPDATE {_TABLE} SET severity = left(severity, 16) WHERE length(severity) > 16"
            )
        )
        if sev_meta["max_len"] != "16":
            bind.execute(sa.text(f"ALTER TABLE {_TABLE} ALTER COLUMN severity TYPE varchar(16)"))
        if sev_meta["is_nullable"] == "YES":
            bind.execute(sa.text(f"ALTER TABLE {_TABLE} ALTER COLUMN severity SET NOT NULL"))
        if "info" not in sev_meta["default"]:
            bind.execute(sa.text(f"ALTER TABLE {_TABLE} ALTER COLUMN severity SET DEFAULT 'info'"))

    # rule：NULL → ''（service 层归一后恒非空，历史 NULL 以空串保真）→ NOT NULL。
    rule_meta = _column_meta(bind, "rule")
    if rule_meta is not None:
        bind.execute(sa.text(f"UPDATE {_TABLE} SET rule = '' WHERE rule IS NULL"))
        if rule_meta["is_nullable"] == "YES":
            bind.execute(sa.text(f"ALTER TABLE {_TABLE} ALTER COLUMN rule SET NOT NULL"))

    # provisional：补 server_default true。
    prov_meta = _column_meta(bind, "provisional")
    if prov_meta is not None and "true" not in prov_meta["default"].lower():
        bind.execute(sa.text(f"ALTER TABLE {_TABLE} ALTER COLUMN provisional SET DEFAULT true"))

    # detail：varchar(2000) → text。
    det_meta = _column_meta(bind, "detail")
    if det_meta is not None and det_meta["data_type"] == "character varying":
        bind.execute(sa.text(f"ALTER TABLE {_TABLE} ALTER COLUMN detail TYPE text"))

    # stage：063000/ORM 无此列，存在即 DROP（历史值废弃口径见 docstring）。
    if _column_meta(bind, "stage") is not None:
        bind.execute(sa.text(f"ALTER TABLE {_TABLE} DROP COLUMN stage"))


def downgrade() -> None:
    """结构对齐不可逆（见 docstring）：no-op。"""
    return
