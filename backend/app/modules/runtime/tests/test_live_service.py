"""RuntimeLiveService 单元测试（task-04/05，design §6.1/§6.3）。

仿 ``tests/modules/explorer/test_explorer.py`` 的 hermetic 打法：per-test 内存
SQLite + ``FakeHub`` 假件按 ``ws_hub.get_daemon_ws_hub`` 访问器 monkeypatch
（service 懒导入取 hub）。只测 service 层（不经 HTTP），router 层集成在
task-08（test_router.py 改写）覆盖。

覆盖（task-04 验收）：

- 四方法成功路径（progress / user_inputs / artifacts / artifact content）；
- RPC params 携带 ``root_path``（binding 行原值；容器→宿主前缀配置时为改写后
  宿主路径——2026-08-20-runtime-readpoint-repo-first task-02，D-02@v1/D-03@v1）；
- 绑定缺失矩阵（无绑定行 / ``daemon_id IS NULL`` → ``RuntimeNotBound`` 404）；
- RPC 错误映射全表（offline / mid-rpc 断连 / timeout / forbidden / not_found /
  method_not_found / artifact_too_large / 其余业务错误）；
- ``_validate_artifact_filename`` 预检矩阵（空名 / 控制字符 / 绝对路径 / ``..``
  / 子路径 → 422 且先于 RPC——hub 不被调用）；
- envelope 内层解包（``progress=None`` → ``None``；``artifacts=[]`` → 空列表）。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

import pytest

from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)
from app.modules.runtime.service import (
    RUNTIME_RPC_TIMEOUT_SECONDS,
    RuntimeArtifactTooLarge,
    RuntimeDaemonForbidden,
    RuntimeDaemonOffline,
    RuntimeDaemonRemoteError,
    RuntimeDaemonTooOld,
    RuntimeLiveService,
    RuntimeNotBound,
    RuntimePathNotFound,
    RuntimeRpcTimeout,
    RuntimeTransferInterrupted,
)

pytestmark = pytest.mark.asyncio


# ────────────────────────────────────────────────────────────────────────────
# 假件与 fixture
# ────────────────────────────────────────────────────────────────────────────


class FakeHub:
    """``DaemonWsHub`` 测试替身——记录 send_rpc 调用，可预设 result / 抛异常。"""

    def __init__(self, result: Any = None, exc: BaseException | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.result = result
        self.exc = exc

    async def send_rpc(
        self,
        daemon_id: uuid.UUID,
        method: str,
        params: dict[str, Any],
        *,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "daemon_id": daemon_id,
                "method": method,
                "params": params,
                "timeout": timeout,
            }
        )
        if self.exc is not None:
            raise self.exc
        return self.result


@dataclass
class LiveEnv:
    """一个搭好的实时读取场景：用户 + 工作区 + viewer 成员 + 绑定行 + 假 hub。"""

    user_id: uuid.UUID
    workspace_id: uuid.UUID
    daemon_id: uuid.UUID
    hub: FakeHub


@pytest.fixture()
async def setup_live(db_session, monkeypatch):
    """一键搭场景 + patch 假 hub；返回 service + env。

    ``with_binding=False`` / ``daemon_id_null=True`` 供绑定解析矩阵使用。
    """

    async def _make(
        *,
        result: Any = None,
        exc: BaseException | None = None,
        with_binding: bool = True,
        daemon_id_null: bool = False,
        binding_root_path: str = r"C:\repo",
    ) -> tuple[RuntimeLiveService, LiveEnv]:
        from app.core.security import password_hasher
        from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
        from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
        from app.modules.workspace.model import Workspace

        # viewer 角色（RUNTIME_READ 权限在 router 层校验，这里只搭数据）
        role = Role(id=uuid.uuid4(), key="viewer", name="Viewer", is_system=True)
        db_session.add(role)
        await db_session.flush()
        db_session.add(RolePermission(role_id=role.id, permission="workspace:read"))

        user = User(
            id=uuid.uuid4(),
            email=f"u-{uuid.uuid4().hex[:8]}@example.com",
            password_hash=password_hasher.hash("Pass123!"),
            display_name="U",
            status="active",
        )
        db_session.add(user)
        await db_session.flush()

        ws = Workspace(
            id=uuid.uuid4(),
            name="W",
            slug=f"ws-{uuid.uuid4().hex[:8]}",
            root_path="/tmp/irrelevant",
            status="active",
            created_by=user.id,
        )
        db_session.add(ws)
        await db_session.flush()

        db_session.add(
            UserWorkspaceRole(
                user_id=user.id,
                workspace_id=ws.id,
                role_id=role.id,
            )
        )

        daemon_id = uuid.uuid4()
        if with_binding:
            db_session.add(
                WorkspaceMemberRuntime(
                    workspace_id=ws.id,
                    user_id=user.id,
                    daemon_id=None if daemon_id_null else daemon_id,
                    root_path=binding_root_path,
                    path_source="daemon-client",
                )
            )
        await db_session.commit()

        hub = FakeHub(result=result, exc=exc)
        monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

        svc = RuntimeLiveService(db_session)
        return svc, LiveEnv(user_id=user.id, workspace_id=ws.id, daemon_id=daemon_id, hub=hub)

    return _make


# ────────────────────────────────────────────────────────────────────────────
# 1. 四方法成功路径
# ────────────────────────────────────────────────────────────────────────────


async def test_get_progress_success(setup_live):
    result = {
        "progress": {
            "version": 5,
            "project": "multi-agent-platform",
            "current_stage": "execute",
            "current_change": "c1",
            "stages": {
                "scan": {"status": "completed", "steps": []},
                "execute": {
                    "status": "in-progress",
                    "steps": [
                        {"name": "Wave 1", "status": "completed"},
                        {"name": "Wave 2", "status": "in-progress"},
                    ],
                },
            },
            "last_active": "2026-08-19T10:00:00Z",
        }
    }
    svc, env = await setup_live(result=result)
    progress = await svc.get_progress(env.workspace_id, env.user_id)

    assert progress is not None
    assert progress.project == "multi-agent-platform"
    assert progress.current_stage == "execute"
    assert progress.current_change == "c1"
    assert progress.stages["execute"].steps[0].name == "Wave 1"
    # RPC 契约：方法名 + workspace_id/root_path 参数（无前缀配置，原样下发）+ 显式超时
    call = env.hub.calls[0]
    assert call["method"] == "runtime.read_progress"
    assert call["params"] == {"workspace_id": str(env.workspace_id), "root_path": r"C:\repo"}
    assert call["timeout"] == RUNTIME_RPC_TIMEOUT_SECONDS
    assert call["daemon_id"] == env.daemon_id


async def test_get_progress_none_data(setup_live):
    """daemon 返回 progress=None（无活跃变更）→ service 返回 None。"""
    svc, env = await setup_live(result={"progress": None})
    progress = await svc.get_progress(env.workspace_id, env.user_id)
    assert progress is None


async def test_get_user_inputs_success(setup_live):
    svc, env = await setup_live(result={"content": "# 用户输入记录\n"})
    content = await svc.get_user_inputs(env.workspace_id, env.user_id)
    assert content == "# 用户输入记录\n"
    assert env.hub.calls[0]["method"] == "runtime.read_user_inputs"
    assert env.hub.calls[0]["params"] == {
        "workspace_id": str(env.workspace_id),
        "root_path": r"C:\repo",
    }


async def test_get_user_inputs_none(setup_live):
    svc, env = await setup_live(result={"content": None})
    assert await svc.get_user_inputs(env.workspace_id, env.user_id) is None


async def test_get_artifacts_success(setup_live):
    result = {
        "artifacts": [
            {"filename": "design.md", "size_bytes": 100, "last_modified": None},
            {"filename": "plan.md", "size_bytes": 200, "last_modified": None},
        ]
    }
    svc, env = await setup_live(result=result)
    artifacts = await svc.get_artifacts(env.workspace_id, env.user_id)
    assert len(artifacts) == 2
    assert artifacts[0].filename == "design.md"
    assert artifacts[0].size_bytes == 100
    assert env.hub.calls[0]["method"] == "runtime.list_artifacts"
    assert env.hub.calls[0]["params"] == {
        "workspace_id": str(env.workspace_id),
        "root_path": r"C:\repo",
    }


async def test_get_artifacts_empty(setup_live):
    svc, env = await setup_live(result={})
    assert await svc.get_artifacts(env.workspace_id, env.user_id) == []


async def test_get_artifact_content_success(setup_live):
    svc, env = await setup_live(result={"content": "# 产物内容\n"})
    content = await svc.get_artifact_content(env.workspace_id, env.user_id, "design.md")
    assert content == "# 产物内容\n"
    call = env.hub.calls[0]
    assert call["method"] == "runtime.read_artifact"
    assert call["params"] == {
        "workspace_id": str(env.workspace_id),
        "filename": "design.md",
        "root_path": r"C:\repo",
    }


async def test_root_path_rewritten_with_prefix_config(setup_live, monkeypatch):
    """容器→宿主前缀配置生效：binding root_path 命中容器前缀 → params 携带改写后宿主路径。

    Docker 部署下 binding 行存的是容器视角路径，daemon 进程在宿主机上——
    ``resolve_root_path_for_daemon``（D-02@v1）负责改写，这里验证该改写
    确实体现在下发的 RPC params 里。settings 单例属性 patch 对齐
    daemon/tests/test_lease_service.py 的既有先例。
    """
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "container_path_prefix", "/host-projects")
    monkeypatch.setattr(settings, "host_path_prefix", "C:/Users/qinyi/IdeaProjects")

    svc, env = await setup_live(
        result={"progress": None},
        binding_root_path="/host-projects/my-repo",
    )
    await svc.get_progress(env.workspace_id, env.user_id)

    call = env.hub.calls[0]
    assert call["params"]["root_path"] == "C:/Users/qinyi/IdeaProjects/my-repo"


# ────────────────────────────────────────────────────────────────────────────
# 2. 绑定缺失矩阵
# ────────────────────────────────────────────────────────────────────────────


async def test_no_binding_row_raises_not_bound(setup_live):
    svc, env = await setup_live(with_binding=False)
    with pytest.raises(RuntimeNotBound) as exc_info:
        await svc.get_progress(env.workspace_id, env.user_id)
    assert exc_info.value.http_status == 404
    assert env.hub.calls == []  # 绑定解析先于 RPC


async def test_null_daemon_id_raises_not_bound(setup_live):
    svc, env = await setup_live(daemon_id_null=True)
    with pytest.raises(RuntimeNotBound):
        await svc.get_user_inputs(env.workspace_id, env.user_id)


# ────────────────────────────────────────────────────────────────────────────
# 3. RPC 错误映射全表
# ────────────────────────────────────────────────────────────────────────────


async def test_offline_maps_to_502(setup_live):
    svc, env = await setup_live(exc=DaemonRuntimeOffline("daemon offline", details=None))
    with pytest.raises(RuntimeDaemonOffline) as exc_info:
        await svc.get_progress(env.workspace_id, env.user_id)
    assert exc_info.value.http_status == 502


async def test_mid_rpc_disconnect_maps_to_transfer_interrupted(setup_live):
    svc, env = await setup_live(exc=DaemonRuntimeOffline("disconnected mid-rpc", details=None))
    with pytest.raises(RuntimeTransferInterrupted) as exc_info:
        await svc.get_progress(env.workspace_id, env.user_id)
    assert exc_info.value.http_status == 502


async def test_timeout_maps_to_504(setup_live):
    svc, env = await setup_live(exc=DaemonRpcTimeout("timeout", details=None))
    with pytest.raises(RuntimeRpcTimeout) as exc_info:
        await svc.get_progress(env.workspace_id, env.user_id)
    assert exc_info.value.http_status == 504


async def test_forbidden_maps_to_403(setup_live):
    svc, env = await setup_live(
        exc=DaemonRpcRemoteError({"code": "forbidden", "message": "denied"})
    )
    with pytest.raises(RuntimeDaemonForbidden) as exc_info:
        await svc.get_artifacts(env.workspace_id, env.user_id)
    assert exc_info.value.http_status == 403


async def test_not_found_maps_to_404(setup_live):
    svc, env = await setup_live(
        exc=DaemonRpcRemoteError({"code": "not_found", "message": "missing"})
    )
    with pytest.raises(RuntimePathNotFound) as exc_info:
        await svc.get_artifact_content(env.workspace_id, env.user_id, "gone.md")
    assert exc_info.value.http_status == 404


async def test_method_not_found_maps_to_422_too_old(setup_live):
    svc, env = await setup_live(
        exc=DaemonRpcRemoteError({"code": "method_not_found", "message": "no such method"})
    )
    with pytest.raises(RuntimeDaemonTooOld) as exc_info:
        await svc.get_progress(env.workspace_id, env.user_id)
    assert exc_info.value.http_status == 422
    assert "升级" in str(exc_info.value)


async def test_artifact_too_large_maps_to_413(setup_live):
    svc, env = await setup_live(
        exc=DaemonRpcRemoteError({"code": "artifact_too_large", "message": "over 1MB"})
    )
    with pytest.raises(RuntimeArtifactTooLarge) as exc_info:
        await svc.get_artifact_content(env.workspace_id, env.user_id, "big.bin")
    assert exc_info.value.http_status == 413


async def test_other_remote_error_maps_to_502(setup_live):
    svc, env = await setup_live(
        exc=DaemonRpcRemoteError({"code": "internal_error", "message": "boom"})
    )
    with pytest.raises(RuntimeDaemonRemoteError) as exc_info:
        await svc.get_progress(env.workspace_id, env.user_id)
    assert exc_info.value.http_status == 502


# ────────────────────────────────────────────────────────────────────────────
# 4. filename 预检矩阵（先于 RPC）
# ────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "bad_name",
    [
        "",
        "a\x00b",
        "/etc/passwd",
        "C:\\repo\\evil.txt",
        "\\\\server\\share\\f",
        "../secret.md",
        "a/../b.md",
        "sub/dir/file.md",
        "a\\b.md",
    ],
)
async def test_bad_filename_rejected_before_rpc(setup_live, bad_name):
    svc, env = await setup_live(result={"content": "x"})
    with pytest.raises(RuntimePathNotFound):
        await svc.get_artifact_content(env.workspace_id, env.user_id, bad_name)
    assert env.hub.calls == []  # 预检先于 RPC，hub 未被调用
