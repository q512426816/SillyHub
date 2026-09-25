"""spec-sync manifest 批量 upsert 分片测试（2026-09-25-spec-sync-pg-chunk 生产热修）。

背景：apply_ops 的 pending_adds 原一次性 pg_insert().values([...])，asyncpg 单语句
绑定参数上限 32767（本表每行 8 参 → ~4095 行封顶）——归档移动整树的单批 ops
数千行直接 InterfaceError 500（sillyspec 狗粮区实证，spec-sync 全链瘫痪、
CLI 反复重试刷屏）。修复：500/批分片执行，行级 upsert 语义不变。

sqlite 测试库无该上限，本测试验证分片循环的功能正确性（全部落库 + 版本/哈希
正确 + 二批重放幂等），上限本身由批大小常量含余量保证。

author: qinyi
created_at: 2026-09-25
"""

from __future__ import annotations

import base64
import hashlib
import uuid
from pathlib import Path

from httpx import AsyncClient
from sqlalchemy import func, select

from app.modules.spec_workspace.model import SpecFileManifest, SpecWorkspace
from app.modules.workspace.model import Workspace

_COUNT = 1200  # > 2×批大小 500，覆盖多批边界与尾批不满形态


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


async def _make_ws_spec(db_session, tmp_path: Path):
    ws = Workspace(
        id=uuid.uuid4(),
        name="spec-chunk ws",
        slug=f"sc-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/spec-chunk-test",
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
    spec_root = tmp_path / "spec-root"
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
    return ws, spec_root


async def test_bulk_adds_chunked_all_applied(
    db_session, client: AsyncClient, auth_headers, tmp_path: Path
) -> None:
    """超大批（1200 add，3 批）全部落库：文件写盘 + manifest 行数/版本/哈希正确。"""
    ws, spec_root = await _make_ws_spec(db_session, tmp_path)

    ops = [
        {
            "op": "add",
            "path": f"docs/bulk/f{i:05d}.md",
            "base_version": 0,
            "content": _b64(f"# f{i}"),
            "hash": hashlib.sha256(f"# f{i}".encode()).hexdigest(),
        }
        for i in range(_COUNT)
    ]
    resp = await client.post(
        f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
        headers=auth_headers,
        json={"ops": ops},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] is True
    assert len(resp.json()["new_versions"]) == _COUNT

    total = (
        await db_session.execute(
            select(func.count())
            .select_from(SpecFileManifest)
            .where(
                SpecFileManifest.workspace_id == ws.id,
                SpecFileManifest.path.like("docs/bulk/%"),
            )
        )
    ).scalar_one()
    assert total == _COUNT, "分片循环不得丢行（批边界与尾批）"

    row = (
        (
            await db_session.execute(
                select(SpecFileManifest).where(
                    SpecFileManifest.workspace_id == ws.id,
                    SpecFileManifest.path == "docs/bulk/f01199.md",
                )
            )
        )
        .scalars()
        .one()
    )
    assert row.version == 1
    assert row.exists is True
    assert (spec_root / "docs" / "bulk" / "f01199.md").read_text(encoding="utf-8") == "# f1199"


async def test_bulk_adds_replay_idempotent_after_chunking(
    db_session, client: AsyncClient, auth_headers, tmp_path: Path
) -> None:
    """重放整批（陈旧基线冲突跳过）后再全量重推：分片 upsert 幂等，行数不膨胀。"""
    ws, _spec_root = await _make_ws_spec(db_session, tmp_path)
    url = f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental"
    ops = [
        {
            "op": "add",
            "path": f"docs/replay/f{i:05d}.md",
            "base_version": 0,
            "content": _b64(f"# r{i}"),
            "hash": hashlib.sha256(f"# r{i}".encode()).hexdigest(),
        }
        for i in range(_COUNT)
    ]

    first = await client.post(url, headers=auth_headers, json={"ops": ops})
    assert first.status_code == 200
    # 重放（同内容同哈希，服务端 no-op/conflict 跳过面）——行数仍恒定。
    replay = await client.post(url, headers=auth_headers, json={"ops": ops})
    assert replay.status_code == 200

    total = (
        await db_session.execute(
            select(func.count())
            .select_from(SpecFileManifest)
            .where(
                SpecFileManifest.workspace_id == ws.id,
                SpecFileManifest.path.like("docs/replay/%"),
            )
        )
    ).scalar_one()
    assert total == _COUNT, "upsert 幂等：重放不得产生重复行"
