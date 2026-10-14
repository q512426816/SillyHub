"""启动 idempotent 补种平台默认 AgentProfile（D-015 / design §11）、角色模板回收
与平台预置「SillySpec 极速变更」档案。

Change ``2026-08-02-agent-profile-layer`` task-11。迁移 task-01 已在新环境首次
seed 两默认档案；本模块挂在 ``main.lifespan`` startup，负责**重启补种**——若默认
档案被误删（或库非经迁移新建），启动时按 ``is_system_default=True`` + ``provider``
去重补回，不覆盖用户对默认档案的改动（如改了 system_prompt / name），不产生重复行。

另含 ``ensure_role_template_profiles``：角色模板已全部下线（CC/GLM 均移除，
见 ql-20260814-001），现仅按 :data:`_DEPRECATED_ROLE_TEMPLATE_IDS` 回收 DB 中
曾补种的废弃模板（GLM×5 + CC×5），不再补种。

``ensure_sillyspec_express_profile``（2026-10-14-agent-profile-express-preset）：
按确定性 uuid5 id 补种平台预置「SillySpec 极速变更」档案——platform 可见 +
``is_system_default=False``，只进档案选择列表（用户主动选用），不进 dispatch
兜底链；同样仅补缺失、不覆盖用户改动。

铁律（对齐 plan task-11 constraints）：
* **idempotent**——重复调用不产生重复行（系统默认按 ``is_system_default`` + ``provider``
  去重；角色模板按确定性 ``id`` 去重；极速预置档案按确定性 ``id`` 查缺）。
* **仅补缺失**——不覆盖、不重置已存在档案的任何字段。
* **不存密钥**（design §10 红线）——默认档案、模板与预置档案均仅含人格/纪律描述，
  无凭证。
"""

from __future__ import annotations

import uuid

from sqlalchemy import delete, select
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


# ────────────────────────────────────────────────────────────────────────────
# 平台预置「SillySpec 极速变更」档案（2026-10-14-agent-profile-express-preset）。
#
# 单条通用执行纪律档案：platform 可见 + ``is_system_default=False``——只进档案
# 选择列表（用户在会话/任务里**主动选用**），不进 dispatch 兜底链第三档
# （``resolve_profile`` 只按 is_system_default 命中），未选档案的会话/任务行为
# 零变化。身份用确定性 uuid5（同角色模板机制）：跨环境稳定，误删后重启按同 id
# 补回；管理员改过字段（name/system_prompt 等）一律跳过不回写。
# ────────────────────────────────────────────────────────────────────────────

_PRESET_NAMESPACE: uuid.UUID = uuid.uuid5(uuid.NAMESPACE_OID, "sillyhub.agent.presets")

# 确定性身份键：uuid5(NAMESPACE_OID, "sillyhub.agent.presets:sillyspec-express-change")。
EXPRESS_PRESET_PROFILE_ID: uuid.UUID = uuid.uuid5(_PRESET_NAMESPACE, "sillyspec-express-change")

_EXPRESS_PRESET_SYSTEM_PROMPT: str = (
    "你是 SillyHub 平台的「SillySpec 极速变更」执行档案：一个通用执行者，纪律是"
    "所有代码修改必须走目标仓库的 SillySpec 轻量变更（极速）通道——先立项、再动手、"
    "完成即收口，绝不裸改代码。\n"
    "\n"
    "收到代码修改请求后按以下协议执行：\n"
    "\n"
    "一、定级\n"
    "- 小修复/小调整（目标明确、改动局部、成功标准能逐条说清）：走下方极速通道。\n"
    "- 新功能/大改动/架构性改动：禁止降级进极速通道，明确告知用户应改走完整流程"
    "（brainstorm → plan → execute → verify），等用户确认后再动手。\n"
    "\n"
    "二、极速通道（sillyspec 轻量变更，两调用协议）\n"
    "1. 立项（在仓库根目录执行）：\n"
    'sillyspec flow start --change <变更名> --input "<动机与背景一行>\n'
    "\n"
    "成功标准：\n"
    '- <可验证标准，一行一条>"\n'
    "   变更名带当天日期前缀（如 2026-10-14-fix-login-redirect），与已有活跃变更"
    "不重名（不确定先跑 sillyspec progress show 查看）。成功标准必须逐行一条"
    "「- 」，禁止单行内联（清晰度门会拒绝）。\n"
    "2. 干活：按 文档依据 → 读现有代码 → 写测试 → 写实现 → 跑相关测试 的顺序执行；"
    "只跑与本次改动相关的测试，禁止跑全量测试（全量留给 CI）。\n"
    "3. 收口：sillyspec flow done --change <变更名>；exit 1（空槽拒收/实测失败"
    "自动升厚）属正常中间态，按输出修复后重跑同一命令断点续。\n"
    "4. 提交：Conventional Commits（中文 subject），只提交本变更相关文件，"
    "不提交半成品；提交被 hook 拦截时修复问题后重试，禁止 --no-verify 绕过。\n"
    "\n"
    "三、纪律\n"
    "- sillyspec 命令一律在仓库根目录执行，禁止 cd 进子目录或 worktree（读代码用"
    "绝对路径）。\n"
    "- 多个活跃变更并存：所有 sillyspec 命令显式 --change <变更名> 隔离，永不重置"
    "/清零别人的 change。\n"
    "- 预段同意门被拦（提示 route-hindsight）：确信需求已含决策加 --no-prestage "
    "放行；不清晰则先 sillyspec run brainstorm --change <变更名>，完成后回来重新 "
    "flow start 收编。\n"
    "- 目标仓库没有 .sillyspec 或 CLAUDE.md 未启用 SillySpec：向用户说明情况，"
    "按该仓库自身规范直接干活，不强行套用本协议。"
)


async def ensure_sillyspec_express_profile(session: AsyncSession) -> int:
    """补种平台预置「SillySpec 极速变更」档案，返回本次补种数量（0/1）。

    按确定性 id（:data:`EXPRESS_PRESET_PROFILE_ID`）查缺：行缺失才落库；已存在
    （含管理员改过任意字段）一律跳过，不回写不覆盖。platform 可见 +
    ``is_system_default=False``——只进档案选择列表（用户主动选用），不进
    dispatch 兜底链（``resolve_profile`` 第三档只按 is_system_default 命中）。

    本函数在有插入时内部 ``commit``，调用方无需再 commit。幂等：重复调用返回
    ``0`` 且无副作用，适合挂在每次启动的 lifespan startup seed 序列上。
    """
    existing = await session.get(AgentProfile, EXPRESS_PRESET_PROFILE_ID)
    if existing is not None:
        return 0
    session.add(
        AgentProfile(
            id=EXPRESS_PRESET_PROFILE_ID,
            name="SillySpec 极速变更",
            provider="claude",
            visibility=AgentProfileVisibility.PLATFORM,
            is_system_default=False,
            version=1,
            owner_user_id=None,
            workspace_id=None,
            system_prompt=_EXPRESS_PRESET_SYSTEM_PROMPT,
        )
    )
    await session.commit()
    return 1


# ────────────────────────────────────────────────────────────────────────────
# 平台专家角色模板（已全部下线）。
#
# 历史曾按 供应商 × 角色 维度补种平台级专家模板（CC/GLM × 5 角色），以确定性 UUID
# （uuid5）为身份键、visibility=platform、is_system_default=False。CC/GLM 均已从
# _ROLE_TEMPLATE_PROVIDERS 移除（GLM 见 ql-20260813-005，CC 见 ql-20260814-001），
# _build_role_template_profiles 现返回 []、ensure 不再补种。
#
# 已下线模板由 _DEPRECATED_ROLE_TEMPLATE_IDS 登记，ensure 启动时回收 DB 残留，
# 避免孤儿模板（见 ensure_role_template_profiles）。
# ────────────────────────────────────────────────────────────────────────────

_ROLE_TEMPLATE_NAMESPACE: uuid.UUID = uuid.uuid5(
    uuid.NAMESPACE_OID, "sillyhub.agent.role.templates"
)

# 角色模板供应商已全部下线（CC/GLM 均移除）。保留结构空置备未来按需重启；
# _build_role_template_profiles 当前返回 []，ensure 不再补种任何角色模板。
_ROLE_TEMPLATE_PROVIDERS: tuple[tuple[str, str, str], ...] = ()

_ROLE_TEMPLATE_ROLES: tuple[tuple[str, str, str], ...] = (
    # (role_key, display_name, role_specific_prompt)
    (
        "architect",
        "架构师",
        "你是一名资深系统架构师。职责包括：梳理业务需求并转化为清晰的技术方案；"
        "负责高层模块划分、接口契约、数据模型与核心算法选型；评估性能、安全、可扩展"
        "性与可运维性；识别跨模块依赖与风险，给出可演进的架构决策；输出架构文档、"
        "决策记录（ADR）与关键伪代码/接口草图。做决定时权衡多方案，优先保持简洁与"
        "可回滚。",
    ),
    (
        "frontend",
        "前端工程师",
        "你是一名资深前端工程师。职责包括：基于 React/Next.js/TypeScript 构建高质量"
        "UI 组件与页面；管理状态、路由、服务端渲染与性能优化；保障可访问性（a11y）与"
        "响应式体验；与后端 API 对接并处理错误、加载、空态等边界；编写单元测试与组件"
        "测试；遵循项目组件库与设计系统，保持代码可维护。",
    ),
    (
        "backend",
        "后端工程师",
        "你是一名资深后端工程师。职责包括：基于 Python/FastAPI/SQLModel 设计并实现"
        "高可靠 API、业务逻辑与数据模型；处理并发、事务、缓存、权限与异常；编写"
        "单元/集成测试，保障接口契约与行为稳定；关注性能、安全、可观测性与可扩展性；"
        "与前端、daemon、LLM 网关等模块协作，确保端到端数据流正确。",
    ),
    (
        "pm",
        "项目经理",
        "你是一名资深项目经理 / Scrum Master。职责包括：拆解需求、定义验收标准与可"
        "交付物；制定任务优先级、里程碑与排期；识别风险、依赖与阻塞，推动沟通与决策；"
        "协调前后端、测试、产品等角色协作；跟踪进度并确保交付质量；在变更范围蔓延时"
        "及时提出并建议折中方案。",
    ),
    (
        "qa",
        "测试工程师",
        "你是一名资深测试工程师 / QA。职责包括：制定测试策略与覆盖目标；设计功能、"
        "边界、异常与回归测试用例；编写自动化测试（单元/集成/E2E），并维护测试数据"
        "与 Mock；执行探索性测试，定位并清晰报告缺陷；推动质量门禁与 CI 集成；在交付"
        "前给出客观的质量评估与风险说明。",
    ),
)


# 已下线角色模板的确定性 id：曾由 ensure 补种、现已从 _ROLE_TEMPLATE_PROVIDERS 移除的
# 供应商（GLM + CC）× 全部角色。ensure 启动时按此清单回收 DB 残留——新环境无残留删 0
# 条；严格限定 namespace 内已知废弃 id，绝不触碰用户自建的 uuid4 档案或其复制品。
_DEPRECATED_ROLE_TEMPLATE_IDS: frozenset[uuid.UUID] = frozenset(
    uuid.uuid5(_ROLE_TEMPLATE_NAMESPACE, f"{provider}:{role_key}")
    for provider in ("glm", "claude")  # 均已下线
    for role_key, _, _ in _ROLE_TEMPLATE_ROLES
)


def _build_role_template_profiles() -> list[AgentProfile]:
    """按供应商 × 角色构造平台角色模板档案（含确定性 id）。

    _ROLE_TEMPLATE_PROVIDERS 已清空（CC/GLM 均下线），当前返回 ``[]``；
    保留遍历逻辑备未来按需重启角色模板。
    """
    profiles: list[AgentProfile] = []
    for provider_key, label, preamble in _ROLE_TEMPLATE_PROVIDERS:
        for role_key, role_name, role_prompt in _ROLE_TEMPLATE_ROLES:
            profile_id = uuid.uuid5(_ROLE_TEMPLATE_NAMESPACE, f"{provider_key}:{role_key}")
            profiles.append(
                AgentProfile(
                    id=profile_id,
                    name=f"{label} {role_name}",
                    provider=provider_key,
                    visibility=AgentProfileVisibility.PLATFORM,
                    system_prompt=f"{preamble}\n\n{role_prompt}",
                    is_system_default=False,
                    version=1,
                    owner_user_id=None,
                    workspace_id=None,
                )
            )
    return profiles


async def ensure_role_template_profiles(session: AsyncSession) -> tuple[int, int]:
    """回收已废弃平台角色模板，返回 ``(本次补种数, 本次回收数)``。

    补种：_ROLE_TEMPLATE_PROVIDERS 已清空（CC/GLM 均下线），当前恒补种 0 条；
    保留去重插入逻辑备未来按需重启。

    回收：删除 :data:`_DEPRECATED_ROLE_TEMPLATE_IDS` 中登记的废弃模板（曾种、现已从
    :data:`_ROLE_TEMPLATE_PROVIDERS` 移除的供应商模板，GLM × 5 + CC × 5 共 10 条）。
    严格限定确定性 id，不触碰用户自建的 uuid4 档案或其复制品；新环境无残留时回收 0 条。

    函数内部 ``commit``，调用方无需再 commit。幂等：对无废弃残留的库重复调用返回
    ``(0, 0)`` 且无副作用，适合挂在每次启动的 lifespan startup 序列上。
    """
    desired_profiles = _build_role_template_profiles()
    desired_ids = {p.id for p in desired_profiles}

    stmt = select(AgentProfile.id).where(AgentProfile.id.in_(desired_ids))
    existing_ids: set[uuid.UUID] = set((await session.execute(stmt)).scalars().all())

    inserted = 0
    for profile in desired_profiles:
        if profile.id in existing_ids:
            continue
        session.add(profile)
        inserted += 1

    # 回收已废弃模板（曾种、现已从清单移除，GLM × 5 + CC × 5 共 10 条）。
    prune_result = await session.execute(
        delete(AgentProfile).where(AgentProfile.id.in_(_DEPRECATED_ROLE_TEMPLATE_IDS))
    )
    pruned = prune_result.rowcount or 0

    if inserted or pruned:
        await session.commit()
    return inserted, pruned
