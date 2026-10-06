"""llm_providers.agent_kind 单值列 → agent_kinds JSON 数组列

Revision ID: 20261006120000
Revises: 20261003020000
Create Date: 2026-10-06 12:00:00

change 2026-10-06-provider-multi-agent-kind（D-004 单列改数组）：一条供应商凭证可
服务多个引擎会话（消灭同 key 重复建卡）。迁移口径（design §数据模型 / FR-02）：

- 存量值域不变性：每行 ``agent_kinds = [旧 agent_kind]``（单元素数组），未编辑
  行的全部解析/默认/校验语义与单值时代逐行为等价；**不合并不清理**存量重复行
  （D-002，用户手动删）。
- 不留双列（规则 11 项目未上线无历史兼容包袱）：agent_kind 旧列删除。
- 索引（R-01）：含 agent_kind 的复合索引 ``ix_llm_providers_user_agent_default``
  (user_id, agent_kind, is_default) 随列替换 drop；终态复用既有
  ``ix_llm_providers_user`` (user_id)——每用户行数几十级，is_default/引擎过滤转
  行级 Python 判断，无性能面（不建重复索引）。
- 双方言（R-03，先例 20260825150000 的 ``op.get_bind().dialect.name`` 守卫）：
  回填 JSON PG 用 ``to_jsonb(ARRAY[...])::json``，SQLite 用 ``json_array(...)``
  （PG 无 json_array 函数）；列增删走 ``batch_alter_table``（SQLite 重建表语义）。
- downgrade 对称可回退（requirements 非功能）：agent_kind 取数组首元素恢复，
  复合索引重建原形态。
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20261006120000"
down_revision = "20261003020000"
branch_labels = None
depends_on = None

_TABLE = "llm_providers"
_OLD_COMPOSITE_INDEX = "ix_llm_providers_user_agent_default"


def _is_pg() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    # ① 含 agent_kind 的复合索引先删（列替换前必删，否则 drop column 报索引依赖，R-01）。
    op.drop_index(_OLD_COMPOSITE_INDEX, table_name=_TABLE)

    with op.batch_alter_table(_TABLE) as batch:
        # ② 加 agent_kinds JSON NOT NULL（server_default '[]' 占位让已有数据行通过
        #    NOT NULL 约束，回填后 drop）。
        batch.add_column(sa.Column("agent_kinds", sa.JSON(), nullable=False, server_default="[]"))

    # ③ 回填：每行 agent_kinds = [旧 agent_kind]（FR-02 值域不变性；双方言分支 R-03）。
    if _is_pg():
        op.execute(f"UPDATE {_TABLE} SET agent_kinds = to_jsonb(ARRAY[agent_kind])::json")
    else:
        op.execute(f"UPDATE {_TABLE} SET agent_kinds = json_array(agent_kind)")

    with op.batch_alter_table(_TABLE) as batch:
        # ④ 删旧单值列（不留双列，规则 11）；同时清 ② 的 server_default 占位
        #    （model.py 列定义无 server_default，防 model/迁移漂移）。
        batch.drop_column("agent_kind")
        batch.alter_column("agent_kinds", server_default=None)

    # ⑤ (user_id) 维度索引：复用既有 ix_llm_providers_user，不建重复索引（R-01）。


def downgrade() -> None:
    with op.batch_alter_table(_TABLE) as batch:
        # 对称回退：加回 agent_kind 单值列（server_default 占位同 upgrade ② 逻辑）。
        batch.add_column(
            sa.Column("agent_kind", sa.String(length=32), nullable=False, server_default="claude")
        )

    # 回填：agent_kind = agent_kinds 数组首元素（PG ->>0 / SQLite json_extract）。
    if _is_pg():
        op.execute(f"UPDATE {_TABLE} SET agent_kind = agent_kinds->>0")
    else:
        op.execute(f"UPDATE {_TABLE} SET agent_kind = json_extract(agent_kinds, '$[0]')")

    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column("agent_kinds")
        batch.alter_column("agent_kind", server_default=None)

    # 复合索引恢复原形态（upgrade ① 的逆操作）。
    op.create_index(
        _OLD_COMPOSITE_INDEX,
        _TABLE,
        ["user_id", "agent_kind", "is_default"],
        unique=False,
    )
