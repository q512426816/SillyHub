"""FastAPI application entrypoint."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession

from app import __version__
from app.core.audit_hooks import register_audit_hooks
from app.core.config import get_settings
from app.core.db import dispose_engine
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.core.monitoring import (
    slow_request_middleware,
    start_event_loop_watchdog,
    stop_event_loop_watchdog,
)
from app.core.redis import close_redis
from app.core.telemetry import init_telemetry
from app.modules.admin.router import router as admin_router
from app.modules.agent.profile.router import router as agent_profile_router
from app.modules.agent.router import router as agent_router
from app.modules.auth.router import router as auth_router
from app.modules.change import change_router
from app.modules.change_writer.router import router as change_writer_router
from app.modules.daemon.dist_router import router as daemon_dist_router
from app.modules.daemon.router import router as daemon_router
from app.modules.git_gateway.router import router as git_gateway_router
from app.modules.git_identity import git_identity_router
from app.modules.health import health_router
from app.modules.incident.router import router as incident_router
from app.modules.knowledge.router import router as knowledge_router
from app.modules.llm_provider.router import router as llm_provider_router
from app.modules.mcp_gateway.router import router as mcp_gateway_router

# 2026-08-06-public-mcp-server task-05：对外 MCP server（FastMCP streamable HTTP）。
# 导入 mcp 实例仅为在 lifespan 里驱动其 session_manager（坑 2）；mount 装配在
# create_app() 末尾调 mount_mcp(app)。写法严格对齐 task-04 spike-A 验证版本。
from app.modules.mcp_gateway.server import mcp, mount_mcp
from app.modules.mcp_gateway.sse import router as mcp_sse_router

# 2026-08-10-sillyhub-platform-sync task-06：SillySpec 进度同步层 3 端点。
from app.modules.platform_sync.router import router as platform_sync_router

# 2026-08-11-change-progress-projection task-07：workspace-scoped token 签发 2 端点
# （POST /workspaces/{wid}/platform-sync-tokens / POST /workspaces/resolve-by-root-path）。
from app.modules.platform_sync.workspace_router import router as platform_sync_workspace_router
from app.modules.ppm.kanban.router import router as ppm_kanban_router
from app.modules.ppm.plan.router import router as ppm_plan_router
from app.modules.ppm.problem.router import router as ppm_problem_router
from app.modules.ppm.project.router import router as ppm_project_router
from app.modules.ppm.task.router import router as ppm_task_router
from app.modules.ppm.workbench.router import router as ppm_workbench_router
from app.modules.release.router import router as release_router
from app.modules.runtime.router import router as runtime_router
from app.modules.scan_docs.router import router as scan_docs_router
from app.modules.settings.router import router as settings_router
from app.modules.skills.router import router as skills_router
from app.modules.spec_workspace.router import router as spec_workspace_router
from app.modules.task import task_router
from app.modules.tool_gateway.policy_router import router as policy_crud_router
from app.modules.tool_gateway.router import router as tool_gateway_router
from app.modules.workflow.router import router as workflow_router
from app.modules.workspace import workspace_router
from app.modules.workspace.link_router import router as ppm_project_link_router
from app.modules.workspace.member_runtimes.router import (
    router as member_runtimes_router,
)
from app.modules.workspace.members_router import router as members_router
from app.modules.worktree import lease_router, worktree_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)
    init_telemetry(settings)
    log = get_logger(__name__)
    log.info(
        "app.start",
        version=__version__,
        environment=settings.environment,
        commit=settings.resolved_commit_sha,
    )
    # 启动事件循环堵塞看门狗（后台协程，每 100ms 自检）
    watchdog_task = start_event_loop_watchdog()
    log.info("monitoring.watchdog_started")
    try:
        # Bootstrap auth once the DB connection pool exists.
        from app.core.db import get_engine, get_session_factory
        from app.modules.agent.service import AgentService
        from app.modules.auth.service import bootstrap_admin_and_seed_rbac

        # 2026-08-14-audit-system-completion task-02（漂移点 #1 修复）：
        # 挂载自动审计钩子——lifespan 时点所有 router 已 import，mappers 已配置，
        # register_audit_hooks 遍历 BaseModel 子类挂 after_insert/update/delete。
        # 幂等由内部 event.contains 保证（多次 create_app 安全）。
        register_audit_hooks(get_engine())

        factory = get_session_factory()
        async with factory() as session:
            await bootstrap_admin_and_seed_rbac(session, settings=settings)
            try:
                stale_count = await AgentService(session).cleanup_stale_runs()
                if stale_count:
                    log.warning("agent.stale_runs_cleaned_on_startup", count=stale_count)
            except Exception:
                log.exception("agent.stale_run_cleanup_failed")
            # task-10 / design §5.5 / M3：重启兜底——扫孤儿 gate 任务重置 pending +
            # 重 enqueue（挂 lifespan startup，非 per-dispatch）。异常不阻断启动
            # （对齐上方 cleanup_stale_runs 的 try/except log.exception 模式）。
            try:
                from app.modules.change.dispatch import SillySpecStageDispatchService

                gate_result = await SillySpecStageDispatchService(
                    session
                ).reconcile_pending_gate_decisions(session)
                if gate_result["orphan_count"]:
                    log.warning("gate.reconcile_reenqueued", **gate_result)
            except Exception:
                log.exception("gate.reconcile_failed")
            # 2026-08-02-agent-profile-layer task-11 / D-015：启动 idempotent
            # 补种平台默认 AgentProfile（claude/codex）。迁移 task-01 覆盖新环境
            # 首次 seed；本 hook 覆盖「默认档案被误删后重启」场景，按
            # is_system_default + provider 去重补回，不覆盖用户改动。异常不阻断
            # 启动（对齐上方 cleanup_stale_runs / gate reconcile 模式）。
            try:
                from app.modules.agent.profile.seed import (
                    ensure_role_template_profiles,
                    ensure_system_default_profiles,
                )

                seeded = await ensure_system_default_profiles(session)
                if seeded:
                    log.warning("agent.profile.system_default_reseeded", count=seeded)

                # quick-2026-08-14 (ql-20260814-001)：角色模板已全部下线（CC/GLM 均移除），
                # ensure 仅回收废弃残留（GLM×5 + CC×5），不再补种。异常不阻断启动。
                role_seeded, role_pruned = await ensure_role_template_profiles(session)
                if role_seeded:
                    log.warning("agent.profile.role_template_reseeded", count=role_seeded)
                if role_pruned:
                    log.warning("agent.profile.role_template_pruned", count=role_pruned)
            except Exception:
                log.exception("agent.profile.seed_failed")
        # 平台文件中心：初始化对象存储单例（minio 等 S3 兼容）。异常不阻断启动——
        # 存储后端暂不可达时文件上传在请求期报错，其余功能不受影响（D-001/D-002）。
        try:
            from app.modules.storage.factory import init_storage_backend

            init_storage_backend(settings)
        except Exception:
            log.exception("storage.init_failed")
        # 2026-08-06-public-mcp-server task-05 / spike-A 坑 2（P0）：MCP session
        # manager 必须在 app 服务期间常驻。streamable_http_app() 返回的子 app
        # 虽自带 lifespan=lambda app: self.session_manager.run()，但 Starlette
        # 的 Mount 不会自动跑子 app lifespan —— 必须在父 FastAPI lifespan 里
        # 手动 ``async with mcp.session_manager.run(): yield``，否则 streamable
        # HTTP session 不初始化，client initialize 会挂死到 timeout。合并到现有
        # lifespan（不覆盖上方 bootstrap / 下方 shutdown 逻辑）。
        async with mcp.session_manager.run():
            yield
    finally:
        log.info("app.shutdown")
        # 停止事件循环堵塞看门狗
        stop_event_loop_watchdog(watchdog_task)
        try:
            from app.modules.storage.factory import get_storage_backend

            await get_storage_backend().aclose()
        except Exception:
            log.exception("storage.close_failed")
        await dispose_engine()
        await close_redis()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Multi-Agent Platform API",
        version=__version__,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-request-id"],
    )

    @app.middleware("http")
    async def request_id_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        rid = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = rid
        response: Response = await call_next(request)
        response.headers["x-request-id"] = rid
        return response

    # 慢请求监控中间件（>1s 打 slow.request 日志，复用 request_id）
    @app.middleware("http")
    async def monitoring_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        return await slow_request_middleware(request, call_next)

    register_exception_handlers(app)

    # ── Quick Chat (fixed path, before parameterized routes) ────────────────

    def _register_quick_chat(app: FastAPI) -> None:
        """Register the /api/daemon-chat endpoint with its own router."""
        from fastapi import APIRouter, Depends, Query

        from app.core.auth_deps import require_permission_any
        from app.core.db import get_session
        from app.modules.auth.model import User
        from app.modules.auth.permissions import Permission

        qc_router = APIRouter()

        def _quick_chat_lease_owner(lease_metadata: object) -> str | None:
            """task-08（security-audit-remediation D-005@v1）：从 lease metadata
            提归属者。

            raw text() SELECT 下 JSON 列的返回形态因后端而异：PostgreSQL
            (asyncpg) 返回 dict；SQLite (aiosqlite) 返回 JSON 字符串。统一解析后
            取 ``actor_user_id``（task-08 起由 placement.dispatch_to_daemon 写入）。
            缺键 / 非法形态 → None（调用方按不匹配处理 → 404，存量 run 兼容
            策略：统一 404，未上线可接受）。
            """
            meta = lease_metadata
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except (TypeError, ValueError):
                    return None
            if not isinstance(meta, dict):
                return None
            actor = meta.get("actor_user_id")
            return actor if isinstance(actor, str) else None

        async def _assert_quick_chat_run_owner(
            session: AsyncSession,
            run_id: uuid.UUID,
            user_id: uuid.UUID,
            *,
            extra_cols: tuple[str, ...] = (),
        ) -> dict:
            """task-08（D-005@v1 / D-001@v1）：quick-chat run 归属校验 + 行读取。

            归属链：``agent_runs ← daemon_task_leases.agent_run_id → lease
            metadata.actor_user_id``。与当前 user.id 比对，run 不存在 / 无 lease
            链 / 归属不匹配 / metadata 缺 actor_user_id 统一 404（与不存在同
            语义，不泄存在性）。

            Note: D-005 字面的 ``agent_runs.lease_id`` 锚点不可实现——该列 FK
            指向 worktree_leases（service.py:1729 注释明确禁止写 daemon lease
            id），故走 lease.agent_run_id 反向链（lease INSERT 即携带，无需回填
            UPDATE）。

            raw text() 绑定统一用 ``.hex``：ORM Uuid 列在 SQLite 以 CHAR(32)
            hex 落库（PG 为 Uuid 对象），PG Uuid 列同样接受 hex 形式（对齐
            placement.py 范式）。

            Returns:
                归属校验通过的 agent_runs 行（id/status + ``extra_cols`` 指定列）。
                id 归一为带连字符 str（SQLite raw SELECT 返回 CHAR(32) hex，
                PG 返回 UUID 对象，统一 str(uuid) 保持响应契约一致）。
            """
            from fastapi import HTTPException
            from sqlalchemy import text as sa_text

            cols = ", ".join(("r.id", "r.status", *(f"r.{c}" for c in extra_cols)))
            row = (
                (
                    await session.execute(
                        sa_text(
                            f"SELECT {cols}, l.metadata AS lease_metadata "
                            "FROM agent_runs r "
                            "JOIN daemon_task_leases l ON l.agent_run_id = r.id "
                            "WHERE r.id = :id AND r.spec_strategy = 'quick-chat'"
                        ),
                        {"id": run_id.hex},
                    )
                )
                .mappings()
                .first()
            )
            if row is None or _quick_chat_lease_owner(row["lease_metadata"]) != str(user_id):
                raise HTTPException(status_code=404, detail="Run not found")
            out = dict(row)
            raw_id = out["id"]
            if isinstance(raw_id, str):
                out["id"] = str(uuid.UUID(raw_id))
            elif isinstance(raw_id, uuid.UUID):
                out["id"] = str(raw_id)
            return out

        @qc_router.post("/daemon-chat", status_code=201)
        async def quick_chat(
            prompt: str = Query(min_length=1, max_length=8000),
            provider: str = Query(default="claude", max_length=30),
            model: str | None = Query(default=None, max_length=128),
            prev_run_id: str | None = Query(default=None, max_length=50),
            session: AsyncSession = Depends(get_session),
            user: User = Depends(require_permission_any(Permission.TASK_RUN_AGENT)),
        ) -> dict:
            import uuid

            from sqlalchemy import text as sa_text

            from app.modules.agent.placement import RunPlacementService

            # Resolve resume session_id from previous run.
            # task-08（security-audit-remediation D-005@v1/D-001@v1）：prev run
            # 同样走归属链校验（agent_runs ← daemon_task_leases.agent_run_id →
            # lease metadata.actor_user_id）——他人 prev_run_id 视为不存在，
            # resume_session_id 保持 None，不泄探（返回 201 新 run，非 404，
            # 因为 POST 本身的资源是新建 run）。
            resume_session_id = None
            if prev_run_id:
                try:
                    prev_run_uuid = uuid.UUID(prev_run_id)
                except (ValueError, TypeError):
                    prev_run_uuid = None
                if prev_run_uuid is not None:
                    row = (
                        (
                            await session.execute(
                                sa_text(
                                    "SELECT r.session_id AS session_id, l.metadata AS lease_metadata "
                                    "FROM agent_runs r "
                                    "JOIN daemon_task_leases l ON l.agent_run_id = r.id "
                                    "WHERE r.id = :id AND r.spec_strategy = 'quick-chat'"
                                ),
                                # raw text() 绑定统一 .hex：SQLite Uuid 列以
                                # CHAR(32) hex 落库（PG 为 Uuid 对象，同样接受 hex）。
                                {"id": prev_run_uuid.hex},
                            )
                        )
                        .mappings()
                        .first()
                    )
                    if (
                        row
                        and row["session_id"]
                        and _quick_chat_lease_owner(row["lease_metadata"]) == str(user.id)
                    ):
                        resume_session_id = row["session_id"]

            run_id = uuid.uuid4()
            await session.execute(
                sa_text(
                    "INSERT INTO agent_runs "
                    "(id, agent_type, provider, model, status, spec_strategy, "
                    " created_at, checkpoint_version, version, "
                    " max_retries, retry_count, attempt) "
                    "VALUES (:id, :agent_type, :provider, :model, 'pending', 'quick-chat', "
                    " :now, 0, 1, 3, 0, 0)"
                ),
                {
                    # raw text() 绑定统一 .hex：SQLite Uuid 列以 CHAR(32) hex 落库
                    # （UUID 对象驱动层不识别），PG Uuid 列同样接受 hex 形式。
                    # created_at / checkpoint_version / version / max_retries /
                    # retry_count / attempt 显式携带：这些列只有 ORM Python 端
                    # default（raw INSERT 不生效；created_at 的 server_default
                    # now() 还是 PG 方言），task-08 补 POST 测试路径时暴露，
                    # 取值对齐 model.py 默认值。
                    "id": run_id.hex,
                    # ql-20260618-009：与 service.py / bootstrap.py / dispatch.py 一致，
                    # AgentRun.agent_type 永远是 adapter id（"claude_code"），具体 provider 走独立列。
                    "agent_type": "claude_code",
                    "provider": provider,
                    "model": model,
                    "now": datetime.now(UTC),
                },
            )
            await session.commit()

            placement = RunPlacementService(session)
            try:
                lease_id = await placement.dispatch_to_daemon(
                    run_id,
                    user.id,
                    provider=provider,
                    model=model,
                    prompt=prompt,
                    resume_session_id=resume_session_id,
                )
            except Exception:
                await session.rollback()
                lease_id = None

            final_status = "pending" if lease_id else "failed"
            if not lease_id:
                try:
                    await session.execute(
                        sa_text(
                            "UPDATE agent_runs SET status='failed', "
                            "output_redacted='No online daemon runtime found' "
                            "WHERE id=:id"
                        ),
                        {"id": run_id},
                    )
                    await session.commit()
                except Exception:
                    await session.rollback()

            return {
                "id": str(run_id),
                "agent_type": "claude_code",
                "provider": provider,
                "model": model,
                "status": final_status,
            }

        @qc_router.get("/daemon-chat/{run_id}")
        async def get_quick_chat_result(
            run_id: str,
            session: AsyncSession = Depends(get_session),
            user: User = Depends(require_permission_any(Permission.TASK_READ)),
        ) -> dict:
            import uuid as _uuid

            from fastapi import HTTPException

            try:
                parsed = _uuid.UUID(run_id)
            except (ValueError, TypeError):
                raise HTTPException(status_code=404, detail="Run not found") from None

            # task-08（D-005@v1/D-001@v1）：归属校验（不匹配/链缺失 404）+ 一次查询取行。
            row = await _assert_quick_chat_run_owner(
                session,
                parsed,
                user.id,
                extra_cols=(
                    "output_redacted",
                    "agent_type",
                    "provider",
                    "model",
                    "started_at",
                    "finished_at",
                ),
            )
            return row

        @qc_router.get("/daemon-chat/{run_id}/stream")
        async def stream_quick_chat(
            run_id: str,
            user: User = Depends(require_permission_any(Permission.TASK_READ)),
        ):
            """SSE endpoint — stream real-time agent messages for a quick-chat run.

            复用 AgentService.stream_run_logs：按 run_id 订阅 Redis pub/sub，
            不需要 workspace_id（quick-chat 类型的 AgentRun 无 workspace 关联）。

            连接池安全：不注入请求级 session（会贯穿整个 StreamingResponse 生命周期、
            长时间占用一个连接池 slot）。校验改用短 session——校验后立即归还；
            stream_run_logs 生成器内部用 get_session_factory() 自建独立短 session。
            """
            import json
            import uuid as _uuid

            # StreamingResponse 在 fastapi.responses（fastapi 顶层不导出——
            # task-08 补 stream 测试时暴露的隐性导入错误，端点此前无测试覆盖）。
            from fastapi import HTTPException
            from fastapi.responses import StreamingResponse

            from app.core.db import get_session_factory
            from app.modules.agent.service import AgentService

            # 校验 run_id 是合法 UUID + 属于 quick-chat（防止越权读其他类型 run）
            try:
                parsed = _uuid.UUID(run_id)
            except (ValueError, TypeError):
                raise HTTPException(status_code=404, detail="Run not found") from None

            # 校验：短 session，校验完即归还连接池 slot（不贯穿 SSE 生命周期）。
            # task-08（D-005@v1/D-001@v1）：查询扩展为带归属判定的 JOIN——
            # 他人 run / 归属链缺失统一 404（与不存在同语义）。
            status_val = None
            async with get_session_factory()() as session:
                row = await _assert_quick_chat_run_owner(session, parsed, user.id)
                status_val = row["status"]
            if status_val is None:  # pragma: no cover — helper 不通过即 404，防御兜底
                raise HTTPException(status_code=404, detail="Run not found")

            sse_headers = {
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }

            # 已终态：直接发 done 让前端立即收尾（与 agent router 的 stream_agent_run_logs 对齐）
            if status_val not in ("pending", "running"):
                done_data = json.dumps({"status": status_val, "exit_code": None})
                return StreamingResponse(
                    iter([f"event: done\ndata: {done_data}\n\n"]),
                    media_type="text/event-stream",
                    headers=sse_headers,
                )

            # 生成器对象惰性求值；构造用短 session 随即归还，stream_run_logs 内部
            # 自建短 session 做逐次查询，不占用请求级连接池 slot。
            async with get_session_factory()() as ctor_session:
                gen = AgentService(ctor_session).stream_run_logs(parsed)
            return StreamingResponse(
                gen,
                media_type="text/event-stream",
                headers=sse_headers,
            )

        @qc_router.post("/daemon-chat/{run_id}/kill")
        async def kill_quick_chat(
            run_id: str,
            session: AsyncSession = Depends(get_session),
            user: User = Depends(require_permission_any(Permission.TASK_RUN_AGENT)),
        ) -> dict:
            """ql-20260616-006：终止 quick-chat 类型的 agent run。

            复用 DaemonLeaseService.cancel_lease：
              - 若 lease 已被 daemon claim：daemon 心跳检测 cancelled →
                syncStatus('killed') + complete_lease
              - 若 lease 还在 pending（daemon 从未 claim）：cancel_lease 直接把
                agent_run 置为 killed（防止永久 pending）

            与 workspace-scoped kill 对齐：返回 {id, status}，status 反映当前最新状态。
            """
            import uuid as _uuid

            from fastapi import HTTPException

            from app.modules.agent.service import AgentService

            try:
                parsed = _uuid.UUID(run_id)
            except (ValueError, TypeError):
                raise HTTPException(status_code=404, detail="Run not found") from None

            # task-08（D-005@v1/D-001@v1）：归属校验先于终态幂等判断——
            # 他人 run 即使已终态也 404，不泄露 run 存在性 / 状态。
            row = await _assert_quick_chat_run_owner(session, parsed, user.id)

            if row["status"] not in ("pending", "running"):
                # 已是终态，幂等返回当前状态
                return {"id": str(parsed), "status": row["status"]}

            svc = AgentService(session)
            await svc.kill_run(parsed)
            # kill_run 走 cancel_lease；pending lease → agent_run 立即 killed；
            # claimed lease → 由 daemon 心跳上报后收尾
            run = await svc.get_run(parsed)
            return {"id": str(parsed), "status": run.status if run else "killed"}

        @qc_router.get("/daemon-chat/{run_id}/logs")
        async def get_quick_chat_logs(
            run_id: str,
            session: AsyncSession = Depends(get_session),
            user: User = Depends(require_permission_any(Permission.TASK_READ)),
        ):
            """ql-20260618-001：返回 quick-chat 类型 agent run 的日志列表。

            复用 AgentService.get_run_logs（与 workspace-scoped /agent/runs/{run_id}/logs
            同源），区别仅在于：本端点不要求 workspace_id（quick-chat 无 workspace 关联），
            且只允许查询 spec_strategy='quick-chat' 的 run，防止越权读其他类型 run。
            """
            import uuid as _uuid

            from fastapi import HTTPException

            from app.modules.agent.schema import AgentRunLogEntry
            from app.modules.agent.service import AgentService

            try:
                parsed = _uuid.UUID(run_id)
            except (ValueError, TypeError):
                raise HTTPException(status_code=404, detail="Run not found") from None

            # task-08（D-005@v1/D-001@v1）：归属校验（不匹配/链缺失 404）。
            await _assert_quick_chat_run_owner(session, parsed, user.id)

            svc = AgentService(session)
            logs = await svc.get_run_logs(parsed)
            return [AgentRunLogEntry.model_validate(e) for e in logs]

        app.include_router(qc_router, prefix="/api")

    app.include_router(health_router, prefix="/api")
    # Daemon distribution endpoints — public, no /api prefix, match the
    # install.sh contract (curl <SERVER>/daemon/install.sh | bash).
    app.include_router(daemon_dist_router)
    # Quick-chat endpoint must be registered BEFORE workspace_router so that
    # the fixed path /api/daemon-chat is matched before the parameterized
    # /api/workspaces/{workspace_id}/... routes.
    _register_quick_chat(app)
    app.include_router(workspace_router, prefix="/api")
    # Workspace members sub-router (task-04 of change
    # ``2026-06-16-workspace-members``). members_router ships its own
    # ``/workspaces/{workspace_id}/members`` prefix, so the outer include only
    # adds ``/api`` to land at ``/api/workspaces/{workspace_id}/members/*``
    # (design §5.1). Mounted as a sibling of workspace_router rather than
    # nested inside it because FastAPI ``include_router(prefix=...)`` would
    # double-count members_router's own prefix and raise
    # ``ValueError: Duplicated param name workspace_id``.
    app.include_router(members_router, prefix="/api", tags=["workspace-members"])
    # PPM 项目 ↔ 工作区 关联·工作区维度(change ``2026-07-28-ppm-project-link-workspace``
    # task-07):sibling include 仿 members_router。link_router 自带
    # ``/workspaces/{workspace_id}/ppm-projects`` prefix,外层只加 ``/api`` →
    # ``/api/workspaces/{workspace_id}/ppm-projects/*``(双边对称的项目维度端点在
    # ppm/project/router.py,挂 /api/ppm)。
    app.include_router(ppm_project_link_router, prefix="/api", tags=["workspace-ppm-links"])
    # 平台级文件中心（2026-07-22-platform-file-center）：通用上传/预览/元数据/软删。
    from app.modules.file.router import router as file_router

    app.include_router(file_router, prefix="/api/file")
    app.include_router(member_runtimes_router, prefix="/api", tags=["workspace-member-runtimes"])
    app.include_router(auth_router, prefix="/api")
    app.include_router(change_router, prefix="/api")
    app.include_router(scan_docs_router, prefix="/api")
    app.include_router(task_router, prefix="/api")
    app.include_router(git_identity_router, prefix="/api")
    app.include_router(llm_provider_router, prefix="/api")
    app.include_router(agent_router, prefix="/api")
    # 2026-08-02-agent-profile-layer task-04：AgentProfile 配置层 CRUD/copy API。
    # workspace 级（/workspaces/{wid}/agent-profiles）+ platform 级（/agent-profiles）。
    # router 自身不带 prefix，路径在路由内写全，外层只加 /api。
    app.include_router(agent_profile_router, prefix="/api")
    # 2026-08-06-public-mcp-server task-02 / G-1：对外 MCP 的 McpToken workspace 级管理
    # API（POST/GET/DELETE /api/workspaces/{wid}/mcp-tokens）。router 自带 prefix
    # /workspaces + tag mcp-tokens，外层加 /api 落地。鉴权 require_permission
    # (WORKSPACE_WRITE)。token 签发/校验/吊销业务在 mcp_gateway.service.McpTokenService。
    app.include_router(mcp_gateway_router, prefix="/api", tags=["mcp-tokens"])
    # 2026-08-06-public-mcp-server task-13 / G-1 / FR-08：mission 级 SSE 端点
    # （GET /api/workspaces/{wid}/missions/{mid}/events），推该 mission 下 worker run
    # 状态变更，全终态发 done 收尾。SSE 骨架照搬 agent/router.py::stream_agent_run_logs
    # （text/event-stream + 短 session 连接池安全）。鉴权 require_permission_any(TASK_READ)。
    app.include_router(mcp_sse_router, prefix="/api")
    app.include_router(daemon_router, prefix="/api")
    # 2026-07-07-skills-mcp-management-ui task-02：平台 CustomSkill admin CRUD。
    app.include_router(skills_router, prefix="/api")
    app.include_router(worktree_router, prefix="/api")
    app.include_router(lease_router, prefix="/api")
    app.include_router(git_gateway_router, prefix="/api")
    app.include_router(change_writer_router, prefix="/api")
    app.include_router(workflow_router, prefix="/api")
    app.include_router(incident_router, prefix="/api")
    app.include_router(knowledge_router, prefix="/api")
    app.include_router(release_router, prefix="/api")
    # ppm 子域:平台级,统一前缀 /api/ppm (design §7)
    # 五个 router 自身均不带 prefix,由 main 统一挂载到 /api/ppm
    app.include_router(ppm_project_router, prefix="/api/ppm")
    app.include_router(ppm_plan_router, prefix="/api/ppm")
    app.include_router(ppm_task_router, prefix="/api/ppm")
    app.include_router(ppm_problem_router, prefix="/api/ppm")
    app.include_router(ppm_kanban_router, prefix="/api/ppm")
    app.include_router(ppm_workbench_router, prefix="/api/ppm")
    app.include_router(runtime_router, prefix="/api")
    app.include_router(tool_gateway_router, prefix="/api")
    app.include_router(policy_crud_router, prefix="/api")
    app.include_router(settings_router, prefix="/api")
    app.include_router(admin_router, prefix="/api")
    app.include_router(spec_workspace_router, prefix="/api")
    # 2026-08-10-sillyhub-platform-sync task-06：SillySpec 进度同步层 3 端点
    # （POST /changes/{name}/progress / GET /changes / GET /changes/{name}/progress）。
    # router 不自带 prefix（路径写全 /changes/...），外层 /api 落地 /api/changes/...，
    # 与 /api/workspaces/{wid}/changes/* 派发层正交（契约 D-004）。
    app.include_router(platform_sync_router, prefix="/api", tags=["platform-sync"])
    # 2026-08-11-change-progress-projection task-07：workspace-scoped token 签发 2 端点
    # （POST /api/workspaces/{wid}/platform-sync-tokens / POST /api/workspaces/resolve-by-root-path）。
    # router 自带 prefix=/workspaces，外层 /api 落地 /api/workspaces/...，与无前缀
    # changes router 分离（避免 GET /changes 尾斜杠 redirect 互相干扰）。
    app.include_router(platform_sync_workspace_router, prefix="/api", tags=["platform-sync-tokens"])

    # ── MCP gateway（对外 MCP server，独立于 /api/*）──────────────────────────
    # 2026-08-06-public-mcp-server task-05：mount /mcp（FastMCP streamable HTTP）。
    # mount_mcp 装配三步：streamable_http_app() → add_middleware(McpAuthMiddleware)
    # → app.mount("/mcp", mcp_app)。鉴权 middleware 挂子 app（CC-06 物理隔离），
    # 现有 /api/* 路由零回归。端点实际是 /mcp/（尾斜杠，spike-A 坑 3）。
    # lifespan 里的 session_manager.run() 见上方 lifespan 定义。
    mount_mcp(app)

    return app


app = create_app()
