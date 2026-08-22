---
id: task-13
title: 'remove-legacy-mission-entry-pages-routes-menu-clients-backend-create-list-endpoints-ref-cleanup'
title_zh: '删除旧入口——mission-console/两页面路由/菜单项/lib/agent.ts create+list client + backend 删 create+list 四端点（保留 GET /missions/{id} 与 cancel）+ 全仓引用清理'
author: 'qinyi'
created_at: 2026-08-22 03:35:53
priority: P1
depends_on: [task-11]
blocks: [task-14]
requirement_ids: [FR-06]
decision_ids: [D-005@v1, D-011@v1]
allowed_paths:
  - frontend/src/components/mission-console.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/missions/page.tsx
  - frontend/src/app/(dashboard)/projects/[id]/missions/page.tsx
  - frontend/src/lib/menu-permissions.ts
  - frontend/src/lib/agent.ts
  - frontend/src/components/__tests__/mission-console.test.tsx
  - frontend/src/app/(dashboard)/projects/[id]/missions/__tests__/missions-page.test.tsx
  - backend/app/modules/agent/router.py
  - backend/app/modules/agent/tests/test_mission_list.py
  - backend/app/modules/agent/tests/test_router_project_missions.py
  - backend/app/modules/agent/tests/test_mission_access_control.py
  - backend/app/modules/agent/tests/test_team_mode_dispatch.py
  - backend/app/modules/agent/tests/test_integration_cross_workspace.py
goal: >
  删除独立 missions 创建页面/路由/菜单与前后端 create+list 入口，入口归一到
  会话内触发（task-11 已交付）；保留 GET /missions/{id} 与 cancel 供
  TeamTaskBlock/team-progress 使用，全仓引用清零（design §5 Phase 4、D-011）。
implementation:
  - router.py GET /missions/{id} 与 cancel 响应的 workers 列表改用 control.non_orchestrator_runs()（task-07 提供的治理口径，排除主控轮；worker_runs 全量语义不动）
  - 删两个页面路由（workspaces/[id]/missions、projects/[id]/missions）、mission-console.tsx 及其测试；menu-permissions.ts 删「Agent 团队」菜单项（menuKey missions 整条移除）
  - lib/agent.ts 删 createMission/listMissions/createProjectMission/listProjectMissions 及 CreateMissionInput/CreateProjectMissionInput/ProjectMissionResponse 类型；保留 getMission/cancelMission 与 Mission/MissionWorkerRun/MissionArtifact/WorkerPresetItem/MainAgentConfig（team-progress 与触发弹层在用）
  - backend agent/router.py 删四个端点——POST/GET /workspaces/{id}/missions 与 POST/GET /projects/{id}/missions；仅被它们使用的 helper 一并清理（_require_project_manager/_check_scope_bindings 若已被 task-03 新端点复用则保留）；保留 GET /missions/{id}、POST /missions/{id}/cancel 与全部 MCP 端点
  - 适配既有测试——test_mission_list.py/test_router_project_missions.py 删除或改写为保留端点行为；test_mission_access_control.py 的 list 断言删改；test_team_mode_dispatch.py 的 _create_mission 与 test_integration_cross_workspace.py 的创建 helper 改直建 DB 记录；test_integration_cross_workspace.py 另有两处 converge 响应断言 merged 需改 converged（task-06 四值改名，主代理记录）
  - 全仓 grep missions/mission-console/createMission/listMissions 引用清零（生产代码）
acceptance:
  - /workspaces/{id}/missions 与 /projects/{id}/missions 两路由 404
  - 侧边菜单无「Agent 团队」项
  - mission-console.tsx 与两页面文件及其测试删除
  - lib/agent.ts 仅保留 getMission/cancelMission 等 team-progress 所需 client
  - backend 四个 create/list 端点删除；GET /missions/{id} 与 POST /missions/{id}/cancel 保留且 team-progress/TeamTaskBlock 不回归
  - 全仓 grep 无生产代码引用（测试与 .sillyspec 文档除外）；引用这些符号的既有前端测试同步删除或适配
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm typecheck
  - cd backend && uv run pytest app/modules/agent -q --no-cov --deselect app/modules/agent/tests/test_dispatch_metadata.py::test_build_claim_payload_propagates_bundle_fields --deselect app/modules/agent/tests/test_execution_context.py::test_get_execution_context_task_run
  - grep -rn "mission-console\|createMission\|listMissions\|createProjectMission\|listProjectMissions" frontend/src backend/app sillyhub-daemon/src 无生产代码命中
constraints:
  - 不动 team-progress.tsx、change-agent-run-log.tsx 与 change 详情用法（依赖的 GET/cancel 端点保留，design §3 非目标）
  - 不删 MCP 端点（dispatch_worker/converge 等全部保留）
  - api-types.ts 与 openapi.json 同步归 task-14（pnpm gen:types 不在本卡执行）
  - 删除端点对应测试同步删除/改写为保留行为，不许为绿改断言语义（CLAUDE.md 规则 9）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
