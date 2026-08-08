---
id: task-09
title: run_verify_gate MCP tool soft call
title_zh: run_verify_gate MCP 工具软调用
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P0
depends_on: [task-06]
blocks: [task-11, task-15, task-18]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/mcp_gateway/tools.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/dispatch.py
goal: >
  新增 run_verify_gate MCP tool：优先读 AgentRun.gate_result（_read_latest_gate_result，dispatch.py:148）；缺则软调 sillyspec gate verify（复用 task-06 下沉的 RPC 骨架，作 tool 显式调不阻塞）；都不可用返回 unavailable。删 verify-result.md fallback（FR-03/D-003/D-008）。
implementation:
  - 在 mcp_gateway/tools.py 注册 run_verify_gate tool，入参 change_id
  - 优先读 AgentRun.gate_result（gate task :1266 已跑并存库）→ {exit_code, errors}，source=gate_result
  - gate_result 缺 → 经 HostFsDelegate.run_command 调 sillyspec gate verify（白名单 + 12min timeout），source=gate_cmd
  - 都不可用 → source=unavailable, exit_code=null（交调用方决策）
  - 删除 verify-result.md fallback（host_fs/delegate.py:14 明示 daemon 不可达）
  - 不调 _run_gate_via_delegate（已下沉），不自动阻塞推进
acceptance:
  - tool 返回 {exit_code, errors, source}，不改 change 状态（结果交决策）
  - 不硬阻塞、不读 verify-result.md
verify:
  - task-15 的 test_change_stage_tools.py 覆盖三 source 分支（gate_result/gate_cmd/unavailable）
  - grep -rn "verify-result.md\|verify_result.md" backend/app/modules/（tool 范围命中 0）
constraints:
  - gate cmd 可达性在 Wave 2 实测（gate 子命令发版与否）
  - 不重新引入硬阻塞 exit 2 卡死语义
provides:
  - run_verify_gate MCP tool（gate 软调用，读 gate_result/gate cmd）
expects_from:
  task-06:
    - contract: _run_gate_via_delegate 硬阻塞已下沉，RPC 骨架（HostFsDelegate.run_command + 白名单 + timeout）可被 tool 复用作软调用
      needs: [gate cmd 软调用入口, _read_latest_gate_result/AgentRun.gate_result 读取路径]
---

# task-09 实现笔记

FR-03/D-003/D-008。gate 软调用解 R-02/R-06，结果交决策（核验纪律靠调用方）。dispatch.py 与 task-06 共文件，但 task-06 先行（task-09 依赖它）。
