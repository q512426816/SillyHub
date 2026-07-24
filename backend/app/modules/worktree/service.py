"""Worktree lease lifecycle: acquire, release, extend, GC."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.crypto import CredentialCipher, get_cipher
from app.core.errors import (
    PermissionDenied,
    WorktreeAcquireFailed,
    WorktreeLeaseAlreadyReleased,
    WorktreeLeaseNotFound,
)
from app.core.logging import get_logger
from app.modules.git_identity.model import GitIdentity
from app.modules.worktree.exec_env import ExecEnvBuilder
from app.modules.worktree.git_runner import GitRunner
from app.modules.worktree.model import WorktreeLease
from app.modules.worktree.schema import WorktreeAcquireRequest

log = get_logger(__name__)


class WorktreeService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        cipher: CredentialCipher | None = None,
        git_runner: GitRunner | None = None,
        exec_env: ExecEnvBuilder | None = None,
    ) -> None:
        self._session = session
        self._cipher = cipher or get_cipher()
        self._git_runner = git_runner or GitRunner()
        self._exec_env = exec_env or ExecEnvBuilder()

    # ── Acquire ──────────────────────────────────────────────────────────

    async def acquire(
        self,
        user_id: uuid.UUID,
        workspace_id: uuid.UUID,
        data: WorktreeAcquireRequest,
    ) -> WorktreeLease:
        # 1. Validate git identity
        identity = await self._get_identity(data.git_identity_id, user_id)
        self._assert_identity_usable(identity)

        # 2. Get workspace repo_url
        workspace_obj = await self._get_workspace(workspace_id)
        if not workspace_obj.repo_url:
            raise WorktreeAcquireFailed(
                "Workspace has no repo_url configured.",
                details={"workspace_id": str(workspace_id)},
            )

        # 3. Compute paths
        run_id = uuid.uuid4()
        ids = {
            "ws": str(workspace_id),
            "comp": str(workspace_id),
            "user": str(user_id),
            "change": str(data.change_id),
            "task": str(data.task_id),
            "run": str(run_id),
        }
        branch_name = (
            f"users/{identity.git_username or user_id}"
            f"/changes/{data.change_id}"
            f"/tasks/{data.task_id}"
        )
        lease_root = self._exec_env.lease_root(**ids)
        repo_dir = self._exec_env.repo_dir(lease_root)
        bare_path = self._exec_env.bare_repo_path(ids["ws"], ids["comp"])
        expires_at = datetime.now(UTC) + timedelta(seconds=data.ttl_seconds)

        # 4. Create DB record first
        lease = WorktreeLease(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            component_id=data.component_id,
            change_id=data.change_id,
            task_id=data.task_id,
            user_id=user_id,
            run_id=run_id,
            git_identity_id=data.git_identity_id,
            path=str(lease_root),
            branch_name=branch_name,
            status="locked",
            locked_at=datetime.now(UTC),
            expires_at=expires_at,
        )
        self._session.add(lease)

        # 5. Filesystem operations
        try:
            env = self._exec_env.build_env_vars(lease_root)
            await self._git_runner.clone_bare(workspace_obj.repo_url, bare_path, env)
            await self._git_runner.worktree_add(bare_path, repo_dir, branch_name, env)
            self._exec_env.create_directories(lease_root)
            self._exec_env.write_gitconfig(lease_root, identity.git_username, identity.git_email)
            token = self._cipher.decrypt(identity.encrypted_credential, identity.key_id)
            self._exec_env.write_askpass(lease_root, token)
        except Exception:
            await self._session.rollback()
            self._exec_env.cleanup(lease_root)
            raise

        await self._session.commit()
        await self._session.refresh(lease)
        log.info(
            "worktree_acquired",
            lease_id=str(lease.id),
            workspace_id=str(workspace_id),
        )
        return lease

    # ── Release ──────────────────────────────────────────────────────────

    async def release(
        self,
        lease_id: uuid.UUID,
        user_id: uuid.UUID,
        is_admin: bool = False,
    ) -> WorktreeLease:
        lease = await self._get_lease(lease_id)
        if lease.user_id != user_id and not is_admin:
            raise PermissionDenied("Not your worktree lease.")
        if lease.status != "locked":
            raise WorktreeLeaseAlreadyReleased(
                "Lease is not in locked state.",
                details={"status": lease.status},
            )

        lease_root = self._path_or_none(lease.path)
        if lease_root:
            try:
                await self._git_runner.worktree_remove(
                    self._exec_env.repo_dir(lease_root),
                    self._exec_env.build_env_vars(lease_root),
                )
            except Exception:
                log.warning("worktree_remove_failed", lease_id=str(lease_id))
            self._exec_env.shred_askpass(lease_root)
            self._exec_env.cleanup(lease_root)

        lease.status = "released"
        lease.released_at = datetime.now(UTC)
        await self._session.commit()
        await self._session.refresh(lease)
        log.info("worktree_released", lease_id=str(lease_id))
        return lease

    # ── Get / List ───────────────────────────────────────────────────────

    async def get_lease(
        self,
        lease_id: uuid.UUID,
        user_id: uuid.UUID,
        is_admin: bool = False,
    ) -> WorktreeLease:
        lease = await self._get_lease(lease_id)
        if lease.user_id != user_id and not is_admin:
            raise PermissionDenied("Not your worktree lease.")
        return lease

    async def list_(
        self,
        workspace_id: uuid.UUID,
    ) -> tuple[list[WorktreeLease], int]:
        stmt = (
            select(WorktreeLease)
            .where(col(WorktreeLease.workspace_id) == workspace_id)
            .order_by(col(WorktreeLease.locked_at).desc())
        )
        rows = list((await self._session.execute(stmt)).scalars().all())
        return rows, len(rows)

    # ── Extend ───────────────────────────────────────────────────────────

    async def extend(
        self,
        lease_id: uuid.UUID,
        user_id: uuid.UUID,
        additional_seconds: int,
    ) -> WorktreeLease:
        lease = await self._get_lease(lease_id)
        if lease.user_id != user_id:
            raise PermissionDenied("Not your worktree lease.")
        if lease.status != "locked":
            raise WorktreeLeaseAlreadyReleased(
                "Cannot extend a non-locked lease.",
                details={"status": lease.status},
            )
        lease.expires_at = lease.expires_at + timedelta(seconds=additional_seconds)
        await self._session.commit()
        await self._session.refresh(lease)
        log.info("worktree_extended", lease_id=str(lease_id))
        return lease

    # ── Helpers ──────────────────────────────────────────────────────────

    async def _get_lease(self, lease_id: uuid.UUID) -> WorktreeLease:
        stmt = select(WorktreeLease).where(col(WorktreeLease.id) == lease_id)
        row = (await self._session.execute(stmt)).scalars().first()
        if row is None:
            raise WorktreeLeaseNotFound(
                f"Worktree lease '{lease_id}' not found.",
                details={"lease_id": str(lease_id)},
            )
        return row

    async def _get_identity(self, identity_id: uuid.UUID, user_id: uuid.UUID) -> GitIdentity:
        stmt = select(GitIdentity).where(col(GitIdentity.id) == identity_id)
        row = (await self._session.execute(stmt)).scalars().first()
        if row is None:
            raise WorktreeLeaseNotFound(
                f"Git identity '{identity_id}' not found.",
                details={"identity_id": str(identity_id)},
            )
        if row.user_id != user_id:
            raise PermissionDenied("Not your git identity.")
        return row

    @staticmethod
    def _assert_identity_usable(identity: GitIdentity) -> None:
        if identity.revoked_at is not None:
            raise WorktreeAcquireFailed(
                "Git identity has been revoked.",
                details={"identity_id": str(identity.id)},
            )
        if identity.expires_at and identity.expires_at < datetime.now(UTC):
            raise WorktreeAcquireFailed(
                "Git identity has expired.",
                details={"identity_id": str(identity.id)},
            )

    async def _get_workspace(self, workspace_id: uuid.UUID):
        from app.modules.workspace.model import Workspace

        stmt = select(Workspace).where(col(Workspace.id) == workspace_id)
        row = (await self._session.execute(stmt)).scalars().first()
        if row is None:
            raise WorktreeLeaseNotFound(
                f"Workspace '{workspace_id}' not found.",
                details={"workspace_id": str(workspace_id)},
            )
        return row

    @staticmethod
    def _path_or_none(path_str: str | None) -> str | None:
        from pathlib import Path

        if not path_str:
            return None
        p = Path(path_str)
        return str(p) if p.exists() else None
