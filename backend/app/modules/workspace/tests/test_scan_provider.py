"""Provider propagation tests for scan-generate (task-07,
2026-06-14-agent-runtime-selection).

Covers FR-02: the optional ``provider`` argument on ``ScanGenerateRequest`` and
``WorkspaceService.scan_generate`` must reach ``AgentService.start_scan_dispatch``
verbatim, so the scan trigger can override the runtime; when omitted it stays
``None`` and the dispatch layer falls through to ``workspace.default_agent``.

``SpecWorkspaceService`` is patched so the test does not exercise spec-workspace
persistence — the focus is the provider hand-off at the dispatch boundary.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.workspace.schema import ScanGenerateRequest
from app.modules.workspace.service import WorkspaceService

_SPEC_SVC = "app.modules.spec_workspace.service.SpecWorkspaceService"


def test_scan_generate_request_provider_defaults_none():
    dto = ScanGenerateRequest(root_path="/tmp/proj")
    assert dto.provider is None
    assert dto.model is None


def test_scan_generate_request_accepts_provider():
    dto = ScanGenerateRequest(root_path="/tmp/proj", provider="codex", model="gpt-5-codex")
    assert dto.provider == "codex"
    assert dto.model == "gpt-5-codex"


@pytest.mark.asyncio
class TestScanGenerateProviderPropagation:
    """scan_generate() forwards ``provider`` to the agent service."""

    @staticmethod
    def _build_agent_service() -> MagicMock:
        agent_service = MagicMock()
        mock_run = MagicMock()
        mock_run.id = uuid.uuid4()
        agent_service.start_scan_dispatch = AsyncMock(return_value=mock_run)
        return agent_service

    @staticmethod
    def _patch_spec_workspace(tmp_path: Path):
        """Patch SpecWorkspaceService so create/get are no-ops with a spec_root."""
        mock_spec_ws = MagicMock()
        mock_spec_ws.spec_root = str(tmp_path / ".sillyspec")
        return patch(
            _SPEC_SVC,
            return_value=MagicMock(
                create=AsyncMock(),
                get=AsyncMock(return_value=mock_spec_ws),
            ),
        )

    async def test_scan_generate_passes_provider(self, db_session: AsyncSession, tmp_path: Path):
        service = WorkspaceService(db_session)
        agent_service = self._build_agent_service()

        with self._patch_spec_workspace(tmp_path):
            _, agent_run_id = await service.scan_generate(
                root_path=str(tmp_path),
                user_id=uuid.uuid4(),
                agent_service=agent_service,
                provider="codex",
                model="gpt-5-codex",
            )

        assert agent_service.start_scan_dispatch.call_args.kwargs["provider"] == "codex"
        assert agent_service.start_scan_dispatch.call_args.kwargs["model"] == "gpt-5-codex"
        assert agent_run_id is not None

    async def test_scan_generate_provider_defaults_none(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        service = WorkspaceService(db_session)
        agent_service = self._build_agent_service()

        with self._patch_spec_workspace(tmp_path):
            await service.scan_generate(
                root_path=str(tmp_path),
                user_id=uuid.uuid4(),
                agent_service=agent_service,
            )

        assert agent_service.start_scan_dispatch.call_args.kwargs["provider"] is None
        assert agent_service.start_scan_dispatch.call_args.kwargs["model"] is None
