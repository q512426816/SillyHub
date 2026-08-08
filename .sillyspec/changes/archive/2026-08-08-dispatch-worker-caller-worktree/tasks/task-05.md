---
id: task-05
title: link-A HTTP entry adds orchestration_mode + dispatch_worker caller-worktree fields
title_zh: 链路A HTTP 入口加字段（router.py create_mission orchestration_mode + mcp_tools.py dispatch_worker 三参）
author: qinyi
created_at: 2026-08-08 17:39:23
priority: P1
depends_on: [task-01, task-02, task-04]
blocks: [task-09]
requirement_ids: [FR-01, FR-08]
decision_ids: [D-007@v1, D-009@v1]
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\agent\router.py
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\agent\mission_schema.py
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\agent\mcp_tools.py
provides:
  - contract: link_a_http_create_mission_orchestration_mode
    fields: ["POST /workspaces/{ws}/missions body 加 orchestration_mode（Literal team|external，默认 None→team）", "透传 team_mission_entry（task-01 形参）"]
  - contract: link_a_http_dispatch_worker_caller_worktree
    fields: [worktree_path, branch, worker_prompt（snake_case，透传 execution.dispatch_worker）]
expects_from:
  - task-01: "team_mission_entry(orchestration_mode: str=\"team\") 形参 + constraints 落 mode（external 透传目标）"
  - task-02: execution.dispatch_worker(worktree_path, branch, worker_prompt) 签名（dispatch_worker 透传目标）
  - task-04: 链路B create_mission/dispatch_worker 字段集（snake_case 同构，R-06 防漂移）
goal: >
  router.py create_mission HTTP 端点（:847）接受 orchestration_mode 并透传 team_mission_entry；mcp_tools.py dispatch_worker HTTP 端点（:352）+ DispatchWorkerRequest（:56）接受 worktree_path/branch/worker_prompt 并透传 execution.dispatch_worker；字段名 snake_case 对齐链路B。
implementation:
  - "mission_schema.py MissionCreateRequest 加 `orchestration_mode: Literal[\"team\", \"external\"] | None = None`（沿用既有 mode 字段 Literal 风格；默认 None→team 零回归）"
  - "router.py:854 constraints 构造处：payload.orchestration_mode 非空时并入 constraints[\"orchestration_mode\"]（与现有 mode/session_id 并入同款）"
  - "router.py:863 team 分支门控扩展：`orchestration_mode == \"external\"` 也走 team_mission_entry（external 是 team 路径子模式，不落 GLM planner 单 agent 链路）；team_mission_entry 调用追加 `orchestration_mode=payload.orchestration_mode or \"team\"`（task-01 形参）；与 task-04 链路B 路由保持一致"
  - "mcp_tools.py:56 DispatchWorkerRequest 加 `worktree_path: str | None = None` / `branch: str | None = None` / `worker_prompt: str | None = None`（snake_case，D-009 字段名 branch）"
  - mcp_tools.py:420 exec_svc.dispatch_worker 调用追加 `worktree_path=payload.worktree_path, branch=payload.branch, worker_prompt=payload.worker_prompt`（task-02 形参；None 透传走原逻辑）
acceptance:
  - "POST /workspaces/{ws}/missions body 含 orchestration_mode=\"external\" → 进入 team_mission_entry 分支、透传 external（mission.constraints 含 external，与 task-01 联动验收）"
  - POST .../dispatch_worker body 含 worktree_path/branch/worker_prompt → 透传 execution.dispatch_worker（与 task-02 联动验收）
  - 不传新字段 → create_mission / dispatch_worker 行为字节不变（test_mcp_tools / test_team_mode_dispatch 全绿）
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_mcp_tools.py app/modules/agent/tests/test_team_mode_dispatch.py -q
---

## 实现依据
- design §6 row 91（mcp_tools.py create_mission HTTP + DispatchWorkerRequest 加字段）+ P2 校正：create_mission HTTP 实际在 router.py:847（Grill 发现，非 mcp_tools.py）
- design §7.1 create_mission 新增 orchestration_mode 可选参；§7.3 链路A DispatchWorkerRequest:56 加 worktree_path/branch/worker_prompt（snake_case）
- design §11 D-007@v1（external mode）/ D-009@v1（字段名 branch 对齐）；R-06 链路A/B schema 防漂移
- 源码：router.py:847 create_mission（payload=MissionCreateRequest，:863 mode=="team" 门控 team_mission_entry，:854 constraints 并入 mode/session_id）；mission_schema.py:12 MissionCreateRequest（mode 字段 Literal 风格）；mcp_tools.py:56 DispatchWorkerRequest、:352 dispatch_worker handler、:420 exec_svc.dispatch_worker 调用

## 跨任务契约
- provides `link_a_http_create_mission_orchestration_mode` + `link_a_http_dispatch_worker_caller_worktree`：链路A HTTP 入口字段透传，被 task-09（零回归）覆盖测试
- 消费 task-01（team_mission_entry orchestration_mode 形参）/ task-02（dispatch_worker 三参）/ task-04（链路B 字段同构基准）
- ⚠️ external 路由门控（orchestration_mode=="external" 进 team_mission_entry 而非 GLM planner）需与 task-01 / task-04 对齐：三入口（router.py / mcp_gateway / team_mission_entry）对 external 的判定口径一致
