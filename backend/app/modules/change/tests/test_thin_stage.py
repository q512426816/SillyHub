"""thin 辅助阶段（轻量变更）测试（2026-09-25-change-center-thin-flow task-02）。

覆盖：
- STAGE_AGENT_CONFIG thin 条目配置断言（对齐 task-01 落地值）。
- ``_validate_thin_change_key`` 白名单四态（合法过 / ``..`` 段拒 / ``default``
  拒 / ``quick-<hex8>`` 拒 / 路径分隔拒 / 空串拒）。
- ``load_prompt_template("thin.md", ...)`` 渲染契约：变量替换后无 ``{{`` 残留，
  含 flow start/done 两命令与过门格式样例。

守卫 A（sync_stage_status thin 不回写）用例由 task-05 追加到本文件。

author: qinyi
created_at: 2026-09-25
"""

from __future__ import annotations

import pytest

from app.modules.agent.service import AgentRunError
from app.modules.change.dispatch import (
    STAGE_AGENT_CONFIG,
    _validate_thin_change_key,
    get_config_for_stage,
    load_prompt_template,
)

# ===========================================================================
# thin 派发配置（对齐 task-01 落地条目）
# ===========================================================================


def test_thin_stage_config_entry() -> None:
    """thin 条目：2 调用协议配置（daemon-client 写码，不占 worktree）。"""
    config = STAGE_AGENT_CONFIG["thin"]  # 直书值面，避免枚举 import 掩盖值错误
    assert config.enabled is True
    assert config.prompt_template == "thin.md"
    assert config.phase == "Thin"
    assert config.requires_worktree is False
    assert config.read_only is False
    assert "flow" in config.description


def test_thin_stage_enum_and_auxiliary_order() -> None:
    """StageEnum.THIN 值面与辅助阶段清单序（quick → thin）。"""
    from app.modules.change.model import StageEnum

    assert StageEnum.THIN.value == "thin"
    assert [s.value for s in StageEnum.spec_auxiliary_stages()] == ["quick", "thin"]
    # thin 不进主线（TRANSITIONS/STAGE_ORDER 均无出边）
    from app.modules.change.model import TRANSITIONS

    assert StageEnum.THIN not in TRANSITIONS


# ===========================================================================
# change_key 白名单（task-02 纵深防御）
# ===========================================================================


def test_validate_thin_change_key_accepts_platform_key() -> None:
    """合法平台键（<日期>-<slug>-<hex6> 形态）放行（不抛即过）。"""
    _validate_thin_change_key("2026-09-25-change-center-thin-flow")
    _validate_thin_change_key("2026-08-12-quick-independent-stage")
    _validate_thin_change_key("feature.flag_name-v2")


def test_validate_thin_change_key_rejects_dotdot() -> None:
    """含 ``..`` 段（路径穿越）拒。"""
    with pytest.raises(AgentRunError, match="不合法"):
        _validate_thin_change_key("..")
    with pytest.raises(AgentRunError, match="不合法"):
        _validate_thin_change_key("2026-09-25-evil..traversal")
    with pytest.raises(AgentRunError, match="不合法"):
        _validate_thin_change_key("a/../b")


def test_validate_thin_change_key_rejects_default() -> None:
    """``default`` 伪键拒（CLI 无名操作）。"""
    with pytest.raises(AgentRunError, match="不合法"):
        _validate_thin_change_key("default")


def test_validate_thin_change_key_rejects_quick_session_key() -> None:
    """``quick-<hex8>`` CLI 内部会话键形态拒。"""
    with pytest.raises(AgentRunError, match="不合法"):
        _validate_thin_change_key("quick-a4939946")
    with pytest.raises(AgentRunError, match="不合法"):
        _validate_thin_change_key("quick-0e56260f")


def test_validate_thin_change_key_rejects_path_separators() -> None:
    """路径分隔符（/ 与 \\，含 Windows 盘符形态）拒——正则天然排除。"""
    for bad in ("a/b", "a\\b", "C:/evil", "../etc/passwd", "a b"):
        with pytest.raises(AgentRunError, match="不合法"):
            _validate_thin_change_key(bad)


def test_validate_thin_change_key_rejects_empty() -> None:
    """空串拒（正则 ``+`` 量词）。"""
    with pytest.raises(AgentRunError, match="不合法"):
        _validate_thin_change_key("")


# ===========================================================================
# thin.md prompt 模板渲染契约
# ===========================================================================


def test_thin_prompt_template_renders_without_placeholder_residue() -> None:
    """渲染后无 ``{{`` 残留；含两命令（flow start/done）与过门格式样例。"""
    rendered = load_prompt_template(
        "thin.md",
        {
            "change_key": "2026-09-25-demo-task",
            "change_title": "示例轻量变更",
            "workspace_id": "ws-1",
            "platform_args": " --spec-root /data/ws --workspace-id ws-1",
        },
    )
    assert "{{" not in rendered
    # 2 调用协议：start 与 done 各出现（--change 带渲染后的键）
    assert "sillyspec flow start --change 2026-09-25-demo-task" in rendered
    assert "sillyspec flow done --change 2026-09-25-demo-task" in rendered
    # platform_args 沿用现有形态（--spec-root 等直接拼在 --change 后）
    assert "--spec-root /data/ws" in rendered
    # 过门格式硬约束：独立节头行 + 列表行，且明示单行内联会被拒
    assert "成功标准：" in rendered
    assert "- <可验证的标准 1>" in rendered
    assert "inline" in rendered or "内联" in rendered
    # 断点续 / fail-closed 语义在场
    assert "断点续" in rendered
    assert "fail-closed" in rendered


def test_thin_prompt_raw_template_variables_present() -> None:
    """未渲染原文含全部四个模板变量（防止误删占位符）。"""
    raw = load_prompt_template("thin.md")
    for var in ("{{change_key}}", "{{change_title}}", "{{workspace_id}}", "{{platform_args}}"):
        assert var in raw


def test_get_config_for_stage_thin() -> None:
    """get_config_for_stage("thin") 命中（manual_dispatch 泛化路径前提）。"""
    assert get_config_for_stage("thin") is not None


# ===========================================================================
# 守卫 A：sync_stage_status（task-05 追加）
# 平台 current_stage=='thin' 且 sillyspec.db 行 status!='archived' → 跳过
# current_stage 回写与 stages JSON 写入；archived 放行翻转；非 thin 零作用。
# ===========================================================================


import sqlite3
import tempfile
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change.dispatch import SillySpecStageDispatchService
from app.modules.change.model import Change
from app.modules.workspace.model import Workspace


def _make_sillyspec_db(change_key: str, *, db_stage: str, db_status: str) -> str:
    """构造 sillyspec.db 内容（latin-1 str 形态，等价 delegate.read_file 返回值）。

    只建 sync 查询涉及的三表三行（changes/stages/steps），stage 停留 'scan'
    是 CLI thin 流的真实形态（进度落 flow-state.yaml 不落 DB）。
    """
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = Path(f.name)
    conn = sqlite3.connect(db_path)
    # executescript 不接受参数绑定，DDL 与参数化 DML 分开执行
    conn.executescript(
        """
        CREATE TABLE changes (
            id INTEGER PRIMARY KEY, name TEXT, current_stage TEXT, status TEXT
        );
        CREATE TABLE stages (
            id INTEGER PRIMARY KEY, change_id INTEGER, stage TEXT,
            status TEXT, completed_at TEXT
        );
        CREATE TABLE steps (
            id INTEGER PRIMARY KEY, stage_id INTEGER, name TEXT,
            status TEXT, ordering INTEGER
        );
        """
    )
    conn.execute(
        "INSERT INTO changes (name, current_stage, status) VALUES (?, ?, ?)",
        (change_key, db_stage, db_status),
    )
    conn.execute(
        "INSERT INTO stages (change_id, stage, status, completed_at) "
        "VALUES (1, ?, 'completed', '2026-09-25T00:00:00Z')",
        (db_stage,),
    )
    conn.execute(
        "INSERT INTO steps (stage_id, name, status, ordering) "
        "VALUES (1, 'scan-steps', 'completed', 1)"
    )
    conn.commit()
    conn.close()
    data = db_path.read_bytes()
    db_path.unlink(missing_ok=True)
    return data.decode("latin-1")


def _fake_delegate(db_content: str) -> AsyncMock:
    """HostFsDelegate 替身：stat 探存在 + read_file 回 db 内容。"""
    delegate = AsyncMock()
    delegate.stat.return_value = {"exists": True}
    delegate.read_file.return_value = db_content
    return delegate


async def _make_ws_and_change(
    session: AsyncSession, *, current_stage: str
) -> tuple[uuid.UUID, uuid.UUID]:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"thin-guard-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/thin-guard-{uuid.uuid4().hex[:8]}",
        slug=f"thin-guard-{uuid.uuid4().hex[:8]}",
    )
    session.add(ws)
    await session.flush()
    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key="2026-09-25-thin-guard-demo",
        title="thin guard demo",
        status="in_progress",
        location="active",
        path="/tmp/thin-guard-demo",
        change_type="quick",
        current_stage=current_stage,
        stages={},
    )
    session.add(change)
    await session.commit()
    return ws.id, change.id


class TestSyncStageStatusThinGuardA:
    """守卫 A 三态（dispatch.py sync_stage_status 回写段）。"""

    async def test_thin_active_db_scan_not_washed_back(self, db_session: AsyncSession) -> None:
        """thin×active：DB current_stage='scan' 不覆盖平台 'thin'，stages 无幽灵 scan 块。"""
        _, change_id = await _make_ws_and_change(db_session, current_stage="thin")
        svc = SillySpecStageDispatchService(db_session)
        db_content = _make_sillyspec_db(
            "2026-09-25-thin-guard-demo", db_stage="scan", db_status="active"
        )
        with patch.object(svc, "_get_host_fs_delegate", return_value=_fake_delegate(db_content)):
            result = await svc.sync_stage_status(db_session, change_id, uuid.uuid4())
        assert result.synced is True
        assert result.current_stage == "thin"
        change = await db_session.get(Change, change_id)
        assert change is not None
        assert change.current_stage == "thin"
        # stages JSON 不出现幽灵 scan 组（R-01 断言面）
        assert "scan" not in (change.stages or {})

    async def test_thin_archived_db_flips_through(self, db_session: AsyncSession) -> None:
        """thin×archived：DB 行 archived → 放行既有翻转链（current_stage 被 DB 值接管）。"""
        _, change_id = await _make_ws_and_change(db_session, current_stage="thin")
        svc = SillySpecStageDispatchService(db_session)
        db_content = _make_sillyspec_db(
            "2026-09-25-thin-guard-demo", db_stage="archive", db_status="archived"
        )
        with patch.object(svc, "_get_host_fs_delegate", return_value=_fake_delegate(db_content)):
            result = await svc.sync_stage_status(db_session, change_id, uuid.uuid4())
        assert result.synced is True
        change = await db_session.get(Change, change_id)
        assert change is not None
        assert change.current_stage == "archive"
        assert "archive" in (change.stages or {})

    async def test_mainline_stage_unaffected(self, db_session: AsyncSession) -> None:
        """主线阶段（execute）不受守卫影响：DB 值照常覆盖 + stages JSON 照常写入。"""
        _, change_id = await _make_ws_and_change(db_session, current_stage="execute")
        svc = SillySpecStageDispatchService(db_session)
        db_content = _make_sillyspec_db(
            "2026-09-25-thin-guard-demo", db_stage="verify", db_status="active"
        )
        with patch.object(svc, "_get_host_fs_delegate", return_value=_fake_delegate(db_content)):
            result = await svc.sync_stage_status(db_session, change_id, uuid.uuid4())
        assert result.synced is True
        change = await db_session.get(Change, change_id)
        assert change is not None
        assert change.current_stage == "verify"
        assert "verify" in (change.stages or {})
