"""Change use cases.

Coordinates the filesystem parser with DB persistence. List/get queries read
from the DB; reparse re-reads the filesystem and reconciles rows. Document
content is read from the filesystem on-demand (not stored in DB).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import ChangeDocNotFound, ChangeNotFound, InvalidTransition, PermissionDenied
from app.core.logging import get_logger
from app.modules.change.model import Change, ChangeDocument, StageEnum, TRANSITIONS
from app.modules.change.parser import ChangeParser, ChangeParserResult, ParsedChange
from app.modules.change.schema import ArchiveCheckItem, ArchiveGateResponse, ChangeRead, ChangeSummary
from app.modules.workspace.model import ChangeWorkspace, Workspace
from app.modules.workspace.service import WorkspaceService

log = get_logger(__name__)

MAX_CONTENT_BYTES = 1_000_000  # 1 MB


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
    ) -> tuple[list[Change], int]:
        await self._workspace_service.get(workspace_id)

        # Query via primary workspace FK OR M:N association table
        mn_subq = select(ChangeWorkspace.change_id).where(
            col(ChangeWorkspace.workspace_id) == workspace_id,
        )
        stmt = select(Change).where(
            (col(Change.workspace_id) == workspace_id)
            | (col(Change.id).in_(mn_subq))
        )

        if location:
            stmt = stmt.where(col(Change.location) == location)
        if status:
            stmt = stmt.where(col(Change.status) == status)
        if owner:
            try:
                owner_uuid = uuid.UUID(owner)
                stmt = stmt.where(col(Change.owner_id) == owner_uuid)
            except ValueError:
                pass  # invalid UUID, skip filter
        stmt = stmt.order_by(col(Change.change_key).asc())
        items = list((await self._session.execute(stmt)).scalars().all())
        # De-duplicate (primary workspace and M:N may overlap)
        seen: set[uuid.UUID] = set()
        unique_items: list[Change] = []
        for item in items:
            if item.id not in seen:
                seen.add(item.id)
                unique_items.append(item)
        return unique_items, len(unique_items)

    async def get_by_key(
        self, workspace_id: uuid.UUID, change_key: str
    ) -> Change:
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
                .join(ChangeWorkspace, ChangeWorkspace.change_id == Change.id)
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
        stmt = select(ChangeDocument).where(
            col(ChangeDocument.change_id) == change.id
        )
        docs = list((await self._session.execute(stmt)).scalars().all())
        prototypes = [
            Path(d.path).name for d in docs if d.doc_type == "prototype" and d.exists
        ]
        references = [
            Path(d.path).name for d in docs if d.doc_type == "reference" and d.exists
        ]
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
        change.updated_at = datetime.now(timezone.utc)
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
        change.approved_at = datetime.now(timezone.utc)
        change.updated_at = datetime.now(timezone.utc)
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
        change.updated_at = datetime.now(timezone.utc)
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
            now = datetime.now(timezone.utc)

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
        target_key = StageEnum(target_stage)
        if target_key not in transitions_from_current:
            raise InvalidTransition(
                f"不允许从 {current_key.value} 流转到 {target_stage}"
            )

        # Check role permission (admin bypasses all)
        allowed_roles = transitions_from_current[target_key]
        if user_role != "admin" and user_role not in allowed_roles:
            raise PermissionDenied(
                f"角色 '{user_role}' 无权执行 {current_key.value} → {target_stage} 流转"
            )

        # Log transition to stages JSON
        stages = change.stages or {}
        transitions_log = stages.get("transitions", [])
        transitions_log.append({
            "from": current,
            "to": target_stage,
            "by_role": user_role,
            "reason": reason,
            "at": datetime.now(timezone.utc).isoformat(),
        })
        stages["transitions"] = transitions_log

        # Update change
        change.current_stage = target_stage
        change.stages = stages
        change.updated_at = datetime.now(timezone.utc)
        self._session.add(change)
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
                from app.modules.change.dispatch import dispatch

                dispatch_result = await dispatch(
                    session=self._session,
                    workspace_id=workspace_id,
                    change_id=change_id,
                    target_stage=target_stage,
                    user_id=user_id,
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
        """提交反馈并自动流转至 rework_required。"""
        # Validate category
        if category not in ("A", "B", "C", "D"):
            raise InvalidTransition(f"无效的反馈类别: {category}")

        FEEDBACK_TARGETS = {
            "A": "in_dev",
            "B": "design_review",
            "C": "clarifying",
            "D": "accepted",
        }
        rework_target = target_stage or FEEDBACK_TARGETS[category]

        change = await self.get(workspace_id, change_id)

        # Validate current stage allows feedback
        current = change.current_stage or "draft"
        if current not in ("technical_verification", "business_review"):
            raise InvalidTransition(
                "当前阶段不允许提交反馈，仅限 technical_verification 和 business_review"
            )

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
            "submitted_at": datetime.now(timezone.utc).isoformat(),
        }
        change.stages = stages

        if category == "D":
            # D: directly go to accepted (spawn new change separately)
            change.current_stage = "accepted"
            # Log the special transition
            transitions_log = stages.get("transitions", [])
            transitions_log.append({
                "from": current,
                "to": "accepted",
                "by_role": "reviewer",
                "reason": f"反馈类别 D（衍生新 change）: {text[:100]}",
                "at": datetime.now(timezone.utc).isoformat(),
            })
            stages["transitions"] = transitions_log
            change.stages = stages
        else:
            # A/B/C: transition to rework_required
            change.current_stage = "rework_required"
            transitions_log = stages.get("transitions", [])
            transitions_log.append({
                "from": current,
                "to": "rework_required",
                "by_role": "reviewer",
                "reason": f"反馈类别 {category}: {text[:100]}",
                "at": datetime.now(timezone.utc).isoformat(),
            })
            stages["transitions"] = transitions_log
            stages["rework_target"] = rework_target
            change.stages = stages

        change.updated_at = datetime.now(timezone.utc)
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
        if current != "accepted":
            # Not in accepted stage - all checks fail
            for name in [
                "no_unresolved_feedback",
                "ac_confirmed",
                "tech_verification_passed",
                "business_review_passed",
                "feedback_categorized",
                "documents_complete",
            ]:
                checks.append(ArchiveCheckItem(
                    name=name,
                    passed=False,
                    detail="当前阶段非 accepted，无法归档",
                ))
            return ArchiveGateResponse(can_archive=False, checks=checks)

        # Check 1: no unresolved feedback
        checks.append(ArchiveCheckItem(
            name="no_unresolved_feedback",
            passed=change.feedback_category is None,
            detail="" if change.feedback_category is None
                   else f"存在未解决反馈，类别: {change.feedback_category}",
        ))

        stages = change.stages or {}

        # Check 2: AC confirmed
        ac_confirmed = stages.get("ac_confirmed", False)
        checks.append(ArchiveCheckItem(
            name="ac_confirmed",
            passed=bool(ac_confirmed),
            detail="" if ac_confirmed else "验收标准尚未确认",
        ))

        # Check 3: tech verification passed
        tech_passed = stages.get("tech_verification_passed", False)
        checks.append(ArchiveCheckItem(
            name="tech_verification_passed",
            passed=bool(tech_passed),
            detail="" if tech_passed else "技术验证未通过",
        ))

        # Check 4: business review passed
        biz_passed = stages.get("business_review_passed", False)
        checks.append(ArchiveCheckItem(
            name="business_review_passed",
            passed=bool(biz_passed),
            detail="" if biz_passed else "业务评审未通过",
        ))

        # Check 5: feedback categorized
        feedback_records = stages.get("feedback_history", [])
        uncategorized = [f for f in feedback_records if not f.get("category")]
        checks.append(ArchiveCheckItem(
            name="feedback_categorized",
            passed=len(uncategorized) == 0,
            detail="" if not uncategorized
                   else f"{len(uncategorized)} 条反馈未分类",
        ))

        # Check 6: documents complete
        docs, _, _ = await self.get_documents(workspace_id, change_id)
        incomplete = [d for d in docs if not d.status and d.exists]
        checks.append(ArchiveCheckItem(
            name="documents_complete",
            passed=len(incomplete) == 0,
            detail="" if not incomplete
                   else f"{len(incomplete)} 个文档未完成",
        ))

        can_archive = all(check.passed for check in checks)
        return ArchiveGateResponse(can_archive=can_archive, checks=checks)

    # ── Reparse ───────────────────────────────────────────────────────────

    async def reparse(
        self, workspace_id: uuid.UUID
    ) -> tuple[dict[str, int], ChangeParserResult]:
        workspace = await self._workspace_service.get(workspace_id)
        sillyspec_root = Path(workspace.root_path)

        result = self._parser.parse_workspace(sillyspec_root)
        stats = {"parsed": 0, "created": 0, "updated": 0, "deleted": 0}

        # Fetch existing changes
        existing_changes = await self._fetch_existing_changes(workspace_id)
        existing_by_key = {c.change_key: c for c in existing_changes}

        seen_keys: set[str] = set()

        for parsed in result.changes:
            seen_keys.add(parsed.change_key)
            stats["parsed"] += 1

            if parsed.change_key in existing_by_key:
                row = existing_by_key[parsed.change_key]
                self._apply_parsed(row, parsed, workspace_id=workspace_id)
                stats["updated"] += 1
            else:
                row = self._build_change(parsed, workspace_id=workspace_id)
                self._session.add(row)
                stats["created"] += 1

            # Sync documents for this change
            await self._sync_docs(
                change=parsed,
                workspace_id=workspace_id,
                existing_change=(
                    existing_by_key.get(parsed.change_key)
                    if parsed.change_key in existing_by_key
                    else row
                ),
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

        # Delete changes whose keys disappeared
        for key, row in existing_by_key.items():
            if key not in seen_keys:
                await self._session.delete(row)
                stats["deleted"] += 1

        await self._session.commit()
        log.info("changes.reparsed", workspace_id=str(workspace_id), **stats)
        return stats, result

    # ── Helpers ───────────────────────────────────────────────────────────

    async def _fetch_existing_changes(
        self, workspace_id: uuid.UUID
    ) -> list[Change]:
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

    async def _fetch_existing_docs(
        self, change_id: uuid.UUID
    ) -> list[ChangeDocument]:
        stmt = select(ChangeDocument).where(
            col(ChangeDocument.change_id) == change_id
        )
        return list((await self._session.execute(stmt)).scalars().all())

    # ── M:N Enrichment ──────────────────────────────────────────────────

    async def enrich_with_workspace_ids(self, change: Change) -> ChangeRead:
        """Build ChangeRead with workspace_ids populated from M:N table.

        workspace_ids list starts with the primary workspace_id, followed by
        secondary workspace IDs from the M:N table. No duplicates.
        """
        stmt = select(ChangeWorkspace.workspace_id).where(
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
            stmt = select(ChangeWorkspace.workspace_id).where(
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
            stmt = select(Workspace.id).where(
                col(Workspace.component_key).in_(parsed.affected_components),
                col(Workspace.deleted_at).is_(None),
            )
            extra = [row[0] for row in (await self._session.execute(stmt)).all()]
            ws_ids.update(extra)

        # Get existing associations
        existing_stmt = select(ChangeWorkspace).where(
            col(ChangeWorkspace.change_id) == change_id,
        )
        existing = list(
            (await self._session.execute(existing_stmt)).scalars().all()
        )
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
        # DB is the source of truth for status — never overwrite from file.
        # The file frontmatter status is only used when creating a new row
        # (see _build_change). Workflow transitions update DB directly;
        # reparse must not reset them back to the file value.
        row.location = parsed.location
        row.path = parsed.path
        row.affected_components = parsed.affected_components
        row.change_type = parsed.change_type
