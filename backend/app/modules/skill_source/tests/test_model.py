"""skill_sources / user_skill_enables 两表模型与约束测试（task-01）。

Change: 2026-09-11-skills-central-library + 2026-09-11-workspace-asset-bridges
task-01（design §数据模型——单表双 scope D-003/双 partial 唯一）

覆盖:
- SkillSource: 表名/字段齐全/列类型与长度（url 500、branch 100、subdir 200、
  last_commit 40）/url 表级命名 UNIQUE/默认值（branch=main、enabled=True）。
- UserSkillEnable: 双 partial unique index（user 维度 (user_id, skill_key)
  WHERE workspace_id IS NULL；workspace 维度 (workspace_id, skill_key) WHERE
  workspace_id IS NOT NULL，双方言 where 声明）/user_id FK users ON DELETE
  CASCADE NOT NULL/workspace_id FK workspaces ON DELETE CASCADE NULL/skill_key
  String(200)。
- 持久层：url 重复 → IntegrityError；同 user 同 skill_key 重复（user 维度）→
  IntegrityError；同 workspace 同 skill_key 重复 → IntegrityError；user 行与
  ws 行同 skill_key 共存；不同用户同 skill_key 共存。
"""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from sqlalchemy import Index, UniqueConstraint, select
from sqlalchemy.exc import IntegrityError
from sqlmodel import SQLModel

from app.modules.skill_source.model import SkillSource, UserSkillEnable


def test_skill_source_is_table_model() -> None:
    """SkillSource 映射 skill_sources 且注册到共享 metadata。"""
    assert issubclass(SkillSource, SQLModel)
    assert SkillSource.__tablename__ == "skill_sources"
    assert "skill_sources" in SQLModel.metadata.tables


def test_skill_source_field_contract() -> None:
    """design §数据模型要求的全字段就位。"""
    fields = set(SkillSource.model_fields.keys())
    for required in (
        "id",
        "url",
        "branch",
        "subdir",
        "enabled",
        "last_commit",
        "last_fetched_at",
        "last_error",
        "created_at",
        "updated_at",
    ):
        assert required in fields, f"missing field: {required}"


def test_skill_source_column_types_and_lengths() -> None:
    """列类型/长度/可空性逐列对照 design §数据模型。"""
    table = SkillSource.__table__
    assert table.columns["url"].nullable is False
    assert table.columns["url"].type.length == 500
    assert table.columns["branch"].nullable is False
    assert table.columns["branch"].type.length == 100
    assert table.columns["subdir"].nullable is True
    assert table.columns["subdir"].type.length == 200
    assert table.columns["enabled"].nullable is False
    assert table.columns["last_commit"].nullable is True
    assert table.columns["last_commit"].type.length == 40
    assert table.columns["last_fetched_at"].nullable is True
    assert table.columns["last_error"].nullable is True
    # url 列级不再 unique，唯一性由表级命名约束承担（迁移对称回落用）。
    assert table.columns["url"].unique is None


def test_skill_source_url_table_level_unique() -> None:
    """url 全局 UNIQUE（表级命名约束 uq_skill_sources_url）。"""
    table_args = SkillSource.__table_args__
    if not isinstance(table_args, tuple):
        table_args = (table_args,)
    url_unique = [
        c
        for c in table_args
        if isinstance(c, UniqueConstraint) and {col.name for col in c.columns} == {"url"}
    ]
    assert url_unique, "必须有 url 表级 UNIQUE 约束"
    assert url_unique[0].name == "uq_skill_sources_url"


def test_skill_source_python_defaults() -> None:
    """id/branch=main/enabled=True/时间戳 Python 侧默认（迁移无 server_default）。"""
    source = SkillSource(url="https://example.com/skills.git")
    assert source.id is not None
    assert source.branch == "main"
    assert source.enabled is True
    assert source.subdir is None
    assert isinstance(source.created_at, datetime)
    assert isinstance(source.updated_at, datetime)


def test_user_skill_enable_dual_partial_unique_indexes() -> None:
    """双 partial unique index（bridges task-01，D-003 单表双 scope）。

    旧表级 ``UNIQUE(user_id, skill_key)`` 拆成两个 partial unique index：user
    维度 WHERE workspace_id IS NULL（与旧约束语义等价）；workspace 维度
    (workspace_id, skill_key) WHERE workspace_id IS NOT NULL。双方言 where
    声明（workspaces ``ux_*_active`` 先例——SQLite 测试库与生产 PG 同语义）。
    """
    table_args = UserSkillEnable.__table_args__
    if not isinstance(table_args, tuple):
        table_args = (table_args,)
    indexes = {idx.name: idx for idx in table_args if isinstance(idx, Index)}

    user_scope = indexes.get("ux_user_skill_enables_user_scope")
    assert user_scope is not None, "必须有 user 维度 partial unique index"
    assert user_scope.unique is True
    assert [c.name for c in user_scope.columns] == ["user_id", "skill_key"]
    assert str(user_scope.dialect_options["postgresql"]["where"]) == "workspace_id IS NULL"
    assert str(user_scope.dialect_options["sqlite"]["where"]) == "workspace_id IS NULL"

    ws_scope = indexes.get("ux_user_skill_enables_workspace_scope")
    assert ws_scope is not None, "必须有 workspace 维度 partial unique index"
    assert ws_scope.unique is True
    assert [c.name for c in ws_scope.columns] == ["workspace_id", "skill_key"]
    assert str(ws_scope.dialect_options["postgresql"]["where"]) == "workspace_id IS NOT NULL"
    assert str(ws_scope.dialect_options["sqlite"]["where"]) == "workspace_id IS NOT NULL"

    # 旧表级联合唯一约束已移除（迁移 20260911220000 对称 DROP）。
    assert not [
        c
        for c in table_args
        if isinstance(c, UniqueConstraint)
        and {col.name for col in c.columns} == {"user_id", "skill_key"}
    ], "旧表级 UNIQUE 应由 user 维度 partial 承担"
    # skill_key 长度 200（<source_id>:<目录名> 编码）。
    assert UserSkillEnable.__table__.columns["skill_key"].type.length == 200


def test_user_skill_enable_workspace_id_fk_cascade() -> None:
    """workspace_id NULL + FK workspaces ON DELETE CASCADE（单表双 scope）。"""
    table = UserSkillEnable.__table__
    ws_col = table.columns["workspace_id"]
    assert ws_col.nullable is True
    fks = list(ws_col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "workspaces"
    assert fks[0].ondelete == "CASCADE"
    # Python 侧缺省 None（user 维度旧行为）。
    assert UserSkillEnable(user_id=uuid.uuid4(), skill_key=f"{uuid.uuid4()}:x").workspace_id is None


def test_user_skill_enable_user_id_fk_cascade() -> None:
    """user_id NOT NULL + FK users ON DELETE CASCADE（用户注销级联删绑定）。"""
    table = UserSkillEnable.__table__
    user_col = table.columns["user_id"]
    assert user_col.nullable is False
    fks = list(user_col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "users"
    assert fks[0].ondelete == "CASCADE"
    # skill_key 刻意不做 FK 到 skill_sources（悬空绑定保留，源删除 service 层连带）。
    assert list(table.columns["skill_key"].foreign_keys) == []


@pytest.mark.asyncio
async def test_skill_source_url_unique_integrity(db_session) -> None:
    """url 重复 commit → IntegrityError（DB 层兜底）。"""
    db_session.add(SkillSource(url="https://93.184.216.34/skills.git"))
    await db_session.commit()
    db_session.add(SkillSource(url="https://93.184.216.34/skills.git"))
    with pytest.raises(IntegrityError):
        await db_session.commit()


@pytest.mark.asyncio
async def test_user_skill_enable_joint_unique_integrity(db_session) -> None:
    """同 user 同 skill_key 重复（user 维度）→ IntegrityError；跨 user 同 skill_key 共存。"""
    user = uuid.uuid4()
    key = f"{uuid.uuid4()}:my-skill"
    db_session.add(UserSkillEnable(user_id=user, skill_key=key))
    await db_session.commit()

    db_session.add(UserSkillEnable(user_id=user, skill_key=key))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()

    # 跨用户同 skill_key：各自启用同一技能，user 维度 partial 不挡。
    db_session.add(UserSkillEnable(user_id=uuid.uuid4(), skill_key=key))
    await db_session.commit()
    result = await db_session.execute(
        select(UserSkillEnable).where(UserSkillEnable.skill_key == key)
    )
    assert len(result.scalars().all()) == 2


@pytest.mark.asyncio
async def test_user_skill_enable_workspace_scope_integrity(db_session) -> None:
    """workspace 维度 partial：同 ws 同 key 重复 → IntegrityError；user 行与 ws 行共存。"""
    ws_id = uuid.uuid4()
    user = uuid.uuid4()
    other_user = uuid.uuid4()
    key = f"{uuid.uuid4()}:ws-skill"

    # user 行 + ws 行同 skill_key 共存（partial 互不挡——双 scope 各自唯一）。
    db_session.add(UserSkillEnable(user_id=user, skill_key=key, workspace_id=None))
    db_session.add(UserSkillEnable(user_id=user, skill_key=key, workspace_id=ws_id))
    await db_session.commit()

    # 同 ws 同 key 重复（操作者不同也挡——ws 维度唯一键不含 user_id）。
    db_session.add(UserSkillEnable(user_id=other_user, skill_key=key, workspace_id=ws_id))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()

    rows = (
        (await db_session.execute(select(UserSkillEnable).where(UserSkillEnable.skill_key == key)))
        .scalars()
        .all()
    )
    assert len(rows) == 2
    assert {row.workspace_id for row in rows} == {None, ws_id}
