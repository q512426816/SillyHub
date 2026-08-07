"""后端单测：LlmProvider CRUD + 加密落盘 + owner 隔离 + is_default 互斥 + masked 不回明文。

task-05（2026-07-25-llm-provider-management）。覆盖 task-01~04 产出的 service 层契约：
- CRUD 全链路：create → get → list → patch（api_key=None 不改原密钥）→ delete → get 404；
- 加密落盘（D-001）：ORM ``encrypted_api_key`` 非空且 ≠ 明文；
- owner 隔离（D-008）：跨用户 list/get/patch/delete/set_default 全部被拒且不改数据；
- is_default 互斥（R-05）：同 (user_id, agent_kind) 至多 1 条 True，不同 agent_kind 互不影响；
- masked 不回明文（X-09）：所有 Read 响应无 ``api_key`` 字段，``api_key_masked`` 非空且 ≠ 明文。

范式参考：
- ``app/modules/daemon/tests/test_lease_service.py``（AsyncSession + async fixture + 用户构造）；
- ``app/modules/git_identity/tests/``（crypto 经 ``conftest.py`` 注入 ``SILLYSPEC_MASTER_KEY``，
  真实 ``CredentialCipher`` 跑加解密，不 mock）。

说明：
- SQLite + aiosqlite（backend 测试基线），断言不绑死 PG 专有函数；
- 本模块顶层 import ``LlmProvider`` → 表在 pytest 收集期挂到 ``BaseModel.metadata``，
  早于 ``db_engine`` fixture 的 ``create_all``，无需改 conftest；
- ``conftest.py`` 已设 ``SILLYSPEC_MASTER_KEY=v1:aa*32``，``service._default_cipher()``
  经 ``get_cipher()`` 拿到可用 cipher，落盘 / 解密 / masked 全链路走真实加密。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import get_cipher
from app.core.errors import PermissionDenied
from app.modules.llm_provider.model import LlmProvider
from app.modules.llm_provider.probe import ProviderProbeResult
from app.modules.llm_provider.schema import LlmProviderCreate, LlmProviderUpdate
from app.modules.llm_provider.service import LlmProviderNotFound, LlmProviderService

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession, *, label: str = "") -> uuid.UUID:
    """插入 User 行（FK 兼容；SQLite PRAGMA foreign_keys 默认关闭，但仍建真实行更稳）。"""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"lp-{uid.hex[:8]}-{label}@example.com",
        username=f"lp-{uid.hex[:8]}",
        password_hash="irrelevant",
        display_name=f"LP Test {label}",
        status="active",
    )
    session.add(user)
    await session.commit()
    return uid


def _create_payload(**overrides) -> LlmProviderCreate:
    """默认 claude provider 创建 payload；api_key >= 8 位以便测 masked 首4...尾4。"""
    defaults = {
        "name": "my-claude",
        "agent_kind": "claude",
        "api_key": "sk-ant-supersecretkey-1234",
        "base_url": "https://api.anthropic.com",
        "model": "claude-sonnet-4",
    }
    defaults.update(overrides)
    return LlmProviderCreate(**defaults)


async def _seed_provider_row(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    agent_kind: str,
    is_default: bool = False,
    api_key: str = "sk-seeded-xxxxxxxx",
    name: str = "seeded",
) -> LlmProvider:
    """绕过 schema（agent_kind Literal=claude）直接插 ORM 行，用于构造非 claude / 预置默认态。

    用真实 cipher 加密，保证落盘格式与 service.create 一致。
    """
    cipher = get_cipher()
    ct, key_id = cipher.encrypt(api_key)
    row = LlmProvider(
        id=uuid.uuid4(),
        user_id=user_id,
        name=name,
        agent_kind=agent_kind,
        encrypted_api_key=ct,
        key_id=key_id,
        is_default=is_default,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


# ── task-03 probe/notify mock 夹具 ─────────────────────────────────────────────


@pytest.fixture
def mock_probe_notify(monkeypatch: pytest.MonkeyPatch) -> None:
    """task-03（change 2026-08-06-provider-switch-live-session）：``set_default`` /
    ``unset_default`` 现调用真实 ``probe_provider``（HTTP 网络）+ ``notify_provider_switch``
    （DB JOIN ``agent_sessions`` / ``daemon_task_leases`` + WS 推送）。

    现有 ``is_default`` 互斥测试只断言 DB 行状态（``is_default`` 是否正确互斥清/置），
    与热切换副作用解耦 —— 真实网络会 timeout/fail（probe 返 ``ok=False`` → set_default
    回滚不置位 → 互斥断言失败），且 SQLite 测试库无 ``agent_sessions`` 表（notify JOIN
    报 ``no such table``）。本夹具 patch 源模块替换为 no-op AsyncMock，仅作用于显式声明
    该夹具的测试（其它测试不受影响）。

    patch 目标是**源模块**而非 ``service.probe_provider``：因 probe.py 顶层
    ``from ...service import LlmProviderService`` 与 service.py 互循环，service 内
    改用函数内 ``from ...probe import probe_provider`` lazy import（同 ``ws_hub`` /
    ``spawn-env`` 范式）。lazy import 在调用时按属性查找源模块当前绑定 → patch
    ``app.modules.llm_provider.probe.probe_provider`` 即生效。
    """

    async def _fake_probe(*_args: object, **_kwargs: object) -> ProviderProbeResult:
        return ProviderProbeResult(ok=True)

    async def _fake_notify(*_args: object, **_kwargs: object) -> int:
        return 0

    monkeypatch.setattr("app.modules.llm_provider.probe.probe_provider", _fake_probe)
    monkeypatch.setattr(
        "app.modules.daemon.lease.provider_switch.notify_provider_switch", _fake_notify
    )


# ── CRUD 全链路 ───────────────────────────────────────────────────────────────


class TestCrudFlow:
    """create → get → list → patch（api_key=None 不改原密钥）→ delete → get 404。"""

    @pytest.mark.asyncio
    async def test_create_returns_row_with_expected_fields(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)

        row = await svc.create(user_id, _create_payload(name="p1"))

        assert row.user_id == user_id
        assert row.name == "p1"
        assert row.agent_kind == "claude"
        assert row.base_url == "https://api.anthropic.com"
        assert row.model == "claude-sonnet-4"
        assert row.auth_field == "ANTHROPIC_AUTH_TOKEN"  # schema 默认
        assert row.is_default is False
        # 明文 / 密文 / key_id 三列状态正确
        assert row.encrypted_api_key  # 非空 bytes
        assert row.key_id == "v1"

    @pytest.mark.asyncio
    async def test_get_returns_created_provider(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        created = await svc.create(user_id, _create_payload(name="p-get"))

        fetched = await svc.get(created.id, user_id)

        assert fetched.id == created.id
        assert fetched.name == "p-get"

    @pytest.mark.asyncio
    async def test_get_nonexistent_raises_404(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)

        with pytest.raises(LlmProviderNotFound) as exc_info:
            await svc.get(uuid.uuid4(), user_id)

        assert exc_info.value.http_status == 404

    @pytest.mark.asyncio
    async def test_list_returns_only_user_providers(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        a = await svc.create(user_id, _create_payload(name="a"))
        b = await svc.create(user_id, _create_payload(name="b"))

        items = await svc.list_(user_id)

        ids = {i.id for i in items}
        assert ids == {a.id, b.id}
        assert len(items) == 2

    @pytest.mark.asyncio
    async def test_patch_without_api_key_keeps_original_ciphertext(
        self, db_session: AsyncSession
    ) -> None:
        """api_key=None（未传）→ 原密钥密文一字节不动，仅改其它字段。"""
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        created = await svc.create(user_id, _create_payload(name="orig"))
        original_ct = created.encrypted_api_key
        original_key_id = created.key_id

        patched = await svc.update(
            created.id,
            user_id,
            LlmProviderUpdate(name="renamed"),  # 不传 api_key
        )

        assert patched.name == "renamed"
        assert patched.encrypted_api_key == original_ct  # 密文未变
        assert patched.key_id == original_key_id
        # 解出来仍是原明文（确认没被误清空 / 误重加密）
        plain = get_cipher().decrypt(patched.encrypted_api_key, patched.key_id)
        assert plain == "sk-ant-supersecretkey-1234"

    @pytest.mark.asyncio
    async def test_patch_with_new_api_key_re_encrypts(self, db_session: AsyncSession) -> None:
        """显式传 api_key → 重新加密，密文变化且解出新明文。"""
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        created = await svc.create(user_id, _create_payload())
        original_ct = created.encrypted_api_key

        patched = await svc.update(
            created.id, user_id, LlmProviderUpdate(api_key="sk-ant-brandnewkey-9876")
        )

        assert patched.encrypted_api_key != original_ct  # 密文已换
        plain = get_cipher().decrypt(patched.encrypted_api_key, patched.key_id)
        assert plain == "sk-ant-brandnewkey-9876"
        assert plain != "sk-ant-supersecretkey-1234"

    @pytest.mark.asyncio
    async def test_delete_then_get_raises_404(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        created = await svc.create(user_id, _create_payload(name="to-delete"))

        await svc.delete(created.id, user_id)

        with pytest.raises(LlmProviderNotFound):
            await svc.get(created.id, user_id)
        # DB 行确实没了
        assert await db_session.get(LlmProvider, created.id) is None


# ── 加密落盘（D-001）────────────────────────────────────────────────────────


class TestEncryptionAtRest:
    """create 后 ORM encrypted_api_key 非空且 ≠ 明文（明文永不入 ORM，R-04/D-001）。"""

    @pytest.mark.asyncio
    async def test_create_persists_encrypted_api_key_not_plaintext(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        plaintext = "sk-ant-supersecretkey-1234"

        await svc.create(user_id, _create_payload(api_key=plaintext))

        # 直接查 ORM 行（绕过 service._to_read 的 masked 包装）
        stmt = select(LlmProvider).where(LlmProvider.user_id == user_id)
        row = (await db_session.execute(stmt)).scalars().first()
        assert row is not None
        ct = row.encrypted_api_key

        # 1) 密文非空（LargeBinary 有内容）
        assert isinstance(ct, bytes) and len(ct) > 0
        # 2) 密文 ≠ 明文（字节级）
        assert ct != plaintext.encode("utf-8")
        # 3) 明文子串不出现在密文里（防 naive “拼接”式假加密）
        assert plaintext.encode("utf-8") not in ct
        # 4) key_id 落盘
        assert row.key_id == "v1"
        # 5) 解密回环成立（确认是真加密而非乱写）
        assert get_cipher().decrypt(ct, row.key_id) == plaintext

    @pytest.mark.asyncio
    async def test_create_with_empty_api_key_still_encrypts(self, db_session: AsyncSession) -> None:
        """api_key=None → service 走 encrypt("")，密文仍非空（空明文也有密文）。"""
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)

        await svc.create(user_id, _create_payload(api_key=None))

        stmt = select(LlmProvider).where(LlmProvider.user_id == user_id)
        row = (await db_session.execute(stmt)).scalars().first()
        assert row is not None
        assert isinstance(row.encrypted_api_key, bytes) and len(row.encrypted_api_key) > 0
        # 解密为空字符串
        assert get_cipher().decrypt(row.encrypted_api_key, row.key_id) == ""


# ── owner 隔离（D-008）──────────────────────────────────────────────────────


class TestOwnerIsolation:
    """用户 A 全程不能 list/get/patch/delete/set_default 用户 B 的 provider（service WHERE user_id 过滤）。"""

    @pytest.mark.asyncio
    async def test_list_excludes_other_users_providers(self, db_session: AsyncSession) -> None:
        user_a = await _create_user(db_session, label="a")
        user_b = await _create_user(db_session, label="b")
        svc = LlmProviderService(db_session)
        await svc.create(user_b, _create_payload(name="b-only"))

        items = await svc.list_(user_a)

        assert items == []  # A 看不到 B 的 provider

    @pytest.mark.asyncio
    async def test_get_other_users_provider_raises_permission_denied(
        self, db_session: AsyncSession
    ) -> None:
        user_a = await _create_user(db_session, label="a")
        user_b = await _create_user(db_session, label="b")
        svc = LlmProviderService(db_session)
        b_row = await svc.create(user_b, _create_payload(name="b-only"))

        with pytest.raises(PermissionDenied) as exc_info:
            await svc.get(b_row.id, user_a)

        assert exc_info.value.http_status == 403

    @pytest.mark.asyncio
    async def test_patch_other_users_provider_raises_and_does_not_modify(
        self, db_session: AsyncSession
    ) -> None:
        user_a = await _create_user(db_session, label="a")
        user_b = await _create_user(db_session, label="b")
        svc = LlmProviderService(db_session)
        b_row = await svc.create(user_b, _create_payload(name="b-name"))
        original_ct = b_row.encrypted_api_key

        with pytest.raises(PermissionDenied):
            await svc.update(b_row.id, user_a, LlmProviderUpdate(name="hijacked"))

        # B 的行未被改动（名 / 密文都保持原样）
        fresh = await db_session.get(LlmProvider, b_row.id)
        assert fresh is not None
        assert fresh.name == "b-name"
        assert fresh.encrypted_api_key == original_ct

    @pytest.mark.asyncio
    async def test_delete_other_users_provider_raises_and_keeps_row(
        self, db_session: AsyncSession
    ) -> None:
        user_a = await _create_user(db_session, label="a")
        user_b = await _create_user(db_session, label="b")
        svc = LlmProviderService(db_session)
        b_row = await svc.create(user_b, _create_payload(name="b-keep"))

        with pytest.raises(PermissionDenied):
            await svc.delete(b_row.id, user_a)

        # B 的行仍在
        assert await db_session.get(LlmProvider, b_row.id) is not None

    @pytest.mark.asyncio
    async def test_set_default_other_users_provider_raises(self, db_session: AsyncSession) -> None:
        user_a = await _create_user(db_session, label="a")
        user_b = await _create_user(db_session, label="b")
        svc = LlmProviderService(db_session)
        b_row = await svc.create(user_b, _create_payload(name="b-default"))

        with pytest.raises(PermissionDenied):
            await svc.set_default(b_row.id, user_a)

        # B 的 provider 未被 A 设为默认
        fresh = await db_session.get(LlmProvider, b_row.id)
        assert fresh is not None
        assert fresh.is_default is False

    @pytest.mark.asyncio
    async def test_unset_default_other_users_provider_raises(
        self, db_session: AsyncSession
    ) -> None:
        """跨用户 unset_default 被拒且不改数据（owner 级 WHERE user_id 过滤）。"""
        user_a = await _create_user(db_session, label="a")
        user_b = await _create_user(db_session, label="b")
        svc = LlmProviderService(db_session)
        b_row = await svc.create(user_b, _create_payload(name="b-default", is_default=True))

        with pytest.raises(PermissionDenied):
            await svc.unset_default(b_row.id, user_a)

        # B 的默认态未被 A 取消
        fresh = await db_session.get(LlmProvider, b_row.id)
        assert fresh is not None
        assert fresh.is_default is True


# ── is_default 互斥（R-05）──────────────────────────────────────────────────


class TestIsDefaultMutex:
    """同 (user_id, agent_kind) 至多 1 条 is_default=True；不同 agent_kind 互不影响。"""

    @pytest.mark.asyncio
    async def test_create_is_default_clears_sibling_same_agent_kind(
        self, db_session: AsyncSession
    ) -> None:
        """先建 A(claude, default=True)，再建 B(claude, default=True) → A 被清、B 默认。"""
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)

        a = await svc.create(user_id, _create_payload(name="a", is_default=True))
        b = await svc.create(user_id, _create_payload(name="b", is_default=True))

        await db_session.refresh(a)
        await db_session.refresh(b)
        assert a.is_default is False  # 被新默认顶掉
        assert b.is_default is True

    @pytest.mark.asyncio
    async def test_set_default_clears_sibling_same_agent_kind(
        self, db_session: AsyncSession, mock_probe_notify: None
    ) -> None:
        """set_default 链：set_default(A) → set_default(B) → A 清、B 默认。

        task-03：set_default 现调 probe_provider + notify_provider_switch，``mock_probe_notify``
        夹具 patch 两者避免真实网络 / WS（仅验 R-05 互斥 DB 不变量）。
        """
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        a = await svc.create(user_id, _create_payload(name="a"))
        b = await svc.create(user_id, _create_payload(name="b"))

        result_a = await svc.set_default(a.id, user_id)
        await db_session.refresh(b)
        assert a.is_default is True
        assert b.is_default is False
        # task-03：返回 DefaultSwitchResult（probe ok=True → switched=True）
        assert result_a.switched is True
        assert result_a.error is None

        result_b = await svc.set_default(b.id, user_id)
        await db_session.refresh(a)
        assert a.is_default is False  # 被 B 顶掉
        assert b.is_default is True
        assert result_b.switched is True

    @pytest.mark.asyncio
    async def test_at_most_one_default_per_user_agent_kind(
        self, db_session: AsyncSession, mock_probe_notify: None
    ) -> None:
        """任意操作序列下，同 (user_id, agent_kind='claude') 默认数恒 ≤ 1（不变式守护）。

        task-03：``svc.set_default(c.id, ...)`` 调 probe + notify，``mock_probe_notify``
        夹具 patch 两者（``update`` 路径未改造，不需 patch）。
        """
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)

        a = await svc.create(user_id, _create_payload(name="a", is_default=True))
        await svc.create(user_id, _create_payload(name="b", is_default=True))
        c = await svc.create(user_id, _create_payload(name="c"))
        await svc.set_default(c.id, user_id)
        await svc.update(a.id, user_id, LlmProviderUpdate(is_default=True))

        stmt = select(LlmProvider).where(
            LlmProvider.user_id == user_id,
            LlmProvider.agent_kind == "claude",
            LlmProvider.is_default.is_(True),
        )
        defaults = (await db_session.execute(stmt)).scalars().all()
        assert len(defaults) == 1
        # 最后一次 set_default 的是 a（update is_default=True 顶掉了 c）
        assert defaults[0].id == a.id

    @pytest.mark.asyncio
    async def test_set_default_does_not_touch_different_agent_kind(
        self, db_session: AsyncSession
    ) -> None:
        """claude 设默认不会清掉 codex 的默认（agent_kind 维度隔离）。

        schema 限制 create 只能 claude，故 codex 行经 ``_seed_provider_row`` 直插 ORM。
        """
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)

        # 预置一个 codex 默认 provider（直插 ORM 绕过 schema Literal）
        codex_row = await _seed_provider_row(
            db_session, user_id, agent_kind="codex", is_default=True, name="codex-default"
        )
        # 再创建一个 claude 默认 provider（经 service.create）
        claude_row = await svc.create(
            user_id, _create_payload(name="claude-default", is_default=True)
        )

        assert claude_row.is_default is True
        # codex 默认态未被清（不同 agent_kind 不互斥）
        fresh_codex = await db_session.get(LlmProvider, codex_row.id)
        assert fresh_codex is not None
        assert fresh_codex.is_default is True

    @pytest.mark.asyncio
    async def test_unset_default_does_not_clear_siblings(self, db_session: AsyncSession) -> None:
        """patch is_default=False 只清自己，不波及兄弟（清Sibling 仅在置 True 时触发）。"""
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        a = await svc.create(user_id, _create_payload(name="a", is_default=True))
        b = await svc.create(user_id, _create_payload(name="b"))  # default=False

        # 把 A 的默认取消 —— 不应误清 B（B 本就 False），也不应把 A 之外的行改动
        await svc.update(a.id, user_id, LlmProviderUpdate(is_default=False))

        await db_session.refresh(a)
        assert a.is_default is False
        await db_session.refresh(b)
        assert b.is_default is False
        # 此时同组无默认
        stmt = select(LlmProvider).where(
            LlmProvider.user_id == user_id,
            LlmProvider.agent_kind == "claude",
            LlmProvider.is_default.is_(True),
        )
        defaults = (await db_session.execute(stmt)).scalars().all()
        assert defaults == []

    @pytest.mark.asyncio
    async def test_unset_default_clears_active_to_zero(
        self, db_session: AsyncSession, mock_probe_notify: None
    ) -> None:
        """unset_default（cc-switch「停止」）：唯一默认被取消 → 同组默认数归零（全停→本地）。

        task-03：unset_default 现调 notify_provider_switch（推 null 回退本机 D-004），
        ``mock_probe_notify`` 夹具 patch 避免真实 DB JOIN / WS。
        """
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        a = await svc.create(user_id, _create_payload(name="a", is_default=True))
        b = await svc.create(user_id, _create_payload(name="b"))  # default=False

        result = await svc.unset_default(a.id, user_id)
        # task-03：返回 DefaultSwitchResult（unset 不探测，恒 switched=True）
        assert result.switched is True
        assert result.error is None

        await db_session.refresh(a)
        await db_session.refresh(b)
        assert a.is_default is False
        assert b.is_default is False  # 未被波及
        stmt = select(LlmProvider).where(
            LlmProvider.user_id == user_id,
            LlmProvider.agent_kind == "claude",
            LlmProvider.is_default.is_(True),
        )
        defaults = (await db_session.execute(stmt)).scalars().all()
        assert defaults == []  # 全停 → lease 不注入 provider_config（D-007 回归本地）

    @pytest.mark.asyncio
    async def test_unset_default_idempotent_on_non_default(
        self, db_session: AsyncSession, mock_probe_notify: None
    ) -> None:
        """对本就 False 的行 unset_default 是 no-op（幂等，不抛错）。

        task-03 契约更新：unset_default 返回 ``DefaultSwitchResult``（switched /
        affected_sessions / error），不再返回 ORM 行。幂等性体现为多次调用均返回
        ``switched=True`` 且不抛错；DB 行的 ``is_default`` 仍经 ``db_session.refresh``
        验证保持 False。
        """
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        a = await svc.create(user_id, _create_payload(name="a"))  # default=False

        result = await svc.unset_default(a.id, user_id)

        assert result.switched is True
        assert result.affected_sessions == 0  # mock notify 返回 0
        assert result.error is None
        # 行确实仍为 False（幂等：对本就 False 的行是 no-op）
        await db_session.refresh(a)
        assert a.is_default is False
        # 再取消一次仍正常返回（幂等）
        result2 = await svc.unset_default(a.id, user_id)
        assert result2.switched is True
        assert result2.error is None


# ── masked 不回明文（X-09）─────────────────────────────────────────────────


class TestMaskedNoLeak:
    """所有 Read 响应无 api_key 字段，api_key_masked 非空且 ≠ 明文（X-09）。"""

    @pytest.mark.asyncio
    async def test_to_read_has_no_plaintext_field(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        row = await svc.create(user_id, _create_payload(api_key="sk-ant-supersecretkey-1234"))

        read = svc._to_read(row)
        dump = read.model_dump()

        # Read DTO 无 api_key / encrypted_api_key 字段（明文 + 密文都不暴露）
        assert "api_key" not in dump
        assert "encrypted_api_key" not in dump
        assert "key_id" not in dump

    @pytest.mark.asyncio
    async def test_to_read_masked_present_and_not_plaintext(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="a")
        plaintext = "sk-ant-supersecretkey-1234"
        svc = LlmProviderService(db_session)
        row = await svc.create(user_id, _create_payload(api_key=plaintext))

        read = svc._to_read(row)

        assert read.api_key_masked is not None
        assert read.api_key_masked != ""  # 非空
        assert read.api_key_masked != plaintext  # 不回完整明文

    @pytest.mark.asyncio
    async def test_list_to_read_all_masked_no_plaintext(self, db_session: AsyncSession) -> None:
        """list 接口经 _to_read 输出，每个 item 都不回明文。"""
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        await svc.create(user_id, _create_payload(name="a", api_key="sk-ant-aaaaaaaa-1111"))
        await svc.create(user_id, _create_payload(name="b", api_key="sk-ant-bbbbbbbb-2222"))

        items = await svc.list_(user_id)
        reads = [svc._to_read(i) for i in items]

        plaintexts = {"sk-ant-aaaaaaaa-1111", "sk-ant-bbbbbbbb-2222"}
        for r in reads:
            dump = r.model_dump()
            assert "api_key" not in dump
            assert r.api_key_masked is not None
            assert r.api_key_masked not in plaintexts  # masked 不等于任一完整明文

    @pytest.mark.asyncio
    async def test_short_api_key_masked_not_plaintext(self, db_session: AsyncSession) -> None:
        """< 8 位 api_key：masked 仍非空且 ≠ 明文（不重定义格式，只验不泄漏）。"""
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        row = await svc.create(user_id, _create_payload(api_key="abc"))

        read = svc._to_read(row)

        assert read.api_key_masked is not None
        assert read.api_key_masked != "abc"

    @pytest.mark.asyncio
    async def test_empty_api_key_masked_is_none(self, db_session: AsyncSession) -> None:
        """空明文 → masked=None（安全方向：空凭证不展示），但密文仍落盘非空。"""
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        row = await svc.create(user_id, _create_payload(api_key=None))

        read = svc._to_read(row)

        assert read.api_key_masked is None
        # 加密落盘仍成立（空明文也有密文）
        fresh = await db_session.get(LlmProvider, row.id)
        assert fresh is not None
        assert len(fresh.encrypted_api_key) > 0


# ── task-10：凭证失败回滚保留原默认（D-003 关键边界）──────────────────────────
#
# task-10「查漏补缺」：补 task-03 改造的关键边界——凭证探测失败时,service.set_default
# 必须回滚（不改 is_default、不推送），**原默认（如有）继续服务运行中会话**（design G4
# 不破坏）。task-05 router 的 ``test_probe_fail_returns_switched_false`` 只测了新建
# provider 无原默认的分支；本组补「有原默认 A、set_default(B) 探测失败」链路,守护:
#   - A.is_default 保持 True（不被清）;
#   - B.is_default 保持 False（不被置位）;
#   - notify_provider_switch 未被调（rollback 在 step1,notify 在 step3）;
#   - DefaultSwitchResult.switched=False + error 透传。
#
# 同步覆盖 service ``not base_url or not api_key_plain`` 早返分支（缺凭证信号）,
# 该分支在 task-01~09 均无测试。


class TestSetDefaultCredentialsRollback:
    """task-10 / D-003：凭证失败 / 缺凭证 → 回滚不改 DB、不推送、原默认保留。"""

    @pytest.mark.asyncio
    async def test_probe_fail_keeps_existing_default(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """原默认 A 存在 → set_default(B) 探测失败 → A 仍默认、B 未置位、不推送。

        关键守护：set_default step2（清兄弟 + 置本行 True）在 step1 凭证探测失败时
        绝不执行。``_clear_sibling_defaults`` 不会误清 A 的默认。
        """
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        # A 是默认（probe ok=True mock 让 A 设默认成功）。
        a = await svc.create(
            user_id,
            _create_payload(
                name="A-default",
                api_key="sk-ant-validkey-aaaa",
                is_default=True,
            ),
        )
        # B 不是默认（待切换目标，probe 会失败）。
        b = await svc.create(user_id, _create_payload(name="B-bad", api_key="sk-ant-willfail-bbbb"))
        assert a.is_default is True
        assert b.is_default is False

        # mock probe 失败 + spy notify（验证未调用）。
        async def _probe_fail(*_a: object, **_kw: object) -> ProviderProbeResult:
            return ProviderProbeResult(ok=False, error="凭证无效：上游 401")

        notify_calls: list[tuple] = []

        async def _notify_spy(*args: object, **kwargs: object) -> int:
            notify_calls.append((args, kwargs))
            return 0

        monkeypatch.setattr("app.modules.llm_provider.probe.probe_provider", _probe_fail)
        monkeypatch.setattr(
            "app.modules.daemon.lease.provider_switch.notify_provider_switch",
            _notify_spy,
        )

        result = await svc.set_default(b.id, user_id)

        # D-003 回滚：switched=False + error 透传。
        assert result.switched is False
        assert result.error == "凭证无效：上游 401"
        assert result.affected_sessions == 0

        # A 仍是默认（未被 step2 清兄弟误伤）。
        await db_session.refresh(a)
        await db_session.refresh(b)
        assert a.is_default is True
        assert b.is_default is False

        # notify 未被调（rollback 在 step1,notify 在 step3）。
        assert notify_calls == []

    @pytest.mark.asyncio
    async def test_probe_fail_does_not_clear_sibling_when_no_default(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """无原默认 → set_default(B) 探测失败 → 全组默认数仍为 0（无副作用写入）。

        守护 service ``probe_result.ok=False`` 分支不会因任何边界（无原默认）误进入
        step2 写入路径。
        """
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        a = await svc.create(user_id, _create_payload(name="A-none", api_key="sk-x-001"))
        b = await svc.create(user_id, _create_payload(name="B-none", api_key="sk-x-002"))
        assert a.is_default is False
        assert b.is_default is False

        async def _probe_fail(*_a: object, **_kw: object) -> ProviderProbeResult:
            return ProviderProbeResult(ok=False, error="connect refused")

        monkeypatch.setattr("app.modules.llm_provider.probe.probe_provider", _probe_fail)
        monkeypatch.setattr(
            "app.modules.daemon.lease.provider_switch.notify_provider_switch",
            lambda *_a, **_kw: 0,
        )

        result = await svc.set_default(b.id, user_id)
        assert result.switched is False
        assert result.error == "connect refused"

        # 全组默认数仍为 0（无任何写入）。
        stmt = select(LlmProvider).where(
            LlmProvider.user_id == user_id,
            LlmProvider.agent_kind == "claude",
            LlmProvider.is_default.is_(True),
        )
        defaults = (await db_session.execute(stmt)).scalars().all()
        assert defaults == []

    @pytest.mark.asyncio
    async def test_missing_base_url_returns_not_switched(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """base_url=None → service 缺凭证信号分支 → switched=False + 标准缺凭证文案。

        守护 service ``not base_url or not api_key_plain`` 早返分支（task-03 加入,
        task-01~09 均未覆盖）。probe / notify 均不应被调（早返在 probe 之前）。
        """
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        # 直接插 ORM 绕过 schema（schema 允许 base_url=None,但需显式不传）。
        cipher = get_cipher()
        ct, key_id = cipher.encrypt("sk-needbaseurl-1234")
        from app.modules.llm_provider.model import LlmProvider as _Provider

        row = _Provider(
            id=uuid.uuid4(),
            user_id=user_id,
            name="no-base-url",
            agent_kind="claude",
            encrypted_api_key=ct,
            key_id=key_id,
            base_url=None,  # 缺 base_url
            auth_field="ANTHROPIC_AUTH_TOKEN",
            is_default=False,
        )
        db_session.add(row)
        await db_session.commit()
        await db_session.refresh(row)

        # spy probe + notify（两者均不应被调）。
        probe_calls: list[tuple] = []
        notify_calls: list[tuple] = []

        async def _probe_spy(*args: object, **kwargs: object) -> ProviderProbeResult:
            probe_calls.append((args, kwargs))
            return ProviderProbeResult(ok=True)

        async def _notify_spy(*args: object, **kwargs: object) -> int:
            notify_calls.append((args, kwargs))
            return 0

        monkeypatch.setattr("app.modules.llm_provider.probe.probe_provider", _probe_spy)
        monkeypatch.setattr(
            "app.modules.daemon.lease.provider_switch.notify_provider_switch",
            _notify_spy,
        )

        result = await svc.set_default(row.id, user_id)

        assert result.switched is False
        assert result.affected_sessions == 0
        # 标准缺凭证文案（service 层统一）。
        assert result.error is not None
        assert "base_url" in result.error or "API Key" in result.error
        # 早返在 probe 之前 → probe / notify 均未调用。
        assert probe_calls == []
        assert notify_calls == []
        # DB 行未被改动。
        await db_session.refresh(row)
        assert row.is_default is False

    @pytest.mark.asyncio
    async def test_missing_api_key_returns_not_switched(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """api_key 为空明文（cipher 加密 ""）→ 缺凭证信号 → switched=False。

        守护 ``not api_key_plain`` 分支（与 base_url 同分支,独立 case 守护文案归属）。
        """
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        # 用 service.create 走真实加密（api_key=None → encrypt("")）。
        row = await svc.create(
            user_id,
            _create_payload(
                name="empty-key",
                api_key=None,
                base_url="https://api.anthropic.com",
            ),
        )

        probe_calls: list[tuple] = []
        notify_calls: list[tuple] = []

        async def _probe_spy(*args: object, **kwargs: object) -> ProviderProbeResult:
            probe_calls.append((args, kwargs))
            return ProviderProbeResult(ok=True)

        async def _notify_spy(*args: object, **kwargs: object) -> int:
            notify_calls.append((args, kwargs))
            return 0

        monkeypatch.setattr("app.modules.llm_provider.probe.probe_provider", _probe_spy)
        monkeypatch.setattr(
            "app.modules.daemon.lease.provider_switch.notify_provider_switch",
            _notify_spy,
        )

        result = await svc.set_default(row.id, user_id)

        assert result.switched is False
        assert result.affected_sessions == 0
        assert result.error is not None
        assert "API Key" in result.error or "base_url" in result.error
        assert probe_calls == []
        assert notify_calls == []

    @pytest.mark.asyncio
    async def test_set_default_success_dispatches_notify(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """对照：probe ok=True → notify 被调一次（正向链路,锁定 rollback 测试组的行为基线）。

        与上面 rollback 测试对照：探测成功时 service 必经 step2 → step3,notify 必被调,
        参数为 (session, user_id, provider_config dict)。这把「未调 notify」断言锁死
        为「rollback 真未调」而非「mock 装错」。
        """
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        a = await svc.create(
            user_id,
            _create_payload(name="A-ok", api_key="sk-ant-okaykey-0011"),
        )

        async def _probe_ok(*_a: object, **_kw: object) -> ProviderProbeResult:
            return ProviderProbeResult(ok=True)

        notify_calls: list[tuple] = []

        async def _notify_spy(*args: object, **kwargs: object) -> int:
            notify_calls.append((args, kwargs))
            return 2  # 模拟 2 条 active session 投递成功

        monkeypatch.setattr("app.modules.llm_provider.probe.probe_provider", _probe_ok)
        monkeypatch.setattr(
            "app.modules.daemon.lease.provider_switch.notify_provider_switch",
            _notify_spy,
        )

        result = await svc.set_default(a.id, user_id)

        # 成功：switched=True,affected_sessions 透传 notify 返回值。
        assert result.switched is True
        assert result.affected_sessions == 2
        assert result.error is None
        # notify 被调一次,参数含 user_id + provider_config dict（非 None）。
        assert len(notify_calls) == 1
        args, _kwargs = notify_calls[0]
        # (session, user_id, provider_config) 位置参数。
        provider_config = args[2]
        assert isinstance(provider_config, dict)
        assert "api_key" in provider_config
        assert provider_config["agent_kind"] == "claude"
