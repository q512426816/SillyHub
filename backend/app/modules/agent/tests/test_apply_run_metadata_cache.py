"""Tests for batch-path cache token parsing via _apply_run_metadata (task-06 / FR-02).

Covers the batch-path cache token handling added by change
2026-06-24-runtime-usage-stats task-06. This file is the task-06 / task-15
designated backend test for batch-path meta cache parsing
(``test_apply_run_metadata_cache.py`` per task-15 allowed_paths).

- ``_apply_run_metadata(run, meta)``: parse ``meta.cache_read_tokens`` /
  ``cache_creation_tokens`` (both added to ``_METADATA_FIELDS`` by task-06)
  and ``setattr`` onto ``AgentRun``. Mirrors how the existing
  ``input_tokens`` / ``output_tokens`` / ``total_cost_usd`` are parsed — a
  simple non-None overwrite (batch metadata is the terminal daemon report,
  no max-guard like the interactive submit path).
- ``None`` values are skipped (D-001@v1 codex best-effort: daemon reports no
  cache_* when the provider doesn't expose prompt cache).

Task-05 added the ``AgentRun.cache_read_tokens`` / ``cache_creation_tokens``
columns; this file exercises the parser that fills them from batch metadata.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.agent.service import _METADATA_FIELDS, _apply_run_metadata


async def _make_run(session: AsyncSession) -> AgentRun:
    """Insert a bare AgentRun row (no session/lease FKs needed for this unit)."""
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        spec_strategy="oneshot",
        # seed non-cache fields so we can assert they are preserved
        input_tokens=100,
        output_tokens=50,
        total_cost_usd=0.01,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


class TestMetadataFieldsIncludesCache:
    """_METADATA_FIELDS 元组必须含 cache 两维(task-06 接线守卫)。"""

    def test_cache_read_tokens_in_fields(self) -> None:
        assert "cache_read_tokens" in _METADATA_FIELDS, (
            "task-06 必须把 cache_read_tokens 加入 _METADATA_FIELDS,"
            "否则 batch meta 的 cache 读取词元会被 _apply_run_metadata 忽略"
        )

    def test_cache_creation_tokens_in_fields(self) -> None:
        assert "cache_creation_tokens" in _METADATA_FIELDS, (
            "task-06 必须把 cache_creation_tokens 加入 _METADATA_FIELDS,"
            "否则 batch meta 的 cache 写入词元会被 _apply_run_metadata 忽略"
        )

    def test_existing_fields_not_regressed(self) -> None:
        """既有字段不被 task-06 改动意外删除。"""
        for legacy in ("total_cost_usd", "input_tokens", "output_tokens"):
            assert legacy in _METADATA_FIELDS, f"{legacy} 不应被移除"


class TestApplyRunMetadataCacheTokens:
    """_apply_run_metadata 解析 cache_* 写入 AgentRun(AC-1/AC-2)。"""

    @pytest.mark.asyncio
    async def test_cache_tokens_written_from_meta(self, db_session: AsyncSession) -> None:
        """AC-1:meta 含 cache_read/creation → AgentRun 两字段写入。

        对齐 task-15 §test_apply_run_metadata_cache_fields:
          setup: meta={'input_tokens':100, 'cache_read_tokens':5000, 'cache_creation_tokens':200}
          断言:AgentRun.cache_read_tokens == 5000, cache_creation_tokens == 200
        """
        run = await _make_run(db_session)
        meta = {
            "input_tokens": 100,
            "cache_read_tokens": 5000,
            "cache_creation_tokens": 200,
        }
        _apply_run_metadata(run, meta)
        await db_session.commit()

        reloaded = await db_session.get(AgentRun, run.id)
        assert reloaded is not None
        assert reloaded.cache_read_tokens == 5000
        assert reloaded.cache_creation_tokens == 200
        # 既有字段不回归
        assert reloaded.input_tokens == 100
        assert reloaded.output_tokens == 50

    @pytest.mark.asyncio
    async def test_cache_missing_stays_null(self, db_session: AsyncSession) -> None:
        """AC-2:meta 无 cache 字段(codex 系)→ AgentRun 两字段保持 None。

        D-001@v1 codex 尽力而为:codex / OpenAI 系无 prompt cache,daemon meta 不报
        cache_*,_apply_run_metadata 跳过 None 值,AgentRun.cache_* 不被写。
        对齐 task-15 §test_apply_run_metadata_cache_missing_stays_null。
        """
        run = await _make_run(db_session)
        # 先预置一个值,确保不是 None(验证 None 跳过不覆盖)
        run.cache_read_tokens = 999
        run.cache_creation_tokens = 888
        await db_session.commit()

        meta = {"input_tokens": 100}  # 无 cache 键
        _apply_run_metadata(run, meta)
        await db_session.commit()

        reloaded = await db_session.get(AgentRun, run.id)
        assert reloaded is not None
        # None 值被跳过,既有值保留
        assert reloaded.cache_read_tokens == 999
        assert reloaded.cache_creation_tokens == 888

    @pytest.mark.asyncio
    async def test_cache_explicit_none_skipped(self, db_session: AsyncSession) -> None:
        """meta 显式 cache_read_tokens=None → 跳过,AgentRun 不写 None。

        守卫:if value is not None: setattr —— 即便 meta 显式给 None 也不覆盖。
        对齐既有 input_tokens/output_tokens 语义(它们同样 None 跳过)。
        """
        run = await _make_run(db_session)
        run.cache_read_tokens = 5000
        run.cache_creation_tokens = 200
        await db_session.commit()

        meta = {
            "cache_read_tokens": None,  # 显式 None
            "cache_creation_tokens": None,
        }
        _apply_run_metadata(run, meta)
        await db_session.commit()

        reloaded = await db_session.get(AgentRun, run.id)
        assert reloaded is not None
        assert reloaded.cache_read_tokens == 5000  # 不被 None 覆盖
        assert reloaded.cache_creation_tokens == 200

    @pytest.mark.asyncio
    async def test_cache_zero_value_written(self, db_session: AsyncSession) -> None:
        """cache_read_tokens=0(非 None)→ 写入 0(与 None 区分)。

        守卫是 ``if value is not None`` 而非 ``if value``,所以 0 会被写入。
        这是 batch meta 的语义:daemon 显式报 0 = 确认无 cache 命中,与缺失(None)区分。
        与 interactive submit_messages 的「> 0 过滤」不同 —— batch meta 是终态报告,
        0 是真实值应保留。
        """
        run = await _make_run(db_session)
        meta = {"cache_read_tokens": 0, "cache_creation_tokens": 0}
        _apply_run_metadata(run, meta)
        await db_session.commit()

        reloaded = await db_session.get(AgentRun, run.id)
        assert reloaded is not None
        assert reloaded.cache_read_tokens == 0
        assert reloaded.cache_creation_tokens == 0

    @pytest.mark.asyncio
    async def test_full_meta_all_fields_applied(self, db_session: AsyncSession) -> None:
        """完整 meta(全 _METADATA_FIELDS)→ 全部写入,无字段被遗漏。

        回归守卫:task-06 加 cache 两维不应破坏既有 8 字段解析。
        """
        run = await _make_run(db_session)
        meta = {
            "total_cost_usd": 1.23,
            "duration_ms": 45000,
            "duration_api_ms": 30000,
            "num_turns": 3,
            "session_id": "sess-meta-1",
            "input_tokens": 200,
            "output_tokens": 80,
            "cache_read_tokens": 6000,
            "cache_creation_tokens": 300,
        }
        _apply_run_metadata(run, meta)
        await db_session.commit()

        reloaded = await db_session.get(AgentRun, run.id)
        assert reloaded is not None
        assert reloaded.total_cost_usd == pytest.approx(1.23)
        assert reloaded.duration_ms == 45000
        assert reloaded.duration_api_ms == 30000
        assert reloaded.num_turns == 3
        assert reloaded.session_id == "sess-meta-1"
        assert reloaded.input_tokens == 200
        assert reloaded.output_tokens == 80
        assert reloaded.cache_read_tokens == 6000
        assert reloaded.cache_creation_tokens == 300

    def test_apply_is_in_place_mutation(self) -> None:
        """_apply_run_metadata 原地修改 run 对象(无返回值,调用方依赖副作用)。

        回归:既有调用方(batch 结束链路)假设函数原地改 run 再由上层 commit,
        若改成返回新对象会断链。断言无返回值(隐式 None)。
        """
        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="completed",
            spec_strategy="oneshot",
            created_at=datetime.now(UTC),
        )
        result = _apply_run_metadata(run, {"cache_read_tokens": 100})  # type: ignore[func-returns-value]
        assert result is None
        assert run.cache_read_tokens == 100  # 原地写入
