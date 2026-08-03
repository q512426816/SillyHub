"""启动 idempotent 补种平台默认 AgentProfile（D-015 / design §11）。

Change ``2026-08-02-agent-profile-layer`` task-11。迁移 task-01 已在新环境首次
seed 两默认档案；本模块挂在 ``main.lifespan`` startup，负责**重启补种**——若默认
档案被误删（或库非经迁移新建），启动时按 ``is_system_default=True`` + ``provider``
去重补回，不覆盖用户对默认档案的改动（如改了 system_prompt / name），不产生重复行。

铁律（对齐 plan task-11 constraints）：
* **idempotent**——重复调用不产生重复行（按 ``is_system_default`` + ``provider`` 去重）。
* **仅补缺失的系统默认**——不覆盖、不重置已存在默认档案的任何字段。
* **不存密钥**（design §10 红线）——默认档案仅含 provider / name，无凭证。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility

# ────────────────────────────────────────────────────────────────────────────
# 平台预置默认档案清单（与 task-01 迁移首次 seed 一一对齐）。
# 仅 provider / name 是去重与身份字段；其余字段走 model 默认（version=1、
# mcp_refs/skill_refs=[]、model/system_prompt/tool_policy_id/allowed_roots_overlay=None、
# owner_user_id/workspace_id=None）。顺序决定补种落库顺序，与迁移 bulk_insert 一致。
# ────────────────────────────────────────────────────────────────────────────
_SYSTEM_DEFAULT_PROFILES: tuple[dict[str, str], ...] = (
    {"provider": "claude", "name": "Claude Code 默认"},
    {"provider": "codex", "name": "Codex 默认"},
)
_DEFAULT_PROVIDER_SET: frozenset[str] = frozenset(p["provider"] for p in _SYSTEM_DEFAULT_PROFILES)


async def ensure_system_default_profiles(session: AsyncSession) -> int:
    """补种缺失的平台默认 AgentProfile，返回本次补种数量。

    查询当前 ``is_system_default=True`` 且 ``provider ∈ {claude, codex}`` 的档案，
    对缺失的 provider 按 :data:`_SYSTEM_DEFAULT_PROFILES` 落库一条；已存在的
    provider（无论 name 是否被用户改过）一律跳过——**不覆盖用户改动**。

    本函数在有插入时内部 ``commit``（对齐 startup bootstrap 范式），调用方无需
    再 commit。幂等：对已补齐的库重复调用返回 ``0`` 且无副作用，适合挂在每次启动
    的 lifespan startup 序列上。
    """

    stmt = select(AgentProfile.provider).where(
        AgentProfile.is_system_default.is_(True),
        AgentProfile.provider.in_(_DEFAULT_PROVIDER_SET),
    )
    existing_providers: set[str] = set((await session.execute(stmt)).scalars().all())

    inserted = 0
    for default in _SYSTEM_DEFAULT_PROFILES:
        if default["provider"] in existing_providers:
            continue
        session.add(
            AgentProfile(
                name=default["name"],
                provider=default["provider"],
                visibility=AgentProfileVisibility.PLATFORM,
                is_system_default=True,
                version=1,
                owner_user_id=None,
                workspace_id=None,
            )
        )
        inserted += 1

    if inserted:
        await session.commit()
    return inserted
