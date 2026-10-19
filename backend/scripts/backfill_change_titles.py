"""一次性运维脚本：存量变更标题回填（2026-10-16-change-title-condense-backfill）。

背景：变更中心两类烂标题（完整变更=变更名兜底如 ``10-16-fix-auth-random-logout``、
轻量变更=CLI「--input 首行 50 字硬截」长句带尾省略号）病根在 CLI 侧（工具侧另
变更修复增量），存量已入库行由本脚本按 ``title_backfill.TitleBackfillService``
从 ``changes.description``（动机段提取）经 ``condense_title`` 提炼回填——自然标
点截断、约 20 字上限 30。

选中：location IN ('active','archive') 且（title 兜底形态 或 >30 字）且
description 非空；写集只有 ``changes.title``；幂等可重跑（回填后短句 title 不
再命中选中条件）。无 description 的行跳过计数——这类行等 CLI 侧修复后再由
reparse/documents 通道刷新 description 后重跑本脚本即可。

用法（在 backend/ 目录或容器 /app）：

    python scripts/backfill_change_titles.py                        # dry-run（全工作区）
    python scripts/backfill_change_titles.py --workspace <uuid> ... # 限定工作区（可多次）
    python scripts/backfill_change_titles.py --apply                # 落库（单事务）
    python scripts/backfill_change_titles.py --apply --yes          # 全工作区落库确认门

建议低峰执行；dry-run 与 --apply 计数同口径，先 dry-run 核对明细再 apply。
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from pathlib import Path

# scripts/ 不是包：直接执行时 sys.path[0] 是 scripts 目录，`import app` 不可达——
# 照 backfill_run_change_context.py 先例引导仓库根。
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.modules.change.title_backfill import (
    TitleBackfillService,
    TitleBackfillStats,
)


def _load_full_model_registry() -> None:
    """导入全部模块 model（同 backfill_run_change_context.py 先例）——ORM 注册表
    缺远端表时 flush 的 mapper 配置可能抛 NoReferencedTableError；walk_packages
    递归容错导入（无 model 子模块的跳过）。"""
    import importlib
    import pkgutil

    import app.modules as _pkg

    for m in pkgutil.walk_packages(_pkg.__path__, prefix="app.modules."):
        if not m.ispkg and m.name.rsplit(".", 1)[-1] == "model":
            try:
                importlib.import_module(m.name)
            except ModuleNotFoundError:
                continue


def _print_stats(title: str, stats: TitleBackfillStats) -> None:
    print(
        f"  {title}: 扫描 {stats.scanned} | 命中 {stats.selected} | "
        f"回填 {stats.updated} | 无描述跳过 {stats.skipped_no_description} | "
        f"提炼空/同值跳过 {stats.skipped_empty_or_same}"
    )
    for d in stats.details:
        old = (d.old_title or "").replace("\n", " ")
        print(f"    - {d.change_key}\n        旧: {old}\n        新: {d.new_title}")


async def _run(apply: bool, workspace_ids: list[uuid.UUID]) -> int:
    engine = create_async_engine(get_settings().database_url)
    try:
        async with engine.connect() as conn:
            try:
                # 单事务：begin() 块正常退出即 commit（--apply）；dry-run 抛
                # _DryRunRollback 触发回滚（库零触碰）——backfill_run_change_context
                # 先例同款控制流。
                async with conn.begin():
                    from sqlalchemy import select
                    from sqlalchemy.ext.asyncio import AsyncSession

                    from app.modules.workspace.model import Workspace

                    db = AsyncSession(conn, expire_on_commit=False)
                    svc = TitleBackfillService(db)
                    targets: list[uuid.UUID]
                    if workspace_ids:
                        targets = workspace_ids
                    else:
                        rows = (await db.execute(select(Workspace.id))).all()
                        targets = [r[0] for r in rows]
                    total = TitleBackfillStats()
                    mode = "APPLY（落库）" if apply else "DRY-RUN（事务回滚，库零触碰）"
                    print(f"=== 存量变更标题回填 · {mode} · 工作区 {len(targets)} 个 ===")
                    for ws_id in targets:
                        stats = await svc.backfill_workspace(ws_id, apply=apply)
                        if stats.scanned == 0:
                            continue
                        print(f"[workspace {ws_id}]")
                        _print_stats("workspace 小计", stats)
                        total.merge(stats)
                    print("=== 总计 ===")
                    _print_stats("全部工作区", total)
                    if not apply:
                        raise _DryRunRollback()
            except _DryRunRollback:
                print("dry-run 完成：事务已回滚，数据库零触碰。核对明细后加 --apply 执行。")
    finally:
        await engine.dispose()
    return 0


class _DryRunRollback(Exception):
    """dry-run 控制流：抛出使 begin() 块回滚（不用 rollback() 显式调用以便单路径）。"""


def main() -> int:
    parser = argparse.ArgumentParser(description="存量变更标题回填（默认 dry-run）")
    parser.add_argument(
        "--apply", action="store_true", help="落库（缺省 dry-run：事务回滚只打印明细）"
    )
    parser.add_argument(
        "--workspace",
        action="append",
        default=[],
        metavar="UUID",
        help="限定工作区 id（可多次；缺省处理全部工作区）",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="全工作区 --apply 的显式确认门（带 --workspace 的定向 apply 不需要）",
    )
    args = parser.parse_args()
    workspace_ids: list[uuid.UUID] = []
    for raw in args.workspace:
        try:
            workspace_ids.append(uuid.UUID(raw))
        except ValueError:
            print(f"❌ --workspace 不是合法 UUID：{raw}", file=sys.stderr)
            return 2
    if args.apply and not workspace_ids and not args.yes:
        print(
            "❌ 全工作区 --apply 影响面大：确认请加 --yes，或用 --workspace <uuid> 定向执行。",
            file=sys.stderr,
        )
        return 2
    _load_full_model_registry()
    return asyncio.run(_run(apply=args.apply, workspace_ids=workspace_ids))


if __name__ == "__main__":
    raise SystemExit(main())
