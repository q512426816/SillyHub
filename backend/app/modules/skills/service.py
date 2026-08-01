"""CustomSkill CRUD business logic + name validation.

Change: 2026-07-07-skills-mcp-management-ui (task-02)

职责:
- name 字符集 ``[a-z0-9-]{2,40}`` + 禁 ``sillyspec-`` 前缀校验（业务层，
  非 DB；DB 只保证 unique + 长度 40，见 task-01 model D-002）。
- unique 冲突 → ``SkillNameConflict`` (409)。
- 字符集/前缀非法 → ``SkillNameInvalid`` (422)。
- 找不到记录 → ``SkillNotFound`` (404)。

错误类继承 :class:`AppError`，FastAPI 全局异常处理器统一序列化为
``{code, message, request_id, details}``（见 core/errors.py）。
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.skills.model import CustomSkill
from app.modules.skills.schema import CONTENT_PREVIEW_LENGTH

log = get_logger(__name__)

# task-02 蓝图：name 字符集 [a-z0-9-]{2,40}，禁 sillyspec- 前缀（避免与 sillyspec
# 内置 skill 命名空间冲突，前端会混淆平台 skill 与工具自带 skill）。
_NAME_PATTERN = re.compile(r"^[a-z0-9-]{2,40}$")
_RESERVED_PREFIX = "sillyspec-"


class SkillNotFound(AppError):
    code = "skill.not_found"
    http_status = 404


class SkillNameInvalid(AppError):
    """name 字符集或前缀非法（422）。"""

    code = "skill.name_invalid"
    http_status = 422


class SkillNameConflict(AppError):
    """name 已存在（409）。"""

    code = "skill.name_conflict"
    http_status = 409


def _validate_name(name: str) -> None:
    """业务层 name 校验：字符集 + 禁保留前缀。

    抛 :class:`SkillNameInvalid`（422）。
    """
    if not isinstance(name, str) or not _NAME_PATTERN.match(name):
        raise SkillNameInvalid(
            f"name 必须匹配 [a-z0-9-]{{2,40}}：{name!r}",
            details={"name": name, "rule": "^[a-z0-9-]{2,40}$"},
        )
    if name.startswith(_RESERVED_PREFIX):
        raise SkillNameInvalid(
            f"name 禁止使用保留前缀 {_RESERVED_PREFIX!r}：{name!r}",
            details={"name": name, "reserved_prefix": _RESERVED_PREFIX},
        )


class CustomSkillService:
    """per-user CustomSkill 的 CRUD 业务层（D-001）。

    所有查询/写入方法都带 ``user_id`` 维度：list 按 user 过滤、
    get/update/delete 先校验归属（不符 → :class:`SkillNotFound` 404，
    与「不存在」走同一错误码，不泄露存在性防越权枚举）、``_get_by_name``
    在 user 范围内查重（不同用户可同名，见 model D-002@v2 联合唯一）。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── 查询 ──────────────────────────────────────────────────────────

    async def list_(self, user_id: uuid.UUID) -> list[CustomSkill]:
        """指定 user 的 CustomSkill 列表（按 created_at desc）。

        per-user 隔离（D-001）：只返 ``created_by == user_id`` 的记录。
        列表不含 content（router 层投影 content_preview）。
        """
        stmt = (
            select(CustomSkill)
            .where(CustomSkill.created_by == user_id)
            .order_by(CustomSkill.created_at.desc())
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def get(self, skill_id: uuid.UUID, user_id: uuid.UUID) -> CustomSkill:
        """按 id 取记录并校验归属（D-001）。

        per-user 隔离：记录不存在 **或** ``created_by != user_id`` 都抛
        :class:`SkillNotFound`（404），与「不存在」走同一错误码，
        不泄露存在性（防越权枚举）。
        """
        skill = await self._session.get(CustomSkill, skill_id)
        if skill is None or skill.created_by != user_id:
            raise SkillNotFound(
                f"CustomSkill {skill_id} 不存在",
                details={"skill_id": str(skill_id)},
            )
        return skill

    # ── 写入 ──────────────────────────────────────────────────────────

    async def create(
        self,
        *,
        name: str,
        description: str,
        content: str,
        created_by: uuid.UUID | None = None,
    ) -> CustomSkill:
        _validate_name(name)
        # 提前检查 unique（避免直接撞 DB IntegrityError，给出更友好的 409）。
        # per-user 查重（D-001 + D-002@v2）：不同用户可同名，仅本用户内同名才冲突。
        existing = await self._get_by_name(name, created_by)
        if existing is not None:
            raise SkillNameConflict(
                f"name 已存在：{name!r}",
                details={"name": name, "conflict_id": str(existing.id)},
            )

        skill = CustomSkill(
            name=name,
            description=description,
            content=content,
            created_by=created_by,
        )
        self._session.add(skill)
        try:
            await self._session.commit()
        except IntegrityError as exc:
            # 并发场景兜底：service 检查与 commit 之间被插入了同名记录。
            await self._session.rollback()
            raise SkillNameConflict(
                f"name 已存在（并发）：{name!r}",
                details={"name": name},
            ) from exc
        await self._session.refresh(skill)
        return skill

    async def update(
        self,
        skill_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        name: str | None = None,
        description: str | None = None,
        content: str | None = None,
    ) -> CustomSkill:
        """部分更新（先校验归属，再改字段）。

        per-user 隔离（D-001）：先 ``get(skill_id, user_id)`` 做归属校验，
        越权 → 404（不泄露）。改 name 时 ``_get_by_name(name, user_id)``
        做 per-user 查重（A 改成自己的 name 不应被 B 的同名挡）。
        """
        skill = await self.get(skill_id, user_id)
        if name is not None and name != skill.name:
            _validate_name(name)
            existing = await self._get_by_name(name, user_id)
            if existing is not None and existing.id != skill.id:
                raise SkillNameConflict(
                    f"name 已存在：{name!r}",
                    details={"name": name, "conflict_id": str(existing.id)},
                )
            skill.name = name
        if description is not None:
            skill.description = description
        if content is not None:
            skill.content = content

        skill.updated_at = datetime.now(UTC)
        self._session.add(skill)
        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise SkillNameConflict(
                f"name 已存在（并发）：{name!r}",
                details={"name": name},
            ) from exc
        await self._session.refresh(skill)
        return skill

    async def delete(self, skill_id: uuid.UUID, user_id: uuid.UUID) -> None:
        """删除（先校验归属）。

        per-user 隔离（D-001）：先 ``get(skill_id, user_id)`` 做归属校验，
        越权 → 404（不泄露）。
        """
        skill = await self.get(skill_id, user_id)
        await self._session.delete(skill)
        await self._session.commit()

    # ── helpers ───────────────────────────────────────────────────────

    async def _get_by_name(self, name: str, user_id: uuid.UUID) -> CustomSkill | None:
        """per-user 查重（D-001 + D-002@v2）：在 ``user_id`` 范围内按 name 查。

        不同用户可同名（联合唯一约束 ``(created_by, name)``），
        仅本用户内同名才视为冲突。
        """
        stmt = select(CustomSkill).where(
            CustomSkill.name == name,
            CustomSkill.created_by == user_id,
        )
        return (await self._session.execute(stmt)).scalars().first()

    @staticmethod
    def preview(content: str) -> str:
        """列表项 content_preview：截断到 CONTENT_PREVIEW_LENGTH。"""
        if content is None:
            return ""
        return content[:CONTENT_PREVIEW_LENGTH]
