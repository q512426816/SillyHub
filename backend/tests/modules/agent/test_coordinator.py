"""Tests for ExecutionCoordinatorService — 6 capability points.

Test strategy: unit tests using in-memory SQLite via db_session fixture.
Each test creates an AgentRun record directly, then exercises the
coordinator method under test.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.base import AgentSpecBundle
from app.modules.agent.coordinator import (
    AgentRunNotPendingApproval,
    AgentRunNotResumable,
    ExecutionCoordinatorService,
    FingerprintMismatchError,
    InvalidTokenError,
    OptimisticLockError,
)
from app.modules.agent.model import AgentRun

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_run(
    session: AsyncSession,
    *,
    status: str = "pending",
    idempotency_key: str | None = None,
    resume_token: str | None = None,
    approval_token: str | None = None,
    context_fingerprint: str | None = None,
    checkpoint_version: int = 0,
    version: int = 1,
) -> AgentRun:
    """Create a minimal AgentRun for testing."""
    run = AgentRun(
        id=uuid.uuid4(),
        task_id=uuid.uuid4(),
        lease_id=uuid.uuid4(),
        agent_type="claude_code",
        status=status,
        idempotency_key=idempotency_key,
        resume_token=resume_token,
        approval_token=approval_token,
        context_fingerprint=context_fingerprint,
        checkpoint_version=checkpoint_version,
        version=version,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


def _make_bundle(**overrides: object) -> AgentSpecBundle:
    """Build a minimal AgentSpecBundle for fingerprint tests."""
    defaults = {
        "change_summary": "Test change",
        "task_key": "T-001",
        "task_title": "Test task",
        "proposal": "proposal content",
        "design": "design content",
        "plan": "plan content",
        "task_markdown": "task markdown",
    }
    defaults.update(overrides)
    return AgentSpecBundle(**defaults)  # type: ignore[arg-type]


# ===================================================================
# 1. Idempotency tests
# ===================================================================


@pytest.mark.asyncio
async def test_check_idempotency_returns_existing_run(db_session: AsyncSession) -> None:
    """Same idempotency_key returns the existing AgentRun."""
    run = await _create_run(db_session, idempotency_key="key-abc")
    coordinator = ExecutionCoordinatorService(db_session)
    found = await coordinator.check_idempotency("key-abc")
    assert found is not None
    assert found.id == run.id


@pytest.mark.asyncio
async def test_check_idempotency_returns_none_for_unknown_key(db_session: AsyncSession) -> None:
    """Non-existent key returns None."""
    coordinator = ExecutionCoordinatorService(db_session)
    found = await coordinator.check_idempotency("nonexistent")
    assert found is None


@pytest.mark.asyncio
async def test_check_idempotency_returns_none_for_null_key(db_session: AsyncSession) -> None:
    """Run with no idempotency_key is not found by any key."""
    await _create_run(db_session)  # no key
    coordinator = ExecutionCoordinatorService(db_session)
    found = await coordinator.check_idempotency("any-key")
    assert found is None


# ===================================================================
# 2. Optimistic lock tests
# ===================================================================


@pytest.mark.asyncio
async def test_update_with_lock_succeeds_on_matching_version(db_session: AsyncSession) -> None:
    """Update succeeds when expected_version matches."""
    run = await _create_run(db_session, version=1)
    coordinator = ExecutionCoordinatorService(db_session)
    updated = await coordinator.update_with_lock(run.id, expected_version=1, status="running")
    assert updated.version == 2
    assert updated.status == "running"


@pytest.mark.asyncio
async def test_update_with_lock_raises_on_version_mismatch(db_session: AsyncSession) -> None:
    """OptimisticLockError raised when version does not match."""
    run = await _create_run(db_session, version=1)
    coordinator = ExecutionCoordinatorService(db_session)
    with pytest.raises(OptimisticLockError):
        await coordinator.update_with_lock(run.id, expected_version=99, status="running")


@pytest.mark.asyncio
async def test_update_with_lock_raises_on_nonexistent_run(db_session: AsyncSession) -> None:
    """OptimisticLockError raised for non-existent run_id."""
    coordinator = ExecutionCoordinatorService(db_session)
    with pytest.raises(OptimisticLockError):
        await coordinator.update_with_lock(uuid.uuid4(), expected_version=1, status="running")


# ===================================================================
# 3. Context fingerprint tests
# ===================================================================


@pytest.mark.asyncio
async def test_compute_fingerprint_deterministic(db_session: AsyncSession) -> None:
    """Same bundle produces same fingerprint."""
    coordinator = ExecutionCoordinatorService(db_session)
    bundle = _make_bundle()
    fp1 = coordinator.compute_fingerprint(bundle)
    fp2 = coordinator.compute_fingerprint(bundle)
    assert fp1 == fp2
    assert len(fp1) == 64  # SHA-256 hex digest


@pytest.mark.asyncio
async def test_compute_fingerprint_changes_on_content_change(db_session: AsyncSession) -> None:
    """Different bundle content produces different fingerprint."""
    coordinator = ExecutionCoordinatorService(db_session)
    fp1 = coordinator.compute_fingerprint(_make_bundle())
    fp2 = coordinator.compute_fingerprint(_make_bundle(proposal="changed proposal"))
    assert fp1 != fp2


@pytest.mark.asyncio
async def test_validate_fingerprint_matches(db_session: AsyncSession) -> None:
    """validate_fingerprint returns True when fingerprints match."""
    coordinator = ExecutionCoordinatorService(db_session)
    bundle = _make_bundle()
    fp = coordinator.compute_fingerprint(bundle)
    run = await _create_run(db_session, context_fingerprint=fp)
    assert await coordinator.validate_fingerprint(run.id, fp) is True


@pytest.mark.asyncio
async def test_validate_fingerprint_mismatch(db_session: AsyncSession) -> None:
    """validate_fingerprint returns False when fingerprints differ."""
    coordinator = ExecutionCoordinatorService(db_session)
    run = await _create_run(db_session, context_fingerprint="original-fp")
    assert await coordinator.validate_fingerprint(run.id, "different-fp") is False


@pytest.mark.asyncio
async def test_validate_fingerprint_skips_when_none(db_session: AsyncSession) -> None:
    """validate_fingerprint returns True when no fingerprint stored."""
    coordinator = ExecutionCoordinatorService(db_session)
    run = await _create_run(db_session)  # no fingerprint
    assert await coordinator.validate_fingerprint(run.id, "any-fp") is True


# ===================================================================
# 4. Resume tests
# ===================================================================


@pytest.mark.asyncio
async def test_generate_resume_token(db_session: AsyncSession) -> None:
    """generate_resume_token creates and stores a token."""
    run = await _create_run(db_session)
    coordinator = ExecutionCoordinatorService(db_session)
    token = await coordinator.generate_resume_token(run)
    assert token
    assert run.resume_token == token


@pytest.mark.asyncio
async def test_resume_run_succeeds_with_valid_token(db_session: AsyncSession) -> None:
    """resume_run resets status to pending on valid token."""
    coordinator = ExecutionCoordinatorService(db_session)
    run = await _create_run(db_session, status="failed")
    token = await coordinator.generate_resume_token(run)
    resumed = await coordinator.resume_run(run.id, token)
    assert resumed.status == "pending"
    assert resumed.resume_token is None  # token consumed
    assert resumed.retry_count == 1


@pytest.mark.asyncio
async def test_resume_run_raises_on_invalid_token(db_session: AsyncSession) -> None:
    """InvalidTokenError raised when token does not match."""
    coordinator = ExecutionCoordinatorService(db_session)
    run = await _create_run(db_session, status="failed", resume_token="real-token")
    with pytest.raises(InvalidTokenError):
        await coordinator.resume_run(run.id, "wrong-token")


@pytest.mark.asyncio
async def test_resume_run_raises_on_non_resumable_status(db_session: AsyncSession) -> None:
    """AgentRunNotResumable raised when status is not failed/killed."""
    coordinator = ExecutionCoordinatorService(db_session)
    run = await _create_run(db_session, status="completed", resume_token="some-token")
    with pytest.raises(AgentRunNotResumable):
        await coordinator.resume_run(run.id, "some-token")


@pytest.mark.asyncio
async def test_resume_run_raises_on_fingerprint_mismatch(db_session: AsyncSession) -> None:
    """FingerprintMismatchError raised when context has changed."""
    coordinator = ExecutionCoordinatorService(db_session)
    run = await _create_run(
        db_session, status="failed", resume_token="tok", context_fingerprint="original"
    )
    with pytest.raises(FingerprintMismatchError):
        await coordinator.resume_run(run.id, "tok", context_fingerprint="changed")


# ===================================================================
# 5. Checkpoint tests
# ===================================================================


@pytest.mark.asyncio
async def test_save_checkpoint_increments_version(db_session: AsyncSession) -> None:
    """save_checkpoint increments checkpoint_version."""
    coordinator = ExecutionCoordinatorService(db_session)
    run = await _create_run(db_session, checkpoint_version=0)
    new_ver = await coordinator.save_checkpoint(run.id, {"step": 1}, expected_version=0)
    assert new_ver == 1
    # Save again
    new_ver2 = await coordinator.save_checkpoint(run.id, {"step": 2}, expected_version=1)
    assert new_ver2 == 2


@pytest.mark.asyncio
async def test_save_checkpoint_raises_on_version_conflict(db_session: AsyncSession) -> None:
    """OptimisticLockError raised when checkpoint_version mismatch."""
    coordinator = ExecutionCoordinatorService(db_session)
    run = await _create_run(db_session, checkpoint_version=3)
    with pytest.raises(OptimisticLockError):
        await coordinator.save_checkpoint(run.id, {"data": 1}, expected_version=0)


@pytest.mark.asyncio
async def test_load_checkpoint_returns_data(db_session: AsyncSession) -> None:
    """load_checkpoint returns the stored data."""
    coordinator = ExecutionCoordinatorService(db_session)
    run = await _create_run(db_session, checkpoint_version=0)
    await coordinator.save_checkpoint(run.id, {"progress": 50}, expected_version=0)
    data = await coordinator.load_checkpoint(run.id)
    assert data == {"progress": 50}


@pytest.mark.asyncio
async def test_load_checkpoint_returns_none_when_empty(db_session: AsyncSession) -> None:
    """load_checkpoint returns None when no checkpoint saved."""
    coordinator = ExecutionCoordinatorService(db_session)
    run = await _create_run(db_session)
    data = await coordinator.load_checkpoint(run.id)
    assert data is None


# ===================================================================
# 6. Approval tests
# ===================================================================


@pytest.mark.asyncio
async def test_request_approval_generates_token(db_session: AsyncSession) -> None:
    """request_approval generates token and sets pending_approval status."""
    coordinator = ExecutionCoordinatorService(db_session)
    run = await _create_run(db_session, status="running")
    token = await coordinator.request_approval(run.id)
    assert token
    await db_session.refresh(run)
    assert run.status == "pending_approval"
    assert run.approval_token == token


@pytest.mark.asyncio
async def test_approve_succeeds_with_valid_token(db_session: AsyncSession) -> None:
    """approve consumes token and sets status to pending."""
    coordinator = ExecutionCoordinatorService(db_session)
    run = await _create_run(db_session, status="running")
    token = await coordinator.request_approval(run.id)
    approved = await coordinator.approve(run.id, token)
    assert approved.status == "pending"
    assert approved.approval_token is None  # consumed


@pytest.mark.asyncio
async def test_approve_raises_on_invalid_token(db_session: AsyncSession) -> None:
    """InvalidTokenError raised when token does not match."""
    coordinator = ExecutionCoordinatorService(db_session)
    run = await _create_run(db_session, status="pending_approval", approval_token="real-token")
    with pytest.raises(InvalidTokenError):
        await coordinator.approve(run.id, "wrong-token")


@pytest.mark.asyncio
async def test_approve_raises_on_wrong_status(db_session: AsyncSession) -> None:
    """AgentRunNotPendingApproval raised when status is not pending_approval."""
    coordinator = ExecutionCoordinatorService(db_session)
    run = await _create_run(db_session, status="running", approval_token="tok")
    with pytest.raises(AgentRunNotPendingApproval):
        await coordinator.approve(run.id, "tok")


@pytest.mark.asyncio
async def test_approve_token_is_one_time(db_session: AsyncSession) -> None:
    """Approval token cannot be used twice."""
    coordinator = ExecutionCoordinatorService(db_session)
    run = await _create_run(db_session, status="running")
    token = await coordinator.request_approval(run.id)
    await coordinator.approve(run.id, token)
    # Token is now consumed — status changed to pending, token is None
    # Second call fails because status is no longer pending_approval
    with pytest.raises(AgentRunNotPendingApproval):
        await coordinator.approve(run.id, token)


# ===================================================================
# 7. SillySpec run deprecation tests
# ===================================================================


@pytest.mark.asyncio
async def test_start_sillyspec_run_emits_deprecation_warning(
    db_session: AsyncSession,
) -> None:
    """Calling start_sillyspec_run emits a DeprecationWarning."""
    import warnings
    from pathlib import Path
    from unittest.mock import AsyncMock, patch

    coordinator = ExecutionCoordinatorService(db_session)

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        with patch.object(
            coordinator,
            "_run_sillyspec_background",
            new_callable=AsyncMock,
        ):
            await coordinator.start_sillyspec_run(
                change_key="test-change",
                workspace_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                scope="full",
                repo_dir=Path("/tmp"),
            )

    deprecation_warnings = [w for w in caught if issubclass(w.category, DeprecationWarning)]
    assert len(deprecation_warnings) >= 1, (
        "Expected at least one DeprecationWarning from start_sillyspec_run"
    )
    assert "start_sillyspec_run is deprecated" in str(deprecation_warnings[0].message)


@pytest.mark.asyncio
async def test_start_sillyspec_run_still_returns_agent_run(
    db_session: AsyncSession,
) -> None:
    """Deprecated start_sillyspec_run still returns a valid AgentRun."""
    import warnings
    from pathlib import Path
    from unittest.mock import AsyncMock, patch

    coordinator = ExecutionCoordinatorService(db_session)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        with patch.object(
            coordinator,
            "_run_sillyspec_background",
            new_callable=AsyncMock,
        ):
            run = await coordinator.start_sillyspec_run(
                change_key="test-change",
                workspace_id=uuid.uuid4(),
                user_id=uuid.uuid4(),
                scope="full",
                repo_dir=Path("/tmp"),
            )

    assert run is not None
    assert run.status == "pending"
    assert run.agent_type == "sillyspec_full"
