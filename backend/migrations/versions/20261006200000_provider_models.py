"""llm_providers 模型配置四旧列 → models JSON 列表列

Revision ID: 20261006200000
Revises: 20261006120000
Create Date: 2026-10-06 20:00:00

change 2026-10-06-provider-model-list（D-001/D-005 彻底重构 + JSON 列）：
模型从「单默认 model + model_role_mappings 4 角色槽 + multimodal 供应商级三态 +
default_fallback_model 兜底」四字段拼盘改为 models JSON 列表列（条目含
name/multimodal 三态/roles 可多标/one_m）。

迁移口径（design §总体方案 Wave1-1 / FR-05）：
- 存量折算（Python 侧逐行——去重+角色归并 SQL 表达不了）：
  * 候选模型名集合 = [model] + [default_fallback_model] + 4 槽（sonnet/opus/
    fable/haiku）的 model 值（非空去重保序）；
  * 每条 ``multimodal: "auto"``（旧供应商级标记不映射——粒度下沉，auto 启发式兜底）；
  * 角色槽归并：槽指向的模型名 → 对应条目 roles 追加该角色；one_m 透传到条目
    （同一模型被多角色槽引用且 one_m 冲突时**取 true 优先**，plan 写死）；
  * 旧 model_role_mappings 的 display 字段丢弃（D-002 列表内标角色无此概念）；
  * 空供应商（无任何模型名）→ ``[]``（服务层允许空，会话选模型提示先配）。
- 删 model / model_role_mappings / multimodal / default_fallback_model 四旧列
  （Grill P1-2：fallback 语义与主模型派生重合，一并退役；规则 11 无兼容包袱）。
- downgrade 对称反折：重建四旧列（model=sonnet 角色首条 ?? 列表首条 ?? NULL、
  default_fallback_model=主模型、model_role_mappings 从条目 roles 反折 4 槽
  {role:{model,one_m}}、multimodal='auto'）。
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20261006200000"
down_revision = "20261006120000"
branch_labels = None
depends_on = None

_TABLE = "llm_providers"
_ROLES = ("sonnet", "opus", "fable", "haiku")


def _fold_legacy_row(
    model: str | None,
    fallback: str | None,
    role_mappings: dict | None,
) -> list[dict]:
    """把旧四字段折算成 models 条目列表（design Wave1-1 口径）。

    - 候选 = [model] + [fallback] + 4 槽值（非空去重保序）；
    - 每条 multimodal='auto'、roles=[]、one_m=False 起步；
    - 槽归并：槽指向名 → 条目 roles 追加；one_m 冲突取 true 优先；
    - display 丢弃。
    """
    entries: list[dict] = []
    by_name: dict[str, dict] = {}

    def _entry(name: str) -> dict:
        if name not in by_name:
            e = {"name": name, "multimodal": "auto", "roles": [], "one_m": False}
            entries.append(e)
            by_name[name] = e
        return by_name[name]

    for name in (model, fallback):
        if name:
            _entry(name)
    if isinstance(role_mappings, dict):
        for role in _ROLES:
            slot = role_mappings.get(role)
            if not isinstance(slot, dict):
                continue
            name = slot.get("model")
            if not name:
                continue
            e = _entry(name)
            if role not in e["roles"]:
                e["roles"].append(role)
            if slot.get("one_m"):
                e["one_m"] = True  # 多角色冲突取 true 优先
    return entries


def _unfold_to_legacy(
    models: list[dict],
) -> tuple[str | None, str | None, dict | None]:
    """downgrade 反折：models 条目 → (model, default_fallback_model, role_mappings)。

    - 主模型 = sonnet 角色首条 ?? 列表首条 ?? None；
    - role_mappings 从条目 roles 反折 4 槽 {role:{model,one_m}}（同角色多条取首条）；
    - multimodal 旧列重建为 'auto'（折算时已丢失原值，R-06 接受）。
    """
    if not models:
        return None, None, None
    role_mappings: dict[str, dict] = {}
    for role in _ROLES:
        for e in models:
            if role in (e.get("roles") or []):
                role_mappings[role] = {
                    "model": e["name"],
                    "one_m": bool(e.get("one_m")),
                }
                break
    primary = None
    for e in models:
        if "sonnet" in (e.get("roles") or []):
            primary = e["name"]
            break
    if primary is None:
        primary = models[0]["name"]
    return primary, primary, (role_mappings or None)


def upgrade() -> None:
    # ① 加 models JSON NOT NULL（server_default '[]' 占位让已有数据行过约束）。
    with op.batch_alter_table(_TABLE) as batch:
        batch.add_column(sa.Column("models", sa.JSON(), nullable=False, server_default="[]"))

    # ② 存量折算回填（Python 侧逐行读旧四字段算列表）。
    conn = op.get_bind()
    rows = (
        conn.execute(
            sa.text(
                f"SELECT id, model, default_fallback_model, model_role_mappings,"
                f" multimodal FROM {_TABLE}"
            )
        )
        .mappings()
        .all()
    )
    for row in rows:
        mappings = row["model_role_mappings"]
        if isinstance(mappings, str):
            try:
                mappings = json.loads(mappings)
            except ValueError:
                mappings = None
        entries = _fold_legacy_row(row["model"], row["default_fallback_model"], mappings)
        conn.execute(
            sa.text(f"UPDATE {_TABLE} SET models = :models WHERE id = :id"),
            {"models": json.dumps(entries), "id": row["id"]},
        )

    # ③ 删四旧列 + 清 server_default 占位（model.py 列定义无默认）。
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column("model")
        batch.drop_column("model_role_mappings")
        batch.drop_column("multimodal")
        batch.drop_column("default_fallback_model")
        batch.alter_column("models", server_default=None)


def downgrade() -> None:
    # 对称反折：重建四旧列（server_default 占位过约束）→ 逐行反折 → 删 models。
    with op.batch_alter_table(_TABLE) as batch:
        batch.add_column(sa.Column("model", sa.String(128), nullable=True))
        batch.add_column(sa.Column("model_role_mappings", sa.JSON(), nullable=True))
        batch.add_column(
            sa.Column("multimodal", sa.String(8), nullable=False, server_default="auto")
        )
        batch.add_column(sa.Column("default_fallback_model", sa.String(128), nullable=True))

    conn = op.get_bind()
    rows = conn.execute(sa.text(f"SELECT id, models FROM {_TABLE}")).mappings().all()
    for row in rows:
        models = row["models"]
        if isinstance(models, str):
            try:
                models = json.loads(models)
            except ValueError:
                models = None
        primary, fallback, role_mappings = _unfold_to_legacy(models or [])
        conn.execute(
            sa.text(
                f"UPDATE {_TABLE} SET model = :m, default_fallback_model = :f,"
                f" model_role_mappings = :r WHERE id = :id"
            ),
            {
                "m": primary,
                "f": fallback,
                "r": json.dumps(role_mappings) if role_mappings else None,
                "id": row["id"],
            },
        )

    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column("models")
        batch.alter_column("multimodal", server_default=None)
