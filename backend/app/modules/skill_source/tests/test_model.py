"""skill_sources / user_skill_enables 两表模型与约束测试（task-01）。

Change: 2026-09-11-skills-central-library（design §数据模型——字段唯一权威）

覆盖:
- SkillSource: 表名/字段齐全/列类型与长度（url 500、branch 100、subdir 200、
  last_commit 40）/url 表级命名 UNIQUE/默认值（branch=main、enabled=True）。
- UserSkillEnable: UNIQUE(user_id, skill_key) 联合唯一/user_id FK users
  ON DELETE CASCADE NOT NULL/skill_key String(200)。
- 持久层：url 重复 → IntegrityError；同用户同 skill_key 重复 → IntegrityError；
  不同用户同 skill_key 共存。
"""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from sqlalchemy import UniqueConstraint, select
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


def test_user_skill_enable_joint_unique_constraint() -> None:
    """UNIQUE(user_id, skill_key) 联合唯一（D-003 防重复启用）。"""
    table_args = UserSkillEnable.__table_args__
    if not isinstance(table_args, tuple):
        table_args = (table_args,)
    joint = [
        c
        for c in table_args
        if isinstance(c, UniqueConstraint)
        and {col.name for col in c.columns} == {"user_id", "skill_key"}
    ]
    assert joint, "必须有 (user_id, skill_key) 联合唯一约束"
    assert joint[0].name == "uq_user_skill_enables_user_skill_key"
    # skill_key 长度 200（<source_id>:<目录名> 编码）。
    assert UserSkillEnable.__table__.columns["skill_key"].type.length == 200


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
    """同 user 同 skill_key 重复 → IntegrityError；跨 user 同 skill_key 共存。"""
    user = uuid.uuid4()
    key = f"{uuid.uuid4()}:my-skill"
    db_session.add(UserSkillEnable(user_id=user, skill_key=key))
    await db_session.commit()

    db_session.add(UserSkillEnable(user_id=user, skill_key=key))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()

    # 跨用户同 skill_key：各自启用同一技能，联合唯一不挡。
    db_session.add(UserSkillEnable(user_id=uuid.uuid4(), skill_key=key))
    await db_session.commit()
    result = await db_session.execute(
        select(UserSkillEnable).where(UserSkillEnable.skill_key == key)
    )
    assert len(result.scalars().all()) == 2
