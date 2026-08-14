"""Mission 级 SSE 端点（2026-08-06-public-mcp-server task-13 / FR-08 / D-003@v1）。

对外暴露 ``GET /workspaces/<wid>/missions/<mid>/events``，向第三方 MCP 客户端
推该 mission 下 worker run 的状态变更（pending→running→终态），mission 全部
worker 进终态后发 ``done`` 收尾帧。

实现严格复用 ``agent/router.py::stream_agent_run_logs`` 的 SSE 模式，不新发明
流式骨架：
- ``text/event-stream`` + ``StreamingResponse`` + ``_SSE_HEADERS``；
- EventSource 帧格式（``event:`` 行带类型 + ``data:`` 行带 json + 空行分隔）；
- 连接池安全：存在性校验用 ``get_session_factory()`` 短 session（校验完即归还
  slot），事件生成器内部自建独立短 session 做逐次轮询，不在请求级 session 贯穿
  整个流生命周期。

与 ``stream_agent_run_logs``（Redis pub/sub）的差异：mission 没有单一 Redis
channel 聚合其全部 worker run 的状态变更，故本端点采用**逐次轮询**（short poll）
AgentRun 表，按 ``mission_id`` 匹配，检测状态差分发帧。轮询间隔短（默认 2s），
长任务 / 客户端断线不在服务端保订阅状态，由客户端重连重订阅（R-03；重连与事件
补发策略文档在 task-15 ``docs/mcp/sse.md``）。
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import uuid
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.core.auth_deps import require_permission
from app.core.db import get_session_factory
from app.core.logging import get_logger
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission

log = get_logger(__name__)

router = APIRouter(tags=["mcp-mission-events"])

# 与 agent/router.py::stream_agent_run_logs 完全一致的 SSE 响应头。
_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

# run 终态集合（对齐 mission.py 的 _DONE/_FAILED）。
_TERMINAL = {"completed", "failed", "killed"}

# 轮询间隔（秒）。短轮询平衡实时性与 DB 压力；keepalive 帧防代理超时。
_POLL_INTERVAL = 2.0
# 静默多久发一帧 keepalive（秒）。
_KEEPALIVE_AFTER = 25.0


# worker 状态快照（detached，跨短 session 安全传递；不返回 ORM 实例避免懒加载）。
@dataclasses.dataclass(frozen=True)
class _WorkerSnapshot:
    id: uuid.UUID
    status: str
    exit_code: int | None
    error_code: str | None


def _worker_frame(run: _WorkerSnapshot) -> str:
    """构造一帧 worker_status 事件（EventSource 格式：event 行 + data 行 + 空行）。"""
    data = json.dumps(
        {
            "worker_id": str(run.id),
            "status": run.status,
            "exit_code": run.exit_code,
            "error_code": run.error_code,
        }
    )
    return f"event: worker_status\ndata: {data}\n\n"


async def _fetch_worker_runs(mission_id: uuid.UUID) -> list[_WorkerSnapshot]:
    """短 session 查该 mission 的全部 worker runs（按 created_at 排序保证稳定序）。

    每次轮询新建独立短 session，用完即归还连接池 slot——不在整个 SSE 生命周期
    内占用请求级连接。返回 detached 快照，不返回 ORM 实例（避免跨 session 懒加载）。
    """
    async with get_session_factory()() as session:
        stmt = (
            select(AgentRun.id, AgentRun.status, AgentRun.exit_code, AgentRun.error_code)
            .where(AgentRun.mission_id == mission_id)
            .order_by(AgentRun.created_at)
        )
        rows = (await session.execute(stmt)).all()
        return [
            _WorkerSnapshot(
                id=r.id, status=r.status, exit_code=r.exit_code, error_code=r.error_code
            )
            for r in rows
        ]


async def _mission_event_stream(mission_id: uuid.UUID) -> AsyncGenerator[str, None]:
    """逐次轮询 mission 的 worker runs，状态变更逐帧推，全终态发 done 收尾。

    首帧发 ``: connected`` 注释立即冲刷代理缓冲；之后每轮检测到某 worker 状态
    变化即发一帧 ``worker_status``；当全部 worker 进终态时发 ``done`` 帧并结束。
    静默超 ``_KEEPALIVE_AFTER`` 秒发 ``: keepalive`` 注释防连接超时。
    """
    yield ": connected\n\n"

    # 记录每个 worker 上次已推送的状态，差分发帧。
    last_status: dict[uuid.UUID, str] = {}
    silence = 0.0

    while True:
        runs = await _fetch_worker_runs(mission_id)

        # 首轮回放当前所有 worker 的初始状态（让晚接入的客户端拿到全量快照）。
        for run in runs:
            prev = last_status.get(run.id)
            if prev != run.status:
                last_status[run.id] = run.status
                yield _worker_frame(run)
                silence = 0.0

        # 全 worker 进终态 → done 收尾（对齐 stream_agent_run_logs 终态短路 done）。
        # runs 为空（mission 尚无 worker，planning 阶段）不算终态，继续轮询。
        if runs and all(r.status in _TERMINAL for r in runs):
            done_data = json.dumps(
                {
                    "mission_id": str(mission_id),
                    "status": "done",
                    "workers": len(runs),
                }
            )
            yield f"event: done\ndata: {done_data}\n\n"
            return

        await asyncio.sleep(_POLL_INTERVAL)
        silence += _POLL_INTERVAL
        if silence >= _KEEPALIVE_AFTER:
            yield ": keepalive\n\n"
            silence = 0.0


@router.get("/workspaces/{workspace_id}/missions/{mission_id}/events")
async def stream_mission_events(
    workspace_id: uuid.UUID,
    mission_id: uuid.UUID,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> StreamingResponse:
    """SSE endpoint — 推 mission 下 worker run 状态变更（FR-08）。

    连接池安全照搬 stream_agent_run_logs：存在性校验用短 session（校验完即归还
    slot），事件生成器内部自建独立短 session 做逐次轮询，不在请求级 session 贯穿
    整个流生命周期。

    鉴权收紧为 workspace-scoped ``require_permission(Permission.TASK_READ)``
    （security-audit-remediation task-09）：checker 以路径参数 ``workspace_id``
    为 scope，用户必须在**本** workspace 持有 task:read——此前 ``require_permission_any``
    跨 workspace 并集判定放行了只对其它 workspace 有权限的用户（越权读 mission
    worker 状态）。非成员 403（权限拒绝）；mission 存在性 404 逻辑独立不变。
    """
    # 存在性校验：短 session，校验完即归还连接池 slot。
    found = False
    async with get_session_factory()() as session:
        mission = await session.get(AgentMission, mission_id)
        if mission is not None and mission.workspace_id == workspace_id:
            found = True
    if not found:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"mission '{mission_id}' not found in workspace '{workspace_id}'",
        )

    return StreamingResponse(
        _mission_event_stream(mission_id),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )
