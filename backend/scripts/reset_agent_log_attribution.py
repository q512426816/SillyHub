"""一次性运维脚本：agent 日志归属存量清理（从 20260912050000 迁移抽出，2026-09-13 部署裁决）。

背景与授权（与原迁移同源）：2026-09-11-agent-log-attribution-refactor task-05 /
design §Phase 3 / D-004@v2（用户裁决全清）——一次性清空错配时代的归属数据
（ctx 错配 + hub 交叉污染两份实证见 docs/sillyspec/agent-log-ctx-attribution-
mismatch.md 与 agent-log-hub-attribution-cross-session-contamination.md），
正确归属由 CLI 升级（Phase 1 own-only 推送）后重推重建。

为什么从 alembic 链抽出到脚本（部署裁决，三个候选的取舍）：

- ``deploy/docker-compose.yml`` 启动命令 ``alembic upgrade head && exec uvicorn``
  自动前滚——链内破坏性 DML 会在 **CLI 升级前**自动执行（DG-03 设计时序是
  backend 发布 → CLI 升级 → 手动执行清库），清空白做且旧 CLI 旧语义继续上报
  会立刻重建错配数据；且任何 downgrade→upgrade 重放都会把已重建的正确数据
  再清一遍。
- 白名单/stop-revision 不可行：20260912050000 与 20260911220000 是
  5e295549e20f 的兄弟分叉，alembic 无单迁移排除机制，停在任一止点必丢另一
  支及后续全部 schema 迁移。
- 迁移内 env 门控有死结：首次 upgrade 即 stamp 版本，未武装时跳过的 DML
  永不重跑，"稍后手动补跑"路径断裂。

动作（单事务，与原迁移 DML 逐条对齐）：

1. ``UPDATE platform_agent_logs SET agent_session_id = NULL``——行保留
   （探测事实/invocations 计数不动），仅清归属列等重推；
2. ``UPDATE agent_sessions SET deleted_at = <执行时刻> WHERE origin =
   'tool_report' AND deleted_at IS NULL``——旧 ``{harness}|{ctx}`` 聚合键会话
   在新解析下永不再命中，软删防僵尸（R-07 可逆）；时间戳 Python 侧生成绑定
   参数（方言无关，SQLite 无 now()）；
3. ``DELETE FROM change_session_links``——全表清空（无来源列，污染行与合法
   行不可区分，DG-04）；
4. ``DELETE FROM quicklog_session_links``——同上。

用法（在 backend/ 目录）：

    uv run python scripts/reset_agent_log_attribution.py           # dry-run：只打印影响计数
    uv run python scripts/reset_agent_log_attribution.py --apply   # 执行（单事务，前后计数回报）

幂等性：可重复执行；但若 CLI 已重推重建正确归属数据，再跑会把它清掉——按
DG-03 在 CLI 升级完成后、重推开始前执行**一次**即可。downgrade 语义不存在
（数据可由 CLI 重推重建，D-004@v2）。
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import UTC, datetime
from pathlib import Path

# scripts/ 不是包：直接执行（python scripts/x.py / docker exec /app/scripts/x.py）时
# sys.path[0] 是 scripts 目录，`import app` 不可达——照 cleanup_daemon_instances.py 先例
# 引导仓库根（单测经 pytest 路径注入不踩，直接执行必踩）。
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from app.core.config import get_settings

# 影响计数口径：每条 DML 的受影响行数（UPDATE/DELETE rowcount）。
RESET_COUNT_KEYS = (
    "logs_attributed_cleared",
    "tool_report_sessions_soft_deleted",
    "change_session_links_deleted",
    "quicklog_session_links_deleted",
)


async def collect_counts(conn: AsyncConnection) -> dict[str, int]:
    """dry-run 影响面计数——与 apply_reset 的 rowcount 语义严格同口径
    （UPDATE 无 WHERE 段即全表行数：NULL→NULL 的行 PG/SQLite rowcount 同样计入）。"""
    attributed = (
        await conn.execute(sa.text("SELECT COUNT(*) FROM platform_agent_logs"))
    ).scalar_one()
    live_tool_report = (
        await conn.execute(
            sa.text(
                "SELECT COUNT(*) FROM agent_sessions "
                "WHERE origin = 'tool_report' AND deleted_at IS NULL"
            )
        )
    ).scalar_one()
    change_links = (
        await conn.execute(sa.text("SELECT COUNT(*) FROM change_session_links"))
    ).scalar_one()
    quicklog_links = (
        await conn.execute(sa.text("SELECT COUNT(*) FROM quicklog_session_links"))
    ).scalar_one()
    return {
        "logs_attributed_cleared": int(attributed),
        "tool_report_sessions_soft_deleted": int(live_tool_report),
        "change_session_links_deleted": int(change_links),
        "quicklog_session_links_deleted": int(quicklog_links),
    }


async def apply_reset(conn: AsyncConnection) -> dict[str, int]:
    """执行四条 DML，返回各条受影响行数。**不提交**——事务边界归调用方
    （脚本 main 单事务提交；测试可控制在会话事务内断言后自行 commit/rollback）。"""
    logs = (
        await conn.execute(sa.text("UPDATE platform_agent_logs SET agent_session_id = NULL"))
    ).rowcount
    soft_deleted = (
        await conn.execute(
            sa.text(
                "UPDATE agent_sessions SET deleted_at = :ts "
                "WHERE origin = 'tool_report' AND deleted_at IS NULL"
            ).bindparams(ts=datetime.now(UTC))
        )
    ).rowcount
    change_links = (await conn.execute(sa.text("DELETE FROM change_session_links"))).rowcount
    quicklog_links = (await conn.execute(sa.text("DELETE FROM quicklog_session_links"))).rowcount
    return {
        "logs_attributed_cleared": int(logs or 0),
        "tool_report_sessions_soft_deleted": int(soft_deleted or 0),
        "change_session_links_deleted": int(change_links or 0),
        "quicklog_session_links_deleted": int(quicklog_links or 0),
    }


def _print_counts(title: str, counts: dict[str, int]) -> None:
    print(f"{title}:")
    for key in RESET_COUNT_KEYS:
        print(f"  {key}: {counts.get(key, 0)}")


async def main() -> int:
    parser = argparse.ArgumentParser(description="agent 日志归属存量清理（一次性，DG-03 手动执行）")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="实际执行（缺省 dry-run 只打印影响计数，不改任何数据）",
    )
    args = parser.parse_args()

    engine = create_async_engine(get_settings().database_url)
    try:
        async with engine.connect() as conn:
            before = await collect_counts(conn)
            _print_counts(
                "dry-run 影响计数（未改动任何数据）" if not args.apply else "执行前计数", before
            )
            if not args.apply:
                print("\n确认无误后加 --apply 执行（单事务，CLI 升级完成后、重推开始前跑一次）")
                return 0
            counts = await apply_reset(conn)
            await conn.commit()
        _print_counts("已执行（受影响行数）", counts)
        after = None
        async with engine.connect() as conn:
            after = await collect_counts(conn)
            _print_counts("执行后计数（应全为 0）", after)
        return 0 if all(v == 0 for v in after.values()) else 1
    finally:
        await engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
