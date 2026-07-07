"""Unit + persistence tests for CustomSkill (task-01).

Change: 2026-07-07-skills-mcp-management-ui

覆盖:
- D-001: 单文件 DB model（映射到 ``custom_skills`` 表）。
- D-002: ``name`` DB 层 UNIQUE（commit 重复 name 触发 IntegrityError）。
- D-010: 平台级——无 ``workspace_id`` 字段。
"""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import select
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
    """D-002: name DB 层 UNIQUE + NOT NULL；核心列 NOT NULL。"""
    table = CustomSkill.__table__
    name_col = table.columns["name"]
    assert name_col.nullable is False
    # unique=True 在 SQLModel 里渲染为 Column.unique（migration 里另建 unique index 兜底）。
    assert name_col.unique is True, "name 列必须有 unique 约束"

    for col_name in ("description", "content", "created_at", "updated_at"):
        col = table.columns[col_name]
        assert col.nullable is False, f"{col_name} must be NOT NULL"

    # created_by 可空（平台级 skill 允许无创建者 / 用户删除后 SET NULL）。
    assert table.columns["created_by"].nullable is True


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
    )
    assert skill.id is not None
    assert isinstance(skill.created_at, datetime)
    assert isinstance(skill.updated_at, datetime)


def test_custom_skill_created_by_optional() -> None:
    """created_by 默认 None（平台级 skill 允许无创建者）。"""
    skill = CustomSkill(name="opt", description="d", content="c")
    assert skill.created_by is None


@pytest.mark.asyncio
async def test_custom_skill_persist_and_query(db_session) -> None:
    """内存 SQLite 插入 + 按 name 查询 OK。"""
    skill = CustomSkill(
        name="research-helper",
        description="帮助做调研的技能",
        content="# Research Helper\n\n正文内容。",
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
    assert fetched.created_by is None
    assert isinstance(fetched.created_at, datetime)


@pytest.mark.asyncio
async def test_custom_skill_name_unique_constraint(db_session) -> None:
    """D-002: 重复 name commit 时 DB 层抛 IntegrityError。"""
    first = CustomSkill(name="dup-name", description="first", content="a")
    second = CustomSkill(name="dup-name", description="second", content="b")
    db_session.add(first)
    await db_session.commit()

    db_session.add(second)
    with pytest.raises(IntegrityError):
        await db_session.commit()
