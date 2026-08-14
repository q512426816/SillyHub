"""ensure_system_default_profiles 单测（task-11 / D-015）。

覆盖 plan task-11 acceptance：
* 空库启动 → 补种 2 条（claude + codex），全 ``is_system_default`` / ``platform``。
* 已存在（重复调用）→ 返回 0，无重复行（idempotent）。
* 删一条 → 再调仅补种 1 条被删 provider，另一条不动。
* 用户对默认档案的改动（name / system_prompt）**不被覆盖**。
* 与迁移 task-01 同种子共存：迁移已落的默认档案 + 本 hook 再调 = 0 补种、无重复。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility
from app.modules.agent.profile.seed import (
    ensure_role_template_profiles,
    ensure_system_default_profiles,
)


async def _all_profiles(session) -> list[AgentProfile]:
    return list((await session.execute(select(AgentProfile))).scalars().all())


async def test_seed_empty_db_plants_two_defaults(db_session) -> None:
    """空库调用一次补种两条默认档案，字段对齐迁移 task-01 首次 seed。"""

    count = await ensure_system_default_profiles(db_session)

    assert count == 2
    rows = await _all_profiles(db_session)
    assert len(rows) == 2

    by_provider = {r.provider: r for r in rows}
    assert set(by_provider) == {"claude", "codex"}

    for provider, row in by_provider.items():
        assert row.is_system_default is True
        assert row.visibility == AgentProfileVisibility.PLATFORM
        assert row.version == 1
        assert row.owner_user_id is None
        assert row.workspace_id is None
        # 与迁移 task-01 seed 的 name 一致（身份字段）。
        assert row.name == {"claude": "Claude Code 默认", "codex": "Codex 默认"}[provider]


@pytest.mark.parametrize("repeat", [1, 2, 3])
async def test_seed_idempotent_on_repeat_calls(db_session, repeat: int) -> None:
    """已补齐后重复调用返回 0 且不产生重复行（核心 idempotent 契约）。"""

    await ensure_system_default_profiles(db_session)  # 首次补齐

    for _ in range(repeat):
        again = await ensure_system_default_profiles(db_session)
        assert again == 0

    rows = await _all_profiles(db_session)
    assert len(rows) == 2
    assert {r.provider for r in rows} == {"claude", "codex"}


async def test_seed_only_replants_deleted_provider(db_session) -> None:
    """删掉 claude 默认档案后，仅补种 claude 一条，codex 原行不动。"""

    await ensure_system_default_profiles(db_session)
    before = await _all_profiles(db_session)
    codex_row = next(r for r in before if r.provider == "codex")
    claude_row = next(r for r in before if r.provider == "claude")

    # 误删 claude 默认档案。
    await db_session.delete(claude_row)
    await db_session.commit()

    count = await ensure_system_default_profiles(db_session)

    assert count == 1
    after = await _all_profiles(db_session)
    assert len(after) == 2
    assert {r.provider for r in after} == {"claude", "codex"}

    # codex 原行未受影响（同 id）。
    codex_after = next(r for r in after if r.provider == "codex")
    assert codex_after.id == codex_row.id
    # 新补的 claude 是新 id（非复活旧 id）。
    claude_after = next(r for r in after if r.provider == "claude")
    assert claude_after.id != claude_row.id
    assert claude_after.is_system_default is True


async def test_seed_does_not_overwrite_user_edits(db_session) -> None:
    """用户改过默认档案的 name / system_prompt，补种不得覆盖（去重命中即跳过）。"""

    await ensure_system_default_profiles(db_session)
    claude_row = next(r for r in await _all_profiles(db_session) if r.provider == "claude")
    claude_row.name = "我的 Claude 人格"
    claude_row.system_prompt = "你是一名资深工程师"
    await db_session.commit()

    count = await ensure_system_default_profiles(db_session)

    assert count == 0
    await db_session.refresh(claude_row)
    assert claude_row.name == "我的 Claude 人格"
    assert claude_row.system_prompt == "你是一名资深工程师"
    # 仍只两条，无重复。
    assert len(await _all_profiles(db_session)) == 2


async def test_seed_coexists_with_migration_style_rows(db_session) -> None:
    """模拟迁移 task-01 已落的默认档案（is_system_default + provider）共存场景。

    场景：升级后迁移已 seed，服务重启本 hook 再跑 → 应识别为已存在，0 补种、
    无重复。用直接落库模拟迁移产物（不依赖 alembic），验证 hook 与迁移同种子
    的去重契约。
    """

    db_session.add_all(
        [
            AgentProfile(
                id=uuid.uuid4(),
                name="Claude Code 默认",
                provider="claude",
                visibility=AgentProfileVisibility.PLATFORM,
                is_system_default=True,
                version=1,
            ),
            AgentProfile(
                id=uuid.uuid4(),
                name="Codex 默认",
                provider="codex",
                visibility=AgentProfileVisibility.PLATFORM,
                is_system_default=True,
                version=1,
            ),
        ]
    )
    await db_session.commit()

    count = await ensure_system_default_profiles(db_session)

    assert count == 0
    assert len(await _all_profiles(db_session)) == 2


async def test_seed_ignores_non_system_default_profiles(db_session) -> None:
    """用户自建的同 provider 非 system_default 档案不算「已存在」，仍需补默认。

    去重键是 ``is_system_default=True`` + provider：用户私有 claude 档案不应
    阻止平台默认档案的补种（design §8 兜底链依赖 is_system_default 预置档）。
    """

    db_session.add(
        AgentProfile(
            id=uuid.uuid4(),
            name="我的私有 claude",
            provider="claude",
            visibility=AgentProfileVisibility.PRIVATE,
            is_system_default=False,
        )
    )
    await db_session.commit()

    count = await ensure_system_default_profiles(db_session)

    # claude 默认仍缺（私有的不算），补 2 条。
    assert count == 2
    rows = await _all_profiles(db_session)
    assert len(rows) == 3


# ─────────────────────────────────────────────────────────────────────────────
# 角色模板测试（CC/GLM 均已下线：0 补种 + 回收 GLM×5 + CC×5）
# ─────────────────────────────────────────────────────────────────────────────


async def test_role_templates_seed_empty_db_inserts_zero(db_session) -> None:
    """空库调用：角色模板已下线，补种 0、回收 0，库内无任何角色模板。"""

    inserted, pruned = await ensure_role_template_profiles(db_session)

    assert inserted == 0
    assert pruned == 0
    rows = await _all_profiles(db_session)
    assert rows == []


@pytest.mark.parametrize("repeat", [1, 2, 3])
async def test_role_templates_seed_idempotent(db_session, repeat: int) -> None:
    """角色模板下线后重复调用恒返回 (0, 0)，无副作用。"""

    for _ in range(repeat):
        inserted, pruned = await ensure_role_template_profiles(db_session)
        assert inserted == 0
        assert pruned == 0

    rows = await _all_profiles(db_session)
    assert rows == []


async def test_role_templates_coexist_with_system_defaults(db_session) -> None:
    """系统默认档案照常补 2 条；角色模板已下线，补种 0，互不干扰。"""

    default_count = await ensure_system_default_profiles(db_session)
    template_inserted, template_pruned = await ensure_role_template_profiles(db_session)

    assert default_count == 2
    assert template_inserted == 0
    assert template_pruned == 0

    rows = await _all_profiles(db_session)
    assert len(rows) == 2
    assert {r.provider for r in rows if r.is_system_default} == {"claude", "codex"}
    # 角色模板已下线：无任何非 system_default 平台模板残留。
    assert [r for r in rows if not r.is_system_default] == []


async def test_role_templates_prune_deprecated_glm_and_cc(db_session) -> None:
    """已下线 GLM/CC 模板（曾种、现从清单移除）启动时全量回收，用户档案不动。

    场景：升级前 DB 残留旧版补种的 GLM × 5 + CC × 5 模板（确定性 UUID）；新版 ensure
    不再补任何角色模板，且按 _DEPRECATED_ROLE_TEMPLATE_IDS 回收全部 10 条。用户自建
    的同 provider 档案（uuid4 id）不在废弃清单，不受影响。
    """
    from app.modules.agent.profile.seed import _DEPRECATED_ROLE_TEMPLATE_IDS

    # _DEPRECATED_ROLE_TEMPLATE_IDS 现含 GLM×5 + CC×5 = 10 条。
    assert len(_DEPRECATED_ROLE_TEMPLATE_IDS) == 10

    # 模拟旧版残留：直接落库全部 10 条废弃模板（确定性 UUID，与旧版 ensure 产物同 id）。
    # provider 字段为填充值——回收按确定性 id，不依赖 provider。
    for i, dep_id in enumerate(_DEPRECATED_ROLE_TEMPLATE_IDS):
        db_session.add(
            AgentProfile(
                id=dep_id,
                name=f"残留模板 {i}",
                provider="glm" if i % 2 == 0 else "claude",
                visibility=AgentProfileVisibility.PLATFORM,
                is_system_default=False,
                version=1,
            )
        )
    # 用户自建的 claude 档案（uuid4，不在废弃清单）——必须保留。
    user_claude = AgentProfile(
        id=uuid.uuid4(),
        name="我的私有 claude",
        provider="claude",
        visibility=AgentProfileVisibility.PRIVATE,
    )
    db_session.add(user_claude)
    await db_session.commit()

    inserted, pruned = await ensure_role_template_profiles(db_session)

    # 角色模板已下线 → 补种 0；GLM×5 + CC×5 残留全部回收。
    assert inserted == 0
    assert pruned == 10

    rows = await _all_profiles(db_session)
    by_id = {r.id for r in rows}
    # 10 条废弃模板全部消失。
    assert _DEPRECATED_ROLE_TEMPLATE_IDS.isdisjoint(by_id)
    # 用户自建 claude 档案保留。
    assert user_claude.id in by_id
    # 剩余仅 1 条用户档案。
    assert len(rows) == 1
    assert rows[0].name == "我的私有 claude"
