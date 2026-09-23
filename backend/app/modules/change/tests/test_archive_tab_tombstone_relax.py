"""「已归档」tab 三源放宽（archive-tombstone 冤案修复）行为测试。

docs/sillyspec/archive-tombstone-归档墓碑致面板已归档变更软删不可见.md（2026-09-23
change-events-channel 部署验收发现）：CLI 墓碑载荷曾把归档链伪装 'deleted'
（平台 _apply_cli_tombstone 翻 location='deleted' + 镜像软删），且 reparse 对 CLI
工作流失效（D-002@v1 owner_id 守卫，location 停 'active'）——``ChangeService.list_``
的 ``location=='archive'`` 分支放宽为三源并集：

- ① ``location='archive'``（reparse/存量收敛行——不改行为，回归保护）
- ② ``status='archived'``（CLI 终态上行落表；2026-09-23 起 CLI 墓碑终态透传，
  旧冤案行也多已带此值）
- ③ ``location='deleted' AND current_stage IN ('archive','archived')``（旧载荷
  冤案行两代阶段拼写兜底）

排除面：真删除（change-delete 命令）历史 3 例均 brainstorm/scan 期（两仓本地库
2026-09-23 实证）——deleted 且非归档阶段的行保持隐身。
"""

from __future__ import annotations

import uuid

from app.modules.change.model import Change
from app.modules.change.service import ChangeService
from app.modules.workspace.model import Workspace


async def _seed(db_session, **cols) -> Change:
    change = Change(
        id=uuid.uuid4(),
        workspace_id=cols["workspace_id"],
        change_key=cols["change_key"],
        title=cols["change_key"],
        status=cols.get("status", "draft"),
        location=cols["location"],
        path=f"changes/{cols['change_key']}",
        current_stage=cols.get("current_stage"),
    )
    db_session.add(change)
    await db_session.commit()
    return change


async def test_archive_tab_three_source_union(db_session):
    """三源并集：reparse 行 / status=archived 行 / deleted 冤案行全部可见，真删除保持隐身。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"arch-ws-{uuid.uuid4().hex[:6]}",
        slug=f"arch-ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/arch-ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()

    # ① 存量收敛行（reparse 置位）——回归保护：本来就该可见
    r1 = await _seed(
        db_session,
        workspace_id=ws.id,
        change_key="2026-09-01-reparse-row",
        location="archive",
        status="in_progress",
        current_stage="archived",
    )
    # ② CLI 归档终态上行行（location 停 active、status='archived'——D-002@v1 不动 location）
    r2 = await _seed(
        db_session,
        workspace_id=ws.id,
        change_key="2026-09-23-cli-archived",
        location="active",
        status="archived",
        current_stage="archived",
    )
    # ③ 旧墓碑载荷冤案行（deleted + 走完归档阶段，两代拼写各一）
    r3 = await _seed(
        db_session,
        workspace_id=ws.id,
        change_key="2026-09-23-victim-cli-spelling",
        location="deleted",
        status="archived",
        current_stage="archive",
    )
    r4 = await _seed(
        db_session,
        workspace_id=ws.id,
        change_key="2026-09-16-victim-platform-spelling",
        location="deleted",
        status="draft",
        current_stage="archived",
    )
    # 排除：真删除（brainstorm/scan 期废弃——历史 3 例同形态）
    x1 = await _seed(
        db_session,
        workspace_id=ws.id,
        change_key="2026-09-03-genuine-delete",
        location="deleted",
        status="draft",
        current_stage="brainstorm",
    )
    # 排除：活跃行（不属于已归档集合）
    x2 = await _seed(
        db_session,
        workspace_id=ws.id,
        change_key="2026-09-23-active-row",
        location="active",
        status="in_progress",
        current_stage="execute",
    )

    items, total = await ChangeService(db_session).list_(ws.id, location="archive")
    keys = {c.change_key for c in items}
    assert keys == {r1.change_key, r2.change_key, r3.change_key, r4.change_key}, (
        f"已归档集合=三源并集（实际 {sorted(keys)}）"
    )
    assert total == 4, f"total 计三源并集（实际 {total}）"
    assert x1.change_key not in keys and x2.change_key not in keys, "真删除与活跃行不混入"


async def test_active_location_filter_unchanged(db_session):
    """非 archive 的 location 过滤保持精确等值（active tab 不受放宽影响）。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"act-ws-{uuid.uuid4().hex[:6]}",
        slug=f"act-ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/act-ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()

    active = await _seed(
        db_session,
        workspace_id=ws.id,
        change_key="2026-09-23-in-flight",
        location="active",
        status="in_progress",
        current_stage="execute",
    )
    # status='archived' 但 location='active' 的行**不进** active 精确过滤吗？——不：
    # 精确等值分支只看 location，该行 location='active' 照常命中（本测试钉住这一点：
    # 放宽只发生在 archive 分支，active 分支语义不漂移）
    cli_archived = await _seed(
        db_session,
        workspace_id=ws.id,
        change_key="2026-09-23-cli-archived",
        location="active",
        status="archived",
        current_stage="archived",
    )

    items, total = await ChangeService(db_session).list_(ws.id, location="active")
    keys = {c.change_key for c in items}
    assert active.change_key in keys and cli_archived.change_key in keys
    assert total == 2
