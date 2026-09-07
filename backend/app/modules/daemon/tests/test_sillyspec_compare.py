"""sillyspec 冲突对比端点 + 服务端 diff（task-03 / FR-06~08 / D-001@v1）——测试先行红态锚定.

fixture 与命名照 ``test_sillyspec_platform_commands.py``（09-04 conflict-resolve-entry
同款端点先例：root conftest 的 ``db_session``/``client``、``_seed_user`` 手签 JWT、
``_grant_runtime_admin``、``_create_machine`` 直插行）。mock 边界**只有一处**：
``DaemonWsHub.send_rpc`` 类级 monkeypatch（compare 编排唯一外呼边界，explorer
``_send_explorer_rpc`` 先例）；平台侧不打 mock——SpecWorkspace 行指向 tmp_path 真实
文件树 + PlatformChangeProgressORM 直插行，让 containment / spec-tree 分类 /
progress 归一化在真实读取路径上被断言（跨平台：tmp_path + POSIX 相对路径拼 Path）。

覆盖（design §5 Phase 2 / §7.1 / §7.2 / §7.5）：

* 权限三态——owner 200 / 平台 admin 200 / 持 RUNTIME_ADMIN 的他人 404
  （code HTTP_404_DAEMON_RUNTIME_NOT_FOUND，防存在性泄漏）/ 无权限 403 /
  不存在 instance 404；越权请求 send_rpc 零调用；
* change 白名单——``a..b`` / 非法首字符 / 129 超长 → 422 且 RPC 零调用，
  128 字符边界放行；kind 非法 / workspace_id 缺失 → 422；
* RPC 契约——method=sillyspec_conflict_snapshot、params={change,kind}（§7.1）、
  机器级以 instance_id 作 daemon_id 路由、**显式 timeout=15**（send_rpc 默认
  10s 不够用）；
* 离线 / 超时 504——send_rpc 抛 DaemonRuntimeOffline / DaemonRpcTimeout → 504
  （DaemonRuntimeOffline 范式：code + details.daemon_instance_id）；
* spec-tree 四分类——modified / local_only（含平台侧缺失与读取被拒）/
  platform_only / identical + 双侧均缺失剔除计数 dropped_paths；modified 的
  diff_rows 精确对齐（equal/delete/insert + 双侧 lineno/text，replace 段展开为
  相邻 delete+insert）；mtime/missing/truncated/binary 标志透出；本地 truncated
  无 content 的文件不出 diff_rows；
* containment——daemon 回报含 ``..`` 段或 resolve 落点越出 spec_root 的路径按
  平台侧缺失处理（status=local_only + platform_mtime None，根外文件不被读取，
  spec_workspace/service.py:1486-1504 同款范式）；
* 双截断护栏——单文件 diff 超 5000 行置 diff_truncated 并截到 5000 行；
  整响应 JSON 超 2MB 置 response_truncated 并按文件倒序丢 diff_rows；
* progress 归一化——白名单六字段（当前阶段/阶段标签/步骤进度/最近活跃/ql_id/
  ghost）归一化为 progress_rows（label/local_value/platform_value/differ），
  本地缺失字段显式「—」，ql_id 透传，platform_updated_at=last_pushed_at。

当前代码没有该端点与 sillyspec_compare service——本文件全部用例预期红态
（404 Not Found 缺 code），task-04 的实现以本文件转绿为验收靶。
"""

from __future__ import annotations

import urllib.parse
import uuid
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import Role, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.daemon.model import DaemonInstance
from app.modules.daemon.runtime.service import DaemonRpcTimeout, DaemonRuntimeOffline
from app.modules.daemon.ws_hub import DaemonWsHub
from app.modules.platform_sync.model import PlatformChangeProgressORM
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

_CHANGE = "2026-09-07-conflict-diff-compare"
_QL_ID = "ql-20260904-002-62e1"
_CONFLICT_CREATED_AT = "2026-09-04T00:35:27.490Z"
_LOCAL_UPDATED_AT = "2026-09-04T08:35:27+08:00"

# 端点路径（design §7.2；含 /api 前缀，照 test_machine_sillyspec.py HTTP 断言形态）。
_COMPARE_PATH = "/api/daemon/machines/{instance_id}/sillyspec-conflicts/{change}/compare"

# progress 归一化字段白名单（design §5 Phase 2.3：对齐 daemon 可得字段）。
_PROGRESS_LABELS = {"当前阶段", "阶段标签", "步骤进度", "最近活跃", "ql_id", "ghost"}


# ── helpers（照 test_sillyspec_platform_commands.py 惯例就近私有复刻）──────────


async def _seed_user(
    db_session: AsyncSession, *, name: str, is_platform_admin: bool = False
) -> tuple[User, str]:
    """插入用户并手签 15min JWT（get_current_principal Bearer 路径）。"""
    from app.core.config import get_settings
    from app.core.security import create_access_token

    user = User(
        id=uuid.uuid4(),
        email=f"sscmp-{name}-{uuid.uuid4()}@example.com",
        password_hash="irrelevant",
        display_name=name,
        status="active",
        is_platform_admin=is_platform_admin,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    settings = get_settings()
    token, _payload = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=bool(user.is_platform_admin),
        settings=settings,
    )
    return user, token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _grant_runtime_admin(db_session: AsyncSession, user_id: uuid.UUID) -> None:
    """授予 RUNTIME_ADMIN 平台权限（复刻 test_sillyspec_platform_commands 同名 helper）。"""
    from app.modules.admin.model import UserRole
    from app.modules.auth.model import RolePermission

    role = Role(
        id=uuid.uuid4(),
        key=f"test-sscmp-admin-{uuid.uuid4().hex[:6]}",
        name="test runtime_admin",
    )
    db_session.add(role)
    await db_session.flush()
    db_session.add(RolePermission(role_id=role.id, permission=Permission.RUNTIME_ADMIN.value))
    db_session.add(UserRole(user_id=user_id, role_id=role.id))
    await db_session.commit()


async def _grant_workspace_member(
    db_session: AsyncSession, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> None:
    """把用户绑成 workspace 成员（UserWorkspaceRole 行即成员资格，角色零权限亦可）。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"test-sscmp-ws-{uuid.uuid4().hex[:6]}",
        name="test ws member",
    )
    db_session.add(role)
    await db_session.flush()
    db_session.add(UserWorkspaceRole(user_id=user_id, workspace_id=workspace_id, role_id=role.id))
    await db_session.commit()


async def _create_machine(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    *,
    hostname: str,
) -> DaemonInstance:
    """直插 daemon_instance 行（仿 test_sillyspec_platform_commands._create_machine）。"""
    from datetime import UTC, datetime

    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=hostname,
        server_url="http://localhost:8001",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(inst)
    await db_session.commit()
    await db_session.refresh(inst)
    return inst


async def _make_workspace(db_session: AsyncSession, *, name: str) -> Workspace:
    """直插 workspace 行（仿 spec_workspace/tests/test_bundle_sync._make_workspace）。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=f"sscmp-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/sscmp-test",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_spec_workspace(
    db_session: AsyncSession, workspace: Workspace, spec_root: Path
) -> SpecWorkspace:
    """直插 spec_workspaces 行，spec_root 指向测试临时目录（平台侧读取的事实源）。"""
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        spec_root=str(spec_root),
        strategy="platform-managed",
        sync_status="clean",
        spec_version=0,
    )
    db_session.add(spec_ws)
    await db_session.commit()
    return spec_ws


async def _seed_full_env(
    db_session: AsyncSession, tmp_path: Path, *, tag: str
) -> tuple[User, str, DaemonInstance, Workspace, Path]:
    """owner 视角一站式播种：用户（+RUNTIME_ADMIN）+ 机器 + 工作区 + 成员绑定 +
    spec_root=tmp_path/spec 的 SpecWorkspace 行。返回 (owner, token, inst, ws, spec_root)。"""
    owner, token = await _seed_user(db_session, name=f"sscmp-{tag}")
    await _grant_runtime_admin(db_session, owner.id)
    inst = await _create_machine(db_session, owner.id, hostname=f"sscmp-{tag}-host")
    ws = await _make_workspace(db_session, name=f"sscmp-{tag}-ws")
    await _grant_workspace_member(db_session, owner.id, ws.id)
    spec_root = tmp_path / "spec"
    spec_root.mkdir(parents=True)
    await _make_spec_workspace(db_session, ws, spec_root)
    return owner, token, inst, ws, spec_root


def _write_platform_file(spec_root: Path, rel_posix: str, content: str) -> None:
    """在 spec_root 下按 POSIX 相对路径写平台侧文件（跨平台，不硬编码分隔符）。"""
    target = spec_root.joinpath(*rel_posix.split("/"))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


async def _seed_platform_progress(
    db_session: AsyncSession,
    workspace_id: uuid.UUID,
    change: str,
    *,
    platform_entry: dict[str, Any],
    last_pushed_at: str,
) -> None:
    """直插 platform_change_progress 行（仿 platform_sync/tests 裸六表种子形态）。

    ``latest_progress`` 为 serializeForSync 六表（changes[] 内嵌该 change 的进度
    条目），``last_pushed_at`` 是契约字符串原值（compare 的 platform_updated_at 源）。
    """
    db_session.add(
        PlatformChangeProgressORM(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            change_name=change,
            latest_progress={
                "project": {"name": change},
                "changes": [platform_entry],
                "stages": [],
                "steps": [],
                "batch_progress": [],
                "approvals": [],
            },
            last_pushed_at=last_pushed_at,
            last_pusher="seed",
        )
    )
    await db_session.commit()


def _compare_url(
    instance_id: uuid.UUID,
    change: str,
    *,
    kind: str = "spec-tree",
    workspace_id: uuid.UUID | None = None,
) -> str:
    """拼 compare 端点 URL（§7.2）；workspace_id=None 时不带该 query 参数。"""
    query: dict[str, str] = {"kind": kind}
    if workspace_id is not None:
        query["workspace_id"] = str(workspace_id)
    base = _COMPARE_PATH.format(instance_id=instance_id, change=change)
    return f"{base}?{urllib.parse.urlencode(query)}"


def _snapshot(
    files: list[dict[str, Any]] | None = None,
    progress: dict[str, Any] | None = None,
    *,
    change: str = _CHANGE,
    kind: str = "spec-tree",
    ql_id: str | None = None,
) -> dict[str, Any]:
    """daemon 侧 sillyspec_conflict_snapshot RPC 结果（§7.1 result 形态）。"""
    return {
        "change": change,
        "kind": kind,
        "ql_id": ql_id,
        "conflict_created_at": _CONFLICT_CREATED_AT,
        "local_updated_at": _LOCAL_UPDATED_AT,
        "files": files,
        "progress": progress,
    }


def _local_file(
    path: str,
    content: str | None = None,
    *,
    mtime: str = "2026-09-04T08:00:00+08:00",
    size: int = 64,
    truncated: bool = False,
    binary: bool = False,
    missing: bool = False,
) -> dict[str, Any]:
    """daemon 快照 files[] 单项（§7.1）：truncated/binary/missing 时缺省 content 键。"""
    entry: dict[str, Any] = {
        "path": path,
        "mtime": mtime,
        "size": size,
        "truncated": truncated,
        "binary": binary,
        "missing": missing,
    }
    if content is not None:
        entry["content"] = content
    return entry


class _SnapshotRpcStub:
    """monkeypatch ``DaemonWsHub.send_rpc``——compare 编排唯一 mock 边界。

    记录每次调用（daemon_id/method/params/timeout），返回 ``result`` 快照字典；
    ``error`` 非空时改抛该异常（模拟离线 / RPC 超时）。类级 patch 覆盖进程内
    任意 hub 实例（含 ws_hub.get_daemon_ws_hub() 单例，懒导入也拦得住），与
    09-04 先例 ``_SendRecorder`` 同款手法。
    """

    def __init__(
        self,
        result: dict[str, Any] | None = None,
        error: Exception | None = None,
    ) -> None:
        self.result = result
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def install(self, monkeypatch: pytest.MonkeyPatch) -> _SnapshotRpcStub:
        stub = self

        async def _fake_send_rpc(
            self_hub: DaemonWsHub,
            daemon_id: uuid.UUID,
            method: str,
            params: dict[str, Any],
            *,
            timeout: float | None = None,
        ) -> dict[str, Any]:
            stub.calls.append(
                {
                    "daemon_id": daemon_id,
                    "method": method,
                    "params": dict(params),
                    "timeout": timeout,
                }
            )
            if stub.error is not None:
                raise stub.error
            return stub.result or {}

        monkeypatch.setattr(DaemonWsHub, "send_rpc", _fake_send_rpc)
        return stub


# ── 端点权限三态（owner / 平台 admin 放行，其余 404/403）+ RPC 契约 ───────────


@pytest.mark.asyncio
async def test_compare_owner_returns_200_and_rpc_contract(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """机器所有者（持 RUNTIME_ADMIN、workspace 成员）→ 200；RPC 契约逐项——
    以 instance_id 作 daemon_id 路由、method/params 按 §7.1、**显式 timeout=15**
    （send_rpc 默认 10s 对 183 文件级快照不够用）。"""
    _owner, token, inst, ws, _root = await _seed_full_env(db_session, tmp_path, tag="owner")
    stub = _SnapshotRpcStub(
        result=_snapshot(files=[_local_file("changes/x/design.md", content="# 本地\n")])
    ).install(monkeypatch)

    resp = await client.get(
        _compare_url(inst.id, _CHANGE, kind="spec-tree", workspace_id=ws.id),
        headers=_headers(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["change"] == _CHANGE
    assert body["kind"] == "spec-tree"

    assert len(stub.calls) == 1
    call = stub.calls[0]
    assert call["daemon_id"] == inst.id
    assert call["method"] == "sillyspec_conflict_snapshot"
    assert call["params"] == {"change": _CHANGE, "kind": "spec-tree"}
    assert call["timeout"] == 15, "必须显式传 15s（send_rpc 默认 10s 不够）"


@pytest.mark.asyncio
async def test_compare_platform_admin_returns_200(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """平台管理员（非 owner，亦是 workspace 成员）→ 200（has_permission 短路 +
    _get_owned_instance 全局放行，同裁决端点权限集合）。"""
    _owner, _owner_token, inst, ws, _root = await _seed_full_env(db_session, tmp_path, tag="pa")
    _admin, admin_token = await _seed_user(
        db_session, name="sscmp-pa-admin", is_platform_admin=True
    )
    await _grant_workspace_member(db_session, _admin.id, ws.id)
    stub = _SnapshotRpcStub(result=_snapshot(files=[])).install(monkeypatch)

    resp = await client.get(
        _compare_url(inst.id, _CHANGE, workspace_id=ws.id),
        headers=_headers(admin_token),
    )
    assert resp.status_code == 200, resp.text
    assert len(stub.calls) == 1


@pytest.mark.asyncio
async def test_compare_runtime_admin_stranger_returns_404(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """持 RUNTIME_ADMIN 但非 owner 且非平台 admin → 404（code
    HTTP_404_DAEMON_RUNTIME_NOT_FOUND，越权与不存在合并防存在性泄漏），RPC 零调用。"""
    _owner, _token, inst, ws, _root = await _seed_full_env(db_session, tmp_path, tag="stranger")
    _str, stranger_token = await _seed_user(db_session, name="sscmp-stranger")
    await _grant_runtime_admin(db_session, _str.id)
    stub = _SnapshotRpcStub(result=_snapshot(files=[])).install(monkeypatch)

    resp = await client.get(
        _compare_url(inst.id, _CHANGE, workspace_id=ws.id),
        headers=_headers(stranger_token),
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("code") == "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"
    assert stub.calls == [], "越权请求不得触达 send_rpc"


@pytest.mark.asyncio
async def test_compare_plain_user_returns_403(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """无 RUNTIME_ADMIN 权限的普通用户 → 403（RuntimeAdminUser 权限闸，早于归属校验）。"""
    _owner, _token, inst, ws, _root = await _seed_full_env(db_session, tmp_path, tag="plain")
    _nobody, nobody_token = await _seed_user(db_session, name="sscmp-nobody")
    stub = _SnapshotRpcStub(result=_snapshot(files=[])).install(monkeypatch)

    resp = await client.get(
        _compare_url(inst.id, _CHANGE, workspace_id=ws.id),
        headers=_headers(nobody_token),
    )
    assert resp.status_code == 403, resp.text
    assert stub.calls == []


@pytest.mark.asyncio
async def test_compare_nonexistent_instance_returns_404(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """不存在 instance_id → 404（平台 admin 请求同样 404，code 同款防泄漏形态）。"""
    _owner, _token, _inst, ws, _root = await _seed_full_env(db_session, tmp_path, tag="missing")
    _admin, admin_token = await _seed_user(
        db_session, name="sscmp-missing-admin", is_platform_admin=True
    )
    stub = _SnapshotRpcStub(result=_snapshot(files=[])).install(monkeypatch)

    resp = await client.get(
        _compare_url(uuid.uuid4(), _CHANGE, workspace_id=ws.id),
        headers=_headers(admin_token),
    )
    assert resp.status_code == 404, resp.text
    assert resp.json().get("code") == "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"
    assert stub.calls == []


# ── change 白名单 + query 参数校验（422 早于任何 RPC）─────────────────────────


@pytest.mark.parametrize(
    "bad_change",
    [
        "a..b",  # 显式禁 ..（即使正则可过）
        "-bad",  # 首字符非字母数字
        ".dotted-start",  # 首字符点号（隐藏目录形态）
        "has space",  # 含空格（shell 元字符面）
        "a" * 129,  # 超长（上限 128）
    ],
    ids=["dotdot", "bad-first-char", "dot-first", "space", "too-long-129"],
)
@pytest.mark.asyncio
async def test_compare_rejects_bad_change_without_touching_rpc(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    bad_change: str,
) -> None:
    """非法 change 路径段 → 422 且 send_rpc 零调用（复用 resolve 端点同款
    ``[A-Za-z0-9][A-Za-z0-9._-]{0,127}`` 白名单 + 显式拒 ``..``）。

    空格经 urlencode（%20）进路径段，路由参数解码后再校验（实测可命中路由）。
    注：含 ``/`` 的 ``../x`` 穿越形态不可经 HTTP 路径段测——%2F 在 Starlette
    路由匹配前已被解码拆段、根本到不了校验器（404 而非 422）；该形态的防线由
    containment 用例在 files[] 路径维度覆盖（test_compare_spec_tree_containment）。
    """
    _owner, token, inst, ws, _root = await _seed_full_env(
        db_session, tmp_path, tag=f"wl-{bad_change[:6]!r}"
    )
    stub = _SnapshotRpcStub(result=_snapshot(files=[])).install(monkeypatch)

    url = (
        _COMPARE_PATH.format(instance_id=inst.id, change=urllib.parse.quote(bad_change))
        + "?"
        + urllib.parse.urlencode({"kind": "spec-tree", "workspace_id": str(ws.id)})
    )
    resp = await client.get(url, headers=_headers(token))
    assert resp.status_code == 422, resp.text
    assert stub.calls == [], "422 请求不得触达 send_rpc"


@pytest.mark.asyncio
async def test_compare_accepts_128_char_change_boundary(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """长度上限含 128（恰 128 字符）→ 200——钉住边界，防白名单被误收紧成 127。"""
    _owner, token, inst, ws, _root = await _seed_full_env(db_session, tmp_path, tag="b128")
    change_128 = "a" * 128
    stub = _SnapshotRpcStub(result=_snapshot(files=[], change=change_128)).install(monkeypatch)

    resp = await client.get(
        _compare_url(inst.id, change_128, workspace_id=ws.id),
        headers=_headers(token),
    )
    assert resp.status_code == 200, resp.text
    assert stub.calls[0]["params"]["change"] == change_128


@pytest.mark.parametrize(
    ("kind", "with_workspace"),
    [
        ("spec-tree", False),  # workspace_id 缺失（必填 query）
        ("whatever", True),  # kind 非法值
        ("", True),  # kind 空
    ],
    ids=["missing-workspace-id", "bad-kind", "empty-kind"],
)
@pytest.mark.asyncio
async def test_compare_rejects_bad_query_params(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
    with_workspace: bool,
) -> None:
    """query 参数校验：workspace_id 必填、kind 仅 spec-tree|progress（Literal）→ 422。"""
    _owner, token, inst, ws, _root = await _seed_full_env(
        db_session, tmp_path, tag=f"qp-{kind or 'empty'}"
    )
    stub = _SnapshotRpcStub(result=_snapshot(files=[])).install(monkeypatch)

    workspace_id = ws.id if with_workspace else None
    resp = await client.get(
        _compare_url(inst.id, _CHANGE, kind=kind, workspace_id=workspace_id),
        headers=_headers(token),
    )
    assert resp.status_code == 422, resp.text
    assert stub.calls == []


# ── 离线 / RPC 超时 → 504（与机器级 sillyspec-resolve 同范式）─────────────────


@pytest.mark.asyncio
async def test_compare_rpc_offline_yields_504(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """send_rpc 抛 DaemonRuntimeOffline（无连接/发送失败）→ 504，code
    HTTP_504_DAEMON_RUNTIME_OFFLINE、details 带 daemon_instance_id（resolve 先例）。"""
    _owner, token, inst, ws, _root = await _seed_full_env(db_session, tmp_path, tag="offline")
    _SnapshotRpcStub(
        error=DaemonRuntimeOffline(
            "目标机器当前离线或消息下发失败，请确认守护进程在线后重试。",
            details={"daemon_instance_id": str(inst.id)},
        )
    ).install(monkeypatch)

    resp = await client.get(
        _compare_url(inst.id, _CHANGE, workspace_id=ws.id),
        headers=_headers(token),
    )
    assert resp.status_code == 504, resp.text
    body = resp.json()
    assert body.get("code") == "HTTP_504_DAEMON_RUNTIME_OFFLINE"
    details = body.get("details") or {}
    assert details.get("daemon_instance_id") == str(inst.id)


@pytest.mark.asyncio
async def test_compare_rpc_timeout_yields_504(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """send_rpc 抛 DaemonRpcTimeout（15s 内无回执）→ 504（DaemonRuntimeOffline
    同范式：AppError 504 家族，code HTTP_504_DAEMON_RPC_TIMEOUT 透传）。"""
    _owner, token, inst, ws, _root = await _seed_full_env(db_session, tmp_path, tag="timeout")
    _SnapshotRpcStub(
        error=DaemonRpcTimeout(
            "daemon rpc 'sillyspec_conflict_snapshot' timed out after 15s.",
            details={"daemon_id": str(inst.id), "timeout_seconds": 15},
        )
    ).install(monkeypatch)

    resp = await client.get(
        _compare_url(inst.id, _CHANGE, workspace_id=ws.id),
        headers=_headers(token),
    )
    assert resp.status_code == 504, resp.text
    assert resp.json().get("code") == "HTTP_504_DAEMON_RPC_TIMEOUT"


# ── spec-tree：四分类 + diff_rows 对齐 + dropped_paths + 标志透出（§7.2）──────


@pytest.mark.asyncio
async def test_compare_spec_tree_four_categories_and_dropped_paths(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """四分类全谱——modified（内容差异+精确 diff_rows）/ identical（同内容）/
    local_only（本地有、平台侧缺失）/ platform_only（本地缺失、平台有）；
    双侧均缺失路径从清单剔除并计 dropped_paths；时间/标志字段透出；ql_id 透传。"""
    _owner, token, inst, ws, spec_root = await _seed_full_env(db_session, tmp_path, tag="fourcat")
    design = "changes/2026-09-07-demo/design.md"
    tasks = "changes/2026-09-07-demo/tasks.md"
    only_local = "changes/only-local.md"
    only_platform = "changes/only-platform.md"
    gone = "changes/gone.md"

    _write_platform_file(spec_root, design, "line-1\nline-2-changed\nline-3\n")
    _write_platform_file(spec_root, tasks, "# 同内容\n\n两边一致。\n")
    _write_platform_file(spec_root, only_platform, "# platform only\n")

    stub = _SnapshotRpcStub(
        result=_snapshot(
            files=[
                _local_file(design, "line-1\nline-2\nline-3\n", mtime="2026-09-04T08:00:00+08:00"),
                _local_file(tasks, "# 同内容\n\n两边一致。\n", mtime="2026-09-04T08:01:00+08:00"),
                _local_file(only_local, "# local only\n", mtime="2026-09-04T08:02:00+08:00"),
                _local_file(only_platform, mtime="2026-09-04T08:03:00+08:00", missing=True),
                _local_file(gone, mtime="2026-09-04T08:04:00+08:00", missing=True),
            ],
            ql_id=_QL_ID,
        )
    ).install(monkeypatch)

    resp = await client.get(
        _compare_url(inst.id, _CHANGE, workspace_id=ws.id),
        headers=_headers(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # 顶层透传链：change/kind/ql_id/conflict_created_at/local_updated_at（§7.2）。
    assert body["change"] == _CHANGE
    assert body["kind"] == "spec-tree"
    assert body["ql_id"] == _QL_ID
    assert body["conflict_created_at"] == _CONFLICT_CREATED_AT
    assert body["local_updated_at"] == _LOCAL_UPDATED_AT
    assert isinstance(body["platform_updated_at"], str) and body["platform_updated_at"]
    assert body["response_truncated"] is False

    # 双侧均缺失的 gone.md 被剔除并计数（B4 修订）。
    assert body["dropped_paths"] == 1
    files = {f["path"]: f for f in body["files"]}
    assert set(files) == {design, tasks, only_local, only_platform}
    assert gone not in files

    # 清单顺序沿用 daemon 快照序（信噪比排序在 daemon 侧完成，平台不重排）。
    assert [f["path"] for f in body["files"]] == [design, tasks, only_local, only_platform]

    # 四分类。
    assert files[design]["status"] == "modified"
    assert files[tasks]["status"] == "identical"
    assert files[only_local]["status"] == "local_only"
    assert files[only_platform]["status"] == "platform_only"

    # 标志与时间：本地侧 mtime 字符串透传；缺失侧对应字段为 null。
    assert files[design]["local_mtime"] == "2026-09-04T08:00:00+08:00"
    assert isinstance(files[design]["platform_mtime"], str) and files[design]["platform_mtime"]
    assert files[design]["local_missing"] is False
    assert files[design]["local_truncated"] is False
    assert files[design]["binary"] is False
    assert files[design]["diff_truncated"] is False
    assert files[only_local]["platform_mtime"] is None
    assert files[only_platform]["local_mtime"] is None
    assert files[only_platform]["local_missing"] is True

    # modified 的 diff_rows 精确对齐（replace 段展开为相邻 delete+insert；
    # delete 行 platform_* 为 null、insert 行 local_* 为 null、lineno 1 起）。
    assert files[design]["diff_rows"] == [
        {
            "type": "equal",
            "local_lineno": 1,
            "local_text": "line-1",
            "platform_lineno": 1,
            "platform_text": "line-1",
        },
        {
            "type": "delete",
            "local_lineno": 2,
            "local_text": "line-2",
            "platform_lineno": None,
            "platform_text": None,
        },
        {
            "type": "insert",
            "local_lineno": None,
            "local_text": None,
            "platform_lineno": 2,
            "platform_text": "line-2-changed",
        },
        {
            "type": "equal",
            "local_lineno": 3,
            "local_text": "line-3",
            "platform_lineno": 3,
            "platform_text": "line-3",
        },
    ]

    assert len(stub.calls) == 1


@pytest.mark.asyncio
async def test_compare_spec_tree_truncated_and_binary_files_have_no_diff_rows(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """本地 truncated 无 content / binary 无 content 的文件不出 diff_rows——
    status 按元信息分类、截断信号透出（避免全 insert 的方向信号失真，Grill 复审）；
    平台侧文件存在与否不影响「不出 diff_rows」契约。"""
    _owner, token, inst, ws, spec_root = await _seed_full_env(db_session, tmp_path, tag="trunc")
    big = "changes/big.md"
    logo = "changes/logo.png"

    _write_platform_file(spec_root, big, "platform-side content\n")
    _write_platform_file(spec_root, logo, "PNGDATA")

    _SnapshotRpcStub(
        result=_snapshot(
            files=[
                _local_file(big, mtime="2026-09-04T08:10:00+08:00", size=300000, truncated=True),
                _local_file(logo, mtime="2026-09-04T08:11:00+08:00", size=4096, binary=True),
            ],
            ql_id=None,
        )
    ).install(monkeypatch)

    resp = await client.get(
        _compare_url(inst.id, _CHANGE, workspace_id=ws.id),
        headers=_headers(token),
    )
    assert resp.status_code == 200, resp.text
    files = {f["path"]: f for f in resp.json()["files"]}

    assert set(files) == {big, logo}
    assert files[big]["local_truncated"] is True
    assert not files[big]["diff_rows"], "本地 truncated 无 content 的文件不出 diff_rows"
    assert files[logo]["binary"] is True
    assert not files[logo]["diff_rows"], "binary 无文本内容的文件不出 diff_rows"


@pytest.mark.asyncio
async def test_compare_spec_tree_containment_rejects_escape_paths(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """containment（Grill B3）：daemon 回报含 ``..`` 段或 resolve 落点越出
    spec_root 的路径 → 按平台侧缺失处理（local_only + platform_mtime null），
    根外文件不被读取。对照文件 prove 读取器本身工作正常（identical）。"""
    _owner, token, inst, ws, spec_root = await _seed_full_env(db_session, tmp_path, tag="escape")
    escape = "../escape.txt"
    nested_escape = "changes/../../side.txt"
    ok = "changes/ok.md"

    # 根外诱饵文件（spec_root = tmp_path/spec，落点 tmp_path 下）——内容与本地
    # 快照完全一致：若未做 containment 而真的读取，会被分类成 identical 而露馅。
    (tmp_path / "escape.txt").write_text("SECRET-ESCAPE", encoding="utf-8")
    (tmp_path / "side.txt").write_text("SECRET-SIDE", encoding="utf-8")
    _write_platform_file(spec_root, ok, "same\n")

    _SnapshotRpcStub(
        result=_snapshot(
            files=[
                _local_file(escape, "SECRET-ESCAPE"),
                _local_file(nested_escape, "SECRET-SIDE"),
                _local_file(ok, "same\n"),
            ]
        )
    ).install(monkeypatch)

    resp = await client.get(
        _compare_url(inst.id, _CHANGE, workspace_id=ws.id),
        headers=_headers(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    files = {f["path"]: f for f in body["files"]}

    # 越界路径按平台侧缺失处理，不读取（对照：正常路径 identical）。
    assert files[escape]["status"] == "local_only"
    assert files[escape]["platform_mtime"] is None
    assert files[nested_escape]["status"] == "local_only"
    assert files[nested_escape]["platform_mtime"] is None
    assert files[ok]["status"] == "identical"
    assert body["dropped_paths"] == 0


# ── 双截断护栏（单文件 5000 行 / 整响应 2MB，design §5 Phase 2 / §8）──────────


@pytest.mark.asyncio
async def test_compare_spec_tree_diff_row_cap_marks_diff_truncated(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """单文件 diff 超 5000 行 → 该文件 diff_truncated=True 且行数截到 5000；
    整响应仍远低于 2MB（response_truncated=False，两道护栏独立）。"""
    _owner, token, inst, ws, spec_root = await _seed_full_env(db_session, tmp_path, tag="diffcap")
    huge = "changes/huge.md"
    local_lines = "".join(f"L{i:04d}\n" for i in range(6000))
    platform_lines = "".join(f"P{i:04d}\n" for i in range(6000))
    _write_platform_file(spec_root, huge, platform_lines)

    _SnapshotRpcStub(
        result=_snapshot(files=[_local_file(huge, local_lines, size=len(local_lines))])
    ).install(monkeypatch)

    resp = await client.get(
        _compare_url(inst.id, _CHANGE, workspace_id=ws.id),
        headers=_headers(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    entry = {f["path"]: f for f in body["files"]}[huge]

    # 6000 delete + 6000 insert = 12000 行 → 截到 5000，首段保留（delete 在前）。
    assert entry["diff_truncated"] is True
    assert len(entry["diff_rows"]) == 5000
    assert entry["diff_rows"][0]["type"] == "delete"
    assert entry["diff_rows"][0]["local_text"] == "L0000"
    assert body["response_truncated"] is False


@pytest.mark.asyncio
async def test_compare_spec_tree_response_cap_drops_rows_from_tail(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """整响应 JSON 超 2MB → response_truncated=True，按文件倒序丢 diff_rows
    （清单尾部先丢、头部保住），最终响应体不超 2MB；单文件护栏不受牵连。"""
    _owner, token, inst, ws, spec_root = await _seed_full_env(db_session, tmp_path, tag="respcap")
    paths = [f"changes/f{i:02d}.md" for i in range(12)]
    local_lines = "".join(f"A{i:04d}-" + "x" * 90 + "\n" for i in range(600))
    platform_lines = "".join(f"B{i:04d}-" + "y" * 90 + "\n" for i in range(600))
    for path in paths:
        _write_platform_file(spec_root, path, platform_lines)

    _SnapshotRpcStub(
        result=_snapshot(
            files=[_local_file(path, local_lines, size=len(local_lines)) for path in paths]
        )
    ).install(monkeypatch)

    resp = await client.get(
        _compare_url(inst.id, _CHANGE, workspace_id=ws.id),
        headers=_headers(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    files = {f["path"]: f for f in body["files"]}

    assert body["response_truncated"] is True
    # 文件倒序丢：头部文件保住 diff_rows，尾部文件被清空。
    assert files[paths[0]]["diff_rows"], "清单头部文件的 diff_rows 必须保留"
    assert files[paths[-1]]["diff_rows"] == [], "清单尾部文件的 diff_rows 应先被丢弃"
    assert files[paths[0]]["diff_truncated"] is False
    assert len(resp.content) <= 2 * 1024 * 1024, "截断后响应体不得超过 2MB"


# ── progress：白名单归一化 progress_rows + ql_id 透传（§5 Phase 2 / §7.2）────


@pytest.mark.asyncio
async def test_compare_progress_rows_normalized(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """progress 模式——白名单六字段归一化 progress_rows（键集 label/local_value/
    platform_value/differ）；字符串字段原值+方向 differ、相同值 differ=False；
    ql_id 行平台侧显式「—」；platform_updated_at=last_pushed_at；ql_id 顶层透传。"""
    _owner, token, inst, ws, _root = await _seed_full_env(db_session, tmp_path, tag="prog")
    local_progress = {
        "name": _CHANGE,
        "current_stage": "execute",
        "stage_label": "⚡ 波次执行",
        "last_active": "2026-09-07T09:00:00+08:00",
        "steps": {"total": 12, "completed": 3},
        "ghost": False,
    }
    platform_entry = {
        "name": _CHANGE,
        "current_stage": "plan",
        "stage_label": "📐 实现计划",
        "last_active": "2026-09-06T18:00:00+08:00",
        "steps": {"total": 12, "completed": 3},
        "ghost": False,
    }
    last_pushed_at = "2026-09-06T20:00:00+08:00"
    await _seed_platform_progress(
        db_session,
        ws.id,
        _CHANGE,
        platform_entry=platform_entry,
        last_pushed_at=last_pushed_at,
    )

    _SnapshotRpcStub(
        result=_snapshot(progress=local_progress, kind="progress", ql_id=_QL_ID)
    ).install(monkeypatch)

    resp = await client.get(
        _compare_url(inst.id, _CHANGE, kind="progress", workspace_id=ws.id),
        headers=_headers(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["kind"] == "progress"
    assert body["ql_id"] == _QL_ID
    assert body["local_updated_at"] == _LOCAL_UPDATED_AT
    assert body["platform_updated_at"] == last_pushed_at

    rows = body["progress_rows"]
    by_label = {}
    for row in rows:
        assert set(row) == {"label", "local_value", "platform_value", "differ"}
        by_label[row["label"]] = row
    assert set(by_label) == _PROGRESS_LABELS, "progress_rows 字段白名单（六字段）"

    # 字符串字段：原值透传 + 方向 differ。
    assert by_label["当前阶段"]["local_value"] == "execute"
    assert by_label["当前阶段"]["platform_value"] == "plan"
    assert by_label["当前阶段"]["differ"] is True
    assert by_label["阶段标签"]["local_value"] == "⚡ 波次执行"
    assert by_label["阶段标签"]["platform_value"] == "📐 实现计划"
    assert by_label["阶段标签"]["differ"] is True
    assert by_label["最近活跃"]["local_value"] == "2026-09-07T09:00:00+08:00"
    assert by_label["最近活跃"]["platform_value"] == "2026-09-06T18:00:00+08:00"
    assert by_label["最近活跃"]["differ"] is True

    # 相同值 → differ=False（步骤进度双侧 3/12、ghost 双侧同值；不钉复合值格式）。
    assert by_label["步骤进度"]["local_value"] == by_label["步骤进度"]["platform_value"]
    assert by_label["步骤进度"]["differ"] is False
    assert by_label["ghost"]["local_value"] == by_label["ghost"]["platform_value"]
    assert by_label["ghost"]["differ"] is False

    # ql_id 平台侧不可得 → 显式「—」。
    assert by_label["ql_id"]["local_value"] == _QL_ID
    assert by_label["ql_id"]["platform_value"] == "—"
    assert by_label["ql_id"]["differ"] is True


@pytest.mark.asyncio
async def test_compare_progress_local_missing_field_shows_placeholder(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """本地进度缺失白名单字段（daemon 快照无 stage_label）→ 该行 local_value
    显式「—」且 differ=True（design §5 Phase 2.3）。"""
    _owner, token, inst, ws, _root = await _seed_full_env(db_session, tmp_path, tag="progmiss")
    local_progress = {
        "name": _CHANGE,
        "current_stage": "execute",
        "steps": {"total": 8, "completed": 8},
        "ghost": False,
    }
    platform_entry = {
        "name": _CHANGE,
        "current_stage": "execute",
        "stage_label": "📐 实现计划",
        "steps": {"total": 8, "completed": 8},
        "ghost": False,
    }
    await _seed_platform_progress(
        db_session,
        ws.id,
        _CHANGE,
        platform_entry=platform_entry,
        last_pushed_at="2026-09-06T20:00:00+08:00",
    )

    _SnapshotRpcStub(
        result=_snapshot(progress=local_progress, kind="progress", ql_id=None)
    ).install(monkeypatch)

    resp = await client.get(
        _compare_url(inst.id, _CHANGE, kind="progress", workspace_id=ws.id),
        headers=_headers(token),
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()["progress_rows"]
    by_label = {row["label"]: row for row in rows}

    assert by_label["阶段标签"]["local_value"] == "—"
    assert by_label["阶段标签"]["differ"] is True
