"""deploy_records service 单测（纯文件解析/聚合，不走 HTTP）。

change 2026-10-14-deploy-release-notes task-02 / FR-02/FR-04：
tmp_path 造假 workspace 目录树，覆盖正常解析 / 多 workspace 聚合倒序 /
invalid 容错（yaml 坏、必填缺失、status 非法）/ 目录缺失静默 / 详情 404。
鉴权与 HTTP 层见 test_router.py。
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
import pytest_asyncio

from app.modules.deploy_records.service import (
    DeployRecordNotFound,
    DeployRecordService,
)
from app.modules.workspace.model import Workspace

# ── 造数 helper ──────────────────────────────────────────────────────

VALID_MD = """---
seq: 2
deployed_at: "2026-10-13 21:30:00"
status: success
commit_from: 8a928588f
commit_to: 8a928588f
summary: 断言面守卫+菜单注册表防漂移
agent: zcode-agent
commits:
  - sha: 8a928588f
    message: "test: menus anchors"
    author: qinyi
---
## 🆕 新增
- 断言面守卫门禁
"""

FAILED_MD = """---
seq: 1
deployed_at: "2026-10-08 15:12:00"
status: failed
commit_from: null
commit_to: c6f6bc50b
summary: backend 镜像瘦身（失败：apt 层 cache-miss）
agent: zcode-agent
commits: []
---
构建失败：apt 层 cache-miss exit 100。
"""

BROKEN_YAML_MD = """---
seq: [unclosed
status: success
---
正文照读。
"""

MISSING_KEYS_MD = """---
seq: 3
status: success
summary: 缺 deployed_at/agent/commits
---
内容不缺但元数据缺字段。
"""

BAD_STATUS_MD = """---
seq: 4
deployed_at: "2026-10-14 08:00:00"
status: ok
summary: status 非法值
agent: zcode-agent
commits: []
---
x
"""

NO_FRONTMATTER_MD = """没有 frontmatter 围栏的裸 md。
"""


def _make_ws_dir(base: Path, name: str, files: dict[str, str]) -> Path:
    root = base / name
    (root / "docs" / "releases").mkdir(parents=True)
    for fname, content in files.items():
        (root / "docs" / "releases" / fname).write_text(content, encoding="utf-8")
    return root


@pytest_asyncio.fixture()
async def two_workspaces(db_session, tmp_path: Path) -> dict:
    """两个 workspace：A 有 3 条记录（含 invalid），B 有 1 条最新记录。"""
    root_a = _make_ws_dir(
        tmp_path,
        "ws_a",
        {
            "2026-10-13-002-8a928588f.md": VALID_MD,
            "2026-10-08-001-c6f6bc50b.md": FAILED_MD,
            "2026-10-13-003-broken.md": BROKEN_YAML_MD,
        },
    )
    root_b = _make_ws_dir(
        tmp_path,
        "ws_b",
        {
            "2026-10-14-003-ad6092e1d.md": VALID_MD.replace("seq: 2", "seq: 3").replace(
                '"2026-10-13 21:30:00"', '"2026-10-14 08:52:36"'
            )
        },
    )
    ws_a = Workspace(
        id=uuid.uuid4(),
        name="ws-a",
        slug=f"ws-a-{uuid.uuid4().hex[:6]}",
        root_path=str(root_a),
        type="other",
    )
    ws_b = Workspace(
        id=uuid.uuid4(),
        name="ws-b",
        slug=f"ws-b-{uuid.uuid4().hex[:6]}",
        root_path=str(root_b),
        type="other",
    )
    db_session.add_all([ws_a, ws_b])
    await db_session.commit()
    return {"ws_a": ws_a, "ws_b": ws_b}


# ── list_records ─────────────────────────────────────────────────────


async def test_list_aggregates_and_sorts_desc(db_session, two_workspaces) -> None:
    """多 workspace 聚合；deployed_at 倒序；invalid 排最后。"""
    svc = DeployRecordService(db_session)
    items = await svc.list_records()
    assert len(items) == 4
    # 最新在前（ws_b 2026-10-14 08:52:36）
    assert items[0].workspace_name == "ws-b"
    assert items[0].seq == 3
    assert items[0].commits_count == 1
    # invalid 排最后
    assert items[-1].status == "invalid"
    assert items[-1].file_name == "2026-10-13-003-broken.md"
    assert items[-1].summary  # 固定中文摘要非空
    assert items[-1].deployed_at is None
    # 中间两条按时间倒序
    assert [i.status for i in items[:3]] == ["success", "success", "failed"]
    assert items[2].seq == 1  # failed 那条
    assert items[2].commit_from is None  # yaml null → None


async def test_list_skips_workspace_without_dir(db_session, db_engine, tmp_path) -> None:
    """目录不存在 / 目录为空 / 非 md 文件 → 静默空（FR-02）。"""
    root_no_dir = tmp_path / "no_dir"
    root_no_dir.mkdir()
    root_empty = tmp_path / "empty_releases"
    (root_empty / "docs" / "releases").mkdir(parents=True)
    root_with_txt = tmp_path / "txt_only"
    (root_with_txt / "docs" / "releases").mkdir(parents=True)
    (root_with_txt / "docs" / "releases" / "notes.txt").write_text("x", encoding="utf-8")

    for i, root in enumerate((root_no_dir, root_empty, root_with_txt)):
        db_session.add(
            Workspace(
                id=uuid.uuid4(),
                name=f"w{i}",
                slug=f"w{i}-{uuid.uuid4().hex[:6]}",
                root_path=str(root),
                type="other",
            )
        )
    await db_session.commit()
    svc = DeployRecordService(db_session)
    assert await svc.list_records() == []


async def test_invalid_variants_tolerated(db_session, tmp_path) -> None:
    """yaml 语法坏 / 必填缺失 / status 非法值 / 无围栏 → 全部 invalid 条目。"""
    root = _make_ws_dir(
        tmp_path,
        "ws_bad",
        {
            "a-broken.md": BROKEN_YAML_MD,
            "b-missing.md": MISSING_KEYS_MD,
            "c-badstatus.md": BAD_STATUS_MD,
            "d-nofence.md": NO_FRONTMATTER_MD,
        },
    )
    ws = Workspace(
        id=uuid.uuid4(),
        name="ws-bad",
        slug=f"ws-bad-{uuid.uuid4().hex[:6]}",
        root_path=str(root),
        type="other",
    )
    db_session.add(ws)
    await db_session.commit()
    svc = DeployRecordService(db_session)
    items = await svc.list_records()
    assert len(items) == 4
    assert all(i.status == "invalid" for i in items)
    # invalid 排序组内按 file_name 倒序
    assert [i.file_name for i in items] == sorted([i.file_name for i in items], reverse=True)


# ── get_record ───────────────────────────────────────────────────────


async def test_get_record_returns_content(db_session, two_workspaces) -> None:
    svc = DeployRecordService(db_session)
    ws_a = two_workspaces["ws_a"]
    rid = f"{ws_a.id}/2026-10-13-002-8a928588f"
    detail = await svc.get_record(rid)
    assert detail.record_id == rid
    assert detail.seq == 2
    assert "断言面守卫门禁" in detail.content
    assert detail.content.startswith("## 🆕")


async def test_get_record_invalid_file_still_readable(db_session, two_workspaces) -> None:
    """invalid 记录详情可读：返回原文（元数据降级）——FR-04。"""
    svc = DeployRecordService(db_session)
    ws_a = two_workspaces["ws_a"]
    detail = await svc.get_record(f"{ws_a.id}/2026-10-13-003-broken")
    assert detail.status == "invalid"
    assert "正文照读" in detail.content


async def test_get_record_not_found_variants(db_session, two_workspaces) -> None:
    svc = DeployRecordService(db_session)
    ws_a = two_workspaces["ws_a"]
    ws_b = two_workspaces["ws_b"]
    with pytest.raises(DeployRecordNotFound):
        await svc.get_record(f"{ws_a.id}/2026-10-13-999-nonexistent")
    # 跨 workspace 文件名不串（ws_b 没有该文件）
    with pytest.raises(DeployRecordNotFound):
        await svc.get_record(f"{ws_b.id}/2026-10-13-002-8a928588f")
    # 非法 record_id 形态（无斜杠 / 非法 UUID 前缀）
    with pytest.raises(DeployRecordNotFound):
        await svc.get_record("no-slash")
    with pytest.raises(DeployRecordNotFound):
        await svc.get_record("not-a-uuid/file.md")
    # 不存在的 workspace
    with pytest.raises(DeployRecordNotFound):
        await svc.get_record(f"{uuid.uuid4()}/whatever")
