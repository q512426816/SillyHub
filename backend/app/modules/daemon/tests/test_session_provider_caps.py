# 与 frontend/__tests__/session-panel-provider-caps.test.tsx 保持两态对照口径。
"""provider 门控收敛查表的行为不变断言（provider-abstraction task-11）。

背景（design §5.2 / FR-06 / D-002@v1）：daemon/session/service.py 内四处引擎
字面量门控（``!= "claude"`` ×3 / ``not in {"claude", "codex"}`` ×1）已收敛为
``get_provider_caps(provider)["attachments" | "resume"]`` 查表（ql-20260921-005
起附件门控改查 attachments 键——cursor 附件开放，multimodal 键收窄为多模态
块通道）。本文件做**查表行为断言**——对每个收敛判定做函数级输入输出对照：

1. 真值表对照：查表判定 vs 改造前字面量判定，对 claude / codex / 未知 provider
   全集逐值断言等价（caps 表取值漂移即失败——这正是查表化后唯一的行为风险面）；
2. ``_validate_inject_attachment_rows``（inject 附件门控）：codex / 未知 provider
   携附件 → 仍抛 ``DaemonSessionAttachmentsUnsupported`` 且**中文文案逐字保留**；
   claude → 过门控（后续校验正常走到归属/数量判定，返回空列表）；
3. ``reopen_session``（resume 门控）：非 claude/codex → 仍抛
   ``DaemonSessionResumeUnsupported`` 且**英文文案逐字保留**；claude / codex →
   过 resume 门控（以更后置的 ``DaemonSessionNotActive`` 证明——异常类型不同
   即门控放行，见用例注释）。

create_session 首句附件门控与 ``_materialize_ppm_attachments`` ppm 降级门控与
inject 门控同键同极性（truth-table 同一断言覆盖）；端到端链路另由既有集成套件
守护（test_session_create_attachments.py「非 Claude 引擎 → 4xx」+
test_session_reopen.py codex reopen 放行），本文件不重复搭 DB 夹具。

夹具：零 DB——门控均在任何 DB 访问之前求值，stub ``self._session`` 与两个
前置 helper 即可函数级驱动（SimpleNamespace 会话行 / AsyncMock DB）。
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.agent.provider_caps import get_provider_caps
from app.modules.daemon.session.service import (
    DaemonSessionAttachmentsUnsupported,
    DaemonSessionNotActive,
    DaemonSessionResumeUnsupported,
    SessionService,
)

# ── ① 真值表对照：查表判定 ≡ 改造前字面量判定 ───────────────────────────────
#
# 改造前实读（2026-09-03 task-11 改造点）：
#   create_session 附件门控 / _materialize_ppm_attachments 降级门控 /
#   _validate_inject_attachment_rows 注入门控：``provider != "claude"`` → 拒绝；
#   reopen_session resume 门控：``provider not in {"claude", "codex"}`` → 拒绝。
# 下面真值表把改造前判定**逐字面量复写**在断言右侧——caps 表任何一键漂移
# （例如 codex.multimodal 误置 True）都会让等价断裂、测试失败。

# 真值表覆盖的 provider 全集：契约 provider + 空 + 未知（默认拒绝路径）。
_TRUTH_TABLE_PROVIDERS = ("claude", "codex", "pi", "cursor", "", "gemini", "gpt")


@pytest.mark.parametrize("provider", _TRUTH_TABLE_PROVIDERS)
def test_attachment_gate_truth_table_matches_current_contract(provider: str) -> None:
    """三处附件门控（create / ppm / inject，attachments 键，ql-20260921-005）。

    改键后放行集 = {claude, pi, cursor}（cursor 为 disk-only：无多模态块通道，
    图片/PDF 经 gate 相与强制落盘）；codex / 空 / 未知默认拒绝。右侧把现行
    契约字面量复写——caps 表任何一键漂移（例如 codex.attachments 误置 True）
    都会让等价断裂、测试失败。
    """
    assert (not get_provider_caps(provider)["attachments"]) == (
        provider not in {"claude", "pi", "cursor"}
    )


@pytest.mark.parametrize("provider", _TRUTH_TABLE_PROVIDERS)
def test_multimodal_block_channel_truth_table(provider: str) -> None:
    """多模态块通道键取值对照（gate 相与依据）：仅 claude / pi 为 true。

    ql-20260921-005 起 multimodal 键语义收窄为多模态块通道（resolve_multimodal_
    gate 返回值与它相与）——cursor 虽开放附件（attachments=true）但无块通道，
    此表锁定 cursor.multimodal=False 不得误翻。
    """
    assert get_provider_caps(provider)["multimodal"] == (provider in {"claude", "pi"})


@pytest.mark.parametrize("provider", _TRUTH_TABLE_PROVIDERS)
def test_resume_gate_truth_table_matches_pre_refactor_literal(provider: str) -> None:
    """reopen resume 门控（resume 键）——四引擎（claude/codex/pi/cursor）均放行。"""
    assert (not get_provider_caps(provider)["resume"]) == (
        provider not in {"claude", "codex", "pi", "cursor"}
    )


# ── ② inject 附件门控：_validate_inject_attachment_rows 函数级对照 ───────────


def _make_service_with_stub_db() -> SessionService:
    """构造带 stub DB 的 SessionService（门控后仅触达一次 execute，返回空行集）。"""
    db = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    db.execute = AsyncMock(return_value=result)
    return SessionService(db)


async def test_inject_attachment_gate_codex_rejects_with_verbatim_message() -> None:
    """codex 携附件 inject → DaemonSessionAttachmentsUnsupported（文案逐字保留）。"""
    svc = _make_service_with_stub_db()
    session_id = uuid.uuid4()
    with pytest.raises(DaemonSessionAttachmentsUnsupported) as exc_info:
        await svc._validate_inject_attachment_rows(
            session_id=session_id,
            session_user_id=uuid.uuid4(),
            session_provider="codex",
            attachment_ids=[uuid.uuid4()],
        )
    # ql-20260921-005 改键后新文案（「仅 Claude」已失实——pi/cursor 均开放附件）。
    assert exc_info.value.message == "此引擎不支持会话附件（文件与图片收件通道未开通）。"
    assert exc_info.value.details == {"session_id": str(session_id), "provider": "codex"}


async def test_inject_attachment_gate_unknown_provider_rejects_same_as_before() -> None:
    """未知 provider（默认拒绝语义）→ 同款异常。"""
    svc = _make_service_with_stub_db()
    with pytest.raises(DaemonSessionAttachmentsUnsupported) as exc_info:
        await svc._validate_inject_attachment_rows(
            session_id=uuid.uuid4(),
            session_user_id=uuid.uuid4(),
            session_provider="gemini",
            attachment_ids=[uuid.uuid4()],
        )
    assert exc_info.value.message == "此引擎不支持会话附件（文件与图片收件通道未开通）。"


async def test_inject_attachment_gate_claude_passes_gate() -> None:
    """claude 携附件 → 过引擎门控（进入归属/数量判定；空行集 + 空 ids → 返回 []）。"""
    svc = _make_service_with_stub_db()
    rows = await svc._validate_inject_attachment_rows(
        session_id=uuid.uuid4(),
        session_user_id=uuid.uuid4(),
        session_provider="claude",
        attachment_ids=[],
    )
    assert rows == []


async def test_inject_attachment_gate_cursor_passes_gate() -> None:
    """cursor 携附件 → 过引擎门控（ql-20260921-005 附件开放，disk-only 链路）。

    与 claude 同款证明：过门控即进入归属/数量判定（空 ids → 返回 []）；块
    通道降级由 resolve_multimodal_gate 相与测试守护（test_attachment_pipeline）。
    """
    svc = _make_service_with_stub_db()
    rows = await svc._validate_inject_attachment_rows(
        session_id=uuid.uuid4(),
        session_user_id=uuid.uuid4(),
        session_provider="cursor",
        attachment_ids=[],
    )
    assert rows == []


# ── ③ resume 门控：reopen_session 函数级对照 ─────────────────────────────────

_RESUME_UNSUPPORTED_MSG = (
    "Session '{sid}' provider 'gemini' does not support resume (only claude/codex)."
)


def _make_service_with_stubbed_preflight(provider: str, *, status: str) -> SessionService:
    """stub 前置 DB helper（FOR UPDATE 取行 + 归档区写校验）后的 SessionService。

    会话行用 SimpleNamespace 满足门控链字段访问：provider（门控本体）/
    agent_session_id（resume 凭证，置非空跳过 heal）/ cwd（置非空跳过 DS-7）/
    status（驱动走到门控之后的下一个校验点）。
    """
    svc = SessionService(MagicMock())
    fake_session = SimpleNamespace(
        id=uuid.uuid4(),
        provider=provider,
        agent_session_id="ag-sdk-1",
        cwd="/workspace/demo",
        status=status,
        # DS-5 活跃检查读该字段（status=active 时仅参与 stale 判定，非
        # reconnecting 恒 False——None 即可，驱动走到 NotActive 抛点）。
        last_active_at=None,
    )
    svc._get_owned_session_for_update = AsyncMock(return_value=fake_session)
    svc._ensure_session_workspace_writable = AsyncMock(return_value=None)
    return svc


async def test_reopen_resume_gate_non_contract_provider_rejects_verbatim() -> None:
    """非 claude/codex reopen → DaemonSessionResumeUnsupported（英文文案逐字保留）。"""
    svc = _make_service_with_stubbed_preflight("gemini", status="ended")
    session_id = uuid.uuid4()
    with pytest.raises(DaemonSessionResumeUnsupported) as exc_info:
        await svc.reopen_session(session_id, uuid.uuid4())
    assert exc_info.value.message == _RESUME_UNSUPPORTED_MSG.format(sid=session_id)
    assert exc_info.value.details == {"session_id": str(session_id), "provider": "gemini"}


@pytest.mark.parametrize("provider", ["claude", "codex"])
async def test_reopen_resume_gate_contract_providers_pass(provider: str) -> None:
    """claude / codex → 过 resume 门控（与改造前 ``in {"claude","codex"}`` 等价）。

    证明方式：门控链后第一个校验点是 status 活跃检查——行 status 置 active，
    若 resume 门控已放行则抛 **DaemonSessionNotActive**（更后置的异常类型）；
    若门控误拒则抛 DaemonSessionResumeUnsupported，断言即失败。
    """
    svc = _make_service_with_stubbed_preflight(provider, status="active")
    with pytest.raises(DaemonSessionNotActive) as exc_info:
        await svc.reopen_session(uuid.uuid4(), uuid.uuid4())
    assert not isinstance(exc_info.value, DaemonSessionResumeUnsupported)
