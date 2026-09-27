"""治理信号端点（2026-09-27-knowledge-governance-cards 三层治理②层平台出口）。

GET /workspaces/{ws}/knowledge/governance 从已同步 spec 内容根直接计算三类信号
（rot 待复核/收件箱积压/伪域 auto-*），与 CLI 侧 `sillyspec knowledge digest`
同构口径——阈内静默（安静即健康态），超阈逐卡。绑定类信号需仓工作树在场，
留 CLI 侧（平台 spec 树无源码）。
"""

import shutil
import uuid
from pathlib import Path

COMPONENT_FIXTURES = Path(__file__).parent.parent.parent / "change" / "tests" / "fixtures" / "valid"


def _write_fr(root: Path, domain: str, entries: list[dict]) -> None:
    fr_dir = root / "knowledge" / "fr"
    fr_dir.mkdir(parents=True, exist_ok=True)
    lines = ["---", "author: t", "---", "", f"# FR 索引 — {domain}", ""]
    for e in entries:
        lines.append(f"## FR-{domain}-{e['id']:03d} 条目")
        lines.append("状态：active")
        if e.get("review"):
            lines.append(f"待复核：{e['review']}")
        lines.append("")
    (fr_dir / f"{domain}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


async def _mk_ws(client, db_session, tmp_path, auth_headers, prepare) -> dict:
    root = tmp_path / "gov-ws"
    shutil.copytree(COMPONENT_FIXTURES, root)
    (root / "knowledge").mkdir(parents=True, exist_ok=True)
    (root / "knowledge" / "INDEX.md").write_text("# idx\n", encoding="utf-8")
    prepare(root)
    resp = await client.post(
        "/api/workspaces",
        json={"name": f"gov-{uuid.uuid4().hex[:6]}", "root_path": str(root), "type": "other"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    from sqlmodel import select

    from app.modules.spec_workspace.model import SpecWorkspace

    spec_ws = (
        await db_session.execute(
            select(SpecWorkspace).where(SpecWorkspace.workspace_id == uuid.UUID(resp.json()["id"]))
        )
    ).scalar_one()
    spec_ws.spec_root = str(root)
    await db_session.commit()
    return {"ws_id": resp.json()["id"], "root": root}


async def test_governance_healthy(client, db_session, tmp_path, auth_headers) -> None:
    def prepare(root: Path) -> None:
        _write_fr(root, "core", [{"id": 1, "review": "x"}])  # rot 1 < 100
        (root / "knowledge" / "uncategorized.md").write_text(
            "# U\n\n## a\n## b\n", encoding="utf-8"
        )

    ws = await _mk_ws(client, db_session, tmp_path, auth_headers, prepare)
    resp = await client.get(
        f"/api/workspaces/{ws['ws_id']}/knowledge/governance", headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["healthy"] is True
    assert body["signals"] == []
    assert body["totals"]["rot"] == 1
    assert body["totals"]["inbox"] == 2
    assert body["totals"]["pseudo"] == 0


async def test_governance_rot_and_inbox_signals(client, db_session, tmp_path, auth_headers) -> None:
    def prepare(root: Path) -> None:
        _write_fr(root, "cli", [{"id": i, "review": "x"} for i in range(1, 52)])  # 51 条 rot
        _write_fr(root, "runtime", [{"id": i, "review": "x"} for i in range(1, 51)])  # 50 条
        (root / "knowledge" / "uncategorized.md").write_text(
            "# U\n\n" + "\n".join(f"## 条目{i}" for i in range(1, 23)), encoding="utf-8"
        )  # 22 条 > 20

    ws = await _mk_ws(client, db_session, tmp_path, auth_headers, prepare)
    resp = await client.get(
        f"/api/workspaces/{ws['ws_id']}/knowledge/governance", headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["healthy"] is False
    kinds = {s["kind"] for s in body["signals"]}
    assert kinds == {"rot", "inbox"}
    rot = next(s for s in body["signals"] if s["kind"] == "rot")
    assert rot["count"] == 101
    assert "cli 51" in rot["detail"] and "runtime 50" in rot["detail"]
    inbox = next(s for s in body["signals"] if s["kind"] == "inbox")
    assert inbox["count"] == 22
    assert "classify" in inbox["suggestion"]


async def test_governance_pseudo_domain_signal(client, db_session, tmp_path, auth_headers) -> None:
    def prepare(root: Path) -> None:
        _write_fr(root, "auto-backend", [{"id": 1}, {"id": 2}])
        _write_fr(root, "unmapped", [{"id": i} for i in range(1, 4)])  # 大池只进 totals

    ws = await _mk_ws(client, db_session, tmp_path, auth_headers, prepare)
    resp = await client.get(
        f"/api/workspaces/{ws['ws_id']}/knowledge/governance", headers=auth_headers
    )
    body = resp.json()
    assert body["healthy"] is False
    pseudo = next(s for s in body["signals"] if s["kind"] == "pseudo-domain")
    assert pseudo["count"] == 2
    assert "auto-backend 2" in pseudo["detail"]
    assert body["totals"]["unmapped_pool"] == 3  # unmapped 不当警报只进 totals
    assert body["totals"]["pseudo"] == 2


async def test_governance_requires_auth(client, db_session, tmp_path) -> None:
    resp = await client.get(f"/api/workspaces/{uuid.uuid4()}/knowledge/governance")
    assert resp.status_code == 401
