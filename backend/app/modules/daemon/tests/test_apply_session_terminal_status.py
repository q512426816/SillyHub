"""task-01 单测：_apply_session_terminal_status（D-002@v2 反向判定 + D-005 幂等）。

覆盖 design §7.1 判定表全部 case：
- 多轮对话（interactive + 无 change_id）→ active
- 单轮任务（interactive+change / platform-managed / sillyspec / quick-chat）→ ended
- run.status=failed/killed 的单轮 → failed（killed→failed 是 task-04 不复用本函数的原因，D-003）
- 幂等：session 已 ended/failed → None
"""

from __future__ import annotations

import uuid

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.session.service import _apply_session_terminal_status


def _make_run(
    *,
    status: str = "completed",
    spec_strategy: str | None = "interactive",
    change_id: uuid.UUID | None = None,
) -> AgentRun:
    """构造一个仅含判定所需字段的 AgentRun（纯内存对象，不入库）。"""
    return AgentRun(
        status=status,
        spec_strategy=spec_strategy,
        change_id=change_id,
    )


def _make_session(*, status: str = "active") -> AgentSession:
    """构造一个仅含判定所需字段的 AgentSession（纯内存对象，不入库）。"""
    return AgentSession(status=status)


# ---- 多轮对话：interactive + 无 change_id → active --------------------------


def test_multi_turn_interactive_without_change_returns_active() -> None:
    """多轮对话：interactive 且 change_id=None → 保持 active（等下一个 run）。"""
    run = _make_run(status="completed", spec_strategy="interactive", change_id=None)
    session = _make_session(status="active")
    assert _apply_session_terminal_status(run, session) == "active"


def test_multi_turn_interactive_pending_session_stays_active() -> None:
    """多轮对话：session 初始 pending → 仍返 active（激活进入多轮）。"""
    run = _make_run(status="completed", spec_strategy="interactive", change_id=None)
    session = _make_session(status="pending")
    assert _apply_session_terminal_status(run, session) == "active"


def test_multi_turn_interactive_failed_run_still_active() -> None:
    """多轮对话：单轮 run 失败也不收口 session（用户可继续下一轮）。"""
    run = _make_run(status="failed", spec_strategy="interactive", change_id=None)
    session = _make_session(status="active")
    assert _apply_session_terminal_status(run, session) == "active"


# ---- 单轮任务：interactive + 有 change_id（stage 经 interactive dispatch） ---


def test_interactive_with_change_completed_returns_ended() -> None:
    """stage 经 interactive dispatch（change_id 非空）→ ended。"""
    run = _make_run(
        status="completed",
        spec_strategy="interactive",
        change_id=uuid.uuid4(),
    )
    session = _make_session(status="active")
    assert _apply_session_terminal_status(run, session) == "ended"


def test_interactive_with_change_failed_returns_failed() -> None:
    """stage 经 interactive dispatch 但失败 → failed。"""
    run = _make_run(
        status="failed",
        spec_strategy="interactive",
        change_id=uuid.uuid4(),
    )
    session = _make_session(status="active")
    assert _apply_session_terminal_status(run, session) == "failed"


# ---- 单轮任务：其它 spec_strategy ----------------------------------------


def test_platform_managed_completed_returns_ended() -> None:
    """platform-managed（scan）完成 → ended。"""
    run = _make_run(status="completed", spec_strategy="platform-managed", change_id=None)
    session = _make_session(status="active")
    assert _apply_session_terminal_status(run, session) == "ended"


def test_sillyspec_completed_returns_ended() -> None:
    """sillyspec（stage）完成 → ended。"""
    run = _make_run(status="completed", spec_strategy="sillyspec", change_id=None)
    session = _make_session(status="active")
    assert _apply_session_terminal_status(run, session) == "ended"


def test_quick_chat_completed_returns_ended() -> None:
    """quick-chat 完成即收口 → ended。"""
    run = _make_run(status="completed", spec_strategy="quick-chat", change_id=None)
    session = _make_session(status="active")
    assert _apply_session_terminal_status(run, session) == "ended"


def test_none_spec_strategy_completed_returns_ended() -> None:
    """spec_strategy=None（legacy/未指定）按单轮 → ended。"""
    run = _make_run(status="completed", spec_strategy=None, change_id=None)
    session = _make_session(status="active")
    assert _apply_session_terminal_status(run, session) == "ended"


# ---- run.status 分支（单轮任务）------------------------------------------


def test_single_turn_killed_returns_failed() -> None:
    """单轮 run.status=killed → failed（killed 不算 completed）。

    注：辅助函数对 killed 一律返 failed，这正是 task-04（cancel_lease）不复用本函数
    的原因——cancel 路径需要 session→'cancelled'，见 D-003。
    """
    run = _make_run(
        status="killed",
        spec_strategy="interactive",
        change_id=uuid.uuid4(),
    )
    session = _make_session(status="active")
    assert _apply_session_terminal_status(run, session) == "failed"


def test_single_turn_completed_returns_ended() -> None:
    """单轮 run.status=completed → ended。"""
    run = _make_run(status="completed", spec_strategy="quick-chat", change_id=None)
    session = _make_session(status="active")
    assert _apply_session_terminal_status(run, session) == "ended"


def test_single_turn_failed_returns_failed() -> None:
    """单轮 run.status=failed → failed。"""
    run = _make_run(status="failed", spec_strategy="quick-chat", change_id=None)
    session = _make_session(status="active")
    assert _apply_session_terminal_status(run, session) == "failed"


# ---- D-005 幂等守卫 -------------------------------------------------------


def test_idempotent_when_session_already_ended() -> None:
    """session 已 ended → None（不重复收口）。"""
    run = _make_run(status="completed", spec_strategy="quick-chat", change_id=None)
    session = _make_session(status="ended")
    assert _apply_session_terminal_status(run, session) is None


def test_idempotent_when_session_already_failed() -> None:
    """session 已 failed → None（不覆盖）。"""
    run = _make_run(status="completed", spec_strategy="quick-chat", change_id=None)
    session = _make_session(status="failed")
    assert _apply_session_terminal_status(run, session) is None


def test_idempotent_ended_even_for_multi_turn() -> None:
    """幂等优先于多轮判定：session 已 ended 即便多轮 run 也返 None。"""
    run = _make_run(status="completed", spec_strategy="interactive", change_id=None)
    session = _make_session(status="ended")
    assert _apply_session_terminal_status(run, session) is None


# ---- D-006（2026-10-12-session-defects task-09）：会话级可恢复失败豁免 -------


class TestRecoverableFailureKeepsSessionActive:
    """生产实证（会话 47e2ff1a）：轮级变更归因（change_id≠NULL）的聊天轮遇
    429 失败（run 30）→ is_multi_turn 判定失效 → 整个会话被终态化 failed，
    用户无法续发。修复后：interactive 会话遭遇可自动恢复的模型层失败
    （quota_exceeded / context_overflow）时保持 active——自动恢复编排
    （auto_resume）与用户手动续发都需要 active 门；非可恢复失败语义不变。"""

    def test_interactive_change_quota_failure_keeps_active(self) -> None:
        run = _make_run(status="failed", spec_strategy="interactive", change_id=uuid.uuid4())
        run.error_detail = {
            "type": "quota_exceeded",
            "code": "1308",
            "message": "额度或配额已耗尽",
            "retryable": False,
            "reset_at": "2026-10-12T18:13:52+08:00",
        }
        session = _make_session(status="active")
        assert _apply_session_terminal_status(run, session) == "active"

    def test_interactive_change_context_overflow_keeps_active(self) -> None:
        run = _make_run(status="failed", spec_strategy="interactive", change_id=uuid.uuid4())
        run.error_detail = {
            "type": "context_overflow",
            "code": None,
            "message": "会话上下文超出模型窗口",
            "retryable": False,
        }
        session = _make_session(status="active")
        assert _apply_session_terminal_status(run, session) == "active"

    def test_interactive_change_non_recoverable_failure_still_failed(self) -> None:
        """非可恢复失败（无 error_detail / 其他 type）维持既有 failed 语义
        （既有 test_interactive_with_change_failed_returns_failed 零回归）。"""
        run = _make_run(status="failed", spec_strategy="interactive", change_id=uuid.uuid4())
        run.error_detail = {
            "type": "auth_failed",
            "code": "401",
            "message": "凭证失效",
            "retryable": False,
        }
        session = _make_session(status="active")
        assert _apply_session_terminal_status(run, session) == "failed"

    def test_non_interactive_quota_failure_still_failed(self) -> None:
        """非会话型轮（stage/scan 等单轮任务）不受豁免——照旧按 run 收口。"""
        run = _make_run(status="failed", spec_strategy="quick_chat", change_id=None)
        run.error_detail = {
            "type": "quota_exceeded",
            "code": None,
            "message": "x",
            "retryable": False,
        }
        session = _make_session(status="active")
        assert _apply_session_terminal_status(run, session) == "failed"
