"""quicklog pushed 行 apply 期对账（软隐藏 hidden）守护测试。

Change 2026-08-29-change-delete-closure-and-spec-pull task-05（design §5.3 /
FR-03b）：

- ① apply_ops 落含 ``quicklog/`` 前缀路径的 ops 并提交后，重解析镜像 quicklog/
  目录对账：文件集合中缺失 ql_id 的 pushed 行 ``hidden=True``（本地已删条目软
  隐藏，推送留底可回滚）；文件仍存在的 ql_id 行不受影响（apply 时点文件刚落
  镜像，无文件同步滞后误杀）；
- ② 文件重现（被隐藏条目重新写回文件）→ 对账回翻 ``hidden=False``（软隐藏
  可回滚）；
- ③ ops 不含 quicklog/ 路径 → 对账零触发（不解析目录、不改任何 pushed 行——
  即使存在「文件缺失」的行也不隐藏，R-03 零额外查询）；
- ④ 对账异常（重解析抛错）仅告警，apply_ops 正常返回 new_versions/conflict
  （best-effort，对齐 reparse 触发容错范式）。

直接调 service 级 apply_ops（对齐 test_platform_deleted_guard.py 范式），断言
真实磁盘文件 + QuicklogEntryORM 行状态。

author: qinyi
created_at: 2026-08-29
"""

from __future__ import annotations

import base64
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.spec_workspace.service as spec_workspace_service
from app.modules.platform_sync.model import QuicklogEntryORM
from app.modules.spec_workspace.schema import FileOp
from app.modules.spec_workspace.service import SpecWorkspaceService
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Helpers（对齐 test_platform_deleted_guard.py 范式）
# ---------------------------------------------------------------------------


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _op(op: str, path: str, base_version: int = 0, **extra: object) -> FileOp:
    return FileOp(op=op, path=path, base_version=base_version, **extra)  # type: ignore[arg-type]


async def _make_workspace(db_session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="quicklog-reconcile ws",
        slug=f"qlrec-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/quicklog-reconcile-test",
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_spec_root(db_session: AsyncSession, workspace: Workspace, spec_root: Path) -> None:
    from app.modules.spec_workspace.model import SpecWorkspace

    db_session.add(
        SpecWorkspace(
            id=uuid.uuid4(),
            workspace_id=workspace.id,
            spec_root=str(spec_root),
            strategy="platform-managed",
            sync_status="clean",
        )
    )
    await db_session.commit()


def _quicklog_file_text(*entries: tuple[str, str]) -> str:
    """构造 QUICKLOG-*.md 内容（每条目 (ql_id, title)，状态已完成）。"""
    return "".join(
        f"## {ql_id} | 2026-08-29 10:00:00 | {title}\n状态：已完成\n" for ql_id, title in entries
    )


async def _add_pushed(db_session: AsyncSession, ws_id: uuid.UUID, ql_id: str, title: str) -> None:
    db_session.add(
        QuicklogEntryORM(
            workspace_id=ws_id,
            ql_id=ql_id,
            payload={"ql_id": ql_id, "title": title, "status": "completed"},
        )
    )
    await db_session.commit()


async def _pushed_rows(db_session: AsyncSession, ws_id: uuid.UUID) -> dict[str, QuicklogEntryORM]:
    return {
        r.ql_id: r
        for r in (
            (
                await db_session.execute(
                    select(QuicklogEntryORM).where(QuicklogEntryORM.workspace_id == ws_id)
                )
            )
            .scalars()
            .all()
        )
    }


# ===========================================================================
# ① apply 期对账：文件删条目 → hidden；文件仍存在条目不受影响
# ===========================================================================


class TestApplyQuicklogReconcile:
    async def test_quicklog_op_hides_pushed_rows_missing_from_files(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """quicklog 文件 op 落盘后对账：文件集合缺失 ql_id 的 pushed 行 hidden=True；
        文件仍存在的 ql_id 行不隐藏（不误杀）。行不物理删（软隐藏留底）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_root(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)
        ql_path = "quicklog/QUICKLOG-qinyi.md"

        # 基线：文件同时含 A/B 落镜像（mtime=1000，对账 A/B 均在文件集合 → 零隐藏）
        await _add_pushed(db_session, ws.id, "ql-20260829-001-aaaa", "条目A")
        await _add_pushed(db_session, ws.id, "ql-20260829-002-bbbb", "条目B")
        result = await svc.apply_ops(
            ws.id,
            [
                _op(
                    "add",
                    ql_path,
                    mtime=1000.0,
                    content=_b64(
                        _quicklog_file_text(
                            ("ql-20260829-001-aaaa", "条目A"),
                            ("ql-20260829-002-bbbb", "条目B"),
                        )
                    ),
                )
            ],
        )
        assert result["conflict"] is False, result
        rows = await _pushed_rows(db_session, ws.id)
        assert rows["ql-20260829-001-aaaa"].hidden is False
        assert rows["ql-20260829-002-bbbb"].hidden is False

        # 本地删除条目 B：文件重写仅含 A（mtime=2000 换指纹缓存）→ 对账隐藏 B
        result = await svc.apply_ops(
            ws.id,
            [
                _op(
                    "update",
                    ql_path,
                    base_version=1,
                    mtime=2000.0,
                    content=_b64(_quicklog_file_text(("ql-20260829-001-aaaa", "条目A"))),
                )
            ],
        )
        assert result["conflict"] is False, result
        rows = await _pushed_rows(db_session, ws.id)
        # 文件仍存在的条目不受影响（apply 时点文件刚落镜像，无滞后误杀）
        assert rows["ql-20260829-001-aaaa"].hidden is False
        # 文件缺失的 pushed 行软隐藏（行仍在——不物理删，design §15 Non-Goal）
        assert rows["ql-20260829-002-bbbb"].hidden is True
        assert rows["ql-20260829-002-bbbb"].payload is not None

    async def test_quicklog_delete_last_file_hides_all_pushed_rows(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """quicklog 文件整删（目录被空目录清理移除）→ 重解析得空集合 → 全部
        pushed 行 hidden=True（FR-03b 本地清理收敛）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_root(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)
        ql_path = "quicklog/QUICKLOG-qinyi.md"
        await _add_pushed(db_session, ws.id, "ql-20260829-010-cccc", "唯一条目")
        await svc.apply_ops(
            ws.id,
            [
                _op(
                    "add",
                    ql_path,
                    mtime=1000.0,
                    content=_b64(_quicklog_file_text(("ql-20260829-010-cccc", "唯一条目"))),
                )
            ],
        )
        result = await svc.apply_ops(ws.id, [_op("delete", ql_path, base_version=1)])
        assert result["conflict"] is False, result
        # delete op 本身含 quicklog/ 前缀 → 触发对账；目录已清 → 文件集合为空
        rows = await _pushed_rows(db_session, ws.id)
        assert rows["ql-20260829-010-cccc"].hidden is True

    async def test_hidden_row_restored_when_entry_reappears_in_file(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """文件重现 → 对账回翻 hidden=False（软隐藏可回滚）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_root(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)
        ql_path = "quicklog/QUICKLOG-qinyi.md"
        await _add_pushed(db_session, ws.id, "ql-20260829-020-dddd", "回翻条目")

        # 第一拍：文件不含该条目 → 隐藏
        await svc.apply_ops(
            ws.id,
            [
                _op(
                    "add",
                    ql_path,
                    mtime=1000.0,
                    content=_b64(_quicklog_file_text(("ql-20260829-021-eeee", "别的条目"))),
                )
            ],
        )
        rows = await _pushed_rows(db_session, ws.id)
        assert rows["ql-20260829-020-dddd"].hidden is True

        # 第二拍：条目重新写回文件 → 回翻
        await svc.apply_ops(
            ws.id,
            [
                _op(
                    "update",
                    ql_path,
                    base_version=1,
                    mtime=2000.0,
                    content=_b64(
                        _quicklog_file_text(
                            ("ql-20260829-020-dddd", "回翻条目"),
                            ("ql-20260829-021-eeee", "别的条目"),
                        )
                    ),
                )
            ],
        )
        rows = await _pushed_rows(db_session, ws.id)
        assert rows["ql-20260829-020-dddd"].hidden is False


# ===========================================================================
# ② 零触发：ops 不含 quicklog/ 路径时不做对账（R-03 零额外查询/目录解析）
# ===========================================================================


class TestZeroTriggerWithoutQuicklogOps:
    async def test_non_quicklog_ops_leave_pushed_rows_untouched(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """ops 不含 quicklog/ → 对账零触发：即使存在「文件缺失」的 pushed 行也
        不隐藏（区别于对账执行的误杀回归锚）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_root(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)
        await _add_pushed(db_session, ws.id, "ql-20260829-030-ffff", "文件缺失条目")
        # 镜像 quicklog/ 目录存在且不含该条目——若对账误触发则会隐藏
        (spec_root / "quicklog").mkdir(parents=True)
        (spec_root / "quicklog" / "QUICKLOG-qinyi.md").write_text(
            _quicklog_file_text(("ql-20260829-031-gggg", "文件条目")), encoding="utf-8"
        )

        result = await svc.apply_ops(
            ws.id, [_op("add", "docs/other.md", content=_b64("# 无关文件"))]
        )
        assert result["conflict"] is False, result

        rows = await _pushed_rows(db_session, ws.id)
        assert rows["ql-20260829-030-ffff"].hidden is False


# ===========================================================================
# ③ 容错：对账异常不阻断 apply_ops 主流程（best-effort）
# ===========================================================================


class TestReconcileFailureTolerance:
    async def test_reconcile_exception_does_not_block_apply(
        self, db_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """重解析抛错 → apply_ops 正常返回（new_versions 照常、文件已落盘）。"""

        def _boom(_dir: Path) -> list[object]:
            raise RuntimeError("对账重解析炸了（测试注入）")

        monkeypatch.setattr(spec_workspace_service, "parse_quicklog_directory", _boom)

        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_root(db_session, ws, spec_root)
        svc = SpecWorkspaceService(db_session)
        await _add_pushed(db_session, ws.id, "ql-20260829-040-hhhh", "容错条目")

        result = await svc.apply_ops(
            ws.id,
            [
                _op(
                    "add",
                    "quicklog/QUICKLOG-qinyi.md",
                    content=_b64(_quicklog_file_text(("ql-20260829-040-hhhh", "容错条目"))),
                )
            ],
        )
        # best-effort：异常仅告警，同步主流程结果不受影响
        assert result["conflict"] is False
        assert result["new_versions"] == {"quicklog/QUICKLOG-qinyi.md": 1}
        assert (spec_root / "quicklog" / "QUICKLOG-qinyi.md").exists()
        rows = await _pushed_rows(db_session, ws.id)
        assert rows["ql-20260829-040-hhhh"].hidden is False


# Suppress unused-import warning for pytest (fixture discovery).
pytestmark = pytest.mark.asyncio
