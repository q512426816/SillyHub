"""HTTP-level tests for the knowledge / quicklog router."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest

from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

COMPONENT_FIXTURES = Path(__file__).parent.parent.parent / "change" / "tests" / "fixtures" / "valid"


def _copy_fixture(src: Path, tmp_path: Path, name: str = "ws") -> Path:
    dst = tmp_path / name
    shutil.copytree(src, dst)
    return dst


@pytest.fixture()
async def workspace_with_knowledge(
    client, db_session, tmp_path: Path, auth_headers: dict[str, str]
) -> dict:
    root = _copy_fixture(COMPONENT_FIXTURES, tmp_path)

    # task-09（2026-07-10-remove-server-local-workspace-mode）：扁平布局——knowledge/
    # quicklog/ 直接在 spec_root 下（daemon-client 同步产出，无 .sillyspec 包裹）。
    knowledge_dir = root / "knowledge"
    knowledge_dir.mkdir(parents=True, exist_ok=True)
    (knowledge_dir / "INDEX.md").write_text(
        "# Knowledge Index\n\n> Reference document.\n",
        encoding="utf-8",
    )
    (knowledge_dir / "uncategorized.md").write_text(
        "# Uncategorized\n\nSome uncategorized knowledge.\n",
        encoding="utf-8",
    )

    quicklog_dir = root / "quicklog"
    quicklog_dir.mkdir(parents=True, exist_ok=True)
    (quicklog_dir / "2026-01-15.md").write_text(
        "# Quicklog 2026-01-15\n\n- Fixed bug X\n- Added feature Y\n",
        encoding="utf-8",
    )

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "knowledge-test", "root_path": str(root), "type": "other"},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]

    # task-09：HTTP 创建会 bootstrap spec_ws.spec_root = {spec_data_root}/{ws_id}（非
    # root_path）。扁平布局下 parser 读 spec_ws.spec_root/knowledge/，故把 spec_root
    # 重定向到固件写入的 root（测试隔离，不影响生产语义）。
    from sqlmodel import select

    spec_ws = (
        await db_session.execute(
            select(SpecWorkspace).where(SpecWorkspace.workspace_id == uuid.UUID(ws_id))
        )
    ).scalar_one()
    spec_ws.spec_root = str(root)
    await db_session.commit()

    return {"ws_id": ws_id}


async def test_list_knowledge(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    filenames = [item["filename"] for item in body["items"]]
    assert "INDEX.md" in filenames
    assert "uncategorized.md" in filenames


async def test_get_knowledge_detail(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/INDEX.md",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["filename"] == "INDEX.md"
    assert body["title"] == "Knowledge Index"
    assert body["content"] is not None
    assert "Reference document" in body["content"]


async def test_get_knowledge_not_found(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/nonexistent.md",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_list_knowledge_no_content_in_list(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge",
        headers=auth_headers,
    )
    body = resp.json()
    for item in body["items"]:
        assert item["content"] is None


async def test_list_quicklog(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/quicklog",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["filename"] == "2026-01-15.md"


async def test_get_quicklog_detail(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/quicklog/2026-01-15.md",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Quicklog 2026-01-15"
    assert "Fixed bug X" in body["content"]


async def test_get_quicklog_not_found(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/quicklog/nonexistent.md",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_knowledge_no_auth_returns_401(client, workspace_with_knowledge: dict) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(f"/api/workspaces/{ws_id}/knowledge")
    assert resp.status_code == 401


async def test_quicklog_no_auth_returns_401(client, workspace_with_knowledge: dict) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(f"/api/workspaces/{ws_id}/quicklog")
    assert resp.status_code == 401


async def test_unknown_workspace_knowledge_returns_404(
    client, auth_headers: dict[str, str]
) -> None:
    resp = await client.get(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/knowledge",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_empty_knowledge_directory(
    client, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    root = _copy_fixture(COMPONENT_FIXTURES, tmp_path, "empty-k")
    knowledge_dir = root / ".sillyspec" / "knowledge"
    knowledge_dir.mkdir(parents=True, exist_ok=True)

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "empty-k", "root_path": str(root), "type": "other"},
        headers=auth_headers,
    )
    ws_id = ws_resp.json()["id"]

    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


async def test_daemon_client_knowledge_reads_platform_spec_root(
    client,
    db_session,
    tmp_path: Path,
    auth_headers: dict[str, str],
) -> None:
    spec_root = tmp_path / "platform-spec"
    knowledge_dir = spec_root / "knowledge"
    knowledge_dir.mkdir(parents=True, exist_ok=True)
    (knowledge_dir / "INDEX.md").write_text(
        "# Platform Knowledge\n\nDaemon-client content.",
        encoding="utf-8",
    )

    ws = Workspace(
        id=uuid.uuid4(),
        name="daemon-client-knowledge",
        slug=f"daemon-client-knowledge-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "client-machine-path"),
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)

    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        spec_root=str(spec_root),
        strategy="platform-managed",
        sync_status="clean",
    )
    db_session.add(spec_ws)
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws.id}/knowledge",
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["filename"] == "INDEX.md"
    assert body["items"][0]["title"] == "Platform Knowledge"


# ---------------------------------------------------------------------------
# task-01（2026-09-17-knowledge-precipitation / D-004@v1）：读侧 zone 化
# ---------------------------------------------------------------------------


async def _create_zone_workspace(db_session, tmp_path: Path) -> Workspace:
    """建带四 zone 知识文件（含跨目录同名）的 workspace，spec_root 指向固件根。"""
    spec_root = tmp_path / "zone-spec"
    knowledge_dir = spec_root / "knowledge"
    (knowledge_dir / "decisions").mkdir(parents=True)
    (knowledge_dir / "generated").mkdir()
    (knowledge_dir / "proposed").mkdir()
    (knowledge_dir / "INDEX.md").write_text("# Zone Index\n\n> Reference.", encoding="utf-8")
    # 跨目录同名：top 层与 decisions/ 下各一个 shared.md
    (knowledge_dir / "shared.md").write_text("# Top Shared\n\nTop body.", encoding="utf-8")
    (knowledge_dir / "decisions" / "daemon.md").write_text(
        "# Decision Daemon\n\nDecision body.", encoding="utf-8"
    )
    (knowledge_dir / "decisions" / "shared.md").write_text(
        "# Decision Shared\n\nDecision body.", encoding="utf-8"
    )
    (knowledge_dir / "generated" / "runtime.md").write_text(
        "# Generated Runtime\n\nAuto body.", encoding="utf-8"
    )
    (knowledge_dir / "proposed" / "pending.md").write_text(
        "# Proposed Pending\n\nCandidate body.", encoding="utf-8"
    )

    ws = Workspace(
        id=uuid.uuid4(),
        name="zone-knowledge",
        slug=f"zone-knowledge-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "client-machine-path"),
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)

    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        spec_root=str(spec_root),
        strategy="platform-managed",
        sync_status="clean",
    )
    db_session.add(spec_ws)
    await db_session.commit()
    return ws


async def test_list_knowledge_includes_subdirectory_entries_with_zones(
    client,
    db_session,
    tmp_path: Path,
    auth_headers: dict[str, str],
) -> None:
    """列表含 decisions/ 与 generated/ 子目录条目，zone 四值全覆盖（D-004 修复）。"""
    ws = await _create_zone_workspace(db_session, tmp_path)

    resp = await client.get(f"/api/workspaces/{ws.id}/knowledge", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 6
    by_filename = {item["filename"]: item for item in body["items"]}
    assert set(by_filename) == {
        "INDEX.md",
        "shared.md",
        "decisions/daemon.md",
        "decisions/shared.md",
        "generated/runtime.md",
        "proposed/pending.md",
    }
    # zone 派生：四值覆盖
    assert by_filename["INDEX.md"]["zone"] == "top"
    assert by_filename["shared.md"]["zone"] == "top"
    assert by_filename["decisions/daemon.md"]["zone"] == "decisions"
    assert by_filename["decisions/shared.md"]["zone"] == "decisions"
    assert by_filename["generated/runtime.md"]["zone"] == "generated"
    assert by_filename["proposed/pending.md"]["zone"] == "proposed"
    # 回归：顶层条目 filename/path 值与 zone 化改造前逐字一致（D-007 兼容承诺）
    assert by_filename["INDEX.md"]["filename"] == "INDEX.md"
    assert by_filename["INDEX.md"]["path"] == ".sillyspec/knowledge/INDEX.md"
    assert by_filename["shared.md"]["path"] == ".sillyspec/knowledge/shared.md"
    # 子目录条目 path 拼完整相对路径
    assert by_filename["decisions/daemon.md"]["path"] == ".sillyspec/knowledge/decisions/daemon.md"


async def test_get_knowledge_cross_zone_same_name_each_hit(
    client,
    db_session,
    tmp_path: Path,
) -> None:
    """跨目录同名 get 各自命中 + 子目录不存在维持 WorkspaceNotFound 语义。

    service 层直测：get_knowledge 按 filename（含子目录段，值天然唯一）精确
    匹配。HTTP 路由 ``/knowledge/{filename}`` 的 ``:path`` 通配改造归 task-04
    （task-01 不动 router），HTTP 侧覆盖见下方 task-04 写端点用例。
    """
    from app.core.errors import WorkspaceNotFound
    from app.modules.knowledge.service import KnowledgeService

    ws = await _create_zone_workspace(db_session, tmp_path)

    service = KnowledgeService(db_session)
    top = await service.get_knowledge(ws.id, "shared.md")
    assert top.title == "Top Shared"
    assert top.zone == "top"
    assert top.path == ".sillyspec/knowledge/shared.md"
    assert "Top body" in (top.content or "")

    decision = await service.get_knowledge(ws.id, "decisions/shared.md")
    assert decision.title == "Decision Shared"
    assert decision.zone == "decisions"
    assert decision.path == ".sillyspec/knowledge/decisions/shared.md"
    assert "Decision body" in (decision.content or "")

    # 子目录条目不存在 → 既有 WorkspaceNotFound 语义（非裸 404）
    with pytest.raises(WorkspaceNotFound):
        await service.get_knowledge(ws.id, "decisions/missing.md")


# ---------------------------------------------------------------------------
# task-04（2026-09-17-knowledge-precipitation）：写侧端点（writer + 五写路由 + :path 通配）
# ---------------------------------------------------------------------------

_WRITER_INDEX_MD = (
    "# Knowledge Index\n"
    "\n"
    "## Known Issues\n"
    "\n"
    "- legacy|旧问题 → [known-issues.md#legacy-issue](known-issues.md#legacy-issue)\n"
    "\n"
    "## Patterns\n"
    "\n"
    "- seed|既有关键词 → [patterns.md#seed-pattern](patterns.md#seed-pattern)\n"
)
_WRITER_KNOWN_ISSUES_MD = "# Known Issues\n\n## legacy-issue\n\nlegacy body.\n"
_WRITER_PATTERNS_MD = "# Patterns\n\n## seed-pattern\n\nseed body.\n"
_WRITER_DECISION_MD = "# Decision Daemon\n\ndecision body.\n"


def _b64(text: str) -> str:
    import base64

    return base64.b64encode(text.encode("utf-8")).decode("ascii")


@pytest.fixture()
async def writer_ws(db_session, tmp_path: Path) -> dict:
    """写端点用工作区：spec_root 经 apply_ops 铺底（manifest 行随建，乐观锁链路真实）。"""
    from app.modules.spec_workspace.schema import FileOp
    from app.modules.spec_workspace.service import SpecWorkspaceService

    ws = Workspace(
        id=uuid.uuid4(),
        name="knowledge-writer-router",
        slug=f"kwr-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "client-machine-path"),
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)

    spec_root = tmp_path / "writer-router-spec"
    db_session.add(
        SpecWorkspace(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            spec_root=str(spec_root),
            strategy="platform-managed",
            sync_status="clean",
        )
    )
    await db_session.commit()

    await SpecWorkspaceService(db_session).apply_ops(
        ws.id,
        [
            FileOp(
                op="add", path="knowledge/INDEX.md", content=_b64(_WRITER_INDEX_MD), base_version=0
            ),
            FileOp(
                op="add",
                path="knowledge/known-issues.md",
                content=_b64(_WRITER_KNOWN_ISSUES_MD),
                base_version=0,
            ),
            FileOp(
                op="add",
                path="knowledge/patterns.md",
                content=_b64(_WRITER_PATTERNS_MD),
                base_version=0,
            ),
            FileOp(
                op="add",
                path="knowledge/decisions/daemon.md",
                content=_b64(_WRITER_DECISION_MD),
                base_version=0,
            ),
        ],
    )
    return {"ws_id": str(ws.id), "spec_root": spec_root}


async def _plain_user_headers(db_session) -> dict[str, str]:
    """无任何角色/平台管理员权限的普通用户 token（403 用例）。"""
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User

    user = User(
        id=uuid.uuid4(),
        email=f"plain-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Plain",
        status="active",
        is_platform_admin=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return {"Authorization": f"Bearer {token}"}


async def test_propose_endpoint_literal_route_not_swallowed_by_wildcard(
    client, writer_ws: dict, auth_headers: dict[str, str]
) -> None:
    """POST /knowledge/propose 字面量路由命中（未被 {filename:path} 通配吞）+ 落盘契约。"""
    ws_id = writer_ws["ws_id"]
    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/propose",
        headers=auth_headers,
        json={
            "title": "port conflict guard",
            "category": "pattern",
            "body": "check the occupying process before switching ports.",
            "tags": ["deploy", "port"],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["zone"] == "proposed"
    assert body["filename"] == "proposed/port-conflict-guard.md"
    assert "author: " in (body["content"] or "")
    assert "source: manual" in (body["content"] or "")

    # 列表侧待审核 zone 可见
    listing = await client.get(f"/api/workspaces/{ws_id}/knowledge", headers=auth_headers)
    proposed = [i for i in listing.json()["items"] if i["zone"] == "proposed"]
    assert [i["filename"] for i in proposed] == ["proposed/port-conflict-guard.md"]


async def test_get_knowledge_subdirectory_via_path_converter(
    client, writer_ws: dict, auth_headers: dict[str, str]
) -> None:
    """task-01 遗留 HTTP 化：GET /knowledge/{filename:path} 命中子目录条目。"""
    ws_id = writer_ws["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/decisions/daemon.md",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["filename"] == "decisions/daemon.md"
    assert body["zone"] == "decisions"
    assert "decision body" in (body["content"] or "")


async def test_patch_update_entry_roundtrip(
    client, writer_ws: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = writer_ws["ws_id"]
    new_content = "# Patterns\n\n## seed-pattern\n\nrewritten body.\n"
    resp = await client.patch(
        f"/api/workspaces/{ws_id}/knowledge/entries/patterns.md",
        headers=auth_headers,
        json={"content": new_content},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["content"] == new_content

    detail = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/patterns.md", headers=auth_headers
    )
    assert detail.json()["content"] == new_content


async def test_patch_decisions_zone_returns_422(
    client, writer_ws: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = writer_ws["ws_id"]
    resp = await client.patch(
        f"/api/workspaces/{ws_id}/knowledge/entries/decisions/daemon.md",
        headers=auth_headers,
        json={"content": "# tampered\n"},
    )
    assert resp.status_code == 422
    body = resp.json()
    assert "由归档流程维护" in body["message"]


async def test_write_endpoints_require_knowledge_write_permission(
    client, db_session, writer_ws: dict
) -> None:
    """无 KNOWLEDGE_WRITE 的普通用户 → 403（管理员 fixture 是 is_platform_admin 短路）。"""
    ws_id = writer_ws["ws_id"]
    headers = await _plain_user_headers(db_session)

    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/propose",
        headers=headers,
        json={"title": "no perm", "body": "x"},
    )
    assert resp.status_code == 403, resp.text

    resp = await client.patch(
        f"/api/workspaces/{ws_id}/knowledge/entries/patterns.md",
        headers=headers,
        json={"content": "x"},
    )
    assert resp.status_code == 403

    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/proposed/any.md/merge",
        headers=headers,
        json={"target_file": "patterns.md", "section_title": "s", "keywords": ["k"]},
    )
    assert resp.status_code == 403

    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/proposed/any.md/reject",
        headers=headers,
    )
    assert resp.status_code == 403


async def test_preview_merge_endpoint_shape(
    client, writer_ws: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = writer_ws["ws_id"]
    await client.post(
        f"/api/workspaces/{ws_id}/knowledge/propose",
        headers=auth_headers,
        json={"title": "preview candidate", "body": "preview body."},
    )

    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/proposed/preview-candidate.md/preview-merge",
        headers=auth_headers,
        json={
            "target_file": "patterns.md",
            "section_title": "preview section",
            "keywords": ["preview", "关键词"],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["section_text"] == "\n## preview section\n\npreview body.\n"
    assert body["index_line"] == (
        "- preview|关键词 → [patterns.md#preview section](patterns.md#preview section)"
    )
    assert body["section_skipped"] is False
    assert body["index_line_skipped"] is False

    # dry-run 不落盘
    detail = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/patterns.md", headers=auth_headers
    )
    assert detail.json()["content"] == _WRITER_PATTERNS_MD


async def test_merge_endpoint_two_stage_end_to_end(
    client, writer_ws: dict, auth_headers: dict[str, str]
) -> None:
    """merge 全链路：段一追加+INDEX 路由行生效、段二候选删除（读侧 404）。"""
    ws_id = writer_ws["ws_id"]
    await client.post(
        f"/api/workspaces/{ws_id}/knowledge/propose",
        headers=auth_headers,
        json={"title": "merge candidate", "body": "merge body content."},
    )

    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/proposed/merge-candidate.md/merge",
        headers=auth_headers,
        json={
            "target_file": "known-issues.md",
            "section_title": "port conflict",
            "keywords": ["port", "部署"],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["merged"] is True
    assert body["section_appended"] is True
    assert body["index_updated"] is True
    assert body["index_line"] == (
        "- port|部署 → [known-issues.md#port conflict](known-issues.md#port conflict)"
    )

    # 目标文件已追加小节
    target = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/known-issues.md", headers=auth_headers
    )
    target_content = target.json()["content"]
    assert "## port conflict" in target_content
    assert "merge body content." in target_content

    # INDEX 路由行落在 ## Known Issues 分类段内
    index = await client.get(f"/api/workspaces/{ws_id}/knowledge/INDEX.md", headers=auth_headers)
    index_content = index.json()["content"]
    assert (
        "- port|部署 → [known-issues.md#port conflict](known-issues.md#port conflict)"
        in (index_content.split("## Known Issues", 1)[1].split("## Patterns", 1)[0])
    )

    # 段二：候选已删
    gone = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/proposed/merge-candidate.md", headers=auth_headers
    )
    assert gone.status_code == 404


async def test_merge_conflict_returns_409_contract(
    client, db_session, writer_ws: dict, auth_headers: dict[str, str], monkeypatch
) -> None:
    """409 冲突契约：message + details.conflict + details.server_versions 三键齐全。"""
    from app.modules.knowledge.writer import KnowledgeWriterService

    ws_id = writer_ws["ws_id"]
    await client.post(
        f"/api/workspaces/{ws_id}/knowledge/propose",
        headers=auth_headers,
        json={"title": "conflict candidate", "body": "body."},
    )

    orig = KnowledgeWriterService._manifest_version

    async def stale(self, workspace_id, op_path):
        v = await orig(self, workspace_id, op_path)
        return max(v - 1, 0)

    monkeypatch.setattr(KnowledgeWriterService, "_manifest_version", stale)

    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/proposed/conflict-candidate.md/merge",
        headers=auth_headers,
        json={
            "target_file": "patterns.md",
            "section_title": "conflict section",
            "keywords": ["conflict"],
        },
    )
    assert resp.status_code == 409, resp.text
    body = resp.json()
    assert body["message"] == "文件在别处被修改，请刷新后重试"
    assert body["details"]["conflict"] is True
    assert body["details"]["server_versions"]  # 非空：含冲突路径服务器当前版本
    assert all(isinstance(v, int) for v in body["details"]["server_versions"].values())

    monkeypatch.undo()
    # 候选保留未删（两段式：段一冲突不进段二）
    kept = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/proposed/conflict-candidate.md",
        headers=auth_headers,
    )
    assert kept.status_code == 200


async def test_reject_endpoint_deletes_candidate(
    client, writer_ws: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = writer_ws["ws_id"]
    await client.post(
        f"/api/workspaces/{ws_id}/knowledge/propose",
        headers=auth_headers,
        json={"title": "reject candidate", "body": "to be rejected."},
    )

    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/proposed/reject-candidate.md/reject",
        headers=auth_headers,
    )
    assert resp.status_code == 204, resp.text

    gone = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/proposed/reject-candidate.md", headers=auth_headers
    )
    assert gone.status_code == 404


async def test_merge_target_outside_whitelist_returns_422(
    client, writer_ws: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = writer_ws["ws_id"]
    await client.post(
        f"/api/workspaces/{ws_id}/knowledge/propose",
        headers=auth_headers,
        json={"title": "whitelist candidate", "body": "body."},
    )
    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/proposed/whitelist-candidate.md/merge",
        headers=auth_headers,
        json={
            "target_file": "INDEX.md",
            "section_title": "s",
            "keywords": ["k"],
        },
    )
    assert resp.status_code == 422
    assert "known-issues.md / patterns.md / conventions.md" in resp.json()["message"]


# ---------------------------------------------------------------------------
# task-07（2026-09-17-knowledge-precipitation / FR-01 / FR-03 / D-002@v1）：
# 蒸馏派发两端点（POST /knowledge/distill + GET /knowledge/distill/tasks）
# ---------------------------------------------------------------------------


async def _knowledge_read_only_headers(db_session) -> dict[str, str]:
    """仅持 KNOWLEDGE_READ 的用户 token（写端点 403 / 任务列表 200 两态用）。"""
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.admin.model import UserRole
    from app.modules.auth.model import Role, RolePermission, User

    user = User(
        id=uuid.uuid4(),
        email=f"reader-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Reader",
        status="active",
        is_platform_admin=False,
    )
    role = Role(
        key=f"knowledge-reader-{uuid.uuid4().hex[:8]}",
        name="知识库只读（测试）",
        is_active=True,
    )
    db_session.add_all([user, role])
    await db_session.flush()
    db_session.add(RolePermission(role_id=role.id, permission="knowledge:read"))
    db_session.add(UserRole(user_id=user.id, role_id=role.id))
    await db_session.commit()
    await db_session.refresh(user)

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return {"Authorization": f"Bearer {token}"}


async def _admin_session_record(db_session, auth_admin_token: str) -> str:
    """给 admin@example.com 用户建一条有记录的 AgentSession（session 源派发用）。"""
    from sqlalchemy import select as _select

    from app.modules.agent.model import AgentSession
    from app.modules.auth.model import User

    admin = (
        (await db_session.execute(_select(User).where(User.email == "admin@example.com")))
        .scalars()
        .one()
    )
    session = AgentSession(
        id=uuid.uuid4(),
        user_id=admin.id,
        provider="claude_code",
        status="ended",
        turn_count=3,
    )
    db_session.add(session)
    await db_session.commit()
    return str(session.id)


async def test_distill_write_endpoint_permission_states(
    client, db_session, writer_ws: dict, auth_admin_token: str
) -> None:
    """权限两态：仅 KNOWLEDGE_READ 用户 POST /knowledge/distill 403、tasks 200。"""
    ws_id = writer_ws["ws_id"]
    headers = await _knowledge_read_only_headers(db_session)
    session_id = await _admin_session_record(db_session, auth_admin_token)

    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/distill",
        headers=headers,
        json={"source_type": "session", "source_ref": session_id},
    )
    assert resp.status_code == 403, resp.text

    # 读侧（任务列表）对 KNOWLEDGE_READ 持有者放行（字面量路由未被通配吞）。
    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/distill/tasks",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == []


async def test_distill_dispatch_and_tasks_list_shape(
    client,
    db_session,
    writer_ws: dict,
    auth_headers: dict[str, str],
    auth_admin_token: str,
    monkeypatch,
) -> None:
    """dispatch 响应形状（DistillTaskRead 全字段）+ 离线同步收敛 failed + 列表只含 distill 类。

    D-008：fresh 会话源先导出+上传附件（patch 假上传——单测无 MinIO，且本用例
    只验 HTTP 形状）。"""

    from sqlalchemy import select as _select

    from app.modules.agent.model import AgentRun
    from app.modules.auth.model import User
    from app.modules.knowledge import distill as distill_module

    ws_id = writer_ws["ws_id"]
    session_id = await _admin_session_record(db_session, auth_admin_token)

    async def _fake_upload(db, user_id, source_session_id, data):
        # 建真实草稿附件行（HTTP 链路里 create_session 的附件归属校验会查库；
        # 只跳过 MinIO 落对象这一步）。经 dispatch 的请求级 db 写入保证可见。
        from app.modules.session_attachment.model import SessionAttachment

        row = SessionAttachment(
            user_id=user_id,
            session_id=None,
            kind="file",
            media_type="text/markdown",
            bytes=len(data),
            name=f"distill-source-{str(source_session_id)[:8]}.md",
            object_key=f"attachments/{user_id}/distill-fake-{source_session_id}.md",
            sha256=f"{source_session_id}".replace("-", "")[:64],
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return row

    monkeypatch.setattr(distill_module, "_upload_distill_source", _fake_upload)

    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/distill",
        headers=auth_headers,
        json={
            "source_type": "session",
            "source_ref": session_id,
            "focus": "只提取踩坑",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # D-009/D-010 扩展字段：mode/agent_session_id/merged_to/degraded_reason。
    assert set(body) == {
        "agent_run_id",
        "source_type",
        "source_ref",
        "status",
        "created_at",
        "mode",
        "agent_session_id",
        "merged_to",
        "degraded_reason",
    }
    assert body["source_type"] == "session"
    assert body["source_ref"] == session_id
    # fresh 离线兜底：同步收敛 failed/no_online_daemon（无后台任务竞态）。
    assert body["status"] == "failed"
    assert body["mode"] == "fresh"
    assert body["agent_session_id"] is None
    assert body["merged_to"] is None
    assert body["degraded_reason"] is None

    # 任务列表（GET 字面量路由命中，未被 {filename:path} 通配吞）：只含 distill 类、
    # 离线终态立即可查。
    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/distill/tasks", headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    tasks = resp.json()
    assert len(tasks) == 1
    assert tasks[0]["agent_run_id"] == body["agent_run_id"]
    assert tasks[0]["status"] == "failed"
    assert tasks[0]["source_ref"] == session_id

    # 其它 AgentRun（无 distill metadata）不混入：补一个普通 run 挂同 workspace。
    admin = (
        (await db_session.execute(_select(User).where(User.email == "admin@example.com")))
        .scalars()
        .one()
    )
    from app.modules.workspace.model import AgentRunWorkspace

    plain_run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
    )
    db_session.add(plain_run)
    db_session.add(AgentRunWorkspace(agent_run_id=plain_run.id, workspace_id=uuid.UUID(ws_id)))
    await db_session.commit()
    # admin 用户行被 HTTP 链路读过，防 UnusedVariable 告警归因不清：显式断言存在。
    assert admin is not None

    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/distill/tasks", headers=auth_headers
    )
    assert [t["agent_run_id"] for t in resp.json()] == [body["agent_run_id"]]


async def test_distill_dispatch_source_validation_via_http(
    client, writer_ws: dict, auth_headers: dict[str, str]
) -> None:
    """源校验 HTTP 面：无记录会话 422 + 不存在变更 404。"""
    ws_id = writer_ws["ws_id"]

    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/distill",
        headers=auth_headers,
        json={"source_type": "change", "source_ref": "2099-01-01-no-such-change"},
    )
    assert resp.status_code == 404, resp.text

    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/distill",
        headers=auth_headers,
        json={"source_type": "session", "source_ref": str(uuid.uuid4())},
    )
    assert resp.status_code == 404, resp.text
