"""inject/create 附件管线（task-08 拆分，原 :2836-3001 + create 附件段抽出）。

四件套（校验 / gate 解析 / payload 组装 / 锁外预组装）+ create 路径两段
（首句附件校验、写事务内回填组装）+ inject 写事务组装段
（``_finalize_inject_turn_writes``：附件 draft→bound/gate 复核/payload 组装
+ 切换轮 lease metadata 同步 + providerConfig 构造，自 _inject_into_session
:3976-4114 拆出，task-08 行数均衡落位于此）。全部为分步函数，调用点语义
逐字节不变；第一参数传 service 实例（svc）。D-007：_merge_lease_metadata
调用点经 ``_svc.`` 延迟解析。task-11 轻重构⑤：归属/数量校验、gate 解析、
MinIO 组装三个核心收敛到 ``daemon/attachment_pipeline``（与 group 侧单源，
错误族与引擎门控留本链路）。
"""

from __future__ import annotations

import uuid
from typing import NamedTuple

from sqlalchemy import select

import app.modules.daemon.session.service as _svc
from app.core.errors import AppError
from app.modules.agent.model import AgentSession
from app.modules.agent.provider_caps import get_provider_caps
from app.modules.daemon import attachment_pipeline

from .errors import (
    DaemonSessionAttachmentInvalid,
    DaemonSessionAttachmentsUnsupported,
    DaemonSessionConfigInvalid,
    DaemonSessionNotFound,
)
from .results import _PrelockedInjectAttachments


async def _validate_inject_attachment_rows(
    svc,
    *,
    session_id: uuid.UUID,
    session_user_id: uuid.UUID,
    session_provider: str,
    attachment_ids: list[uuid.UUID],
) -> list:
    """附件校验（2026-08-20 task-05 D-6 三层门控：引擎 / 归属 404 / 数量 422）。

    P1（2026-08-25 会话路径二审 #1）：从 _inject_into_session 锁内抽出为共享
    helper——取锁前预组装（:meth:`_preassemble_inject_attachments`）与锁内
    兜底（service 身份路径 / 直调方不带预组装时）复用同一判定，语义不变。
    附件归属约束在附件行自身（``user_id``）、引擎建后不可变，均不依赖会话
    行可变状态，前后置判定等价。

    task-11 轻重构⑤：归属/数量/保序核心收敛到
    ``daemon/attachment_pipeline.validate_owned_attachments``（错误族经工厂
    回调保留在本链路语义：缺失/跨用户 404 资源隐藏、数量超限 422）。
    """
    # provider-abstraction task-11：引擎门控收敛查 ProviderCaps（multimodal
    # 键；文案逐字保留，与原 != "claude" 判定等价）。
    if not get_provider_caps(session_provider)["multimodal"]:
        raise DaemonSessionAttachmentsUnsupported(
            "此引擎不支持会话附件（仅 Claude 支持多模态与文件注入）。",
            details={"session_id": str(session_id), "provider": session_provider},
        )
    from app.modules.session_attachment.service import (
        MAX_FILES_PER_MESSAGE,
        MAX_IMAGES_PER_MESSAGE,
    )

    def _not_found() -> AppError:
        # 缺失/跨用户归一 404（资源隐藏语义，不泄露存在性）。
        return DaemonSessionNotFound(
            "部分附件不存在或无权访问。",
            details={"session_id": str(session_id)},
        )

    def _invalid_count(image_n: int, file_n: int) -> AppError:
        return DaemonSessionAttachmentInvalid(
            f"附件数量超限（图片≤{MAX_IMAGES_PER_MESSAGE}、"
            f"文件≤{MAX_FILES_PER_MESSAGE}）或类型非法。",
            details={"image_count": image_n, "file_count": file_n},
        )

    return await attachment_pipeline.validate_owned_attachments(
        svc._session,
        user_id=session_user_id,
        attachment_ids=attachment_ids,
        not_found_error=_not_found,
        invalid_count_error=_invalid_count,
    )


async def _resolve_inject_gate(
    svc,
    *,
    user_id: uuid.UUID,
    gate_provider_id_basis: uuid.UUID | None,
    agent_kind: str,
) -> bool:
    """多模态门控判定（D-9）。返回 ``supports_multimodal``。

    ``gate_provider_id_basis`` = 本轮将生效的会话供应商 id（切换轮为新值、
    激活轮为激活参数值、否则当前值）——预组装与锁内复核用同一口径计算基准，
    两者比较即「预读与取锁之间供应商是否漂移」。

    task-11 轻重构⑤：gate 解析核心收敛到
    ``daemon/attachment_pipeline.resolve_multimodal_gate``。
    """
    return await attachment_pipeline.resolve_multimodal_gate(
        svc._session,
        user_id=user_id,
        session_llm_provider_id=gate_provider_id_basis,
        agent_kind=agent_kind,
    )


async def _assemble_inject_attachment_payload(
    svc,
    rows: list,
    *,
    supports_multimodal: bool,
) -> list[dict]:
    """附件 → SESSION_INJECT payload attachments 列表（D-4 闸门/降级路由）。

    内部经对象存储读字节（MinIO）——P1（二审 #1）后本调用只出现在取锁前的
    预组装段，或锁内 gate 漂移且 supports 翻转的罕见竞态兜底。

    task-11 轻重构⑤：组装调用收敛到
    ``daemon/attachment_pipeline.assemble_attachments``。
    """
    return await attachment_pipeline.assemble_attachments(
        rows, supports_multimodal=supports_multimodal
    )


async def _preassemble_inject_attachments(
    svc,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    llm_provider_id: str | None,
    attachment_ids: list[uuid.UUID] | None,
) -> _PrelockedInjectAttachments | None:
    """P1（2026-08-25 会话路径二审 #1）：附件校验 + gate 解析 + MinIO 组装
    **移到会话行锁之前**。

    原路径在 FOR UPDATE 行锁内做 ``storage.read_bytes``（附件上限 5MB×5
    图片 + 20MB×5 文件），对象存储慢时同会话的并发 inject/interrupt/end 全部
    在行锁上排队、长事务占连接。附件归属/引擎/数量校验不依赖会话行可变状态
    → 安全前置；会话可注入状态（status / lease / 活跃 turn / 切换决策）不
    在此判定，取锁后由 ``_inject_into_session`` / 激活分支**重校验**兜住
    「预读与取锁之间被并发 end/interrupt 改状态」的竞态。

    归属校验用普通读（无 FOR UPDATE）：缺失/跨用户仍 :class:`DaemonSessionNotFound`
    404 不泄露存在性（与 ``_get_owned_session_for_update`` 同错误）。

    gate 基准 = 本轮将生效的会话供应商 id：携带 ``llm_provider_id``（切换/
    激活参数）且可解析时为新值，否则取当前值——与锁内切换列刷新后 / 激活
    事务内回填后的 ``session.llm_provider_id`` 同口径。非法 id 不在此报错
    （保持锁内 ``DaemonSessionConfigInvalid`` 原语义），基准退回当前值；锁内
    复核发现基准漂移会重解析 gate，正确性不依赖预读。
    """
    if not attachment_ids:
        return None
    pre = (
        await svc._session.execute(
            select(AgentSession).where(
                AgentSession.id == session_id,
                AgentSession.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if pre is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )
    rows = await svc._validate_inject_attachment_rows(
        session_id=session_id,
        session_user_id=pre.user_id,
        session_provider=pre.provider or "",
        attachment_ids=attachment_ids,
    )
    gate_basis = pre.llm_provider_id
    if llm_provider_id:
        try:
            gate_basis = uuid.UUID(llm_provider_id)
        except (ValueError, AttributeError, TypeError):
            # 非法 id 由锁内 DaemonSessionConfigInvalid 拒绝；基准保持当前值。
            pass
    supports = await svc._resolve_inject_gate(
        user_id=pre.user_id,
        gate_provider_id_basis=gate_basis,
        agent_kind=pre.provider or "",
    )
    payload = await svc._assemble_inject_attachment_payload(rows, supports_multimodal=supports)
    return _PrelockedInjectAttachments(
        rows=rows,
        inject_attachments=payload,
        gate_supports_multimodal=supports,
        gate_provider_id_basis=gate_basis,
        agent_kind=pre.provider or "",
    )


async def validate_create_attachments(
    svc,
    *,
    user_id: uuid.UUID,
    provider: str | None,
    attachment_ids: list[uuid.UUID] | None,
) -> list:
    """create 首句附件校验（task-08 自 create_session:1362-1403 拆出，零改写）。

    D-6 引擎门控（ProviderCaps multimodal 键）/ 归属+存在 404 / 数量 422
    （图≤5、文≤5）/ 保序；任一失败 raise → 无半成品落库。

    task-11 轻重构⑤：归属/数量/保序核心收敛到
    ``daemon/attachment_pipeline.validate_owned_attachments``（与 inject 校验
    单源；此处 not-found details 保留 create 原口径 reason=attachment_not_found）。
    """

    validated_attachments: list = []
    if attachment_ids:
        if not get_provider_caps(provider)["multimodal"]:
            raise DaemonSessionAttachmentsUnsupported(
                "此引擎不支持会话附件（仅 Claude 支持多模态与文件注入）。",
                details={"provider": provider},
            )
        from app.modules.session_attachment.service import (
            MAX_FILES_PER_MESSAGE,
            MAX_IMAGES_PER_MESSAGE,
        )

        def _not_found() -> AppError:
            return DaemonSessionNotFound(
                "部分附件不存在或无权访问。",
                details={"reason": "attachment_not_found"},
            )

        def _invalid_count(image_n: int, file_n: int) -> AppError:
            return DaemonSessionAttachmentInvalid(
                f"附件数量超限（图片≤{MAX_IMAGES_PER_MESSAGE}、"
                f"文件≤{MAX_FILES_PER_MESSAGE}）或类型非法。",
                details={"image_count": image_n, "file_count": file_n},
            )

        validated_attachments = await attachment_pipeline.validate_owned_attachments(
            svc._session,
            user_id=user_id,
            attachment_ids=attachment_ids,
            not_found_error=_not_found,
            invalid_count_error=_invalid_count,
        )
    return validated_attachments


async def assemble_create_attachments(
    svc,
    session: AgentSession,
    validated_attachments: list,
    *,
    user_id: uuid.UUID,
    llm_provider_row: object | None,
    provider: str | None,
) -> list[dict]:
    """create 附件回填与组装（task-08 自 create_session:2028-2063 拆出，零改写）。

    同事务：①session_id 回填（draft→bound 唯一前进迁移）；②多模态 gate 判定
    + payload 组装（D-4 闸门/降级路由），供首 turn SESSION_INJECT 携带。

    task-11 轻重构⑤：gate 解析与组装调用收敛到
    ``daemon/attachment_pipeline.resolve_multimodal_gate`` /
    ``assemble_attachments``（与 inject 路径单源）。
    """

    if validated_attachments:
        for _att in validated_attachments:
            if _att.session_id is None:
                _att.session_id = session.id
                svc._session.add(_att)

        _gate_supports = await attachment_pipeline.resolve_multimodal_gate(
            svc._session,
            user_id=user_id,
            session_llm_provider_id=(llm_provider_row.id if llm_provider_row is not None else None),
            agent_kind=provider,
        )
        return await attachment_pipeline.assemble_attachments(
            validated_attachments, supports_multimodal=_gate_supports
        )
    return []


class _InjectTurnWrites(NamedTuple):
    """_finalize_inject_turn_writes 产物（附件 payload + 切换下发载荷）。"""

    inject_attachments: list
    profile_payload: dict | None
    provider_config_payload: dict | None


async def _finalize_inject_turn_writes(
    svc,
    session: AgentSession,
    *,
    validated_attachments: list,
    prelocked_attachments: _PrelockedInjectAttachments | None,
    config_switch: bool,
    profile_changed: bool,
    switch_profile: object | None,
    provider_changed: bool,
    new_llm_provider_id: uuid.UUID | None,
    effective_provider: object | None,
    model_override: bool,
    effective_model: str | None,
) -> _InjectTurnWrites:
    """_inject_into_session 写事务内附件组装与切换同步段（拆出，零改写）。

    原地拆自 :3976-4114：附件 draft→bound 回填 + gate 基准复核（预组装复用/
    漂移重组装）+ SESSION_INJECT payload 组装；config_switch 时 lease metadata
    同步（_merge_lease_metadata）+ providerConfig / profile 切换载荷构造
    （resolve_bound_provider_config 单一真相源 + R-07 快照级模型同步）。
    """
    # ── 2026-08-20 task-06：附件组装与回填（D-4/D-9/draft→bound）────────
    # 校验已过（上方 task-05 段）：本段在**同事务**内完成——①session_id
    # 回填（draft→bound 唯一前进迁移；已 bound 附件再次引用不改状态）；
    # ②多模态门控判定（D-9）+ payload 组装（D-4 闸门/降级路由）。
    # P1（2026-08-25 二审 #1）：MinIO 组装已移到取锁前（预组装路径）——
    # 锁内只做 gate 基准复核：此刻 ``session.llm_provider_id`` 已被上方
    # 切换分支刷新为本轮生效值，与预组装基准一致且引擎不变 → 直接复用
    # 锁外产物；漂移（预读与取锁之间被并发切换/激活改写）→ 锁内重解析
    # gate，仅 supports 翻转才重组装（罕见竞态兜底，正确性不依赖预读）。
    # 无预组装的调用方（service 身份路径）在此原地组装，行为与原实现
    # 一致（组装读对象受 5MB×5/20MB×5 上限约束，原文档口径保留）。
    inject_attachments: list[dict] = []
    if validated_attachments:
        for att_row in validated_attachments:
            if att_row.session_id is None:
                att_row.session_id = session.id
                svc._session.add(att_row)

        if prelocked_attachments is not None:
            basis_same = (
                prelocked_attachments.gate_provider_id_basis == session.llm_provider_id
                and prelocked_attachments.agent_kind == session.provider
            )
            if basis_same:
                inject_attachments = list(prelocked_attachments.inject_attachments)
            else:
                supports = await svc._resolve_inject_gate(
                    user_id=session.user_id,
                    gate_provider_id_basis=session.llm_provider_id,
                    agent_kind=session.provider or "",
                )
                if supports == prelocked_attachments.gate_supports_multimodal:
                    inject_attachments = list(prelocked_attachments.inject_attachments)
                else:
                    inject_attachments = await svc._assemble_inject_attachment_payload(
                        validated_attachments, supports_multimodal=supports
                    )
        else:
            supports = await svc._resolve_inject_gate(
                user_id=session.user_id,
                gate_provider_id_basis=session.llm_provider_id,
                agent_kind=session.provider or "",
            )
            inject_attachments = await svc._assemble_inject_attachment_payload(
                validated_attachments, supports_multimodal=supports
            )

    if config_switch:
        # task-05：lease metadata 同步（同事务，保持 DB 与会话列一致——
        # claim payload / 恢复链路重读 metadata 时不落到旧配置）。
        # 供应商：写 session_llm_provider_id 或清空删键；档案：写提示词
        # 维度三键（同 apply_session_profile_to_lease 口径，D-013）。
        meta_updates: dict = {}
        meta_removals: list[str] = []
        if profile_changed:
            # ql-20260818-004：取消档案（switch_profile=None）→ 提示词维度
            # 三键全删（回无人格）；切换 → 写新值。
            if switch_profile is None:
                meta_removals.extend(["system_prompt", "mcp_refs", "skill_refs"])
            else:
                if switch_profile.system_prompt:
                    meta_updates["system_prompt"] = switch_profile.system_prompt
                else:
                    meta_removals.append("system_prompt")
                meta_updates["mcp_refs"] = list(switch_profile.mcp_refs or [])
                meta_updates["skill_refs"] = list(switch_profile.skill_refs or [])
        if provider_changed:
            if new_llm_provider_id is not None:
                meta_updates["session_llm_provider_id"] = str(new_llm_provider_id)
            else:
                meta_removals.append("session_llm_provider_id")
        await _svc._merge_lease_metadata(
            svc._session,
            session.lease_id,
            meta_updates,
            removals=meta_removals,
        )

        # providerConfig 在 commit 前构造（解密失败 → 整个切换事务回滚，
        # 不会出现 DB 已切、消息发不出的半态）。复用 lease/context 的
        # resolve_bound_provider_config（按会话 user_id + 引擎，与 claim
        # payload 的 provider_config 结构逐字一致，D-006 单一真相源）。
        # ql-20260817-008：构造条件用 effective_provider（含未切维度的
        # 当前行）而非 provider_row（仅切供应商时非空）——切档案轮若
        # 不带 providerConfig，daemon reload 重建 driver 时供应商 env
        # 缺失，会回落机器默认网关（实测 Kimi 会话切档案后流量跑到
        # GLM）。会话供应商 NULL（本机默认）才发 null。
        if effective_provider is not None:
            from app.modules.daemon.lease.context import (
                resolve_bound_provider_config,
            )

            provider_config_payload = await resolve_bound_provider_config(
                svc._session,
                {"llm_provider_id": str(effective_provider.id)},
                session.user_id,
                session.provider,
            )
            if provider_config_payload is None:
                # 上方已校验归属 + agent_kind，此处 None = 契约破裂（如
                # 解析器口径漂移），显式报错不静默降级（铁律 1）。
                raise DaemonSessionConfigInvalid(
                    "Session provider config could not be resolved.",
                    details={"llm_provider_id": str(effective_provider.id)},
                )
            # ── task-11 / R-07（design §4.2 兜底模型遮蔽规则）：会话级
            # 选模型时，快照同步 model 且 default_fallback_model=所选——
            # credential-injector 规则3 优先级 ``default_fallback_model ??
            # model``，仅改 model 会被供应商兜底模型静默遮蔽。纯档案切换
            # 轮也同步（沿用会话已选模型，防 reload 丢所选回退兜底）；
            # 纯切供应商（重置回原配置）不覆盖，快照原样透传零回归。
            # 均为**快照级覆盖**（copy 后改写），不动 llm_providers 原配置。
            # openai_chat 快照无 default_fallback_model 键（单模型经
            # litellm_model_name 路由），仅同步 model。
            if model_override and effective_model is not None:
                provider_config_payload = dict(provider_config_payload)
                provider_config_payload["model"] = effective_model
                if "default_fallback_model" in provider_config_payload:
                    provider_config_payload["default_fallback_model"] = effective_model
        else:
            provider_config_payload = None
        profile_payload = None
        if profile_changed:
            # ql-20260818-004：取消档案 → 空载荷（systemPrompt 空串=daemon 侧
            # 归一为 null 哨兵「切到无人格」，mcp/skill 清空）。
            profile_payload = {
                "systemPrompt": switch_profile.system_prompt or ""
                if switch_profile is not None
                else "",
                "mcpRefs": list(switch_profile.mcp_refs or [])
                if switch_profile is not None
                else [],
                "skillRefs": list(switch_profile.skill_refs or [])
                if switch_profile is not None
                else [],
            }
    else:
        profile_payload = None
        provider_config_payload = None
    return _InjectTurnWrites(
        inject_attachments=inject_attachments,
        profile_payload=profile_payload,
        provider_config_payload=provider_config_payload,
    )
