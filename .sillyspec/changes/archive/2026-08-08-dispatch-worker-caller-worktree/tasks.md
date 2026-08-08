---
author: qinyi
created_at: 2026-08-08 17:05:13
revised_at: 2026-08-08 17:55:00
---

# 任务（Tasks）— dispatch_worker caller worktree（路径A）+ mission external 模式

> round-2 修订：补 mission external 模式（P0-2）+ converge 跳过（P0-1）+ 字段名 branch。plan 阶段细化 Wave/依赖/allowed_paths。

## Phase 1 mission external 模式（P0-2）

- [ ] T1 orchestrator.py team_mission_entry(:130) 支持 `orchestration_mode="external"`：跳过 orchestrator run/lease，constraints 存 `{"orchestration_mode":"external"}`
- [ ] T2 mcp_gateway/tools.py create_mission(:743) 加 `orchestration_mode` 参 + 传 team_mission_entry
- [ ] T3 mcp_tools.py create_mission HTTP 端点同步加参（链路A）
- [ ] T4 daemon mcp-server.ts/hub-client.ts createMission schema 加 orchestration_mode

## Phase 2 dispatch_worker 路径A 核心（P0-1）

- [ ] T5 execution.py dispatch_worker(:153) 加 worktree_path/branch/worker_prompt 三可选参
- [ ] T6 execution.py:190 自建 if 加 `and not worktree_path` 短路 + root_path 赋值
- [ ] T7 execution.py 路径A **不写 run.worktree_branch**（P0-1 双保险，D-008）
- [ ] T8 execution.py:245 prompt = worker_prompt or render_worker_prompt(run)

## Phase 3 converge external 跳过（P0-1 根解）

- [ ] T9 finalizer.py converge_mission_for_completed_run(:470) 检测 mission.constraints.orchestration_mode=="external" → 跳过 finalize/cleanup（D-003@v2）

## Phase 4 两条 MCP 入口 + daemon schema 透传

- [ ] T10 mcp_gateway/tools.py dispatch_worker(:335) 加3参透传（链路B，字段名 branch）
- [ ] T11 mcp_tools.py DispatchWorkerRequest(:56) 加3字段透传（链路A HTTP）
- [ ] T12 daemon mcp-server.ts/hub-client.ts dispatchWorker schema 加3字段（branch）

## Phase 5 daemon allowed_roots

- [ ] T13 docs 集成指引：workspace root_path=仓根 + daemon allowed_roots 配置约定
- [ ] T14 smoke 前置硬校验 allowed_roots 含仓根（R-03）

## Phase 6 跨仓 SillySpec 接通

- [ ] T15 sillyspec isPathASupported() 探测 MCP tools/list dispatch_worker schema 含 worktree_path
- [ ] T16 sillyspec client.js createMission 传 orchestration_mode="external" + dispatchWorker 传 branch（字段名对齐）
- [ ] T17 sillyspec probe.js rootPath 拿取 + worktree 越界校验
- [ ] T18 跨仓契约 docs/sillyspec/sillyhub-path-a-contract.md 更新（字段名 branch + external mode + 校验清单打勾）
- [ ] T19 端到端 smoke：SillySpec execute 波 → create_mission(external) → dispatch_worker → worker 写码 → 回收 apply

## Phase 7 测试

- [ ] T20 新增 test_dispatch_worker_caller_worktree.py（传 worktree_path → 不调 git_worktree_add + root_path 透传 + 不写 worktree_branch + worker_prompt 进 prompt）
- [ ] T21 新增 test_mission_external_mode.py（create_mission external → 无 orchestrator run + constraints 含 mode；converge external → 跳过 finalize）
- [ ] T22 全套零回归（test_dispatch_worker_worktree AC-01..06 / test_mcp_tools / test_execution / team 模式 create_mission 绿）
