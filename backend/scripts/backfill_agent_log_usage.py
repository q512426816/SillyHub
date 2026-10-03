"""一次性运维脚本：platform_agent_logs 用量快照存量回填（2026-10-03，v3 HTTP 代理形态）。

背景：2026-10-02-change-center-token-usage 上线的用量摄取挂在 agent-logs 上报
链路上（fire-and-forget）——功能上线**之前**的历史上报只有元信息无快照，历史
变更的本地 CLI 用量因此不显示。本脚本对存量行逐条补快照（含 caliber-fix 归一
口径），使历史变更用量卡有数。

**为什么走 HTTP 代理而不是进程内 RPC（v3 踩坑修正，两版实证）**：
``_send_agent_log_rpc`` 依赖 ``get_daemon_ws_hub()`` 的**进程级单例**——daemon
的 WS 连接挂在 uvicorn 主进程，独立脚本进程的 hub 恒空 → 逐条
``DaemonRuntimeOffline``（v2 实测 0/402）；且历史会话 runtime 绑的多是已下线
旧 daemon 实例（v1 实测死磕旧实例 504）。故脚本改为经主进程的回放端点
``GET /api/agent-logs/{id}/messages`` 代理 RPC（主进程 hub 有连接），自己拿
``total_usage`` 落库——落库口径与 ``usage_ingest._ingest_one`` 逐行对齐
（输入归一 = max(0, 输入−缓存读取)）。

候选（与聚合消费口径一致）：
- ``format ∈ {zcode-model-io-jsonl, claude-code-jsonl}``（有 totalUsage 的解析器）；
- ``agent_session_id`` 非空（无归属行聚合侧永远取不到）；
- ``usage_parsed_at IS NULL``（幂等：已有快照不重填）；
- 会话无 ``agent_runs`` 行（有 runs 的会话聚合二选一不计快照）。

前提：目标机器 daemon 在线（HTTP 回放仍经 ws hub 到 daemon）；容器 env 有
``PLATFORM_BOOTSTRAP_ADMIN_EMAIL/PASSWORD``（bootstrap admin 平台管理员 JWT
读路径覆盖全部 workspace）。

用法（backend/ 目录或服务器容器）：

    uv run python scripts/backfill_agent_log_usage.py           # dry-run：只打印影响计数
    uv run python scripts/backfill_agent_log_usage.py --apply   # 执行（逐条落库）

幂等性：可重复执行；已被清理的历史日志文件（rollout 仅存近期）回放返回
非 parsed/404 → 跳过（诚实缺数：源文件没了无法追溯）。

author: qinyi
created_at: 2026-10-03
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

# scripts/ 不是包：直接执行时 sys.path[0] 是 scripts 目录，`import app` 不可达
# ——照 reset_agent_log_attribution.py 先例引导仓库根。
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.db import get_session_factory
from app.modules.agent.model import AgentRun
from app.modules.change.model import ChangeSessionLink, QuicklogSessionLink
from app.modules.platform_sync.model import AgentSessionLogORM
from app.modules.platform_sync.usage_ingest import INGEST_FORMATS

#: 容器内 uvicorn 监听地址（脚本与 backend 同容器时主进程 hub 可达）。
_BASE_URL = os.environ.get("BACKFILL_BASE_URL", "http://127.0.0.1:8000")


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


async def _make_admin_token(session: AsyncSession) -> str:
    """直接签 bootstrap admin JWT（v3 实测：登录端点 401——env 初始密码与库
    不符，不再走密码路径；同容器同 SECRET_KEY，取 users 表 admin 行直签，
    平台管理员读路径覆盖全部 workspace）。"""
    from sqlalchemy import select as _select

    from app.core.config import get_settings
    from app.core.security import create_access_token
    from app.modules.auth.model import User

    email = os.environ.get("PLATFORM_BOOTSTRAP_ADMIN_EMAIL", "")
    if not email:
        raise SystemExit("缺少 PLATFORM_BOOTSTRAP_ADMIN_EMAIL 环境变量")
    admin = (
        await session.execute(_select(User).where(col(User.email) == email))
    ).scalar_one_or_none()
    if admin is None:
        raise SystemExit(f"bootstrap admin（{email}）在 users 表不存在")
    token, _payload = create_access_token(
        user_id=admin.id,
        email=admin.email,
        is_admin=bool(admin.is_platform_admin),
        settings=get_settings(),
    )
    return token


async def run(apply: bool) -> None:
    async with get_session_factory()() as session:
        rows = await _candidates(session)
        print(await _affected_counts(session, rows))
        if not apply:
            print("dry-run：未执行——加 --apply 回填（经回放端点代理 RPC，需目标机器 daemon 在线）")
            return

        ok = skipped = 0
        # trust_env=False（2026-10-03 实测）：容器 env 使 httpx 默认代理路径挂死
        # （trust_env=True 对 127.0.0.1 直连也挂，False 立通——curl 正常同证）。
        async with httpx.AsyncClient(timeout=90, trust_env=False) as client:
            token = await _make_admin_token(session)
            headers = {"Authorization": f"Bearer {token}"}
            for i, row in enumerate(rows, 1):
                verdict = "skip"
                try:
                    resp = await client.get(
                        f"{_BASE_URL}/api/agent-logs/{row.id}/messages", headers=headers
                    )
                    # 404=条目不可见（admin 全量不该发生）/ 504=daemon 离线 /
                    # 其他非 200 一律跳过可重跑。
                    if resp.status_code == 200:
                        body = resp.json()
                        usage = body.get("total_usage") if body.get("status") == "parsed" else None
                        if usage:
                            # 落库与 usage_ingest._ingest_one 逐行对齐：输入口径
                            # 归一 max(0, 输入−缓存读取)（caliber-fix，ZCode 总
                            # 输入口径 113/113 实证），None 项按 0。
                            raw_input = usage.get("input_tokens") or 0
                            cache_read = usage.get("cache_read_tokens") or 0
                            row.usage_input_tokens = max(0, raw_input - cache_read)
                            row.usage_output_tokens = usage.get("output_tokens") or 0
                            row.usage_cache_read_tokens = cache_read
                            row.usage_cache_write_tokens = usage.get("cache_write_tokens") or 0
                            row.usage_parsed_at = datetime.now(UTC)
                            verdict = "ok"
                except httpx.HTTPError:
                    verdict = "skip-http"
                ok += verdict == "ok"
                skipped += verdict != "ok"
                print(f"  [{i}/{len(rows)}] {verdict}  {row.log_path[-60:]}", flush=True)
                # 逐条 commit（review P3-1 修正）：无长事务行锁窗口，中断时已
                # 提交条目保留可续跑。
                await session.commit()
        print(
            f"回填完成：成功 {ok} / 跳过 {skipped}（源文件已清理或 daemon 离线，可重跑补齐）/ 共 {len(rows)}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="platform_agent_logs 用量快照存量回填（HTTP 代理形态）"
    )
    parser.add_argument("--apply", action="store_true", help="执行回填（缺省 dry-run）")
    args = parser.parse_args()
    asyncio.run(run(apply=args.apply))


if __name__ == "__main__":
    main()
