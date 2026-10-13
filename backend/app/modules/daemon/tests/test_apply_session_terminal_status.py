"""task-01 单测：_apply_session_terminal_status（D-002@v2 反向判定 + D-005 幂等）。

覆盖 design §7.1 判定表全部 case：
- 多轮对话（interactive + session 级 change_id 为 NULL）→ active
- 单轮任务（interactive+会话级 change 绑定 / platform-managed / sillyspec / quick-chat）→ ended
- run.status=failed/killed 的单轮 → failed（killed→failed 是 task-04 不复用本函数的原因，D-003）
- 幂等：session 已 ended/failed → None
- 2026-10-13-multiturn-changeid-misjudge：多轮锚从 run.change_id 换到 session.change_id
  ——轮级变更归因（2026-10-12-run-level-change-attribution）给聊天轮 run.change_id
  打锚后，旧锚把聊天会话误判为单轮任务，每轮完成即误置 ended（生产实证会话 47e2ff1a）。
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


def _make_session(
    *,
    status: str = "active",
    change_id: uuid.UUID | None = None,
) -> AgentSession:
    """构造一个仅含判定所需字段的 AgentSession（纯内存对象，不入库）。

    change_id 语义对齐 AgentSession.change_id 列（model.py：会话本身为 change
    而建，stage 派发创建时写入）——非 run 级归因锚 current_change_id。
    """
    return AgentSession(status=status, change_id=change_id)


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


# ---- 单轮任务：stage 派发（会话级 change 绑定 + interactive dispatch） ------


def test_interactive_with_change_completed_returns_ended() -> None:
    """stage 经 interactive dispatch（session 级 change_id 绑定）→ ended。"""
    run = _make_run(
        status="completed",
        spec_strategy="interactive",
        change_id=uuid.uuid4(),
    )
    session = _make_session(status="active", change_id=uuid.uuid4())
    assert _apply_session_terminal_status(run, session) == "ended"


def test_interactive_with_change_failed_returns_failed() -> None:
    """stage 经 interactive dispatch（session 级绑定）但失败 → failed。"""
    run = _make_run(
        status="failed",
        spec_strategy="interactive",
        change_id=uuid.uuid4(),
    )
    session = _make_session(status="active", change_id=uuid.uuid4())
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
    session = _make_session(status="active", change_id=uuid.uuid4())
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
# 2026-10-13-multiturn-changeid-misjudge 之后豁免的适用面：会话级绑定 change 的
# interactive 任务会话（聊天会话在多轮分支已先行返回 active，不进豁免判定）——
# 本组用例以 session.change_id 非空构造，锁定豁免对该面零回归。


class TestRecoverableFailureKeepsSessionActive:
    """生产实证（会话 47e2ff1a）：轮级变更归因（change_id≠NULL）的聊天轮遇
    429 失败（run 30）→ 旧 is_multi_turn 判定失效 → 整个会话被终态化 failed，
    用户无法续发。修复后：聊天会话（session 级无 change 绑定）在多轮分支保持
    active；本组锁定 change 绑定会话（stage 派发）遭遇可自动恢复的模型层失败
    （quota_exceeded / context_overflow）时仍走 D-006 豁免保持 active——自动
    恢复编排与手动续发都需要 active 门；非可恢复失败语义不变。"""

    def test_interactive_change_quota_failure_keeps_active(self) -> None:
        run = _make_run(status="failed", spec_strategy="interactive", change_id=uuid.uuid4())
        run.error_detail = {
            "type": "quota_exceeded",
            "code": "1308",
            "message": "额度或配额已耗尽",
            "retryable": False,
            "reset_at": "2026-10-12T18:13:52+08:00",
        }
        session = _make_session(status="active", change_id=uuid.uuid4())
        assert _apply_session_terminal_status(run, session) == "active"

    def test_interactive_change_context_overflow_keeps_active(self) -> None:
        run = _make_run(status="failed", spec_strategy="interactive", change_id=uuid.uuid4())
        run.error_detail = {
            "type": "context_overflow",
            "code": None,
            "message": "会话上下文超出模型窗口",
            "retryable": False,
        }
        session = _make_session(status="active", change_id=uuid.uuid4())
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
        session = _make_session(status="active", change_id=uuid.uuid4())
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


# ---- 2026-10-13-multiturn-changeid-misjudge：聊天轮归因 change_id 不收口 -----


class TestChatTurnAttributionNotTerminal:
    """生产实证（会话 47e2ff1a，2026-10-13）：轮级变更归因给聊天轮 run.change_id
    打锚后，旧判定 `run.change_id is None` 把聊天会话误判成单轮任务——每轮
    completed 即误置 ended，用户每轮都要手动「重新开启」（当日 08:40:38 /
    08:47:49 / 09:04:38 三次）。修复：多轮锚换 session.change_id——聊天会话
    （会话级无 change 绑定）的 interactive 轮无论 run.change_id / run.status
    如何一律保持 active。"""

    def test_chat_turn_with_attribution_completed_keeps_active(self) -> None:
        """聊天轮带归因 change_id 且 completed → active（本轮核心回归）。"""
        run = _make_run(status="completed", spec_strategy="interactive", change_id=uuid.uuid4())
        session = _make_session(status="active", change_id=None)
        assert _apply_session_terminal_status(run, session) == "active"

    def test_chat_turn_with_attribution_non_recoverable_failure_keeps_active(self) -> None:
        """聊天轮带归因 change_id 且不可恢复失败 → 仍 active（多轮分支先行，
        用户可续发；与归因功能上线前「单轮失败不收口会话」语义对齐）。"""
        run = _make_run(status="failed", spec_strategy="interactive", change_id=uuid.uuid4())
        run.error_detail = {
            "type": "auth_failed",
            "code": "401",
            "message": "凭证失效",
            "retryable": False,
        }
        session = _make_session(status="active", change_id=None)
        assert _apply_session_terminal_status(run, session) == "active"

    def test_chat_pending_session_with_attribution_completed_keeps_active(self) -> None:
        """聊天会话 pending 态遇归因轮完成 → 激活进多轮（对齐既有 pending 用例）。"""
        run = _make_run(status="completed", spec_strategy="interactive", change_id=uuid.uuid4())
        session = _make_session(status="pending", change_id=None)
        assert _apply_session_terminal_status(run, session) == "active"

    def test_stage_session_completed_still_ended_is_regression_guard(self) -> None:
        """反向守卫：同形 run（interactive+归因 change_id）在会话级绑定的 stage
        会话上仍收口 ended——锚换列后单轮语义不松绑。"""
        run = _make_run(status="completed", spec_strategy="interactive", change_id=uuid.uuid4())
        session = _make_session(status="active", change_id=uuid.uuid4())
        assert _apply_session_terminal_status(run, session) == "ended"
