"""platform_sync spec bundle 拉取端点测试（task-08 / FR-07 / FR-08 / design §7.1/§7.3）。

覆盖新端点 ``GET /api/changes/-/spec-bundle``：

- 鉴权矩阵五分支：无凭据 401 / JWT 403 / ``shk_live_`` 403 / ``shpsync_`` 本
  workspace 200 + application/x-tar / ``scope.workspace_id`` 空 403 fail-closed。
- 跨 workspace 隔离：URL 不携带 workspace 选择器（workspace 唯一来源是 shpsync_
  token 派生，G6 / D-004@v1），「他 workspace」在结构上无请求面——用内容隔离
  断言兜底：token A 拉到的 tar 只含 A 的树，不含 B 的任何文件。
- 字面量路由前置：``/changes/-/spec-bundle`` 注册在 ``/changes/{name}/...``
  参数路由之前且 HTTP 命中 bundle 端点（R-06 ppm export-excel 同款坑）。
- tar 内容：顶层 ``PLATFORM-BUNDLE.json`` 四键（spec_version/strategy/
  generated_at/server）+ ``.runtime``/local.yaml 任意深度排除零回归 +
  服务器 spec_root 磁盘零残留（镜像树不被污染）。
"""

from __future__ import annotations

import io
import json
import tarfile
import uuid
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any

import pytest
from httpx import AsyncClient

from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace


async def _make_spec_workspace(
    db_session: Any,
    workspace: Workspace,
    spec_root: Path,
    *,
    strategy: str = "platform-managed",
    spec_version: int = 0,
) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        spec_root=str(spec_root),
        strategy=strategy,
        sync_status="clean",
        spec_version=spec_version,
    )
    db_session.add(spec_ws)
    await db_session.commit()
    await db_session.refresh(spec_ws)
    return spec_ws


def _seed_tree(spec_root: Path, *, marker: str) -> None:
    """造一棵含排除项的 spec 树：常规文件 + 任意深度 .runtime/ + local.yaml。"""
    (spec_root / "changes" / "demo-change").mkdir(parents=True)
    (spec_root / "changes" / "demo-change" / "proposal.md").write_text(
        f"# {marker}", encoding="utf-8"
    )
    (spec_root / "docs").mkdir()
    (spec_root / "docs" / "guide.md").write_text("# guide", encoding="utf-8")
    (spec_root / marker).write_text(marker, encoding="utf-8")
    # 排除断言素材：顶层 .runtime + 嵌套 .runtime + 顶层/嵌套 local.yaml
    (spec_root / ".runtime").mkdir()
    (spec_root / ".runtime" / "cache.log").write_text("runtime", encoding="utf-8")
    (spec_root / "changes" / "demo-change" / ".runtime").mkdir()
    (spec_root / "changes" / "demo-change" / ".runtime" / "x.db").write_text(
        "runtime-db", encoding="utf-8"
    )
    (spec_root / "local.yaml").write_text("token: top", encoding="utf-8")
    (spec_root / "changes" / "demo-change" / "local.yaml").write_text(
        "token: nested", encoding="utf-8"
    )


@pytest.fixture
async def spec_env(
    db_session: Any,
    client: AsyncClient,
    tmp_path: Path,
    shpsync_headers: tuple[Any, dict[str, str]],
):
    """造 workspace + 有内容的 spec_workspace（shpsync_ token 绑定）。"""
    workspace_id, headers = shpsync_headers
    ws = await db_session.get(Workspace, workspace_id)
    spec_root = tmp_path / "spec-root"
    _seed_tree(spec_root, marker="A-ONLY.md")
    await _make_spec_workspace(db_session, ws, spec_root, strategy="repo-mirrored", spec_version=7)
    return {
        "client": client,
        "headers": headers,
        "workspace_id": workspace_id,
        "spec_root": spec_root,
        "spec_version": 7,
        "strategy": "repo-mirrored",
    }


class TestAuthMatrix:
    """鉴权矩阵五分支（acceptance：全绿才算过）。"""

    async def test_no_token_401(self, client: AsyncClient) -> None:
        resp = await client.get("/api/changes/-/spec-bundle")
        assert resp.status_code == 401

    async def test_jwt_403(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        """浏览器 JWT（含平台管理员）凭据有效也 403——写通道仅 shpsync_。"""
        resp = await client.get("/api/changes/-/spec-bundle", headers=auth_headers)
        assert resp.status_code == 403

    async def test_apikey_403(self, client: AsyncClient, apikey_headers: dict[str, str]) -> None:
        """shk_live_ API Key 凭据有效也 403（同 spec-manifest 收紧口径）。"""
        resp = await client.get("/api/changes/-/spec-bundle", headers=apikey_headers)
        assert resp.status_code == 403

    async def test_shpsync_200_tar_with_headers(self, spec_env: dict[str, Any]) -> None:
        """shpsync_ token 200 + application/x-tar + Content-Disposition/X-Spec-Version。"""
        client: AsyncClient = spec_env["client"]
        resp = await client.get("/api/changes/-/spec-bundle", headers=spec_env["headers"])
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "application/x-tar"
        assert ".tar" in resp.headers["content-disposition"]
        assert resp.headers["x-spec-version"] == str(spec_env["spec_version"])
        # tar 可解包（acceptance）
        with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:*") as tf:
            tf.getmembers()

    async def test_scope_without_workspace_403_fail_closed(
        self, client: AsyncClient, db_session: Any
    ) -> None:
        """scope.workspace_id 为空 → 403 fail-closed（凭据形态异常防御分支）。

        真实 shpsync_ 通道恒派生 workspace（token 表 FK NOT NULL），本分支经
        dependency_overrides 直接构造空 scope 打到端点（HTTP 全链路 + 403 文案）。
        """
        from app.main import app
        from app.modules.auth.model import User
        from app.modules.platform_sync.auth import (
            PlatformSyncAuthScope,
            require_platform_sync_write,
        )

        user = User(
            email=f"noscope-{uuid.uuid4().hex[:6]}@example.com",
            password_hash="x",
            status="active",
        )
        db_session.add(user)
        await db_session.commit()

        app.dependency_overrides[require_platform_sync_write] = lambda: (
            user,
            PlatformSyncAuthScope(),
        )
        try:
            resp = await client.get("/api/changes/-/spec-bundle")
        finally:
            app.dependency_overrides.pop(require_platform_sync_write, None)
        assert resp.status_code == 403

    async def test_cross_workspace_isolation(
        self, db_session: Any, spec_env: dict[str, Any], tmp_path: Path
    ) -> None:
        """token A 只能拉 A 的树：tar 含 A 独有文件、不含 B 独有文件。

        URL 无 workspace 选择器（workspace 唯一来源 = token 派生），故「他
        workspace 403」在结构上无请求面——此处的等价保证是内容级隔离：
        B workspace 的文件绝不出现在 A token 拉到的 tar 里。
        """
        from app.core.config import get_settings
        from app.core.security import password_hasher
        from app.modules.auth.model import User
        from app.modules.platform_sync.token_service import PlatformSyncTokenService

        # 造第二个 workspace B + 各自签发的 shpsync_ token
        tag = uuid.uuid4().hex[:8]
        ws_b = Workspace(
            id=uuid.uuid4(),
            name=f"ws-bundle-b-{tag}",
            slug=f"ws-bundle-b-{tag}",
            root_path=f"/tmp/ws-bundle-b-{tag}",
            status="active",
        )
        db_session.add(ws_b)
        user_b = User(
            id=uuid.uuid4(),
            email=f"bundle-b-{tag}@example.com",
            password_hash=password_hasher.hash("x"),
            status="active",
        )
        db_session.add(user_b)
        await db_session.commit()
        await db_session.refresh(ws_b)

        spec_root_b = tmp_path / "spec-root-b"
        _seed_tree(spec_root_b, marker="B-ONLY.md")
        await _make_spec_workspace(db_session, ws_b, spec_root_b)

        _row, plaintext_b = await PlatformSyncTokenService(
            db_session, settings=get_settings()
        ).create(workspace_id=ws_b.id, name=f"bundle-b-{tag}", created_by=user_b.id)

        client: AsyncClient = spec_env["client"]
        # A 的 token：拿到 A 树，无 B 文件
        resp_a = await client.get("/api/changes/-/spec-bundle", headers=spec_env["headers"])
        assert resp_a.status_code == 200, resp_a.text
        with tarfile.open(fileobj=io.BytesIO(resp_a.content), mode="r:*") as tf:
            names = tf.getnames()
        assert "A-ONLY.md" in names
        assert "B-ONLY.md" not in names

        # B 的 token：拿到 B 树，无 A 文件（双向不串）
        resp_b = await client.get(
            "/api/changes/-/spec-bundle", headers={"Authorization": f"Bearer {plaintext_b}"}
        )
        assert resp_b.status_code == 200, resp_b.text
        with tarfile.open(fileobj=io.BytesIO(resp_b.content), mode="r:*") as tf:
            names_b = tf.getnames()
        assert "B-ONLY.md" in names_b
        assert "A-ONLY.md" not in names_b

    async def test_workspace_without_spec_workspace_404(
        self, client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
    ) -> None:
        """token 绑定 workspace 尚无 SpecWorkspace 行 → 404（service.get 语义透传）。"""
        _workspace_id, headers = shpsync_headers
        resp = await client.get("/api/changes/-/spec-bundle", headers=headers)
        assert resp.status_code == 404
        assert resp.json()["code"] == "HTTP_404_SPEC_WORKSPACE_NOT_FOUND"


class TestRoutePrecedence:
    """R-06：字面量 ``-`` 段路由前置于 ``/changes/{name}`` 参数路由。"""

    async def test_literal_route_registered_before_param_routes(
        self, spec_env: dict[str, Any]
    ) -> None:
        """注册顺序断言：``/api/changes/-/spec-bundle`` 在两个 GET 参数路由之前。

        FastAPI 按注册顺序匹配——一旦未来有人在 ``/changes/{name}/`` 下挂出
        两段后缀的 GET 路由，参数路由就会吞掉 ``-`` 字面量（ppm export-excel
        同款坑）。本断言守住注册顺序约束。
        """
        from app.main import app

        literal_idx: int | None = None
        param_idx: int | None = None
        for i, route in enumerate(app.routes):
            path = getattr(route, "path", "")
            methods = getattr(route, "methods", None) or set()
            if path == "/api/changes/-/spec-bundle" and "GET" in methods:
                literal_idx = i
            elif path == "/api/changes/{name}/progress" and "GET" in methods:
                param_idx = i
        assert literal_idx is not None, "字面量路由 /api/changes/-/spec-bundle 未注册"
        assert param_idx is not None
        assert literal_idx < param_idx

    async def test_request_hits_bundle_endpoint_not_name_route(
        self, spec_env: dict[str, Any]
    ) -> None:
        """HTTP 层命中断言：请求 ``-`` 路径得 tar 流而非 {name}='-' 的其它响应。"""
        client: AsyncClient = spec_env["client"]
        resp = await client.get("/api/changes/-/spec-bundle", headers=spec_env["headers"])
        assert resp.status_code == 200, resp.text
        # 命中的必须是 bundle 端点：tar 流 + 顶层元数据成员（progress 端点是 JSON，
        # 404 是 miss——两者都不可能带 application/x-tar + PLATFORM-BUNDLE.json）。
        assert resp.headers["content-type"] == "application/x-tar"
        with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:*") as tf:
            assert "PLATFORM-BUNDLE.json" in tf.getnames()


class TestBundleContent:
    """tar 内容断言：元数据四键 + 排除项零回归 + 磁盘零残留。"""

    async def test_platform_bundle_json_four_keys(self, spec_env: dict[str, Any]) -> None:
        """顶层 PLATFORM-BUNDLE.json 含且仅含四键，值与 DB 行一致。"""
        client: AsyncClient = spec_env["client"]
        resp = await client.get("/api/changes/-/spec-bundle", headers=spec_env["headers"])
        assert resp.status_code == 200, resp.text
        with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:*") as tf:
            names = tf.getnames()
            # 顶层字面名（非嵌套）
            assert "PLATFORM-BUNDLE.json" in names
            assert not any(
                n != "PLATFORM-BUNDLE.json" and n.endswith("PLATFORM-BUNDLE.json") for n in names
            )
            raw = tf.extractfile("PLATFORM-BUNDLE.json")
            assert raw is not None
            meta = json.loads(raw.read())
        assert set(meta) == {"spec_version", "strategy", "generated_at", "server"}
        assert meta["spec_version"] == spec_env["spec_version"]
        assert meta["strategy"] == spec_env["strategy"]
        # generated_at 是可解析的 ISO 时间（打包时刻 UTC）
        datetime.fromisoformat(str(meta["generated_at"]))
        assert isinstance(meta["server"], str) and meta["server"]

    async def test_runtime_and_local_yaml_excluded_any_depth(
        self, spec_env: dict[str, Any]
    ) -> None:
        """.runtime/（任意深度）与 local.yaml（任意深度）不出服务器。"""
        client: AsyncClient = spec_env["client"]
        resp = await client.get("/api/changes/-/spec-bundle", headers=spec_env["headers"])
        assert resp.status_code == 200, resp.text
        with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:*") as tf:
            names = tf.getnames()
        for name in names:
            parts = name.split("/")
            assert ".runtime" not in parts, f"runtime leaked into bundle: {name}"
            assert PurePosixPath(name).name != "local.yaml", f"local.yaml leaked: {name}"
        # 常规 spec 内容照常下发
        assert "changes/demo-change/proposal.md" in names
        assert "docs/guide.md" in names

    async def test_metadata_not_written_to_spec_root(self, spec_env: dict[str, Any]) -> None:
        """PLATFORM-BUNDLE.json 仅存在于 tar 流内，spec_root 磁盘零残留。"""
        client: AsyncClient = spec_env["client"]
        resp = await client.get("/api/changes/-/spec-bundle", headers=spec_env["headers"])
        assert resp.status_code == 200, resp.text
        spec_root: Path = spec_env["spec_root"]
        assert not (spec_root / "PLATFORM-BUNDLE.json").exists()
