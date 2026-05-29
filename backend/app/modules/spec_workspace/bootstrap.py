"""SpecBootstrapService — triggers Agent to initialize spec workspace.

The bootstrap creates an Agent run that uses the SillySpec CLI to
initialize the spec workspace. The Agent is the executor; the CLI is
the tool. After the Agent run completes, SpecValidator validates the
result.

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

import datetime
import json
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import SpecWorkspaceNotFound
from app.core.logging import get_logger
from app.modules.agent.adapters.claude_code import ClaudeCodeAdapter
from app.modules.agent.base import AgentSpecBundle
from app.modules.agent.model import AgentRun
from app.modules.spec_profile.model import SpecConflict
from app.modules.workflow.model import AuditLog
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.spec_workspace.validator import SpecValidator
from app.modules.agent.model import AgentRunLog
from app.modules.workspace.model import Workspace

log = get_logger(__name__)

BOOTSTRAP_PROMPT = """\
You are initializing a spec workspace for a code project.

Your task: use the `sillyspec` CLI tool to generate the .sillyspec directory
structure in the spec root directory.

Steps:
1. Run `sillyspec init --dir {spec_root}` to create the skeleton.
2. Run `sillyspec run scan --dir {spec_root}` to scan the code project at
   {code_root} and generate spec documents.
3. Run the following verification script to validate the generated files:

   python3 -c "
import sys, yaml, os
from pathlib import Path

root = Path('{spec_root}')
errors = []

# 3a. Directory structure
if not (root / '.sillyspec' / 'projects').is_dir():
    errors.append('MISSING: .sillyspec/projects/ directory')

# 3b. YAML parseable + required fields
projects_dir = root / '.sillyspec' / 'projects'
if projects_dir.is_dir():
    yamls = list(projects_dir.glob('*.yaml')) + list(projects_dir.glob('*.yml'))
    if not yamls:
        errors.append('MISSING: no YAML files in .sillyspec/projects/')
    for yf in yamls:
        try:
            data = yaml.safe_load(yf.read_text(encoding='utf-8'))
            if not isinstance(data, dict):
                errors.append(f'INVALID: {{yf.name}} is not a YAML mapping')
                continue
            for field in ('id', 'name'):
                if field not in data:
                    errors.append(f'SCHEMA: {{yf.name}} missing required field: {{field}}')
        except Exception as e:
            errors.append(f'PARSE: {{yf.name}} failed: {{e}}')

if errors:
    for e in errors:
        print(f'FAIL: {{e}}')
    sys.exit(1)
else:
    print('VALIDATION PASSED')
"

   If validation fails, inspect the error messages, fix the issue (e.g.
   re-run the init or scan command), and re-run the verification script
   until it passes.

Important:
- The spec root is {spec_root} (this is where .sillyspec/ should be created).
- The code project is at {code_root} (this is the source code to scan).
- Do NOT write .sillyspec files directly — always use the CLI.
- If `sillyspec run scan` asks for input, provide sensible defaults.
- Every YAML file under .sillyspec/projects/ MUST contain top-level 'id' and 'name' fields.
  If the generated YAML is missing 'id', add it manually before running validation.
"""


class SpecBootstrapService:
    """Coordinates spec workspace bootstrap via Agent + CLI + Validator."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._validator = SpecValidator()

    async def bootstrap(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> dict:
        """Trigger an Agent run to bootstrap the spec workspace.

        Steps:
        1. Load SpecWorkspace and Workspace records
        2. Ensure spec_root directory exists
        3. Create an AgentRun with bootstrap-specific bundle
        4. Execute the Agent (which calls sillyspec CLI)
        5. Validate the result with SpecValidator
        6. Update sync_status and create conflicts if validation fails

        Returns dict with: agent_run_id, spec_root, validation_passed, sync_status
        """
        # 1. Load records
        spec_ws = await self._get_spec_workspace(workspace_id)
        workspace = await self._session.get(Workspace, workspace_id)
        if workspace is None:
            raise SpecWorkspaceNotFound(
                "Workspace not found.",
                details={"workspace_id": str(workspace_id)},
            )

        spec_root = Path(spec_ws.spec_root)
        code_root = Path(workspace.root_path)

        # 2. Ensure spec_root directory exists
        spec_root.mkdir(parents=True, exist_ok=True)

        # Audit: bootstrap started
        self._session.add(AuditLog(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            actor_id=user_id,
            action="spec_bootstrap.start",
            resource_type="spec_workspace",
            resource_id=workspace_id,
            details_json=json.dumps({"spec_root": str(spec_root), "strategy": spec_ws.strategy}),
        ))
        await self._session.commit()

        # 3. Build bootstrap bundle
        prompt = BOOTSTRAP_PROMPT.format(
            spec_root=str(spec_root),
            code_root=str(code_root),
        )
        bundle = AgentSpecBundle(
            change_summary="Bootstrap spec workspace",
            task_key="bootstrap",
            task_title="Initialize spec workspace using SillySpec CLI",
            proposal=prompt,
            allowed_paths=[str(spec_root), str(code_root)],
            available_tools=["sillyspec"],
            spec_strategy=spec_ws.strategy,
            profile_version=spec_ws.profile_version,
            platform_metadata={
                "workspace_id": str(workspace_id),
                "bootstrap": True,
            },
        )

        # 4. Create AgentRun record
        run = AgentRun(
            id=uuid.uuid4(),
            task_id=None,
            lease_id=None,
            agent_type="claude_code",
            status="pending",
            spec_strategy=spec_ws.strategy,
            profile_version=spec_ws.profile_version,
        )
        self._session.add(run)
        await self._session.commit()
        await self._session.refresh(run)

        # 5. Execute agent
        run.status = "running"
        run.started_at = datetime.datetime.utcnow()
        self._session.add(run)
        await self._session.commit()

        adapter = ClaudeCodeAdapter()
        result = await adapter.run_with_bundle(run.id, bundle, spec_root, timeout=1800)

        # 6. Update run record
        # Note: claude --print may return non-zero even on successful output;
        # we defer success/failure judgment to the validation step below.
        run.finished_at = datetime.datetime.utcnow()
        run.exit_code = result.exit_code
        run.output_redacted = result.redacted_output[:10000]
        self._session.add(run)

        # 6b. Write conversation log as run logs
        # result.redacted_output contains the parsed, human-readable conversation
        # from _format_conversation_log (tool calls, thinking, results, etc.)
        now = datetime.datetime.utcnow()
        if result.redacted_output:
            # Split into chunks of ~4000 chars to stay within column limits
            log_text = result.redacted_output
            chunk_size = 4000
            for i in range(0, len(log_text), chunk_size):
                log_entry = AgentRunLog(
                    id=uuid.uuid4(),
                    run_id=run.id,
                    channel="stdout",
                    content_redacted=log_text[i:i + chunk_size],
                )
                self._session.add(log_entry)
        if result.stderr and result.stderr.strip():
            log_entry = AgentRunLog(
                id=uuid.uuid4(),
                run_id=run.id,
                channel="stderr",
                content_redacted=result.stderr[:4000],
            )
            self._session.add(log_entry)

        # 7. Validate
        report = self._validator.validate(spec_root)

        # 8. Set final run status based on validation, not CLI exit code
        run.status = "completed" if report.passed else "failed"
        self._session.add(run)

        # 9. Update sync_status
        now = datetime.datetime.utcnow()
        if report.passed:
            spec_ws.sync_status = "clean"
            spec_ws.last_synced_at = now
        else:
            spec_ws.sync_status = "dirty"
            for issue in report.errors:
                conflict = SpecConflict(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    stage="bootstrap",
                    conflict_type=issue.category,
                    details_json=json.dumps({
                        "path": issue.path,
                        "message": issue.message,
                        "category": issue.category,
                    }),
                    status="open",
                    created_at=now,
                )
                self._session.add(conflict)

        # Audit: bootstrap completed
        self._session.add(AuditLog(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            actor_id=user_id,
            action="spec_bootstrap.complete",
            resource_type="agent_run",
            resource_id=run.id,
            details_json=json.dumps({
                "validation_passed": report.passed,
                "error_count": len(report.errors),
                "sync_status": spec_ws.sync_status,
                "agent_exit_code": result.exit_code,
            }),
        ))

        spec_ws.updated_at = now
        await self._session.commit()
        await self._session.refresh(spec_ws)

        log.info(
            "spec_bootstrap.complete",
            workspace_id=str(workspace_id),
            agent_run_id=str(run.id),
            agent_exit_code=result.exit_code,
            passed=report.passed,
            error_count=len(report.errors),
        )

        return {
            "agent_run_id": str(run.id),
            "agent_exit_code": result.exit_code,
            "spec_root": str(spec_root),
            "validation_passed": report.passed,
            "errors": [
                {"path": i.path, "message": i.message, "category": i.category}
                for i in report.errors
            ],
            "warnings": [
                {"path": i.path, "message": i.message, "category": i.category}
                for i in report.warnings
            ],
            "sync_status": spec_ws.sync_status,
        }

    async def _get_spec_workspace(self, workspace_id: uuid.UUID) -> SpecWorkspace:
        stmt = select(SpecWorkspace).where(
            SpecWorkspace.workspace_id == workspace_id,
        )
        result = (await self._session.execute(stmt)).scalars().first()
        if result is None:
            raise SpecWorkspaceNotFound(
                "Spec workspace not found for the given workspace.",
                details={"workspace_id": str(workspace_id)},
            )
        return result
