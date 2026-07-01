"""Change use cases.

Coordinates the filesystem parser with DB persistence. List/get queries read
from the DB; reparse re-reads the filesystem and reconciles rows. Document
content is read from the filesystem on-demand (not stored in DB).
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import ChangeDocNotFound, ChangeNotFound, InvalidTransition, PermissionDenied
from app.core.logging import get_logger
from app.modules.change.model import TRANSITIONS, Change, ChangeDocument, HumanGate, StageEnum
from app.modules.change.parser import ChangeParser, ChangeParserResult, ParsedChange
from app.modules.change.schema import (
    ArchiveCheckItem,
    ArchiveGateResponse,
    ChangeRead,
    ChangeSummary,
)
from app.modules.workspace.model import ChangeWorkspace, Workspace
from app.modules.workspace.service import WorkspaceService

log = get_logger(__name__)

MAX_CONTENT_BYTES = 1_000_000  # 1 MB


def resolve_human_gate(target_stage: str) -> str:
    """AD-01: transition 时一律返回 none。gate 时机推迟到 complete_stage 中处理。"""
    return HumanGate.NONE


@dataclass
class CompleteStageResult:
    """complete_stage 的返回值。"""

    change: Change
    dispatch_target: str | None
    gate: str


@dataclass
class RerunStageResult:
    """rerun_stage 的返回值。"""

    change: Change
    dispatched: bool
    agent_dispatch: dict


class ChangeService:
    """List, fetch, and reparse changes for a workspace."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        parser: ChangeParser | None = None,
        workspace_service: WorkspaceService | None = None,
    ) -> None:
        self._session = session
        self._parser = parser or ChangeParser()
        self._workspace_service = workspace_service or WorkspaceService(session)

    # ── Queries ───────────────────────────────────────────────────────────

    async def list_(
        self,
        workspace_id: uuid.UUID,
        *,
        location: str | None = None,
        status: str | None = None,
        owner: str | None = None,
        search: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[Change], int]:
        """List changes for a workspace, with pagination + search (ql-20260701-005).

        ``search`` ILIKE-matches change_key or title. Returns ``(items, total)``
        where total is the count **before** pagination (matching admin/roles 分页
        查询模式).
        """
        await self._workspace_service.get(workspace_id)

        # Base: find change_ids that belong to this workspace (direct FK OR M:N)
        mn_subq = select(col(ChangeWorkspace.change_id)).where(
            col(ChangeWorkspace.workspace_id) == workspace_id,
        )
        base = select(Change).where(
            (col(Change.workspace_id) == workspace_id) | (col(Change.id).in_(mn_subq))
        )

        if location:
            base = base.where(col(Change.location) == location)
        if status:
            base = base.where(col(Change.status) == status)
        if owner:
            try:
                owner_uuid = uuid.UUID(owner)
                base = base.where(col(Change.owner_id) == owner_uuid)
            except ValueError:
                pass
        if search:
            pattern = f"%{search}%"
            base = base.where(or_(
                col(Change.change_key).ilike(pattern),
                col(Change.title).ilike(pattern),
            ))

        # Count total (before dedup — close enough for pagination)
        count_stmt = select(func.count()).select_from(base.subquery())
        total = (await self._session.execute(count_stmt)).scalar() or 0

        base = base.order_by(col(Change.change_key).asc())
        if page_size > 0:
            base = base.offset((page - 1) * page_size).limit(page_size)

        items = list((await self._session.execute(base)).scalars().all())
        # De-duplicate (primary workspace and M:N may overlap)
        seen: set[uuid.UUID] = set()
        unique_items: list[Change] = []
        for item in items:
            if item.id not in seen:
                seen.add(item.id)
                unique_items.append(item)
        return unique_items, total

    async def get_by_key(self, workspace_id: uuid.UUID, change_key: str) -> Change:
        """Look up a change by its *change_key* within the workspace."""
        await self._workspace_service.get(workspace_id)

        # Primary workspace match
        stmt = select(Change).where(
            col(Change.workspace_id) == workspace_id,
            col(Change.change_key) == change_key,
        )
        change = (await self._session.execute(stmt)).scalars().first()

        # Fallback: M:N association
        if change is None:
            mn_stmt = (
                select(Change)
                .join(ChangeWorkspace, col(ChangeWorkspace.change_id) == col(Change.id))
                .where(
                    col(ChangeWorkspace.workspace_id) == workspace_id,
                    col(Change.change_key) == change_key,
                )
            )
            change = (await self._session.execute(mn_stmt)).scalars().first()

        if change is None:
            raise ChangeNotFound(
                f"Change '{change_key}' not found.",
                details={
                    "workspace_id": str(workspace_id),
                    "change_key": change_key,
                },
            )
        return change

    async def get(self, workspace_id: uuid.UUID, change_id: uuid.UUID) -> Change:
        await self._workspace_service.get(workspace_id)

        # Try primary workspace match first
        stmt = select(Change).where(
            col(Change.id) == change_id,
            col(Change.workspace_id) == workspace_id,
        )
        change = (await self._session.execute(stmt)).scalars().first()

        # If primary workspace doesn't match, check M:N table
        if change is None:
            mn_stmt = select(ChangeWorkspace).where(
                col(ChangeWorkspace.change_id) == change_id,
                col(ChangeWorkspace.workspace_id) == workspace_id,
            )
            mn = (await self._session.execute(mn_stmt)).scalars().first()
            if mn is not None:
                change = await self._session.get(Change, change_id)

        if change is None:
            raise ChangeNotFound(
                f"Change '{change_id}' not found.",
                details={
                    "workspace_id": str(workspace_id),
                    "change_id": str(change_id),
                },
            )
        return change

    async def get_documents(
        self, workspace_id: uuid.UUID, change_id: uuid.UUID
    ) -> tuple[list[ChangeDocument], list[str], list[str]]:
        change = await self.get(workspace_id, change_id)
        stmt = select(ChangeDocument).where(col(ChangeDocument.change_id) == change.id)
        docs = list((await self._session.execute(stmt)).scalars().all())
        prototypes = [Path(d.path).name for d in docs if d.doc_type == "prototype" and d.exists]
        references = [Path(d.path).name for d in docs if d.doc_type == "reference" and d.exists]
        return docs, prototypes, references

    async def get_document_content(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        doc_type: str,
        *,
        file_path: str | None = None,
    ) -> tuple[str, str | None, bool]:
        """Read document content from filesystem on-demand.

        Returns (path, content, exists).
        """
        change = await self.get(workspace_id, change_id)
        workspace = await self._workspace_service.get(workspace_id)
        root = Path(workspace.root_path)

        # Find the ChangeDocument row
        stmt = select(ChangeDocument).where(
            col(ChangeDocument.change_id) == change.id,
            col(ChangeDocument.doc_type) == doc_type,
        )
        if file_path:
            stmt = stmt.where(col(ChangeDocument.path) == file_path)
        doc = (await self._session.execute(stmt)).scalars().first()

        if doc is None or not doc.exists:
            raise ChangeDocNotFound(
                f"Document '{doc_type}' not found for change.",
                details={
                    "workspace_id": str(workspace_id),
                    "change_id": str(change_id),
                    "doc_type": doc_type,
                },
            )

        # Read from filesystem
        full_path = root / doc.path
        try:
            resolved = full_path.resolve()
            if not str(resolved).startswith(str(root.resolve())):
                raise ChangeDocNotFound("Path traversal detected.")
            if not full_path.is_file():
                return doc.path, None, False
            size = full_path.stat().st_size
            content = full_path.read_text(encoding="utf-8", errors="replace")
            if size > MAX_CONTENT_BYTES:
                content = content[: MAX_CONTENT_BYTES // 4]
            # Update word_count on content read
            doc.word_count = len(content.split())
            self._session.add(doc)
            return doc.path, content, True
        except ChangeDocNotFound:
            raise
        except Exception:
            return doc.path, None, False

    # ── Progress / Approval / Documents ─────────────────────────────────

    async def update_progress(
        self,
        workspace_id: uuid.UUID,
        change_key: str,
        *,
        current_stage: str,
        stages: dict,
        last_active: str,
    ) -> None:
        change = await self.get_by_key(workspace_id, change_key)
        change.current_stage = current_stage
        change.stages = stages
        change.updated_at = datetime.now(UTC)
        self._session.add(change)
        await self._session.commit()

    async def get_approval(
        self, workspace_id: uuid.UUID, change_key: str
    ) -> tuple[str, str | None]:
        change = await self.get_by_key(workspace_id, change_key)
        return change.approval_status, change.rejection_reason

    async def approve(
        self,
        workspace_id: uuid.UUID,
        change_key: str,
        *,
        approved_by: str,
    ) -> None:
        change = await self.get_by_key(workspace_id, change_key)
        change.approval_status = "approved"
        change.approved_by = approved_by
        change.approved_at = datetime.now(UTC)
        change.updated_at = datetime.now(UTC)
        self._session.add(change)
        await self._session.commit()

    async def reject(
        self,
        workspace_id: uuid.UUID,
        change_key: str,
        *,
        reason: str,
    ) -> None:
        change = await self.get_by_key(workspace_id, change_key)
        change.approval_status = "rejected"
        change.rejection_reason = reason
        change.updated_at = datetime.now(UTC)
        self._session.add(change)
        await self._session.commit()

    async def sync_documents(
        self,
        workspace_id: uuid.UUID,
        change_key: str,
        documents: list[tuple[str, str]],
    ) -> int:
        """Write document files to disk and upsert ChangeDocument rows.

        Returns the number of documents synced.
        """
        change = await self.get_by_key(workspace_id, change_key)
        workspace = await self._workspace_service.get(workspace_id)
        root = Path(workspace.root_path)

        synced = 0
        for filename, content in documents:
            # Write file to .sillyspec/changes/{change_key}/{filename}
            relative = f".sillyspec/changes/{change_key}/{filename}"
            full_path = root / relative
            resolved = full_path.resolve()
            if not str(resolved).startswith(str(root.resolve())):
                raise ChangeDocNotFound("Path traversal detected.")
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(content, encoding="utf-8")
            now = datetime.now(UTC)

            # Upsert ChangeDocument row
            stmt = select(ChangeDocument).where(
                col(ChangeDocument.change_id) == change.id,
                col(ChangeDocument.doc_type) == filename,
            )
            doc = (await self._session.execute(stmt)).scalars().first()
            if doc is None:
                doc = ChangeDocument(
                    id=uuid.uuid4(),
                    change_id=change.id,
                    doc_type=filename,
                    path=relative,
                    exists=True,
                    last_modified_at=now,
                )
                self._session.add(doc)
            else:
                doc.exists = True
                doc.last_modified_at = now
            synced += 1

        await self._session.commit()
        return synced

    # ── Workflow ────────────────────────────────────────────────────────

    async def transition(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        target_stage: str,
        user_role: str,
        *,
        reason: str | None = None,
    ) -> Change:
        """执行状态流转。"""
        change = await self.get(workspace_id, change_id)
        current = change.current_stage or "draft"

        # Validate current stage exists in TRANSITIONS
        current_key = StageEnum(current)  # convert to StageEnum
        if current_key not in TRANSITIONS:
            raise InvalidTransition(f"未知阶段: {current_key}")

        # Find the target transition
        transitions_from_current = TRANSITIONS[current_key]
        try:
            target_key = StageEnum(target_stage)
        except ValueError:
            raise InvalidTransition(f"无效的目标阶段: {target_stage}") from None
        if target_key not in transitions_from_current:
            raise InvalidTransition(f"不允许从 {current_key.value} 流转到 {target_stage}")

        # Check role permission (admin bypasses all)
        allowed_roles = transitions_from_current[target_key]
        if user_role != "admin" and user_role not in allowed_roles:
            raise PermissionDenied(
                f"角色 '{user_role}' 无权执行 {current_key.value} → {target_stage} 流转"
            )

        # Log transition to stages JSON
        stages = change.stages or {}
        transitions_log = stages.get("transitions", [])
        transitions_log.append(
            {
                "from": current,
                "to": target_stage,
                "by_role": user_role,
                "reason": reason,
                "at": datetime.now(UTC).isoformat(),
            }
        )
        stages["transitions"] = transitions_log

        # Update change
        change.current_stage = target_stage
        change.stages = stages
        change.human_gate = resolve_human_gate(target_stage)
        change.updated_at = datetime.now(UTC)
        self._session.add(change)

        # Record audit log
        from app.modules.workflow.model import AuditLog

        audit_entry = AuditLog(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            actor_id=None,
            action="change.transition",
            resource_type="change",
            resource_id=change.id,
            details_json=json.dumps({"from": current, "to": target_stage}),
        )
        self._session.add(audit_entry)

        await self._session.commit()
        return change

    async def transition_with_dispatch(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        target_stage: str,
        user_role: str,
        *,
        reason: str | None = None,
        user_id: uuid.UUID | None = None,
        provider: str | None = None,
        model: str | None = None,
    ) -> dict:
        """Execute transition and optionally dispatch an agent for the target stage.

        Returns a dict with the change data and agent dispatch info.
        """
        change = await self.transition(
            workspace_id=workspace_id,
            change_id=change_id,
            target_stage=target_stage,
            user_role=user_role,
            reason=reason,
        )

        # Attempt agent dispatch after commit (best-effort, non-blocking)
        dispatch_result: dict = {}
        if user_id is not None:
            try:
                from app.core.db import get_session_factory
                from app.modules.change.dispatch import dispatch

                # Use a fresh session to avoid conflicts with transition's session
                factory = get_session_factory()
                async with factory() as dispatch_session:
                    dispatch_result = await dispatch(
                        session=dispatch_session,
                        workspace_id=workspace_id,
                        change_id=change_id,
                        target_stage=target_stage,
                        user_id=user_id,
                        provider=provider,
                        model=model,
                    )
            except Exception as exc:
                log.warning(
                    "dispatch_after_transition_failed",
                    change_id=str(change_id),
                    target_stage=target_stage,
                    error=str(exc),
                )
                dispatch_result = {
                    "dispatched": False,
                    "reason": "dispatch_exception",
                    "error": str(exc),
                }

        return {
            "change": change,
            "agent_dispatch": dispatch_result,
        }

    async def submit_feedback(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        category: str,
        text: str,
        user_id: uuid.UUID,
        *,
        target_stage: str | None = None,
    ) -> Change:
        """提交反馈并流转至 blocked（human_gate）阶段。"""
        # Validate category
        if category not in ("A", "B", "C", "D"):
            raise InvalidTransition(f"无效的反馈类别: {category}")

        FEEDBACK_TARGETS = {  # noqa: N806
            "A": "execute",
            "B": "propose",
            "C": "brainstorm",
            "D": "archive",
        }
        rework_target = target_stage or FEEDBACK_TARGETS[category]

        change = await self.get(workspace_id, change_id)

        # Validate current stage allows feedback
        current = change.current_stage or "draft"
        if current not in ("verify", "archive"):
            raise InvalidTransition("当前阶段不允许提交反馈，仅限 verify 和 archive")

        # Save feedback info
        change.feedback_category = category
        change.feedback_text = text
        # reviewer info stored in stages JSON

        # Update stages JSON
        stages = change.stages or {}
        stages["last_feedback"] = {
            "category": category,
            "text": text,
            "rework_target": rework_target,
            "submitted_by": str(user_id),
            "submitted_at": datetime.now(UTC).isoformat(),
        }
        change.stages = stages

        if category == "D":
            # D: accept as-is, move to archive stage
            change.current_stage = "archive"
            # Log the special transition
            transitions_log = stages.get("transitions", [])
            transitions_log.append(
                {
                    "from": current,
                    "to": "archive",
                    "by_role": "reviewer",
                    "reason": f"反馈类别 D（衍生新 change）: {text[:100]}",
                    "at": datetime.now(UTC).isoformat(),
                }
            )
            stages["transitions"] = transitions_log
            change.stages = stages
        else:
            # A/B/C: transition to blocked (human_gate mechanism)
            change.current_stage = "blocked"
            transitions_log = stages.get("transitions", [])
            transitions_log.append(
                {
                    "from": current,
                    "to": "blocked",
                    "by_role": "reviewer",
                    "reason": f"反馈类别 {category}: {text[:100]}",
                    "at": datetime.now(UTC).isoformat(),
                }
            )
            stages["transitions"] = transitions_log
            stages["rework_target"] = rework_target
            change.stages = stages

        change.updated_at = datetime.now(UTC)
        self._session.add(change)
        await self._session.commit()
        return change

    async def check_archive_gate(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
    ) -> ArchiveGateResponse:
        """归档门禁检查。"""
        change = await self.get(workspace_id, change_id)
        checks: list[ArchiveCheckItem] = []

        current = change.current_stage or "draft"
        if current != "archive":
            # Not in archive stage - all checks fail
            for name in [
                "no_unresolved_feedback",
                "ac_confirmed",
                "tech_verification_passed",
                "business_review_passed",
                "feedback_categorized",
                "documents_complete",
            ]:
                checks.append(
                    ArchiveCheckItem(
                        name=name,
                        passed=False,
                        detail=f"当前阶段非 archive（{current}），无法归档",
                    )
                )
            return ArchiveGateResponse(can_archive=False, checks=checks)

        # Check 1: no unresolved feedback
        checks.append(
            ArchiveCheckItem(
                name="no_unresolved_feedback",
                passed=change.feedback_category is None,
                detail=""
                if change.feedback_category is None
                else f"存在未解决反馈，类别: {change.feedback_category}",
            )
        )

        stages = change.stages or {}

        # Check 2: AC confirmed
        ac_confirmed = stages.get("ac_confirmed", False)
        checks.append(
            ArchiveCheckItem(
                name="ac_confirmed",
                passed=bool(ac_confirmed),
                detail="" if ac_confirmed else "验收标准尚未确认",
            )
        )

        # Check 3: tech verification passed
        tech_passed = stages.get("tech_verification_passed", False)
        checks.append(
            ArchiveCheckItem(
                name="tech_verification_passed",
                passed=bool(tech_passed),
                detail="" if tech_passed else "技术验证未通过",
            )
        )

        # Check 4: business review passed
        biz_passed = stages.get("business_review_passed", False)
        checks.append(
            ArchiveCheckItem(
                name="business_review_passed",
                passed=bool(biz_passed),
                detail="" if biz_passed else "业务评审未通过",
            )
        )

        # Check 5: feedback categorized
        feedback_records = stages.get("feedback_history", [])
        uncategorized = [f for f in feedback_records if not f.get("category")]
        checks.append(
            ArchiveCheckItem(
                name="feedback_categorized",
                passed=len(uncategorized) == 0,
                detail="" if not uncategorized else f"{len(uncategorized)} 条反馈未分类",
            )
        )

        # Check 6: documents complete — 四件套必须齐全（exists）
        REQUIRED_DOC_TYPES = {"proposal", "design", "requirements", "tasks"}  # noqa: N806
        docs, _, _ = await self.get_documents(workspace_id, change_id)
        existing_types = {d.doc_type for d in docs if d.exists}
        missing = REQUIRED_DOC_TYPES - existing_types
        checks.append(
            ArchiveCheckItem(
                name="documents_complete",
                passed=len(missing) == 0,
                detail="" if not missing else f"缺少必需文档: {', '.join(sorted(missing))}",
            )
        )

        can_archive = all(check.passed for check in checks)
        return ArchiveGateResponse(can_archive=can_archive, checks=checks)

    # ── Reparse ───────────────────────────────────────────────────────────

    async def reparse(self, workspace_id: uuid.UUID) -> tuple[dict[str, int], ChangeParserResult]:
        workspace = await self._workspace_service.get(workspace_id)
        # 平台 specRoot 有镜像数据就读（任意 strategy：platform-managed/repo-native/repo-mirrored）。
        # 旧逻辑只 platform-managed 读 spec_root，repo-native/repo-mirrored 读 root_path
        # （daemon-client 客户端路径容器内不可达）→ 扫不到 changes → 变更中心不显示。
        sillyspec_root = Path(workspace.root_path)
        try:
            from app.modules.spec_workspace.service import SpecWorkspaceService

            spec_ws = await SpecWorkspaceService(self._session).get(workspace.id)
            if spec_ws and spec_ws.spec_root:
                sillyspec_root = Path(spec_ws.spec_root)
        except Exception as exc:
            log.warning(
                "change.reparse_spec_root_resolve_failed",
                workspace_id=str(workspace_id),
                error=str(exc),
            )

        from app.modules.workspace.service import is_daemon_client_path_source

        # daemon-client 同步产出扁平布局（无 .sillyspec 包裹），parser 需 platform_managed
        # 才能读到 specRoot/changes/；server-local 仍包裹（.sillyspec/changes/）
        platform_managed = is_daemon_client_path_source(workspace.path_source)
        result = self._parser.parse_workspace(sillyspec_root, platform_managed=platform_managed)
        stats = {"parsed": 0, "created": 0, "updated": 0, "deleted": 0, "renamed": 0}

        # Fetch existing changes
        existing_changes = await self._fetch_existing_changes(workspace_id)
        existing_by_key = {c.change_key: c for c in existing_changes}

        # Detect directory renames before processing
        parsed_key_set = {p.change_key for p in result.changes}
        rename_map = self._detect_renames(existing_by_key, parsed_key_set, sillyspec_root)

        # Update existing_by_key for renamed entries: old_key → new_key
        for new_key, old_row in rename_map.items():
            old_key = old_row.change_key
            existing_by_key.pop(old_key, None)
            existing_by_key[new_key] = old_row

        seen_keys: set[str] = set()

        for parsed in result.changes:
            seen_keys.add(parsed.change_key)
            stats["parsed"] += 1

            if parsed.change_key in existing_by_key:
                row = existing_by_key[parsed.change_key]
                self._apply_parsed(row, parsed, workspace_id=workspace_id)
                if parsed.change_key in rename_map:
                    stats["renamed"] += 1
                else:
                    stats["updated"] += 1
            else:
                row = self._build_change(parsed, workspace_id=workspace_id)
                self._session.add(row)
                stats["created"] += 1

            # Sync documents for this change
            _existing = existing_by_key.get(parsed.change_key, row)
            await self._sync_docs(
                change=parsed,
                workspace_id=workspace_id,
                existing_change=_existing,
                stats=stats,
            )

            # Sync M:N workspace associations
            target_id = (
                existing_by_key[parsed.change_key].id
                if parsed.change_key in existing_by_key
                else row.id
            )
            await self._sync_change_workspaces(
                change_id=target_id,
                workspace_id=workspace_id,
                parsed=parsed,
            )

        # Delete changes whose keys disappeared and were not renamed
        for key, row in existing_by_key.items():
            if key not in seen_keys:
                await self._session.delete(row)
                stats["deleted"] += 1

        await self._session.commit()
        log.info("changes.reparsed", workspace_id=str(workspace_id), **stats)
        return stats, result

    @staticmethod
    def _detect_renames(
        existing_by_key: dict[str, Change],
        parsed_keys: set[str],
        sillyspec_root: Path,
    ) -> dict[str, Change]:
        """Detect directory renames by matching date prefix + directory absence.

        When sillyspec CLI renames a change directory, the old key disappears
        and a new key appears. This method matches them so the existing DB row
        keeps its workflow state (current_stage, human_gate, stages JSON).

        Returns a map of new_key → existing Change row for detected renames.
        """
        if not existing_by_key or not parsed_keys:
            return {}

        changes_dir = sillyspec_root / ".sillyspec" / "changes"

        # Find orphaned DB rows whose directories no longer exist on disk
        orphaned: dict[str, Change] = {}
        for key, row in existing_by_key.items():
            if key not in parsed_keys:
                dir_path = changes_dir / key
                if not dir_path.is_dir():
                    orphaned[key] = row

        new_keys = parsed_keys - set(existing_by_key.keys())
        if not orphaned or not new_keys:
            return {}

        result: dict[str, Change] = {}
        matched_old_keys: set[str] = set()

        for new_key in new_keys:
            new_prefix = new_key[:11]  # "YYYY-MM-DD-"
            candidates = [
                (old_key, row)
                for old_key, row in orphaned.items()
                if old_key[:11] == new_prefix and old_key not in matched_old_keys
            ]
            # Only match when unambiguous (exactly one candidate with same date)
            if len(candidates) == 1:
                result[new_key] = candidates[0][1]
                matched_old_keys.add(candidates[0][0])
                log.info(
                    "reparse.rename_detected",
                    old_key=candidates[0][0],
                    new_key=new_key,
                )

        return result

    # ── Helpers ───────────────────────────────────────────────────────────

    async def _fetch_existing_changes(self, workspace_id: uuid.UUID) -> list[Change]:
        stmt = select(Change).where(col(Change.workspace_id) == workspace_id)
        return list((await self._session.execute(stmt)).scalars().all())

    async def _sync_docs(
        self,
        *,
        change: ParsedChange,
        workspace_id: uuid.UUID,
        existing_change: Change,
        stats: dict[str, int],
    ) -> None:
        existing_docs = await self._fetch_existing_docs(existing_change.id)
        existing_by_key = {(d.doc_type, d.path): d for d in existing_docs}

        seen_keys: set[tuple[str, str]] = set()
        for parsed_doc in change.docs:
            key = (parsed_doc.doc_type, parsed_doc.path)
            seen_keys.add(key)

            if key in existing_by_key:
                row = existing_by_key[key]
                row.exists = parsed_doc.exists
                row.last_modified_at = parsed_doc.last_modified_at
            else:
                row = ChangeDocument(
                    id=uuid.uuid4(),
                    change_id=existing_change.id,
                    doc_type=parsed_doc.doc_type,
                    path=parsed_doc.path,
                    exists=parsed_doc.exists,
                    last_modified_at=parsed_doc.last_modified_at,
                )
                self._session.add(row)

        for key, row in existing_by_key.items():
            if key not in seen_keys:
                await self._session.delete(row)

    async def _fetch_existing_docs(self, change_id: uuid.UUID) -> list[ChangeDocument]:
        stmt = select(ChangeDocument).where(col(ChangeDocument.change_id) == change_id)
        return list((await self._session.execute(stmt)).scalars().all())

    # ── M:N Enrichment ──────────────────────────────────────────────────

    async def enrich_with_workspace_ids(self, change: Change) -> ChangeRead:
        """Build ChangeRead with workspace_ids populated from M:N table.

        workspace_ids list starts with the primary workspace_id, followed by
        secondary workspace IDs from the M:N table. No duplicates.
        """
        stmt = select(col(ChangeWorkspace.workspace_id)).where(
            col(ChangeWorkspace.change_id) == change.id,
        )
        all_mn = [row[0] for row in (await self._session.execute(stmt)).all()]
        # Exclude primary workspace_id to avoid duplication
        secondary = [wid for wid in all_mn if wid != change.workspace_id]
        data = ChangeRead.model_validate(change)
        data.workspace_ids = [change.workspace_id] + secondary
        return data

    async def enrich_summaries(self, changes: list[Change]) -> list[ChangeSummary]:
        """Build ChangeSummary list with workspace_ids populated.

        Queries the M:N table for each change to get associated workspace IDs.
        For MVP scale, per-item queries are sufficient.
        """
        result: list[ChangeSummary] = []
        for c in changes:
            stmt = select(col(ChangeWorkspace.workspace_id)).where(
                col(ChangeWorkspace.change_id) == c.id,
            )
            all_mn = [row[0] for row in (await self._session.execute(stmt)).all()]
            secondary = [wid for wid in all_mn if wid != c.workspace_id]
            data = ChangeSummary.model_validate(c)
            data.workspace_ids = [c.workspace_id] + secondary
            result.append(data)
        return result

    # ── M:N Sync ────────────────────────────────────────────────────────

    async def _sync_change_workspaces(
        self,
        change_id: uuid.UUID,
        workspace_id: uuid.UUID,
        parsed: ParsedChange,
    ) -> None:
        """Sync M:N associations for a change based on affected_components.

        Strategy:
        1. Primary workspace is always written with role="primary"
        2. affected_components matching a workspace component_key -> role="affected"
        3. Existing associations not in the new list are deleted
        """
        ws_ids: set[uuid.UUID] = {workspace_id}
        if parsed.affected_components:
            stmt = select(col(Workspace.id)).where(
                col(Workspace.component_key).in_(parsed.affected_components),
                col(Workspace.deleted_at).is_(None),
            )
            extra = [row[0] for row in (await self._session.execute(stmt)).all()]
            ws_ids.update(extra)

        # Get existing associations
        existing_stmt = select(ChangeWorkspace).where(
            col(ChangeWorkspace.change_id) == change_id,
        )
        existing = list((await self._session.execute(existing_stmt)).scalars().all())
        existing_ws_ids = {cw.workspace_id for cw in existing}

        # Delete stale associations
        for cw in existing:
            if cw.workspace_id not in ws_ids:
                await self._session.delete(cw)

        # Add new associations
        for wid in ws_ids - existing_ws_ids:
            role = "primary" if wid == workspace_id else "affected"
            self._session.add(
                ChangeWorkspace(
                    change_id=change_id,
                    workspace_id=wid,
                    role=role,
                )
            )

    @staticmethod
    def _build_change(
        parsed: ParsedChange,
        *,
        workspace_id: uuid.UUID,
    ) -> Change:
        return Change(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            change_key=parsed.change_key,
            title=parsed.title,
            status=parsed.status,
            location=parsed.location,
            path=parsed.path,
            affected_components=parsed.affected_components,
            change_type=parsed.change_type,
            owner_id=None,
        )

    @staticmethod
    def _apply_parsed(
        row: Change,
        parsed: ParsedChange,
        *,
        workspace_id: uuid.UUID,
    ) -> None:
        row.title = parsed.title
        # change_type: only overwrite when DB value is None (protect user-set values)
        if row.change_type is None and parsed.change_type is not None:
            row.change_type = parsed.change_type
        # affected_components: always overwrite (inferred value is more accurate)
        if parsed.affected_components:
            row.affected_components = parsed.affected_components
        row.change_key = parsed.change_key
        row.location = parsed.location
        row.path = parsed.path

    # ── Review Gate methods ────────────────────────────────────────────

    async def proposal_review(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        decision: str,
        comment: str | None,
        user_id: uuid.UUID,
    ) -> dict:
        change = await self.get(workspace_id, change_id)
        if change.current_stage != "propose" or change.human_gate != "need_proposal_review":
            raise InvalidTransition(
                "当前状态不允许 proposal review",
                details={"current_stage": change.current_stage, "human_gate": change.human_gate},
            )

        # Record review_history before executing the action
        target_action_map = {
            "approve": "transition:plan",
            "revise": "rerun:propose",
            "unclear": "transition:brainstorm",
        }
        stages = change.stages or {}
        review_history = stages.get("review_history", [])
        review_history.append(
            {
                "decision": decision,
                "comment": comment,
                "user_id": str(user_id),
                "submitted_at": datetime.now(UTC).isoformat(),
                "from_stage": "propose",
                "target_action": target_action_map[decision],
            }
        )
        stages["review_history"] = review_history
        change.stages = stages
        self._session.add(change)
        await self._session.commit()

        if decision == "approve":
            return await self.transition_with_dispatch(
                workspace_id=workspace_id,
                change_id=change_id,
                target_stage="plan",
                user_role="reviewer",
                reason=comment or "proposal approved",
                user_id=user_id,
            )
        elif decision == "revise":
            r = await self.rerun_stage(
                workspace_id=workspace_id,
                change_id=change_id,
                stage="propose",
                comment=comment,
                user_id=user_id,
            )
            return {
                "change": r.change,
                "agent_dispatch": r.agent_dispatch,
            }
        else:  # unclear
            return await self.transition_with_dispatch(
                workspace_id=workspace_id,
                change_id=change_id,
                target_stage="brainstorm",
                user_role="admin",
                reason=comment or "proposal unclear, back to brainstorm",
                user_id=user_id,
            )

    async def plan_review(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        decision: str,
        comment: str | None,
        user_id: uuid.UUID,
    ) -> dict:
        change = await self.get(workspace_id, change_id)
        if change.current_stage != "plan" or change.human_gate != "need_plan_review":
            raise InvalidTransition(
                "当前状态不允许 plan review",
                details={"current_stage": change.current_stage, "human_gate": change.human_gate},
            )

        # Record review_history
        target_action_map = {
            "approve": "transition:execute",
            "replan": "rerun:plan",
            "back_to_propose": "transition:propose",
            "back_to_brainstorm": "transition:brainstorm",
        }
        stages = change.stages or {}
        review_history = stages.get("review_history", [])
        review_history.append(
            {
                "decision": decision,
                "comment": comment,
                "user_id": str(user_id),
                "submitted_at": datetime.now(UTC).isoformat(),
                "from_stage": "plan",
                "target_action": target_action_map[decision],
            }
        )
        stages["review_history"] = review_history
        change.stages = stages
        self._session.add(change)
        await self._session.commit()

        if decision == "approve":
            return await self.transition_with_dispatch(
                workspace_id=workspace_id,
                change_id=change_id,
                target_stage="execute",
                user_role="reviewer",
                reason=comment or "plan approved",
                user_id=user_id,
            )
        elif decision == "replan":
            r = await self.rerun_stage(
                workspace_id=workspace_id,
                change_id=change_id,
                stage="plan",
                comment=comment,
                user_id=user_id,
            )
            return {
                "change": r.change,
                "agent_dispatch": r.agent_dispatch,
            }
        elif decision == "back_to_propose":
            return await self.transition_with_dispatch(
                workspace_id=workspace_id,
                change_id=change_id,
                target_stage="propose",
                user_role="admin",
                reason=comment or "back to propose",
                user_id=user_id,
            )
        else:  # back_to_brainstorm
            return await self.transition_with_dispatch(
                workspace_id=workspace_id,
                change_id=change_id,
                target_stage="brainstorm",
                user_role="admin",
                reason=comment or "back to brainstorm",
                user_id=user_id,
            )

    async def human_test(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        result: str,
        comment: str | None,
        user_id: uuid.UUID,
    ) -> dict:
        change = await self.get(workspace_id, change_id)
        if change.current_stage != "verify" or change.human_gate != "need_human_test":
            raise InvalidTransition(
                "当前状态不允许 human test",
                details={"current_stage": change.current_stage, "human_gate": change.human_gate},
            )

        # Record review_history
        target_action_map = {
            "pass": "transition:archive",
            "bug": "transition:quick",
            "doc_mismatch": "transition:propose",
        }
        stages = change.stages or {}
        review_history = stages.get("review_history", [])
        review_history.append(
            {
                "decision": result,
                "comment": comment,
                "user_id": str(user_id),
                "submitted_at": datetime.now(UTC).isoformat(),
                "from_stage": "verify",
                "target_action": target_action_map[result],
            }
        )
        stages["review_history"] = review_history
        change.stages = stages
        self._session.add(change)
        await self._session.commit()

        if result == "pass":
            # AD-04: pass 只设 archive+need_archive_confirm，不 dispatch archive
            change.current_stage = "archive"
            change.human_gate = HumanGate.NEED_ARCHIVE_CONFIRM
            change.updated_at = datetime.now(UTC)
            self._session.add(change)
            await self._session.commit()
            return {
                "change": change,
                "agent_dispatch": {"dispatched": False, "reason": "need_archive_confirm"},
            }
        elif result == "bug":
            return await self.transition_with_dispatch(
                workspace_id=workspace_id,
                change_id=change_id,
                target_stage="quick",
                user_role="admin",
                reason=comment or "bug found in human test",
                user_id=user_id,
            )
        else:  # doc_mismatch
            return await self.transition_with_dispatch(
                workspace_id=workspace_id,
                change_id=change_id,
                target_stage="propose",
                user_role="admin",
                reason=comment or "doc mismatch found in human test",
                user_id=user_id,
            )

    # ── Stage completion ────────────────────────────────────────────────

    @staticmethod
    def _resolve_stage_completion(stage: str, result: str | None) -> tuple[str, str, str | None]:
        """Map stage + result to (new_current_stage, new_human_gate, dispatch_target).

        See design.md "complete_stage 阶段映射".
        """
        if stage == "brainstorm":
            if result == "clear" or result is None:
                return ("propose", HumanGate.NEED_PROPOSAL_REVIEW, None)
            return ("brainstorm", HumanGate.NEED_REQUIREMENT_INPUT, None)

        if stage == "propose":
            return ("propose", HumanGate.NEED_PROPOSAL_REVIEW, None)

        if stage == "plan":
            return ("plan", HumanGate.NEED_PLAN_REVIEW, None)

        if stage == "execute":
            return ("verify", HumanGate.NONE, "verify")

        if stage == "verify":
            if result == "passed":
                return ("verify", HumanGate.NEED_HUMAN_TEST, None)
            return ("quick", HumanGate.NONE, "quick")

        if stage == "quick":
            return ("verify", HumanGate.NONE, "verify")

        if stage == "archive":
            return ("archived", HumanGate.NONE, None)

        # Unknown stage — no change
        return (stage, HumanGate.NONE, None)

    async def complete_stage(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        stage: str,
        result: str | None = None,
        summary: str | None = None,
    ) -> CompleteStageResult:
        """Agent 完成某一阶段后，统一设置 current_stage 和 human_gate。

        AD-01: 此方法只更新 DB 状态，不执行 agent dispatch。
        dispatch 由调用方 (auto_dispatch_next_step) 根据 dispatch_target 执行。
        """
        change = await self.get(workspace_id, change_id)
        new_stage, new_gate, dispatch_target = self._resolve_stage_completion(stage, result)

        change.current_stage = new_stage
        change.human_gate = new_gate
        change.updated_at = datetime.now(UTC)

        stages = change.stages or {}
        stages["last_stage_completion"] = {
            "stage": stage,
            "result": result,
            "summary": summary,
            "new_stage": new_stage,
            "new_gate": new_gate,
            "completed_at": datetime.now(UTC).isoformat(),
        }
        change.stages = stages

        from app.modules.workflow.model import AuditLog

        audit = AuditLog(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            actor_id=None,
            action="change.complete_stage",
            resource_type="change",
            resource_id=change.id,
            details_json=json.dumps(
                {"stage": stage, "result": result, "new_stage": new_stage, "new_gate": new_gate}
            ),
        )
        self._session.add(audit)
        self._session.add(change)
        await self._session.commit()

        return CompleteStageResult(
            change=change,
            dispatch_target=dispatch_target,
            gate=new_gate,
        )

    async def rerun_stage(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        stage: str,
        *,
        comment: str | None = None,
        user_id: uuid.UUID | None = None,
    ) -> RerunStageResult:
        """Re-run the current stage by dispatching an agent after reviewer feedback.

        Allows a reviewer to request re-execution of the same stage (propose/plan)
        when ``human_gate`` is ``need_proposal_review`` or ``need_plan_review``.
        The stage stays the same; the agent re-generates the document.
        """
        change = await self.get(workspace_id, change_id)

        # 1. Validate stage matches current_stage
        current = change.current_stage or "draft"
        if stage != current:
            raise InvalidTransition(
                f"rerun_stage 阶段不匹配: 请求 {stage}，当前 {current}",
                details={"requested_stage": stage, "current_stage": current},
            )

        # 2. Validate human_gate
        allowed_gates = {HumanGate.NEED_PROPOSAL_REVIEW, HumanGate.NEED_PLAN_REVIEW}
        if change.human_gate not in allowed_gates:
            raise InvalidTransition(
                f"当前 human_gate 不允许 rerun: {change.human_gate}",
                details={
                    "human_gate": change.human_gate,
                    "allowed": sorted(allowed_gates),
                },
            )

        # 3. Record comment to stages.review_history
        stages = change.stages or {}
        review_history = stages.get("review_history", [])
        review_history.append(
            {
                "action": "rerun",
                "stage": stage,
                "comment": comment,
                "at": datetime.now(UTC).isoformat(),
            }
        )
        stages["review_history"] = review_history

        # 4. Clear human_gate
        change.human_gate = HumanGate.NONE

        # 5. Update stages.last_review
        stages["last_review"] = {
            "action": "rerun",
            "stage": stage,
            "comment": comment,
            "at": datetime.now(UTC).isoformat(),
        }
        change.stages = stages
        change.updated_at = datetime.now(UTC)
        self._session.add(change)

        # 6. Write audit log
        from app.modules.workflow.model import AuditLog

        audit_entry = AuditLog(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            actor_id=user_id,
            action="change.rerun_stage",
            resource_type="change",
            resource_id=change.id,
            details_json=json.dumps({"stage": stage, "comment": comment}),
        )
        self._session.add(audit_entry)

        # 7. Commit DB changes
        await self._session.commit()

        # 8. Dispatch agent for current stage (best-effort, independent session)
        dispatched = False
        agent_dispatch: dict = {}
        if user_id is not None:
            try:
                from app.core.db import get_session_factory
                from app.modules.change.dispatch import dispatch

                factory = get_session_factory()
                async with factory() as dispatch_session:
                    agent_dispatch = await dispatch(
                        session=dispatch_session,
                        workspace_id=workspace_id,
                        change_id=change_id,
                        target_stage=stage,
                        user_id=user_id,
                    )
                    dispatched = True
            except Exception as exc:
                log.warning(
                    "rerun_stage_dispatch_failed",
                    change_id=str(change_id),
                    stage=stage,
                    error=str(exc),
                )
                agent_dispatch = {
                    "dispatched": False,
                    "reason": "dispatch_exception",
                    "error": str(exc),
                }

        return RerunStageResult(
            change=change,
            dispatched=dispatched,
            agent_dispatch=agent_dispatch,
        )

    async def archive_confirm(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        comment: str | None,
        user_id: uuid.UUID,
    ) -> dict:
        """AD-05: 归档确认 — 只在 archive+need_archive_confirm 时允许。

        清除 human_gate 并 dispatch archive Agent。
        """
        change = await self.get(workspace_id, change_id)
        if change.current_stage != "archive" or change.human_gate != "need_archive_confirm":
            raise InvalidTransition(
                "当前状态不允许归档确认",
                details={"current_stage": change.current_stage, "human_gate": change.human_gate},
            )

        # Record review_history
        stages = change.stages or {}
        review_history = stages.get("review_history", [])
        review_history.append(
            {
                "decision": "archive_confirm",
                "comment": comment,
                "user_id": str(user_id),
                "submitted_at": datetime.now(UTC).isoformat(),
                "from_stage": "archive",
                "target_action": "dispatch:archive",
            }
        )
        stages["review_history"] = review_history
        change.stages = stages
        change.human_gate = HumanGate.NONE
        change.updated_at = datetime.now(UTC)
        self._session.add(change)
        await self._session.commit()

        # Dispatch archive Agent (best-effort, independent session)
        dispatch_result: dict = {}
        try:
            from app.core.db import get_session_factory
            from app.modules.change.dispatch import dispatch

            factory = get_session_factory()
            async with factory() as dispatch_session:
                dispatch_result = await dispatch(
                    session=dispatch_session,
                    workspace_id=workspace_id,
                    change_id=change_id,
                    target_stage="archive",
                    user_id=user_id,
                )
        except Exception as exc:
            log.warning(
                "archive_confirm_dispatch_failed",
                change_id=str(change_id),
                error=str(exc),
            )
            dispatch_result = {
                "dispatched": False,
                "reason": "dispatch_exception",
                "error": str(exc),
            }

        return {"change": change, "agent_dispatch": dispatch_result}
