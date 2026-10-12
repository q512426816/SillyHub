"""daemon 重启自动续跑入队（2026-09-10-auto-resume-interrupted-turn / design §2）.

``recover_session_after_daemon_restart`` 收敛中断 run 的同事务内，守卫全过时把
被中断轮的最后一条 ``user_input`` 日志包续跑提示词，以
``origin='auto_resume:<源 run uuid>'`` 落 ``AgentSessionQueuedMessage``（pending，
position 队首）。会话恢复 active 后由既有 D-008 钩子（confirm_session_
reconnected）派发——本模块只负责入队。

事务语义（D-011，Grill P1-1）：全程 SAVEPOINT（``begin_nested``）——DB 级失败
rollback to savepoint 后**弃续跑保恢复**（外层 recover 事务照常 commit）；进程
崩溃则外层事务全有或全无（run 收敛+入队原子）。守卫不满足是正常 return（非
异常），SAVEPOINT 正常释放。

守卫序列（design §6 矩阵，任一失败记 info 返回 False）：

- G1 范围：主会话（``parent_session_id IS NULL`` 且 ``session_kind='chat'``）；
- G2 开关：``session.config.auto_resume_interrupted`` 显式 ``False`` 才关（缺省开）；
- G3 错误码：仅 ``daemon_restarted``（``daemon_stopped`` 用户主动优雅停不复活）；
- G4 最新轮（入队时）：该 run 是会话最新 run（created_at desc + id tiebreak）；
- G5 输入：有最后一条 ``user_input`` 日志且长度未触 5000 截断上限（防包装文
  二次截断退化，Grill P2-7）；
- G6 无附件：不含附件标记行（宽松前缀 ``^[附件:<uuid36>|``——kind 取 DB 原始
  值不硬编码词表，对齐 ``attachment_marker_line`` 单一源，Grill P2-10）；
- G7 链上限 2：沿 ``metadata_.auto_resume_of`` 链回溯（防 daemon 崩溃循环）；
- G8 幂等：同 source run 的 pending ``auto_resume`` 条目已存在不重复入队；
- G9 无被取消 pending dialog：中断时正挂 AskUser 的轮断点语义不同，降级手动
  （D-013，Grill P2-6）；
- G10' 满员：pending 条目数 < ``SESSION_QUEUE_MAX_PENDING``（D-012，Grill P1-3）。
"""

from __future__ import annotations

import re
import uuid

from sqlalchemy import func, select
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.model import (
    SESSION_QUEUE_MAX_PENDING,
    USER_INPUT_LOG_MAX_CHARS,
    AgentRun,
    AgentRunLog,
    AgentSession,
    AgentSessionQueuedMessage,
)

log = get_logger(__name__)

# 续跑提示词模板（design §2.1 逐字，单一源导出供测试锁定）。
RESUME_PROMPT_TEMPLATE = (
    "[系统续跑提示] 平台服务重启中断了上一轮执行，会话上下文已完整恢复。\n"
    "请先检查上一轮已完成的操作（已修改的文件、已执行的命令），确认无误后从断点\n"
    "继续完成下面的任务；已完成的步骤不要重复执行。\n"
    "\n"
    "{ORIGINAL_PROMPT}"
)

# 队列条目 origin 复合值前缀（D-009@v2）：'auto_resume:<源 run uuid>'——uuid 无
# 冒号，split(':', 1) 解析安全；派发侧（queue.py）与本函数共用单一源。
AUTO_RESUME_ORIGIN_PREFIX = "auto_resume:"

# 续跑链上限（D-005@v1）：被中断 run 沿 metadata_.auto_resume_of 回溯，链长
# （含自身已是续跑轮的深度）≥2 不再自动——防 daemon 崩溃循环反复自动重发。
AUTO_RESUME_MAX_CHAIN = 2

# inject 落库 user_input 的截断上限（inject.py :657 同口径）——长度恰为该值的
# 原文视为已截断，不自动续跑（G5，Grill P2-7）。
# ql-20260910-016：与 user_input 写入侧共用单一截断口径（agent.model
# USER_INPUT_LOG_MAX_CHARS，5000→50000），本值随写入口径联动。
USER_INPUT_TRUNCATION_LIMIT = USER_INPUT_LOG_MAX_CHARS

# 附件标记行宽松前缀（G6）：uuid36 + '|'——kind 取 DB 原始值不硬编码 image|file
# 词表（attachment_marker_line 生成器同源，前端 parseAttachmentMarkers 另有严格
# 版，此处宁可多拦不放过：任何 [附件:<uuid>| 前缀行都视为带附件）。
_ATTACHMENT_MARKER_LINE_RE = re.compile(
    r"^\[附件:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{12}\|",
    re.MULTILINE,
)

# ── 2026-09-12-chat-turn-auto-recovery（task-04 / design §5.3）────────────────

# CLI 合成鉴权错误签名（ql-20260903-011，自 close_run_steps.py 迁入）：claude CLI
# 把模型网关 401 统一合成 "Not logged in · Please run /login"——文案把远端瞬时
# 抖动误导成本地凭证缺失。命中即视为可自动重投的瞬时失败（实证：同进程同密钥
# 13 秒后重发即成功，2026-09-03 会话 cb56fabf）。
_CLI_AUTH_TRANSIENT_RE = re.compile(r"Not\s+logged\s+in|Please\s+run\s+/login", re.IGNORECASE)

# 瞬时可重试错误类型（分支 B 触发面；design §5.3——daemon 归类器泛化后 pi 的
# 断流/超时/网络/供应商异常均落这四类，retryable=true）。
TRANSIENT_ERROR_TYPES = {"rate_limited", "timeout", "network", "provider_error"}

# 中断续跑 nudge 提示词（design §5.3 单一源常量，测试锁定）。不带原任务——
# 会话是常驻 CLI 进程、上下文完整，重放原文会诱导从头执行（副作用重复）；
# 区别于 daemon 重启场景的 RESUME_PROMPT_TEMPLATE（换进程丢上下文才包原文）。
RESUME_NUDGE_PROMPT = (
    "[系统续跑] 上一轮执行因上游输出流中断未完成，会话上下文完整。\n"
    "请检查当前工作状态（已修改的文件、已执行的命令），从中断处继续完成原任务；\n"
    "已完成的步骤不要重复执行；若原任务已完成，请直接说明即可。"
)

# 额度恢复型 nudge（分支 A 定时到点派发用）。
QUOTA_NUDGE_PROMPT = (
    "[系统续跑] 上游额度已重置，会话从中断处继续。\n"
    "请检查当前工作状态，继续完成原任务；已完成的步骤不要重复执行；\n"
    "若原任务已完成，请直接说明即可。"
)

# quota 连续自动续跑上限（design D-007）：沿 auto_resume_of 链回溯数连续
# quota_exceeded 节点，≥3 不再排期交回用户。quota 窗口天然限速（≥5h 间隔），
# 比 transient 紧链（2）放宽一档。
QUOTA_CHAIN_LIMIT = 3

# F1b（2026-10-12-session-defects task-08 / FR-01 / D-003）：上下文超窗自动
# 压缩续跑——连续 context_overflow 链 ≥2 不再自动压缩（防压缩失败循环烧窗）。
CONTEXT_OVERFLOW_CHAIN_LIMIT = 2

# 重放提示词场景化模板（Grill 复审注记：不复用 wrap_resume_prompt 的 daemon
# 重启语境文案；wrap_resume_prompt 机制仅由 origin 链标记位承载）。
CONTEXT_OVERFLOW_REPLAY_HEADER = (
    "[系统续跑] 会话上下文已满，平台已自动调用引擎原生压缩（/compact）。\n"
    "以下为你的原始消息，请继续处理；已完成的步骤不要重复执行：\n"
)
_CONTEXT_CHAIN_LIMIT_HINT = (
    "上下文超限自动压缩续跑已达上限（2 次）；请手动压缩会话（/compact）后重发，或新建会话继续"
)
_COMPACT_FAILURE_HINT = "自动压缩会话失败；请手动压缩会话（/compact）后重发原消息，或新建会话继续"

# 到点缓冲（秒）：reset_at 后再加缓冲防上游时钟偏差/边界复位延迟（design
# §5.3「+120s」）；reset_at 已过（时钟偏差/积压条目）→ 尽快派发再兜 30s。
QUOTA_DISPATCH_BUFFER_SECONDS = 120
_PAST_RESET_DISPATCH_DELAY_SECONDS = 30


def make_auto_resume_origin(run_id: uuid.UUID) -> str:
    """队列条目 origin 复合值：'auto_resume:<源 run uuid>'。"""
    return f"{AUTO_RESUME_ORIGIN_PREFIX}{run_id}"


def parse_auto_resume_origin(origin: str | None) -> uuid.UUID | None:
    """解析 origin 复合值取源 run id；非续跑条目（None/前缀不匹配/坏 uuid）→ None。"""
    if not origin or not origin.startswith(AUTO_RESUME_ORIGIN_PREFIX):
        return None
    try:
        return uuid.UUID(origin[len(AUTO_RESUME_ORIGIN_PREFIX) :])
    except ValueError:
        return None


def wrap_resume_prompt(original_prompt: str) -> str:
    """续跑提示词包装（design §2.1 模板 + 原文全量嵌入，不截断）。"""
    return RESUME_PROMPT_TEMPLATE.replace("{ORIGINAL_PROMPT}", original_prompt)


async def maybe_enqueue_auto_resume(
    svc,
    session: AgentSession,
    interrupted_run_id: uuid.UUID,
) -> bool:
    """守卫全过则入队续跑条目（返回 True）；任一不满足/DB 失败返回 False。

    SAVEPOINT（D-011）：DB 级失败 rollback to savepoint 后弃续跑保恢复主链
    （NFR-03）；守卫不满足走正常 return，savepoint 正常释放。
    """
    try:
        async with svc._session.begin_nested():
            return await _enqueue_within_savepoint(svc, session, interrupted_run_id)
    except Exception as exc:
        log.warning(
            "auto_resume_enqueue_failed",
            session_id=str(session.id),
            run_id=str(interrupted_run_id),
            error=str(exc),
        )
        return False


async def _enqueue_within_savepoint(
    svc,
    session: AgentSession,
    interrupted_run_id: uuid.UUID,
) -> bool:
    from app.modules.daemon.model import SessionDialogRequest

    # G1 范围：主会话 + chat（worker 有专用重派；群聊影子走桥接链路另议）。
    if session.parent_session_id is not None or (session.session_kind or "chat") != "chat":
        log.info(
            "auto_resume_skip_scope",
            session_id=str(session.id),
            session_kind=session.session_kind,
        )
        return False

    # G2 开关：缺省开，显式 False 才关（D-004@v1）。
    config = session.config if isinstance(session.config, dict) else {}
    if config.get("auto_resume_interrupted") is False:
        log.info("auto_resume_skip_disabled", session_id=str(session.id))
        return False

    run = await svc._session.get(AgentRun, interrupted_run_id)
    if run is None:
        log.info("auto_resume_skip_run_missing", session_id=str(session.id))
        return False

    # G3 错误码：仅 daemon_restarted（daemon_stopped 用户主动优雅停不复活）。
    if run.error_code != "daemon_restarted":
        log.info(
            "auto_resume_skip_error_code",
            session_id=str(session.id),
            error_code=run.error_code,
        )
        return False

    # G4 最新轮（入队时）：该 run 之后无更新 run——用户已手动重发则不自动。
    latest_run_id = (
        await svc._session.execute(
            select(AgentRun.id)
            .where(AgentRun.agent_session_id == session.id)
            .order_by(col(AgentRun.created_at).desc(), col(AgentRun.id).desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if latest_run_id != interrupted_run_id:
        log.info("auto_resume_skip_not_latest", session_id=str(session.id))
        return False

    # G5 输入：最后一条 user_input 日志，存在且未触截断上限。
    last_input = (
        await svc._session.execute(
            select(AgentRunLog.content_redacted)
            .where(
                AgentRunLog.run_id == interrupted_run_id,
                AgentRunLog.channel == "user_input",
            )
            .order_by(col(AgentRunLog.id).desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if not last_input:
        log.info("auto_resume_skip_no_input", session_id=str(session.id))
        return False
    if len(last_input) >= USER_INPUT_TRUNCATION_LIMIT:
        # 长度触截断上限即原文可能被截（恰为 5000 或更多不可得）——二次包装会
        # 退化文本，降级手动（Grill P2-7）。
        log.info("auto_resume_skip_input_truncated", session_id=str(session.id))
        return False

    # G6 附件：标记行存在即降级手动（附件引用快照可能过期，自动重发必败）。
    if _ATTACHMENT_MARKER_LINE_RE.search(last_input):
        log.info("auto_resume_skip_attachment", session_id=str(session.id))
        return False

    # G7 链上限：沿 metadata_.auto_resume_of 回溯，链长 ≥2 不再自动。
    chain_len = 0
    cursor: AgentRun | None = run
    while (
        cursor is not None
        and isinstance(cursor.metadata_, dict)
        and cursor.metadata_.get("auto_resume_of")
        and chain_len < AUTO_RESUME_MAX_CHAIN
    ):
        chain_len += 1
        if chain_len >= AUTO_RESUME_MAX_CHAIN:
            break
        try:
            cursor = await svc._session.get(
                AgentRun, uuid.UUID(str(cursor.metadata_["auto_resume_of"]))
            )
        except ValueError:
            cursor = None
    if chain_len >= AUTO_RESUME_MAX_CHAIN:
        log.info(
            "auto_resume_skip_chain_limit",
            session_id=str(session.id),
            chain_len=chain_len,
        )
        return False

    # G8 幂等：同 source run 的 pending 续跑条目已存在（recover 网络重入）。
    origin = make_auto_resume_origin(interrupted_run_id)
    dup = (
        await svc._session.execute(
            select(AgentSessionQueuedMessage.id)
            .where(
                AgentSessionQueuedMessage.agent_session_id == session.id,
                AgentSessionQueuedMessage.status == "pending",
                AgentSessionQueuedMessage.origin == origin,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if dup is not None:
        log.info("auto_resume_skip_duplicate", session_id=str(session.id))
        return False

    # G9 pending dialog：中断时正挂提问的轮（converge 已置 cancelled）断点语义
    # 是「等回答」，自动重放原始任务会绕过提问点，降级手动（D-013）。
    cancelled_dialog = (
        await svc._session.execute(
            select(SessionDialogRequest.id)
            .where(
                SessionDialogRequest.run_id == interrupted_run_id,
                SessionDialogRequest.status == "cancelled",
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if cancelled_dialog is not None:
        log.info("auto_resume_skip_cancelled_dialog", session_id=str(session.id))
        return False

    # G10' 满员：pending ≥ SESSION_QUEUE_MAX_PENDING 弃自动（D-012）。
    pending_rows = (
        await svc._session.execute(
            select(AgentSessionQueuedMessage.position).where(
                AgentSessionQueuedMessage.agent_session_id == session.id,
                AgentSessionQueuedMessage.status == "pending",
            )
        )
    ).all()
    if len(pending_rows) >= SESSION_QUEUE_MAX_PENDING:
        log.info(
            "auto_resume_skip_queue_full",
            session_id=str(session.id),
            pending=len(pending_rows),
        )
        return False

    # position 队首（D-012）：被中断轮先于重启前已 pending 的追问（它们当初就是
    # 在等这轮）——恢复原执行顺序，非「天然 created_at 先」（v1 R3 已废）。
    min_position = min((row[0] for row in pending_rows), default=0)
    svc._session.add(
        AgentSessionQueuedMessage(
            agent_session_id=session.id,
            sender_user_id=session.user_id,
            prompt=wrap_resume_prompt(last_input),
            origin=origin,
            position=min_position - 1,
            status="pending",
        )
    )
    log.info(
        "auto_resume_enqueued",
        session_id=str(session.id),
        run_id=str(interrupted_run_id),
        position=min_position - 1,
    )
    return True


async def maybe_auto_recover_failed_turn(svc, agent_run: AgentRun) -> None:
    """上游故障轮三分支自动恢复（2026-09-12-chat-turn-auto-recovery design §5.3）。

    由 ``close_run_steps._close_post_commit`` 在 run 终态 commit 之后调用（终态
    已落库）。泛化并取代 ql-20260903-011 的 ``_maybe_autoretry_auth_transient_turn``
    ——CLI 合成鉴权错误保留为一类（raw 命中 ``_CLI_AUTH_TRANSIENT_RE``）并入统一
    判定序。行为面变化（D-004@v2，有意）：① 恢复条目统一带 origin 标记；② G0
    守卫（开关/最新轮/双表幂等）对 auth 类同样生效；③ 既有防循环/防手动重发叠加
    守卫保留在分支 B 内。

    判定序（互斥，命中即返回）：
      G0 总门（全分支）：run.status=failed；session active；开关非 False；G1
         范围（主会话 chat）；G4 最新轮（created_at desc + id desc）；非空
         user_input；排队/定时双表 origin 幂等。
      A quota_exceeded + reset_at 可解析 → quota 链 <3 → INSERT 定时消息
        （dispatch_at=reset_at+120s，QUOTA_NUDGE_PROMPT）。
      B 瞬时四类或 auth-transient raw：
        - 干净轮（无 tool_call 日志）：G5 截断 / G6 附件守卫 + 紧邻前 run 同型
          同输入防循环 + 同文 pending 防手动叠加 → 原 prompt 入排队。
        - 有工具活动：紧链（auto_resume_of）<2 → RESUME_NUDGE_PROMPT 入排队。
      C 其余不动作。

    全程静默容错——任何失败仅 rollback+warn，绝不影响已 commit 的 run 终态。
    """
    from datetime import UTC, datetime, timedelta

    from app.modules.agent.model import AgentSessionScheduledMessage

    try:
        if agent_run.status != "failed":
            return
        session_id = agent_run.agent_session_id
        user_id = agent_run.user_id
        if session_id is None or user_id is None:
            return
        session = await svc._session.get(AgentSession, session_id)
        if session is None or session.status != "active":
            return
        # G2 开关（与 9-10 变更共用同一键：关=全类回到手动模式，NFR-3）。
        config = session.config if isinstance(session.config, dict) else {}
        if config.get("auto_resume_interrupted") is False:
            return
        # G1 范围：主会话 chat（worker 有专用重派；群聊影子另议）。
        if session.parent_session_id is not None or (session.session_kind or "chat") != "chat":
            return
        # G4 最新轮：用户已手动重发/新发言则不自动。
        latest_run_id = (
            await svc._session.execute(
                select(AgentRun.id)
                .where(AgentRun.agent_session_id == session_id)
                .order_by(col(AgentRun.created_at).desc(), col(AgentRun.id).desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if latest_run_id != agent_run.id:
            return
        # 双表幂等：同 source run 的 pending 恢复条目已存在（含并发重入）。
        origin = make_auto_resume_origin(agent_run.id)
        dup_queued = (
            await svc._session.execute(
                select(AgentSessionQueuedMessage.id)
                .where(
                    AgentSessionQueuedMessage.agent_session_id == session_id,
                    AgentSessionQueuedMessage.status == "pending",
                    AgentSessionQueuedMessage.origin == origin,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        dup_scheduled = (
            await svc._session.execute(
                select(AgentSessionScheduledMessage.id)
                .where(
                    AgentSessionScheduledMessage.agent_session_id == session_id,
                    AgentSessionScheduledMessage.status == "pending",
                    AgentSessionScheduledMessage.origin == origin,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if dup_queued is not None or dup_scheduled is not None:
            return

        error_detail = agent_run.error_detail if isinstance(agent_run.error_detail, dict) else {}
        error_type = str(error_detail.get("type") or "")
        error_raw = str(error_detail.get("raw") or "")

        # ── 分支 A：额度耗尽 + 重置时间可解析 → 定时自动续跑 ──────────────
        if error_type == "quota_exceeded":
            reset_at_raw = error_detail.get("reset_at")
            reset_at = None
            if isinstance(reset_at_raw, str) and reset_at_raw.strip():
                try:
                    reset_at = datetime.fromisoformat(reset_at_raw.strip())
                except ValueError:
                    reset_at = None
            if reset_at is None:
                # 无可解析重置时间：不排期，仅前端按类型提示（分支 C 语义）。
                return
            quota_chain = await _count_chain_type(svc, agent_run, quota_exceeded_only=True)
            if quota_chain >= QUOTA_CHAIN_LIMIT:
                log.info(
                    "auto_recover_quota_chain_limit",
                    session_id=str(session_id),
                    run_id=str(agent_run.id),
                    chain=quota_chain,
                )
                return
            now = datetime.now(UTC)
            if reset_at.tzinfo is None:
                reset_at = reset_at.replace(tzinfo=UTC)
            dispatch_at = reset_at + timedelta(seconds=QUOTA_DISPATCH_BUFFER_SECONDS)
            if dispatch_at <= now:
                dispatch_at = now + timedelta(seconds=_PAST_RESET_DISPATCH_DELAY_SECONDS)
            svc._session.add(
                AgentSessionScheduledMessage(
                    agent_session_id=session_id,
                    sender_user_id=user_id,
                    prompt=QUOTA_NUDGE_PROMPT,
                    origin=origin,
                    dispatch_at=dispatch_at,
                    status="pending",
                    llm_provider_id=(
                        str(agent_run.llm_provider_id) if agent_run.llm_provider_id else None
                    ),
                    agent_profile_id=(
                        str(agent_run.agent_profile_id) if agent_run.agent_profile_id else None
                    ),
                )
            )
            await svc._session.commit()
            log.info(
                "auto_recover_quota_scheduled",
                session_id=str(session_id),
                run_id=str(agent_run.id),
                dispatch_at=dispatch_at.isoformat(),
            )
            return

        # ── 分支 A2：上下文超窗 → agent 原生压缩续跑（F1b / D-003） ──────────
        # 压缩能力是 agent CLI 原生能力，平台只编排：调既有 compact_session
        # 双分路（claude 注入原生 /compact；pi/codex 走 session_compact RPC），
        # 成功后内联直插 AgentSessionScheduledMessage 重放本轮原文（delay=0；
        # busy 由 queue 队列自然承接）。禁走 maybe_enqueue_auto_resume——其 G3
        # 门禁仅放行 error_code=daemon_restarted（Grill X2 阻断修正）。
        if error_type == "context_overflow":
            from app.modules.agent.provider_caps import get_provider_caps

            # caps.compact=false（引擎不支持原生压缩）→ 自动跳过走既有路径
            # （不压缩、不报错、不写引导——兼容策略 §3）。
            if not get_provider_caps(session.provider or "")["compact"]:
                return
            # 熔断：连续 context_overflow 链 ≥2 停跑（防压缩失败循环烧窗）。
            co_chain = await _count_chain_type(svc, agent_run, context_overflow_only=True)
            if co_chain >= CONTEXT_OVERFLOW_CHAIN_LIMIT:
                log.info(
                    "auto_recover_context_chain_limit",
                    session_id=str(session_id),
                    run_id=str(agent_run.id),
                    chain=co_chain,
                )
                await _write_chain_limit_hint(svc, agent_run, hint_text=_CONTEXT_CHAIN_LIMIT_HINT)
                return
            # 压缩编排（AppError/异常 → 引导写入不吞，Grill X2 gap 修正；
            # 仅 _write_chain_limit_hint 自身 DB 失败才降级纯日志）。
            from app.modules.daemon.session.service.compact import compact_session

            # rollback 会 expire run 对象（属性访问触发同步 IO → MissingGreenlet），
            # 异常路径需要的标量先于 compact 调用捕获。
            co_run_id = str(agent_run.id)
            try:
                resp = await compact_session(svc, session_id, user_id)
            except Exception as exc:
                await svc._session.rollback()
                log.warning(
                    "auto_recover_compact_failed",
                    session_id=str(session_id),
                    run_id=co_run_id,
                    error=str(exc),
                )
                # rollback 过期了 run 对象属性（expire_on_commit 语义），hint 写入
                # 前经 get 重载（异步安全）；get 返回 None（极端）降级纯日志。
                fresh_run = await svc._session.get(AgentRun, uuid.UUID(co_run_id))
                if fresh_run is not None:
                    await _write_chain_limit_hint(svc, fresh_run, hint_text=_COMPACT_FAILURE_HINT)
                return
            if not getattr(resp, "accepted", False):
                log.warning(
                    "auto_recover_compact_not_accepted",
                    session_id=str(session_id),
                    run_id=str(agent_run.id),
                )
                await _write_chain_limit_hint(svc, agent_run, hint_text=_COMPACT_FAILURE_HINT)
                return
            # 重放本轮原文（场景化模板头 + 原文；origin 链标记供熔断计数）。
            original_prompt = (
                await svc._session.execute(
                    select(AgentRunLog.content_redacted)
                    .where(
                        AgentRunLog.run_id == agent_run.id,
                        AgentRunLog.channel == "user_input",
                    )
                    .order_by(AgentRunLog.timestamp)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if original_prompt is None or not original_prompt.strip():
                return
            now_co = datetime.now(UTC)
            svc._session.add(
                AgentSessionScheduledMessage(
                    agent_session_id=session_id,
                    sender_user_id=user_id,
                    prompt=f"{CONTEXT_OVERFLOW_REPLAY_HEADER}{original_prompt.strip()}",
                    origin=origin,
                    dispatch_at=now_co,
                    status="pending",
                    llm_provider_id=(
                        str(agent_run.llm_provider_id) if agent_run.llm_provider_id else None
                    ),
                    agent_profile_id=(
                        str(agent_run.agent_profile_id) if agent_run.agent_profile_id else None
                    ),
                )
            )
            await svc._session.commit()
            log.info(
                "auto_recover_context_overflow_scheduled",
                session_id=str(session_id),
                run_id=str(agent_run.id),
                origin=origin,
            )
            return

        # ── 分支 B：瞬时四类 / CLI 合成鉴权 raw ────────────────────────────
        is_transient = error_type in TRANSIENT_ERROR_TYPES
        is_cli_auth_transient = bool(_CLI_AUTH_TRANSIENT_RE.search(error_raw))
        if not (is_transient or is_cli_auth_transient):
            return

        # 原始输入（与既有生产查询同形态）。
        prompt = (
            await svc._session.execute(
                select(AgentRunLog.content_redacted)
                .where(
                    AgentRunLog.run_id == agent_run.id,
                    AgentRunLog.channel == "user_input",
                )
                .order_by(AgentRunLog.timestamp)
                .limit(1)
            )
        ).scalar_one_or_none()
        if prompt is None or not prompt.strip():
            return
        prompt = prompt.strip()

        tool_activity = (
            await svc._session.execute(
                select(func.count())
                .select_from(AgentRunLog)
                .where(
                    AgentRunLog.run_id == agent_run.id,
                    AgentRunLog.channel == "tool_call",
                )
            )
        ).scalar_one()

        if tool_activity:
            # 有工具活动：副作用已落地，不重放原任务——nudge 续跑；紧链上限 2
            # （与 9-10 G7 同款防自动恢复风暴）。
            chain_len = await _count_chain_type(svc, agent_run)
            if chain_len >= AUTO_RESUME_MAX_CHAIN:
                log.info(
                    "auto_recover_nudge_chain_limit",
                    session_id=str(session_id),
                    run_id=str(agent_run.id),
                    chain=chain_len,
                )
                await _write_chain_limit_hint(svc, agent_run)
                return
            enqueue_prompt = RESUME_NUDGE_PROMPT
        else:
            # 干净轮：首 LLM 调用即失败，重放原文安全。G5 截断 / G6 附件守卫
            # （命中降级手动——截断文二次包装退化 / 附件引用快照过期，对齐
            # 9-10 变更 G5/G6）。
            if len(prompt) >= USER_INPUT_TRUNCATION_LIMIT:
                log.info("auto_recover_skip_input_truncated", run_id=str(agent_run.id))
                return
            if _ATTACHMENT_MARKER_LINE_RE.search(prompt):
                log.info("auto_recover_skip_attachment", run_id=str(agent_run.id))
                return
            # 紧邻前 run 同型失败且输入相同 → 本 run 已是自动重投结果（持续性
            # 故障），不再追加交回用户（ql-20260903-011 防循环泛化）。前驱取
            # 「排除自身后按 G4 同款排序的首行」——created_at 严格小于在撞值时
            # 会跳过同刻前驱取错行（漏判）。
            prev_run = (
                await svc._session.execute(
                    select(AgentRun)
                    .where(
                        AgentRun.agent_session_id == session_id,
                        AgentRun.id != agent_run.id,
                    )
                    .order_by(AgentRun.created_at.desc(), AgentRun.id.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if prev_run is not None and prev_run.status == "failed":
                prev_detail = (
                    prev_run.error_detail if isinstance(prev_run.error_detail, dict) else {}
                )
                if str(prev_detail.get("type") or "") == error_type:
                    prev_prompt = (
                        await svc._session.execute(
                            select(AgentRunLog.content_redacted)
                            .where(
                                AgentRunLog.run_id == prev_run.id,
                                AgentRunLog.channel == "user_input",
                            )
                            .order_by(AgentRunLog.timestamp)
                            .limit(1)
                        )
                    ).scalar_one_or_none()
                    if (prev_prompt or "").strip() == prompt:
                        log.info("auto_recover_skip_already_retried", run_id=str(agent_run.id))
                        return
            # 紧链上限（2026-09-13 24h 审查 P1）：紧邻同型守卫拦不住交替错误
            # 类型（网关 429↔502 抖动相邻永不同型，守卫永不命中 → 每次失败
            # 都重新入队、close 钩子立即派发，无上限计费重放）。auto_resume_of
            # 链长与错误类型无关（派发链 queue.py→inject.py 落该元数据），
            # 与 nudge 分支同款 AUTO_RESUME_MAX_CHAIN 兜底：本 run 已是自动
            # 重放产物即停跑交回用户。
            chain_len = await _count_chain_type(svc, agent_run)
            if chain_len >= AUTO_RESUME_MAX_CHAIN:
                log.info(
                    "auto_recover_replay_chain_limit",
                    session_id=str(session_id),
                    run_id=str(agent_run.id),
                    chain=chain_len,
                )
                await _write_chain_limit_hint(svc, agent_run)
                return
            # 用户已手动重发同文并排队（pending）→ 不重复追加。
            dup_pending_same_text = (
                await svc._session.execute(
                    select(func.count())
                    .select_from(AgentSessionQueuedMessage)
                    .where(
                        AgentSessionQueuedMessage.agent_session_id == session_id,
                        AgentSessionQueuedMessage.status == "pending",
                        AgentSessionQueuedMessage.prompt == prompt,
                    )
                )
            ).scalar_one()
            if dup_pending_same_text:
                return
            enqueue_prompt = prompt

        # 满员守卫（对齐 9-10 G10'：pending ≥ 上限弃自动，前端口径不被破坏）。
        pending_count = (
            await svc._session.execute(
                select(func.count())
                .select_from(AgentSessionQueuedMessage)
                .where(
                    AgentSessionQueuedMessage.agent_session_id == session_id,
                    AgentSessionQueuedMessage.status == "pending",
                )
            )
        ).scalar_one()
        if pending_count >= SESSION_QUEUE_MAX_PENDING:
            log.info(
                "auto_recover_skip_queue_full",
                session_id=str(session_id),
                pending=pending_count,
            )
            return

        position = (
            await svc._session.execute(
                select(func.coalesce(func.max(AgentSessionQueuedMessage.position), -1)).where(
                    AgentSessionQueuedMessage.agent_session_id == session_id
                )
            )
        ).scalar_one()
        svc._session.add(
            AgentSessionQueuedMessage(
                agent_session_id=session_id,
                sender_user_id=user_id,
                prompt=enqueue_prompt,
                origin=origin,
                llm_provider_id=(
                    str(agent_run.llm_provider_id) if agent_run.llm_provider_id else None
                ),
                agent_profile_id=(
                    str(agent_run.agent_profile_id) if agent_run.agent_profile_id else None
                ),
                status="pending",
                position=int(position) + 1,
            )
        )
        await svc._session.commit()
        log.info(
            "auto_recover_enqueued",
            session_id=str(session_id),
            run_id=str(agent_run.id),
            kind="nudge" if tool_activity else "replay",
            origin=origin,
        )
    except Exception as exc:
        await svc._session.rollback()
        log.warning(
            "auto_recover_failed",
            run_id=str(agent_run.id),
            session_id=str(agent_run.agent_session_id),
            error=str(exc),
        )


async def _count_chain_type(
    svc,
    run: AgentRun,
    *,
    quota_exceeded_only: bool = False,
    context_overflow_only: bool = False,
) -> int:
    """沿 metadata_.auto_resume_of 链回溯计数。

    quota_exceeded_only=True：只数连续 error_detail.type == 'quota_exceeded' 的
    节点（quota 链上限专用，遇非 quota 节点断链）；context_overflow_only=True：
    只数连续 'context_overflow' 节点（F1b 压缩续跑熔断专用，同构）；False：数
    全链长（紧链上限专用，对齐 9-10 G7 语义）。含当前节点。guard 防环。
    """
    chain = 0
    cursor: AgentRun | None = run
    guard = 0
    while cursor is not None and guard < 10:
        guard += 1
        detail = cursor.metadata_ if isinstance(cursor.metadata_, dict) else {}
        if quota_exceeded_only or context_overflow_only:
            wanted = "quota_exceeded" if quota_exceeded_only else "context_overflow"
            d = cursor.error_detail if isinstance(cursor.error_detail, dict) else {}
            if str(d.get("type") or "") == wanted:
                chain += 1
            else:
                break
        else:
            chain += 1
        next_id = detail.get("auto_resume_of")
        if not next_id:
            break
        try:
            cursor = await svc._session.get(AgentRun, uuid.UUID(str(next_id)))
        except ValueError:
            cursor = None
    return chain


async def _write_chain_limit_hint(svc, agent_run: AgentRun, hint_text: str | None = None) -> None:
    """链上限停跑补写 error_detail 接续指引（2026-09-12-session-live-display-fixes
    R5 / D-004；nudge 与重放分支共用）。

    链到上限停跑不再纯静默——对刚终态的 run 补写 hint（前端失败卡已渲染
    hint，零前端改动即可告知「为什么不再自动续、该怎么做」；实证会话
    d4c29d95 15:11 chain=2 停跑，用户只见「供应商异常」失败卡不知道要手动
    继续）。type/code/raw 原值不动（auto-recovery 判定消费 type/raw，既有
    断言零影响）；写入失败仅 warn（维持全程静默容错原则）。
    """
    try:
        detail = dict(agent_run.error_detail) if agent_run.error_detail else {}
        detail["hint"] = hint_text or (
            "上游连续中断，自动续跑已达上限（2 次）；请手动发送继续接续，或切换供应商后重发"
        )
        detail["auto_resume_stopped"] = True
        agent_run.error_detail = detail
        await svc._session.commit()
    except Exception as hint_err:  # 静默容错原则（维持全程不上抛）
        await svc._session.rollback()
        log.warning(
            "auto_recover_chain_limit_hint_write_failed",
            run_id=str(agent_run.id),
            error=str(hint_err),
        )
