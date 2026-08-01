"""Unit + persistence tests for CustomSkill (task-01).

Change: 2026-07-31-custom-skill-per-user（task-11 同步 per-user 契约）

覆盖:
- D-001: 单文件 DB model（映射到 ``custom_skills`` 表）。
- D-001@v2: ``created_by`` NOT NULL + ON DELETE CASCADE（per-user 强归属）。
- D-002@v2: ``(created_by, name)`` 联合唯一（per-user 内唯一，不同用户可同名）；
  name 列不再单独 unique，唯一性由表级 UniqueConstraint 承担。
- D-007: 平台级——无 ``workspace_id`` 字段（废弃 D-010 平台级全局共享）。
"""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from sqlalchemy import UniqueConstraint, select
from sqlalchemy.exc import IntegrityError
from sqlmodel import SQLModel

from app.modules.skills.model import CustomSkill


def test_custom_skill_is_table_model() -> None:
    """CustomSkill 必须是 SQLModel table，映射到 custom_skills。"""
    assert issubclass(CustomSkill, SQLModel)
    assert CustomSkill.__table__ is not None
    assert CustomSkill.__tablename__ == "custom_skills"
    # 注册到 BaseModel.metadata（autogenerate / create_all 才能扫到）
    assert "custom_skills" in SQLModel.metadata.tables


def test_custom_skill_field_contract() -> None:
    """task-01 要求的字段全部就位。"""
    fields = set(CustomSkill.model_fields.keys())
    for required in (
        "id",
        "name",
        "description",
        "content",
        "created_by",
        "created_at",
        "updated_at",
    ):
        assert required in fields, f"missing field: {required}"


def test_custom_skill_is_platform_level_no_workspace_id() -> None:
    """D-010: 平台级 skill 无 workspace_id 列。"""
    fields = set(CustomSkill.model_fields.keys())
    assert "workspace_id" not in fields


def test_custom_skill_name_unique_and_required_columns() -> None:
    """D-002@v2: ``(created_by, name)`` 联合唯一；核心列 NOT NULL。"""
    table = CustomSkill.__table__
    name_col = table.columns["name"]
    assert name_col.nullable is False
    # D-002@v2: name 列不再单独 unique，唯一性下沉到表级联合约束。
    assert name_col.unique is None, "name 列不应再有列级 unique（改联合唯一）"

    for col_name in ("description", "content", "created_at", "updated_at"):
        col = table.columns[col_name]
        assert col.nullable is False, f"{col_name} must be NOT NULL"

    # D-001@v2: created_by NOT NULL（per-user 强归属，不再允许无创建者）。
    assert table.columns["created_by"].nullable is False

    # D-002@v2: 表级 (created_by, name) UniqueConstraint 存在。
    table_args = CustomSkill.__table_args__
    if not isinstance(table_args, tuple):
        table_args = (table_args,)
    joint = [
        c
        for c in table_args
        if isinstance(c, UniqueConstraint)
        and {col.name for col in c.columns} == {"created_by", "name"}
    ]
    assert joint, "必须有 (created_by, name) 联合唯一约束"


def test_custom_skill_name_column_length_is_40() -> None:
    """D-002: name 长度上限 40。"""
    name_col = CustomSkill.__table__.columns["name"]
    assert name_col.type.length == 40


def test_custom_skill_default_id_and_timestamps() -> None:
    """id 自动生成 UUID、created_at/updated_at 自动填充。"""
    skill = CustomSkill(
        name="my-skill",
        description="a skill",
        content="body",
        created_by=uuid.uuid4(),
    )
    assert skill.id is not None
    assert isinstance(skill.created_at, datetime)
    assert isinstance(skill.updated_at, datetime)


def test_custom_skill_created_by_required_not_null() -> None:
    """D-001@v2: created_by 列 NOT NULL（per-user 强归属，不再可空）。"""
    table = CustomSkill.__table__
    assert table.columns["created_by"].nullable is False
    # FK 指向 users.id，ON DELETE CASCADE（用户注销级联删其技能）。
    fks = list(table.columns["created_by"].foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "users"
    assert fks[0].ondelete == "CASCADE"


@pytest.mark.asyncio
async def test_custom_skill_persist_and_query(db_session) -> None:
    """内存 SQLite 插入 + 按 name 查询 OK（created_by 必填）。"""
    owner = uuid.uuid4()
    skill = CustomSkill(
        name="research-helper",
        description="帮助做调研的技能",
        content="# Research Helper\n\n正文内容。",
        created_by=owner,
    )
    db_session.add(skill)
    await db_session.commit()
    await db_session.refresh(skill)

    result = await db_session.execute(
        select(CustomSkill).where(CustomSkill.name == "research-helper")
    )
    fetched = result.scalars().one()
    assert fetched.id == skill.id
    assert fetched.description == "帮助做调研的技能"
    assert fetched.content.startswith("# Research Helper")
    assert fetched.created_by == owner
    assert isinstance(fetched.created_at, datetime)


@pytest.mark.asyncio
async def test_custom_skill_name_unique_constraint(db_session) -> None:
    """D-002@v2: 同一用户内 (created_by, name) 重复 commit 抛 IntegrityError。"""
    owner = uuid.uuid4()
    first = CustomSkill(name="dup-name", description="first", content="a", created_by=owner)
    second = CustomSkill(name="dup-name", description="second", content="b", created_by=owner)
    db_session.add(first)
    await db_session.commit()

    db_session.add(second)
    with pytest.raises(IntegrityError):
        await db_session.commit()


@pytest.mark.asyncio
async def test_custom_skill_cross_user_same_name_allowed(db_session) -> None:
    """D-002@v2: 不同用户同名不冲突（联合唯一的 per-user 面）。"""
    a, b = uuid.uuid4(), uuid.uuid4()
    db_session.add(CustomSkill(name="shared", description="a", content="x", created_by=a))
    db_session.add(CustomSkill(name="shared", description="b", content="y", created_by=b))
    # 不同 created_by 的同名两条应都能提交（不抛 IntegrityError）。
    await db_session.commit()

    result = await db_session.execute(select(CustomSkill).where(CustomSkill.name == "shared"))
    assert len(result.scalars().all()) == 2
