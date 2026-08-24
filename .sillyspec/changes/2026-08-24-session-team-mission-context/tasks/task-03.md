---
id: task-03
title: 'mission_status backend 路由+DTO——GET /missions/status（X-Session-Id 定位，对齐 hub-client _missionActionPath；get_active_mission_for_session 定位，active=false 200）+ agent/schema.py MissionStatusResponse'
title_zh: 'mission_status backend 路由+DTO——GET /missions/status（X-Session-Id 定位，对齐 hub-client _missionActionPath；get_active_mission_for_session 定位，active=false 200）+ agent/schema.py MissionStatusResponse'
author: 'qinyi'
created_at: 2026-08-24 18:53:12
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-005@v1, D-012@v1]
allowed_paths:
  - backend/app/modules/agent/mcp_tools.py
  - backend/app/modules/agent/schema.py
  - backend/app/modules/agent/tests/test_mission_status.py
provides:
  - contract: MissionStatusResponse
    file: backend/app/modules/agent/mcp_tools.py
    fields: [MissionStatusResponse, ScopeWorkspaceStatus, missions_status_route]
    consumers: [task-11]
expects_from:
  - 'task-01 collect_scope_workspace_statuses：scope 工作区结构化状态（ws+任一成员 binding 机器名+daemon 在线+可选 git 探测回调）'
  - 'task-02 probe_workspace_git_mode：三态 git|direct|unknown 探测（作 task-01 结构化查询的探测回调注入）'
goal: >
  新增主控常驻查询端点 GET /missions/status（实际 URL /api/missions/status，X-Session-Id
  header 定位，对齐 hub-client.ts:425-437 _missionActionPath 的 missionId 缺省形态）与
  agent/schema.py 的 MissionStatusResponse/ScopeWorkspaceStatus DTO：直接经
  get_active_mission_for_session（mission.py:82）定位会话活跃 mission，无活跃时优雅返回
  active=false 200（不走 _resolve_session_mission 的 404 语义），供 task-11 daemon 侧
  mission_status 工具转发给主控 agent 随时查 scope 机器状态（FR-02）。
implementation:
  - 'agent/schema.py 按 design §7 逐字新增 ScopeWorkspaceStatus（id/name/type/description/daemon_online/daemon_name/git_mode）与 MissionStatusResponse（active/hint/mission_id/status/objective/anchor_workspace/scope_workspaces/workers/budget_usd，默认值对齐 §7）'
  - 'WorkerListItem 现居 mcp_tools.py:162，schema.py 顶部 import 它会成环（schema→mcp_tools→service，service.py:33 已反向 import schema）：把 WorkerListItem 上移 agent/schema.py，mcp_tools.py 改 from-import 并保留模块级重导出（既有 from app.modules.agent.mcp_tools import WorkerListItem 消费方零改动）；禁止在 schema.py 复制字段定义造成漂移'
  - 'mcp_tools.py 新增路由 GET /missions/status（鉴权 SessionMcpUser=require_permission_any(WORKSPACE_WRITE)，agent router 前缀 /api，main.py:739）；可选同构加 GET /sessions/{session_id}/missions/status（_request_session_id 既有 header>path 优先级）'
  - '定位不走 _resolve_session_mission（其对无活跃 mission 抛 404，mcp_tools.py:455-458）：session.get(AgentSession)（缺失 404）+ get_active_mission_for_session；无活跃 → 200 active=false + hint 引导文案（不泄露 scope/binding 信息）；有活跃 → _check_workspace_write(mission.workspace_id) 复核后组装'
  - '组装：mission_id/objective/budget_usd 直取 mission 列（objective 占位符原样）；status 复用 mission.derive_status 派生口径（拉 mission runs，不新造状态机）；scope 条目经 task-01 collect_scope_workspace_statuses（探测回调注入 task-02 probe_workspace_git_mode，每次调用实时探测不缓存，R-02 口径），anchor_workspace 取条目中 id==mission.workspace_id 者；workers 复用 _list_workers_core（mcp_tools.py:995）返回的 .workers'
  - '修正 mcp_tools.py:1462-1477 过时路由冲突注释：现 include 顺序为 router.py:940（include mcp_tools）先于 :946 GET /missions/{mission_id}，单段 GET 先注册先匹配；注释与实现不一致须修正（CLAUDE.md 规则 18）'
  - '新增 tests/test_mission_status.py：无 header 400 / 会话缺失 404 / 无活跃 mission active=false 200 / 有活跃 mission 全字段 200 / 越权 403'
acceptance:
  - 'GET /api/missions/status 无 X-Session-Id → 400；会话存在但无活跃 mission → 200 且 active=false + hint，不 404（D-012 单测锚点：不走 _resolve_session_mission）'
  - '有活跃 mission → 200 全字段组装：mission_id/objective/status（derive_status 派生）/budget_usd/anchor_workspace/scope_workspaces（每条含 daemon_name=display_alias||hostname 任一成员 binding 口径、git_mode∈{git,direct,unknown} 实时探测）/workers 与 _list_workers_core 同源'
  - '路由可达性断言：单段 GET /missions/status 返回 200（未被 GET /missions/{mission_id} 的 uuid 校验截走 422）'
  - '既有 5 工具路由与 WorkerListItem 消费方零回归（test_mcp_tools*.py 不改断言全绿）'
verify:
  - 'cd backend && uv run pytest app/modules/agent/tests/test_mission_status.py -q --no-cov'
  - 'cd backend && uv run pytest app/modules/agent -q --no-cov -n auto'
constraints:
  - '路由形态写死 GET /missions/status（X-Session-Id header 定位，对齐 hub-client _missionActionPath missionId 缺省形态）；sessions/{sid} 变体可选（三族同构），不得改成 POST 或 workspace 路径前缀形态'
  - '不改 _resolve_session_mission 与既有 5 工具路由语义；不改 _list_workers_core 本体'
  - '每次调用实时探测不缓存（R-02/YAGNI）；无活跃 mission 响应不泄露 scope/binding 信息'
  - '本卡不做 daemon 侧工具注册（task-11）与前端/daemon 类型再生成（task-14 统一 gen:types）'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
