"""HTTP routes for daemon runtime management and task lease lifecycle.

task-07 拆分（2026-09-07-arch-large-file-split）：原 5468 行 router.py 按域拆为
12 个端点子模块（version / heartbeat / runtimes / machines / lease / session_crud /
session_queue / session_insights / session_team / notify / gateway_misc /
daemon_rpc），本 ``__init__`` 是兼容层——对外导入路径
``from app.modules.daemon.router import router`` 等零改动。

结构（顺序即语义，勿调换）：

1. 建 ``router = APIRouter(prefix="/daemon", tags=["daemon"])`` 并 include
   change_write / audit / grants / group_chat 四子路由（原 router.py:462-499，
   刻意先于全部端点注册——固定路径不被后文动态段吞掉）；
2. 定义各子模块共享的请求依赖别名（``SessionDep`` / ``RuntimeAdminUser`` /
   ``TaskRunAgentUser``）；
3. import 端点子模块触发注册，再按拆前 router.py 的端点定义顺序显式重排
   （``_ENDPOINT_ORDER``）——FastAPI 路由匹配与 openapi.json 的 paths 键序都取
   注册顺序，重排保证拆分后路由表逐条一致、openapi 零 diff；
4. 聚合重导出拆前模块命名空间的被消费符号（import 面 + patch 面）。

patch 兼容（D-007）：本命名空间保留 get_redis / SESSIONS_EVENTS_KEEPALIVE_
INTERVAL_SEC / get_session_readiness / _derive_policy_version / DaemonPermission-
Service / upsert_agent_task / _LLM_PROXY_CLIENT / _SESSION_RUNS_MAX 绑定；子模块
内一律 ``import app.modules.daemon.router as _router`` 延迟解析，既有
patch("app.modules.daemon.router.<sym>") 全部继续拦截。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission_any
from app.core.db import get_session
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.daemon.agent_task_store import upsert_agent_task
from app.modules.daemon.permission_service import DaemonPermissionService
from app.modules.daemon.session.service import SessionService, get_session_readiness

log = get_logger(__name__)

# /sessions/events keepalive 间隔（原 :454-458）：模块级常量便于测试置 0 模拟
# 「静默即 keepalive」（test_group_realtime / test_sessions_events_stream 以
# setattr 字符串形态 patch 本命名空间，D-007——session_crud 读取点经 _router
# 延迟解析）。
SESSIONS_EVENTS_KEEPALIVE_INTERVAL_SEC = 25.0

# run 列表固定取最新 N 条（原 :3717-3719）：test_session_runs_endpoint setattr
# 本命名空间调小上限，session_insights 读取点经 _router 延迟解析。
_SESSION_RUNS_MAX = 200

# llm-proxy 进程级共享转发客户端单例（原 :4529-4535）：状态挂本命名空间，
# test_llm_proxy.py 的 reset fixture 直接对包属性赋 None 复位（D-007）。
_LLM_PROXY_CLIENT = None

router = APIRouter(prefix="/daemon", tags=["daemon"])

# task-09：change-write 任务队列回执三端点（FR-08 / D-004@v1），复用本 router 的
# /daemon prefix + tag；路由写相对路径（/runtimes/{rid}/pending-change-writes 等），
# 经外层 main.py 的 prefix="/api" 挂载后落地 /api/daemon/...
from app.modules.daemon.change_write_router import (  # noqa: E402
    router as change_write_router,
)

router.include_router(change_write_router)

# task-10 / D-006@v1: daemon audit batch upload + paginated audit read.
# Inherits this router's /daemon prefix → POST resolves to
# /api/daemon/audit/batch (matches design §7.3); the GET audit read resolves
# to /api/daemon/workspaces/{wid}/runtimes/{rid}/policy-audit (deviation: design
# §7.3 wrote /api/workspaces/... but editing app/main.py is out of task-10's
# allowed_paths — see audit/router.py module docstring).
from app.modules.daemon.audit.router import router as audit_router  # noqa: E402

router.include_router(audit_router)

# 2026-08-28-daemon-agent-share task-07：挂载平台共享智能体端点（task-04 定义，
# design §5 Phase 3 / §7）。仿 audit_router 先例在本 router 静态区 include（先于
# 后文所有路由声明，含动态 /runtimes/{runtime_id}——固定路径 /shared-agents 与
# /shared-agents/active 不会被动态段吞掉），复用本 router 的 /daemon prefix，
# 经 main.py 挂 /api 后落地 /api/daemon/shared-agents 系列端点，不动 main.py。
# （SharedMachineRow 供 runtimes.py 读模型注解消费，在此保命名空间重导出。）
from app.modules.daemon.grants.queries import SharedMachineRow  # noqa: E402, F401
from app.modules.daemon.grants.router import router as grants_router  # noqa: E402

router.include_router(grants_router)

# 2026-09-01-session-group-chat task-02：挂载群聊管理端点（群 CRUD/成员管理，
# design §6.1）。仿 grants_router 先例在本 router 静态区 include（先于后文动态
# 路由），复用 /daemon prefix 经 main.py 挂 /api 后落地 /api/daemon/group-chats
# 系列（design §6.1 写的 /api/group-chats 属路径偏差——本变更不动 main.py，
# 照 audit_router 先例记录于 group/router.py 模块注释）。群消息/typing 端点
# 分属 task-03/06，此处不挂载。
from app.modules.daemon.group.router import router as group_chat_router  # noqa: E402

router.include_router(group_chat_router)

# 四子路由 include 段结束锚点：后续端点重排只作用于锚点之后的 84 个端点路由，
# 四子路由块的相对序保持原样（挂载顺序不变量，design R-05）。
_routes_before_endpoints = len(router.routes)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
# 管理 UI 端点用 runtime:admin；daemon 自身的注册/心跳/lease 生命周期仍走 get_current_principal
RuntimeAdminUser = Annotated[User, Depends(require_permission_any(Permission.RUNTIME_ADMIN))]

# Interactive session callers need task:run_agent (same gate as quick-chat /
# dispatch). Aliased separately so the intent is self-documenting.
# （原 router.py:2483-2485 定义于 session 端点区；拆分后提升为包共享依赖别名，
# notify / session_crud / session_queue / session_insights / session_team
# 端点签名原样取用。）
TaskRunAgentUser = Annotated[User, Depends(require_permission_any(Permission.TASK_RUN_AGENT))]

# ── 端点子模块注册（import 即注册；按拆前 router.py 端点首现顺序 import——
# 注册块的天然顺序即尽量贴近拆前定义序，全局顺序仍由下方表兜底恢复）──────
from . import (  # noqa: E402, F401, I001
    version,  # 首现 #1-2（version/register）
    heartbeat,  # 首现 #3（heartbeat）
    runtimes,  # 首现 #4-8（usage/page/update/allowed-roots/self-update，#17-23）
    machines,  # 首现 #9-16（machines ×9 含 compare，#22 instances）
    lease,  # 首现 #24-30（leases ×7，#41-42）
    notify,  # 首现 #31-40（恢复/挂起 + notify_*×6，#45-48 权限/dialog）
    daemon_rpc,  # 首现 #43-44（fs list-dir/roots，#77-83 pending/controls/skills/mcp）
    session_crud,  # 首现 #49-53（sessions 域，#60-66 reopen..ctx-window）+ D-010 二回合 pin/unpin/rename
    session_queue,  # 首现 #54-59（queue ×6）+ D-010 二回合 scheduled ×3
    session_insights,  # 首现 #67-71（stream/runs/tasks/logs/usage）
    session_team,  # 首现 #72-73（team-mission trigger/list）
    gateway_misc,  # 首现 #74-76（llm-proxy ×2 + ws）
)

# ── 拆前端点注册顺序恢复（R-05 不变量，勿删）─────────────────────────────────
# 拆分后 84 端点按域分居 12 个子模块，import 触发的注册天然是「按域分块」顺序；
# 但拆前 router.py 的端点定义在域间交错（runtimes→machines→runtimes→machines→
# runtimes→lease→恢复/notify→lease→fs/权限→session_crud→队列→session_crud→
# 观测/team→llm/ws/controls，见下表分组注释）。FastAPI 按注册顺序匹配路由、
# openapi.json 的 paths 键序也取注册顺序，故此处按拆前顺序对锚点之后的端点路由
# 做显式重排——路由表与拆前逐条一致、openapi 零 diff。
# ⚠ 新增/删改端点必须同步本表：下方断言在端点集合漂移时立即失败（fail-fast）。
_ENDPOINT_ORDER: tuple[str, ...] = (
    # version
    "get_daemon_version",
    "register_daemon",
    # heartbeat
    "daemon_heartbeat",
    # runtimes（拆前 #4-8：usage/page 先于 {runtime_id}，同形状保序对）
    "get_runtimes_usage",
    "list_runtimes_page",
    "update_runtime",
    "update_runtime_allowed_roots",
    "trigger_daemon_self_update",
    # machines
    "list_machines",
    "update_machine",
    "trigger_machine_self_update",
    "trigger_machine_cleanup",
    "trigger_machine_sillyspec_update",
    "trigger_machine_sillyspec_resolve",
    "trigger_machine_sillyspec_ghost_cleanup",
    "compare_machine_sillyspec_conflict",
    "delete_machine",
    # runtimes（拆前 #17-21）
    "get_runtime",
    "disable_runtime",
    "enable_runtime",
    "delete_runtime",
    "mark_runtime_offline",
    # machines（拆前 #22：GET /instances）
    "list_daemon_instances",
    # runtimes（拆前 #23：GET /runtimes）
    "list_runtimes",
    # lease
    "claim_lease",
    "start_lease",
    "lease_heartbeat",
    "submit_lease_messages",
    "complete_lease",
    "sync_lease_status",
    "close_interactive_run",
    # 恢复/挂起（notify；/sessions/suspend-batch 先于两段式 {session_id}）
    "recover_session",
    "confirm_session_reconnected",
    "mark_session_recovery_failed",
    "suspend_sessions_batch",
    # notify_*（notify）
    "notify_session_ready",
    "handle_plan_response",
    "notify_plan_mode_entered",
    "notify_bash_status",
    "notify_bash_chunk",
    "notify_agent_task_status",
    # lease（拆前 #41-42）
    "get_lease",
    "list_runtime_leases",
    # fs RPC（daemon_rpc）
    "list_dir",
    "list_roots",
    # 权限/dialog（notify）
    "respond_session_permission",
    "submit_session_permission_request",
    "list_pending_dialogs",
    "list_dialog_history",
    # session_crud（/sessions/events 先于 /sessions/{session_id}，同形状保序对）
    "list_sessions",
    "stream_sessions_events",
    "get_session_detail",
    "create_session",
    "inject_session",
    # session_queue（reorder 先于 {entry_id}，同形状保序对）
    "list_session_queue",
    "reorder_session_queue",
    "delete_session_queue_entry",
    "update_session_queue_entry",
    "retry_session_queue_entry",
    "dispatch_now_session_queue_entry",
    # session_crud（拆前 #60-66）
    "reopen_session",
    "interrupt_session",
    "end_session",
    "delete_session",
    "archive_session",
    "unarchive_session",
    "update_session_ctx_window",
    # D-010 第二回合（merge main 2ad590192，2026-09-07-session-pin-rename-
    # scheduled-send task-02/03）：原 router.py 在 update_session_ctx_window 与
    # stream_session_logs 之间首现的六端点——pin/unpin/rename 落 session_crud，
    # scheduled ×3 落 session_queue。
    "pin_session",
    "unpin_session",
    "rename_session",
    "create_scheduled_message",
    "list_scheduled_messages",
    "cancel_scheduled_message",
    # session_insights（拆前 #67-71：stream/runs/tasks/logs/usage）
    "stream_session_logs",
    "list_session_runs",
    "list_session_tasks",
    "get_session_logs",
    "get_session_usage",
    # session_team（拆前 #72-73：team-mission trigger/list）
    "trigger_session_team_mission",
    "list_session_team_missions",
    # llm proxy / ws（gateway_misc）/ pending-leases / controls / skills / mcp（daemon_rpc）
    "llm_proxy_get",
    "llm_proxy_post",
    "daemon_websocket",
    "get_pending_leases",
    "get_pending_controls",
    "ack_controls",
    "get_skills_manifest",
    "get_skills_bundle",
    "get_skill_content",
    "get_daemon_mcp_config",
)

_endpoint_routes = router.routes[_routes_before_endpoints:]
_routes_by_name = {route.endpoint.__name__: route for route in _endpoint_routes}
if len(_routes_by_name) != len(_endpoint_routes) or set(_routes_by_name) != set(_ENDPOINT_ORDER):
    raise RuntimeError(
        "daemon router 端点集合与 _ENDPOINT_ORDER 漂移："
        f"期望 {len(_ENDPOINT_ORDER)} 个端点，实际 {len(_routes_by_name)} 个；"
        "新增/删除端点须同步本表（task-07 拆分不变量，design R-05）。"
    )
router.routes[_routes_before_endpoints:] = [_routes_by_name[name] for name in _ENDPOINT_ORDER]
del _endpoint_routes, _routes_by_name, _routes_before_endpoints

# ── 对外导出面（拆前 router.py 命名空间的被消费符号，导入语句零改动）─────────
# import 面（main.py / agent/router.py / dist_router.py / session.service / 测试）
# + patch 面（get_redis 等 setattr/patch 字符串目标，见模块 docstring）。
from .gateway_misc import close_llm_proxy_client  # noqa: E402
from .lease import InteractiveRunResultRequest  # noqa: E402
from .machines import (  # noqa: E402
    SillySpecConflictCompareFile,
    SillySpecConflictCompareResponse,
    SillySpecConflictDiffRow,
    SillySpecConflictProgressRow,
)
from .notify import PermissionServiceDep  # noqa: E402
from .runtimes import _derive_policy_version  # noqa: E402
from .session_crud import (  # noqa: E402
    _stream_sessions_events,
    pin_session,
    rename_session,
    stream_sessions_events,
    unpin_session,
)
from .session_queue import (  # noqa: E402
    cancel_scheduled_message,
    create_scheduled_message,
    list_scheduled_messages,
)
from .session_team import (  # noqa: E402
    _session_has_active_turn,
    _team_mission_summary,
    trigger_session_team_mission,
    validate_team_mission_block,
)
from .version import DAEMON_DOWNLOAD_URL, get_daemon_latest_version  # noqa: E402

__all__ = [
    "DAEMON_DOWNLOAD_URL",
    "SESSIONS_EVENTS_KEEPALIVE_INTERVAL_SEC",
    "_LLM_PROXY_CLIENT",
    "_SESSION_RUNS_MAX",
    "DaemonPermissionService",
    "InteractiveRunResultRequest",
    "PermissionServiceDep",
    "RuntimeAdminUser",
    "SessionDep",
    "SessionService",
    "SillySpecConflictCompareFile",
    "SillySpecConflictCompareResponse",
    "SillySpecConflictDiffRow",
    "SillySpecConflictProgressRow",
    "TaskRunAgentUser",
    "_derive_policy_version",
    "_session_has_active_turn",
    "_stream_sessions_events",
    "_team_mission_summary",
    "cancel_scheduled_message",
    "close_llm_proxy_client",
    "create_scheduled_message",
    "get_daemon_latest_version",
    "get_redis",
    "get_session_readiness",
    "list_scheduled_messages",
    "log",
    "pin_session",
    "rename_session",
    "router",
    "stream_sessions_events",
    "trigger_session_team_mission",
    "unpin_session",
    "upsert_agent_task",
    "validate_team_mission_block",
]
