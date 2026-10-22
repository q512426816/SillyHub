"""AgentRun.change_id 外键语义回归（2026-10-22-change-delete-session-history-fix / FR-02）。

历史事故：change 物理删除把锚定 run 与日志级联抹掉。本测试锁死：
- AgentRun.change_id → changes.id 必须 ON DELETE SET NULL（归属锚点，非生命周期从属）；
- AgentSession.change_id 的既有 SET NULL 语义保持不变。
"""

from __future__ import annotations

from app.modules.agent.model import AgentRun, AgentSession


def _fk_for(model, column_name: str):
    fks = list(model.__table__.c[column_name].foreign_keys)
    assert len(fks) == 1, f"{model.__name__}.{column_name} 应恰有一个外键"
    return fks[0]


def test_agent_run_change_id_fk_is_set_null() -> None:
    fk = _fk_for(AgentRun, "change_id")
    assert fk.target_fullname == "changes.id"
    assert fk.ondelete == "SET NULL"


def test_agent_session_change_id_fk_is_set_null() -> None:
    fk = _fk_for(AgentSession, "change_id")
    assert fk.target_fullname == "changes.id"
    assert fk.ondelete == "SET NULL"
