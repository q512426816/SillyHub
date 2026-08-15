"""Release Service.

Manages the release lifecycle: create → approve → deploy → rollback.
Enforces deploy windows and multi-approver gates.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.release.model import Release, ReleaseApproval
from app.modules.release.schema import ReleaseCreate

log = get_logger(__name__)

VALID_STATUSES = frozenset(
    {
        "draft",
        "staging",
        "approved",
        "deploying",
        "deployed",
        "rolled_back",
    }
)

VALID_ENVIRONMENTS = frozenset({"staging", "production"})

# Default deploy window: Mon-Fri 10:00-18:00 UTC
DEFAULT_DEPLOY_WINDOW = {
    "days": [0, 1, 2, 3, 4],  # Mon=0 .. Fri=4
    "start_hour": 10,
    "end_hour": 18,
}

DEFAULT_MIN_APPROVERS = 2


class ReleaseError(AppError):
    code = "RELEASE_ERROR"
    http_status = 400


class ReleaseNotAllowed(ReleaseError):
    code = "RELEASE_NOT_ALLOWED"
    http_status = 403


class ReleaseNotFound(AppError):
    code = "RELEASE_NOT_FOUND"
    http_status = 404


def check_deploy_window(policy: dict | None) -> None:
    """Raise if current time is outside the deploy window."""
    window = policy.get("deploy_window", DEFAULT_DEPLOY_WINDOW) if policy else DEFAULT_DEPLOY_WINDOW
    now = datetime.now(UTC)
    if now.weekday() not in window.get("days", DEFAULT_DEPLOY_WINDOW["days"]):
        raise ReleaseNotAllowed(
            "当前不在允许发布的日期内，请在策略允许的工作日重试。",
            details={"weekday": now.weekday(), "allowed_days": window["days"]},
        )
    start = window.get("start_hour", DEFAULT_DEPLOY_WINDOW["start_hour"])
    end = window.get("end_hour", DEFAULT_DEPLOY_WINDOW["end_hour"])
    if not (start <= now.hour < end):
        raise ReleaseNotAllowed(
            "当前不在允许发布的时间段内，请在发布窗口内重试。",
            details={"current_hour": now.hour, "window": f"{start}-{end}"},
        )


class ReleaseService:
    """CRUD + lifecycle operations for releases."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        workspace_id: uuid.UUID,
        creator_id: uuid.UUID,
        data: ReleaseCreate,
    ) -> Release:
        if data.target_environment not in VALID_ENVIRONMENTS:
            raise ReleaseError(
                "目标环境取值非法，请检查后重试。",
                details={"target_environment": data.target_environment},
            )

        release = Release(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            version=data.version,
            title=data.title,
            status="draft",
            target_environment=data.target_environment,
            change_ids=data.change_ids,
            deploy_policy=data.deploy_policy,
            creator_id=creator_id,
        )
        self._session.add(release)
        await self._session.commit()
        await self._session.refresh(release)

        log.info("release_created", release_id=str(release.id), version=data.version)
        return release

    async def list_releases(
        self,
        workspace_id: uuid.UUID,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Release]:
        stmt = select(Release).where(Release.workspace_id == workspace_id)
        if status:
            stmt = stmt.where(Release.status == status)
        stmt = stmt.order_by(Release.created_at.desc()).offset(offset).limit(limit)
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def get(self, release_id: uuid.UUID) -> Release:
        release = await self._session.get(Release, release_id)
        if release is None:
            raise ReleaseNotFound(
                "发布单不存在或已被删除。", details={"release_id": str(release_id)}
            )
        return release

    async def approve(
        self,
        release_id: uuid.UUID,
        approver_id: uuid.UUID,
        verdict: str,
        comment: str | None = None,
    ) -> ReleaseApproval:
        release = await self.get(release_id)

        if verdict not in ("approve", "reject"):
            raise ReleaseError("审批结论只能是同意（approve）或拒绝（reject）。")

        if release.creator_id == approver_id:
            raise ReleaseNotAllowed("创建人不能审批自己提交的发布单。")

        existing = await self._session.execute(
            select(ReleaseApproval).where(
                ReleaseApproval.release_id == release_id,
                ReleaseApproval.approver_id == approver_id,
            )
        )
        if existing.scalars().first() is not None:
            raise ReleaseError("您已在该发布单投过票，无需重复审批。")

        approval = ReleaseApproval(
            id=uuid.uuid4(),
            release_id=release_id,
            approver_id=approver_id,
            verdict=verdict,
            comment=comment,
        )
        self._session.add(approval)

        if verdict == "approve":
            await self._check_approval_threshold(release)

        await self._session.commit()
        await self._session.refresh(approval)

        log.info("release_approval", release_id=str(release_id), verdict=verdict)
        return approval

    async def list_approvals(
        self,
        release_id: uuid.UUID,
    ) -> list[ReleaseApproval]:
        stmt = (
            select(ReleaseApproval)
            .where(ReleaseApproval.release_id == release_id)
            .order_by(ReleaseApproval.created_at)
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def promote_to_staging(self, release_id: uuid.UUID) -> Release:
        """Move release to staging (auto-promote after creation)."""
        release = await self.get(release_id)
        if release.status != "draft":
            raise ReleaseError(
                "当前状态不能进入预发布，请检查发布单状态。",
                details={"current_status": release.status},
            )
        release.status = "staging"
        release.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(release)
        return release

    async def deploy(self, release_id: uuid.UUID) -> Release:
        """Deploy release to target environment.

        For staging: auto-deploy (no approval needed).
        For production: requires ≥ min_approvers approvals + deploy window check.
        """
        release = await self.get(release_id)

        if release.status not in ("staging", "approved"):
            raise ReleaseError(
                "当前状态不能发布，请检查发布单状态。",
                details={"current_status": release.status},
            )

        if release.target_environment == "production":
            await self._require_approvals(release)
            check_deploy_window(release.deploy_policy)

        release.status = "deployed"
        release.deployed_at = datetime.now(UTC)
        release.updated_at = datetime.now(UTC)
        release.deploy_output = "Deploy completed successfully."
        await self._session.commit()
        await self._session.refresh(release)

        log.info(
            "release_deployed",
            release_id=str(release_id),
            environment=release.target_environment,
        )
        return release

    async def rollback(self, release_id: uuid.UUID) -> Release:
        release = await self.get(release_id)
        if release.status != "deployed":
            raise ReleaseError(
                "仅已发布的发布单可回滚。",
                details={"current_status": release.status},
            )
        release.status = "rolled_back"
        release.rolled_back_at = datetime.now(UTC)
        release.updated_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(release)

        log.info("release_rollback", release_id=str(release_id))
        return release

    async def _check_approval_threshold(self, release: Release) -> None:
        """Transition to 'approved' if enough approvals reached."""
        policy = release.deploy_policy or {}
        min_approvals = policy.get("min_approvers", DEFAULT_MIN_APPROVERS)

        count_stmt = (
            select(func.count())
            .select_from(ReleaseApproval)
            .where(
                ReleaseApproval.release_id == release.id,
                ReleaseApproval.verdict == "approve",
            )
        )
        count = (await self._session.execute(count_stmt)).scalar() or 0

        if count >= min_approvals and release.status in ("draft", "staging"):
            release.status = "approved"
            release.updated_at = datetime.now(UTC)

    async def _require_approvals(self, release: Release) -> None:
        """Raise if production release lacks sufficient approvals."""
        policy = release.deploy_policy or {}
        min_approvals = policy.get("min_approvers", DEFAULT_MIN_APPROVERS)

        count_stmt = (
            select(func.count())
            .select_from(ReleaseApproval)
            .where(
                ReleaseApproval.release_id == release.id,
                ReleaseApproval.verdict == "approve",
            )
        )
        count = (await self._session.execute(count_stmt)).scalar() or 0

        if count < min_approvals:
            raise ReleaseNotAllowed(
                f"生产发布需要至少 {min_approvals} 人审批通过，当前只有 {count} 人。",
                details={"required": min_approvals, "current": count},
            )
