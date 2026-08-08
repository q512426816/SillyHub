---
id: task-04
title: mcp_gateway create_mission/dispatch_worker 加 external + worktree 透传（链路B）
title_zh: mcp_gateway.tools create_mission 加 orchestration_mode 参 + dispatch_worker 加3参透传（SillySpec 走这条公开入口）
author: qinyi
created_at: 2026-08-08 17:39:23
priority: P0
depends_on: []
blocks: [task-05, task-06, task-07, task-08, task-11, task-12]
requirement_ids: [FR-01, FR-08]
decision_ids: [D-007@v1]
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_gateway\tools.py
expects_from:
  task-01:
    - contract: team_mission_entry_orchestration_mode
      needs: ["orchestration_mode 形参透传 team_mission_entry（external 时 main_run 可能 None）"]
  task-02:
    - contract: dispatch_worker_caller_worktree
      needs: ["dispatch_worker 新签名 worktree_path/branch/worker_prompt 透传 exec_svc.dispatch_worker"]
provides:
  - contract: mcp_gateway_caller_worktree_entry
    fields: ["create_mission 加 orchestration_mode（链路B，SillySpec isPathASupported 探测 + createMission 入口）", "dispatch_worker 加 worktree_path/branch/worker_prompt 透传"]
goal: >
  mcp_gateway tools 链路B 入口接通：create_mission 加 orchestration_mode 形参并透传 team_mission_entry（external 返回 main_run_id=null/workers=[]）；dispatch_worker 加 worktree_path/branch/worker_prompt 三参透传 exec_svc.dispatch_worker。
implementation:
  - create_mission（tools.py:743）加形参 orchestration_mode: str = "team"，透传 svc.team_mission_entry（与 constraints 合并交由 task-01 落库）
  - create_mission 返回构造兼容 external：main_run 为 None 时 main_run_id=null、workers=[]、status=derive_status([], ...)（不访问 main_run.id/role）
  - dispatch_worker（tools.py:335）加形参 worktree_path/branch/worker_prompt（均 str|None=None），在 exec_svc.dispatch_worker 调用（:418-423）透传三参
  - 三参/模式默认值保持向后兼容（既有 MCP 调用方字节不变，OpenAPI 仅增量可选字段）
acceptance:
  - create_mission(orchestration_mode="external") 返回 main_run_id=null、workers=[]，且 mission.constraints 含 external
  - dispatch_worker 传 worktree_path/branch/worker_prompt → 透传到 exec_svc.dispatch_worker（task-02 行为生效）
  - 不传新参 → 与改动前返回一致（test_tools_new / test_team_mode_dispatch 全绿）
verify:
  - cd backend && uv run pytest app/modules/mcp_gateway/tests/test_tools_new.py app/modules/agent/tests/test_team_mode_dispatch.py -q
---

## 实现依据
- design §7.1 create_mission 新增 orchestration_mode 可选参（external 返回 main_run_id:null, workers:[]）
- design §7.3 MCP dispatch_worker 入参增量（worktree_path/branch/worker_prompt，字段名 branch 对齐 D-009，链路B = mcp_gateway/tools.py:335）
- design §6（mcp_gateway/tools.py create_mission:743 + dispatch_worker:335 加参透传）
- 源码：tools.py:743 create_mission（:772 调 team_mission_entry，:777 constraints=None，:786/790 解构 main_run）；:335 dispatch_worker（:418-423 调 exec_svc.dispatch_worker 只传 3 kwargs）

## 跨任务契约
- expects_from task-01（orchestration_mode 形参 + external 时 main_run=None）+ task-02（dispatch_worker 新签名）
- provides `mcp_gateway_caller_worktree_entry`：SillySpec 链路B 真正入口，被 task-11（isPathASupported 探测 schema 含 worktree_path）/ task-12（client.js 接通）/ task-08（入口透传测试）消费
- 链路A（router.py + mcp_tools.py + daemon）在 task-05/06 对称增量，字段名统一 branch（R-06 防双写漂移）
