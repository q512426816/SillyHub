"""Tests for ToolPolicy engine, handlers, audit dual write, and CRUD routes.

Wave 3 test suite covering:
- ToolPolicyService.check (tool whitelist, command blacklist, domain whitelist, SSRF)
- ToolPolicyService.apply_limits
- default_policy()
- _handle_run_tests / _handle_http_get
- Audit dual write
- Policy CRUD HTTP endpoints
"""

from __future__ import annotations

import json
import socket
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.modules.tool_gateway.tool_policy import (
    ALL_TOOLS,
    ToolOperationForbidden,
    ToolPolicy,
    ToolPolicyService,
    default_policy,
)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_policy(**overrides) -> ToolPolicy:
    """Create a non-persisted ToolPolicy with sensible defaults for testing."""
    defaults = {
        "id": uuid.uuid4(),
        "workspace_id": uuid.uuid4(),
        "name": "test-policy",
        "allowed_tools": list(ALL_TOOLS),
        "blocked_commands": [],
        "allowed_paths": ["."],
        "allowed_domains": [],
        "max_timeout": 30,
        "max_output_size": 64000,
    }
    defaults.update(overrides)
    return ToolPolicy(**defaults)


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Tool whitelist tests
# ═══════════════════════════════════════════════════════════════════════════════


class TestCheckToolAllowed:
    def test_check_tool_allowed(self) -> None:
        """Tool in whitelist passes."""
        policy = _make_policy(allowed_tools=["file_read", "file_write"])
        # Should not raise
        ToolPolicyService.check(policy, "file_read", {})

    def test_check_tool_blocked(self) -> None:
        """Tool NOT in whitelist raises ToolOperationForbidden."""
        policy = _make_policy(allowed_tools=["file_read"])
        with pytest.raises(ToolOperationForbidden, match="not allowed"):
            ToolPolicyService.check(policy, "shell_exec", {})


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Command blacklist tests
# ═══════════════════════════════════════════════════════════════════════════════


class TestCheckCommandBlocked:
    def test_check_command_not_blocked(self) -> None:
        """Legal command passes when not in blocked_commands."""
        policy = _make_policy(blocked_commands=["dangerous_tool"])
        ToolPolicyService.check(policy, "shell_exec", {"command": "ls", "args": ["-la"]})

    def test_check_command_blocked(self) -> None:
        """Command matching blocked_commands raises ToolOperationForbidden."""
        policy = _make_policy(blocked_commands=["curl"])
        with pytest.raises(ToolOperationForbidden, match="blocked"):
            ToolPolicyService.check(policy, "shell_exec", {"command": "curl", "args": []})

    def test_check_command_blocked_with_args(self) -> None:
        """Command + args combined matching blocked pattern raises."""
        policy = _make_policy(blocked_commands=["wget"])
        with pytest.raises(ToolOperationForbidden, match="blocked"):
            ToolPolicyService.check(policy, "shell_exec", {"command": "wget", "args": ["http://evil.com"]})


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Domain whitelist tests
# ═══════════════════════════════════════════════════════════════════════════════


class TestCheckDomain:
    def test_check_domain_allowed(self) -> None:
        """Domain in whitelist passes."""
        policy = _make_policy(allowed_domains=["example.com", "api.github.com"])
        with patch.object(ToolPolicyService, "_check_not_private_ip"):
            ToolPolicyService.check(policy, "http_get", {"url": "https://example.com/api"})

    def test_check_domain_blocked(self) -> None:
        """Domain NOT in whitelist raises ToolOperationForbidden."""
        policy = _make_policy(allowed_domains=["example.com"])
        with patch.object(ToolPolicyService, "_check_not_private_ip"):
            with pytest.raises(ToolOperationForbidden, match="not in allowed_domains"):
                ToolPolicyService.check(policy, "http_get", {"url": "https://evil.com/data"})

    def test_check_domain_empty_whitelist_allows_all(self) -> None:
        """Empty allowed_domains list allows any domain (only SSRF check applies)."""
        policy = _make_policy(allowed_domains=[])
        with patch.object(ToolPolicyService, "_check_not_private_ip"):
            # Should not raise — empty whitelist means no domain filtering
            ToolPolicyService.check(policy, "http_get", {"url": "https://any-site.com"})


# ═══════════════════════════════════════════════════════════════════════════════
# 4. SSRF (private IP) tests
# ═══════════════════════════════════════════════════════════════════════════════


class TestSSRF:
    def test_check_not_private_ip_public(self) -> None:
        """Public IP resolves without error."""
        with patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai:
            mock_gai.return_value = [(2, 1, 6, "", ("93.184.216.34", 0))]
            # Should not raise
            ToolPolicyService._check_not_private_ip("example.com", "https://example.com")

    def test_check_not_private_ip_private_10(self) -> None:
        """10.x.x.x private range is blocked."""
        with patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai:
            mock_gai.return_value = [(2, 1, 6, "", ("10.0.0.1", 0))]
            with pytest.raises(ToolOperationForbidden, match="private IP"):
                ToolPolicyService._check_not_private_ip("internal.corp", "http://internal.corp")

    def test_check_not_private_ip_private_192(self) -> None:
        """192.168.x.x private range is blocked."""
        with patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai:
            mock_gai.return_value = [(2, 1, 6, "", ("192.168.1.1", 0))]
            with pytest.raises(ToolOperationForbidden, match="private IP"):
                ToolPolicyService._check_not_private_ip("router.local", "http://router.local")

    def test_check_not_private_ip_localhost(self) -> None:
        """127.0.0.1 (localhost) is blocked."""
        with patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai:
            mock_gai.return_value = [(2, 1, 6, "", ("127.0.0.1", 0))]
            with pytest.raises(ToolOperationForbidden, match="private IP"):
                ToolPolicyService._check_not_private_ip("localhost", "http://localhost")


# ═══════════════════════════════════════════════════════════════════════════════
# 5. Policy limits tests
# ═══════════════════════════════════════════════════════════════════════════════


class TestApplyLimits:
    def test_apply_limits_default(self) -> None:
        """Default limits are returned from policy."""
        policy = _make_policy(max_timeout=30, max_output_size=64000)
        limits = ToolPolicyService.apply_limits(policy, {})
        assert limits.effective_timeout == 30
        assert limits.max_output_size == 64000

    def test_apply_limits_capped_timeout(self) -> None:
        """Timeout is capped to policy max_timeout."""
        policy = _make_policy(max_timeout=10, max_output_size=64000)
        limits = ToolPolicyService.apply_limits(policy, {"timeout": 300})
        assert limits.effective_timeout == 10
        assert limits.max_output_size == 64000


# ═══════════════════════════════════════════════════════════════════════════════
# 6. Default policy tests
# ═══════════════════════════════════════════════════════════════════════════════


class TestDefaultPolicy:
    def test_default_policy_allows_all_tools(self) -> None:
        """Default policy allows all supported tool types."""
        policy = default_policy()
        for tool in ALL_TOOLS:
            # Should not raise
            ToolPolicyService._check_tool_allowed(policy, tool)

    def test_default_policy_fields(self) -> None:
        """Default policy has expected field values."""
        policy = default_policy()
        assert policy.name == "__default__"
        assert set(policy.allowed_tools) == set(ALL_TOOLS)
        assert policy.blocked_commands == []
        assert policy.allowed_domains == []
        assert policy.max_timeout == 30
        assert policy.max_output_size == 64000


# ═══════════════════════════════════════════════════════════════════════════════
# 7. run_tests handler tests
# ═══════════════════════════════════════════════════════════════════════════════


class TestRunTestsHandler:
    async def test_run_tests_unsupported_runner(self, tmp_path: Path) -> None:
        """Unsupported runner returns error."""
        from app.modules.tool_gateway.service import ToolGatewayService
        svc = ToolGatewayService.__new__(ToolGatewayService)
        result = await svc._handle_run_tests({"runner": "maven"}, tmp_path)
        assert result["result_code"] == 1
        assert "Unsupported runner" in result["output"]

    async def test_run_tests_success(self, tmp_path: Path) -> None:
        """Successful pytest run with mocked subprocess."""
        from app.modules.tool_gateway.service import ToolGatewayService
        svc = ToolGatewayService.__new__(ToolGatewayService)
        with patch("app.modules.tool_gateway.service.asyncio.create_subprocess_exec") as mock_exec:
            proc = AsyncMock()
            proc.communicate = AsyncMock(return_value=(b"2 passed in 0.5s\n", b""))
            proc.returncode = 0
            mock_exec.return_value = proc

            result = await svc._handle_run_tests({"runner": "pytest", "path": "."}, tmp_path)
        assert result["result_code"] == 0


# ═══════════════════════════════════════════════════════════════════════════════
# 8. http_get handler tests
# ═══════════════════════════════════════════════════════════════════════════════


class TestHttpGetHandler:
    async def test_http_get_missing_url(self, tmp_path: Path) -> None:
        """Missing URL returns error."""
        from app.modules.tool_gateway.service import ToolGatewayService
        svc = ToolGatewayService.__new__(ToolGatewayService)
        result = await svc._handle_http_get({}, tmp_path)
        assert result["result_code"] == 1
        assert "Missing URL" in result["output"]

    async def test_http_get_bad_scheme(self, tmp_path: Path) -> None:
        """Non http/https scheme returns error."""
        from app.modules.tool_gateway.service import ToolGatewayService
        svc = ToolGatewayService.__new__(ToolGatewayService)
        result = await svc._handle_http_get({"url": "ftp://files.example.com/data"}, tmp_path)
        assert result["result_code"] == 1
        assert "Unsupported scheme" in result["output"]


# ═══════════════════════════════════════════════════════════════════════════════
# 9. Audit dual write test
# ═══════════════════════════════════════════════════════════════════════════════


async def test_audit_dual_write(client, db_session, tmp_path: Path) -> None:
    """Execute tool operation and verify both ToolOperationLog and AuditLog are written."""
    from sqlalchemy import select

    from app.modules.tool_gateway.model import ToolOperationLog
    from app.modules.workflow.model import AuditLog

    refs = await _setup_active_lease(db_session, tmp_path)
    resp = await client.post(
        f"/api/worktrees/{refs['lease_id']}/tools",
        json={
            "tool_type": "file_read",
            "params": {"path": "src/main.py"},
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200

    # Verify ToolOperationLog
    op_logs = list(
        (await db_session.execute(
            select(ToolOperationLog).where(ToolOperationLog.lease_id == refs["lease_id"]),
        )).scalars().all(),
    )
    assert len(op_logs) == 1
    assert op_logs[0].tool_type == "file_read"

    # Verify AuditLog dual write
    audit_logs = list(
        (await db_session.execute(
            select(AuditLog).where(AuditLog.workspace_id == refs["ws_id"]),
        )).scalars().all(),
    )
    assert len(audit_logs) == 1
    assert audit_logs[0].action == "tool:file_read"
    assert audit_logs[0].resource_type == "tool_operation"
    assert audit_logs[0].resource_id == op_logs[0].id
    details = json.loads(audit_logs[0].details_json)
    assert details["tool_type"] == "file_read"
    assert details["policy_name"] == "__default__"


# ═══════════════════════════════════════════════════════════════════════════════
# 10. Policy CRUD route tests
# ═══════════════════════════════════════════════════════════════════════════════


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _setup_workspace_with_admin(db_session) -> dict:
    """Create workspace + admin user and return refs including token."""
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User
    from app.modules.workspace.model import Workspace

    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)

    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="Policy Test WS",
        slug=f"policy-ws-{ws_id.hex[:8]}",
        root_path="/tmp/policy-test",
        status="active",
        component_key="backend",
        repo_url="https://github.com/org/repo.git",
        default_branch="main",
        source_yaml_path="projects/backend.yaml",
    )
    db_session.add(ws)

    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email=f"policy-admin-{user_id.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Admin123!"),
        display_name="Policy Admin",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(user)
    await db_session.commit()

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=True,
        settings=settings,
    )

    return {
        "ws_id": ws_id,
        "user_id": user_id,
        "token": token,
    }


async def test_create_policy(client, db_session) -> None:
    """Create a tool policy via POST endpoint."""
    refs = await _setup_workspace_with_admin(db_session)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/tool-policies",
        json={
            "name": "restrictive",
            "allowed_tools": ["file_read"],
            "blocked_commands": ["curl"],
            "allowed_domains": [],
            "max_timeout": 15,
            "max_output_size": 10000,
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "restrictive"
    assert body["allowed_tools"] == ["file_read"]
    assert body["blocked_commands"] == ["curl"]
    assert body["max_timeout"] == 15


async def test_create_policy_duplicate_name(client, db_session) -> None:
    """Duplicate policy name within workspace returns 409."""
    refs = await _setup_workspace_with_admin(db_session)
    payload = {"name": "dup-policy", "allowed_tools": ["file_read"]}
    headers = _auth(refs["token"])

    resp1 = await client.post(
        f"/api/workspaces/{refs['ws_id']}/tool-policies",
        json=payload,
        headers=headers,
    )
    assert resp1.status_code == 201

    resp2 = await client.post(
        f"/api/workspaces/{refs['ws_id']}/tool-policies",
        json=payload,
        headers=headers,
    )
    assert resp2.status_code == 409


async def test_list_policies(client, db_session) -> None:
    """List policies for a workspace."""
    refs = await _setup_workspace_with_admin(db_session)
    headers = _auth(refs["token"])

    # Create two policies
    for name in ("policy-a", "policy-b"):
        await client.post(
            f"/api/workspaces/{refs['ws_id']}/tool-policies",
            json={"name": name},
            headers=headers,
        )

    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/tool-policies",
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    names = {p["name"] for p in body}
    assert names == {"policy-a", "policy-b"}


async def test_get_policy_not_found(client, db_session) -> None:
    """Get non-existent policy returns 404."""
    refs = await _setup_workspace_with_admin(db_session)
    fake_id = uuid.uuid4()
    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/tool-policies/{fake_id}",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 404


async def test_update_policy(client, db_session) -> None:
    """Update a policy via PATCH endpoint."""
    refs = await _setup_workspace_with_admin(db_session)
    headers = _auth(refs["token"])

    create_resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/tool-policies",
        json={"name": "updatable", "max_timeout": 30},
        headers=headers,
    )
    assert create_resp.status_code == 201
    policy_id = create_resp.json()["id"]

    patch_resp = await client.patch(
        f"/api/workspaces/{refs['ws_id']}/tool-policies/{policy_id}",
        json={"max_timeout": 60, "allowed_tools": ["file_read", "file_list"]},
        headers=headers,
    )
    assert patch_resp.status_code == 200
    body = patch_resp.json()
    assert body["max_timeout"] == 60
    assert body["allowed_tools"] == ["file_read", "file_list"]


async def test_delete_policy(client, db_session) -> None:
    """Delete a policy via DELETE endpoint."""
    refs = await _setup_workspace_with_admin(db_session)
    headers = _auth(refs["token"])

    create_resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/tool-policies",
        json={"name": "deletable"},
        headers=headers,
    )
    assert create_resp.status_code == 201
    policy_id = create_resp.json()["id"]

    delete_resp = await client.delete(
        f"/api/workspaces/{refs['ws_id']}/tool-policies/{policy_id}",
        headers=headers,
    )
    assert delete_resp.status_code == 204

    # Verify it's gone
    get_resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/tool-policies/{policy_id}",
        headers=headers,
    )
    assert get_resp.status_code == 404


# ── Shared setup helper for audit test ────────────────────────────────────────


async def _setup_active_lease(db_session, tmp_path: Path) -> dict:
    """Create workspace, change, task, user, identity, lease + token."""
    from app.core.security import password_hasher
    from app.modules.auth.model import User
    from app.modules.change.model import Change
    from app.modules.git_identity.model import GitIdentity
    from app.modules.task.model import Task
    from app.modules.workspace.model import Workspace
    from app.modules.worktree.model import WorktreeLease

    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="Test WS",
        slug=f"test-ws-{ws_id.hex[:8]}",
        root_path=str(tmp_path),
        status="active",
        component_key="backend",
        repo_url="https://github.com/org/repo.git",
        default_branch="main",
        source_yaml_path="projects/backend.yaml",
    )
    db_session.add(ws)

    change_id = uuid.uuid4()
    change = Change(
        id=change_id,
        workspace_id=ws_id,
        change_key="change-tool-001",
        title="Tool Test Change",
        status="in_progress",
        location="local",
        path="changes/local/change-tool-001",
    )
    db_session.add(change)

    task_id = uuid.uuid4()
    task = Task(
        id=task_id,
        workspace_id=ws_id,
        change_id=change_id,
        task_key="task-tool-01",
        title="Tool Test Task",
        status="in_progress",
        allowed_paths=["src/", "tests/"],
    )
    db_session.add(task)

    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email=f"test-{user_id.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Test",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(user)

    identity_id = uuid.uuid4()
    identity = GitIdentity(
        id=identity_id,
        user_id=user_id,
        provider="github",
        credential_type="pat",
        encrypted_credential=b"\x00" * 32,
        key_id="v1",
        allowed_repositories=[],
    )
    db_session.add(identity)

    lease_id = uuid.uuid4()
    lease_path = tmp_path / f"lease-{lease_id.hex[:8]}"
    lease_path.mkdir()
    repo_dir = lease_path / "repo"
    repo_dir.mkdir()
    (repo_dir / "src").mkdir()
    (repo_dir / "tests").mkdir()
    (repo_dir / "src" / "main.py").write_text("print('hello')", encoding="utf-8")
    lease = WorktreeLease(
        id=lease_id,
        workspace_id=ws_id,
        component_id=ws_id,
        change_id=change_id,
        task_id=task_id,
        user_id=user_id,
        run_id=uuid.uuid4(),
        git_identity_id=identity_id,
        path=str(lease_path),
        branch_name="test-branch",
        status="locked",
        locked_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + timedelta(hours=1),
    )
    db_session.add(lease)
    await db_session.commit()

    from app.core.config import get_settings
    from app.core.security import create_access_token

    settings = get_settings()
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=True,
        settings=settings,
    )

    return {
        "ws_id": ws_id,
        "change_id": change_id,
        "task_id": task_id,
        "user_id": user_id,
        "identity_id": identity_id,
        "lease_id": lease_id,
        "token": token,
        "lease_path": lease_path,
        "repo_dir": repo_dir,
    }
