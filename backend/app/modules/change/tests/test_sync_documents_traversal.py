"""sync_documents 路径穿越守卫测试（security-audit-remediation task-07）。

双层防御：
- schema 层：DocumentsSyncRequest 键名白名单（单段文件名），非法键 → HTTP 422；
- service 层：resolved.relative_to(root_resolved) 替换 startswith 前缀判断，
  绕过 schema 直调 service 传 ../../evil 形态 → ChangeDocNotFound（HTTP 404）。

对齐同模块 test_files_router.py 的 read/write_file traversal 用例范式。
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest

COMPONENT_FIXTURES = Path(__file__).parent / "fixtures" / "valid"
CHANGE_FIXTURES = Path(__file__).parent / "fixtures" / "changes"


@pytest.fixture()
async def workspace_with_changes(
    client, tmp_path: Path, auth_headers: dict[str, str], seed_spec_root_fn
) -> dict:
    """服务器 spec_root 落 fixtures + reparse，返回 ws_id / change_key / root。"""
    root = _copy_fixtures(COMPONENT_FIXTURES, tmp_path)
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "sync-docs-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]
    spec_root = seed_spec_root_fn(ws_id, COMPONENT_FIXTURES)
    changes_root = Path(spec_root) / "changes"
    changes_root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(CHANGE_FIXTURES, changes_root, dirs_exist_ok=True)
    await client.post(f"/api/workspaces/{ws_id}/changes/reparse", headers=auth_headers)
    list_resp = await client.get(f"/api/workspaces/{ws_id}/changes", headers=auth_headers)
    assert list_resp.status_code == 200
    items = list_resp.json()["items"]
    assert len(items) > 0
    # 显式取 active demo-feature，不用 items[0]：列表顺序不保证（CI 曾把归档变更
    # 排首位），而 sync_documents 恒拼 .sillyspec/changes/{key}/（3 层），归档 key
    # 时 ../../../../ 只落到 root/evil.md（root 内）不触发穿越守卫，用例假失败。
    demo = next((i for i in items if i["change_key"] == "2026-05-25-demo-feature"), None)
    assert demo is not None, f"demo-feature not found; items={[i['change_key'] for i in items]}"
    return {
        "ws_id": ws_id,
        "change_key": demo["change_key"],
        "root": root,
    }


def _copy_fixtures(src: Path, tmp_path: Path, name: str = "ws") -> Path:
    dst = tmp_path / name
    shutil.copytree(src, dst)
    return dst


async def test_sync_documents_normal_filenames(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    """正常单段文件名 → 200 synced 计数正确，文件落在变更目录内。"""
    ws_id = workspace_with_changes["ws_id"]
    change_key = workspace_with_changes["change_key"]
    root = workspace_with_changes["root"]
    resp = await client.post(
        f"/api/workspaces/{ws_id}/changes/{change_key}/documents",
        json={"design.md": "# d", "proposal.md": "# p"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["synced"] == 2
    # 镜像落在 workspace root_path 的 .sillyspec/changes/{key}/ 内
    change_dir = root / ".sillyspec" / "changes" / change_key
    assert (change_dir / "design.md").read_text(encoding="utf-8") == "# d"
    assert (change_dir / "proposal.md").read_text(encoding="utf-8") == "# p"


async def test_sync_documents_traversal_rejected_422(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    """schema 层白名单：路径穿越 / 子目录分隔符 / 绝对路径键 → 422。"""
    ws_id = workspace_with_changes["ws_id"]
    change_key = workspace_with_changes["change_key"]
    root = workspace_with_changes["root"]
    for evil in [
        "../../evil.md",
        "sub/../../escape.md",
        "tasks/task-01.md",
        "/etc/passwd",
        "C:/evil.md",
        "sub\\..\\escape.md",
        ".",
        "..",
        "...",
    ]:
        resp = await client.post(
            f"/api/workspaces/{ws_id}/changes/{change_key}/documents",
            json={evil: "x"},
            headers=auth_headers,
        )
        assert resp.status_code == 422, f"{evil!r} should be rejected: {resp.text}"
    # 拒绝后不落盘任何穿越文件
    assert not (root / ".sillyspec" / "evil.md").exists()
    assert not (root / "escape.md").exists()


async def test_sync_documents_traversal_service_level_404(
    client,
    db_session,
    workspace_with_changes: dict,
) -> None:
    """绕过 schema 直调 service 传 ../../evil → ChangeDocNotFound（HTTP 404 语义）。"""
    from app.core.errors import ChangeDocNotFound
    from app.modules.change.service import ChangeService

    ws_id = uuid.UUID(workspace_with_changes["ws_id"])
    change_key = workspace_with_changes["change_key"]
    root = workspace_with_changes["root"]
    svc = ChangeService(db_session)
    # 变更目录在 {root}/.sillyspec/changes/{key}/，逃出 root 需 4 层 ../；
    # 更浅的 ../ 形态（如 ../../evil.md）只落到 root/.sillyspec/ 内，不算穿越。
    with pytest.raises(ChangeDocNotFound):
        await svc.sync_documents(ws_id, change_key, documents=[("../../../../evil.md", "x")])
    # 绝对路径键：Path 拼接替换整个 relative 段，resolve 后落在 root 外 → 拒绝
    with pytest.raises(ChangeDocNotFound):
        await svc.sync_documents(ws_id, change_key, documents=[("C:/evil-absolute.md", "x")])
    with pytest.raises(ChangeDocNotFound):
        await svc.sync_documents(
            ws_id, change_key, documents=[("sub/../../../../../escape.md", "x")]
        )
    # 拒绝后不落盘任何穿越文件
    assert not (root / ".sillyspec" / "evil.md").exists()
    assert not (root / "escape.md").exists()


async def test_sync_documents_error_message_omits_content(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    """422 错误信息含非法键名，但不回显文件内容。"""
    ws_id = workspace_with_changes["ws_id"]
    change_key = workspace_with_changes["change_key"]
    secret = "SECRET-CONTENT-12345"
    resp = await client.post(
        f"/api/workspaces/{ws_id}/changes/{change_key}/documents",
        json={"../../evil.md": secret},
        headers=auth_headers,
    )
    assert resp.status_code == 422
    assert secret not in resp.text
