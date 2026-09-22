"""会话任意点分叉服务（2026-09-22-session-fork-continuation task-05 / FR-01~FR-04）。

链路：fork 点四重校验（会话归属 404 / run 归属 404 / run 终态 409 / caps 档
422）→ 按 D-012 定 fork_mode（claude→resume_at；pi→下一轮锚 rpc_fork / 末轮
clone；codex→seed 不写 fork 键）→ 复用 ``create_session`` 建 B 行（origin='fork'
+ fork 三件套 + 快照四维继承；刻意不写 parent_session_id/tree_depth——fork 不
入分身树，谱系由 fork_of_session_id 单向链表达，design §数据模型）。

tier 语义（D-004/D-012）：

- native（claude/pi）：lease metadata 写 fork 参数组（fork_mode 恒写 +
  fork_session=true + 档位锚点键），并复用既有 resume 链
  （resume_session_id=源 SDK 会话 id）+ 钉定源 runtime（引擎上下文在源机
  本地，worker_redispatch 同款钉定先例）；
- seed（codex）：无 fork 键，首 prompt=``build_seed_prompt`` 前情转述种子
  （用户轮全文优先 / 助手轮摘要截断 / FORK_SEED_MAX_CHARS 总量帽 + 截尾声明）。

源会话 A 全程只读（D-005 零字段改动）。
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.modules.agent.model import (
    ACTIVE_RUN_STATUSES,
    AgentRun,
    AgentRunLog,
    AgentSession,
)
from app.modules.agent.provider_caps import get_provider_caps

from .errors import DaemonSessionNotFound, DaemonSessionTitleInvalid

# ── 种子组装常量（design §接口定义）─────────────────────────────────────────
# 种子体积帽：用户轮全文 + 助手轮摘要的总量上限，超限截尾（保留较早内容）+
# 显式截尾声明行。24K ≈ 6K token 量级（中文为主），平衡上下文继承与成本。
FORK_SEED_MAX_CHARS = 24_000
# 助手轮单轮摘要上限：助手输出常含大段代码/日志，单轮截到 2K 保多轮覆盖面
# （「用户轮全文优先」——用户轮不受单轮帽，只受总量帽约束）。
_SEED_ASSISTANT_MAX_CHARS = 2_000
# 种子块开头标注行：显式告知模型这是转述而非引擎原生上下文（D-004 有损标注）。
_SEED_HEADER = "前情转述（非原生上下文）"
# 超帽截尾时的显式声明行（拼在种子末尾，计入总量帽）。
_SEED_TRUNCATION_NOTE = "【截尾声明】以上前情超出体积上限已被截断，末尾部分内容省略。"


# ── fork 子域异常族（errors.py 不在本卡 allowed_paths，就近定义于 fork.py，经
#    包 ``__init__`` 聚合重导出——对齐 errors.py 既有 AppError 风格）─────────


class DaemonSessionForkRunNotFound(AppError):
    """at_run_id 不存在或不属于目标会话（404，不泄露存在性，design §接口定义）。"""

    code = "HTTP_404_DAEMON_SESSION_FORK_RUN_NOT_FOUND"
    http_status = 404


class DaemonSessionForkRunActive(AppError):
    """分叉点 run 未终态（pending/running/pending_approval，409 running）。"""

    code = "HTTP_409_DAEMON_SESSION_FORK_RUN_ACTIVE"
    http_status = 409


class DaemonSessionForkUnsupported(AppError):
    """源会话引擎不支持分叉（caps sessionFork=none，422，design §接口定义）。"""

    code = "HTTP_422_DAEMON_SESSION_FORK_UNSUPPORTED"
    http_status = 422


class DaemonSessionForkAnchorMissing(AppError):
    """native 档锚点/源引擎会话 id 缺失（422，文案提示可退种子档）。

    三形态共用：claude at_run.engine_anchor 缺失；pi 下一轮锚点缺失（无法精确定
    位分叉点，退 clone 会多带分叉点之后的内容、语义错误故不静默降级）；源会话
    从未产出引擎会话 id（resume/fork 无目标）。``details.reason`` 区分。
    """

    code = "HTTP_422_DAEMON_SESSION_FORK_ANCHOR_MISSING"
    http_status = 422


@dataclass(slots=True)
class SessionForkResult:
    """fork_session 服务结果（router 映射 SessionForkResponse）。"""

    forked_session: AgentSession
    lease_id: uuid.UUID
    run_id: uuid.UUID | None
    tier: str  # 'native' | 'seed'（SessionForkResponse.tier 值域）
    mode: str | None  # 'resume_at' | 'rpc_fork' | 'clone'；seed 档 None
    source_session_id: uuid.UUID
    source_title: str
    at_run_seq: int


def build_seed_prompt(
    rows: Sequence[AgentRunLog],
    *,
    max_chars: int = FORK_SEED_MAX_CHARS,
) -> str:
    """组装 seed 档「前情转述」种子 prompt（纯函数，design §接口定义）。

    输入为截至分叉轮（含该轮）的 AgentRunLog 时间序集合：

    - ``user_input`` 轮：**全文**优先（用户意图不可损）；
    - ``stdout`` 轮（助手文本输出）：摘要截断到 ``_SEED_ASSISTANT_MAX_CHARS``；
    - 其余 channel（stderr / tool_call / 子代理行）：跳过——种子是「对话前情」
      而非完整审计日志，工具噪音会挤占帽内空间（R-03）。

    总量超 ``max_chars`` 截尾（保头舍尾）并追加显式截尾声明行（声明计入帽，
    保证 ``len(result) <= max_chars`` 不变量，acceptance「seed ≤ 帽含声明」）。
    """
    pieces: list[str] = []
    for row in rows:
        content = (row.content_redacted or "").strip()
        if not content:
            continue
        if row.channel == "user_input":
            pieces.append(f"【用户】{content}")
        elif row.channel == "stdout":
            if len(content) > _SEED_ASSISTANT_MAX_CHARS:
                content = f"{content[:_SEED_ASSISTANT_MAX_CHARS]}…（本轮输出过长已截断）"
            pieces.append(f"【助手】{content}")
    body = "\n\n".join(pieces)
    text = f"【{_SEED_HEADER}】\n以下为本会话分叉点之前（含该轮）的对话记录（用户轮全文、助手轮摘要），非引擎原生上下文，请在此基础上继续对话。\n\n{body}"
    if len(text) <= max_chars:
        return text
    # 截尾 + 显式声明（声明行计入帽，len 不变量成立）。
    budget = max(max_chars - len(_SEED_TRUNCATION_NOTE) - 1, 0)
    return f"{text[:budget]}\n{_SEED_TRUNCATION_NOTE}"


async def _resolve_source_sdk_session_id(
    db: AsyncSession,
    source: AgentSession,
) -> str | None:
    """解析源会话引擎会话 id（native resume/fork 目标）。

    解析链照 ``worker_redispatch.py`` 同源逻辑：``AgentSession.agent_session_id``
    优先，NULL 回退该会话最新 run 的 ``AgentRun.session_id``（只读不写回）。
    两处皆空 = 引擎会话 id 从未产出（如创建即失败），native 无从 resume/fork。
    """
    if source.agent_session_id:
        return source.agent_session_id
    return (
        await db.execute(
            select(AgentRun.session_id)
            .where(
                AgentRun.agent_session_id == source.id,
                col(AgentRun.session_id).is_not(None),
                col(AgentRun.session_id) != "",
            )
            .order_by(AgentRun.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _seed_rows_up_to(
    db: AsyncSession,
    run_ids: list[uuid.UUID],
) -> list[AgentRunLog]:
    """取截至分叉轮（含）各 run 的 AgentRunLog（时间序）。空 id 集返回空表。"""
    if not run_ids:
        return []
    rows = (
        (
            await db.execute(
                select(AgentRunLog)
                .where(AgentRunLog.run_id.in_(run_ids))
                .order_by(AgentRunLog.timestamp.asc(), AgentRunLog.id.asc())
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def _source_display_title(
    db: AsyncSession,
    source: AgentSession,
) -> str:
    """lineage.source_title：A.title 优先，缺省回落首条 user_input 前 30 字
    （对齐列表端点 title 注入口径），再缺省短 id 占位。"""
    if source.title:
        return source.title
    first_input = (
        await db.execute(
            select(AgentRunLog.content_redacted)
            .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
            .where(
                AgentRun.agent_session_id == source.id,
                AgentRunLog.channel == "user_input",
            )
            .order_by(AgentRun.created_at.asc(), AgentRun.id.asc(), AgentRunLog.timestamp.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if first_input:
        return first_input[:30]
    return f"会话 {str(source.id)[:8]}"


async def fork_session(
    svc,
    user_id: uuid.UUID,
    *,
    session_id: uuid.UUID,
    at_run_id: uuid.UUID,
    title: str | None = None,
) -> SessionForkResult:
    """在源会话 ``session_id`` 的 ``at_run_id`` 轮之后分叉出新会话 B。

    校验序（design §接口定义，先于任何写库）：

    1. 源会话存在且归属当前用户（软删视为不存在）→ 404；
    2. ``at_run_id`` 属于该会话 → 404；
    3. ``at_run_id`` 已终态（不在 ACTIVE_RUN_STATUSES）→ 409；
    4. 引擎 caps ``sessionFork != 'none'`` → 422；
    5. native 档锚点/源引擎会话 id 可得 → 422（文案提示可退种子档）。

    D-012 mode 分派：claude→resume_at（at_run.engine_anchor）；pi→下一轮
    engine_anchor 有=rpc_fork / 末轮=clone；caps=seed（codex）→纯种子。native
    不因锚缺失静默降级 seed（破坏性裁决归人，D-008 精神）。

    ``svc`` 收 DaemonService（router 传参惯例，compact 同款）或 SessionService
    ——统一收窄到 SessionService 壳（``create_session`` 首参契约）。
    """
    session_svc = getattr(svc, "_sess", None) if hasattr(svc, "_sess") else svc
    db = session_svc._session

    # ── 校验 ①：源会话存在 + 归属（404，不泄露存在性）────────────────────
    source = (
        (
            await db.execute(
                select(AgentSession).where(
                    AgentSession.id == session_id,
                    AgentSession.user_id == user_id,
                    AgentSession.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .one_or_none()
    )
    if source is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )

    # ── 校验 ②：at_run 归属该会话（404）──────────────────────────────────
    at_run = await db.get(AgentRun, at_run_id)
    if at_run is None or at_run.agent_session_id != session_id:
        raise DaemonSessionForkRunNotFound(
            f"Run '{at_run_id}' not found in session '{session_id}'.",
            details={"session_id": str(session_id), "at_run_id": str(at_run_id)},
        )

    # ── 校验 ③：at_run 已终态（409 running，design §接口定义）────────────
    if at_run.status in ACTIVE_RUN_STATUSES:
        raise DaemonSessionForkRunActive(
            "分叉点所在轮仍在进行中，请等该轮结束后再分叉。",
            details={
                "session_id": str(session_id),
                "at_run_id": str(at_run_id),
                "status": at_run.status,
            },
        )

    # ── 校验 ④：引擎 caps 档（422）───────────────────────────────────────
    caps_tier = str(get_provider_caps(source.provider).get("sessionFork", "none"))
    if caps_tier == "none":
        raise DaemonSessionForkUnsupported(
            f"引擎 '{source.provider}' 不支持会话分叉。",
            details={"session_id": str(session_id), "provider": source.provider},
        )

    # ── 会话 run 序（created_at,id 升序）：at_run_seq + pi 下一轮锚解析 ────
    run_rows: list[Any] = list(
        (
            await db.execute(
                select(AgentRun.id, AgentRun.engine_anchor, AgentRun.created_at)
                .where(AgentRun.agent_session_id == session_id)
                .order_by(AgentRun.created_at.asc(), AgentRun.id.asc())
            )
        ).all()
    )
    run_ids = [row[0] for row in run_rows]
    at_idx = run_ids.index(at_run_id)  # ②已校验归属，必命中
    at_run_seq = at_idx + 1

    # ── D-012 mode 分派 ───────────────────────────────────────────────────
    mode: str | None = None
    fork_anchor: str | None = None
    seed_prompt: str | None = None
    resume_session_id: str | None = None
    pinned_runtime_id: str | None = None

    if caps_tier == "seed":
        # codex：不写 fork 键，首 prompt=前情转述种子（读库即时可用，不依赖锚点）。
        seed_prompt = build_seed_prompt(await _seed_rows_up_to(db, run_ids[: at_idx + 1]))
    else:
        # native（claude/pi）：源引擎会话 id + 源机钉定（引擎上下文在源机本地，
        # worker_redispatch pinned_runtime_id=session.runtime_id 同款先例）。
        resume_session_id = await _resolve_source_sdk_session_id(db, source)
        if not resume_session_id:
            raise DaemonSessionForkAnchorMissing(
                "源会话未产出引擎会话 id，无法原生分叉；可改用种子档（前情转述）分叉。",
                details={
                    "session_id": str(session_id),
                    "reason": "source_sdk_session_id_missing",
                },
            )
        pinned_runtime_id = str(source.runtime_id) if source.runtime_id else None
        if source.provider == "claude":
            # claude：at_run 轮末 chain-entry UUID（task-04 回填链）即 resume 定位锚。
            if not at_run.engine_anchor:
                raise DaemonSessionForkAnchorMissing(
                    "该轮缺少引擎锚点（engine_anchor），无法原生分叉；可改用种子档（前情转述）分叉。",
                    details={
                        "session_id": str(session_id),
                        "at_run_id": str(at_run_id),
                        "reason": "at_run_anchor_missing",
                    },
                )
            mode = "resume_at"
            fork_anchor = at_run.engine_anchor
        elif source.provider == "pi":
            # pi：fork 语义=「分叉在第 N 轮后」→ 取第 N+1 轮轮首用户消息 entryId
            # 作 fork position before（D-012）；N 为末轮 → clone 全量分叉。
            has_next = at_idx + 1 < len(run_rows)
            if has_next:
                next_anchor = run_rows[at_idx + 1][1]
                if not next_anchor:
                    # 下一轮存在但锚缺失：退 clone 会多带分叉点之后的内容（语义
                    # 错误），不静默降级，422 明确报错。
                    raise DaemonSessionForkAnchorMissing(
                        "分叉点下一轮缺少引擎锚点，无法精确定位分叉位置；请选择其它轮分叉。",
                        details={
                            "session_id": str(session_id),
                            "at_run_id": str(at_run_id),
                            "reason": "next_run_anchor_missing",
                        },
                    )
                mode = "rpc_fork"
                fork_anchor = next_anchor
            else:
                mode = "clone"
                fork_anchor = None
        else:
            # 防御：caps native 但 provider 不在已实装分支（静态表当前不会出现，
            # 防 caps 表扩值时静默走错链）。
            raise DaemonSessionForkUnsupported(
                f"引擎 '{source.provider}' 的原生分叉尚未实装。",
                details={"session_id": str(session_id), "provider": source.provider},
            )

    # ── B 标题校验（对齐 rename 端点 DaemonSessionTitleInvalid 口径）───────
    if title is not None:
        stripped = title.strip()
        if not stripped or len(stripped) > 255:
            raise DaemonSessionTitleInvalid(
                "分叉会话标题不能为空且不超过 255 字符。",
                details={"session_id": str(session_id)},
            )
        title = stripped

    source_title = await _source_display_title(db, source)

    # ── 建 B：复用既有 create 链（事务内 session+run+lease 三元组原子落库，
    #    校验已全部前置——本点之后无业务校验失败面）────────────────────────
    from .create import create_session as _create_session

    result = await _create_session(
        session_svc,
        user_id,
        provider=source.provider,
        # seed 档首 prompt=种子；native 档无首句（走 resume 链，用户在 B 首轮
        # inject 输入；create 对 fork 调用豁免空 prompt 校验）。
        prompt=seed_prompt or "",
        # 快照四维继承（FR-02：按源会话当前值，经 create 既有参数链）。
        model=(source.config or {}).get("model"),
        workspace_id=source.workspace_id,
        agent_profile_id=(str(source.agent_profile_id) if source.agent_profile_id else None),
        llm_provider_id=str(source.llm_provider_id) if source.llm_provider_id else None,
        origin="fork",
        # fork 三件套（不写 parent_session_id/tree_depth——fork 不入分身树）。
        fork_of_session_id=session_id,
        fork_at_run_id=at_run_id,
        engine_fork_anchor=fork_anchor,
        fork_mode=mode,
        # native：复用既有 resume 链 + 源机钉定；seed：均 None 走常规选机。
        resume_session_id=resume_session_id,
        runtime_id=pinned_runtime_id,
    )

    # B 标题（可选）：create 链 commit 后补写一次（纯展示列，不属原子性关键面）。
    if title:
        result.agent_session.title = title
        db.add(result.agent_session)
        await db.commit()

    return SessionForkResult(
        forked_session=result.agent_session,
        lease_id=result.lease_id,
        run_id=result.agent_run.id if result.agent_run is not None else None,
        tier="native" if mode is not None else "seed",
        mode=mode,
        source_session_id=session_id,
        source_title=source_title,
        at_run_seq=at_run_seq,
    )
