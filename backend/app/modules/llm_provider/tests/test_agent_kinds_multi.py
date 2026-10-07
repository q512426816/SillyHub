"""多引擎 agent_kinds 集合语义（change 2026-10-06-provider-multi-agent-kind / task-07）。

覆盖 D-003/D-004/D-005/D-006 的服务层新行为（既有单引擎等价面由
test_llm_provider.py / test_api_format.py 存量用例守护）：

1. 创建多引擎行 + Read 往返（集合原样、去重生效）；
2. 默认全引擎生效 + 互斥逐引擎清：多引擎默认行设默认时，**每个勾选引擎**的
   兄弟默认行都被清（D-006 扩张语义同面覆盖——update 扩张引擎集合同样清
   新增引擎兄弟默认）；
3. update 合并判定：把 agent_kinds 扩到含 pi 且行是 openai_chat → 422
   （与 Create 同口径）；仅扩不含 pi 的引擎 → 通过；
4. 收缩引擎：默认行从 [claude,pi] 收缩到 [claude] → pi 默认空缺不自动转移
   （无 pi 默认行、claude 保留）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import get_cipher
from app.modules.llm_provider.model import LlmProvider
from app.modules.llm_provider.schema import LlmProviderCreate, LlmProviderUpdate
from app.modules.llm_provider.service import LlmProviderService

from .test_llm_provider import _create_user


@pytest.fixture
def _mock_probe_notify(monkeypatch: pytest.MonkeyPatch) -> None:
    """本地版 mock_probe_notify（set_default 的 probe/notify 打桩）。

    与 test_llm_provider.mock_probe_notify 同源逻辑；跨模块 fixture 导入会被
    ruff F401 autofix 反复清除（签名引用不算使用），故就地复制一份。
    """

    from app.modules.llm_provider.probe import ProviderProbeResult

    async def _fake_probe(*_a: object, **_k: object) -> ProviderProbeResult:
        return ProviderProbeResult(ok=True)

    async def _fake_notify(*_a: object, **_k: object) -> int:
        return 0

    monkeypatch.setattr("app.modules.llm_provider.probe.probe_provider", _fake_probe)
    monkeypatch.setattr(
        "app.modules.daemon.lease.provider_switch.notify_provider_switch", _fake_notify
    )


async def _seed_row(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    agent_kinds: list[str],
    is_default: bool = False,
    name: str = "seeded",
) -> LlmProvider:
    ct, key_id = get_cipher().encrypt("sk-multi-secret-0001")
    row = LlmProvider(
        id=uuid.uuid4(),
        user_id=user_id,
        name=name,
        agent_kinds=agent_kinds,
        models=[],
        encrypted_api_key=ct,
        key_id=key_id,
        is_default=is_default,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


class TestMultiKindCrud:
    @pytest.mark.asyncio
    async def test_create_multi_engine_roundtrip_and_dedupe(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="mk1")
        svc = LlmProviderService(db_session)
        created = await svc.create(
            user_id,
            LlmProviderCreate(name="multi", agent_kinds=["claude", "pi", "claude"]),
        )
        assert created.agent_kinds == ["claude", "pi"]
        read = svc._to_read(await svc.get(created.id, user_id))
        assert read.agent_kinds == ["claude", "pi"]


class TestMultiKindDefaultMutex:
    @pytest.mark.asyncio
    async def test_set_default_clears_siblings_for_every_engine(
        self, db_session: AsyncSession, _mock_probe_notify: None
    ) -> None:
        """多引擎默认行设默认 → claude 与 pi 两个引擎的旧默认兄弟都被清。"""
        user_id = await _create_user(db_session, label="mk2")
        svc = LlmProviderService(db_session)
        await _seed_row(
            db_session, user_id, agent_kinds=["claude"], is_default=True, name="old-claude"
        )
        await _seed_row(db_session, user_id, agent_kinds=["pi"], is_default=True, name="old-pi")
        multi = await svc.create(
            user_id,
            LlmProviderCreate(
                name="multi",
                agent_kinds=["claude", "pi"],
                base_url="https://api.anthropic.com",
                api_key="sk-multi-default-0001",
            ),
        )
        await svc.set_default(multi.id, user_id)

        rows = (await db_session.execute(_all_rows(user_id))).scalars().all()
        defaults = [r for r in rows if r.is_default]
        assert [r.name for r in defaults] == ["multi"]


class TestMultiKindUpdateSemantics:
    @pytest.mark.asyncio
    async def test_expand_to_pi_with_openai_chat_rejected(self, db_session: AsyncSession) -> None:
        """openai_chat 行把引擎集合扩到含 pi → 422（合并判定）。"""
        from app.core.errors import AppError

        user_id = await _create_user(db_session, label="mk3")
        svc = LlmProviderService(db_session)
        row = await svc.create(
            user_id,
            LlmProviderCreate(name="oc", agent_kinds=["claude"], api_format="openai_chat"),
        )
        with pytest.raises(AppError) as exc_info:
            await svc.update(row.id, user_id, LlmProviderUpdate(agent_kinds=["claude", "pi"]))
        assert "pi" in str(exc_info.value.message)

    @pytest.mark.asyncio
    async def test_default_row_expand_clears_new_engine_sibling(
        self, db_session: AsyncSession
    ) -> None:
        """D-006 扩张：默认行 [claude] 扩到 [claude,pi] → pi 的旧默认兄弟被清。"""
        user_id = await _create_user(db_session, label="mk4")
        svc = LlmProviderService(db_session)
        await _seed_row(db_session, user_id, agent_kinds=["pi"], is_default=True, name="old-pi")
        row = await _seed_row(
            db_session, user_id, agent_kinds=["claude"], is_default=True, name="grow"
        )
        await svc.update(row.id, user_id, LlmProviderUpdate(agent_kinds=["claude", "pi"]))

        rows = (await db_session.execute(_all_rows(user_id))).scalars().all()
        defaults = {r.name: r.agent_kinds for r in rows if r.is_default}
        assert defaults == {"grow": ["claude", "pi"]}

    @pytest.mark.asyncio
    async def test_shrink_leaves_engine_default_vacant(self, db_session: AsyncSession) -> None:
        """收缩：默认行 [claude,pi] 收缩到 [claude] → pi 默认空缺不自动转移。"""
        user_id = await _create_user(db_session, label="mk5")
        svc = LlmProviderService(db_session)
        await _seed_row(db_session, user_id, agent_kinds=["pi"], is_default=False, name="other-pi")
        row = await _seed_row(
            db_session, user_id, agent_kinds=["claude", "pi"], is_default=True, name="shrink"
        )
        await svc.update(row.id, user_id, LlmProviderUpdate(agent_kinds=["claude"]))

        rows = (await db_session.execute(_all_rows(user_id))).scalars().all()
        assert all(not r.is_default for r in rows if "pi" in r.agent_kinds)
        assert [r.name for r in rows if r.is_default] == ["shrink"]

    @pytest.mark.asyncio
    async def test_explicit_null_agent_kinds_is_noop(self, db_session: AsyncSession) -> None:
        """显式 agent_kinds=None（openapi 契约 anyOf 允许 null）= 不动（2026-10-07 followup）。

        openai_chat + 默认行双态同行，一次盖住两条打穿路径：不 pop None 时
        生效组合判定 `"pi" in None` → TypeError；默认行扩张清兄弟
        `_clear_sibling_defaults(user, None)` → set(None) TypeError / NOT NULL 违反。
        """
        user_id = await _create_user(db_session, label="mk6")
        svc = LlmProviderService(db_session)
        row = await svc.create(
            user_id,
            LlmProviderCreate(
                name="oc-null",
                agent_kinds=["claude", "codex"],
                api_format="openai_chat",
                is_default=True,
            ),
        )
        updated = await svc.update(row.id, user_id, LlmProviderUpdate(agent_kinds=None))
        assert updated.agent_kinds == ["claude", "codex"]
        assert updated.is_default is True
        reread = await svc.get(row.id, user_id)
        assert reread.agent_kinds == ["claude", "codex"]


def _all_rows(user_id: uuid.UUID):
    from sqlalchemy import select

    return select(LlmProvider).where(LlmProvider.user_id == user_id).order_by(LlmProvider.name)
