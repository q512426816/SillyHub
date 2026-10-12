"""一次性运维脚本：存量 run 变更上下文回填（2026-10-12-backfill-run-change-context）。

背景：2026-10-12-run-level-change-attribution 上线（轮级打锚 + 聚合口径 D-002@v2）
后，存量会话的 run 无 ``change_id`` 锚，变更中心执行用量仍按会话链接摊派显示会话
总和。本脚本按会话重放绑定命令游标，把存量 ``agent_runs.change_id`` 按时间线补齐，
历史数据即按新口径拆分（聚合是实时计算，回填完页面刷新即生效）。

写集（见 backfill_service 模块 docstring）：
  1. ``agent_runs.change_id``：NULL → 游标锚（已锚不动）；
  2. ``agent_sessions.current_change_id``：会话游标终值（仅解析出过命令的会话）。
链接表 / quicklog / 用量数值零触碰；幂等可重跑。

用法（在 backend/ 目录或容器 /app）：

    python scripts/backfill_run_change_context.py                        # dry-run（全工作区）
    python scripts/backfill_run_change_context.py --workspace <uuid> ... # 限定工作区（可多次）
    python scripts/backfill_run_change_context.py --apply                # 落库（单事务）

建议低峰执行；dry-run 与 --apply 计数同口径，先 dry-run 核对再 apply。
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from pathlib import Path

# scripts/ 不是包：直接执行时 sys.path[0] 是 scripts 目录，`import app` 不可达——
# 照 reset_agent_log_attribution.py 先例引导仓库根。
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.modules.change.backfill_service import BackfillStats, ChangeContextBackfillService


def _load_full_model_registry() -> None:
    """导入全部模块 model（含子包，如 agent/profile/model）——脚本只触及
    change/agent 两模块时，ORM 注册表缺 AgentRun FK 指向的远端表
    （llm_providers/agent_profiles/daemon_task_leases/...），flush 的 mapper
    配置会抛 NoReferencedTableError；本地测试不踩（conftest 全量导入）。
    walk_packages 递归容错导入（无 model 子模块的跳过）。"""
    import importlib
    import pkgutil

    import app.modules as _pkg

    for m in pkgutil.walk_packages(_pkg.__path__, prefix="app.modules."):
        if not m.ispkg and m.name.rsplit(".", 1)[-1] == "model":
            try:
                importlib.import_module(m.name)
            except ModuleNotFoundError:
                continue


def _print_stats(title: str, stats: BackfillStats) -> None:
    print(f"  {title}")
    print(
        f"    runs 扫描 {stats.runs_scanned} | 待打锚 {stats.runs_stamped} | "
        f"已锚跳过 {stats.runs_already_anchored}"
    )
    print(
        f"    命令解析 {stats.commands_parsed} | 未知 key 跳过 {stats.commands_skipped_unknown_key} | "
        f"日志解析失败 {stats.logs_parse_failed}"
    )
    if stats.ambiguous_parallel_groups:
        print(
            f"    ⚠️ 批内并列绑定组 {stats.ambiguous_parallel_groups} 个"
            "（同 submit 批次多条不同绑定命令，批内消息序 DB 不可复原，取边近似随机）"
        )
    if stats.unknown_keys:
        print(f"    未知 key：{', '.join(stats.unknown_keys)}")
    if stats.cursor_change_id is not None:
        flag = "已写" if stats.cursor_written else "一致(未动)"
        print(f"    会话游标终值 {stats.cursor_change_id}（{flag}）")


async def _run(apply: bool, workspace_ids: list[uuid.UUID]) -> int:
    engine = create_async_engine(get_settings().database_url)
    try:
        async with engine.connect() as conn:
            try:
                # 单事务：begin() 块正常退出即 commit（--apply）；dry-run 抛
                # _DryRunRollback 触发回滚（库零触碰）。
                async with conn.begin():
                    from sqlalchemy import select
                    from sqlalchemy.ext.asyncio import AsyncSession
                    from sqlmodel import col

                    from app.modules.workspace.model import Workspace

                    db = AsyncSession(conn, expire_on_commit=False)
                    svc = ChangeContextBackfillService(db)
                    targets: list[uuid.UUID]
                    if workspace_ids:
                        targets = workspace_ids
                    else:
                        rows = (await db.execute(select(col(Workspace.id)))).all()
                        targets = [r[0] for r in rows]
                    total = BackfillStats()
                    mode = "APPLY（落库）" if apply else "DRY-RUN（事务回滚，库零触碰）"
                    print(f"=== 存量 run 变更上下文回填 · {mode} · 工作区 {len(targets)} 个 ===")
                    for ws_id in targets:
                        session_ids = await svc.linked_session_ids(ws_id)
                        if not session_ids:
                            continue
                        print(f"[workspace {ws_id}] 链接会话 {len(session_ids)} 个")
                        ws_total = BackfillStats()
                        # 会话级输出（FR-05）：逐会话计数，改数前可审计定位。
                        for sid in session_ids:
                            stats = await svc.backfill_session(sid)
                            if (
                                stats.runs_scanned == 0
                                and stats.commands_parsed == 0
                                and stats.runs_already_anchored == 0
                            ):
                                continue
                            _print_stats(f"session {sid}", stats)
                            ws_total.merge(stats)
                        if ws_total.runs_scanned or ws_total.commands_parsed:
                            _print_stats(f"workspace {ws_id} 小计", ws_total)
                        total.merge(ws_total)
                    print("=== 总计 ===")
                    _print_stats("全部工作区", total)
                    if not apply:
                        raise _DryRunRollback()
            except _DryRunRollback:
                print("dry-run 完成：事务已回滚，数据库零触碰。核对计数后加 --apply 执行。")
    finally:
        await engine.dispose()
    return 0


class _DryRunRollback(Exception):
    """dry-run 控制流：抛出使 begin() 块回滚（不用 rollback() 显式调用以便单路径）。"""


def main() -> int:
    parser = argparse.ArgumentParser(description="存量 run 变更上下文回填（默认 dry-run）")
    parser.add_argument(
        "--apply", action="store_true", help="落库（缺省 dry-run：事务回滚只打印计数）"
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
