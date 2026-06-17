"""Schema-level tests for AgentRunCreate.provider (task-05,
2026-06-14-agent-runtime-selection).

Covers FR-02: an explicit ``provider`` may be supplied when creating an
agent run; it defaults to ``None`` so the dispatch layer falls through to
``workspace.default_agent``. Router-level propagation of the field is covered
by ``test_router.test_create_agent_run_passes_provider``.
"""

from __future__ import annotations

import uuid

import pytest

from app.modules.agent.schema import AgentRunCreate


def test_agent_run_create_provider_defaults_none():
    dto = AgentRunCreate(task_id=uuid.uuid4(), lease_id=uuid.uuid4())
    assert dto.provider is None
    assert dto.model is None


def test_agent_run_create_accepts_provider():
    dto = AgentRunCreate(
        task_id=uuid.uuid4(),
        lease_id=uuid.uuid4(),
        provider="codex",
    )
    assert dto.provider == "codex"


def test_agent_run_create_accepts_model():
    dto = AgentRunCreate(
        task_id=uuid.uuid4(),
        lease_id=uuid.uuid4(),
        model="gpt-5-codex",
    )
    assert dto.model == "gpt-5-codex"


def test_agent_run_create_rejects_oversized_provider():
    with pytest.raises(ValueError):
        AgentRunCreate(
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            provider="x" * 65,
        )


def test_agent_run_create_rejects_oversized_model():
    with pytest.raises(ValueError):
        AgentRunCreate(
            task_id=uuid.uuid4(),
            lease_id=uuid.uuid4(),
            model="x" * 129,
        )
