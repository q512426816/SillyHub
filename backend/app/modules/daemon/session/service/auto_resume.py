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

from sqlalchemy import select
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.model import (
    SESSION_QUEUE_MAX_PENDING,
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
USER_INPUT_TRUNCATION_LIMIT = 5000

# 附件标记行宽松前缀（G6）：uuid36 + '|'——kind 取 DB 原始值不硬编码 image|file
# 词表（attachment_marker_line 生成器同源，前端 parseAttachmentMarkers 另有严格
# 版，此处宁可多拦不放过：任何 [附件:<uuid>| 前缀行都视为带附件）。
_ATTACHMENT_MARKER_LINE_RE = re.compile(
    r"^\[附件:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{12}\|",
    re.MULTILINE,
)


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
