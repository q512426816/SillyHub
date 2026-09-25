"""沉淀资产聚合测试（2026-09-25-change-precipitated-assets FR-01/02）。

覆盖（design §测试面 + Grill 两条非阻塞建议吸收——损坏 JSON 用例在内）：
- ``_parse_entries_owned_by`` 纯函数：节头分条 + 「变更：」行归属过滤 + status 提取；
- 金样本式聚合：tmp 镜像（fr 两条目一归属一他属 + decisions 一归属一无主条目 +
  归档目录 test-trace/delta，无 change-patch.json → patch=None 容错）；
- 在途变更（未归档）跳过目录件读取（design R-03）；
- 损坏 JSON fail-open（Grill 建议：test-trace 非法 → test_rows=[]）；
- 跨工作区/不存在 → ``ChangeNotFound``。

2026-09-25-change-detail-assets-usability / FR-04 追加：``change-patch.json`` 的
files 清单投影（含超上限标注）与 ``change.patch`` 单文件切片（命中/改名/引号路径/
未命中/缺件/超限）。

author: qinyi
created_at: 2026-09-25
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest

from app.core.errors import ChangeNotFound
from app.modules.change import assets as assets_mod
from app.modules.change.assets import (
    ChangeAssetsQueryService,
    _parse_entries_owned_by,
    slice_patch_for_file,
)
from app.modules.change.model import Change
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

KEY = "2026-09-25-assets-golden"

# 切片样本：两文件块（普通头 + 新增文件头），覆盖块边界不串段。
PATCH_SAMPLE = (
    "diff --git a/src/flow.js b/src/flow.js\n"
    "index 1111111..2222222 100644\n"
    "--- a/src/flow.js\n"
    "+++ b/src/flow.js\n"
    "@@ -1,2 +1,3 @@\n"
    " a\n"
    "+b\n"
    " c\n"
    "diff --git a/test/x.test.mjs b/test/x.test.mjs\n"
    "new file mode 100644\n"
    "index 0000000..3333333\n"
    "--- /dev/null\n"
    "+++ b/test/x.test.mjs\n"
    "@@ -0,0 +1,1 @@\n"
    "+x\n"
)


# ===========================================================================
# 纯函数：条目归属解析
# ===========================================================================


def test_parse_entries_owned_by_filters_and_extracts() -> None:
    """节头分条 + 「变更：」行过滤 + status 行提取；无主条目与他属条目跳过。"""
    text = (
        "# FR 索引\n\n"
        f"## FR-auto-test-001 归属条目\n变更：{KEY}\n状态：active\n摘要：x\n\n"
        "## FR-auto-test-002 他属条目\n变更：other-change\n状态：active\n\n"
        "## FR-auto-test-003 无主条目\n状态：active\n\n"
        f"## D-001@v1 决策归属\n变更：{KEY}\n理由：y\n"
    )
    entries = _parse_entries_owned_by(text, KEY)
    assert [(e[0], e[2]) for e in entries] == [
        ("FR-auto-test-001", "active"),
        ("D-001@v1", None),  # 决策条目无「状态：」行 → None 容差
    ]
    assert entries[0][1] == "归属条目"


# ===========================================================================
# fixture：tmp 镜像 + DB 行
# ===========================================================================


async def _make_ws_spec(db_session, spec_root: Path) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="assets ws",
        slug=f"assets-{uuid.uuid4().hex[:8]}",
        root_path=str(spec_root.parent),
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
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
    return ws


async def _make_change(db_session, ws: Workspace, *, archived: bool) -> Change:
    rel = f"changes/archive/{KEY}" if archived else f"changes/{KEY}"
    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=KEY,
        title=KEY,
        status="archived" if archived else "in_progress",
        location="archive" if archived else "active",
        path=rel,
        current_stage="archive" if archived else "brainstorm",
    )
    db_session.add(change)
    await db_session.commit()
    return change


def _seed_mirror(spec_root: Path, *, with_trace: bool = True) -> None:
    """tmp 镜像：fr/decisions 归属条目 + 归档目录三件（patch 刻意缺席）。"""
    fr_dir = spec_root / "knowledge" / "fr"
    dec_dir = spec_root / "knowledge" / "decisions"
    fr_dir.mkdir(parents=True)
    dec_dir.mkdir(parents=True)
    (fr_dir / "auto-test.md").write_text(
        f"# FR\n\n## FR-auto-test-001 金样本条目\n变更：{KEY}\n状态：active\n全文：x#FR-01\n\n"
        "## FR-auto-test-002 他属\n变更：someone-else\n状态：active\n",
        encoding="utf-8",
    )
    (dec_dir / "backend.md").write_text(
        f"# 决策\n\n## D-001@v1 金样本决策\n变更：{KEY}\n理由：z\n\n## D-009@v1 无主\n理由：w\n",
        encoding="utf-8",
    )
    change_dir = spec_root / "changes" / "archive" / KEY
    change_dir.mkdir(parents=True)
    if with_trace:
        (change_dir / "test-trace.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "change": KEY,
                    "rows": [
                        {
                            "row_id": f"{KEY}:task-01:acc-0",
                            "anchor": "FR-01",
                            "tests": ["backend/app/modules/change/tests/test_assets.py"],
                            "reason": "spec",
                            "state": "candidate",
                            "status": "active",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
    (change_dir / "delta.md").write_text(
        f"# 变更 Delta — {KEY}\n\n## Before\n行一\n行二\n\n## Delta\n行三\n",
        encoding="utf-8",
    )


# ===========================================================================
# 聚合服务
# ===========================================================================


async def test_golden_aggregation(db_session, tmp_path: Path) -> None:
    """金样本：fr/决策只收归属条目；trace 行投影；patch 缺席 → None；delta 摘要。"""
    spec_root = tmp_path / "spec-root"
    _seed_mirror(spec_root)
    ws = await _make_ws_spec(db_session, spec_root)
    change = await _make_change(db_session, ws, archived=True)

    result = await ChangeAssetsQueryService(db_session).get_change_assets(ws.id, change.id)
    assert result.change_key == KEY
    assert result.archived is True
    assert [e.id for e in result.fr_entries] == ["FR-auto-test-001"]
    assert result.fr_entries[0].file == "knowledge/fr/auto-test.md"
    assert result.fr_entries[0].status == "active"
    assert [d.id for d in result.decisions] == ["D-001@v1"]
    assert [r.row_id for r in result.test_rows] == [f"{KEY}:task-01:acc-0"]
    assert result.test_rows[0].state == "candidate"
    assert result.patch is None  # 无 change-patch.json → 容错 None
    assert result.delta is not None
    assert result.delta.before_lines == 2
    assert result.delta.delta_lines == 1


async def test_inflight_change_skips_dir_files(db_session, tmp_path: Path) -> None:
    """在途变更（design R-03）：archived=False，目录件不读取（空/None）。"""
    spec_root = tmp_path / "spec-root2"
    _seed_mirror(spec_root)  # 归档目录件在场也应被跳过
    ws = await _make_ws_spec(db_session, spec_root)
    change = await _make_change(db_session, ws, archived=False)

    result = await ChangeAssetsQueryService(db_session).get_change_assets(ws.id, change.id)
    assert result.archived is False
    assert result.test_rows == []
    assert result.patch is None
    assert result.delta is None


async def test_corrupt_json_fail_open(db_session, tmp_path: Path) -> None:
    """损坏 test-trace.json → 空列表（fail-open，Grill 建议用例）。"""
    spec_root = tmp_path / "spec-root3"
    _seed_mirror(spec_root, with_trace=False)
    change_dir = spec_root / "changes" / "archive" / KEY
    change_dir.mkdir(parents=True, exist_ok=True)
    (change_dir / "test-trace.json").write_text("{broken", encoding="utf-8")
    ws = await _make_ws_spec(db_session, spec_root)
    change = await _make_change(db_session, ws, archived=True)

    result = await ChangeAssetsQueryService(db_session).get_change_assets(ws.id, change.id)
    assert result.test_rows == []


async def test_not_found_reraises(db_session, tmp_path: Path) -> None:
    """不存在/跨工作区 → ChangeNotFound（对齐 usage 端点 404 口径）。"""
    spec_root = tmp_path / "spec-root4"
    spec_root.mkdir()
    ws = await _make_ws_spec(db_session, spec_root)
    with pytest.raises(ChangeNotFound):
        await ChangeAssetsQueryService(db_session).get_change_assets(ws.id, uuid.uuid4())


# ===========================================================================
# change.patch 单文件切片（2026-09-25-change-detail-assets-usability / FR-04）
# ===========================================================================


def test_slice_patch_for_file_hits_own_block_only() -> None:
    """命中文件只取自己那一块（不把后一文件的 hunk 带进来）。"""
    sliced = slice_patch_for_file(PATCH_SAMPLE, "src/flow.js")
    assert sliced is not None
    assert sliced.startswith("diff --git a/src/flow.js b/src/flow.js\n")
    assert "+b\n" in sliced
    assert "test/x.test.mjs" not in sliced

    added = slice_patch_for_file(PATCH_SAMPLE, "test/x.test.mjs")
    assert added is not None
    assert added.startswith("diff --git a/test/x.test.mjs b/test/x.test.mjs\n")
    assert "+x\n" in added


def test_slice_patch_for_file_rename_and_quoted_paths() -> None:
    """改名块头两侧路径都算命中；引号包裹路径解引号后命中（含 core.quotePath 八进制形态）。"""
    rename = (
        "diff --git a/src/old-name.js b/src/new-name.js\n"
        "similarity index 90%\n"
        "rename from src/old-name.js\n"
        "rename to src/new-name.js\n"
        "@@ -1 +1 @@\n-a\n+b\n"
    )
    assert slice_patch_for_file(rename, "src/new-name.js") is not None
    assert slice_patch_for_file(rename, "src/old-name.js") is not None

    # 真实 git 输出形态（core.quotePath=true）：非 ASCII 字节按八进制转义输出，
    # 逐字节还原后须与 UTF-8 路径逐字相等——评审 P2 的钉子用例（字面 CJK 样本
    # 真实 git 不会产出，防不住该形态）。
    quoted = (
        'diff --git "a/src/\\346\\234\\211 \\347\\251\\272\\346\\240\\274.js" '
        '"b/src/\\346\\234\\211 \\347\\251\\272\\346\\240\\274.js"\n'
        "@@ -1 +1 @@\n-a\n+b\n"
    )
    assert slice_patch_for_file(quoted, "src/有 空格.js") is not None
    # 转义引号（\"）仍按标准转义还原
    escaped = 'diff --git "a/src/q\\"uote.js" "b/src/q\\"uote.js"\n@@ -1 +1 @@\n-a\n+b\n'
    assert slice_patch_for_file(escaped, 'src/q"uote.js') is not None


def test_slice_patch_for_file_miss_returns_none() -> None:
    """未命中/空 patch → None（调用方转 note，不抛错）。"""
    assert slice_patch_for_file(PATCH_SAMPLE, "src/not-there.js") is None
    assert slice_patch_for_file("", "src/flow.js") is None


def _seed_patch_archive(spec_root: Path, *, patch_text: str | None = PATCH_SAMPLE) -> None:
    """归档目录补 change-patch.json（+ 可选 change.patch）。"""
    change_dir = spec_root / "changes" / "archive" / KEY
    change_dir.mkdir(parents=True, exist_ok=True)
    (change_dir / "change-patch.json").write_text(
        json.dumps(
            {
                "change": KEY,
                "files": ["src/flow.js", "test/x.test.mjs"],
                "totals": {"files": 2, "additions": 2, "deletions": 0},
                "patchStatus": "ok",
                "savedAt": "2026-09-25T06:09:44.456Z",
            }
        ),
        encoding="utf-8",
    )
    if patch_text is not None:
        (change_dir / "change.patch").write_text(patch_text, encoding="utf-8")


async def test_patch_meta_projects_file_list(db_session, tmp_path: Path) -> None:
    """change-patch.json 的 files 清单进 DTO（计数与清单同源同件）。"""
    spec_root = tmp_path / "spec-root5"
    _seed_mirror(spec_root, with_trace=False)
    _seed_patch_archive(spec_root)
    ws = await _make_ws_spec(db_session, spec_root)
    change = await _make_change(db_session, ws, archived=True)

    result = await ChangeAssetsQueryService(db_session).get_change_assets(ws.id, change.id)
    assert result.patch is not None
    assert result.patch.files == 2
    assert result.patch.file_list == ["src/flow.js", "test/x.test.mjs"]
    assert result.patch.files_truncated is False


async def test_patch_meta_file_list_truncates_with_flag(
    db_session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """清单超上限 → 截断 + files_truncated=True（不静默丢数据）。"""
    monkeypatch.setattr(assets_mod, "_PATCH_FILES_MAX", 1)
    spec_root = tmp_path / "spec-root6"
    _seed_mirror(spec_root, with_trace=False)
    _seed_patch_archive(spec_root)
    ws = await _make_ws_spec(db_session, spec_root)
    change = await _make_change(db_session, ws, archived=True)

    result = await ChangeAssetsQueryService(db_session).get_change_assets(ws.id, change.id)
    assert result.patch is not None
    assert result.patch.file_list == ["src/flow.js"]
    assert result.patch.files_truncated is True


async def test_patch_file_diff_hit_and_miss(db_session, tmp_path: Path) -> None:
    """切片端点：命中给 diff；不在 patch 内给 note（不报错）。"""
    spec_root = tmp_path / "spec-root7"
    _seed_mirror(spec_root, with_trace=False)
    _seed_patch_archive(spec_root)
    ws = await _make_ws_spec(db_session, spec_root)
    change = await _make_change(db_session, ws, archived=True)
    service = ChangeAssetsQueryService(db_session)

    hit = await service.get_patch_file_diff(ws.id, change.id, "src/flow.js")
    assert hit.diff is not None and "+b" in hit.diff
    assert hit.note is None and hit.truncated is False

    miss = await service.get_patch_file_diff(ws.id, change.id, "src/not-there.js")
    assert miss.diff is None
    assert miss.note is not None and "不在 change.patch" in miss.note


async def test_patch_file_diff_without_patch_artifact(db_session, tmp_path: Path) -> None:
    """归档无 change.patch（存量归档常态）→ note 说明，不 500。"""
    spec_root = tmp_path / "spec-root8"
    _seed_mirror(spec_root, with_trace=False)
    _seed_patch_archive(spec_root, patch_text=None)
    ws = await _make_ws_spec(db_session, spec_root)
    change = await _make_change(db_session, ws, archived=True)

    result = await ChangeAssetsQueryService(db_session).get_patch_file_diff(
        ws.id, change.id, "src/flow.js"
    )
    assert result.diff is None
    assert result.note is not None and "没有 change.patch" in result.note


async def test_patch_file_diff_truncates_with_flag(
    db_session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """切片超上限 → 截断 + truncated=True。"""
    monkeypatch.setattr(assets_mod, "_PATCH_FILE_MAX_CHARS", 40)
    spec_root = tmp_path / "spec-root9"
    _seed_mirror(spec_root, with_trace=False)
    _seed_patch_archive(spec_root)
    ws = await _make_ws_spec(db_session, spec_root)
    change = await _make_change(db_session, ws, archived=True)

    result = await ChangeAssetsQueryService(db_session).get_patch_file_diff(
        ws.id, change.id, "src/flow.js"
    )
    assert result.diff is not None and len(result.diff) == 40
    assert result.truncated is True


# ===========================================================================
# HTTP 面（路由注册 + 参数校验 + DTO 形状；fixture 范式照 test_files_router）
# ===========================================================================


@pytest.fixture()
async def archived_change_with_patch(client, tmp_path: Path, auth_headers: dict, seed_spec_root_fn):
    """建工作区 → spec_root 落一份带 change.patch 的归档变更 → reparse 取 change id。"""
    root = tmp_path / "http-root"
    root.mkdir()
    resp = await client.post(
        "/api/workspaces",
        json={"name": "assets-http", "type": "other", "root_path": str(root)},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    ws_id = resp.json()["id"]

    empty_spec = tmp_path / "empty-spec"
    empty_spec.mkdir()
    spec_root = Path(seed_spec_root_fn(ws_id, empty_spec))
    (spec_root / "knowledge" / "fr").mkdir(parents=True, exist_ok=True)
    (spec_root / "knowledge" / "fr" / "x.md").write_text(
        f"## FR-http-test-001 归属\n变更：{KEY}\n状态：active\n", encoding="utf-8"
    )
    change_dir = spec_root / "changes" / "archive" / KEY
    change_dir.mkdir(parents=True, exist_ok=True)
    (change_dir / "requirements.md").write_text("# 需求\n", encoding="utf-8")
    _seed_patch_archive(spec_root)

    await client.post(f"/api/workspaces/{ws_id}/changes/reparse", headers=auth_headers)
    list_resp = await client.get(f"/api/workspaces/{ws_id}/changes", headers=auth_headers)
    items = list_resp.json()["items"]
    if not items:  # reparse 首扫偶发空（test_files_router 既定兜底）
        await client.post(f"/api/workspaces/{ws_id}/changes/reparse", headers=auth_headers)
        list_resp = await client.get(f"/api/workspaces/{ws_id}/changes", headers=auth_headers)
        items = list_resp.json()["items"]
    assert items, "reparse 未发现归档变更"
    return {"ws_id": ws_id, "change_id": items[0]["id"]}


async def test_assets_http_lists_files_and_slices_patch(
    client, archived_change_with_patch: dict, auth_headers: dict
) -> None:
    """GET /assets 出 file_list；GET /assets/patch-file 出该文件切片（FR-04 HTTP 面）。"""
    ws_id = archived_change_with_patch["ws_id"]
    cid = archived_change_with_patch["change_id"]

    assets = await client.get(f"/api/workspaces/{ws_id}/changes/{cid}/assets", headers=auth_headers)
    assert assets.status_code == 200, assets.text
    body = assets.json()
    assert body["patch"]["file_list"] == ["src/flow.js", "test/x.test.mjs"]
    assert body["patch"]["files_truncated"] is False

    sliced = await client.get(
        f"/api/workspaces/{ws_id}/changes/{cid}/assets/patch-file",
        params={"path": "src/flow.js"},
        headers=auth_headers,
    )
    assert sliced.status_code == 200, sliced.text
    payload = sliced.json()
    assert payload["path"] == "src/flow.js"
    assert "+b" in payload["diff"]
    assert payload["note"] is None


async def test_patch_file_http_rejects_traversal_422(
    client, archived_change_with_patch: dict, auth_headers: dict
) -> None:
    """路径白名单校验（复用 normalize_scope_file_path）：``..`` / 绝对路径 → 422。"""
    ws_id = archived_change_with_patch["ws_id"]
    cid = archived_change_with_patch["change_id"]
    for bad in ("../secret.txt", "/etc/passwd", ":(glob)**"):
        resp = await client.get(
            f"/api/workspaces/{ws_id}/changes/{cid}/assets/patch-file",
            params={"path": bad},
            headers=auth_headers,
        )
        assert resp.status_code == 422, f"{bad} → {resp.status_code}"


async def test_patch_file_http_unknown_change_404(
    client, archived_change_with_patch: dict, auth_headers: dict
) -> None:
    """跨工作区/不存在 → 404（ChangeNotFound resource-hiding 口径）。"""
    ws_id = archived_change_with_patch["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{uuid.uuid4()}/assets/patch-file",
        params={"path": "src/flow.js"},
        headers=auth_headers,
    )
    assert resp.status_code == 404, resp.text
