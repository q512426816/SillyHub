"""一次性运维脚本：platform_agent_logs 用量快照存量回填（2026-10-03）。

背景：2026-10-02-change-center-token-usage 上线的用量摄取挂在 agent-logs 上报
链路上（fire-and-forget）——功能上线**之前**的历史上报只有元信息无快照，历史
变更的本地 CLI 用量因此不显示（design 当时定的「不做历史回填、由下次上报自然
补齐」口径，用户裁决改为一次性回填）。历史日志文件仍在本地磁盘、daemon 解析
器现成，本脚本对存量行逐条复用摄取链路补快照（含 caliber-fix 口径归一——复用
``AgentLogUsageIngestService._locate_row/_ingest_one``，历史数据直接落新口径）。

候选（与聚合消费口径一致，省无效 RPC）：
- ``format ∈ {zcode-model-io-jsonl, claude-code-jsonl}``（有 totalUsage 的解析器）；
- ``agent_session_id`` 非空（无归属行聚合侧永远取不到）；
- ``usage_parsed_at IS NULL``（幂等：已有快照不重摄）；
- 会话无 ``agent_runs`` 行（有 runs 的会话聚合二选一不计快照，回填无收益）。

前提：目标机器 daemon 在线（RPC 解析经 ws hub 定位；离线条目按既有降级跳过，
可重跑补齐）。

用法（backend/ 目录或服务器容器）：

    uv run python scripts/backfill_agent_log_usage.py           # dry-run：只打印影响计数
    uv run python scripts/backfill_agent_log_usage.py --apply   # 执行（逐条落库，末尾一次 commit）

幂等性：可重复执行——已有快照的行被候选条件排除；上次离线/失败的行下次重跑
再试。轮次恒无来源不涉及；回填不触碰元信息列（只写 usage_* 五列）。

author: qinyi
created_at: 2026-10-03
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# scripts/ 不是包：直接执行时 sys.path[0] 是 scripts 目录，`import app` 不可达
# ——照 reset_agent_log_attribution.py 先例引导仓库根。
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session_factory
from app.modules.agent.model import AgentRun
from app.modules.change.model import ChangeSessionLink, QuicklogSessionLink
from app.modules.platform_sync.model import AgentSessionLogORM
from app.modules.platform_sync.usage_ingest import INGEST_FORMATS, AgentLogUsageIngestService


async def _candidates(session: AsyncSession) -> list[AgentSessionLogORM]:
    """回填候选行（口径见模块 docstring；按 log_path 排序输出稳定）。"""
    return list(
        (
            await session.execute(
                select(AgentSessionLogORM)
                .where(
                    AgentSessionLogORM.format.in_(sorted(INGEST_FORMATS)),
                    AgentSessionLogORM.agent_session_id.is_not(None),
                    AgentSessionLogORM.usage_parsed_at.is_(None),
                    ~exists().where(
                        # 与 usage_service._local_no_runs_condition 同式（会话级
                        # 二选一：run 权威，有 runs 的会话快照聚合不消费）。
                        AgentRun.agent_session_id == AgentSessionLogORM.agent_session_id
                    ),
                )
                .order_by(AgentSessionLogORM.log_path)
            )
        )
        .scalars()
        .all()
    )


async def _affected_counts(session: AsyncSession, rows: list[AgentSessionLogORM]) -> str:
    """dry-run/apply 共用的回报文本：条目数 + 覆盖变更/快速修复数。"""
    if not rows:
        return "候选 0 条"
    session_ids = [r.agent_session_id for r in rows]
    changes = (
        await session.execute(
            select(func.count(func.distinct(ChangeSessionLink.change_id))).where(
                ChangeSessionLink.session_id.in_(session_ids)
            )
        )
    ).scalar_one()
    quicklogs = (
        await session.execute(
            select(func.count(func.distinct(QuicklogSessionLink.ql_id))).where(
                QuicklogSessionLink.session_id.in_(session_ids)
            )
        )
    ).scalar_one()
    return f"候选 {len(rows)} 条（覆盖 {changes} 个变更、{quicklogs} 个快速修复）"


async def run(apply: bool) -> None:
    async with get_session_factory()() as session:
        rows = await _candidates(session)
        print(await _affected_counts(session, rows))
        if not apply:
            print(
                "dry-run：未执行——加 --apply 回填（逐条 daemon RPC 解析，需目标机器 daemon 在线）"
            )
            return

        svc = AgentLogUsageIngestService(session)
        ok = skipped = 0
        for i, row in enumerate(rows, 1):
            daemon_id = await svc._locate_row(row)
            if daemon_id is None:
                skipped += 1
            elif await svc._ingest_one(row, daemon_id):
                ok += 1
            else:
                skipped += 1
            # 逐条 commit（review P3-1 修正）：RPC 在事务外（_ingest_one 不碰
            # session IO），commit 只 flush 单行 UPDATE——无长事务行锁窗口，
            # 与在线摄取并发更新同行互不阻塞；中断时已提交条目保留可续跑。
            await session.commit()
            if i % 50 == 0:
                print(f"  进度 {i}/{len(rows)}（成功 {ok} / 跳过 {skipped}）")
        print(
            f"回填完成：成功 {ok} / 跳过 {skipped}（离线或解析不支持，可重跑补齐）/ 共 {len(rows)}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="platform_agent_logs 用量快照存量回填")
    parser.add_argument("--apply", action="store_true", help="执行回填（缺省 dry-run）")
    args = parser.parse_args()
    asyncio.run(run(apply=args.apply))


if __name__ == "__main__":
    main()
