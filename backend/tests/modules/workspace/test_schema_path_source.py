"""DTO tests for path_source / daemon_runtime_id (task-01).

Covers FR-01 GWT: server-local default, daemon-client requires runtime id,
invalid enum rejected. Shared validator logic exercised on both
WorkspaceCreate and WorkspaceUpdate plus ScanGenerateRequest (per plan.md
execute-consistency convention).
"""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from pydantic import ValidationError

from app.modules.workspace.schema import (
    ScanGenerateRequest,
    WorkspaceCreate,
    WorkspaceRead,
    WorkspaceUpdate,
)


def _create_kwargs(**overrides):
    base = {"name": "demo", "root_path": "/tmp/demo"}
    base.update(overrides)
    return base


# --- WorkspaceCreate ---------------------------------------------------------


def test_create_defaults_to_server_local():
    dto = WorkspaceCreate(**_create_kwargs())
    assert dto.path_source == "server-local"
    assert dto.daemon_runtime_id is None


def test_create_daemon_client_requires_runtime_id():
    with pytest.raises(ValidationError):
        WorkspaceCreate(**_create_kwargs(path_source="daemon-client"))


def test_create_daemon_client_with_runtime_ok():
    rid = uuid.uuid4()
    dto = WorkspaceCreate(**_create_kwargs(path_source="daemon-client", daemon_runtime_id=rid))
    assert dto.path_source == "daemon-client"
    assert dto.daemon_runtime_id == rid


def test_create_invalid_path_source():
    with pytest.raises(ValidationError):
        WorkspaceCreate(**_create_kwargs(path_source="local"))


def test_create_invalid_path_source_case_sensitive():
    with pytest.raises(ValidationError):
        WorkspaceCreate(**_create_kwargs(path_source="Daemon-Client"))


# --- WorkspaceUpdate ---------------------------------------------------------


def test_update_daemon_client_requires_runtime_id():
    with pytest.raises(ValidationError):
        WorkspaceUpdate(path_source="daemon-client")


def test_update_daemon_client_with_runtime_ok():
    rid = uuid.uuid4()
    dto = WorkspaceUpdate(path_source="daemon-client", daemon_runtime_id=rid)
    assert dto.path_source == "daemon-client"
    assert dto.daemon_runtime_id == rid


def test_update_none_path_source_skips_validation():
    # path_source omitted → validator no-op (exclude_unset semantics).
    dto = WorkspaceUpdate(name="x")
    assert dto.path_source is None
    assert dto.daemon_runtime_id is None


def test_update_explicit_none_path_source_skips_validation():
    dto = WorkspaceUpdate(path_source=None)
    assert dto.path_source is None


# --- ScanGenerateRequest (plan.md convention) --------------------------------


def test_scan_generate_defaults_to_server_local():
    req = ScanGenerateRequest(root_path="/tmp/demo")
    assert req.path_source == "server-local"
    assert req.daemon_runtime_id is None


def test_scan_generate_daemon_client_requires_runtime_id():
    with pytest.raises(ValidationError):
        ScanGenerateRequest(root_path="/tmp/demo", path_source="daemon-client")


def test_scan_generate_daemon_client_with_runtime_ok():
    rid = uuid.uuid4()
    req = ScanGenerateRequest(
        root_path="/tmp/demo",
        path_source="daemon-client",
        daemon_runtime_id=rid,
    )
    assert req.path_source == "daemon-client"
    assert req.daemon_runtime_id == rid


# --- WorkspaceRead -----------------------------------------------------------


class _StubWorkspace:
    """Minimal stand-in with the attributes WorkspaceRead maps via from_attributes."""

    def __init__(self, **kw):
        defaults = {
            "id": uuid.uuid4(),
            "name": "demo",
            "slug": "demo",
            "root_path": "/tmp/demo",
            "status": "active",
            "component_key": None,
            "type": None,
            "role": None,
            "repo_url": None,
            "default_branch": None,
            "default_agent": None,
            "default_model": None,
            "tech_stack": [],
            "build_command": None,
            "test_command": None,
            "source_yaml_path": None,
            "created_by": None,
            "created_at": datetime(2026, 6, 18),
            "updated_at": datetime(2026, 6, 18),
            "last_scanned_at": None,
            "deleted_at": None,
            "path_source": "server-local",
            "daemon_runtime_id": None,
        }
        defaults.update(kw)
        for k, v in defaults.items():
            setattr(self, k, v)


def test_read_includes_fields_server_local():
    read = WorkspaceRead.model_validate(_StubWorkspace())
    assert read.path_source == "server-local"
    assert read.daemon_runtime_id is None


def test_read_includes_fields_daemon_client():
    rid = uuid.uuid4()
    read = WorkspaceRead.model_validate(
        _StubWorkspace(path_source="daemon-client", daemon_runtime_id=rid)
    )
    assert read.path_source == "daemon-client"
    assert read.daemon_runtime_id == rid
