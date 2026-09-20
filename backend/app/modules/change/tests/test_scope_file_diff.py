"""单文件变化比对端点测试（ql-20260910-017-2006）。

覆盖（fixture 范式复刻 git_log/tests/test_router.py：FakeHub 按
``ws_hub.get_daemon_ws_hub`` 访问器 monkeypatch + 直插绑定行）：

  1. 成功路径：200 + RPC 参数契约（workspace_id/change/file 透传、file 反斜杠
     归一 POSIX）+ 响应 DTO 逐字段
  2. 参数校验：change 白名单（``..`` / 非法字符）与 file 形态（``..`` 段 /
     绝对路径 / pathspec magic）→ 422
  3. 错误族映射：sillyspec_capability_missing → 422 升级引导；
     method_not_found（旧 daemon）→ 422；offline → 502；timeout → 504；
     其余远端 code → 502；未绑定 → 404
  4. 契约缺口：daemon 回缺 ok 键的畸形结构 → 502 contract gap
  5. 对账表契约 v2（2026-09-20-scope-audit-cross-repo-platform task-02）：
     跨仓行 cross_repo + 信封 repos[] 逐字段透传（锚点档/三态计数/
     degraded 档）；无 repos 键 / 非 list / 非法条目 → [] / 跳过（防御
     回退零回归）
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient

from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)


class FakeHub:
    """DaemonWsHub 测试替身——按 method 分发预设 result / 异常并记录调用。"""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self._handlers: dict[str, tuple[Any, BaseException | None]] = {}

    def on(self, method: str, *, result: Any = None, exc: BaseException | None = None) -> None:
        self._handlers[method] = (result, exc)

    async def send_rpc(
        self,
        daemon_id: uuid.UUID,
        method: str,
        params: dict[str, Any],
        *,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            {"daemon_id": daemon_id, "method": method, "params": params, "timeout": timeout}
        )
        handler = self._handlers.get(method)
        if handler is None:
            return {}
        result, exc = handler
        if exc is not None:
            raise exc
        return result


@dataclass
class ScopeFileDiffEnv:
    user_id: uuid.UUID
    token: str
    workspace_id: uuid.UUID
    daemon_id: uuid.UUID
    hub: FakeHub


@pytest.fixture()
async def role_seeder(db_session):
    from app.modules.auth.model import Role, RolePermission
    from app.modules.auth.permissions import Permission

    roles_spec = {
        "workspace_owner": (
            "Workspace Owner",
            [Permission.WORKSPACE_READ, Permission.WORKSPACE_WRITE],
        ),
    }
    ids: dict[str, uuid.UUID] = {}
    for key, (name, perms) in roles_spec.items():
        role = Role(id=uuid.uuid4(), key=key, name=name, description=name, is_system=True)
        db_session.add(role)
        await db_session.flush()
        ids[key] = role.id
        for p in perms:
            db_session.add(RolePermission(role_id=role.id, permission=p.value))
    await db_session.commit()
    return ids


@pytest.fixture()
async def user_factory(db_session):
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User

    async def _make() -> tuple[Any, str]:
        u = User(
            id=uuid.uuid4(),
            email=f"u-{uuid.uuid4().hex[:8]}@example.com",
            password_hash=password_hasher.hash("Pass123!"),
            display_name="U",
            status="active",
            is_platform_admin=False,
        )
        db_session.add(u)
        await db_session.commit()
        await db_session.refresh(u)
        token, _ = create_access_token(
            user_id=u.id,
            email=u.email,
            is_admin=u.is_platform_admin,
            settings=get_settings(),
        )
        return u, token

    return _make


@pytest.fixture()
async def ws_factory(db_session):
    from app.modules.workspace.model import Workspace

    async def _make(owner_id: uuid.UUID):
        ws = Workspace(
            id=uuid.uuid4(),
            name=f"W-{uuid.uuid4().hex[:6]}",
            slug=f"ws-{uuid.uuid4().hex[:8]}",
            # root_path 有唯一约束——每工作区唯一假路径（同测试多 env 场景不撞）
            root_path=f"/tmp/filediff-{uuid.uuid4().hex[:8]}",
            status="active",
            created_by=owner_id,
        )
        db_session.add(ws)
        await db_session.commit()
        await db_session.refresh(ws)
        return ws

    return _make


@pytest.fixture()
async def member_factory(db_session, role_seeder):
    from app.modules.auth.model import UserWorkspaceRole

    async def _bind(ws_id: uuid.UUID, user_id: uuid.UUID) -> None:
        db_session.add(
            UserWorkspaceRole(
                user_id=user_id,
                workspace_id=ws_id,
                role_id=role_seeder["workspace_owner"],
                granted_at=datetime.now(UTC),
            )
        )
        await db_session.commit()

    return _bind


@pytest.fixture()
async def binding_factory(db_session):
    from sqlalchemy import text

    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    async def _bind(ws_id: uuid.UUID, user_id: uuid.UUID, *, daemon_id: uuid.UUID | None) -> None:
        if daemon_id is not None:
            hb = datetime.now(UTC)
            await db_session.execute(
                text(
                    "INSERT INTO daemon_instances (id, user_id, hostname, server_url,"
                    " allowed_roots, status, last_heartbeat_at, created_at, updated_at)"
                    " VALUES (:id, :uid, 'filediff-test-host', 'http://t',"
                    " '[\"~/.sillyhub\"]', 'online', :hb, :hb, :hb)"
                ),
                {"id": daemon_id.hex, "uid": user_id.hex, "hb": hb},
            )
        db_session.add(
            WorkspaceMemberRuntime(
                workspace_id=ws_id,
                user_id=user_id,
                daemon_id=daemon_id,
                root_path=r"C:\repo",
                path_source="daemon-client",
            )
        )
        await db_session.commit()

    return _bind


@pytest.fixture()
async def setup_env(
    role_seeder, user_factory, ws_factory, member_factory, binding_factory, monkeypatch
):
    """一键搭场景：用户（workspace_owner 成员）+ 工作区 + 绑定行 + 假 hub。"""

    async def _make(*, with_binding: bool = True) -> ScopeFileDiffEnv:
        user, token = await user_factory()
        ws = await ws_factory(owner_id=user.id)
        await member_factory(ws.id, user.id)
        daemon_id = uuid.uuid4()
        if with_binding:
            await binding_factory(ws.id, user.id, daemon_id=daemon_id)
        hub = FakeHub()
        monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)
        return ScopeFileDiffEnv(
            user_id=user.id,
            token=token,
            workspace_id=ws.id,
            daemon_id=daemon_id,
            hub=hub,
        )

    return _make


def _base(env: ScopeFileDiffEnv) -> str:
    return f"/api/workspaces/{env.workspace_id}/sillyspec/file-diff"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


_RESULT_OK = {
    "change": "2026-09-10-mcp-central-registry",
    "file": "src/a.ts",
    "ok": True,
    "mode": "full-flow",
    "base_ref": "3f22d6b",
    "anchor_label": "3f22d6b",
    "diff": "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n",
    "note": None,
    "truncated": False,
}


@pytest.mark.asyncio
async def test_file_diff_200_rpc_contract_and_dto(client: AsyncClient, setup_env):
    """成功路径：RPC 参数（workspace_id/change/file、file 反斜杠归一）+ DTO 逐字段。"""
    env = await setup_env()
    env.hub.on("sillyspec_file_diff", result=_RESULT_OK)

    resp = await client.get(
        f"{_base(env)}",
        params={"change": "2026-09-10-mcp-central-registry", "file": "src\\a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["change"] == "2026-09-10-mcp-central-registry"
    assert body["file"] == "src/a.ts"
    assert body["ok"] is True
    assert body["mode"] == "full-flow"
    assert body["base_ref"] == "3f22d6b"
    assert body["anchor_label"] == "3f22d6b"
    assert body["diff"].startswith("diff --git a/src/a.ts")
    assert body["note"] is None
    assert body["truncated"] is False

    # RPC 参数契约：workspace_id 字符串化 + change + 归一后 file；显式 35s 超时
    call = env.hub.calls[0]
    assert call["method"] == "sillyspec_file_diff"
    assert call["params"] == {
        "workspace_id": str(env.workspace_id),
        "change": "2026-09-10-mcp-central-registry",
        "file": "src/a.ts",
    }
    assert call["timeout"] == 135.0  # ≥ daemon 命令超时 120s + 余量
    assert call["daemon_id"] == env.daemon_id


@pytest.mark.asyncio
async def test_file_diff_param_validation_422(client: AsyncClient, setup_env):
    """参数校验：change 白名单（.. / 非法字符）与 file 形态（.. 段 / 绝对路径 /
    pathspec magic）→ 422，且不打 RPC。"""
    env = await setup_env()
    cases = [
        {"change": "2026-09-10-x", "file": "../outside.ts"},
        {"change": "../../etc", "file": "src/a.ts"},
        {"change": "2026-09-10-x", "file": "/abs/path.ts"},
        {"change": "2026-09-10-x", "file": ":(icase)src"},
    ]
    for params in cases:
        resp = await client.get(f"{_base(env)}", params=params, headers=_bearer(env.token))
        assert resp.status_code == 422, (params, resp.text)
    assert env.hub.calls == [], "422 静态预检不发 RPC"


@pytest.mark.asyncio
async def test_file_diff_sillyspec_capability_422(client: AsyncClient, setup_env):
    """旧 sillyspec（capability_missing）→ 422 升级引导（前端据此出提示）。"""
    env = await setup_env()
    env.hub.on(
        "sillyspec_file_diff",
        exc=DaemonRpcRemoteError(
            {"code": "sillyspec_capability_missing", "message": "old sillyspec"}
        ),
    )
    resp = await client.get(
        f"{_base(env)}",
        params={"change": "c1", "file": "src/a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 422, resp.text
    assert "sillyspec" in resp.json()["message"]


@pytest.mark.asyncio
async def test_file_diff_old_daemon_method_not_found_422(client: AsyncClient, setup_env):
    """旧 daemon 未注册 RPC（method_not_found）→ 422 daemon 升级引导。"""
    env = await setup_env()
    env.hub.on(
        "sillyspec_file_diff",
        exc=DaemonRpcRemoteError({"code": "method_not_found", "message": "no handler"}),
    )
    resp = await client.get(
        f"{_base(env)}",
        params={"change": "c1", "file": "src/a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_file_diff_offline_502_and_timeout_504(client: AsyncClient, setup_env):
    """offline → 502（含 mid-rpc 变体）；RPC 超时 → 504。"""
    env = await setup_env()
    env.hub.on(
        "sillyspec_file_diff",
        exc=DaemonRuntimeOffline("daemon 'x' is offline (no WS connection)."),
    )
    resp = await client.get(
        f"{_base(env)}",
        params={"change": "c1", "file": "src/a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 502, resp.text

    env2 = await setup_env()
    env2.hub.on("sillyspec_file_diff", exc=DaemonRpcTimeout("rpc timed out"))
    resp2 = await client2_get(client, env2)
    assert resp2.status_code == 504, resp2.text


async def client2_get(client: AsyncClient, env: ScopeFileDiffEnv):
    return await client.get(
        f"{_base(env)}",
        params={"change": "c1", "file": "src/a.ts"},
        headers=_bearer(env.token),
    )


@pytest.mark.asyncio
async def test_file_diff_remote_other_502_and_contract_gap(client: AsyncClient, setup_env):
    """其余远端 code（变更不存在等）→ 502；daemon 回畸形结构（缺 ok）→ 502。"""
    env = await setup_env()
    env.hub.on(
        "sillyspec_file_diff",
        exc=DaemonRpcRemoteError({"code": "scope_audit_failed", "message": "exit 1"}),
    )
    resp = await client.get(
        f"{_base(env)}",
        params={"change": "2099-01-01-none", "file": "src/a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 502, resp.text

    env2 = await setup_env()
    env2.hub.on("sillyspec_file_diff", result={"change": "c1", "diff": "x"})
    resp2 = await client2_get(client, env2)
    assert resp2.status_code == 502, resp2.text


@pytest.mark.asyncio
async def test_file_diff_not_bound_404(client: AsyncClient, setup_env):
    """无绑定行（resolver miss）→ 404 引导。"""
    env = await setup_env(with_binding=False)
    resp = await client.get(
        f"{_base(env)}",
        params={"change": "c1", "file": "src/a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 404, resp.text


# ── 对账表端点（ql-20260911-001-c0be）─────────────────────────────────────────

# 值形态异构（str/bool/嵌套 list[dict]），窄化到 dict[str, object] 会让
# `["rows"][0]`（8d628ba53 用例）报 object 不可索引——Any 注解放开取值索引。
_AUDIT_OK: dict[str, Any] = {
    "change": "2026-09-11-skills-central-library",
    "ok": True,
    "mode": "full-flow",
    "base_ref": "3f22d6b9b6d1f85415be416c5086e29cfd9998a4",
    "anchor_label": "3f22d6b",
    "degraded_reason": None,
    "totals": {"files": 17, "additions": 2196, "deletions": 254},
    "rows": [
        {
            "path": "src/index.js",
            "additions": 426,
            "deletions": 17,
            "kind": "modified",
            "planned": "修改",
            "verdict": "planned",
            "declared": None,
            "attribution": None,
        },
        {
            "path": "logo.png",
            "additions": None,
            "deletions": None,
            "kind": "binary",
            "planned": None,
            "verdict": "unplanned",
            "declared": None,
            "attribution": None,
        },
    ],
    "excluded_foreign_declared": ["frontend/src/x.ts"],
    "note": None,
    "truncated": False,
}


@pytest.mark.asyncio
async def test_scope_audit_200_rpc_contract_and_dto(client: AsyncClient, setup_env):
    """对账表成功路径：RPC 方法/参数契约 + DTO 逐字段（三态行/totals/excluded）。"""
    env = await setup_env()
    env.hub.on("sillyspec_scope_audit", result=_AUDIT_OK)

    resp = await client.get(
        f"/api/workspaces/{env.workspace_id}/sillyspec/scope-audit",
        params={"change": "2026-09-11-skills-central-library"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert body["mode"] == "full-flow"
    assert body["anchor_label"] == "3f22d6b"
    assert body["totals"] == {"files": 17, "additions": 2196, "deletions": 254}
    assert body["rows"][0]["verdict"] == "planned"
    assert body["rows"][0]["planned"] == "修改"
    assert body["rows"][1]["additions"] is None  # 二进制行数 null 原样
    assert body["excluded_foreign_declared"] == ["frontend/src/x.ts"]
    assert body["truncated"] is False
    assert body["repos"] == []  # v1 形态（无 repos 键）→ 空列表回退零回归

    call = env.hub.calls[0]
    assert call["method"] == "sillyspec_scope_audit"
    assert call["params"] == {
        "workspace_id": str(env.workspace_id),
        "change": "2026-09-11-skills-central-library",
    }


@pytest.mark.asyncio
async def test_scope_audit_capability_422_and_not_bound_404(client: AsyncClient, setup_env):
    """对账表能力门（旧 sillyspec）→ 422；未绑定 → 404（错误族与 file-diff 同源）。"""
    env = await setup_env()
    env.hub.on(
        "sillyspec_scope_audit",
        exc=DaemonRpcRemoteError({"code": "sillyspec_capability_missing", "message": "old"}),
    )
    resp = await client.get(
        f"/api/workspaces/{env.workspace_id}/sillyspec/scope-audit",
        params={"change": "c1"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 422, resp.text

    env2 = await setup_env(with_binding=False)
    resp2 = await client.get(
        f"/api/workspaces/{env2.workspace_id}/sillyspec/scope-audit",
        params={"change": "c1"},
        headers=_bearer(env2.token),
    )
    assert resp2.status_code == 404, resp2.text


# ── 对账表契约 v2（2026-09-20-scope-audit-cross-repo-platform task-02）─────────
# 形态对齐上游 design「接口定义」JSON 示例（daemon RPC 投影 snake_case 化）：
# 跨仓行真实三态 + 信封 repos[]（main 首位 / A 档锚点 base+head / degraded 档）。

_AUDIT_V2 = {
    "change": "2026-09-15-ehs-reward-punishment",
    "ok": True,
    "mode": "full-flow",
    "base_ref": "214151b2c0d1e2f3a4b5c6d7e8f9",
    "anchor_label": "214151b",
    "degraded_reason": None,
    "totals": {"files": 46, "additions": 6040, "deletions": 340},
    "rows": [
        {  # 主仓行：无跨仓归属（cross_repo None）
            "path": "src/main/java/com/ehs/RewardController.java",
            "additions": 210,
            "deletions": 18,
            "kind": "modified",
            "planned": "修改",
            "verdict": "planned",
            "cross_repo": None,
        },
        {  # 跨仓行：真实三态（不再恒 untouched）
            "path": "pkg/reward/service.go",
            "additions": 430,
            "deletions": 0,
            "kind": "new",
            "planned": "新增",
            "verdict": "planned",
            "cross_repo": "sub-grid-security",
        },
        {
            "path": "pkg/reward/legacy.go",
            "additions": 55,
            "deletions": 12,
            "kind": "modified",
            "planned": None,
            "verdict": "unplanned",
            "cross_repo": "sub-grid-security",
        },
        {  # degraded 仓行：⊘ 形态（恒 untouched + crossRepo）
            "path": "app/demo/page.tsx",
            "additions": 0,
            "deletions": 0,
            "kind": "modified",
            "planned": "修改",
            "verdict": "untouched",
            "cross_repo": "spdemo",
        },
    ],
    "repos": [
        {  # main 条目始终首位（主仓汇总，主仓锚包装）
            "key": "main",
            "anchor": {
                "source": "main-post-apply",
                "base": "214151b2c0d1e2f3a4b5c6d7e8f9",
                "head": None,
                "label": "post-apply 主仓锚",
            },
            "anchor_label": "post-apply 主仓锚",
            "totals": {
                "files": 22,
                "additions": 5300,
                "deletions": 310,
                "planned": 20,
                "unplanned": 2,
                "untouched": 0,
            },
            "degraded": False,
            "degraded_reason": None,
        },
        {  # A 档锚点：reviews base..head 封闭区间
            "key": "sub-grid-security",
            "anchor": {
                "source": "reviews-range",
                "base": "a1b2c3d4e5",
                "head": "e4f5a6b7c8",
                "label": "reviews base..head（execute task 锡点，2 task 区间并集）",
            },
            "anchor_label": "reviews base..head（execute task 锡点，2 task 区间并集）",
            "totals": {
                "files": 14,
                "additions": 740,
                "deletions": 30,
                "planned": 13,
                "unplanned": 1,
                "untouched": 0,
            },
            "degraded": False,
            "degraded_reason": None,
        },
        {  # degraded 档：仓未注册（一行降级不炸整体）
            "key": "spdemo",
            "anchor": {
                "source": "degraded",
                "base": None,
                "head": None,
                "label": "degraded",
            },
            "anchor_label": "degraded",
            "totals": {
                "files": 9,
                "additions": 0,
                "deletions": 0,
                "planned": 0,
                "unplanned": 0,
                "untouched": 9,
            },
            "degraded": True,
            "degraded_reason": "repo key「spdemo」未在 local.yaml repos 注册——跨仓对账不可达，请人工到对应仓核对",
        },
    ],
    "excluded_foreign_declared": [],
    "note": "计划侧含 22 个跨仓文件（repo：sub-grid-security、spdemo）——已按 local.yaml repos 注册表分仓对账（各仓锚点档见 repos[].anchor）",
    "truncated": False,
}


@pytest.mark.asyncio
async def test_scope_audit_v2_cross_repo_rows_and_repos(client: AsyncClient, setup_env):
    """契约 v2 透传：跨仓行 cross_repo 真实三态 + 信封 repos[] 逐字段
    （key/anchor 四键/anchor_label/totals 六计数/degraded/degraded_reason），
    主仓行 cross_repo 保持 None。"""
    env = await setup_env()
    env.hub.on("sillyspec_scope_audit", result=_AUDIT_V2)

    resp = await client.get(
        f"/api/workspaces/{env.workspace_id}/sillyspec/scope-audit",
        params={"change": "2026-09-15-ehs-reward-punishment"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # 行级：主仓行无归属，跨仓行真实三态 + repoKey
    assert body["rows"][0]["cross_repo"] is None
    assert body["rows"][1]["cross_repo"] == "sub-grid-security"
    assert body["rows"][1]["verdict"] == "planned"
    assert body["rows"][2]["verdict"] == "unplanned"
    assert body["rows"][3]["cross_repo"] == "spdemo"
    assert body["rows"][3]["verdict"] == "untouched"  # degraded 仓恒 untouched

    # 信封级：三仓逐字段（main 首位）
    repos = body["repos"]
    assert [r["key"] for r in repos] == ["main", "sub-grid-security", "spdemo"]

    main = repos[0]
    assert main["anchor"] == {
        "source": "main-post-apply",
        "base": "214151b2c0d1e2f3a4b5c6d7e8f9",
        "head": None,
        "label": "post-apply 主仓锚",
    }
    assert main["anchor_label"] == "post-apply 主仓锚"
    assert main["totals"] == {
        "files": 22,
        "additions": 5300,
        "deletions": 310,
        "planned": 20,
        "unplanned": 2,
        "untouched": 0,
    }
    assert main["degraded"] is False
    assert main["degraded_reason"] is None

    sub = repos[1]  # A 档锚点：base + head 双 commit
    assert sub["anchor"]["source"] == "reviews-range"
    assert sub["anchor"]["base"] == "a1b2c3d4e5"
    assert sub["anchor"]["head"] == "e4f5a6b7c8"
    assert sub["anchor"]["label"].startswith("reviews base..head")
    assert sub["anchor_label"] == sub["anchor"]["label"]
    assert sub["totals"]["planned"] == 13
    assert sub["degraded"] is False

    demo = repos[2]  # degraded 档
    assert demo["degraded"] is True
    assert demo["anchor"]["source"] == "degraded"
    assert demo["anchor"]["base"] is None
    assert demo["degraded_reason"].startswith("repo key「spdemo」未在 local.yaml repos 注册")
    assert demo["totals"]["untouched"] == 9


@pytest.mark.asyncio
async def test_scope_audit_v2_repos_fallback_and_invalid_skipped(client: AsyncClient, setup_env):
    """防御回退（D-002）：无 repos 键 / repos 非 list → []；非法条目（非
    dict / 缺 key / key 非 str）跳过不炸、嵌套 anchor/totals 非法全 None
    容错、合法条目保留；行级 cross_repo 非 str → None。"""
    # 无 repos 键（单仓变更 / 旧 daemon 投影）→ 空列表
    env = await setup_env()
    env.hub.on("sillyspec_scope_audit", result=_AUDIT_OK)
    resp = await client.get(
        f"/api/workspaces/{env.workspace_id}/sillyspec/scope-audit",
        params={"change": "2026-09-11-skills-central-library"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["repos"] == []

    # repos 非 list（畸形形态）→ 空列表回退不炸
    env2 = await setup_env()
    env2.hub.on("sillyspec_scope_audit", result={**_AUDIT_OK, "repos": {"key": "main"}})
    resp2 = await client.get(
        f"/api/workspaces/{env2.workspace_id}/sillyspec/scope-audit",
        params={"change": "2026-09-11-skills-central-library"},
        headers=_bearer(env2.token),
    )
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["repos"] == []

    # 非法条目跳过 + 合法条目嵌套字段容错 + 行级 cross_repo 非 str 守卫
    env3 = await setup_env()
    mixed = {
        **_AUDIT_OK,
        "rows": [{**_AUDIT_OK["rows"][0], "cross_repo": 123}],  # 非 str → None
        "repos": [
            "not-a-dict",  # 非 dict → 跳过
            {"totals": {"files": 1}},  # 缺 key → 跳过
            {"key": 42},  # key 非 str → 跳过
            {  # 合法条目但嵌套形态全非法 → 缺省安全不炸
                "key": "main",
                "anchor": "not-a-dict",
                "anchor_label": 99,
                "totals": ["bad"],
                "degraded": "yes",
                "degraded_reason": 42,
            },
        ],
    }
    env3.hub.on("sillyspec_scope_audit", result=mixed)
    resp3 = await client.get(
        f"/api/workspaces/{env3.workspace_id}/sillyspec/scope-audit",
        params={"change": "2026-09-11-skills-central-library"},
        headers=_bearer(env3.token),
    )
    assert resp3.status_code == 200, resp3.text
    body3 = resp3.json()
    assert body3["rows"][0]["cross_repo"] is None
    assert len(body3["repos"]) == 1
    kept = body3["repos"][0]
    assert kept["key"] == "main"
    assert kept["anchor"] == {"source": None, "base": None, "head": None, "label": None}
    assert kept["anchor_label"] is None
    assert kept["totals"] == {
        "files": None,
        "additions": None,
        "deletions": None,
        "planned": None,
        "unplanned": None,
        "untouched": None,
    }
    assert kept["degraded"] is False
    assert kept["degraded_reason"] is None
