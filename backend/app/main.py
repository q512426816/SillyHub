"""FastAPI application entrypoint."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.core.config import get_settings
from app.core.db import dispose_engine
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.core.redis import close_redis
from app.core.telemetry import init_telemetry
from app.modules.agent.router import router as agent_router
from app.modules.archive.router import router as archive_router
from app.modules.auth.router import router as auth_router
from app.modules.change import change_router
from app.modules.change_writer.router import router as change_writer_router
from app.modules.daemon.router import router as daemon_router
from app.modules.git_gateway.router import router as git_gateway_router
from app.modules.git_identity import git_identity_router
from app.modules.health import health_router
from app.modules.incident.router import router as incident_router
from app.modules.knowledge.router import router as knowledge_router
from app.modules.release.router import router as release_router
from app.modules.runtime.router import router as runtime_router
from app.modules.scan_docs.router import router as scan_docs_router
from app.modules.settings.router import router as settings_router
from app.modules.spec_workspace.router import router as spec_workspace_router
from app.modules.task import task_router
from app.modules.tool_gateway.policy_router import router as policy_crud_router
from app.modules.tool_gateway.router import router as tool_gateway_router
from app.modules.workflow.router import router as workflow_router
from app.modules.workspace import workspace_router
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
    try:
        # Bootstrap auth once the DB connection pool exists.
        from app.core.db import get_session_factory
        from app.modules.agent.service import AgentService
        from app.modules.auth.service import bootstrap_admin_and_seed_rbac

        factory = get_session_factory()
        async with factory() as session:
            await bootstrap_admin_and_seed_rbac(session, settings=settings)
            try:
                stale_count = await AgentService(session).cleanup_stale_runs()
                if stale_count:
                    log.warning("agent.stale_runs_cleaned_on_startup", count=stale_count)
            except Exception:
                log.exception("agent.stale_run_cleanup_failed")
        yield
    finally:
        log.info("app.shutdown")
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

    register_exception_handlers(app)

    # ── Quick Chat (fixed path, before parameterized routes) ────────────────

    def _register_quick_chat(app: FastAPI) -> None:
        """Register the /api/daemon-chat endpoint with its own router."""
        from fastapi import APIRouter, Depends, Query
        from sqlalchemy.ext.asyncio import AsyncSession

        from app.core.auth_deps import require_permission_any
        from app.core.db import get_session
        from app.modules.auth.model import User
        from app.modules.auth.permissions import Permission

        qc_router = APIRouter()

        @qc_router.post("/daemon-chat", status_code=201)
        async def quick_chat(
            prompt: str = Query(min_length=1, max_length=8000),
            provider: str = Query(default="claude", max_length=30),
            prev_run_id: str | None = Query(default=None, max_length=50),
            session: AsyncSession = Depends(get_session),
            user: User = Depends(require_permission_any(Permission.TASK_RUN_AGENT)),
        ) -> dict:
            import uuid

            from sqlalchemy import text as sa_text

            from app.modules.agent.placement import RunPlacementService

            # Resolve resume session_id from previous run
            resume_session_id = None
            if prev_run_id:
                row = (
                    (
                        await session.execute(
                            sa_text(
                                "SELECT session_id FROM agent_runs "
                                "WHERE id = :id AND spec_strategy = 'quick-chat'"
                            ),
                            {"id": prev_run_id},
                        )
                    )
                    .mappings()
                    .first()
                )
                if row and row["session_id"]:
                    resume_session_id = row["session_id"]

            run_id = uuid.uuid4()
            await session.execute(
                sa_text(
                    "INSERT INTO agent_runs (id, agent_type, status, spec_strategy) "
                    "VALUES (:id, :agent_type, 'pending', 'quick-chat')"
                ),
                {"id": run_id, "agent_type": provider},
            )
            await session.commit()

            placement = RunPlacementService(session)
            try:
                lease_id = await placement.dispatch_to_daemon(
                    run_id,
                    user.id,
                    provider=provider,
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
                "agent_type": provider,
                "status": final_status,
            }

        @qc_router.get("/daemon-chat/{run_id}")
        async def get_quick_chat_result(
            run_id: str,
            session: AsyncSession = Depends(get_session),
            user: User = Depends(require_permission_any(Permission.TASK_READ)),
        ) -> dict:
            from sqlalchemy import text as sa_text

            result = await session.execute(
                sa_text(
                    "SELECT id, status, output_redacted, agent_type, started_at, finished_at "
                    "FROM agent_runs WHERE id = :id AND spec_strategy = 'quick-chat'"
                ),
                {"id": run_id},
            )
            row = result.mappings().first()
            if row is None:
                from fastapi import HTTPException

                raise HTTPException(status_code=404, detail="Run not found")
            return dict(row)

        app.include_router(qc_router, prefix="/api")

    app.include_router(health_router, prefix="/api")
    # Quick-chat endpoint must be registered BEFORE workspace_router so that
    # the fixed path /api/daemon-chat is matched before the parameterized
    # /api/workspaces/{workspace_id}/... routes.
    _register_quick_chat(app)
    app.include_router(workspace_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(change_router, prefix="/api")
    app.include_router(scan_docs_router, prefix="/api")
    app.include_router(task_router, prefix="/api")
    app.include_router(git_identity_router, prefix="/api")
    app.include_router(agent_router, prefix="/api")
    app.include_router(daemon_router, prefix="/api")
    app.include_router(worktree_router, prefix="/api")
    app.include_router(lease_router, prefix="/api")
    app.include_router(git_gateway_router, prefix="/api")
    app.include_router(change_writer_router, prefix="/api")
    app.include_router(workflow_router, prefix="/api")
    app.include_router(incident_router, prefix="/api")
    app.include_router(knowledge_router, prefix="/api")
    app.include_router(release_router, prefix="/api")
    app.include_router(runtime_router, prefix="/api")
    app.include_router(tool_gateway_router, prefix="/api")
    app.include_router(policy_crud_router, prefix="/api")
    app.include_router(archive_router, prefix="/api")
    app.include_router(settings_router, prefix="/api")
    app.include_router(spec_workspace_router, prefix="/api")

    return app


app = create_app()
