"""LlmProvider CRUD + 加密 + 默认互斥 + owner 过滤。

照 ``git_identity/service.py`` 范式：
- ``__init__(session, *, cipher=None)`` + lazy ``_default_cipher()`` 调 ``get_cipher()``；
- ``create/update`` 先 ``cipher.encrypt(api_key)`` 再赋 ``encrypted_api_key``（明文永不入 ORM，R-04）；
- ``(user_id, agent_kind)`` 维度 ``is_default`` 互斥（事务内先清同组再置，R-05）；
- 所有方法按 ``user_id`` 过滤（D-008 owner 级），跨用户访问 → 404/403 不泄漏存在性。
"""

from __future__ import annotations

import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import CredentialCipher
from app.core.errors import AppError, PermissionDenied
from app.core.logging import get_logger
from app.modules.llm_provider.model import LlmProvider
from app.modules.llm_provider.schema import (
    LlmProviderCreate,
    LlmProviderRead,
    LlmProviderUpdate,
)

log = get_logger(__name__)


class LlmProviderNotFound(AppError):
    code = "HTTP_404_LLM_PROVIDER_NOT_FOUND"
    http_status = 404


class LlmProviderService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        cipher: CredentialCipher | None = None,
    ) -> None:
        self._session = session
        self._cipher = cipher or self._default_cipher()

    @staticmethod
    def _default_cipher() -> CredentialCipher:
        from app.core.crypto import get_cipher

        return get_cipher()

    # ── CRUD ──────────────────────────────────────────────────────────

    async def list_(self, user_id: uuid.UUID) -> list[LlmProvider]:
        stmt = (
            select(LlmProvider)
            .where(LlmProvider.user_id == user_id)
            .order_by(LlmProvider.created_at.desc())
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def get(self, provider_id: uuid.UUID, user_id: uuid.UUID) -> LlmProvider:
        stmt = select(LlmProvider).where(LlmProvider.id == provider_id)
        row = (await self._session.execute(stmt)).scalars().first()
        if row is None:
            raise LlmProviderNotFound(
                f"LLM provider '{provider_id}' not found.",
                details={"provider_id": str(provider_id)},
            )
        if row.user_id != user_id:
            raise PermissionDenied("Not your LLM provider.")
        return row

    async def create(
        self,
        user_id: uuid.UUID,
        data: LlmProviderCreate,
    ) -> LlmProvider:
        ct, key_id = self._cipher.encrypt(data.api_key or "")
        if data.is_default:
            await self._clear_sibling_defaults(user_id, data.agent_kind)
        row = LlmProvider(
            id=uuid.uuid4(),
            user_id=user_id,
            name=data.name,
            agent_kind=data.agent_kind,
            base_url=data.base_url,
            encrypted_api_key=ct,
            key_id=key_id,
            model=data.model,
            notes=data.notes,
            website_url=data.website_url,
            auth_field=data.auth_field,
            model_role_mappings=data.model_role_mappings,
            default_fallback_model=data.default_fallback_model,
            extra_env=data.extra_env,
            is_default=data.is_default,
        )
        self._session.add(row)
        await self._session.commit()
        await self._session.refresh(row)
        log.info(
            "llm_provider.created",
            provider_id=str(row.id),
            user_id=str(user_id),
            agent_kind=row.agent_kind,
        )
        return row

    async def update(
        self,
        provider_id: uuid.UUID,
        user_id: uuid.UUID,
        data: LlmProviderUpdate,
    ) -> LlmProvider:
        row = await self.get(provider_id, user_id)
        updates = data.model_dump(exclude_unset=True)

        # api_key 单独处理：None = 不动原密钥；非 None 才重新加密
        new_api_key = updates.pop("api_key", None)
        if new_api_key is not None:
            ct, key_id = self._cipher.encrypt(new_api_key)
            row.encrypted_api_key = ct
            row.key_id = key_id

        # is_default 互斥：置 True 前先清同 (user_id, agent_kind) 兄弟行
        want_default = updates.pop("is_default", None)
        if want_default:
            await self._clear_sibling_defaults(row.user_id, row.agent_kind, except_id=row.id)

        for field, value in updates.items():
            setattr(row, field, value)
        if want_default is not None:
            row.is_default = want_default

        await self._session.commit()
        await self._session.refresh(row)
        log.info("llm_provider.updated", provider_id=str(row.id))
        return row

    async def delete(self, provider_id: uuid.UUID, user_id: uuid.UUID) -> None:
        row = await self.get(provider_id, user_id)
        await self._session.delete(row)
        await self._session.commit()
        log.info("llm_provider.deleted", provider_id=str(provider_id))

    async def set_default(
        self,
        provider_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> LlmProvider:
        row = await self.get(provider_id, user_id)
        # 事务内先清同 (user_id, agent_kind) 兄弟行再置本行（R-05 并发互斥）
        await self._clear_sibling_defaults(row.user_id, row.agent_kind, except_id=row.id)
        row.is_default = True
        await self._session.commit()
        await self._session.refresh(row)
        log.info("llm_provider.set_default", provider_id=str(row.id))
        return row

    # ── Helpers ───────────────────────────────────────────────────────

    async def _clear_sibling_defaults(
        self,
        user_id: uuid.UUID,
        agent_kind: str,
        *,
        except_id: uuid.UUID | None = None,
    ) -> None:
        """单事务内把同 (user_id, agent_kind) 其它行的 is_default 清成 False。"""
        stmt = (
            update(LlmProvider)
            .where(
                LlmProvider.user_id == user_id,
                LlmProvider.agent_kind == agent_kind,
                LlmProvider.is_default.is_(True),
            )
            .values(is_default=False)
        )
        if except_id is not None:
            stmt = stmt.where(LlmProvider.id != except_id)
        await self._session.execute(stmt)

    def _to_read(self, row: LlmProvider) -> LlmProviderRead:
        plaintext = self._cipher.decrypt(row.encrypted_api_key, row.key_id)
        read = LlmProviderRead.model_validate(row)
        read.api_key_masked = self._mask_api_key(plaintext)
        return read

    @staticmethod
    def _mask_api_key(plaintext: str) -> str | None:
        """X-09：空 → None；<8 位 → ****；>=8 位 → 首4...尾4。"""
        if not plaintext:
            return None
        if len(plaintext) < 8:
            return "****"
        return f"{plaintext[:4]}...{plaintext[-4:]}"
